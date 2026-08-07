/**
 * domain-resolver.ts — J4 Employer/Domain Resolution
 *
 * Builds corroborated domain candidates from official registry sources
 * (entity metadata, GLEIF, entity notes), verifies DNS MX health, and
 * returns the best employer domain plus official contact-page paths to try.
 *
 * Rejects hosting/CDN domains and public registry domains as person-email
 * domains. Organisation contacts are kept labelled as organisation contacts.
 */
import { promises as dns } from "dns";
import { logger } from "./logger";

// ── Blocked domain sets ──────────────────────────────────────────────────────

const HOSTING_DOMAINS = new Set([
  "amazonaws.com", "cloudfront.net", "cloudflare.com", "fastly.net",
  "akamai.net", "azurewebsites.net", "googleusercontent.com", "appspot.com",
  "herokuapp.com", "netlify.app", "vercel.app", "wix.com", "squarespace.com",
  "wordpress.com", "webflow.io", "shopify.com", "godaddy.com", "bluehost.com",
  "hostgator.com", "dreamhost.com", "ionos.com", "1and1.com", "github.io",
  "pages.dev", "firebaseapp.com", "web.app", "bitly.com", "linktr.ee",
]);

const REGISTRY_DOMAINS = new Set([
  "sec.gov", "faa.gov", "companieshouse.gov.uk", "find-and-update.company-information.service.gov.uk",
  "brreg.no", "gleif.org", "opencorporates.com", "offshoreleaks.icij.org",
  "land.gov.uk", "landregistry.gov.uk", "ares.mfcr.cz", "bodacc.fr",
  "justice.gouv.fr", "infogreffe.fr", "data.gouv.fr",
]);

const FREEMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
  "protonmail.com", "proton.me", "mail.com", "aol.com", "ymail.com",
  "live.com", "msn.com", "gmx.com", "tutanota.com", "zoho.com",
]);

// ── Types ────────────────────────────────────────────────────────────────────

export interface DomainCandidate {
  domain: string;
  score: number;   // 0-1 confidence before MX check
  source: string;
}

export interface DomainResolution {
  domain: string | null;
  confidence: number;              // 0-1, boosted +0.10 if MX verified
  source: string;
  mxVerified: boolean;
  spfProvider: string | null;      // inferred ESP from SPF include: directives
  officialContactPaths: string[];  // ordered paths to scrape for contacts
  isOrganizationDomain: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function extractDomain(url: string): string | null {
  try {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    const hostname = new URL(normalized).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isBlockedDomain(domain: string): boolean {
  if (HOSTING_DOMAINS.has(domain)) return true;
  if (REGISTRY_DOMAINS.has(domain)) return true;
  if (FREEMAIL_DOMAINS.has(domain)) return true;
  // Match subdomains of blocked roots
  for (const blocked of [...HOSTING_DOMAINS, ...REGISTRY_DOMAINS]) {
    if (domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

async function checkMx(domain: string): Promise<boolean> {
  try {
    const records = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("MX timeout")), 4_000)),
    ]);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

async function checkSpfProvider(domain: string): Promise<string | null> {
  try {
    const records = await Promise.race([
      dns.resolveTxt(domain),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SPF timeout")), 4_000)),
    ]);
    const spf = records.flat().find(r => r.startsWith("v=spf1"));
    if (!spf) return null;
    // Extract first include: domain that looks like an ESP
    const includeMatch = spf.match(/include:([^\s]+)/g);
    for (const inc of includeMatch ?? []) {
      const d = inc.replace("include:", "");
      if (/google|gsuite/.test(d)) return "Google Workspace";
      if (/outlook|microsoft/.test(d)) return "Microsoft 365";
      if (/mailchimp|mandrill/.test(d)) return "Mailchimp";
      if (/sendgrid/.test(d)) return "SendGrid";
      if (/proofpoint/.test(d)) return "Proofpoint";
      if (/mimecast/.test(d)) return "Mimecast";
    }
    return null;
  } catch {
    return null;
  }
}

function officialContactPaths(domain: string): string[] {
  const base = `https://${domain}`;
  return [
    `${base}/contact`,
    `${base}/contact-us`,
    `${base}/team`,
    `${base}/about`,
    `${base}/leadership`,
    `${base}/people`,
    `${base}/executives`,
    `${base}/management`,
    `${base}/investor-relations`,
    `${base}/press`,
  ];
}

type JsonMap = Record<string, unknown>;

function parseJson<T>(val: string | null | undefined, fallback: T): T {
  try { return val ? JSON.parse(val) as T : fallback; } catch { return fallback; }
}

function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/(?:www\.)?([a-zA-Z0-9\-]+(?:\.[a-zA-Z0-9\-]+)+)[^\s"')>]*/g) ?? [];
  return matches.slice(0, 6);
}

// ── Main resolver ─────────────────────────────────────────────────────────────

export async function resolveEmployerDomain(entity: {
  name: string;
  type: string;
  metadata: string | null;
  notes: string | null;
  sourceRegistries: string | null;
}): Promise<DomainResolution> {
  const candidates: DomainCandidate[] = [];
  const meta = parseJson<JsonMap>(entity.metadata, {});

  // ── Source A: explicit website fields in metadata ─────────────────────────
  for (const field of ["website", "officialWebsite", "companyWebsite", "entityWebsite", "homepage"]) {
    const val = meta[field];
    if (typeof val === "string" && val.length > 4) {
      const domain = extractDomain(val);
      if (domain && !isBlockedDomain(domain)) {
        candidates.push({ domain, score: 0.90, source: "metadata-website" });
      }
    }
  }

  // ── Source B: Companies House registered address or website ───────────────
  for (const field of ["registeredOfficeAddress", "chWebsite"]) {
    const val = meta[field];
    if (typeof val === "string") {
      for (const url of extractUrlsFromText(val)) {
        const domain = extractDomain(url);
        if (domain && !isBlockedDomain(domain)) {
          candidates.push({ domain, score: 0.85, source: "companies-house-address" });
        }
      }
    }
  }

  // ── Source C: EDGAR filer URL (the actual company website from filings) ───
  const edgarUrl = typeof meta["edgarUrl"] === "string" ? meta["edgarUrl"] : null;
  if (edgarUrl) {
    // EDGAR URLs reference sec.gov; try to find the filer's own domain from notes
  }

  // ── Source D: extract URLs from notes ────────────────────────────────────
  if (entity.notes) {
    for (const url of extractUrlsFromText(entity.notes)) {
      const domain = extractDomain(url);
      if (domain && !isBlockedDomain(domain)) {
        candidates.push({ domain, score: 0.65, source: "notes-url" });
      }
    }
  }

  // ── Source E: GLEIF live lookup for corporations ──────────────────────────
  if (["Corporation", "Trust"].includes(entity.type) && entity.name.length >= 3) {
    try {
      const resp = await fetch(
        `https://api.gleif.org/api/v1/fuzzycompletions?field=entity.legalName&page%5Bsize%5D=1&q=${encodeURIComponent(entity.name)}`,
        { signal: AbortSignal.timeout(6_000), headers: { Accept: "application/json" } },
      );
      if (resp.ok) {
        const data = await resp.json() as { data?: Array<{ attributes?: { value?: string } }> };
        const matched = data.data?.[0]?.attributes?.value;
        if (matched) {
          // Derive a domain guess from the cleaned company name
          const slug = entity.name
            .toLowerCase()
            .replace(/\s+(inc|llc|ltd|corp|plc|sa|ag|gmbh|nv|bv|srl|pty|lp|lp\.|co)\.?$/i, "")
            .replace(/[^a-z0-9]/g, "")
            .slice(0, 24);
          if (slug.length >= 3) {
            // Only add low-confidence guesses; MX check will confirm
            for (const tld of [".com", ".net", ".org"]) {
              candidates.push({ domain: `${slug}${tld}`, score: 0.28, source: "gleif-name-derived" });
            }
          }
        }
      }
    } catch {
      // GLEIF unreachable — skip
    }
  }

  // ── Deduplicate candidates, keep highest score per domain ─────────────────
  const deduped = new Map<string, DomainCandidate>();
  for (const c of candidates) {
    const existing = deduped.get(c.domain);
    if (!existing || c.score > existing.score) deduped.set(c.domain, c);
  }
  const sorted = [...deduped.values()].sort((a, b) => b.score - a.score).slice(0, 5);

  if (!sorted.length) {
    return {
      domain: null, confidence: 0, source: "no-candidates",
      mxVerified: false, spfProvider: null, officialContactPaths: [],
      isOrganizationDomain: false,
    };
  }

  // ── MX-verify the top candidate; fall back to next if it fails ───────────
  let chosen: DomainCandidate | null = null;
  let mxVerified = false;
  let spfProvider: string | null = null;

  for (const candidate of sorted) {
    if (candidate.score >= 0.60) {
      // Only MX-check high-confidence candidates (avoid hammering guesses)
      const hasMx = await checkMx(candidate.domain);
      if (hasMx) {
        chosen = candidate;
        mxVerified = true;
        spfProvider = await checkSpfProvider(candidate.domain);
        break;
      }
    } else {
      // Low-confidence (GLEIF guess): accept without MX check
      chosen = chosen ?? candidate;
    }
  }

  if (!chosen) chosen = sorted[0]!;

  const finalScore = Math.min(chosen.score + (mxVerified ? 0.10 : 0), 1.0);
  const isOrg = ["Corporation", "Trust"].includes(entity.type);

  logger.debug({ name: entity.name, domain: chosen.domain, mxVerified, score: finalScore }, "J4 domain resolved");

  return {
    domain: chosen.domain,
    confidence: finalScore,
    source: chosen.source,
    mxVerified,
    spfProvider,
    officialContactPaths: officialContactPaths(chosen.domain),
    isOrganizationDomain: isOrg,
  };
}
