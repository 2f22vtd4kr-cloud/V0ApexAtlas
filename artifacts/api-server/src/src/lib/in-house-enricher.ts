/**
 * In-House OSINT Enricher v2 — World-Class Hybrid Intelligence Engine
 *
 * Zero paid APIs. Deterministic TypeScript. 20 free public sources.
 *
 * Module A — Knowledge Graphs
 *   1. Wikidata SPARQL (enhanced: email, website, LinkedIn, phone, employer, nationality)
 *   2. Wikipedia page summary (enhanced: email + LinkedIn extraction)
 *   3. ORCID public API  (academic / researcher profiles)
 *
 * Module B — Code & Tech
 *   4. GitHub API  (full name search → public email, blog, company)
 *
 * Module C — Corporate Registries
 *   5. GLEIF LEI Registry  (global legal entity data: address, jurisdiction, status)
 *   6. SEC EDGAR EFTS  (full-text filing search: entity contact info)
 *   7. UK Companies House  (officer registered addresses — uses COMPANIES_HOUSE_API_KEY)
 *   8. ProPublica Nonprofit 990  (US nonprofit executives)
 *
 * Module D — Domain Intelligence
 *   9.  DNS MX validation      (confirm domain accepts email)
 *  10.  DNS SPF / TXT analysis (email provider heuristic, include: domain extraction)
 *  11.  RDAP domain contact    (ICANN RDAP registrant email)
 *  12.  crt.sh certificate transparency  (SAN email fields in SSL certs)
 *  13.  Wayback Machine CDX    (archived contact pages → email extraction)
 *
 * Module E — Email Discovery
 *  14.  Email pattern generation  (12 patterns: first.last / flast / f.last / …)
 *  15.  Gravatar MD5 verification (hash → 200 = confirmed account)
 *  16.  SMTP port-25 verification (RCPT TO handshake — graceful fallback if blocked)
 *
 * Module F — Social & Web
 *  17.  DuckDuckGo HTML search  (site:linkedin.com/in/ "NAME" → LinkedIn URL)
 *  18.  DuckDuckGo Instant Answer (web presence, AbstractURL)
 *  19.  News email extraction    (DuckDuckGo News snippets for email mentions)
 *  20.  Company contact page scraper  (direct website /contact, /about, /team)
 */

import { createHash } from "crypto";
import { promises as dns } from "dns";
import * as net from "net";
import { logger } from "./logger";
import { isValidPublicEmail, sanitizePublicEmail, isGenericEmailPrefix, REGISTRAR_DOMAINS, normalizePhone } from "./contact-validation";
import { enrichWithIcij, summariseIcijFindings } from "./icij-enricher";
import { enrichWithWhoxy, summariseWhoxyFindings } from "./whoxy-enricher";

// ─── Result / Input types ─────────────────────────────────────────────────────

export interface InHouseEnrichResult {
  email:           string | null;
  linkedinUrl:     string | null;
  phone:           string | null;
  website:         string | null;
  twitter:         string | null;
  address:         string | null;  // business/registered address (BRREG, EDGAR, CH)
  sources:         string[];
  emailConfidence: number;   // 0-100
  phoneConfidence: number;   // 0-100
  sourceHits:      Record<string, boolean>;  // per-source hit tracking
  evidence:        InHouseEvidence[];
  // K2/L1: generic-prefix flag — set when the winning email is an org inbox
  hasGenericEmail?: boolean;
  // K5: source labels for org-contact classification in computeContactOutcome
  emailSource?: string | null;
  phoneSource?: string | null;
  // SMTP proves mailbox delivery only; it does not attribute the address to
  // the named person and therefore never creates verified contact state.
  smtpVerified?: boolean;
  // Phase L: extended OSINT sources
  icijFindings?: { totalMatches: number; sources: string[]; summary: string | null };
  whoxyDomains?: { totalUnique: number; domains: Array<{ domain_name: string; create_date?: string }>; summary: string | null };
}

export interface InHouseEvidence {
  vectorType: "email" | "phone" | "social" | "website" | "address" | "domain";
  value: string;
  source: string;
  sourceUrl: string | null;
  extractionMethod: string;
  confidence: number;
  observedAt: string;
  details?: Record<string, unknown>;
}

export interface InHouseEnrichInput {
  id:               number;
  name:             string;
  type:             string;
  nationality?:     string | null;
  sourceRegistries?: string | null;
  knownResidences?:  string | null;
  metadata?:         string | null;
  notes?:            string | null;
  // Extracted from metadata before calling enrichInHouse
  bizLocation?:      string | null;   // e.g. "New York, NY" — for geo-narrowing LinkedIn/DDG
  entityName?:       string | null;   // canonical name from source registry (may differ from stored name)
}

// ─── Shared utilities ─────────────────────────────────────────────────────────

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ApexFinder-OSINT/2.0; Research platform; +https://apexfinder.private)",
  Accept: "application/json",
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

function timeout(ms: number) { return AbortSignal.timeout(ms); }
async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function safeJson<T>(str: string | null | undefined, fallback: T): T {
  try { return str ? JSON.parse(str) as T : fallback; } catch { return fallback; }
}

// Normalise ALL-CAPS LAST FIRST (FAA/EDGAR format) → Title Case First Last
function normaliseName(raw: string): string {
  const t = raw.trim();
  if (t !== t.toUpperCase() || !/[A-Z]{2}/.test(t)) return t;
  const parts = t.split(/\s+/);
  if (parts.length < 2) return t.charAt(0) + t.slice(1).toLowerCase();
  const titleCase = (s: string) =>
    s.length <= 2 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const [last, ...rest] = parts as [string, ...string[]];
  return [...rest, last].map(titleCase).join(" ");
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1]! };
}

// ── I1: LLC Beneficial Owner Resolution ──────────────────────────────────────
// FAA aviation LLCs ("John Smith Aviation LLC") are registered to the company, not the person.
// This function tries to find the individual behind the LLC via two free sources:
// 1. SEC EDGAR EFTS — who filed SC 13D/G mentioning this LLC name?
// 2. OpenCorporates free tier — get directors/officers of the company
async function resolveBeneficialOwner(llcName: string): Promise<string | null> {
  // Only worth trying for LLC-pattern names
  if (!/\b(llc|lp|lc|inc|corp|aviation|air|charter|holdings?|capital|equit|invest|aero|flight|sky|jet)\b/i.test(llcName)) return null;

  // Step 1: SEC EDGAR full-text search — who filed about this company?
  try {
    const q = `"${llcName.replace(/"/g, "")}"`;
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=SC+13D,SC+13G,DEF+14A&dateRange=custom&startdt=2015-01-01&enddt=2026-12-31`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "ApexFinder Research research@apexfinder.private", Accept: "application/json" },
    });
    if (resp.ok) {
      const data = await resp.json() as any;
      const hits: any[] = data?.hits?.hits ?? [];
      for (const hit of hits.slice(0, 10)) {
        const entityName: string = hit?._source?.entity_name ?? "";
        // Individual name: ≥2 words, starts with capital, no corporate suffixes
        if (
          entityName.length > 3 &&
          /^[A-Z][a-z]/.test(entityName) &&
          !/\b(llc|lp|lc|inc|corp|fund|trust|ltd|plc|bank|group|capital|partners|management|investments?|holdings?|company|enterprises?|foundation|association)\b/i.test(entityName)
        ) {
          const words = entityName.trim().split(/\s+/);
          if (words.length >= 2 && words.length <= 4) return entityName;
        }
      }
    }
  } catch { /* graceful skip — EDGAR may be unavailable */ }

  // Step 2: OpenCorporates free tier — get officers/directors
  try {
    const url = `https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(llcName)}&country_code=us&per_page=3`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "ApexFinder Research research@apexfinder.private", Accept: "application/json" },
    });
    if (resp.ok) {
      const data = await resp.json() as any;
      const companies: any[] = data?.results?.companies ?? [];
      for (const { company } of companies.slice(0, 2)) {
        const officers: any[] = company?.officers ?? [];
        for (const { officer } of officers) {
          const n: string = officer?.name ?? "";
          if (n && /^[A-Z][a-z]/.test(n) && !/\b(llc|lp|inc|corp|ltd)\b/i.test(n)) {
            const words = n.trim().split(/\s+/);
            if (words.length >= 2 && words.length <= 4) return n;
          }
        }
      }
    }
  } catch { /* graceful skip */ }

  return null;
}

// ── I4: Enrichment Tier Classification ────────────────────────────────────────
// Tier 1 — EDGAR/public (BRREG, CH, GLEIF): full 20-source pass. Public filings = Wikidata/Wikipedia hits.
// Tier 2 — FAA individual: skip knowledge graphs (private aircraft owners aren't on Wikidata/GitHub).
//           Focus on DDG-LinkedIn, DNS/RDAP/email-patterns which work for private HNWIs.
// Tier 3 — FAA corporation: resolve beneficial owner (I1) first, then Tier 2 on the person name.
function enrichmentTier(entity: InHouseEnrichInput): 1 | 2 | 3 {
  const srcs = entity.sourceRegistries?.toLowerCase() ?? "";
  const isFAA = srcs.includes("faa") || srcs.includes("aircraft") || srcs.includes("n-number");
  if (!isFAA) return 1; // EDGAR, HMLR, BRREG, CH — full public pass
  if (entity.type === "Corporation" || entity.type === "Trust") return 3; // LLC → resolve person first
  return 2; // FAA individual — skip knowledge graphs
}

// Email blocklist — domains that are never real contact emails
const EMAIL_BLOCK = new Set([
  "example.com", "domain.com", "email.com", "test.com", "foo.com", "bar.com",
  "noreply.com", "no-reply.com", "invalid.com", "localhost", "sample.com",
  "placeholder.com", "yourname.com", "company.com", "yourdomain.com",
  "privacy.com", "domains.com", "registrant.com", "whoisguard.com",
  "domainsbyproxy.com", "privacyprotect.org", "whoisprivacycorp.com",
  "duckduckgo.com", "bing.com", "google.com", "search.yahoo.com",
  // Financial data aggregators / news wires
  "stocktitan.net", "seekingalpha.com", "benzinga.com", "thestreet.com",
  "marketwatch.com", "businesswire.com", "prnewswire.com", "globenewswire.com",
  "accesswire.com", "investopedia.com", "fool.com", "cnbc.com",
  "crunchbase.com", "pitchbook.com", "owler.com", "dnb.com",
  "morningstar.com", "simplywall.st", "stockanalysis.com", "finviz.com",
  "macroaxis.com", "zacks.com", "wisesheets.io",
]);
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

function extractEmail(text: string): string | null {
  const matches = [...text.matchAll(EMAIL_RE)].map(m => m[0]!.toLowerCase());
  return matches.find(e => {
    const d = e.split("@")[1] ?? "";
    return isValidPublicEmail(e) && !EMAIL_BLOCK.has(d) && e.length < 80;
  }) ?? null;
}

function extractAllEmails(text: string): string[] {
  const matches = [...text.matchAll(EMAIL_RE)].map(m => m[0]!.toLowerCase());
  return [...new Set(matches.filter(e => {
    const d = e.split("@")[1] ?? "";
    return isValidPublicEmail(e) && !EMAIL_BLOCK.has(d) && e.length < 80;
  }))];
}

function extractLinkedIn(text: string): string | null {
  const m = text.match(/https?:\/\/(www\.)?linkedin\.com\/(in|pub|company)\/[a-zA-Z0-9\-_%]+\/?/i);
  return m ? m[0]!.replace(/\/$/, "") : null;
}

function extractPhone(text: string): string | null {
  // E.164 / US / international formats
  const patterns = [
    /\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?[\s.\-]?\d{1,4}[\s.\-]?\d{1,9}/,
    /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const cleaned = m[0]!.replace(/\s+/g, " ").trim();
      if (cleaned.replace(/\D/g, "").length >= 7) return cleaned;
    }
  }
  return null;
}

// Strip stock ticker symbols: "Aramark (ARMK)" → "Aramark", "Global Ind Co (GIC)" → "Global Ind Co"
function stripTicker(name: string): string {
  return name.replace(/\s*\([A-Z]{1,6}(?:,\s*[A-Z]{1,6})?\)\s*$/, "").trim();
}

// Strip legal suffixes for domain guessing
const CORP_SUFFIXES = /\b(inc|llc|ltd|limited|corp|corporation|group|holdings|international|global|capital|fund|partners|advisors?|management|services|solutions|ventures|investments?|enterprises?|associates?|consulting|technologies|tech|financial|realty|properties|trust|family|l\.?p\.?|s\.?a\.?)\b\.?$/gi;

function guessCompanyDomain(companyName: string, city?: string | null): string[] {
  const stripped = companyName.replace(CORP_SUFFIXES, "").trim();
  const base = stripped.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, "");
  const hyphen = stripped.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, "-");
  if (!base || base.length < 2) return [];
  const standard = [
    `${base}.com`, `${hyphen}.com`, `${base}.co`, `${base}.io`,
    `${base}.org`, `${base}.net`, `${base}.co.uk`,
  ];
  if (city) {
    const c = city.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (c.length >= 2) {
      // City variants first — most likely to be the real domain (e.g. baolicannes.com)
      standard.unshift(`${base}${c}.com`, `${hyphen}-${c}.com`, `${base}-${c}.com`);
    }
  }
  return [...new Set(standard)].slice(0, 8);
}

// Domains that belong to registries / governments — NEVER use as email domain for individuals
const BLOCKED_DOMAINS = new Set([
  "sec.gov", "edgar.gov", "efts.sec.gov", "data.sec.gov",
  "companieshouse.gov.uk", "gov.uk", "hmrc.gov.uk", "landregistry.gov.uk", "hmlr.gov.uk",
  "gleif.org", "lei-lookup.com", "opencorporates.com",
  "faa.gov", "registry.faa.gov", "av-info.faa.gov",
  "irs.gov", "treasury.gov", "federalreserve.gov",
  "europa.eu", "ecb.europa.eu",
  "aleph.occrp.org", "occrp.org",
  "wikidata.org", "wikipedia.org", "wikimedia.org",
  "orcid.org", "doi.org", "github.com", "gravatar.com",
  "linkedin.com", "twitter.com", "facebook.com", "google.com",
]);

function domainFromMeta(metadata?: string | null, notes?: string | null): string | null {
  const meta = safeJson<Record<string, unknown>>(metadata, {});
  // Explicit domain/website set by prior enrichment passes
  if (typeof meta["domain"] === "string" && meta["domain"]) {
    const d = meta["domain"] as string;
    if (!BLOCKED_DOMAINS.has(d)) return d;
  }
  if (typeof meta["website"] === "string") {
    const m = (meta["website"] as string).match(/^https?:\/\/(?:www\.)?([a-z0-9.\-]+)/i);
    if (m && !BLOCKED_DOMAINS.has(m[1]!)) return m[1]!;
  }
  // Do NOT scan raw metadata for URLs — it will find registry URLs (edgarUrl, CH URL, etc.)
  // Only use the explicit domain/website fields above
  return null;
}


// ═══════════════════════════════════════════════════════════════════════════════
// MODULE A — KNOWLEDGE GRAPHS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Source 1: Wikidata SPARQL (enhanced) ─────────────────────────────────────
interface WikidataResult {
  entityUrl: string | null;
  email: string | null;
  website: string | null;
  linkedinUrl: string | null;
  twitter: string | null;
  phone: string | null;
  employer: string | null;
}

async function queryWikidata(name: string): Promise<WikidataResult | null> {
  const sparql = `
 SELECT ?person ?email ?website ?linkedin ?twitter ?phone ?employerLabel WHERE {
  ?person wdt:P31 wd:Q5;
          rdfs:label "${name.replace(/"/g, "")}"@en.
  OPTIONAL { ?person wdt:P968 ?email. }
  OPTIONAL { ?person wdt:P856 ?website. }
  OPTIONAL { ?person wdt:P6634 ?linkedin. }
  OPTIONAL { ?person wdt:P2002 ?twitter. }
  OPTIONAL { ?person wdt:P1329 ?phone. }
  OPTIONAL { ?person wdt:P108 ?employer.
              ?employer rdfs:label ?employerLabel. FILTER(LANG(?employerLabel)="en") }
} LIMIT 5`;
  try {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    const resp = await fetch(url, {
      signal: timeout(15_000),
      headers: { ...HEADERS, Accept: "application/sparql-results+json" },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const bindings: any[] = data?.results?.bindings ?? [];
    if (!bindings.length) return null;
    const b = bindings[0];
    return {
      entityUrl:   b?.person?.value ?? null,
      email:       b?.email?.value ?? null,
      website:     b?.website?.value ?? null,
      linkedinUrl: b?.linkedin?.value ? `https://www.linkedin.com/in/${b.linkedin.value}` : null,
      twitter:     b?.twitter?.value ? `https://twitter.com/${b.twitter.value}` : null,
      phone:       b?.phone?.value ?? null,
      employer:    b?.employerLabel?.value ?? null,
    };
  } catch (err: any) {
    logger.debug({ err: err.message }, "Wikidata SPARQL failed");
    return null;
  }
}

// Also search Wikidata as a corporation (wdt:P31 wd:Q4830453)
async function queryWikidataCorp(name: string): Promise<{ website: string | null; address: string | null } | null> {
  const sparql = `
SELECT ?website ?addressLabel WHERE {
  { ?org wdt:P31/wdt:P279* wd:Q4830453. } UNION { ?org wdt:P31/wdt:P279* wd:Q891723. }
  ?org rdfs:label "${name.replace(/"/g, "")}"@en.
  OPTIONAL { ?org wdt:P856 ?website. }
  OPTIONAL { ?org wdt:P6375 ?address. }
} LIMIT 3`;
  try {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
    const resp = await fetch(url, { signal: timeout(12_000), headers: { ...HEADERS, Accept: "application/sparql-results+json" } });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const bindings: any[] = data?.results?.bindings ?? [];
    if (!bindings.length) return null;
    const b = bindings[0];
    return { website: b?.website?.value ?? null, address: b?.addressLabel?.value ?? null };
  } catch {
    return null;
  }
}

// ── Source 2: Wikipedia abstract (enhanced) ───────────────────────────────────
async function queryWikipedia(name: string): Promise<{ extract: string; website: string | null } | null> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, "_"))}`;
    const resp = await fetch(url, { signal: timeout(10_000), headers: HEADERS });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    return {
      extract: data?.extract ?? "",
      website: data?.content_urls?.desktop?.page ?? null,
    };
  } catch {
    return null;
  }
}

// ── Source 3: ORCID — academic / researcher profiles ─────────────────────────
interface ORCIDResult {
  email: string | null;
  orcidId: string | null;
  website: string | null;
  affiliation: string | null;
  recordUrl: string | null;
}

async function queryORCID(firstName: string, lastName: string): Promise<ORCIDResult | null> {
  try {
    const q = `family-name:${encodeURIComponent(lastName)}+AND+given-names:${encodeURIComponent(firstName)}`;
    const resp = await fetch(`https://pub.orcid.org/v3.0/search/?q=${q}&rows=3`, {
      signal: timeout(10_000),
      headers: { ...HEADERS, Accept: "application/json" },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const results: any[] = data?.result ?? [];
    if (!results.length) return null;

    const orcidPath = results[0]?.["orcid-identifier"]?.path;
    if (!orcidPath) return null;

    // Fetch full person record
    const profileResp = await fetch(`https://pub.orcid.org/v3.0/${orcidPath}/person`, {
      signal: timeout(8_000),
      headers: { ...HEADERS, Accept: "application/json" },
    });
    const profile = profileResp.ok ? await profileResp.json() as any : null;
    const emails: any[] = profile?.emails?.email ?? [];
    const primaryEmail = emails.find((e: any) => e?.primary && e?.visibility === "PUBLIC")?.email
      ?? emails.find((e: any) => e?.visibility === "PUBLIC")?.email
      ?? null;
    const urls: any[] = profile?.["researcher-urls"]?.["researcher-url"] ?? [];
    const website = urls.find((u: any) => u?.["url"]?.value)?.["url"]?.value ?? null;
    const affiliations: any[] = profile?.affiliations?.affiliation ?? [];
    const affiliation = affiliations[0]?.organization?.name ?? null;

    return {
      email: primaryEmail,
      orcidId: orcidPath,
      website,
      affiliation,
      recordUrl: `https://orcid.org/${orcidPath}`,
    };
  } catch (err: any) {
    logger.debug({ err: err.message }, "ORCID lookup failed");
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// MODULE B — CODE & TECH
// ═══════════════════════════════════════════════════════════════════════════════

// ── Source 4: GitHub API (enhanced) ──────────────────────────────────────────
interface GitHubResult {
  email: string | null;
  blog: string | null;
  htmlUrl: string | null;
  company: string | null;
  location: string | null;
}

async function queryGitHub(name: string): Promise<GitHubResult | null> {
  try {
    const searchUrl = `https://api.github.com/search/users?q=${encodeURIComponent(name)}+in:fullname&per_page=5`;
    const searchResp = await fetch(searchUrl, {
      signal: timeout(12_000),
      headers: { ...HEADERS, Accept: "application/vnd.github+json" },
    });
    if (!searchResp.ok) return null;
    const searchData = await searchResp.json() as any;
    const items: any[] = searchData?.items ?? [];

    for (const item of items.slice(0, 3)) {
      const profileResp = await fetch(item.url, {
        signal: timeout(8_000),
        headers: { ...HEADERS, Accept: "application/vnd.github+json" },
      });
      if (!profileResp.ok) continue;
      const p = await profileResp.json() as any;
      if (p?.email || p?.blog || p?.company) {
        return {
          email:    p.email ?? null,
          blog:     p.blog ?? null,
          htmlUrl:  p.html_url ?? null,
          company:  p.company ?? null,
          location: p.location ?? null,
        };
      }
      await sleep(150);
    }
    return null;
  } catch (err: any) {
    logger.debug({ err: err.message }, "GitHub search failed");
    return null;
  }
}


/**
 * M2: Social second-pass — fetch a GitHub user's public profile directly by handle.
 * Used when an entity already has a known GitHub URL from a prior enrichment pass
 * (stored in metadata.githubUrl) but still has no email.
 */
async function queryGitHubByHandle(handle: string): Promise<GitHubResult | null> {
  try {
    const resp = await fetch(`https://api.github.com/users/${encodeURIComponent(handle)}`, {
      signal: timeout(10_000),
      headers: { ...HEADERS, Accept: "application/vnd.github+json" },
    });
    if (!resp.ok) return null;
    const p = await resp.json() as any;
    if (!p?.login) return null;
    return {
      email:    p.email   ?? null,
      blog:     p.blog    ?? null,
      htmlUrl:  p.html_url ?? null,
      company:  p.company ?? null,
      location: p.location ?? null,
    };
  } catch (err: any) {
    logger.debug({ err: err.message, handle }, "GitHub handle fetch failed");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODULE C — CORPORATE REGISTRIES
// ═══════════════════════════════════════════════════════════════════════════════

// ── Source 5: GLEIF LEI Registry ─────────────────────────────────────────────
interface GLEIFResult {
  lei: string;
  legalName: string;
  address: string | null;
  city: string | null;
  country: string | null;
  jurisdiction: string | null;
  status: string | null;
  registrationDate: string | null;
}

async function queryGLEIF(companyName: string): Promise<GLEIFResult | null> {
  try {
    const url = `https://api.gleif.org/api/v1/lei-records?filter[fulltext]=${encodeURIComponent(companyName)}&page[size]=3`;
    const resp = await fetch(url, {
      signal: timeout(12_000),
      headers: { ...HEADERS, Accept: "application/vnd.api+json" },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const records: any[] = data?.data ?? [];
    if (!records.length) return null;

    // Pick best match by fuzzy name similarity
    const r = records[0];
    const attrs = r?.attributes ?? {};
    const legalAddr = attrs?.entity?.legalAddress ?? {};
    const lines: string[] = legalAddr.addressLines ?? [];

    return {
      lei:              r.id,
      legalName:        attrs?.entity?.legalName?.name ?? companyName,
      address:          lines.join(", ") || null,
      city:             legalAddr.city ?? null,
      country:          legalAddr.country ?? null,
      jurisdiction:     attrs?.entity?.jurisdiction ?? null,
      status:           attrs?.entity?.status ?? null,
      registrationDate: attrs?.registration?.initialRegistrationDate ?? null,
    };
  } catch (err: any) {
    logger.debug({ err: err.message }, "GLEIF lookup failed");
    return null;
  }
}

// ── Source 6: SEC EDGAR EFTS full-text search ─────────────────────────────────
interface EDGARResult {
  companyName: string | null;
  cik: string | null;
  filingType: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  recordUrl: string | null;
}

async function queryEDGAR(name: string): Promise<EDGARResult | null> {
  try {
    // Full-text search in SEC filings for the entity name
    const q = `"${name.replace(/"/g, "")}"`;
    const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&dateRange=custom&startdt=2020-01-01&enddt=2026-12-31`;
    const resp = await fetch(url, {
      signal: timeout(15_000),
      headers: {
        "User-Agent": "ApexFinder Research research@apexfinder.private",
        Accept: "application/json",
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const hits: any[] = data?.hits?.hits ?? [];
    if (!hits.length) return null;

    const hit = hits[0]?._source;
    const ciks: string[] = hit?.ciks ?? [];
    if (!ciks.length) return null;

    // Fetch company facts to find address/phone
    const cik = ciks[0]!.replace(/^0+/, "");
    const factsResp = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, {
      signal: timeout(10_000),
      headers: { "User-Agent": "ApexFinder Research research@apexfinder.private", Accept: "application/json" },
    });
    if (!factsResp.ok) {
      return {
        companyName: hit?.entity_name ?? null,
        cik,
        filingType: hit?.form_type ?? null,
        email: null,
        phone: null,
        address: null,
        recordUrl: `https://www.sec.gov/edgar/browse/?CIK=${cik}`,
      };
    }
    const facts = await factsResp.json() as any;
    const bizAddr = facts?.addresses?.business ?? {};
    const addressParts = [bizAddr.street1, bizAddr.street2, bizAddr.city, bizAddr.stateOrCountry, bizAddr.zipCode].filter(Boolean);

    return {
      companyName: facts?.name ?? hit?.entity_name ?? null,
      cik,
      filingType:  hit?.form_type ?? null,
      email:       null,  // SEC filings rarely have email in structured form
      phone:       facts?.phone ?? null,
      address:     addressParts.length ? addressParts.join(", ") : null,
      recordUrl:   `https://www.sec.gov/edgar/browse/?CIK=${cik}`,
    };
  } catch (err: any) {
    logger.debug({ err: err.message }, "EDGAR EFTS search failed");
    return null;
  }
}

// ── Source 7: UK Companies House ─────────────────────────────────────────────
interface CHResult {
  companyNumber: string | null;
  companyName: string | null;
  address: string | null;
  status: string | null;
  officerEmails: string[];
  officerPhone: string | null;
  recordUrl: string | null;
}

async function queryCompaniesHouse(companyName: string): Promise<CHResult | null> {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) return null;

  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const headers = { Authorization: `Basic ${auth}`, Accept: "application/json" };

  try {
    const searchResp = await fetch(
      `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=3`,
      { signal: timeout(10_000), headers }
    );
    if (!searchResp.ok) return null;
    const searchData = await searchResp.json() as any;
    const items: any[] = searchData?.items ?? [];
    if (!items.length) return null;

    const co = items[0];
    const companyNumber = co?.company_number;
    if (!companyNumber) return null;

    const addr = co?.address ?? {};
    const addressParts = [addr.premises, addr.address_line_1, addr.address_line_2, addr.locality, addr.postal_code].filter(Boolean);

    // Fetch officers to find contact emails in correspondence addresses
    const officersResp = await fetch(
      `https://api.company-information.service.gov.uk/company/${companyNumber}/officers?items_per_page=5`,
      { signal: timeout(10_000), headers }
    );
    const officersData = officersResp.ok ? await officersResp.json() as any : null;
    const officers: any[] = officersData?.items ?? [];
    const officerEmails: string[] = [];
    let officerPhone: string | null = null;
    for (const officer of officers) {
      const corrAddr = officer?.correspondence_address ?? {};
      const email = corrAddr?.email ?? null;
      if (email && !EMAIL_BLOCK.has(email.split("@")[1] ?? "")) officerEmails.push(email.toLowerCase());
      if (!officerPhone && corrAddr?.phone) officerPhone = corrAddr.phone;
    }

    return {
      companyNumber,
      companyName: co?.title ?? companyName,
      address: addressParts.length ? addressParts.join(", ") : null,
      status: co?.company_status ?? null,
      officerEmails,
      officerPhone,
      recordUrl: `https://find-and-update.company-information.service.gov.uk/company/${companyNumber}`,
    };
  } catch (err: any) {
    logger.debug({ err: err.message }, "Companies House search failed");
    return null;
  }
}

// ── Source 7b: BRREG Enhetsregisteret — Norwegian company registry ────────────
// For BRREG-ingested individuals, orgnr is stored in entity metadata.
// Free API, no auth, returns phone + website for any Norwegian registered entity.
interface BRREGResult {
  phone: string | null;
  website: string | null;
  address: string | null;
  recordUrl: string | null;
}

async function queryBRREG(orgnr: string): Promise<BRREGResult | null> {
  try {
    const url = `https://data.brreg.no/enhetsregisteret/api/enheter/${orgnr.replace(/\D/g, "")}`;
    const resp = await fetch(url, { signal: timeout(10_000), headers: { Accept: "application/json", "User-Agent": HEADERS["User-Agent"] } });
    if (!resp.ok) return null;
    const d = await resp.json() as any;
    const phone: string | null = d?.telefon ?? null;
    const website: string | null = d?.hjemmeside ?? null;
    const pa = d?.postadresse ?? d?.forretningsadresse ?? null;
    const addrParts = [(pa?.adresse?.[0] ?? null), pa?.poststed, pa?.landkode].filter(Boolean);
    return { phone, website, address: addrParts.length ? addrParts.join(", ") : null, recordUrl: url };
  } catch (err: any) {
    logger.debug({ err: err.message }, "BRREG lookup failed");
    return null;
  }
}

// ── Source 8: ProPublica Nonprofit Explorer ───────────────────────────────────
async function queryProPublica(name: string): Promise<{ email: string | null; website: string | null; phone: string | null; recordUrl: string | null } | null> {
  try {
    const url = `https://projects.propublica.org/nonprofits/api/v2/search.json?q=${encodeURIComponent(name)}&page=0`;
    const resp = await fetch(url, { signal: timeout(10_000), headers: HEADERS });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const orgs: any[] = data?.organizations ?? [];
    if (!orgs.length) return null;

    const org = orgs[0];
    const website: string | null = org?.website ?? null;
    const phone: string | null = org?.phone ?? null;
    let email: string | null = null;

    let extractedFromUrl: string | null = null;
    if (website) {
      try {
        const pages = [website, `${website.replace(/\/$/, "")}/contact`, `${website.replace(/\/$/, "")}/about`];
        for (const page of pages) {
          const pageResp = await fetch(page, {
            signal: timeout(8_000),
            headers: { "User-Agent": BROWSER_HEADERS["User-Agent"], Accept: "text/html" },
          });
          if (!pageResp.ok) continue;
          const html = await pageResp.text();
          const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 8000);
          email = extractEmail(text);
           if (email) {
             extractedFromUrl = page;
             break;
           }
        }
      } catch { /* ignore */ }
    }

    const recordUrl = org?.ein
      ? `https://projects.propublica.org/nonprofits/organizations/${org.ein}`
      : extractedFromUrl;
    return { email, website, phone, recordUrl };
  } catch (err: any) {
    logger.debug({ err: err.message }, "ProPublica search failed");
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// MODULE D — DOMAIN INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════════

// ── Source 9: DNS MX validation ──────────────────────────────────────────────
async function hasMxRecord(domain: string): Promise<boolean> {
  try {
    const records = await dns.resolveMx(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

async function getMxHosts(domain: string): Promise<string[]> {
  try {
    const records = await dns.resolveMx(domain);
    return records.sort((a, b) => a.priority - b.priority).map(r => r.exchange);
  } catch {
    return [];
  }
}

// ── Source 10: DNS SPF / TXT analysis ────────────────────────────────────────
interface SPFAnalysis {
  hasEmail: boolean;
  provider: string | null;    // e.g. "Google Workspace", "Microsoft 365", "Outlook"
  includesDomains: string[];  // additional sender domains
}

async function analyseSPF(domain: string): Promise<SPFAnalysis> {
  const result: SPFAnalysis = { hasEmail: false, provider: null, includesDomains: [] };
  try {
    const records = await dns.resolveTxt(domain);
    const spfRecord = records.flat().find(r => r.startsWith("v=spf1"));
    if (!spfRecord) return result;

    result.hasEmail = true;

    // Detect email provider from include directives
    const includes = [...spfRecord.matchAll(/include:([^\s]+)/g)].map(m => m[1]!);
    result.includesDomains = includes;

    if (includes.some(i => i.includes("google") || i.includes("gmail"))) result.provider = "Google Workspace";
    else if (includes.some(i => i.includes("outlook") || i.includes("microsoft") || i.includes("protection.outlook"))) result.provider = "Microsoft 365";
    else if (includes.some(i => i.includes("sendgrid"))) result.provider = "SendGrid";
    else if (includes.some(i => i.includes("mailchimp") || i.includes("mandrill"))) result.provider = "Mailchimp";
    else if (includes.some(i => i.includes("amazonses"))) result.provider = "Amazon SES";
    else if (includes.some(i => i.includes("zendesk"))) result.provider = "Zendesk";

    return result;
  } catch {
    return result;
  }
}

// ── Source 11: RDAP domain contact (enhanced) ─────────────────────────────────
async function rdapLookup(domain: string): Promise<{ email: string | null; org: string | null; phone: string | null; sourceUrl: string | null }> {
  try {
    const tld = domain.split(".").pop() ?? "com";
    const bootstrapResp = await fetch("https://data.iana.org/rdap/dns.json", {
      signal: timeout(6_000), headers: HEADERS,
    });
    let rdapBase = `https://rdap.verisign.com/${tld}/v1`;
    if (bootstrapResp.ok) {
      const bootstrap = await bootstrapResp.json() as any;
      const services: [string[], string[]][] = bootstrap?.services ?? [];
      for (const [tlds, urls] of services) {
        if (tlds.includes(tld) && urls[0]) { rdapBase = urls[0]!.replace(/\/$/, ""); break; }
      }
    }

    const resp = await fetch(`${rdapBase}/domain/${domain}`, { signal: timeout(10_000), headers: HEADERS });
    const sourceUrl = `${rdapBase}/domain/${domain}`;
    if (!resp.ok) return { email: null, org: null, phone: null, sourceUrl };
    const data = await resp.json() as any;

    let email: string | null = null;
    let org: string | null = null;
    let phone: string | null = null;

    const entities: any[] = data?.entities ?? [];
    for (const entity of entities) {
      const vcard: any[][] = entity?.vcardArray?.[1] ?? [];
      for (const entry of vcard) {
        if (entry[0] === "email" && typeof entry[3] === "string") {
          const e = entry[3].toLowerCase();
          if (!e.includes("abuse") && !e.includes("privacy") && !e.includes("proxy") && e.includes("@")) {
            email = e; break;
          }
        }
        if (entry[0] === "org" && typeof entry[3] === "string" && !org) org = entry[3];
        if (entry[0] === "tel" && typeof entry[3] === "string" && !phone) phone = entry[3];
      }
      // Recurse into nested entities
      const nested: any[] = entity?.entities ?? [];
      for (const ne of nested) {
        const nVcard: any[][] = ne?.vcardArray?.[1] ?? [];
        for (const entry of nVcard) {
          if (entry[0] === "email" && typeof entry[3] === "string" && !email) {
            const e = entry[3].toLowerCase();
            if (!e.includes("abuse") && !e.includes("privacy") && e.includes("@")) email = e;
          }
        }
      }
      if (email) break;
    }

    // K1: discard if the email's domain belongs to a registrar or hosting provider
    if (email) {
      const rdapEmailDomain = email.split("@")[1]?.toLowerCase() ?? "";
      if (REGISTRAR_DOMAINS.has(rdapEmailDomain)) {
        logger.debug({ domain: rdapEmailDomain }, "RDAP email discarded — registrar/infra domain");
        email = null;
      }
    }
    return { email, org, phone, sourceUrl };
  } catch (err: any) {
    logger.debug({ err: err.message }, "RDAP lookup failed");
    return { email: null, org: null, phone: null, sourceUrl: null };
  }
}

// ── Source 12: crt.sh certificate transparency ────────────────────────────────
async function queryCRTsh(domain: string): Promise<string[]> {
  try {
    // Search for certificates issued to the domain — sometimes emails appear in Subject
    const url = `https://crt.sh/?q=%.${domain}&output=json&limit=50`;
    const resp = await fetch(url, { signal: timeout(12_000), headers: BROWSER_HEADERS });
    if (!resp.ok) return [];
    const certs: any[] = await resp.json() as any[];
    if (!Array.isArray(certs)) return [];

    const emails: Set<string> = new Set();
    for (const cert of certs.slice(0, 30)) {
      // Name_Value can contain SANs, check for email: prefix
      const nameValue: string = cert?.name_value ?? "";
      for (const line of nameValue.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("email:") || trimmed.includes("@")) {
          const email = extractEmail(trimmed);
          if (email) emails.add(email);
        }
      }
      // Common_name sometimes has email
      const cn: string = cert?.common_name ?? "";
      if (cn.includes("@")) {
        const email = extractEmail(cn);
        if (email) emails.add(email);
      }
    }
    return [...emails].slice(0, 3);
  } catch (err: any) {
    logger.debug({ err: err.message }, "crt.sh lookup failed");
    return [];
  }
}

// ── Source 13: Wayback Machine CDX — archived contact pages ───────────────────
async function queryWaybackMachine(domain: string): Promise<{ email: string | null; sourceUrl: string | null }> {
  try {
    // Find archived contact/about/team pages
    const paths = ["contact", "about", "team", "contact-us", "about-us"];
    for (const path of paths) {
      const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${domain}/${path}*&output=json&fl=original,timestamp&limit=3&filter=statuscode:200&collapse=urlkey`;
      const cdxResp = await fetch(cdxUrl, { signal: timeout(10_000), headers: HEADERS });
      if (!cdxResp.ok) continue;
      const cdxData: any[][] = await cdxResp.json() as any[][];
      if (!Array.isArray(cdxData) || cdxData.length < 2) continue;

      // Try to fetch the archived page
      const [origUrl, ts] = cdxData[1]!; // skip header row
      if (!origUrl || !ts) continue;

      const archiveUrl = `https://web.archive.org/web/${ts}/${origUrl}`;
      const pageResp = await fetch(archiveUrl, {
        signal: timeout(12_000),
        headers: { "User-Agent": BROWSER_HEADERS["User-Agent"], Accept: "text/html" },
      });
      if (!pageResp.ok) continue;
      const html = await pageResp.text();
      const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 10_000);
      const email = extractEmail(text);
      if (email) return { email, sourceUrl: archiveUrl };
      await sleep(200);
    }
    return { email: null, sourceUrl: null };
  } catch (err: any) {
    logger.debug({ err: err.message }, "Wayback Machine lookup failed");
    return { email: null, sourceUrl: null };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// MODULE E — EMAIL DISCOVERY
// ═══════════════════════════════════════════════════════════════════════════════

// ── Source 14: Email pattern generation (12 patterns) ─────────────────────────
function emailPatterns(firstName: string, lastName: string, domain: string): string[] {
  const f = firstName.toLowerCase().replace(/[^a-z]/g, "");
  const l = lastName.toLowerCase().replace(/[^a-z]/g, "");
  const fi = f.charAt(0);
  const li = l.charAt(0);
  if (!f || !l) return f ? [`${f}@${domain}`] : [];

  return [
    `${f}.${l}@${domain}`,       // first.last     (most common — 45%)
    `${fi}${l}@${domain}`,       // flast          (~25%)
    `${fi}.${l}@${domain}`,      // f.last         (~10%)
    `${f}${l}@${domain}`,        // firstlast      (~8%)
    `${f}@${domain}`,            // first          (~5%)
    `${l}@${domain}`,            // last           (~3%)
    `${f}${li}@${domain}`,       // firstl         (~2%)
    `${l}.${f}@${domain}`,       // last.first     (EU style)
    `${l}${fi}@${domain}`,       // lastf
    `${fi}_${l}@${domain}`,      // f_last
    `${f}_${l}@${domain}`,       // first_last
    `${f}-${l}@${domain}`,       // first-last
  ];
}

// ── Source 15: Gravatar MD5 verification ──────────────────────────────────────
async function checkGravatar(email: string): Promise<boolean> {
  const hash = createHash("md5").update(email.toLowerCase().trim()).digest("hex");
  try {
    const resp = await fetch(`https://www.gravatar.com/avatar/${hash}?d=404&size=1`, {
      signal: timeout(6_000),
      headers: { "User-Agent": "ApexFinder/2.0" },
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}

async function verifyEmailPatterns(
  firstName: string, lastName: string, domain: string
): Promise<{ email: string; confidence: number; method: string } | null> {
  const patterns = emailPatterns(firstName, lastName, domain);
  // Check Gravatar for each pattern first (free, fast)
  for (const email of patterns) {
    const hasGravatar = await checkGravatar(email);
    if (hasGravatar) return { email, confidence: 90, method: "EmailPattern-Gravatar" };
    await sleep(120);
  }
  // Fall back to MX-validated best guess
  const hasMx = await hasMxRecord(domain);
  if (hasMx) return { email: patterns[0]!, confidence: 55, method: "EmailPattern-MX" };
  return null;
}

// ── Source 16: SMTP port-25 verification ──────────────────────────────────────
// Connects to MX server, does RCPT TO handshake, does NOT send any email.
// 250 = exists, 550/551/553 = doesn't exist, other/timeout = unknown.
async function smtpVerify(
  email: string, mxHost: string
): Promise<"exists" | "notexists" | "unknown"> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buf = "";
    let step = 0;
    let done = false;

    const finish = (result: "exists" | "notexists" | "unknown") => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };

    socket.setTimeout(8_000);
    socket.on("timeout", () => finish("unknown"));
    socket.on("error", () => finish("unknown"));
    socket.on("close", () => { if (!done) finish("unknown"); });

    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\r\n");
      buf = lines.pop() ?? "";  // keep incomplete line
      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.substring(0, 3), 10);
        // Only act on final response lines (no hyphen continuation)
        if (line.charAt(3) === "-") continue;

        if (step === 0 && code === 220) {
          socket.write("EHLO apexfinder.private\r\n"); step = 1;
        } else if (step === 1 && (code === 250 || code === 220)) {
          socket.write("MAIL FROM:<verify@apexfinder.private>\r\n"); step = 2;
        } else if (step === 2 && code === 250) {
          socket.write(`RCPT TO:<${email}>\r\n`); step = 3;
        } else if (step === 3) {
          if (code === 250 || code === 251) finish("exists");
          else if (code === 550 || code === 551 || code === 553 || code === 554) finish("notexists");
          else finish("unknown");  // 450=greylisted (exists but defer), 452=full
        } else if (code >= 400 && step < 3) {
          finish("unknown");  // server error mid-handshake
        }
      }
    });

    try {
      socket.connect(25, mxHost);
    } catch {
      finish("unknown");
    }
  });
}

/** Try SMTP verify for a candidate email; returns boosted confidence if confirmed */
async function smtpVerifyEmail(
  email: string, domain: string
): Promise<{ confirmed: boolean; confidence: number }> {
  try {
    const mxHosts = await getMxHosts(domain);
    if (!mxHosts.length) return { confirmed: false, confidence: 0 };
    const result = await smtpVerify(email, mxHosts[0]!);
    if (result === "exists")    return { confirmed: true,  confidence: 88 };
    if (result === "notexists") return { confirmed: false, confidence: 0 };
    return { confirmed: false, confidence: 0 };  // unknown
  } catch {
    return { confirmed: false, confidence: 0 };
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// MODULE F — SOCIAL & WEB
// ═══════════════════════════════════════════════════════════════════════════════

// ── Source 17: DuckDuckGo HTML search for LinkedIn URL ────────────────────────
async function duckduckgoLinkedIn(name: string, location?: string | null): Promise<string | null> {
  try {
    const queries = location
      ? [`site:linkedin.com/in/ "${name}" "${location}"`, `site:linkedin.com/in/ "${name}"`]
      : [`site:linkedin.com/in/ "${name}"`];

    for (const q of queries) {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      const resp = await fetch(url, { signal: timeout(12_000), headers: BROWSER_HEADERS });
      if (!resp.ok) continue;
      const html = await resp.text();
      // Try href extraction first (most reliable — DDG puts URLs in href attrs)
      const liHrefMatch = html.match(/href=["'](https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]{3,})[^"']*/i);
      if (liHrefMatch) return liHrefMatch[1]!.replace(/\/$/, "");
      // Fallback: plain text regex
      const liMatch = html.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]{3,}/i);
      if (liMatch) return liMatch[0]!.replace(/\/$/, "");
      await sleep(300);
    }
    return null;
  } catch (err: any) {
    logger.debug({ err: err.message }, "DuckDuckGo LinkedIn search failed");
    return null;
  }
}

// ── Source 18: DuckDuckGo Instant Answer ──────────────────────────────────────
interface DDGResult {
  abstractUrl: string | null;
  abstractText: string | null;
  email: string | null;
  linkedin: string | null;
  twitter: string | null;
}

async function duckduckgoInstant(query: string): Promise<DDGResult | null> {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, { signal: timeout(10_000), headers: HEADERS });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const text = `${data?.Abstract ?? ""} ${data?.AbstractText ?? ""}`;
    const relTopics: any[] = data?.RelatedTopics ?? [];
    const allText = text + " " + relTopics.map((t: any) => t?.Text ?? "").join(" ");

    return {
      abstractUrl: data?.AbstractURL ?? null,
      abstractText: data?.AbstractText ?? null,
      email: extractEmail(allText),
      linkedin: extractLinkedIn(allText),
      twitter: allText.match(/https?:\/\/(www\.)?twitter\.com\/[a-zA-Z0-9_]+/i)?.[0] ?? null,
    };
  } catch (err: any) {
    logger.debug({ err: err.message }, "DuckDuckGo instant answer failed");
    return null;
  }
}

// ── Source 19: News email extraction via DuckDuckGo News ──────────────────────
async function duckduckgoNewsEmail(name: string): Promise<{ email: string | null; url: string | null }> {
  try {
    const q = `"${name}" email contact`;
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&t=h_&ia=web`;
    const resp = await fetch(url, { signal: timeout(10_000), headers: HEADERS });
    if (!resp.ok) return { email: null, url: null };
    const data = await resp.json() as any;
    const topics: any[] = data?.RelatedTopics ?? [];
    const allText = topics.map((t: any) => `${t?.Text ?? ""} ${t?.FirstURL ?? ""}`).join(" ");
    return {
      email: extractEmail(allText),
      url: data?.AbstractURL || topics[0]?.FirstURL || null,
    };
  } catch {
    return { email: null, url: null };
  }
}

// ── Source 20: Company contact page scraper ────────────────────────────────────
async function scrapeContactPage(domain: string): Promise<{ email: string | null; phone: string | null; linkedinUrl: string | null; address: string | null; sourceUrl: string | null }> {
  const paths = ["/contact", "/about", "/team", "/contact-us", "/about-us",
                 "/leadership", "/our-team", "/executive-team", "/management-team",
                 "/people", "/who-we-are", "/"];
  for (const path of paths) {
    try {
      const resp = await fetch(`https://${domain}${path}`, {
        signal: timeout(8_000),
        headers: { "User-Agent": BROWSER_HEADERS["User-Agent"], Accept: "text/html" },
        redirect: "follow",
      });
      if (!resp.ok) continue;
      const html = await resp.text().then(h => h.slice(0, 60_000));

      // ── Extract from raw HTML attributes BEFORE stripping tags ──
      // mailto: hrefs are the most reliable source of real email addresses
      let email: string | null = null;
      const mailtoRe = /href=["']mailto:([^"'?\s]+)/gi;
      for (const m of html.matchAll(mailtoRe)) {
        const addr = m[1]!.toLowerCase().trim();
        const domain_ = addr.split("@")[1] ?? "";
        const clean = sanitizePublicEmail(addr);
        if (clean && !EMAIL_BLOCK.has(domain_) && clean.length < 80) {
          email = clean;
          break;
        }
      }

      // LinkedIn href extraction
      let linkedinUrl: string | null = null;
      const liHrefRe = /href=["'](https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]{3,})[^"']*/i;
      const liHrefMatch = html.match(liHrefRe);
      if (liHrefMatch) linkedinUrl = liHrefMatch[1]!.replace(/\/$/, "");

      // ── Address extraction: <address> tag → French street pattern → UK postcode ──
      let address: string | null = null;
      const addrTagM = html.match(/<address[^>]*>([\s\S]{5,400}?)<\/address>/i);
      if (addrTagM) {
        address = addrTagM[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      }

      // ── Fall back to plain-text extraction ──
      const text = html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").slice(0, 12_000);
      if (!email) email = extractEmail(text);
      const phone = extractPhone(text);
      if (!linkedinUrl) linkedinUrl = extractLinkedIn(text);

      // French street address: number + rue/avenue/boulevard + name + postal code + city
      if (!address) {
        const frM = text.match(/\d{1,4}[\s,]+(?:rue|avenue|av\.|boulevard|bd\.|place|all[eé]e|impasse|chemin|cours|quai)\s+[^,\n]{3,50},\s*\d{5}[\s,]+[A-ZÀ-Üa-zà-ü][a-zà-ü\s\-]{2,30}/i);
        if (frM) address = frM[0].replace(/\s+/g, " ").trim().slice(0, 200);
      }
      // UK postcode pattern
      if (!address) {
        const ukM = text.match(/\d{1,4}\s+[A-Za-z\s]{5,50},\s*[A-Za-z\s]{3,30},\s*[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}/i);
        if (ukM) address = ukM[0].replace(/\s+/g, " ").trim().slice(0, 200);
      }

      if (email || phone || linkedinUrl || address) return { email, phone, linkedinUrl, address, sourceUrl: resp.url || `https://${domain}${path}` };
    } catch { /* try next path */ }
    await sleep(200);
  }
  return { email: null, phone: null, linkedinUrl: null, address: null, sourceUrl: null };
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR — enrichInHouse v2
// ═══════════════════════════════════════════════════════════════════════════════

export async function enrichInHouse(entity: InHouseEnrichInput): Promise<InHouseEnrichResult> {
  const result: InHouseEnrichResult = {
    email: null, linkedinUrl: null, phone: null, website: null, twitter: null,
    address: null,
    sources: [], emailConfidence: 0, phoneConfidence: 0,
    sourceHits: {},
    evidence: [],
  };

  // Use canonical entityName from metadata if available; strip ticker symbols
  const rawName = (entity.entityName || entity.name).trim();
  let name = normaliseName(stripTicker(rawName));
  if (!name || name.length < 3) return result;

  // Skip address-named entities (HMLR properties like "23 High Street London")
  if (/^\d+\s/.test(name) || /\b(flat|house|cottage|manor|farm)\s+\d/i.test(name)) return result;

  // ── I1+I4: Tier classification + LLC beneficial owner resolution ──────────────
  const tier = enrichmentTier(entity);

  // M3: Extend LLC→person resolution to EDGAR corporate entities, not just FAA tier 3.
  // SEC SC 13D/G filers are often holding companies; resolving the beneficial owner
  // unlocks social/email hits that would never fire against the corporate name.
  const isEdgarCorp = tier === 1 && entity.type === "Corporation" &&
    ((entity.metadata ?? "").includes("sec-edgar") ||
     (entity.sourceRegistries ?? "").toLowerCase().includes("edgar") ||
     (entity.sourceRegistries ?? "").toLowerCase().includes("sec "));

  if (tier === 3 || isEdgarCorp) {
    // FAA Corporation / EDGAR Corp: try to resolve LLC to the person behind it.
    // If found, switch the enrichment name — this unlocks Wikidata/LinkedIn/email-pattern hits.
    const resolved = await resolveBeneficialOwner(name);
    if (resolved) {
      const tag = tier === 3 ? "I1: FAA LLC" : "M3: EDGAR Corp";
      logger.debug({ llc: name, person: resolved }, `${tag} → beneficial owner resolved`);
      name = resolved;
    }
  }

  // ── Tier 2 name reversal: FAA stores registrant names as "Last First [Middle]" ──
  // After normaliseName the name is title-cased but still in Last-First order.
  // Swap to "First [Middle] Last" so DDG/LinkedIn/domain searches match correctly.
  if (tier === 2) {
    const parts = name.split(/\s+/);
    if (parts.length === 2) {
      name = `${parts[1]!} ${parts[0]!}`;
    } else if (parts.length === 3) {
      // FAA "Last First Middle" → "First Middle Last"
      name = `${parts[1]!} ${parts[2]!} ${parts[0]!}`;
    }
    // 4+ word names are likely trust/company names — leave as-is
  }

  // Recalculate derived variables using the (possibly resolved / reversed) name
  const isIndividual = (tier === 3 && /^[A-Z][a-z]+ [A-Z]/.test(name))  // resolved person
    || entity.type === "HNWI" || entity.type === "Gatekeeper"
    || /^[A-Z][a-z]+ [A-Z]/.test(name);
  // Also detect individual by 2-word name that looks like First Last
  const looksLikeIndividual = /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name) || /^[A-Z][a-z]+ [A-Z][a-z]+ [A-Z][a-z]+$/.test(name);
  const isCorp = (entity.type === "Corporation" || entity.type === "Trust") && !looksLikeIndividual
    && !(tier === 3 && isIndividual); // if we resolved a person, drop corp flag

  const { first, last } = splitName(name);
  const hasNameParts = (isIndividual || looksLikeIndividual) && first && last && last.length > 1;

  // Geo context: city from bizLocation or knownResidences
  const bizCity = entity.bizLocation?.split(",")[0]?.trim() ?? null;
  const bizState = entity.bizLocation?.split(",")[1]?.trim() ?? null;

  // Resolve any known domain from metadata first (used by multiple modules)
  let knownDomain = domainFromMeta(entity.metadata, entity.notes);

  const addSource = (tag: string) => { result.sources.push(tag); result.sourceHits[tag] = true; };

  // K2: penalise generic corporate prefixes at write time — they indicate shared
  // inboxes rather than personal contacts. Confidence is reduced by 30 points;
  // if the adjusted score falls to zero or below, the email is discarded entirely.
  const setEmail = (
    email: string | null,
    confidence: number,
    source: string,
    sourceUrl: string | null = null,
    extractionMethod = "public-source-parser",
    details?: Record<string, unknown>,
    // Guessed or pattern-derived addresses are not public contact evidence.
    // They are discarded rather than stored as review data or promoted later.
    evidenceOnly = false,
  ) => {
    if (!email) return;
    if (evidenceOnly) return;
    const local = email.split("@")[0]?.toLowerCase() ?? "";
    let adj = confidence;
    if (isGenericEmailPrefix(local)) {
      adj -= 30;
      result.hasGenericEmail = true; // propagated to computeContactOutcome (L1)
    }
    if (adj <= 0) return;
    if (!evidenceOnly && adj > result.emailConfidence) {
      result.email = email;
      result.emailConfidence = adj;
      result.emailSource = source;
      result.evidence = result.evidence.filter((item) => item.vectorType !== "email");
    }
    if (!result.evidence.some((e) => e.vectorType === "email" && e.value === email)) {
      result.evidence.push({
        vectorType: "email",
        value: email,
        source,
        sourceUrl,
        extractionMethod,
        confidence: adj,
        observedAt: new Date().toISOString(),
        details,
      });
    }
    if (!evidenceOnly) addSource(source);
  };

  // K5: normalise phone to E.164 and require ≥ 8 digits (replaces manual PHONE_BLOCKLIST).
  const setPhone = (
    phone: string | null,
    confidence: number,
    source: string,
    sourceUrl: string | null = null,
    extractionMethod = "public-source-parser",
    details?: Record<string, unknown>,
  ) => {
    if (!phone) return;
    // Allow override when the new source has higher confidence (website > EDGAR)
    if (result.phone && confidence <= result.phoneConfidence) return;
    const normalized = normalizePhone(phone);
    if (!normalized) return;
    result.phone = normalized;
    result.phoneConfidence = confidence;
    result.phoneSource = source;
      result.evidence = result.evidence.filter((item) => item.vectorType !== "phone");
      result.evidence.push({
        vectorType: "phone",
        value: normalized,
        source,
        sourceUrl,
        extractionMethod,
        confidence,
        observedAt: new Date().toISOString(),
        details,
      });
    addSource(source);
  };

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 1: Knowledge graphs + Corporate registries — run in parallel
  // ────────────────────────────────────────────────────────────────────────────
  const g1Promises: Promise<void>[] = [];

  // I4: Tier 2 = FAA individuals — skip knowledge graphs (private aircraft owners aren't on
  // Wikidata/Wikipedia/ORCID/GitHub). Focus API budget on DDG-LinkedIn, DNS/RDAP, email patterns.
  // Tier 1 (EDGAR/public) and Tier 3 (resolved beneficial owner) run the full knowledge graph pass.

  // Source 1: Wikidata (individuals) — skip for Tier 2
  if (isIndividual && tier !== 2) {
    g1Promises.push((async () => {
      const wd = await queryWikidata(name);
      if (wd) {
        result.sourceHits["Wikidata"] = true;
        setEmail(wd.email, 85, "Wikidata-Email", wd.entityUrl ?? null);
        if (!result.linkedinUrl && wd.linkedinUrl) { result.linkedinUrl = wd.linkedinUrl; addSource("Wikidata-LinkedIn"); }
        if (!result.website && wd.website) { result.website = wd.website; addSource("Wikidata-Website"); }
        if (!result.phone && wd.phone) setPhone(wd.phone, 80, "Wikidata-Phone", wd.entityUrl ?? null);
        if (!result.twitter && wd.twitter) { result.twitter = wd.twitter; addSource("Wikidata-Twitter"); }
      }
    })());
  }

  // Source 1b: Wikidata (corporations) — skip for Tier 2
  if (isCorp && tier !== 2) {
    g1Promises.push((async () => {
      const wd = await queryWikidataCorp(name);
      if (wd) {
        result.sourceHits["Wikidata-Corp"] = true;
        if (!result.website && wd.website) { result.website = wd.website; addSource("Wikidata-Website"); }
      }
    })());
  }

  // Source 2: Wikipedia — skip for Tier 2 (FAA private individuals rarely have Wikipedia pages)
  if (tier !== 2) {
    g1Promises.push((async () => {
      const wiki = await queryWikipedia(name);
      if (wiki) {
        result.sourceHits["Wikipedia"] = true;
        if (!result.email) setEmail(extractEmail(wiki.extract), 40, "Wikipedia-Email", wiki.website ?? null);
        if (!result.linkedinUrl) { const li = extractLinkedIn(wiki.extract); if (li) { result.linkedinUrl = li; addSource("Wikipedia-LinkedIn"); } }
        if (!result.website && wiki.website) { result.website = wiki.website; addSource("Wikipedia-URL"); }
        if (!result.phone) setPhone(extractPhone(wiki.extract), 45, "Wikipedia-Phone", wiki.website ?? null);
      }
    })());
  }

  // Source 3: ORCID (individuals) — skip for Tier 2 (aircraft owners aren't typically researchers)
  if (hasNameParts && tier !== 2) {
    g1Promises.push((async () => {
      const orcid = await queryORCID(first, last);
      if (orcid) {
        result.sourceHits["ORCID"] = true;
        setEmail(orcid.email, 80, "ORCID-Email", orcid.recordUrl);
        if (!result.website && orcid.website) { result.website = orcid.website; addSource("ORCID-Website"); }
      }
    })());
  }

  // Source 4: GitHub (individuals) — skip for Tier 2
  if (isIndividual && tier !== 2) {
    g1Promises.push((async () => {
      const gh = await queryGitHub(name);
      if (gh) {
        result.sourceHits["GitHub"] = true;
        setEmail(gh.email, 75, "GitHub-Email", gh.htmlUrl);
        if (!result.website && gh.blog) { result.website = gh.blog; addSource("GitHub-Blog"); }
      }
    })());
  }

  // Source 5: GLEIF (corporations)
  if (isCorp) {
    g1Promises.push((async () => {
      const gleif = await queryGLEIF(name);
      if (gleif) {
        result.sourceHits["GLEIF"] = true;
        addSource("GLEIF-Found");
        // Store address in result for later writing to entity
        if (!knownDomain && gleif.legalName) {
          const guessed = guessCompanyDomain(gleif.legalName, bizCity);
          if (guessed.length) knownDomain = guessed[0]!;
        }
      }
    })());
  }

  // Source 6: SEC EDGAR EFTS
  g1Promises.push((async () => {
    const edgar = await queryEDGAR(name);
    if (edgar) {
      result.sourceHits["EDGAR"] = true;
      setPhone(edgar.phone, 65, "EDGAR-Phone", edgar.recordUrl);
      if (!result.website && edgar.companyName && isCorp) {
        const guessed = guessCompanyDomain(edgar.companyName, bizCity);
        if (guessed.length && !knownDomain) knownDomain = guessed[0]!;
      }
    }
  })());

  // Source 7: UK Companies House (corporations)
  if (isCorp) {
    g1Promises.push((async () => {
      const ch = await queryCompaniesHouse(name);
      if (ch) {
        result.sourceHits["CompaniesHouse"] = true;
        if (ch.officerEmails.length) setEmail(ch.officerEmails[0]!, 70, "CompaniesHouse-Email", ch.recordUrl);
        setPhone(ch.officerPhone, 65, "CompaniesHouse-Phone", ch.recordUrl);
        addSource("CompaniesHouse-Found");
      }
    })());
  }

  // Source 8: ProPublica (corporations)
  if (isCorp) {
    g1Promises.push((async () => {
      const pp = await queryProPublica(name);
      if (pp) {
        result.sourceHits["ProPublica"] = true;
        setEmail(pp.email, 50, "ProPublica-Email", pp.recordUrl ?? null);
        setPhone(pp.phone, 50, "ProPublica-Phone", pp.recordUrl ?? null);
        if (!result.website && pp.website) { result.website = pp.website; addSource("ProPublica-Website"); }
      }
    })());
  }

  // Source 8b: BRREG Enhetsregisteret — Norwegian company directors
  // orgnr is stored in entity metadata when ingested via the BRREG harvester.
  // Returns phone + website for the director's registered company, free, no auth.
  {
    const entityMeta8 = safeJson<Record<string, unknown>>(entity.metadata, {});
    const orgnr = typeof entityMeta8["orgnr"] === "string" ? (entityMeta8["orgnr"] as string).trim()
      : typeof entityMeta8["orgnr"] === "number" ? String(entityMeta8["orgnr"]) : null;
    if (orgnr && orgnr.length >= 8) {
      g1Promises.push((async () => {
        const brreg = await queryBRREG(orgnr);
        if (brreg) {
          result.sourceHits["BRREG"] = true;
          setPhone(brreg.phone, 55, "BRREG-Phone", brreg.recordUrl ?? null);
          if (!result.website && brreg.website) { result.website = brreg.website; addSource("BRREG-Website"); }
          if (!result.address && brreg.address) { result.address = brreg.address; addSource("BRREG-Address"); }
        }
      })());
    }
  }

  // Source C9: ICIJ Offshore Leaks — for corporations, query the Panama/Pandora Papers database
  // This is non-blocking: findings are stored in result.icijFindings but don't affect email/phone scoring.
  if (isCorp && tier !== 2) {
    g1Promises.push((async () => {
      try {
        const icij = await enrichWithIcij(name, [], false);
        if (icij.found) {
          result.sourceHits["ICIJ-Offshore"] = true;
          addSource("ICIJ-Offshore");
          result.icijFindings = {
            totalMatches: icij.totalMatches,
            sources: icij.sources,
            summary: summariseIcijFindings(icij),
          };
          logger.info({ name, matches: icij.totalMatches, sources: icij.sources }, "[ICIJ] offshore match found");
        }
      } catch (err: any) {
        logger.debug({ err: err.message }, "[ICIJ] enrichment error (non-fatal)");
      }
    })());
  }

  await Promise.allSettled(g1Promises);
  await sleep(150);

  // Early exit: very high confidence email found
  if (result.emailConfidence >= 85 && result.linkedinUrl) return result;

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 2: Domain intelligence — needs domain resolution
  // ────────────────────────────────────────────────────────────────────────────

  // Promote website found in G1 (Wikidata/Wikipedia/GitHub/ORCID) to knownDomain
  // This unlocks email-pattern, SMTP, RDAP, crt.sh, Wayback for individuals with known websites
  if (!knownDomain && result.website) {
    const m = result.website.match(/^https?:\/\/(?:www\.)?([a-z0-9.\-]+)/i);
    if (m && !BLOCKED_DOMAINS.has(m[1]!)) knownDomain = m[1]!;
  }

  // For corporations: try DNS-confirmed domain guess if still no domain
  if (!knownDomain && isCorp) {
    const candidates = guessCompanyDomain(name, bizCity);
    for (const candidate of candidates) {
      if (await hasMxRecord(candidate)) { knownDomain = candidate; break; }
      await sleep(80);
    }
  }

  // For individuals from western HNWI: try their employer's domain for email pattern generation.
  // DEF 14A directors (e.g. "Tim Cook" + "Apple Inc") → apple.com → tim.cook@apple.com
  // Companies House officers (e.g. "Jane Smith" + "Tesco PLC") → tesco.com → j.smith@tesco.com
  if (!knownDomain && (isIndividual || looksLikeIndividual) && hasNameParts) {
    const entityMeta = safeJson<Record<string, unknown>>(entity.metadata, {});
    const cn = typeof entityMeta["companyName"] === "string" ? (entityMeta["companyName"] as string).trim() : null;
    if (cn && cn.length > 3) {
      const candidates = guessCompanyDomain(cn, bizCity);
      for (const candidate of candidates) {
        if (await hasMxRecord(candidate)) { knownDomain = candidate; break; }
        await sleep(80);
      }
    }
  }

  if (knownDomain) {
    const g2Promises: Promise<void>[] = [];

    // Source 10: SPF/TXT analysis
    g2Promises.push((async () => {
      const spf = await analyseSPF(knownDomain!);
      if (spf.hasEmail) {
        result.sourceHits["SPF-Analysis"] = true;
        addSource(`SPF-${spf.provider ?? "Unknown"}`);
      }
    })());

    // Source 11: RDAP
    g2Promises.push((async () => {
      const rdap = await rdapLookup(knownDomain!);
      if (rdap.email) {
        result.sourceHits["RDAP"] = true;
        setEmail(rdap.email, 50, "RDAP-Registrant", `https://rdap.org/domain/${knownDomain}`);
      }
      if (rdap.phone) setPhone(rdap.phone, 40, "RDAP-Phone", `https://rdap.org/domain/${knownDomain}`);
    })());

    // Source 12: crt.sh
    g2Promises.push((async () => {
      const certEmails = await queryCRTsh(knownDomain!);
      if (certEmails.length) {
        result.sourceHits["crt.sh"] = true;
        setEmail(certEmails[0]!, 60, "CertTransparency-Email");
      }
    })());

    // Source 13: Wayback Machine
    if (!result.email || result.emailConfidence < 50) {
      g2Promises.push((async () => {
        const waybackEmail = await queryWaybackMachine(knownDomain!);
        if (waybackEmail) {
          result.sourceHits["Wayback"] = true;
          setEmail(waybackEmail, 55, "Wayback-Email");
        }
      })());
    }

    // Source 20: Live contact page scraper
    if (!result.email || result.emailConfidence < 50 || !result.linkedinUrl) {
      g2Promises.push((async () => {
        const scraped = await scrapeContactPage(knownDomain!);
        if (scraped.email) {
          result.sourceHits["ContactPage"] = true;
          setEmail(scraped.email, 60, "ContactPage-Email");
        }
        if (scraped.phone) setPhone(scraped.phone, 72, "ContactPage-Phone");
        if (scraped.linkedinUrl && !result.linkedinUrl) {
          result.linkedinUrl = scraped.linkedinUrl;
          addSource("ContactPage-LinkedIn");
          result.sourceHits["ContactPage-LinkedIn"] = true;
        }
        if (scraped.address && !result.address) {
          result.address = scraped.address;
          addSource("ContactPage-Address");
          result.sourceHits["ContactPage-Address"] = true;
        }
      })());
    }

    await Promise.allSettled(g2Promises);
  }

  await sleep(100);

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 3: Email pattern generation + verification
  // ────────────────────────────────────────────────────────────────────────────
  if (!result.email || result.emailConfidence < 60) {
    const domain = knownDomain;

    if (domain && hasNameParts) {
      // Source 14 + 15: Pattern gen + Gravatar
      const verified = await verifyEmailPatterns(first, last, domain);
      if (verified) {
        result.sourceHits["EmailPattern"] = true;
        // evidenceOnly=true: pattern emails are research leads, never final contact data
        setEmail(verified.email, verified.confidence, verified.method, null, "pattern-generated", undefined, true);
      }
    }

    if (domain && isCorp && !result.email) {
      // Try domain-only email like info@ / hello@ / contact@
      const genericPatterns = ["info", "hello", "contact", "admin", "office", "mail"];
      for (const prefix of genericPatterns) {
        const email = `${prefix}@${domain}`;
        const hasGrav = await checkGravatar(email);
        if (hasGrav) {
          // evidenceOnly=true: generic org emails are research leads, never final contact data
          setEmail(email, 65, "GenericEmail-Gravatar", null, "pattern-generated", undefined, true);
          break;
        }
        await sleep(80);
      }
    }
  }

  // Source 16: SMTP verify — boost confidence for best candidate
  if (result.email && result.emailConfidence >= 50 && result.emailConfidence < 88 && knownDomain) {
    try {
      const smtp = await smtpVerifyEmail(result.email, knownDomain);
      if (smtp.confirmed) {
        result.emailConfidence = smtp.confidence;
        result.sourceHits["SMTP-Verify"] = true;
        result.smtpVerified = true; // delivery signal only; never identity attribution
        addSource("SMTP-Verified");
        logger.info({ email: result.email }, "SMTP verification confirmed email");
      }
    } catch { /* SMTP blocked in cloud env — graceful skip */ }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // GROUP 4: Social & Web discovery — fill remaining gaps
  // ────────────────────────────────────────────────────────────────────────────
  const g4Promises: Promise<void>[] = [];

  // Source 17: DuckDuckGo LinkedIn (with geo context for precision)
  if (!result.linkedinUrl) {
    g4Promises.push((async () => {
      const location = bizCity || bizState ? `${bizCity ?? ""} ${bizState ?? ""}`.trim() : null;
      const li = await duckduckgoLinkedIn(name, location);
      if (li) {
        result.sourceHits["DDG-LinkedIn"] = true;
        result.linkedinUrl = li;
        addSource("DDG-LinkedIn");
      }
    })());
  }

  // Source 18: DuckDuckGo Instant Answer
  if (!result.website || !result.email) {
    g4Promises.push((async () => {
      const ddg = await duckduckgoInstant(name);
      if (ddg) {
        if (!result.email && ddg.email) setEmail(ddg.email, 45, "DDG-Email");
        if (!result.linkedinUrl && ddg.linkedin) { result.linkedinUrl = ddg.linkedin; addSource("DDG-LinkedIn-IA"); }
        if (!result.twitter && ddg.twitter) { result.twitter = ddg.twitter; addSource("DDG-Twitter"); }
        if (!result.website && ddg.abstractUrl) { result.website = ddg.abstractUrl; addSource("DDG-Website"); }
        result.sourceHits["DDG-Instant"] = true;
      }
    })());
  }

  // Source 19: News email extraction
  if (!result.email) {
    g4Promises.push((async () => {
      const news = await duckduckgoNewsEmail(name);
      if (news.email) {
        result.sourceHits["DDG-News"] = true;
        setEmail(news.email, 40, "News-Email");
      }
    })());
  }

  await Promise.allSettled(g4Promises);

  // Phase L: Whoxy Reverse WHOIS — after email discovery, find all domains registered by this email/name
  // Gracefully skipped when WHOXY_API_KEY is not set.
  if (result.email || name) {
    try {
      const whoxyResult = await enrichWithWhoxy({
        email: result.email ?? undefined,
        name: (isIndividual || looksLikeIndividual) ? name : undefined,
        companyName: isCorp ? name : undefined,
      });
      if (whoxyResult.totalUnique > 0) {
        result.sourceHits["Whoxy-RDAP"] = true;
        addSource("Whoxy-Domains");
        result.whoxyDomains = {
          totalUnique: whoxyResult.totalUnique,
          domains: whoxyResult.allUniqueDomains.slice(0, 20).map(d => ({ domain_name: d.domain_name, create_date: d.create_date })),
          summary: summariseWhoxyFindings(whoxyResult.allUniqueDomains),
        };
        // If Whoxy found domains and we still have no website, promote the first domain
        if (!result.website && whoxyResult.allUniqueDomains[0]?.domain_name) {
          const dom = whoxyResult.allUniqueDomains[0].domain_name;
          if (!BLOCKED_DOMAINS.has(dom)) {
            result.website = `https://${dom}`;
            addSource("Whoxy-Website");
          }
        }
        logger.info({ name, totalDomains: whoxyResult.totalUnique }, "[Whoxy] reverse WHOIS domains found");
      }
    } catch (err: any) {
      logger.debug({ err: err.message }, "[Whoxy] enrichment error (non-fatal)");
    }
  }

  // M2: Social second-pass — if entity already has a GitHub URL stored in metadata
  // from a prior enrichment pass but still has no email, fetch the public profile
  // directly by handle (avoids the search API; reads the email field GitHub exposes).
  if (!result.email) {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(entity.metadata ?? "{}") as Record<string, unknown>; } catch {}
    const githubUrl = result.sourceHits["GitHub"]
      ? null  // Already tried GitHub by name this pass — skip to avoid double-counting
      : (meta.githubUrl as string | undefined) ?? null;
    if (githubUrl && typeof githubUrl === "string") {
      const handleMatch = githubUrl.match(/github\.com\/([^/\s?#]+)/i);
      const handle = handleMatch?.[1] ?? null;
      if (handle && handle.length > 1 && !["search", "orgs", "trending"].includes(handle)) {
        const gh = await queryGitHubByHandle(handle);
        if (gh?.email) {
          setEmail(gh.email, 55, "GitHub-Handle", gh.htmlUrl ?? null);
          addSource("GitHub-Handle");
        }
        if (gh?.blog && !result.website) {
          result.website = gh.blog;
          addSource("GitHub-Handle-Blog");
        }
      }
    }
  }

  return result;
}
