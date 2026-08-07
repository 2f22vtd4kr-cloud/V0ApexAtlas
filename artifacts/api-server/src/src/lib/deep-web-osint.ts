/**
 * Deep Web OSINT Enricher — Multi-engine · Multi-query · UA-rotating
 *
 * Designed as an ADDITIVE layer on top of the in-house enricher.
 * Targets entities that structured databases (Wikidata, GitHub, ORCID) missed —
 * primarily FAA aircraft owners and HMLR property buyers who are not public figures.
 *
 * Strategy:
 *   1. Build 4–7 context-aware query templates per entity using ALL available metadata:
 *      N-number (FAA), company name (EDGAR/CH), location, filing type, asset type
 *   2. Fire each query against DuckDuckGo HTML (html.duckduckgo.com/html)
 *      rotating through 12 real browser User-Agent signatures
 *   3. Fire the 2 most targeted queries against Bing HTML (separate index, complementary results)
 *   4. Parse HTML snippets for emails, phones, LinkedIn URLs
 *   5. Follow the top 3 non-social result URLs to scrape actual pages
 *   6. Cross-validate: same value appearing in N independent sources → confidence score
 *   7. Results stored in Upstash slot 2 contact cache (REDIS_URL_2) for persistence
 */

import { logger } from "./logger";
import { extractWithAI, researchWithPerplexity, researchWithTavily, researchWithExa, type AIResearchContext } from "./ai-extractor";
import {
  applyEnsembleAdjudication,
  buildEnsembleAdjudicationText,
  reconcileAIResults,
  type AIEnsembleResult,
} from "./ai-ensemble";
import { assessTargetReachability, reachabilityDirective } from "./reachability-realism";
import { scoreCorroboration } from "./evidence-ledger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DeepWebOsintInput {
  id:               number;
  name:             string;
  type:             string;
  sourceRegistries?: string | null;
  knownResidences?:  string | null;
  metadata?:         string | null;
  bayesianScore?:    number | null;
  email?:            string | null;
  phone?:            string | null;
  phoneSource?:      string | null;
  contactOutcome?:   string | null;
  contactConfidence?: number | null;
  notes?:            string | null;
}

export interface DeepWebOsintResult {
  email:             string | null;
  emailConfidence:   number;   // 0–100; higher when found in more independent sources
  phone:             string | null;
  phoneConfidence:   number;
  linkedinUrl:       string | null;
  instagramUrl:      string | null;  // venue/org OR personal handle discovered
  twitterUrl:        string | null;  // venue/org OR personal handle discovered
  personsDiscovered: string[];       // owner/founder names found — review-only, never auto-promoted
  evidence?:         Array<{ vectorType: string; value: string; source: string; sourceUrl?: string | null; extractionMethod: string; confidence: number; details?: Record<string, unknown>; observedAt: string }>;
  aiEnsemble?:        AIEnsembleResult;
  sources:           string[];  // which queries/engines produced the find
  queriesFired:      number;
  pagesScraped:      number;
}

type CandidateEvidence = {
  value: string;
  sourceUrl?: string | null;
  source: string;
  extractionMethod: string;
  confidence: number;
  details?: Record<string, unknown>;
  observedAt: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

// 12 real browser fingerprints — rotated randomly per search request
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
];

// Domains never worth scraping for personal contact info.
// NOTE: linkedin.com, twitter.com, x.com, instagram.com intentionally REMOVED —
// the dedicated social-discovery module handles structured extraction from those domains.
// Keeping them here would silently drop the most valuable HNWI contact surfaces.
const SKIP_DOMAINS = new Set([
  // Search engines and aggregators
  "google.com", "bing.com", "yahoo.com", "duckduckgo.com",
  // E-commerce — no HNWI contact data
  "amazon.com", "ebay.com", "apple.com", "microsoft.com",
  // Video / image platforms
  "youtube.com", "tiktok.com", "pinterest.com",
  // Encyclopaedias — scraped separately by in-house enricher
  "wikipedia.org", "wikidata.org",
  // Government registries — scraped via dedicated ingestors, not general scraper
  "sec.gov", "gov.uk", "faa.gov", "irs.gov",
]);

// Email blocklist — not real contact emails
const EMAIL_BLOCK = new Set([
  "example.com", "domain.com", "email.com", "test.com", "sample.com",
  "noreply.com", "no-reply.com", "invalid.com", "placeholder.com",
  "privacy.com", "domainsbyproxy.com", "whoisguard.com", "privacyprotect.org",
  "whoisprivacycorp.com", "registrant.com",
  // Financial data aggregators / news wires — their emails belong to editorial teams
  "stocktitan.net", "seekingalpha.com", "benzinga.com", "thestreet.com",
  "marketwatch.com", "businesswire.com", "prnewswire.com", "globenewswire.com",
  "accesswire.com", "investopedia.com", "fool.com", "cnbc.com",
  "crunchbase.com", "pitchbook.com", "owler.com", "dnb.com",
  "morningstar.com", "simplywall.st", "stockanalysis.com", "finviz.com",
  "macroaxis.com", "zacks.com", "wisesheets.io",
]);

const EMAIL_RE     = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE     = [
  /\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?[\s.\-]?\d{1,4}[\s.\-]?\d{1,9}/,
  /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/,
];
const LINKEDIN_RE  = /https?:\/\/(www\.)?linkedin\.com\/(in|pub|company)\/[a-zA-Z0-9\-_%]{3,}\/?/i;
const INSTAGRAM_RE = /https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9_.]{2,30}\/?/gi;
const TWITTER_RE   = /https?:\/\/(www\.)?(twitter|x)\.com\/[a-zA-Z0-9_]{2,30}\/?/gi;

// ─── Utilities ────────────────────────────────────────────────────────────────

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

function jitteredDelay(baseMs: number) {
  return sleep(baseMs + Math.floor(Math.random() * 600));
}

function safeJson<T>(str: string | null | undefined, fallback: T): T {
  try { return str ? JSON.parse(str) as T : fallback; } catch { return fallback; }
}

// Normalise ALL-CAPS "LAST FIRST" (FAA/EDGAR) → "First Last"
function normaliseName(raw: string): string {
  const t = raw.trim();
  if (t !== t.toUpperCase() || !/[A-Z]{2}/.test(t)) return t;
  const parts = t.split(/\s+/);
  if (parts.length < 2) return t.charAt(0) + t.slice(1).toLowerCase();
  const tc = (s: string) => s.length <= 2 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const [last, ...rest] = parts as [string, ...string[]];
  return [...rest, last].map(tc).join(" ");
}

function extractEmails(text: string): string[] {
  const all = [...text.matchAll(EMAIL_RE)].map(m => m[0]!.toLowerCase());
  return [...new Set(all.filter(e => {
    const d = e.split("@")[1] ?? "";
    return !EMAIL_BLOCK.has(d) && !d.includes("privacy") && !d.includes("proxy") && e.length < 80 && !e.toLowerCase().includes("protected");
  }))];
}

function extractPhone(text: string): string | null {
  for (const p of PHONE_RE) {
    const m = text.match(p);
    if (m) {
      const c = m[0]!.replace(/\s+/g, " ").trim();
      if ((c.match(/\d/g) ?? []).length >= 7) return c;
    }
  }
  return null;
}

function extractLinkedIn(text: string): string | null {
  const m = text.match(LINKEDIN_RE);
  return m ? m[0]!.replace(/\/$/, "") : null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Extract actual result URLs from DDG HTML (uses uddg= redirect parameter)
function extractDdgUrls(html: string): string[] {
  const urls: string[] = [];
  const uddgRe = /uddg=(https?%3A%2F%2F[^&"'\s]+)/g;
  for (const m of html.matchAll(uddgRe)) {
    try {
      const decoded = decodeURIComponent(m[1]!);
      const domain = new URL(decoded).hostname.replace(/^www\./, "");
      if (!SKIP_DOMAINS.has(domain)) urls.push(decoded);
    } catch { /* malformed URL */ }
  }
  return [...new Set(urls)].slice(0, 8);
}

// Extract actual result URLs from Bing HTML
function extractBingUrls(html: string): string[] {
  const urls: string[] = [];
  // Bing result URLs appear as href attributes in <h2><a href="https://...">
  const hrefRe = /href="(https?:\/\/(?!www\.bing\.com)[^"]+)"/g;
  for (const m of html.matchAll(hrefRe)) {
    try {
      const url = m[1]!;
      const domain = new URL(url).hostname.replace(/^www\./, "");
      if (!SKIP_DOMAINS.has(domain)) urls.push(url);
    } catch { /* skip */ }
  }
  return [...new Set(urls)].slice(0, 8);
}

// ─── Search Engines ───────────────────────────────────────────────────────────

interface SearchResult {
  text:   string;       // plain text of all snippets
  urls:   string[];     // actual result URLs (non-social)
  engine: string;
}

async function duckduckgoSearch(query: string): Promise<SearchResult> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(14_000),
      headers: {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br",
        Referer: "https://duckduckgo.com/",
      },
    });
    if (!resp.ok) return { text: "", urls: [], engine: "DDG" };
    const html = await resp.text();
    const urls = extractDdgUrls(html);
    const text = stripHtml(html).slice(0, 12_000);
    return { text, urls, engine: "DDG" };
  } catch (err: any) {
    logger.debug({ err: err?.message, query }, "DDG search failed");
    return { text: "", urls: [], engine: "DDG" };
  }
}

async function bingSearch(query: string): Promise<SearchResult> {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en&cc=US&first=1`;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(14_000),
      headers: {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        Referer: "https://www.bing.com/",
      },
    });
    if (!resp.ok) return { text: "", urls: [], engine: "Bing" };
    const html = await resp.text();
    const urls = extractBingUrls(html);
    const text = stripHtml(html).slice(0, 12_000);
    return { text, urls, engine: "Bing" };
  } catch (err: any) {
    logger.debug({ err: err?.message, query }, "Bing search failed");
    return { text: "", urls: [], engine: "Bing" };
  }
}

interface ScrapeResult {
  email:        string | null;
  phone:        string | null;
  linkedinUrl:  string | null;
  instagramUrl: string | null;
  twitterUrl:   string | null;
  rawText:      string;
}

// Scrape a URL for contact info — light, respects 10s timeout
async function scrapePage(url: string): Promise<ScrapeResult> {
  const empty: ScrapeResult = { email: null, phone: null, linkedinUrl: null, instagramUrl: null, twitterUrl: null, rawText: "" };
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });
    if (!resp.ok) return empty;
    const html = await resp.text().then(h => h.slice(0, 80_000));

    // mailto: hrefs (highest accuracy)
    let email: string | null = null;
    const mailtoRe = /href=["']mailto:([^"'?\s]+)/gi;
    for (const m of html.matchAll(mailtoRe)) {
      const addr = m[1]!.toLowerCase().trim();
      const domain = addr.split("@")[1] ?? "";
      if (addr.includes("@") && !EMAIL_BLOCK.has(domain) && addr.length < 80) { email = addr; break; }
    }

    // LinkedIn from href
    let linkedinUrl: string | null = null;
    const liM = html.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]{3,})[^"']*/i);
    if (liM) linkedinUrl = liM[1]!.replace(/\/$/, "");

    // Instagram from href
    let instagramUrl: string | null = null;
    const igM = html.match(/href=["'](https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9_.]{2,30})[^"']*/i);
    if (igM) instagramUrl = igM[1]!.replace(/\/$/, "");

    // Twitter / X from href
    let twitterUrl: string | null = null;
    const twM = html.match(/href=["'](https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[a-zA-Z0-9_]{2,30})[^"']*/i);
    if (twM) twitterUrl = twM[1]!.replace(/\/$/, "");

    const rawText = stripHtml(html).slice(0, 15_000);
    if (!email) email = extractEmails(rawText)[0] ?? null;
    const phone = extractPhone(rawText);
    if (!linkedinUrl) linkedinUrl = extractLinkedIn(rawText);
    if (!instagramUrl) { const igT = rawText.match(INSTAGRAM_RE); if (igT) instagramUrl = igT[0]!.replace(/\/$/, ""); }
    if (!twitterUrl)   { const twT = rawText.match(TWITTER_RE);   if (twT) twitterUrl   = twT[0]!.replace(/\/$/, ""); }

    return { email, phone, linkedinUrl, instagramUrl, twitterUrl, rawText };
  } catch {
    return empty;
  }
}

// ─── Query Builder ────────────────────────────────────────────────────────────

function buildQueries(entity: DeepWebOsintInput): string[] {
  const meta = safeJson<Record<string, unknown>>(entity.metadata, {});
  const name = normaliseName(entity.name.trim());
  if (!name || name.length < 4) return [];

  // Skip address-named HMLR entries (e.g. "23 High Street London")
  if (/^\d+\s/.test(name) || /\b(flat|house|cottage|manor|farm|apartment)\s+\d/i.test(name)) return [];

  const isIndividual = entity.type === "HNWI" || entity.type === "Gatekeeper" ||
    /^[A-Z][a-z]+ [A-Z]/.test(name);
  const isCorp = !isIndividual;

  const queries: string[] = [];

  if (isIndividual) {
    // Core contact queries
    queries.push(`"${name}" email contact`);
    queries.push(`"${name}" linkedin`);

    // Aviation context — N-number and aircraft type are strong identifiers
    const nNumber = typeof meta["nNumber"] === "string" ? meta["nNumber"] as string : null;
    if (nNumber) {
      queries.push(`"${nNumber}" aircraft owner contact email`);
      queries.push(`"${name}" pilot aviation email`);
    }

    // Company / filing context
    const companyName = typeof meta["companyName"] === "string" ? (meta["companyName"] as string).trim() : null;
    if (companyName && companyName !== name) {
      queries.push(`"${name}" "${companyName.substring(0, 40)}" contact`);
    } else if (typeof meta["formType"] === "string") {
      // EDGAR-sourced entity — professional investor context
      queries.push(`"${name}" investor director SEC contact email`);
    }

    // Geographic context — narrows to the right person
    const bizLocation = typeof meta["bizLocation"] === "string" ? meta["bizLocation"] as string : null;
    const residences = safeJson<string | string[]>(entity.knownResidences, []);
    const firstResidence = Array.isArray(residences) ? residences[0] : residences;
    const geoContext = bizLocation || (typeof firstResidence === "string" ? firstResidence : null);
    if (geoContext) {
      const city = geoContext.split(",")[0]?.trim();
      if (city && city.length > 2 && city !== name) {
        queries.push(`"${name}" "${city}" contact email phone`);
      }
    }
  }

  if (isCorp) {
    // Strip legal suffix for cleaner search
    const clean = name
      .replace(/\b(llc|ltd|limited|corp|corporation|inc|incorporated|group|holdings|trust|co)\b\.?$/gi, "")
      .trim();

    queries.push(`"${name}" CEO director email contact`);
    queries.push(`"${clean}" registered office contact phone`);
    queries.push(`"${name}" head office address`);

    // CH-registered companies
    const chId = typeof meta["chId"] === "string" ? meta["chId"] as string : null;
    if (chId || /uk|ltd|plc/i.test(entity.sourceRegistries ?? "")) {
      queries.push(`site:companies-house.gov.uk "${clean}"`);
    }

    queries.push(`"${name}" management team email`);
  }

  return queries.slice(0, 7);
}

// ─── Cross-validation scoring ─────────────────────────────────────────────────
// More independent sources confirming the same value = higher confidence

export function scoreByCorroboration(
  sources: number,
  evidence: Array<{ value: string; sourceUrl?: string | null }> = [],
  value?: string | null,
): number {
  const matchingEvidence = value
    ? evidence.filter((item) => item.value.trim().toLowerCase() === value.trim().toLowerCase() && item.sourceUrl)
    : evidence.filter((item) => item.sourceUrl);
  if (matchingEvidence.length === 0) return Math.min(35, 20 + sources * 4);
  const summary = scoreCorroboration(
    matchingEvidence.map((item) => ({ value: item.value, url: item.sourceUrl! })),
  );
  const score = 38
    + summary.corroboratingDomains * 12
    + summary.corroboratingFamilies * 8
    - summary.conflictCount * 15;
  return Math.max(40, Math.min(94, score));
}

// ─── Main enricher ────────────────────────────────────────────────────────────

export async function deepWebOsintEnrich(entity: DeepWebOsintInput): Promise<DeepWebOsintResult> {
  const result: DeepWebOsintResult = {
    email: null, emailConfidence: 0,
    phone: null, phoneConfidence: 0,
    linkedinUrl: null,
    instagramUrl: null, twitterUrl: null,
    personsDiscovered: [],
    evidence: [],
    sources: [], queriesFired: 0, pagesScraped: 0,
  };

  const queries = buildQueries(entity);
  if (queries.length === 0) return result;

  // Derived entity classification — used to gate org-level social accumulation
  const isCorp = entity.type === "Corporation" || entity.type === "Corp" ||
    entity.type === "Trust" ||
    !(entity.type === "HNWI" || entity.type === "Gatekeeper" ||
      /^[A-Z][a-z]+ [A-Z]/.test(entity.name));

  // Accumulators for cross-validation
  const emailHits    = new Map<string, string[]>();
  const phoneHits    = new Map<string, string[]>();
  const linkedinHits = new Map<string, string[]>();
  const igHits       = new Map<string, string[]>();  // instagram url → sources
  const twHits       = new Map<string, string[]>();  // twitter url → sources
  const sourceUrlsByLabel = new Map<string, string[]>();
  const urlsToScrape = new Set<string>();
  let allSearchText  = ""; // accumulated for AI extraction pass

  // Hoist aiOwners so Phase 0 (Perplexity) can populate it before Phase 3.7 runs
  type AiOwner = { name: string; instagram: string | null; twitter: string | null; linkedin: string | null };
  const aiOwners: AiOwner[] = [];
  // ── Phase 0: independent search providers — live web research ────────────
  // Gemini is intentionally absent: it is reserved for text-only Bureau
  // planning and never receives search tools or search prompts.
  try {
    // Derive country hint from knownResidences (e.g. "Port Pierre Canto, Cannes, France" → "France")
    const countryHint = (() => {
      const r = entity.knownResidences ?? "";
      const m = r.match(/,\s*([A-Z][a-zA-Z\s]{2,25})$/);
      return m ? m[1]!.trim() : null;
    })();
    const realism = reachabilityDirective(assessTargetReachability({
      type: entity.type,
      email: entity.email,
      phone: entity.phone,
      phoneSource: entity.phoneSource,
      contactOutcome: entity.contactOutcome,
      contactConfidence: entity.contactConfidence,
      knownResidences: entity.knownResidences,
      metadata: entity.metadata,
      notes: entity.notes,
      sourceRegistries: entity.sourceRegistries,
    }));
    const metadata = safeJson<Record<string, unknown>>(entity.metadata, {});
    const researchContext: Omit<AIResearchContext, "lane"> = {
      tradingName: entity.name,
      city: null,
      anchors: [
        ...(entity.sourceRegistries ? [`source registry: ${entity.sourceRegistries}`] : []),
        ...Object.entries(metadata)
          .filter(([key, value]) =>
            /(^|_)(id|number|lei|cik|imo|icao|nnumber|chid|registration)(_|$)/i.test(key)
            && (typeof value === "string" || typeof value === "number"),
          )
          .map(([key, value]) => `${key}: ${String(value).trim()}`),
      ].filter(Boolean).slice(0, 6),
    };

    const providerResults = await Promise.allSettled([
      researchWithPerplexity(entity.name, entity.type, countryHint, {
        ...researchContext, lane: "people_press", reachability: realism,
      }),
      researchWithTavily(entity.name, entity.type, countryHint, {
        ...researchContext, lane: "contact_routes", reachability: realism,
      }),
      researchWithExa(entity.name, entity.type, countryHint, {
        ...researchContext, lane: "semantic_discovery", reachability: realism,
      }),
    ]);
    const [perp, tav, exa] = providerResults.map((item) =>
      item.status === "fulfilled" ? item.value : { source: "none" },
    ) as any[];
    const ensemble = reconcileAIResults([
      { provider: "perplexity", result: perp },
      { provider: "tavily", result: tav },
      { provider: "exa", result: exa },
    ].filter(({ result }) => result?.source && result.source !== "none"));
    try {
      const adjudicator = await extractWithAI(
        buildEnsembleAdjudicationText(entity.name, entity.type, [
          { provider: "perplexity", result: perp },
          { provider: "tavily", result: tav },
          { provider: "exa", result: exa },
        ].filter(({ result }) => result?.source && result.source !== "none")),
        entity.name,
        entity.type,
        countryHint,
      );
      result.aiEnsemble = adjudicator.source !== "none"
        ? applyEnsembleAdjudication(ensemble, adjudicator)
        : ensemble;
    } catch {
      result.aiEnsemble = ensemble;
    }
    for (const [index, item] of providerResults.entries()) {
      if (item.status === "rejected") {
        logger.warn({ providerIndex: index, err: item.reason?.message ?? String(item.reason) }, "Phase 0 provider failed independently");
      }
    }

    // Process Perplexity results
    if (perp.source === "perplexity-sonar") {
      const label = "Perplexity[sonar]";
      sourceUrlsByLabel.set(label, []);
      if (perp.email)    { const a = emailHits.get(perp.email) ?? [];       a.push(label); emailHits.set(perp.email, a); }
      if (perp.phone)    { const a = phoneHits.get(perp.phone) ?? [];       a.push(label); phoneHits.set(perp.phone, a); }
      if (perp.linkedin) { const a = linkedinHits.get(perp.linkedin) ?? []; a.push(label); linkedinHits.set(perp.linkedin, a); }
      if (perp.instagram){ const a = igHits.get(perp.instagram) ?? [];      a.push(label); igHits.set(perp.instagram, a); }
      if (perp.twitter)  { const a = twHits.get(perp.twitter) ?? [];        a.push(label); twHits.set(perp.twitter, a); }
      for (const oc of perp.ownerContacts) {
        aiOwners.push({ name: oc.name, instagram: oc.instagram, twitter: oc.twitter, linkedin: oc.linkedin });
        if (!isCorp) {
          if (oc.instagram) { const a = igHits.get(oc.instagram) ?? [];      a.push(`${label}-owner`); igHits.set(oc.instagram, a); }
          if (oc.twitter)   { const a = twHits.get(oc.twitter) ?? [];        a.push(`${label}-owner`); twHits.set(oc.twitter, a); }
        }
        if (oc.linkedin)  { const a = linkedinHits.get(oc.linkedin) ?? []; a.push(`${label}-owner`); linkedinHits.set(oc.linkedin, a); }
      }
      for (const url of perp.citations.slice(0, 4)) urlsToScrape.add(url);
      allSearchText += " " + JSON.stringify({ owners: perp.owners, ownerContacts: perp.ownerContacts });
      result.sources.push(label);
    }

    // Process Exa results
    if (exa.source === "exa") {
      const label = "Exa";
      sourceUrlsByLabel.set(label, []);
      if (exa.email)    { const a = emailHits.get(exa.email) ?? [];       a.push(label); emailHits.set(exa.email, a); }
      if (exa.phone)    { const a = phoneHits.get(exa.phone) ?? [];       a.push(label); phoneHits.set(exa.phone, a); }
      if (exa.linkedin) { const a = linkedinHits.get(exa.linkedin) ?? []; a.push(label); linkedinHits.set(exa.linkedin, a); }
      if (exa.instagram){ const a = igHits.get(exa.instagram) ?? [];      a.push(label); igHits.set(exa.instagram, a); }
      if (exa.twitter)  { const a = twHits.get(exa.twitter) ?? [];        a.push(label); twHits.set(exa.twitter, a); }
      for (const oc of exa.ownerContacts) {
        if (!aiOwners.some(o => o.name.toLowerCase() === oc.name.toLowerCase())) {
          aiOwners.push({ name: oc.name, instagram: oc.instagram, twitter: oc.twitter, linkedin: oc.linkedin });
        }
        if (!isCorp) {
          if (oc.instagram) { const a = igHits.get(oc.instagram) ?? [];      a.push(`${label}-owner`); igHits.set(oc.instagram, a); }
          if (oc.twitter)   { const a = twHits.get(oc.twitter) ?? [];        a.push(`${label}-owner`); twHits.set(oc.twitter, a); }
        }
        if (oc.linkedin)  { const a = linkedinHits.get(oc.linkedin) ?? []; a.push(`${label}-owner`); linkedinHits.set(oc.linkedin, a); }
      }
      for (const url of exa.citations.slice(0, 4)) urlsToScrape.add(url);
      allSearchText += " " + JSON.stringify({ owners: exa.owners, ownerContacts: exa.ownerContacts });
      result.sources.push(label);
    }

    // Process Tavily results
    if (tav.source === "tavily") {
      const label = "Tavily";
      sourceUrlsByLabel.set(label, []);
      if (tav.email)    { const a = emailHits.get(tav.email) ?? [];       a.push(label); emailHits.set(tav.email, a); }
      if (tav.phone)    { const a = phoneHits.get(tav.phone) ?? [];       a.push(label); phoneHits.set(tav.phone, a); }
      if (tav.linkedin) { const a = linkedinHits.get(tav.linkedin) ?? []; a.push(label); linkedinHits.set(tav.linkedin, a); }
      if (tav.instagram){ const a = igHits.get(tav.instagram) ?? [];      a.push(label); igHits.set(tav.instagram, a); }
      if (tav.twitter)  { const a = twHits.get(tav.twitter) ?? [];        a.push(label); twHits.set(tav.twitter, a); }
      for (const oc of tav.ownerContacts) {
        if (!aiOwners.some(o => o.name.toLowerCase() === oc.name.toLowerCase())) {
          aiOwners.push({ name: oc.name, instagram: oc.instagram, twitter: oc.twitter, linkedin: oc.linkedin });
        }
        if (!isCorp) {
          if (oc.instagram) { const a = igHits.get(oc.instagram) ?? [];      a.push(`${label}-owner`); igHits.set(oc.instagram, a); }
          if (oc.twitter)   { const a = twHits.get(oc.twitter) ?? [];        a.push(`${label}-owner`); twHits.set(oc.twitter, a); }
        }
        if (oc.linkedin)  { const a = linkedinHits.get(oc.linkedin) ?? []; a.push(`${label}-owner`); linkedinHits.set(oc.linkedin, a); }
      }
      for (const url of tav.citations.slice(0, 4)) urlsToScrape.add(url);
      allSearchText += " " + JSON.stringify({ owners: tav.owners, ownerContacts: tav.ownerContacts });
      result.sources.push(label);
    }
  } catch (err: any) {
    logger.warn({ err: err?.message, name: err?.name }, "Phase 0: search-provider research failed");
  }

  // ── Phase 1: DDG HTML search on all queries ──────────────────────────────
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]!;
    const label = `DDG[q${i + 1}]`;

    try {
      const sr = await duckduckgoSearch(query);
      result.queriesFired++;
      // DDG returns a URL list separately from flattened snippets. Without a
      // claim-to-result mapping, binding every URL to every extracted value
      // would manufacture provenance. Page scraping below creates the exact
      // URL binding when a candidate is actually observed on a page.
      sourceUrlsByLabel.set(label, []);
      allSearchText += " " + sr.text;

      if (sr.text) {
        for (const e of extractEmails(sr.text)) {
          const arr = emailHits.get(e) ?? [];
          arr.push(label);
          emailHits.set(e, arr);
        }
        const ph = extractPhone(sr.text);
        if (ph) {
          const arr = phoneHits.get(ph) ?? [];
          arr.push(label);
          phoneHits.set(ph, arr);
        }
        const li = extractLinkedIn(sr.text);
        if (li) {
          const arr = linkedinHits.get(li) ?? [];
          arr.push(label);
          linkedinHits.set(li, arr);
        }
      }

      // Collect result URLs for later scraping (cap at 6 total)
      for (const u of sr.urls) {
        if (urlsToScrape.size < 6) urlsToScrape.add(u);
      }
    } catch { /* skip failed query */ }

    // Polite delay between DDG requests — vary to avoid fingerprinting
    if (i < queries.length - 1) await jitteredDelay(900);
  }

  // ── Phase 2: Bing on top 2 most specific queries (different index) ────────
  const bingQueries = queries.filter(q => q.includes("email") || q.includes("contact")).slice(0, 2);
  for (let i = 0; i < bingQueries.length; i++) {
    const query = bingQueries[i]!;
    const label = `Bing[q${i + 1}]`;

    try {
      const sr = await bingSearch(query);
      result.queriesFired++;
      // Same fail-closed rule as DDG: result URLs are discovery context until
      // one is fetched and the value is observed in that page.
      sourceUrlsByLabel.set(label, []);
      allSearchText += " " + sr.text;

      if (sr.text) {
        for (const e of extractEmails(sr.text)) {
          const arr = emailHits.get(e) ?? [];
          arr.push(label);
          emailHits.set(e, arr);
        }
        const ph = extractPhone(sr.text);
        if (ph) {
          const arr = phoneHits.get(ph) ?? [];
          arr.push(label);
          phoneHits.set(ph, arr);
        }
        const li = extractLinkedIn(sr.text);
        if (li) {
          const arr = linkedinHits.get(li) ?? [];
          arr.push(label);
          linkedinHits.set(li, arr);
        }
      }

      for (const u of sr.urls) {
        if (urlsToScrape.size < 6) urlsToScrape.add(u);
      }
    } catch { /* skip */ }

    if (i < bingQueries.length - 1) await jitteredDelay(1000);
  }

  // ── Phase 3: Scrape top result URLs for actual page content ──────────────
  const scrapeTargets = [...urlsToScrape].slice(0, 3);
  for (const url of scrapeTargets) {
    try {
      const scraped = await scrapePage(url);
      result.pagesScraped++;
      const label = `Page[${new URL(url).hostname.replace(/^www\./, "").substring(0, 20)}]`;
      sourceUrlsByLabel.set(label, [url]);

      if (scraped.email)        { const a = emailHits.get(scraped.email) ?? [];               a.push(label); emailHits.set(scraped.email, a); }
      if (scraped.phone)        { const a = phoneHits.get(scraped.phone) ?? [];               a.push(label); phoneHits.set(scraped.phone, a); }
      if (scraped.linkedinUrl)  { const a = linkedinHits.get(scraped.linkedinUrl) ?? [];       a.push(label); linkedinHits.set(scraped.linkedinUrl, a); }
      // Corp entities: scraped ig/tw are person-level handles — skip org map
      if (!isCorp) {
        if (scraped.instagramUrl) { const a = igHits.get(scraped.instagramUrl) ?? [];            a.push(label); igHits.set(scraped.instagramUrl, a); }
        if (scraped.twitterUrl)   { const a = twHits.get(scraped.twitterUrl) ?? [];              a.push(label); twHits.set(scraped.twitterUrl, a); }
      }
      if (scraped.rawText)      { allSearchText += " " + scraped.rawText.slice(0, 3_000); }
    } catch { /* skip */ }

    await jitteredDelay(700);
  }

  // ── Phase 3.5: AI extraction pass (Groq → OpenRouter fallback) ───────────
  // Reads accumulated search text; aiOwners already populated by Phase 0 if Perplexity ran.

  if (allSearchText.length > 100) {
    try {
      const ai = await extractWithAI(allSearchText, entity.name, entity.type, null);
      if (ai.source !== "none") {
        const label = `AI[${ai.source}]`;
        // This extractor receives aggregate snippets/pages. Its provider
        // response is not claim-level provenance, so keep these candidates
        // unbound until a cited page independently confirms them.
        sourceUrlsByLabel.set(label, []);
        if (ai.email)    { const a = emailHits.get(ai.email) ?? [];       a.push(label); emailHits.set(ai.email, a); }
        if (ai.phone)    { const a = phoneHits.get(ai.phone) ?? [];       a.push(label); phoneHits.set(ai.phone, a); }
        if (ai.linkedin) { const a = linkedinHits.get(ai.linkedin) ?? []; a.push(label); linkedinHits.set(ai.linkedin, a); }
        if (ai.instagram){ const a = igHits.get(ai.instagram) ?? [];      a.push(label); igHits.set(ai.instagram, a); }
        if (ai.twitter)  { const a = twHits.get(ai.twitter) ?? [];        a.push(label); twHits.set(ai.twitter, a); }
        for (const oc of ai.ownerContacts) {
          aiOwners.push({ name: oc.name, instagram: oc.instagram, twitter: oc.twitter, linkedin: oc.linkedin });
          // Corp entities: owner handles are person-level, never the org's own social
          if (!isCorp) {
            if (oc.instagram) { const a = igHits.get(oc.instagram) ?? []; a.push(`${label}-owner`); igHits.set(oc.instagram, a); }
            if (oc.twitter)   { const a = twHits.get(oc.twitter) ?? [];   a.push(`${label}-owner`); twHits.set(oc.twitter, a); }
          }
          if (oc.linkedin)  { const a = linkedinHits.get(oc.linkedin) ?? []; a.push(`${label}-owner`); linkedinHits.set(oc.linkedin, a); }
        }
        logger.info({ entityId: entity.id, hasEmail: !!ai.email, owners: ai.owners.length, ownerHandles: aiOwners.filter(o => o.instagram || o.twitter).length, source: ai.source }, "Deep-web AI extraction complete");
      }
    } catch (err: any) {
      logger.debug({ err: err?.message }, "Deep-web AI extraction skipped");
    }
  }

  // ── Phase 3.7: Person-hop — fire targeted social queries for discovered owners
  // Each owner name gets 2 queries: "Name" instagram and "Name" site:linkedin.com/in
  // This is how Gemini finds @christoph_cau from "Christophe Caucino" — we now do the same.
  const CORP_SUFFIX_STRIP = /\b(sas|sarl|sa|gmbh|llc|ltd|inc|corp|bv|nv|spa|srl|ag|ab|as|oy)\b\.?/gi;
  const entityShortName = entity.name.replace(CORP_SUFFIX_STRIP, "").trim().slice(0, 40);

  for (const owner of aiOwners.slice(0, 3)) {
    // Skip if AI already found both handles directly
    if (owner.instagram && owner.twitter) continue;
    const firstName = owner.name.split(" ")[0] ?? owner.name;

    const hopQueries = [
      `"${owner.name}" instagram`,
      `"${owner.name}" "${entityShortName}" linkedin contact`,
    ];

    for (const q of hopQueries) {
      try {
        const sr = await duckduckgoSearch(q);
        result.queriesFired++;
        sourceUrlsByLabel.set(`Hop[${firstName}]`, []);
        allSearchText += " " + sr.text.slice(0, 2_000);

        for (const m of (sr.text.match(INSTAGRAM_RE) ?? [])) {
          const clean = m.replace(/\/$/, "");
          // Exclude generic instagram.com/p/ photo links
          if (!clean.includes("/p/") && !clean.includes("/reel/")) {
            const a = igHits.get(clean) ?? []; a.push(`Hop[${firstName}]`); igHits.set(clean, a);
          }
        }
        for (const m of (sr.text.match(TWITTER_RE) ?? [])) {
          const clean = m.replace(/\/$/, "");
          const a = twHits.get(clean) ?? []; a.push(`Hop[${firstName}]`); twHits.set(clean, a);
        }
      } catch { /* skip */ }
      await jitteredDelay(800);
    }
  }

  // ── Phase 4: Pick best-corroborated values ────────────────────────────────
  function pickBest<K extends string>(hits: Map<K, string[]>): [K, string[]] | null {
    let best: K | null = null; let bestCount = 0;
    for (const [k, srcs] of hits.entries()) {
      if (srcs.length > bestCount) { best = k; bestCount = srcs.length; }
    }
    return best ? [best, hits.get(best)!] : null;
  }

  const [bestEmail, emailSrcs]   = pickBest(emailHits) ?? [null, []];
  const [bestPhone, phoneSrcs]   = pickBest(phoneHits) ?? [null, []];
  const [bestLI, liSrcs]         = pickBest(linkedinHits) ?? [null, []];
  const [bestIG, igSrcs]         = pickBest(igHits) ?? [null, []];
  const [bestTW, twSrcs]         = pickBest(twHits) ?? [null, []];

  // Preserve claim-level provenance for the values that can be promoted to the
  // result. Provider labels are only audit metadata; corroboration is computed
  // from the canonical publisher URLs attached here. When a provider returns a
  // value without a claim-level URL, keep the candidate but leave sourceUrl
  // null so it cannot gain false corroboration.
  const now = new Date().toISOString();
  const evidenceFor = (
    vectorType: string,
    value: string | null,
    labels: string[],
  ): CandidateEvidence[] => {
    if (!value) return [];
    return labels.flatMap((label) => {
      const baseLabel = label.replace(/-owner$/, "");
      const urls = sourceUrlsByLabel.get(label) ?? sourceUrlsByLabel.get(baseLabel) ?? [];
      const boundUrls = urls.length ? urls : [null];
      return boundUrls.map((sourceUrl) => ({
        vectorType,
        value,
        source: label,
        sourceUrl,
        extractionMethod: sourceUrl ? "public-search-extraction" : "ai-extraction-without-claim-url",
        confidence: sourceUrl ? 0.4 : 0.25,
        details: { citationBound: Boolean(sourceUrl) },
        observedAt: now,
      }));
    });
  };
  result.evidence = [
    ...evidenceFor("email", bestEmail, emailSrcs),
    ...evidenceFor("phone", bestPhone, phoneSrcs),
    ...evidenceFor("social", bestLI, liSrcs),
    ...evidenceFor("social", bestIG, igSrcs),
    ...evidenceFor("social", bestTW, twSrcs),
  ];

  if (bestEmail) {
    result.email = bestEmail;
    result.emailConfidence = scoreByCorroboration(emailSrcs.length, result.evidence ?? [], bestEmail);
    result.sources.push(...emailSrcs);
  }
  if (bestPhone) {
    result.phone = bestPhone;
    result.phoneConfidence = scoreByCorroboration(phoneSrcs.length, result.evidence ?? [], bestPhone);
    result.sources.push(...phoneSrcs);
  }
  if (bestLI)    { result.linkedinUrl  = bestLI; result.sources.push(...liSrcs); }
  if (bestIG)    { result.instagramUrl = bestIG; result.sources.push(...igSrcs); }
  if (bestTW)    { result.twitterUrl   = bestTW; result.sources.push(...twSrcs); }

  result.personsDiscovered = [...new Set(aiOwners.map(o => o.name))].slice(0, 5);
  result.sources = [...new Set(result.sources)];

  return result;
}
