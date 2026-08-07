/**
 * digital-footprint.ts — J5 Lawful Digital-Footprint Discovery Layer
 *
 * Builds disambiguating search queries from entity context (name + employer +
 * jurisdiction + role) and routes them through public search endpoints and
 * official contact-page scrapers with source-specific rate-limit controls.
 *
 * All sources are lawful public endpoints. Social profiles are kept as
 * identity evidence only — a public LinkedIn URL is not a direct contact.
 * Empty, blocked, timeout, and parse-failure outcomes are tracked so the
 * multi-pass scheduler can apply cooldowns (J7).
 */

import { isValidPublicEmail } from "./contact-validation";
import { logger } from "./logger";

// ── Constants ─────────────────────────────────────────────────────────────────

const DDG_HTML = "https://html.duckduckgo.com/html/";
const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ApexFinder-OSINT/2.0; +https://apexfinder.private)",
  Accept: "text/html,application/xhtml+xml",
};
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(\+?[\d\s\-().]{7,20})/g;
const LINKEDIN_RE = /https?:\/\/(?:www\.)?linkedin\.com\/(?:in|pub)\/[a-zA-Z0-9\-_%]+\/?/i;

// ── Types ─────────────────────────────────────────────────────────────────────

export type FootprintVectorType = "email" | "phone" | "linkedin" | "website" | "domain";

export interface FootprintEvidence {
  type: FootprintVectorType;
  value: string;
  source: string;          // e.g. "DDG", "ContactPage", "DDG-LinkedIn"
  sourceUrl: string | null;
  confidence: number;      // 0-1
  queryTemplate: string;   // which template produced this
}

export interface FootprintResult {
  evidence: FootprintEvidence[];
  queriesRun: number;
  sourcesHit: string[];
  /** Updated cooldowns to persist back to enrichmentStateTable */
  cooldownUpdates: Record<string, string>;  // source → ISO timestamp
  empty: boolean;
  errors: string[];
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinkedIn(text: string): string | null {
  const m = text.match(LINKEDIN_RE);
  if (!m) return null;
  return m[0].replace(/\/$/, "").split("?")[0] ?? null;
}

function extractEmails(text: string): string[] {
  const raw = [...(text.matchAll(EMAIL_RE) ?? [])].map(m => m[0].toLowerCase());
  return raw.filter(e => isValidPublicEmail(e)).slice(0, 5);
}

function extractPhones(text: string): string[] {
  const raw = [...(text.matchAll(PHONE_RE) ?? [])].map(m => m[0].trim());
  return raw
    .map(p => p.replace(/[^\d+]/g, ""))
    .filter(p => p.replace(/\D/g, "").length >= 7 && p.replace(/\D/g, "").length <= 15)
    .slice(0, 3);
}

// ── DDG HTML search ───────────────────────────────────────────────────────────

async function ddgSearch(query: string): Promise<{ text: string; urls: string[] }> {
  try {
    const resp = await fetch(DDG_HTML, {
      method: "POST",
      headers: { ...FETCH_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: `q=${encodeURIComponent(query)}&kl=us-en`,
      signal: AbortSignal.timeout(14_000),
    });
    if (!resp.ok) return { text: "", urls: [] };
    const html = await resp.text();
    const text = stripHtml(html).slice(0, 10_000);
    const urlMatches = html.matchAll(/href="(https?:\/\/(?!.*duckduckgo)[^"]+)"/gi);
    const urls: string[] = [];
    for (const m of urlMatches) {
      const url = m[1];
      if (url && urls.length < 12) urls.push(url);
    }
    return { text, urls };
  } catch {
    return { text: "", urls: [] };
  }
}

// ── Contact-page scraper ──────────────────────────────────────────────────────

async function scrapePage(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { ...FETCH_HEADERS, Accept: "text/html" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return "";
    const html = await resp.text();
    return stripHtml(html).slice(0, 8_000);
  } catch {
    return "";
  }
}

// ── Query-template builder ────────────────────────────────────────────────────

interface QueryTemplate {
  query: string;
  label: string;    // human-readable identifier
  weight: number;   // confidence multiplier for extracted evidence
}

export function buildQueryTemplates(entity: {
  name: string;
  type: string;
  nationality: string | null;
  bizLocation: string | null;
  employer: string | null;
  role: string | null;
  graphNeighbourDomains: string[];   // J8: domains from graph neighbours
  graphNeighbourNames: string[];     // J8: names from graph neighbours
}, domain: string | null): QueryTemplate[] {
  const name = entity.name.trim().replace(/^(mr|mrs|ms|dr|prof)\.\s*/i, "");
  const templates: QueryTemplate[] = [];

  // T1 — name + employer (most disambiguating when employer is known)
  if (entity.employer && entity.employer !== name) {
    templates.push({
      query: `"${name}" "${entity.employer}" email`,
      label: "name+employer+email",
      weight: 1.0,
    });
  }

  // T2 — name + domain official pages (highest precision)
  if (domain) {
    templates.push({
      query: `site:${domain} "${name}" OR team OR leadership OR executives OR contact`,
      label: "domain+official",
      weight: 0.95,
    });
  }

  // T3 — name + LinkedIn
  templates.push({
    query: `"${name}" site:linkedin.com/in`,
    label: "name+linkedin",
    weight: 0.85,
  });

  // T4 — name + jurisdiction + contact
  const geo = entity.bizLocation ?? entity.nationality;
  if (geo) {
    templates.push({
      query: `"${name}" "${geo}" email OR contact`,
      label: "name+geo+contact",
      weight: 0.75,
    });
  }

  // T5 — name + role (disambiguates common names)
  if (entity.role) {
    templates.push({
      query: `"${name}" "${entity.role}" contact email`,
      label: "name+role+contact",
      weight: 0.80,
    });
  }

  // T6 — J8: graph-neighbour context (e.g. co-director at the same firm)
  if (entity.graphNeighbourNames.length > 0) {
    const neighbour = entity.graphNeighbourNames[0]!;
    templates.push({
      query: `"${name}" "${neighbour}" email OR contact`,
      label: "name+graph-neighbour",
      weight: 0.65,
    });
  }

  // T7 — name + public mention (broadest, lowest confidence)
  templates.push({
    query: `"${name}" email -site:linkedin.com -site:facebook.com`,
    label: "name+email-mention",
    weight: 0.50,
  });

  return templates;
}

// ── Cooldown helper ───────────────────────────────────────────────────────────

function isCooledDown(cooldowns: Record<string, string>, source: string): boolean {
  const ts = cooldowns[source];
  if (!ts) return false;
  return new Date(ts) > new Date();
}

function cooldownFor(outcome: "hit" | "empty" | "error" | "timeout"): Date {
  const hrs = outcome === "hit" ? 12 : outcome === "empty" ? 48 : outcome === "error" ? 24 : 12;
  return new Date(Date.now() + hrs * 60 * 60 * 1_000);
}

// ── Main discovery function ───────────────────────────────────────────────────

export async function discoverDigitalFootprint(
  entity: {
    name: string;
    type: string;
    nationality: string | null;
    bizLocation: string | null;
    employer: string | null;
    role: string | null;
    graphNeighbourDomains: string[];
    graphNeighbourNames: string[];
  },
  domain: string | null,
  officialContactPaths: string[],
  sourceCooldowns: Record<string, string>,
): Promise<FootprintResult> {
  const result: FootprintResult = {
    evidence: [], queriesRun: 0, sourcesHit: [],
    cooldownUpdates: {}, empty: false, errors: [],
  };
  const seen = new Set<string>();

  function addEvidence(ev: FootprintEvidence): void {
    const key = `${ev.type}:${ev.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.evidence.push(ev);
    }
  }

  const templates = buildQueryTemplates(entity, domain);

  // ── DDG search passes ─────────────────────────────────────────────────────
  if (!isCooledDown(sourceCooldowns, "DDG")) {
    let ddgHits = 0;
    // Run top 4 templates (skip lowest-weight if we already have good evidence)
    for (const { query, label, weight } of templates.slice(0, 4)) {
      if (result.evidence.filter(e => e.type === "email").length >= 3) break;
      try {
        await sleep(1_400);
        const { text, urls } = await ddgSearch(query);
        result.queriesRun += 1;
        if (!text) continue;

        const linkedIn = extractLinkedIn(text + " " + urls.join(" "));
        if (linkedIn) {
          addEvidence({ type: "linkedin", value: linkedIn, source: "DDG", sourceUrl: linkedIn, confidence: weight * 0.85, queryTemplate: label });
          ddgHits += 1;
        }
        for (const email of extractEmails(text)) {
          addEvidence({ type: "email", value: email, source: "DDG", sourceUrl: null, confidence: weight * 0.60, queryTemplate: label });
          ddgHits += 1;
        }
        for (const phone of extractPhones(text)) {
          addEvidence({ type: "phone", value: phone, source: "DDG", sourceUrl: null, confidence: weight * 0.50, queryTemplate: label });
          ddgHits += 1;
        }
        if (ddgHits > 0) result.sourcesHit.push("DDG");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`DDG[${label}]: ${msg}`);
        if (/timeout|ECONNREFUSED/i.test(msg)) {
          result.cooldownUpdates["DDG"] = cooldownFor("timeout").toISOString();
        }
      }
    }
    if (result.queriesRun > 0 && !result.cooldownUpdates["DDG"]) {
      result.cooldownUpdates["DDG"] = cooldownFor(result.evidence.length > 0 ? "hit" : "empty").toISOString();
    }
  }

  // ── Official contact-page scraping ─────────────────────────────────────────
  if (domain && !isCooledDown(sourceCooldowns, "ContactPage")) {
    let pageHits = 0;
    for (const url of officialContactPaths.slice(0, 5)) {
      if (result.evidence.filter(e => e.type === "email").length >= 4) break;
      try {
        await sleep(700);
        const text = await scrapePage(url);
        if (!text) continue;
        result.queriesRun += 1;

        for (const email of extractEmails(text)) {
          addEvidence({ type: "email", value: email, source: "ContactPage", sourceUrl: url, confidence: 0.88, queryTemplate: "domain+contact-page" });
          pageHits += 1;
        }
        for (const phone of extractPhones(text)) {
          addEvidence({ type: "phone", value: phone, source: "ContactPage", sourceUrl: url, confidence: 0.78, queryTemplate: "domain+contact-page" });
          pageHits += 1;
        }
        const li = extractLinkedIn(text);
        if (li) {
          addEvidence({ type: "linkedin", value: li, source: "ContactPage", sourceUrl: url, confidence: 0.82, queryTemplate: "domain+contact-page" });
          pageHits += 1;
        }
        if (pageHits > 0) result.sourcesHit.push("ContactPage");
      } catch (err) {
        result.errors.push(`ContactPage[${url}]: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    result.cooldownUpdates["ContactPage"] = cooldownFor(pageHits > 0 ? "hit" : "empty").toISOString();
  }

  // ── J8: neighbour-domain scraping ─────────────────────────────────────────
  if (entity.graphNeighbourDomains.length > 0 && !isCooledDown(sourceCooldowns, "GraphNeighbour")) {
    for (const neighbourDomain of entity.graphNeighbourDomains.slice(0, 2)) {
      try {
        await sleep(600);
        const url = `https://${neighbourDomain}/contact`;
        const text = await scrapePage(url);
        if (!text) continue;
        result.queriesRun += 1;
        for (const email of extractEmails(text)) {
          addEvidence({ type: "email", value: email, source: "GraphNeighbour", sourceUrl: url, confidence: 0.60, queryTemplate: "graph-neighbour-domain" });
          result.sourcesHit.push("GraphNeighbour");
        }
      } catch {
        // Skip on error
      }
    }
    result.cooldownUpdates["GraphNeighbour"] = cooldownFor(result.sourcesHit.includes("GraphNeighbour") ? "hit" : "empty").toISOString();
  }

  result.empty = result.evidence.length === 0;

  logger.debug(
    { name: entity.name, queries: result.queriesRun, evidence: result.evidence.length, empty: result.empty },
    "J5 digital footprint discovery complete",
  );

  return result;
}
