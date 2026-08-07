/**
 * Web Enricher — Layer 1/2 Web OSINT + Deep Web OSINT
 *
 * Phase K overhaul:
 *   - Trading-name derivation (legal name → venue/brand name + city)
 *   - Locale-aware search (fr-fr for French entities, de-de for German, etc.)
 *   - Multilingual query templates (EN/FR/DE/IT/ES)
 *   - City-derived domain guessing (baolicannes.com, not just baoli.com)
 *   - Corp → Person hop: extract "fondé par X / founded by X / PDG X" from snippets
 *   - Contact page crawler: /contact /equipe /team /kontakt /nous-contacter
 *   - Social handle extraction: Instagram, Twitter/X
 *   - Qwant search for French entities (better French regional coverage than DDG)
 *   - OpenCorporates removed (returns 401 for all queries since API went paid-only)
 */

import { logger } from "./logger";
import { isValidPublicEmail, sanitizePublicEmail, isGenericEmailPrefix } from "./contact-validation";

// ── Third-party financial data aggregators and news wires ─────────────────────
// Emails scraped from these domains belong to their editorial/ops teams, not the
// person being researched. Never promote them as a personal contact vector.
const FINANCIAL_AGGREGATOR_DOMAINS = new Set([
  "stocktitan.net", "seekingalpha.com", "benzinga.com", "thestreet.com",
  "marketwatch.com", "wsj.com", "bloomberg.com", "reuters.com", "ft.com",
  "businesswire.com", "prnewswire.com", "globenewswire.com", "accesswire.com",
  "globeandmail.com", "fnlondon.com", "investopedia.com", "fool.com",
  "cnbc.com", "forbes.com", "fortune.com", "barrons.com", "economist.com",
  "nytimes.com", "guardian.com", "telegraph.co.uk", "independent.co.uk",
  "finance.yahoo.com", "yahoo.com", "msn.com", "zacks.com", "nasdaq.com",
  "nyse.com", "morningstar.com", "simply.wall.st", "simplywall.st",
  "crunchbase.com", "pitchbook.com", "owler.com", "dnb.com",
  "companieshouse.gov.uk", "sec.gov", "edgaronline.com", "macroaxis.com",
  "wisesheets.io", "stockanalysis.com", "finviz.com",
  // Norwegian / Scandinavian directory services — these return their OWN contact info, not the person's
  "1881.no", "gulesider.no", "proff.no", "purehelp.no", "enhetsregisteret.no",
  "allabolag.se", "hitta.se", "eniro.se", "proff.se", "virksomhed.dk",
]);
import { extractWithAI, researchWithPerplexity, researchWithGemini, researchWithTavily, researchWithExa, type OwnerResolution } from "./ai-extractor";
import { extractPersonNames } from "./gliner-client";
import { assessTargetReachability, reachabilityDirective } from "./reachability-realism";
import { scoreCorroboration } from "./evidence-ledger";

// ── Shared utilities ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** Extract first LinkedIn URL from text.
 *  Handles:
 *  - Full URL with any subdomain: https://fr.linkedin.com/company/slug
 *  - Plain www: https://www.linkedin.com/in/slug
 *  - Protocol-free breadcrumb: fr.linkedin.com › company › slug
 *  - No-protocol path: linkedin.com/company/slug
 *  Always normalises to https://www.linkedin.com/...
 */
function extractLinkedIn(text: string): string | null {
  // 1. Full URL — any subdomain (www., fr., uk., de., …)
  const fullM = text.match(/https?:\/\/(?:[a-z]{2,5}\.)?linkedin\.com\/(in|pub|company|school)\/([a-zA-Z0-9\-_%]{2,80})\/?/i);
  if (fullM) return `https://www.linkedin.com/${fullM[1]}/${fullM[2]!.replace(/\/$/, "")}`;
  // 2. Protocol-free (breadcrumb or copy-paste): linkedin.com/company/slug
  const bareM = text.match(/(?:^|[\s(["'])(?:[a-z]{2,5}\.)?linkedin\.com\/(in|pub|company|school)\/([a-zA-Z0-9\-_%]{2,80})/i);
  if (bareM) return `https://www.linkedin.com/${bareM[1]}/${bareM[2]}`;
  return null;
}

/** Extract Instagram handle or URL from text */
function extractInstagram(text: string): string | null {
  // Full URL first
  const urlM = text.match(/https?:\/\/(www\.)?instagram\.com\/([a-zA-Z0-9._]{2,30})\/?/i);
  if (urlM) return `https://instagram.com/${urlM[2]}`;
  // @handle — must be adjacent to word like "instagram" or standalone
  const atM = text.match(/instagram[^a-z0-9]*@([a-zA-Z0-9._]{2,30})/i);
  if (atM) return `https://instagram.com/${atM[1]}`;
  return null;
}

/** Extract Twitter/X handle or URL from text */
function extractTwitter(text: string): string | null {
  const urlM = text.match(/https?:\/\/(www\.)?(twitter|x)\.com\/([a-zA-Z0-9_]{2,50})\/?/i);
  if (urlM) return `https://x.com/${urlM[3]}`;
  const atM = text.match(/twitter[^a-z0-9]*@([a-zA-Z0-9_]{2,50})/i);
  if (atM) return `https://x.com/${atM[1]}`;
  return null;
}

const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;

/**
 * Read a response body as text with a hard timeout.
 * AbortSignal.timeout() on fetch() guards the connection phase; once
 * headers arrive the signal may not interrupt a stalled chunked body in
 * all Node.js/undici versions. This wrapper closes that gap.
 */
function readBodyText(resp: Response, ms = 8_000): Promise<string> {
  return Promise.race([
    resp.text(),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error(`body read timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION A — Web OSINT Enricher (Layer 1)
// ══════════════════════════════════════════════════════════════════════════════

const DDG_API   = "https://api.duckduckgo.com/";
const EDGAR_FT  = "https://efts.sec.gov/LATEST/search-index?q=";
const GLEIF_API = "https://api.gleif.org/api/v1/fuzzycompletions?field=entity.legalName&page%5Bsize%5D=1&q=";

const FETCH_OPTS = {
  signal: AbortSignal.timeout(12_000),
  headers: {
    "User-Agent": "ApexFinder/1.0 OSINT-Research (public data only; contact research@apexfinder.private)",
    Accept: "application/json",
  },
};

export interface OsintResult {
  linkedinUrl:  string | null;
  email:        string | null;
  phone:        string | null;
  website:      string | null;
  instagramUrl: string | null;
  twitterUrl:   string | null;
  sources:      string[];
}

function extractEmailSimple(text: string): string | null {
  const matches = [...text.matchAll(EMAIL_RE)].map(m => m[0].toLowerCase());
  const filtered = matches.filter(e => isValidPublicEmail(e) && e.length < 80);
  return filtered[0] ?? null;
}

// Multi-format phone regex (international)
const PHONE_RE_SIMPLE = /\+?\d[\d\s.\-()]{6,18}\d/g;

function extractPhoneSimple(text: string): string | null {
  const m = text.match(PHONE_RE_SIMPLE);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

async function ddgInstantAnswer(query: string): Promise<{ abstract: string; url: string; relatedTopics: string[] }> {
  const url = `${DDG_API}?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  try {
    const resp = await fetch(url, FETCH_OPTS);
    if (!resp.ok) return { abstract: "", url: "", relatedTopics: [] };
    const data = await resp.json() as any;
    const topics: string[] = (data.RelatedTopics ?? [])
      .slice(0, 8)
      .map((t: any) => `${t.Text ?? ""} ${t.FirstURL ?? ""}`)
      .filter(Boolean);
    return {
      abstract: (data.AbstractText ?? "") + " " + (data.AbstractURL ?? ""),
      url: data.AbstractURL ?? "",
      relatedTopics: topics,
    };
  } catch {
    return { abstract: "", url: "", relatedTopics: [] };
  }
}

async function edgarEmailSearch(name: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(`"${name}"`);
    const url = `${EDGAR_FT}${q}&dateRange=custom&startdt=2020-01-01&forms=SC+13D,SC+13G,DEF+14A&hits.hits._source=period_of_report,entity_name,file_date&hits.hits.total=1`;
    const resp = await fetch(url, { ...FETCH_OPTS, headers: { ...FETCH_OPTS.headers, Accept: "application/json" } });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const hits: any[] = data?.hits?.hits ?? [];
    for (const hit of hits.slice(0, 2)) {
      const src = JSON.stringify(hit._source ?? {});
      const email = extractEmailSimple(src);
      if (email) return email;
    }
    return null;
  } catch {
    return null;
  }
}

async function ddgHtmlSearch(query: string, locale = "wt-wt"): Promise<string> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${locale}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ApexFinder/1.0; +https://apexfinder.private)",
        Accept: "text/html",
      },
    });
    if (!resp.ok) return "";
    const html = await readBodyText(resp);
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 8000);
  } catch {
    return "";
  }
}

/**
 * Scrape the entity's website for contact info.
 * Tries multilingual contact/about paths (EN/FR/DE/IT/ES).
 */
interface ContactPageResult {
  email:        string | null;
  linkedinUrl:  string | null;
  instagramUrl: string | null;
  twitterUrl:   string | null;
}

async function scrapeContactEmail(website: string): Promise<ContactPageResult> {
  const empty: ContactPageResult = { email: null, linkedinUrl: null, instagramUrl: null, twitterUrl: null };
  try {
    const base = website.replace(/\/$/, "");
    const tld  = (base.match(/\.([a-z]{2,3})(\/|$)/i)?.[1] ?? "").toLowerCase();
    const acceptLang =
      tld === "fr" || tld === "be" || tld === "mc" ? "fr-FR,fr;q=0.9,en;q=0.8" :
      tld === "de" || tld === "at" ? "de-DE,de;q=0.9,en;q=0.8" :
      tld === "it" ? "it-IT,it;q=0.9,en;q=0.8" :
      tld === "es" ? "es-ES,es;q=0.9,en;q=0.8" : "en-US,en;q=0.9";
    const paths = [
      "", "/contact", "/contact-us", "/about", "/team", "/equipe",
      "/nous-contacter", "/kontakt", "/impressum", "/contatti", "/contacto",
      "/about-us", "/who-we-are", "/management", "/staff",
    ];
    let found: ContactPageResult = { email: null, linkedinUrl: null, instagramUrl: null, twitterUrl: null };
    for (const path of paths) {
      try {
        const resp = await fetch(`${base}${path}`, {
          signal: AbortSignal.timeout(10_000),
          headers: {
            "User-Agent": randomUA(),
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": acceptLang,
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            "Upgrade-Insecure-Requests": "1",
          },
          redirect: "follow",
        });
        if (!resp.ok) continue;
        const html = await readBodyText(resp);

        // mailto: href is most reliable for email
        const mailtoRe = /href=["']mailto:([^"'?\s]+)/gi;
        for (const m of html.matchAll(mailtoRe)) {
          const addr = (m[1] ?? "").toLowerCase().trim();
          if (isValidPublicEmail(addr) && addr.length < 80 && !found.email) found.email = addr;
        }
        // LinkedIn company href — critical for corps: website footers always link /company/ pages
        if (!found.linkedinUrl) {
          const liHM = html.match(/href=["'](https?:\/\/(?:[a-z]{2,5}\.)?linkedin\.com\/(company|school|in|pub)\/[a-zA-Z0-9\-_%]{2,80})[^"']*/i);
          if (liHM) {
            found.linkedinUrl = liHM[1]!.replace(/\/$/, "")
              .replace(/^https?:\/\/[a-z]{2,5}\.linkedin\.com\//, "https://www.linkedin.com/");
          }
        }
        // Instagram href
        const igM = html.match(/href=["'](https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{2,30}))[^"']*/i);
        if (igM && !found.instagramUrl) found.instagramUrl = igM[1]!;
        // Twitter/X href
        const twM = html.match(/href=["'](https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]{2,50}))[^"']*/i);
        if (twM && !found.twitterUrl) found.twitterUrl = twM[1]!;

        if (!found.email) {
          const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 5000);
          found.email = extractEmailSimple(text) ?? null;
        }
        // Stop as soon as we have email + all social signals; keep going if anything missing
        if (found.email && found.linkedinUrl && found.instagramUrl && found.twitterUrl) break;
        if (found.email && found.linkedinUrl && path !== "") break; // email + LinkedIn on sub-page — enough
      } catch { /* try next */ }
    }
    return found;
  } catch {
    return empty;
  }
}

function safeParseJson<T>(str: string | null | undefined, fallback: T): T {
  try { return str ? JSON.parse(str) as T : fallback; } catch { return fallback; }
}

export interface EntityOsintInput {
  id: number;
  name: string;
  type: string;
  nationality?: string | null;
  sourceRegistries?: string | null;
  knownResidences?: string | null;
  metadata?: string | null;
}

export async function enrichEntityOsint(entity: EntityOsintInput): Promise<OsintResult> {
  const result: OsintResult = { linkedinUrl: null, email: null, phone: null, website: null, instagramUrl: null, twitterUrl: null, sources: [] };
  const name = entity.name.trim();
  if (!name || name.length < 3) return result;

  const isIndividual = entity.type === "HNWI" || /^[A-Z][a-z]+ [A-Z]/.test(name);
  const isCorp = entity.type === "Corporation" || entity.type === "Trust";
  const country = detectCountry(entity.nationality, entity.knownResidences, entity.metadata);
  const locale = countryToLocale(country);

  // Step 1: LinkedIn URL via DDG instant answer
  try {
    const liQuery = isIndividual ? `${name} linkedin profile` : `${name} company linkedin`;
    const ddgResult = await ddgInstantAnswer(liQuery);
    const allText = [ddgResult.abstract, ddgResult.url, ...ddgResult.relatedTopics].join(" ");
    const li = extractLinkedIn(allText);
    if (li) { result.linkedinUrl = li; result.sources.push("DuckDuckGo-LinkedIn"); }
  } catch (err: any) {
    logger.debug({ err: err.message }, "DDG LinkedIn search failed");
  }

  await sleep(400);

  // Step 2: Email via DDG HTML deep search (locale-aware)
  try {
    const emailQuery = isIndividual
      ? `"${name}" email contact site:linkedin.com OR site:bloomberg.com OR site:crunchbase.com`
      : `"${name}" contact email official`;
    const html = await ddgHtmlSearch(emailQuery, locale);
    if (html) {
      const email = extractEmailSimple(html);
      if (email) { result.email = email; result.sources.push("DuckDuckGo-Email"); }
      const phone = extractPhoneSimple(html);
      if (phone && !result.phone) { result.phone = phone; result.sources.push("DuckDuckGo-Phone"); }
      if (!result.linkedinUrl) {
        const li = extractLinkedIn(html);
        if (li) { result.linkedinUrl = li; result.sources.push("DuckDuckGo-HTML-LinkedIn"); }
      }
    }
  } catch (err: any) {
    logger.debug({ err: err.message }, "DDG HTML search failed");
  }

  await sleep(400);

  // Step 3: EDGAR email (for SEC-sourced entities)
  if (!result.email) {
    const sources = safeParseJson<string[]>(entity.sourceRegistries, []);
    const isEdgar = sources.some(s => /EDGAR|SEC/i.test(s));
    if (isEdgar) {
      try {
        const email = await edgarEmailSearch(name);
        if (email) { result.email = email; result.sources.push("SEC-EDGAR-Filing"); }
      } catch (err: any) {
        logger.debug({ err: err.message }, "EDGAR email search failed");
      }
      await sleep(300);
    }
  }

  // Step 3b: GLEIF LEI registry (free, no key) — corporate registered contact
  if (isCorp && !result.email) {
    try {
      const gleifUrl = `${GLEIF_API}${encodeURIComponent(name)}`;
      const resp = await fetch(gleifUrl, FETCH_OPTS);
      if (resp.ok) {
        const data = await resp.json() as any;
        const entry = data?.data?.[0]?.attributes;
        if (entry) {
          const legalAddress = entry.entity?.legalAddress;
          if (legalAddress) {
            const city = legalAddress.city ?? "";
            const co = legalAddress.country ?? "";
            if (city || co) result.sources.push(`GLEIF-LEI(${city},${co})`);
          }
          const reg = entry?.registration;
          if (reg?.managingLou) result.sources.push("GLEIF-Verified");
        }
      }
    } catch (err: any) {
      logger.debug({ err: err.message }, "GLEIF search failed");
    }
    await sleep(200);
  }

  // Step 4: Domain guess + contact page scrape (for corporations)
  // OpenCorporates removed — returns 401 for all requests since API went paid-only
  if (isCorp && !result.email) {
    const city = extractCity(entity.knownResidences, entity.metadata);
    const candidates = guessCompanyDomainWithCity(name, city);
    for (const domain of candidates.slice(0, 3)) {
      try {
        const scraped = await scrapeContactEmail(`https://${domain}`);
        if (scraped.email || scraped.linkedinUrl || scraped.instagramUrl || scraped.twitterUrl) {
          result.website = `https://${domain}`;
          if (scraped.email)        { result.email        = scraped.email;        result.sources.push(`Domain-Guess(${domain})`); }
          if (scraped.linkedinUrl)  { result.linkedinUrl  = scraped.linkedinUrl;  result.sources.push(`Domain-LI(${domain})`); }
          if (scraped.instagramUrl) { result.instagramUrl = scraped.instagramUrl; result.sources.push(`Domain-IG(${domain})`); }
          if (scraped.twitterUrl)   { result.twitterUrl   = scraped.twitterUrl;   result.sources.push(`Domain-TW(${domain})`); }
          if (scraped.email && scraped.linkedinUrl) break; // stop domain loop once we have both
          if (scraped.email) break; // stop domain loop once we have email
        }
      } catch { /* try next */ }
    }
  }

  return result;
}

// ══════════════════════════════════════════════════════════════════════════════
// SECTION B — Deep Web OSINT Enricher (Layer 2)
// ══════════════════════════════════════════════════════════════════════════════

export interface DeepWebOsintInput {
  id:               number;
  name:             string;
  type:             string;
  sourceRegistries?: string | null;
  knownResidences?:  string | null;
  metadata?:         string | null;
  bayesianScore?:    number | null;
  nationality?:      string | null;
  email?:            string | null;
  phone?:            string | null;
  contactOutcome?:   string | null;
  contactConfidence?: number | null;
  notes?:            string | null;
}

export interface DeepWebOsintResult {
  email:           string | null;
  emailConfidence: number;
  phone:           string | null;
  phoneConfidence: number;
  linkedinUrl:     string | null;
  instagramUrl:    string | null;
  twitterUrl:      string | null;
  sources:         string[];
  queriesFired:    number;
  pagesScraped:    number;
  personsDiscovered: string[];
  ownerResolutions: OwnerResolution[];
  ownershipSummary: string | null;
  ownershipSources: string[];
  evidence:        DeepWebEvidence[];
}

export interface DeepWebEvidence {
  vectorType: "email" | "phone" | "social" | "domain" | "website" | "address" | "ownership";
  value: string;
  source: string;
  sourceUrl: string | null;
  extractionMethod: string;
  confidence: number;
  details?: Record<string, unknown>;
}

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

const SKIP_DOMAINS = new Set([
  "google.com", "bing.com", "yahoo.com", "duckduckgo.com", "qwant.com",
  "amazon.com", "ebay.com", "apple.com", "microsoft.com",
  "wikipedia.org", "wikidata.org",
  "youtube.com", "tiktok.com", "pinterest.com",
]);

// Domains to exclude when harvesting corporate website candidates from Perplexity
// citations — these are known aggregators, social platforms, news wires, booking
// engines, and public registries that will never be the entity's own website.
const CITATION_SKIP_DOMAINS = new Set([
  // Search / aggregators
  "google.com", "bing.com", "yahoo.com", "duckduckgo.com", "qwant.com",
  // Social
  "linkedin.com", "twitter.com", "x.com", "instagram.com", "facebook.com",
  "youtube.com", "tiktok.com", "pinterest.com",
  // News wires & general press
  "bloomberg.com", "reuters.com", "ft.com", "wsj.com", "nytimes.com",
  "businesswire.com", "prnewswire.com", "apnews.com", "bbc.com", "bbc.co.uk",
  "lemonde.fr", "lefigaro.fr", "nicematin.com",
  // Encyclopedias / reference
  "wikipedia.org", "wikidata.org", "crunchbase.com",
  // Booking / OTAs — these are consumer sites, not corporate domains
  "booking.com", "hotels.com", "expedia.com", "tripadvisor.com", "airbnb.com",
  "agoda.com", "kayak.com", "hotelscombined.com", "trivago.com",
  // Public registries
  "companies-house.gov.uk", "sec.gov", "gleif.org", "opencorporates.com",
  "infogreffe.fr", "pappers.fr",
  // Other common non-corporate hits
  "amazon.com", "apple.com", "microsoft.com",
  // Retail / consumer brands — never a VC or Corp research target's own domain.
  // These bleed in when the entity name matches a well-known consumer brand
  // (e.g. "Target Global" VC firm → Target Corporation US retailer citations).
  "target.com", "corporate.target.com",
  "walmart.com", "costco.com", "bestbuy.com", "homedepot.com",
  "ikea.com", "zara.com", "hm.com", "primark.com",
  // PE / VC aggregators that return stale/wrong data (privateequityinternational, pitchbook, etc.)
  "privateequityinternational.com", "pitchbook.com", "preqin.com",
  "highperformr.ai",
  // German "Zielverbindungen" / translated Target Corporation pages
  "translate.google.com", "translate.googleusercontent.com",
]);

const EMAIL_BLOCK = new Set([
  "example.com", "domain.com", "email.com", "test.com", "sample.com",
  "noreply.com", "no-reply.com", "invalid.com", "placeholder.com",
  "privacy.com", "domainsbyproxy.com", "whoisguard.com", "privacyprotect.org",
  "whoisprivacycorp.com", "registrant.com",
]);

// Multi-pattern phone regex (international-aware)
const PHONE_RE_MULTI = [
  /\+\d{1,3}[\s.\-]?\(?\d{1,4}\)?[\s.\-]?\d{1,4}[\s.\-]?\d{1,9}/,
  /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/,
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
}

function jitteredDelay(baseMs: number) {
  return sleep(baseMs + Math.floor(Math.random() * 600));
}

function safeJson<T>(str: string | null | undefined, fallback: T): T {
  try { return str ? JSON.parse(str) as T : fallback; } catch { return fallback; }
}

function normaliseName(raw: string): string {
  const t = raw.trim();
  if (t !== t.toUpperCase() || !/[A-Z]{2}/.test(t)) return t;
  const parts = t.split(/\s+/);
  if (parts.length < 2) return t.charAt(0) + t.slice(1).toLowerCase();
  const tc = (s: string) => s.length <= 2 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  const [last, ...rest] = parts as [string, ...string[]];
  return [...rest, last].map(tc).join(" ");
}

// ── Country/locale detection ──────────────────────────────────────────────────

const COUNTRY_LOCALE: Record<string, string> = {
  FR: "fr-fr", DE: "de-de", IT: "it-it", ES: "es-es",
  NL: "nl-nl", BE: "fr-be", CH: "de-ch", AT: "de-at",
  GB: "uk-en", UK: "uk-en", US: "us-en", AU: "en-au",
  PT: "pt-pt", PL: "pl-pl", SE: "se-sv", DK: "dk-da",
  NO: "no-nn", FI: "fi-fi", RU: "ru-ru", AE: "en-ww",
  SG: "en-ww", HK: "en-ww",
};

/**
 * Detect country ISO-2 from entity nationality, addresses, or metadata.
 * Returns uppercase 2-letter code or null.
 */
function detectCountry(
  nationality?: string | null,
  knownResidences?: string | null,
  metadata?: string | null,
): string | null {
  // 1. Explicit nationality field
  if (nationality && /^[A-Z]{2}$/.test(nationality.trim())) return nationality.trim();

  // 2. Common nationality strings
  const nat = (nationality ?? "").toLowerCase();
  if (/french|france/i.test(nat)) return "FR";
  if (/german|germany|deutsch/i.test(nat)) return "DE";
  if (/italian|italy|italia/i.test(nat)) return "IT";
  if (/spanish|spain|españa/i.test(nat)) return "ES";
  if (/british|uk|united kingdom/i.test(nat)) return "GB";
  if (/american|usa|united states/i.test(nat)) return "US";
  if (/dutch|netherlands|holland/i.test(nat)) return "NL";
  if (/swiss|switzerland/i.test(nat)) return "CH";

  // 3. Scan addresses for country hints
  const residenceStr = typeof knownResidences === "string" ? knownResidences : "";
  const metaStr = typeof metadata === "string" ? metadata : "";
  const combined = `${residenceStr} ${metaStr}`.toLowerCase();

  if (/\bfrance\b|\bcannes\b|\bparis\b|\bnice\b|\bmonaco\b|\blyon\b|\bmarseille\b/i.test(combined)) return "FR";
  if (/\bgermany\b|\bberlin\b|\bmunich\b|\bfrankfurt\b|\bhamburg\b/i.test(combined)) return "DE";
  if (/\bitaly\b|\brome\b|\bmilan\b|\bvenice\b|\bflorence\b|\bnaples\b/i.test(combined)) return "IT";
  if (/\bspain\b|\bmadrid\b|\bbarcelona\b|\bibiza\b|\bmarbella\b/i.test(combined)) return "ES";
  if (/\buk\b|\bbritain\b|\blondon\b|\bmanchester\b|\bedinburgh\b/i.test(combined)) return "GB";
  if (/\bnetherlands\b|\bamsterdam\b|\brotterdam\b/i.test(combined)) return "NL";
  if (/\bswitzerland\b|\bzürich\b|\bgeneva\b|\bzurich\b/i.test(combined)) return "CH";
  if (/\baustralia\b|\bsydney\b|\bmelbourne\b/i.test(combined)) return "AU";

  return null;
}

function countryToLocale(country: string | null): string {
  if (!country) return "wt-wt";
  return COUNTRY_LOCALE[country] ?? "wt-wt";
}

/**
 * Extract the city name from addresses or metadata.
 * Returns the first city found or null.
 */
export function extractCity(knownResidences?: string | null, metadata?: string | null): string | null {
  const residenceStr = typeof knownResidences === "string" ? knownResidences : "";
  const metaStr = typeof metadata === "string" ? metadata : "";

  const cityFromAddress = (value: string): string | null => {
    const clean = value.replace(/\s+/g, " ").trim();
    if (!clean) return null;

    // European postal-code form: "06400 Cannes", "10115 Berlin", etc.
    const postal = clean.match(/\b\d{4,6}\s+([A-ZÀ-ÖØ-Ü][A-Za-zÀ-ÖØ-Üà-öø-ü'’\-]+(?:\s+[A-ZÀ-ÖØ-Ü][A-Za-zÀ-ÖØ-Üà-öø-ü'’\-]+){0,2})\b/);
    if (postal?.[1]) return postal[1].trim().replace(/[,.]$/, "");

    const parts = clean.split(",").map(part => part.trim()).filter(Boolean);
    if (parts.length > 1) {
      // Prefer the final locality before a country name, rather than a street.
      const last = parts[parts.length - 1]!;
      if (!/^(france|germany|italy|spain|united kingdom|uk|usa|united states|netherlands|belgium|switzerland|monaco|portugal|austria|denmark|sweden|norway|finland|poland)$/i.test(last)) {
        const withoutPostal = last.replace(/^\d{4,6}\s+/, "").trim();
        if (withoutPostal && !/^\d/.test(withoutPostal)) return withoutPostal;
      }
      const beforeCountry = parts[parts.length - 2]!;
      const withoutPostal = beforeCountry.replace(/^\d{4,6}\s+/, "").trim();
      if (withoutPostal && !/^\d/.test(withoutPostal)) return withoutPostal;
    }

    return null;
  };

  // Try to parse as JSON array of residence strings
  try {
    const parsed = JSON.parse(residenceStr);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of arr) {
      if (typeof entry === "string" && entry.length > 2) {
        const city = cityFromAddress(entry);
        if (city) return city;
      }
    }
  } catch {
    // Not JSON — treat as plain string
    if (residenceStr) {
      const city = cityFromAddress(residenceStr);
      if (city) return city;
    }
  }

  // Try metadata JSON for address fields
  try {
    const meta = JSON.parse(metaStr) as Record<string, unknown>;
    for (const key of ["city", "cityName", "registeredCity", "businessCity", "addressCity"]) {
      if (typeof meta[key] === "string" && (meta[key] as string).length > 1) {
        return (meta[key] as string).trim();
      }
    }
    // Parse from address strings — use cityFromAddress so postal-code regex fires
    for (const key of ["registeredAddress", "businessAddress", "address", "legalAddress"]) {
      if (typeof meta[key] === "string") {
        const city = cityFromAddress(meta[key] as string);
        if (city) return city;
      }
    }
  } catch { /* ignore */ }

  return null;
}

/**
 * Derive a public-facing trading name from the legal entity name + city context.
 *
 * Examples:
 *   "BAOLI SAS" + "Cannes" → "Baoli Cannes"
 *   "RIVIERA HOSPITALITY SAS" + "Cannes" → "Riviera Hospitality"
 *   "APPLE INC" + null → "Apple"
 */
const LEGAL_SUFFIXES = /\s*\b(s\.?a\.?s\.?|s\.?a\.?r\.?l\.?|s\.?a\.?|e\.?u\.?r\.?l\.?|s\.?n\.?c\.?|s\.?c\.?i\.?|gmbh|ag|kg|ohg|gbr|ltd|llc|llp|plc|inc|corp|incorporated|limited|l\.?p\.?|s\.?l\.?|s\.?r\.?l\.?|b\.?v\.?|n\.?v\.?|a\/s|ab|oy|as|sp\.?\s*z\.?\s*o\.?\s*o\.?|zrt|kft|a\.?s\.?|a\/s|asa|ehf|group|holdings|trust|international|global)\b\.?\s*$/gi;

export function deriveTradingName(legalName: string, city: string | null): string {
  // Strip legal suffix
  const stripped = legalName.replace(LEGAL_SUFFIXES, "").trim();
  // Titlecase (handles ALL CAPS legal names like "BAOLI SAS")
  const titled = stripped
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, c => c.toUpperCase())
    .trim();
  // If the city adds meaningful context (e.g. "Baoli" alone is ambiguous but "Baoli Cannes" is the known venue)
  if (city && titled.length < 12 && !titled.toLowerCase().includes(city.toLowerCase())) {
    return `${titled} ${city}`;
  }
  return titled;
}

/**
 * Guess company domains, including city-derived variants.
 *
 * "BAOLI SAS" + "Cannes" → [baolicannes.com, baoli-cannes.com, baoli.com, ...]
 */
const CORP_SUFFIX_RE = /\b(inc|llc|ltd|limited|corp|corporation|group|holdings|international|global|capital|fund|partners|advisors?|management|services|solutions|ventures|investments?|enterprises?|associates?|consulting|technologies|tech|financial|realty|properties|trust|family|l\.?p\.?|s\.?a\.?s\.?|s\.?a\.?r\.?l\.?|s\.?a\.?|gmbh|s\.?r\.?l\.?|b\.?v\.?|n\.?v\.?|a\.?g\.?)\b\.?/gi;

export function guessCompanyDomainWithCity(companyName: string, city: string | null): string[] {
  const stripped = companyName.replace(CORP_SUFFIX_RE, "").trim();
  const ascii = (value: string) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const base = ascii(stripped).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, "");
  const hyphen = ascii(stripped).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, "-");
  if (!base || base.length < 2) return [];

  const candidates: string[] = [];

  // City-derived variants first (highest relevance for location-branded venues)
  if (city) {
    const cityClean = ascii(city).replace(/[^a-z0-9]/g, "");
    // Only add city suffix when the base does NOT already contain the city.
    // "Baoli Cannes" → base="baolicannes" already includes "cannes", so skip
    // "BAOLI SAS"    → base="baoli"       doesn't include "cannes" → add baolicannes.com
    if (cityClean && cityClean !== base && !base.includes(cityClean)) {
      candidates.push(`${base}${cityClean}.com`);
      candidates.push(`${base}-${cityClean}.com`);
      candidates.push(`${hyphen}${cityClean}.com`);
    }
  }

  // Standard variants — include .vc for venture capital firms
  candidates.push(`${base}.com`, `${hyphen}.com`, `${base}.co`, `${base}.io`,
    `${base}.vc`, `${hyphen}.vc`, `${base}.org`, `${base}.net`,
    `${base}.co.uk`, `${base}.fr`, `${base}.de`);

  return [...new Set(candidates)].slice(0, 8);
}

// ── Person-hop: extract candidate person names from search text ───────────────

/**
 * Extract person name candidates from a body of search result text.
 * Uses keyword patterns in English, French, German, Italian, Spanish.
 * Returns deduplicated list of "Firstname Lastname" strings.
 */
const PERSON_PATTERNS: RegExp[] = [
  // English
  /(?:founded|owned|run|led|managed|created|started|built|established|operated)\s+by\s+([A-ZÀ-ÖØ-Ü][a-zà-öø-ü]+(?:[\s\-][A-ZÀ-ÖØ-Ü][a-zà-öø-ü\-]+){1,3})/g,
  /(?:CEO|CFO|COO|CTO|CMO|owner|co-owner|founder|co-founder|director|chairman|president|partner|principal|managing director)\s*[:\-]?\s*([A-ZÀ-ÖØ-Ü][a-zà-öø-ü]+\s+[A-ZÀ-ÖØ-Ü][a-zà-öø-ü\-]+)/g,
  // French
  /(?:fondé par|fondateur|co-fondateur|propriétaire|co-propriétaire|gérant|directeur général|PDG|DG|directeur|associé)\s*[:\-]?\s*([A-ZÀ-ÖØ-ÜÉÈÊËÀÂÙÛÜÇÎÏÔŒæœ][a-zà-öø-üéèêëàâùûüçîïôœ]+(?:[\s\-][A-ZÀ-ÖØ-Ü][a-zà-öø-ü\-]+){1,2})/g,
  /(?:M\.|M |Mme\.?|Mme |Monsieur|Madame)\s+([A-ZÀ-ÖØ-Ü][a-zà-öø-ü]+\s+[A-ZÀ-ÖØ-Ü][a-zà-öø-ü\-]+)/g,
  // German
  /(?:Inhaber|Geschäftsführer|Gründer|Mitgründer|Eigentümer|Gesellschafter|Vorstand|Vorsitzender)\s*[:\-]?\s*([A-ZÄÖÜ][a-zäöü]+\s+[A-ZÄÖÜ][a-zäöü\-]+)/g,
  // Italian
  /(?:fondato da|fondatore|proprietario|titolare|amministratore|socio)\s*[:\-]?\s*([A-ZÀ-ÖØ-Ü][a-zà-öø-ü]+\s+[A-ZÀ-ÖØ-Ü][a-zà-öø-ü\-]+)/g,
  // Spanish
  /(?:fundado por|fundador|propietario|dueño|director|socio)\s*[:\-]?\s*([A-ZÀ-ÖØ-Ü][a-zà-öø-ü]+\s+[A-ZÀ-ÖØ-Ü][a-zà-öø-ü\-]+)/g,
  // ── Subject-position patterns (name BEFORE the keyword) ────────────────────
  // French: "Christophe Caucino et Pierre Navarro ont fondé Bâoli"
  // Captures the first person before "et ... ont fondé"
  /([A-ZÀ-ÖØ-Ü][a-zà-öø-üéèêëàâùûüçîïôœ\-]+\s+[A-ZÀ-ÖØ-Ü][a-zà-öø-üéèêëàâùûüçîïôœ\-]+(?:-[A-ZÀ-ÖØ-Ü][a-zà-öø-üéèêëàâùûüçîïôœ\-]+)?)\s+(?:et\s+\S+\s+\S+\s+)?(?:a|ont)\s+(?:fondé|créé|lancé|ouvert|inauguré|cofondé|co-fondé|développé|ouvert)/g,
  // French: captures the second person in "Caucino et Pierre Navarro ont fondé"
  /[A-ZÀ-ÖØ-Ü][a-zà-öø-ü\-]+\s+[A-ZÀ-ÖØ-Ü][a-zà-öø-ü\-]+\s+et\s+([A-ZÀ-ÖØ-Ü][a-zà-öø-üéèêëàâùûüçîïôœ\-]+\s+[A-ZÀ-ÖØ-Ü][a-zà-öø-üéèêëàâùûüçîïôœ\-]+(?:-[A-ZÀ-ÖØ-Ü][a-zà-öø-üéèêëàâùûüçîïôœ\-]+)?)\s+(?:ont|a)\s+(?:fondé|créé|lancé)/g,
  // English subject-position: "Person founded/started/co-founded/created"
  /([A-Z][a-zA-Z\-]+\s+[A-Z][a-zA-Z\-]+(?:\s+[A-Z][a-zA-Z\-]+)?)\s+(?:founded|co-founded|created|started|launched|established|built|opened)/g,
  // Appositive: "Name, founder/owner/CEO of X"
  /([A-Z][a-zA-Z\-]+\s+[A-Z][a-zA-Z\-]+(?:\s+[A-Z][a-zA-Z\-]+)?),\s*(?:founder|co-founder|owner|CEO|president|chairman|director|managing director)/gi,
  // French appositive: "Name, fondateur/propriétaire/PDG de X"
  /([A-ZÀ-ÖØ-Ü][a-zà-öø-üéèêëàâùûüçîïôœ\-]+\s+[A-ZÀ-ÖØ-Ü][a-zà-öø-üéèêëàâùûüçîïôœ\-]+(?:-[A-ZÀ-ÖØ-Ü][a-zà-öø-ü\-]+)?),\s*(?:fondateur|co-fondateur|propriétaire|gérant|directeur général|PDG|président)/g,
  // German subject-position: "Person gründete/eröffnete"
  /([A-ZÄÖÜ][a-zäöü\-]+\s+[A-ZÄÖÜ][a-zäöü\-]+)\s+(?:gründete|gründeten|eröffnete|eröffneten|gründete)/g,
];

// Common first/last name parts that are NOT person names
const NOT_A_PERSON = new Set([
  "the", "and", "or", "of", "in", "at", "for", "to", "by",
  "le", "la", "les", "de", "du", "des", "un", "une", "sur", "avec", "par",
  "und", "der", "die", "das", "von", "zu",
  "the company", "the group", "the firm", "the club", "the hotel",
]);

// Individual words that disqualify a regex match from being a real person name.
// Catches garbage like "Hotels CEO", "Group COO", "Capital Partners".
const PERSON_WORD_BLOCKLIST = new Set([
  // Job titles that appear as the second "word" in false-positive captures
  "CEO", "CFO", "COO", "CTO", "CMO", "CXO", "SVP", "EVP", "VP", "MD",
  // Company-type words that should never be part of a person name
  "Hotels", "Hotel", "Group", "Holdings", "Capital", "Partners", "Management",
  "International", "Global", "Hospitality", "Properties", "Trust", "Fund",
  "Ventures", "Asset", "Assets", "Equity", "Private", "Investment",
  "Investments", "Corporation", "Consulting", "Solutions", "Services",
  "Technologies", "Industries", "Enterprises", "Associates",
  // Finance/banking subsidiary words
  "Financement", "Participations", "Participation", "Finance", "Financing",
  "Bank", "Banque", "Crédit", "Credit", "Fonds", "Gestion", "Investissement",
  "Holding", "Groupe", "Société", "Compagnie",
  // UI artifacts from scraped pages — buttons, nav items, form labels
  "Submit", "Images", "Image", "Chat", "Search", "Login", "Register",
  "Contact", "Menu", "Home", "Back", "Next", "More", "View", "Download",
  "Upload", "Send", "Save", "Cancel", "Close", "Open", "Click",
  // French UI / web navigation artifacts
  "Recherche", "Rechercher", "Discuter", "Notre", "Connexion", "Accueil",
  "Retour", "Suivant", "Télécharger", "Envoyer", "Annuler",
  // German UI
  "Suche", "Anmelden", "Weiter", "Zurück",
  // Common city/geography words that appear in entity names
  "Paris", "London", "Berlin", "Lyon", "Bordeaux", "Marseille",
  // Qwant / search engine UI tokens
  "Qwant", "Google", "Bing", "Yahoo", "DuckDuckGo",
  // Generic org/state words that slip through as "person" names
  "State", "Government", "Ministry", "Agency", "Authority", "Commission",
  "Federation", "Republic", "Nation",
  // Product, service, and institution words from search snippets
  "Endpoint", "Acrylic", "Powder", "Gel", "Polish",
  "Air", "Force", "Marine", "Corps", "Coast", "Guard",
  "United", "States",
  // Governance / org structure words that look like names
  "Executive", "Committee", "Board", "Director", "Directors", "Officer",
  "Chairman", "Chairwoman", "Chairperson", "Trustee", "Trustees",
  // Street / address components — "Pall Mall", "Park Lane", etc.
  "Mall", "Street", "Avenue", "Road", "Lane", "Place", "Square", "Court",
  "Drive", "Boulevard", "Way", "Row", "Gardens", "Terrace", "Close",
  "Pall", "Park", "Bridge", "Gate", "Hill", "House", "Tower",
  // Geographic regions / continents — "North America", "South Asia", etc.
  "North", "South", "East", "West", "Central",
  "America", "Europe", "Asia", "Africa", "Pacific", "Atlantic", "Americas",
  "Latin", "Middle", "Nordic", "Nordics",
  // Country names — "Ardian France", "Target Germany" etc. must not pass as person names
  "France", "Germany", "Italy", "Spain", "Netherlands", "Belgium", "Switzerland",
  "Austria", "Sweden", "Norway", "Denmark", "Finland", "Portugal", "Poland",
  "Ireland", "Luxembourg", "Singapore", "Emirates", "Kingdom", "Japan", "China",
  "Korea", "Australia", "Canada", "Mexico", "Brazil", "India", "Russia",
  "Turkey", "Greece", "Romania", "Hungary", "Croatia", "Ukraine", "Israel",
  "Egypt", "Morocco", "Nigeria", "Kenya", "Ghana", "Tanzania",
  // French/Spanish/Italian/German job-title words that slip through as surnames
  "Directeur", "Directrice", "Général", "Générale", "Président", "Présidente",
  "Gérant", "Gérants", "Gérance", "Associé", "Associée", "Associés",
  "Fondateur", "Fondatrice", "Dirigeant", "Dirigeante", "Responsable",
  "Directora", "Director", "Presidente", "Socio", "Gerente", "Fundador",
  "Geschäftsführer", "Vorstand", "Vorsitzender", "Inhaber",
  "Managing", "Senior", "General", "Principal", "Chief", "Head",
  "Partner", "Partners",  // already blocked via company-type but add here for person filter
]);

/** Returns true when a string looks like a real human name (2–4 capitalised words,
 *  no job-title or company-type tokens). Used to filter owner-resolution pushes. */
export function looksLikePersonName(name: string): boolean {
  // Reject immediately if string contains newlines, tabs, or non-printable chars
  if (/[\n\r\t\x00-\x1f]/.test(name)) return false;
  // Reject if it contains digits (addresses, phone numbers, codes)
  if (/\d/.test(name)) return false;
  const words = name.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  // Every word must open with a true uppercase letter and contain only letters/hyphens
  if (!words.every(w => /^[A-ZÀ-ÖØ-Ü][a-zA-ZÀ-öø-ÿ\-']*$/.test(w))) return false;
  // Reject if any word is a known role or company-type indicator
  if (words.some(w => PERSON_WORD_BLOCKLIST.has(w))) return false;
  // Reject if all words are ALL-CAPS (abbreviations, company codes)
  if (words.every(w => w === w.toUpperCase() && w.length > 1)) return false;
  return true;
}

function extractPersonCandidates(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of PERSON_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    for (const m of text.matchAll(re)) {
      const name = (m[1] ?? "").trim();
      if (name.length < 4 || name.length > 60) continue;
      const lower = name.toLowerCase();
      if (NOT_A_PERSON.has(lower)) continue;
      // Must have at least two words, each opening with a TRUE uppercase letter
      const words = name.split(/\s+/);
      if (words.length < 2) continue;
      if (!words.every(w => /^[A-ZÀ-ÖØ-Ü]/.test(w))) continue;
      // Reject job titles / company words masquerading as person names
      if (words.some(w => PERSON_WORD_BLOCKLIST.has(w))) continue;
      found.add(name);
    }
  }
  return [...found].slice(0, 5); // max 5 person candidates per entity
}

/**
 * GLiNER-enhanced async version of extractPersonCandidates.
 * When the GLiNER NER microservice is running (port 7890), uses zero-shot NER
 * which eliminates the entire class of regex false-positives ("Hotels CEO", etc.).
 * Falls back to the regex implementation automatically when service is unavailable.
 */
async function extractPersonCandidatesAsync(text: string): Promise<string[]> {
  if (!text?.trim()) return [];
  try {
    // Try GLiNER first — it's more accurate and handles multilingual text natively
    const glinerResults = await extractPersonNames(text, 0.5);
    if (glinerResults.length > 0) {
      // Filter through the same blocklist for consistency
      return glinerResults
        .map(r => r.name.trim())
        .filter(name => {
          const words = name.split(/\s+/);
          if (words.length < 2 || words.length > 4) return false;
          if (!words.every(w => /^[A-ZÀ-ÖØ-Ü]/.test(w))) return false;
          if (words.some(w => PERSON_WORD_BLOCKLIST.has(w))) return false;
          if (NOT_A_PERSON.has(name.toLowerCase())) return false;
          return true;
        })
        .slice(0, 5);
    }
  } catch { /* fall through to regex */ }
  // Regex fallback
  return extractPersonCandidates(text);
}

// ── Search engine functions ───────────────────────────────────────────────────

interface SearchResult {
  text:   string;
  urls:   string[];
  engine: string;
  sourceUrl?: string;
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

function extractBingUrls(html: string): string[] {
  const urls: string[] = [];
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

function extractQwantUrls(html: string): string[] {
  const urls: string[] = [];
  const hrefRe = /href="(https?:\/\/(?!www\.qwant\.com)[^"]+)"/g;
  for (const m of html.matchAll(hrefRe)) {
    try {
      const url = m[1]!;
      const domain = new URL(url).hostname.replace(/^www\./, "");
      if (!SKIP_DOMAINS.has(domain)) urls.push(url);
    } catch { /* skip */ }
  }
  return [...new Set(urls)].slice(0, 8);
}

async function duckduckgoSearch(query: string, locale = "wt-wt"): Promise<SearchResult> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${locale}`;
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
    if (!resp.ok) return { text: "", urls: [], engine: "DDG", sourceUrl: url };
    const html = await readBodyText(resp);
    return { text: stripHtml(html).slice(0, 12_000), urls: extractDdgUrls(html), engine: "DDG", sourceUrl: url };
  } catch (err: any) {
    logger.debug({ err: err?.message, query }, "DDG search failed");
    return { text: "", urls: [], engine: "DDG", sourceUrl: url };
  }
}

async function bingSearch(query: string, country: string | null): Promise<SearchResult> {
  const cc = country ?? "US";
  const setlang = country === "FR" ? "fr" : country === "DE" ? "de" : country === "IT" ? "it" : country === "ES" ? "es" : "en";
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=${setlang}&cc=${cc}&first=1`;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(14_000),
      headers: {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": setlang === "fr" ? "fr-FR,fr;q=0.9" : "en-US,en;q=0.5",
        Referer: "https://www.bing.com/",
      },
    });
    if (!resp.ok) return { text: "", urls: [], engine: "Bing", sourceUrl: url };
    const html = await readBodyText(resp);
    return { text: stripHtml(html).slice(0, 12_000), urls: extractBingUrls(html), engine: "Bing", sourceUrl: url };
  } catch (err: any) {
    logger.debug({ err: err?.message, query }, "Bing search failed");
    return { text: "", urls: [], engine: "Bing", sourceUrl: url };
  }
}

/**
 * Qwant search — French search engine with much better coverage of French
 * regional media, local business directories, and French-language content
 * compared to DuckDuckGo. Used for FR/BE/CH/MC entities.
 */
async function qwantSearch(query: string, locale = "fr_FR"): Promise<SearchResult> {
  const url = `https://www.qwant.com/?q=${encodeURIComponent(query)}&t=web&locale=${locale}&uiv=4`;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(14_000),
      headers: {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5",
        Referer: "https://www.qwant.com/",
      },
    });
    if (!resp.ok) return { text: "", urls: [], engine: "Qwant", sourceUrl: url };
    const html = await readBodyText(resp);
    return { text: stripHtml(html).slice(0, 12_000), urls: extractQwantUrls(html), engine: "Qwant", sourceUrl: url };
  } catch (err: any) {
    logger.debug({ err: err?.message, query }, "Qwant search failed");
    return { text: "", urls: [], engine: "Qwant", sourceUrl: url };
  }
}

// ── Wikipedia lookup — free, no auth, best structured person-company data ────
/**
 * Look up the entity's trading name on Wikipedia (native language first,
 * then English). Returns the plain-text extract from the page summary, which
 * typically names founders, CEOs, and key personnel directly.
 *
 * Uses the Wikipedia REST v1 summary endpoint (no authentication required).
 * Fails silently on timeout or 404.
 */
async function wikipediaLookup(
  tradingName: string,
  country: string | null,
): Promise<{ extract: string; pageUrl: string } | null> {
  // Choose the most likely Wikipedia language edition for the entity's country
  const lang =
    country === "FR" || country === "BE" || country === "MC" || country === "LU" ? "fr" :
    country === "DE" || country === "AT" ? "de" :
    country === "IT" ? "it" :
    country === "ES" ? "es" :
    country === "NO" ? "no" :
    country === "SE" ? "sv" :
    country === "DK" ? "da" :
    country === "NL" || country === "BE" ? "nl" :
    country === "CH" ? "de" : "en";

  async function tryLang(wikiLang: string): Promise<{ extract: string; pageUrl: string } | null> {
    try {
      // Step 1: search for the page title
      const searchUrl = `https://${wikiLang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(tradingName)}&format=json&utf8=1&srlimit=1&srprop=snippet`;
      const searchResp = await fetch(searchUrl, {
        headers: { "User-Agent": "ApexFinder/1.0 OSINT-Research (contact discovery only)" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!searchResp.ok) return null;
      const searchData = (await searchResp.json()) as any;
      const title: string = searchData?.query?.search?.[0]?.title ?? "";
      if (!title) return null;

      // Step 2: fetch the page summary (includes extract with named persons)
      const summaryUrl = `https://${wikiLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const summaryResp = await fetch(summaryUrl, {
        headers: { "User-Agent": "ApexFinder/1.0 OSINT-Research (contact discovery only)" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!summaryResp.ok) return null;
      const summary = (await summaryResp.json()) as any;
      const extract: string = summary?.extract ?? "";
      if (!extract || extract.length < 30) return null;
      const pageUrl: string = summary?.content_urls?.desktop?.page ?? "";
      return { extract, pageUrl };
    } catch {
      return null;
    }
  }

  const result = await tryLang(lang);
  if (result) return result;
  // Fall back to English if native-language search found nothing
  if (lang !== "en") return tryLang("en");
  return null;
}

interface ScrapedPage {
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  twitterUrl: string | null;
  text: string;
  links: string[];
  /** True when the response is a Cloudflare/bot-protection challenge, not real page content. */
  botBlocked: boolean;
}

function emptyScrapedPage(): ScrapedPage {
  return { email: null, phone: null, linkedinUrl: null, instagramUrl: null, twitterUrl: null, text: "", links: [], botBlocked: false };
}

function extractPageLinks(html: string, pageUrl: string): string[] {
  const links = new Set<string>();
  let base: URL;
  try { base = new URL(pageUrl); } catch { return []; }
  const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(hrefRe)) {
    const raw = (match[1] ?? "").trim();
    if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript):/i.test(raw)) continue;
    try {
      const resolved = new URL(raw, base);
      if (!/^https?:$/i.test(resolved.protocol)) continue;
      if (resolved.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
      resolved.hash = "";
      links.add(resolved.toString());
    } catch { /* ignore malformed links */ }
  }
  return [...links].slice(0, 24);
}

function extractEmailsWithObfuscation(text: string): string[] {
  const normalized = text
    .replace(/\s*(?:\[|\(|\{)\s*at\s*(?:\]|\)|\})\s*/gi, "@")
    .replace(/\s+(?:at|chez)\s+/gi, "@")
    .replace(/\s*(?:\[|\(|\{)\s*dot\s*(?:\]|\)|\})\s*/gi, ".")
    .replace(/\s+dot\s+/gi, ".")
    .replace(/\s*@\s*/g, "@");
  return extractEmails(normalized);
}

export function extractPhone(text: string): string | null {
  const patterns = [
    // International formats, including French "(0)4 93..." notation.
    /\+\d{1,3}\s*(?:\(\s*0\s*\)\s*)?(?:\(?\d{1,4}\)?[\s.\-]?){2,6}\d/,
    // Local European numbers such as 04 93 43 03 43 or 01.42.68.53.00.
    /\b0\d(?:[\s.\-]?\d){8,}\b/,
    // North American numbers.
    /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const candidate = match[0].replace(/\s+/g, " ").trim();
    if ((candidate.match(/\d/g) ?? []).length >= 8) return candidate;
  }
  return null;
}

/**
 * Detect whether an HTML response is a Cloudflare / bot-protection challenge page.
 * These pages return HTTP 200 but contain JS challenge code, not the real site.
 * Triggers include: Avada themes, Cloudflare Turnstile, CAPTCHA redirects.
 */
function isBotBlock(html: string, strippedText: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("cf_chl_opt") ||
    lower.includes("challenge-platform") ||
    lower.includes("jschl-answer") ||
    lower.includes("__cf_bm") ||
    lower.includes("cf_clearance") ||
    (lower.includes("checking your browser") && lower.includes("cloudflare")) ||
    lower.includes("enable javascript and cookies to continue") ||
    lower.includes("please enable javascript") ||
    lower.includes("ddos-guard") ||
    lower.includes("human verification") ||
    strippedText.length < 200
  );
}

async function scrapePage(url: string): Promise<ScrapedPage> {
  // Infer a reasonable Accept-Language from the target domain so French/German
  // sites get their preferred locale (reduces likelihood of redirect or block).
  const tld = (url.match(/\.([a-z]{2,3})(\/|$)/i)?.[1] ?? "").toLowerCase();
  const acceptLang =
    tld === "fr" || tld === "be" || tld === "mc" ? "fr-FR,fr;q=0.9,en;q=0.8" :
    tld === "de" || tld === "at" ? "de-DE,de;q=0.9,en;q=0.8" :
    tld === "it" ? "it-IT,it;q=0.9,en;q=0.8" :
    tld === "es" ? "es-ES,es;q=0.9,en;q=0.8" :
    tld === "nl" || tld === "be" ? "nl-NL,nl;q=0.9,en;q=0.8" :
    "en-US,en;q=0.9";

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": acceptLang,
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "Connection": "keep-alive",
      },
      redirect: "follow",
    });
    if (!resp.ok) return emptyScrapedPage();
    const html = await readBodyText(resp, 10_000).then(h => h.slice(0, 80_000));

    // mailto: href is most reliable source
    let email: string | null = null;
    const mailtoRe = /href=["']mailto:([^"'?\s]+)/gi;
    for (const m of html.matchAll(mailtoRe)) {
      const addr = m[1]!.toLowerCase().trim();
      const domain = addr.split("@")[1] ?? "";
      const clean = sanitizePublicEmail(addr);
      if (clean && clean.length < 80 && !EMAIL_BLOCK.has(domain)) {
        email = clean;
        break;
      }
    }

    let linkedinUrl: string | null = null;
    // Match /company/, /school/, /in/, /pub/ — all LinkedIn entity types found in footers/headers
    const liRe = /href=["'](https?:\/\/(?:[a-z]{2,5}\.)?linkedin\.com\/(company|school|in|pub)\/[a-zA-Z0-9\-_%]{2,80})[^"']*/i;
    const liM = html.match(liRe);
    if (liM) {
      // Normalise country subdomains (fr.linkedin.com → www.linkedin.com)
      linkedinUrl = liM[1]!.replace(/\/$/, "")
        .replace(/^https?:\/\/[a-z]{2,5}\.linkedin\.com\//, "https://www.linkedin.com/");
    }

    // Instagram from link tags
    let instagramUrl: string | null = null;
    const igRe = /href=["'](https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]{2,30}))[^"']*/i;
    const igM = html.match(igRe);
    if (igM) instagramUrl = igM[1]!;

    // Twitter/X from link tags
    let twitterUrl: string | null = null;
    const twRe = /href=["'](https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]{2,50}))[^"']*/i;
    const twM = html.match(twRe);
    if (twM) twitterUrl = twM[1]!;

    const text = stripHtml(html).slice(0, 15_000);
    const botBlocked = isBotBlock(html, text);

    if (!email) email = extractEmailsWithObfuscation(text)[0] ?? null;
    const phone = extractPhone(text);
    if (!linkedinUrl) linkedinUrl = extractLinkedIn(text);
    if (!instagramUrl) instagramUrl = extractInstagram(text);
    if (!twitterUrl) twitterUrl = extractTwitter(text);

    return { email, phone, linkedinUrl, instagramUrl, twitterUrl, text, links: extractPageLinks(html, url), botBlocked };
  } catch {
    return emptyScrapedPage();
  }
}

/**
 * Try contact/about/team pages on a discovered domain.
 * Multilingual paths cover EN/FR/DE/IT/ES sites.
 *
 * For Corp entities (VC firms, law firms, consultancies) team/partners pages are
 * prioritised FIRST — they list ALL named partners, not just a single contact email.
 * The result cap is also raised so we don't stop after the first email hit.
 */
/**
 * Fetch the most recent Wayback Machine snapshot URL for a specific page URL.
 * Used as fallback when a sub-page (e.g. /team on a JS SPA) is bot-blocked or near-empty.
 */
async function waybackPageUrl(pageUrl: string): Promise<string | null> {
  try {
    const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(pageUrl)}&output=json&filter=statuscode:200&filter=mimetype:text/html&collapse=urlkey&fl=timestamp,original&limit=3`;
    const resp = await fetch(cdxUrl, {
      signal: AbortSignal.timeout(3_000),
      headers: { "User-Agent": "ApexFinder/1.0 public OSINT research" },
    });
    if (!resp.ok) return null;
    const rows = await resp.json() as unknown;
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const row = rows[1];
    if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string") return null;
    return `https://web.archive.org/web/${row[0]}id_/${row[1]}`;
  } catch { return null; }
}

async function findContactPages(domain: string, isCorp = false): Promise<{
  url: string;
  scraped: ScrapedPage;
}[]> {
  // Corp path order: team/partners FIRST, then contact/about.
  // Venue/individual path order: contact FIRST (faster single-contact resolution).
  const corpPaths = [
    "/team", "/our-team", "/partners", "/people", "/leadership", "/equipe",
    "/our-partners", "/management", "/staff", "/about", "/about-us",
    "/qui-sommes-nous", "/contact", "/contact-us", "/contactez-nous",
    "/nous-contacter", "/uber-uns", "/kontakt", "/impressum",
  ];
  const venuePaths = [
    "/contact", "/contact-us", "/contactez-nous", "/nous-contacter",
    "/about", "/about-us", "/qui-sommes-nous", "/uber-uns",
    "/team", "/equipe", "/our-team", "/staff", "/management",
    "/kontakt", "/impressum", "/contatti", "/contacto",
    "/reservation", "/reservations", "/book", "/booking",
  ];
  const paths = isCorp ? corpPaths : venuePaths;
  // Corp cap raised — we want all team pages, not just the first email.
  // 16 paths × 10s max each = 160s worst case (acceptable for VC/Corp research).
  const cap = isCorp ? 16 : 12;
  const resultCap = isCorp ? 8 : 4;
  const candidates = paths.slice(0, cap).map(path => `https://${domain}${path}`);
  const seen = new Set<string>();
  const results: Array<{ url: string; scraped: ScrapedPage }> = [];
  for (const url of candidates) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      let scraped = await scrapePage(url);
      // Wayback fallback for bot-blocked or near-empty sub-pages (JS SPAs like VC firm /team pages).
      // A JS SPA returns a nearly empty HTML shell to server-side fetch — detect and recover.
      if (scraped.botBlocked || (scraped.text.length < 300 && !scraped.email && !scraped.phone && !scraped.linkedinUrl)) {
        const wbUrl = await waybackPageUrl(url);
        if (wbUrl) {
          try {
            const wb = await scrapePage(wbUrl);
            // Only upgrade if Wayback gave us more content
            if (wb.text.length > scraped.text.length || wb.email || wb.phone || wb.linkedinUrl) {
              scraped = wb;
            }
          } catch { /* keep original scraped */ }
        }
      }
      if (scraped.email || scraped.phone || scraped.linkedinUrl || scraped.instagramUrl || scraped.twitterUrl) {
        results.push({ url, scraped });
        if (results.length >= resultCap) break;
      }
    } catch { /* next path */ }
    await sleep(300);
  }
  return results;
}

async function waybackSnapshotUrls(domain: string): Promise<string[]> {
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}/*&output=json&filter=statuscode:200&filter=mimetype:text/html&collapse=urlkey&fl=timestamp,original&limit=20`;
  try {
    const response = await fetch(cdxUrl, {
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "ApexFinder/1.0 public OSINT research" },
    });
    if (!response.ok) return [];
    const rows = await response.json() as unknown;
    if (!Array.isArray(rows)) return [];
    const urls: string[] = [];
    for (const row of rows.slice(1)) {
      if (!Array.isArray(row) || typeof row[0] !== "string" || typeof row[1] !== "string") continue;
      urls.push(`https://web.archive.org/web/${row[0]}id_/${row[1]}`);
    }
    return [...new Set(urls)].slice(0, 8);
  } catch {
    return [];
  }
}

function extractEmails(text: string): string[] {
  const all = [...text.matchAll(EMAIL_RE)].map(m => m[0]!.toLowerCase());
  return [...new Set(all.filter(e => {
    const d = e.split("@")[1] ?? "";
    return isValidPublicEmail(e) && e.length < 80 && !EMAIL_BLOCK.has(d);
  }))];
}

// ── Query builder (Phase K overhaul) ─────────────────────────────────────────

/**
 * Build search queries using:
 * - Trading name (not raw legal name)
 * - City context
 * - Language-specific templates
 * - Direct domain targets
 */
export function buildDeepWebQueries(
  entity: DeepWebOsintInput,
  tradingName: string,
  city: string | null,
  country: string | null,
): { queries: string[]; domainTargets: string[] } {
  const legalName = normaliseName(entity.name.trim());
  if (!legalName || legalName.length < 4) return { queries: [], domainTargets: [] };

  if (/^\d+\s/.test(legalName) || /\b(flat|house|cottage|manor|farm|apartment)\s+\d/i.test(legalName)) {
    return { queries: [], domainTargets: [] };
  }

  const isIndividual = entity.type === "HNWI" || entity.type === "Gatekeeper" ||
    /^[A-Z][a-z]+ [A-Z]/.test(legalName);
  const isCorp = !isIndividual;
  const meta = safeJson<Record<string, unknown>>(entity.metadata, {});

  const queries: string[] = [];
  const domainTargets: string[] = [];

  const isFrench  = country === "FR" || country === "BE" || country === "MC";
  const isGerman  = country === "DE" || country === "AT" || country === "CH";
  const isItalian = country === "IT";
  const isSpanish = country === "ES";

  if (isIndividual) {
    queries.push(`"${legalName}" email contact`);
    queries.push(`"${legalName}" linkedin`);

    const nNumber = typeof meta["nNumber"] === "string" ? meta["nNumber"] as string : null;
    if (nNumber) {
      queries.push(`"${nNumber}" aircraft owner contact email`);
      queries.push(`"${legalName}" pilot aviation email`);
    }

    const companyName = typeof meta["companyName"] === "string" ? (meta["companyName"] as string).trim() : null;
    if (companyName && companyName !== legalName) {
      queries.push(`"${legalName}" "${companyName.substring(0, 40)}" contact`);
    } else if (typeof meta["formType"] === "string") {
      queries.push(`"${legalName}" investor director SEC contact email`);
    }

    if (city && city !== legalName) {
      queries.push(`"${legalName}" ${city} contact email phone`);
    }

    if (isFrench) {
      queries.push(`"${legalName}" contact email France`);
    }
  }

  if (isCorp) {
    // Use TRADING name for all queries — not the raw legal name
    // Legal name ("BAOLI SAS") never appears in press, venue guides, or social profiles
    // Trading name ("Baoli Cannes") is what the public knows

    // Guard: when the trading name already contains the city ("Baoli Cannes"),
    // don't generate "${tradingName} ${city}" queries — they produce "Baoli Cannes Cannes …"
    const tradingHasCity = !!(city && tradingName.toLowerCase().includes(city.toLowerCase()));

    // Primary: trading name + city + contact keywords
    if (tradingName !== legalName) {
      queries.push(`"${tradingName}" contact email`);
      if (city && !tradingHasCity) queries.push(`"${tradingName}" ${city} contact email`);
    }
    // Always include legal name as fallback for corporate directory hits
    queries.push(`"${legalName}" contact email`);

    // City-context queries (high yield for local hospitality/venue targets)
    if (city && !tradingHasCity) {
      queries.push(`${tradingName} ${city} email réservations contact`);
      queries.push(`${tradingName} ${city} owner founder manager`);
    }

    // Language-specific templates
    if (isFrench) {
      queries.push(`"${tradingName}" contact réservations email`);
      queries.push(`"${tradingName}" propriétaire fondateur dirigeant`);
      if (city && !tradingHasCity) queries.push(`${tradingName} ${city} fondateur email`);
    }
    if (isGerman) {
      queries.push(`"${tradingName}" Kontakt email Inhaber Geschäftsführer`);
      queries.push(`"${tradingName}" Gründer Eigentümer`);
    }
    if (isItalian) {
      queries.push(`"${tradingName}" contatti email fondatore titolare`);
    }
    if (isSpanish) {
      queries.push(`"${tradingName}" contacto email fundador propietario`);
    }

    // English fallback
    queries.push(`"${tradingName}" CEO owner founder contact`);

    // LinkedIn company page — surfaces /company/<slug> URL via snippet
    queries.push(`"${tradingName}" linkedin`);

    // VC / PE firms: explicitly search for partners and GPs by name
    queries.push(`"${tradingName}" general partner managing partner team`);
    queries.push(`"${tradingName}" partners founders site:crunchbase.com OR site:pitchbook.com OR site:linkedin.com`);

    // Domain guessing — add to direct scrape targets, not search queries
    const domains = guessCompanyDomainWithCity(legalName, city);
    domainTargets.push(...domains.slice(0, 4));
  }

  return {
    queries: [...new Set(queries)].slice(0, 10),
    domainTargets: [...new Set(domainTargets)],
  };
}

function scoreByCorroboration(
  sources: number,
  evidence: Array<{ value: string; sourceUrl?: string | null }>,
  value: string,
): number {
  const matchingEvidence = evidence.filter(
    (item) => item.value.trim().toLowerCase() === value.trim().toLowerCase() && item.sourceUrl,
  );
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

export async function deepWebOsintEnrich(entity: DeepWebOsintInput): Promise<DeepWebOsintResult> {
  const result: DeepWebOsintResult = {
    email: null, emailConfidence: 0,
    phone: null, phoneConfidence: 0,
    linkedinUrl: null,
    instagramUrl: null,
    twitterUrl: null,
    sources: [], queriesFired: 0, pagesScraped: 0,
    personsDiscovered: [],
    ownerResolutions: [],
    ownershipSummary: null,
    ownershipSources: [],
    evidence: [],
  };

  // ── Derive context from entity ──────────────────────────────────────────
  const country  = detectCountry(entity.nationality, entity.knownResidences, entity.metadata);
  const locale   = countryToLocale(country);
  const city     = extractCity(entity.knownResidences, entity.metadata);
  const trading  = deriveTradingName(entity.name, city);

  const isCorp = entity.type === "Corporation" || entity.type === "Trust";
  const isFrench = country === "FR" || country === "BE" || country === "MC";
  const realism = reachabilityDirective(assessTargetReachability({
    type: entity.type,
    email: entity.email,
    phone: entity.phone,
    contactOutcome: entity.contactOutcome,
    contactConfidence: entity.contactConfidence,
    knownResidences: entity.knownResidences,
    metadata: entity.metadata,
    sourceRegistries: entity.sourceRegistries,
  }));

  const { queries, domainTargets } = buildDeepWebQueries(entity, trading, city, country);
  if (queries.length === 0 && domainTargets.length === 0) return result;

  const emailHits    = new Map<string, string[]>();
  const phoneHits    = new Map<string, string[]>();
  const linkedinHits = new Map<string, string[]>();
  const igHits       = new Map<string, string[]>();
  const twHits       = new Map<string, string[]>();
  const urlsToScrape = new Set<string>();
  let allSearchText  = "";
  const evidenceKeys = new Set<string>();

  const recordEvidence = (
    vectorType: DeepWebEvidence["vectorType"],
    value: string | null | undefined,
    source: string,
    sourceUrl: string | null | undefined,
    extractionMethod: string,
    confidence: number,
    details: Record<string, unknown> = {},
  ) => {
    if (!value) return;
    const normalized = value.trim();
    if (!normalized) return;
    const key = `${vectorType}|${normalized.toLowerCase()}|${source}|${sourceUrl ?? ""}`;
    if (evidenceKeys.has(key)) return;
    evidenceKeys.add(key);
    result.evidence.push({
      vectorType,
      value: normalized,
      source,
      sourceUrl: sourceUrl ?? null,
      extractionMethod,
      confidence: Math.min(100, Math.max(0, confidence)),
      details,
    });
  };

  const addOwnerResolution = (
    owner: OwnerResolution,
    source: string,
  ) => {
    const name = owner.name.trim();
    if (!name) return;
    const existing = result.ownerResolutions.find(
      (candidate) => candidate.name.toLowerCase() === name.toLowerCase()
        && candidate.role === owner.role,
    );
    if (!existing) {
      result.ownerResolutions.push({ ...owner, name });
    }
    // Only seed personsDiscovered with real human names — skip PE firms, holding
    // companies, and any string that passes the ownership chain but is not a person
    // (e.g. "Goldman Sachs AM", "PAI Partners", "Hotels CEO").
    if (looksLikePersonName(name) && !result.personsDiscovered.includes(name)) {
      result.personsDiscovered.push(name);
    }

    // A provider's global citation list is not proof for every person it
    // names. Only retain URLs explicitly attached to this owner claim.
    const sourceUrls = owner.sourceUrls;
    for (const sourceUrl of sourceUrls.slice(0, 4)) {
      if (!result.ownershipSources.includes(sourceUrl)) result.ownershipSources.push(sourceUrl);
      recordEvidence(
        "ownership",
        name,
        source,
        sourceUrl,
        "owner-resolution",
        owner.ownershipStatus === "confirmed" ? 90 : owner.ownershipStatus === "probable" ? 78 : 62,
        {
          scope: "person_candidate",
          personName: name,
          role: owner.role,
          ownershipStatus: owner.ownershipStatus,
          basis: owner.basis,
          relationship: "ownership-resolution-review-only",
        },
      );
    }

    const ownerLabel = `${source}[${owner.role}:${name.split(" ")[0]}]`;
    const details = {
      scope: "person_candidate" as const,
      personName: name,
      role: owner.role,
      ownershipStatus: owner.ownershipStatus,
      relationship: "personal-handle-candidate",
    };
    const sourceUrl = sourceUrls[0] ?? null;
    if (owner.instagram) recordEvidence("social", owner.instagram, ownerLabel, sourceUrl, "owner-resolution", 72, { ...details, network: "instagram" });
    if (owner.twitter) recordEvidence("social", owner.twitter, ownerLabel, sourceUrl, "owner-resolution", 72, { ...details, network: "twitter" });
    if (owner.linkedin) recordEvidence("social", owner.linkedin, ownerLabel, sourceUrl, "owner-resolution", 72, { ...details, network: "linkedin" });
    if (owner.email) recordEvidence("email", owner.email, ownerLabel, sourceUrl, "owner-resolution", 66, { ...details, relationship: "personal-email-candidate" });
  };

  const collectSearchResult = (
    sr: SearchResult,
    label: string,
    scope: "organization" | "person_candidate" = "organization",
    personName?: string,
  ) => {
    const details = {
      scope,
      ...(personName ? { personName, relationship: "discovered-person-review-only" } : {}),
    };
    const method = scope === "person_candidate"
      ? "person-hop-search-parser"
      : "search-result-parser";
    const confidence = scope === "person_candidate" ? 55 : 60;
    if (sr.text) {
      for (const e of extractEmails(sr.text)) {
        const arr = emailHits.get(e) ?? [];
        if (scope === "organization") { arr.push(label); emailHits.set(e, arr); }
        recordEvidence("email", e, label, sr.sourceUrl, method, confidence, details);
      }
      const ph = extractPhone(sr.text);
      if (ph) {
        const arr = phoneHits.get(ph) ?? [];
        if (scope === "organization") { arr.push(label); phoneHits.set(ph, arr); }
        recordEvidence("phone", ph, label, sr.sourceUrl, method, confidence, details);
      }
      // Check stripped text first, then fall back to raw result URLs.
      // DDG encodes destination URLs in uddg= params — extractDdgUrls decodes them
      // into sr.urls, but they never appear in sr.text (stripped HTML has no hrefs).
      let li = extractLinkedIn(sr.text);
      if (!li && scope === "organization") {
        li = sr.urls.find(u => /linkedin\.com\/(company|school)\/[a-zA-Z0-9\-_%]+/i.test(u))
             ?.replace(/[?#].*$/, "").replace(/\/$/, "") ?? null;
      }
      if (li) {
        const arr = linkedinHits.get(li) ?? [];
        if (scope === "organization") { arr.push(label); linkedinHits.set(li, arr); }
        recordEvidence("social", li, label, sr.sourceUrl, method, confidence, { ...details, network: "linkedin" });
      }
      const ig = extractInstagram(sr.text);
      if (ig) {
        // Corp entities: social handles from search snippets belong to persons, not the org itself
        if (scope === "organization" && !isCorp) { const arr = igHits.get(ig) ?? []; arr.push(label); igHits.set(ig, arr); }
        recordEvidence("social", ig, label, sr.sourceUrl, method, confidence, { ...details, network: "instagram" });
      }
      const tw = extractTwitter(sr.text);
      if (tw) {
        if (scope === "organization" && !isCorp) { const arr = twHits.get(tw) ?? []; arr.push(label); twHits.set(tw, arr); }
        recordEvidence("social", tw, label, sr.sourceUrl, method, confidence, { ...details, network: "twitter" });
      }
    }
    for (const u of sr.urls) {
      if (urlsToScrape.size < (scope === "person_candidate" ? 12 : 8)) urlsToScrape.add(u);
    }
  };

  const collectScrapedPage = (
    page: ScrapedPage,
    label: string,
    sourceUrl: string,
    scope: "organization" | "person_candidate" = "organization",
    personName?: string,
  ) => {
    const details = {
      scope,
      ...(personName ? { personName, relationship: "discovered-person-review-only" } : {}),
    };
    const method = scope === "person_candidate"
      ? "person-hop-page-parser"
      : "page-parser";
    const confidence = scope === "person_candidate" ? 60 : 75;
    const add = (
      vectorType: DeepWebEvidence["vectorType"],
      value: string | null,
      map: Map<string, string[]>,
      extra: Record<string, unknown> = {},
    ) => {
      if (!value) return;
      if (scope === "organization") {
        const arr = map.get(value) ?? [];
        arr.push(label);
        map.set(value, arr);
      }
      recordEvidence(vectorType, value, label, sourceUrl, method, confidence, { ...details, ...extra });
    };
    add("email", page.email, emailHits);
    add("phone", page.phone, phoneHits);
    add("social", page.linkedinUrl, linkedinHits, { network: "linkedin" });
    // Corp entities: scraped ig/tw are person-level handles — evidence only, never the org's social
    if (isCorp && scope === "organization") {
      if (page.instagramUrl) recordEvidence("social", page.instagramUrl, label, sourceUrl, method, confidence, { ...details, network: "instagram" });
      if (page.twitterUrl)   recordEvidence("social", page.twitterUrl,   label, sourceUrl, method, confidence, { ...details, network: "twitter" });
    } else {
      add("social", page.instagramUrl, igHits, { network: "instagram" });
      add("social", page.twitterUrl, twHits, { network: "twitter" });
    }
  };

  // ── Phase 0: Perplexity Sonar + Gemini Flash — live web research ──────────
  // Both fire in parallel before DDG/Bing — different search indexes means
  // complementary coverage. Perplexity excels at regional press; Gemini
  // excels at Google-indexed official pages and LinkedIn.
  // NOTE: declared outside the try so Phases 0.5/0.6/0.7 can access them even
  // if perp's own processing throws — all 4 providers must contribute results.
  let perp: any, gem: any, tav: any, exa: any;
  try {
    const providerResults = await Promise.allSettled([
      researchWithPerplexity(entity.name, entity.type, country, {
        tradingName: trading,
        city,
        reachability: realism,
      }),
      researchWithGemini(entity.name, entity.type, country, {
        tradingName: trading,
        city,
        reachability: realism,
      }),
      researchWithTavily(entity.name, entity.type, country, {
        tradingName: trading,
        city,
        reachability: realism,
      }),
      researchWithExa(entity.name, entity.type, country, {
        tradingName: trading,
        city,
        reachability: realism,
      }),
    ]);
    [perp, gem, tav, exa] = providerResults.map((item) =>
      item.status === "fulfilled" ? item.value : { source: "none" },
    ) as any[];
    for (const [index, item] of providerResults.entries()) {
      if (item.status === "rejected") {
        logger.warn({ providerIndex: index, err: item.reason?.message ?? String(item.reason) }, "Phase 0 provider failed independently");
      }
    }
    if (perp.source === "perplexity-sonar") {
      const label = "Perplexity[sonar]";
      result.sources.push(label);
      if (perp.email) {
        const arr = emailHits.get(perp.email) ?? []; arr.push(label); emailHits.set(perp.email, arr);
        recordEvidence("email", perp.email, label, null, "ai-perplexity-sonar", 80);
      }
      if (perp.phone) {
        const arr = phoneHits.get(perp.phone) ?? []; arr.push(label); phoneHits.set(perp.phone, arr);
        recordEvidence("phone", perp.phone, label, null, "ai-perplexity-sonar", 80);
      }
      if (perp.linkedin) {
        const arr = linkedinHits.get(perp.linkedin) ?? []; arr.push(label); linkedinHits.set(perp.linkedin, arr);
        recordEvidence("social", perp.linkedin, label, null, "ai-perplexity-sonar", 75, { network: "linkedin" });
      }
      if (perp.instagram) {
        const arr = igHits.get(perp.instagram) ?? []; arr.push(label); igHits.set(perp.instagram, arr);
        recordEvidence("social", perp.instagram, label, null, "ai-perplexity-sonar", 75, { network: "instagram" });
      }
      if (perp.twitter) {
        const arr = twHits.get(perp.twitter) ?? []; arr.push(label); twHits.set(perp.twitter, arr);
        recordEvidence("social", perp.twitter, label, null, "ai-perplexity-sonar", 75, { network: "twitter" });
      }
      if (perp.ownershipSummary) result.ownershipSummary = perp.ownershipSummary;
      for (const owner of perp.ownerResolutions) {
        addOwnerResolution(owner, label);
      }
      // Backward-compatible responses may still return ownerContacts only.
      for (const oc of perp.ownerContacts) {
        if (!perp.ownerResolutions.some((owner: OwnerResolution) => owner.name.toLowerCase() === oc.name.toLowerCase())) {
          addOwnerResolution({
            ...oc,
            role: "associated_person",
            ownershipStatus: "not_established",
            basis: null,
            sourceUrls: [],
            }, label);
        }
      }
      // Cited URLs → scrape queue (Perplexity's actual sources, highest quality)
      for (const url of perp.citations.slice(0, 4)) urlsToScrape.add(url);

      // ── Domain injection from Perplexity citations (Bug 2 fix) ──────────
      // Perplexity reads the entity's actual corporate website to answer our
      // prompt, so its citations contain the CORRECT corporate domain even when
      // the domain guesser picked a consumer/booking site (e.g. bbhotels.com
      // instead of hotel-bb.com). Extract those domains and prepend them to
      // domainTargets so Phase 5 scrapes them first.
      const citationDomains: string[] = [];
      for (const url of perp.citations) {
        try {
          const hostname = new URL(url).hostname.replace(/^www\./, "");
          if (!CITATION_SKIP_DOMAINS.has(hostname) && !citationDomains.includes(hostname)) {
            citationDomains.push(hostname);
          }
        } catch { /* ignore malformed URLs */ }
      }
      if (citationDomains.length > 0) {
        // Prepend so they run before the guessed domains — Perplexity already
        // confirmed these are relevant to the entity.
        domainTargets.unshift(...citationDomains.slice(0, 3));
        logger.info(
          { entityId: entity.id, citationDomains },
          "Phase 0: injected Perplexity citation domains into scrape targets",
        );
      }

      // Include Perplexity output in accumulated text for AI cross-validation
      allSearchText += " " + JSON.stringify({
        ownershipSummary: perp.ownershipSummary,
        ownerResolutions: perp.ownerResolutions,
        owners: perp.owners,
      });
      result.queriesFired++;
    }
  } catch (err: any) {
    logger.warn({ err: err?.message, name: err?.name }, "Phase 0: Perplexity/Gemini research failed");
  }

  // ── Phase 0.5: Gemini Flash results (already fetched above in parallel) ──
  try {
    if (typeof gem !== "undefined" && gem.source === "gemini-flash") {
      const label = "Gemini[flash]";
      result.sources.push(label);
      if (gem.email) {
        const arr = emailHits.get(gem.email) ?? []; arr.push(label); emailHits.set(gem.email, arr);
        recordEvidence("email", gem.email, label, null, "ai-gemini-flash", 80);
      }
      if (gem.phone) {
        const arr = phoneHits.get(gem.phone) ?? []; arr.push(label); phoneHits.set(gem.phone, arr);
        recordEvidence("phone", gem.phone, label, null, "ai-gemini-flash", 80);
      }
      if (gem.linkedin) {
        const arr = linkedinHits.get(gem.linkedin) ?? []; arr.push(label); linkedinHits.set(gem.linkedin, arr);
        recordEvidence("social", gem.linkedin, label, null, "ai-gemini-flash", 75, { network: "linkedin" });
      }
      if (gem.instagram) {
        const arr = igHits.get(gem.instagram) ?? []; arr.push(label); igHits.set(gem.instagram, arr);
        recordEvidence("social", gem.instagram, label, null, "ai-gemini-flash", 75, { network: "instagram" });
      }
      if (gem.twitter) {
        const arr = twHits.get(gem.twitter) ?? []; arr.push(label); twHits.set(gem.twitter, arr);
        recordEvidence("social", gem.twitter, label, null, "ai-gemini-flash", 75, { network: "twitter" });
      }
      if (gem.ownershipSummary && !result.ownershipSummary) result.ownershipSummary = gem.ownershipSummary;
      for (const owner of gem.ownerResolutions) {
        addOwnerResolution(owner, label);
      }
      for (const oc of gem.ownerContacts) {
        if (!gem.ownerResolutions.some((o: OwnerResolution) => o.name.toLowerCase() === oc.name.toLowerCase())) {
          addOwnerResolution({
            ...oc,
            role: "associated_person",
            ownershipStatus: "not_established",
            basis: null,
            sourceUrls: [],
          }, label);
        }
      }
      // Grounding URLs → scrape queue + domain injection (same logic as Perplexity citations)
      for (const url of gem.citations.slice(0, 4)) urlsToScrape.add(url);
      const gemDomains: string[] = [];
      for (const url of gem.citations) {
        try {
          const hostname = new URL(url).hostname.replace(/^www\./, "");
          if (!CITATION_SKIP_DOMAINS.has(hostname) && !gemDomains.includes(hostname)) {
            gemDomains.push(hostname);
          }
        } catch { /* ignore malformed URLs */ }
      }
      if (gemDomains.length > 0) {
        domainTargets.unshift(...gemDomains.slice(0, 3));
        logger.info({ entityId: entity.id, gemDomains }, "Phase 0.5: injected Gemini grounding domains into scrape targets");
      }
      allSearchText += " " + JSON.stringify({
        ownershipSummary: gem.ownershipSummary,
        ownerResolutions: gem.ownerResolutions,
        owners: gem.owners,
      });
      result.queriesFired++;
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Phase 0.5: Gemini Flash processing failed");
  }

  // ── Phase 0.6: Tavily results (already fetched above in parallel) ────────
  // Tavily returns clean AI-ready excerpts from 7 live sources — different
  // index from both Perplexity and Gemini. Structure extracted by Groq internally.
  try {
    if (typeof tav !== "undefined" && tav.source === "tavily") {
      const label = "Tavily";
      result.sources.push(label);
      if (tav.email) {
        const arr = emailHits.get(tav.email) ?? []; arr.push(label); emailHits.set(tav.email, arr);
        recordEvidence("email", tav.email, label, null, "ai-tavily", 78);
      }
      if (tav.phone) {
        const arr = phoneHits.get(tav.phone) ?? []; arr.push(label); phoneHits.set(tav.phone, arr);
        recordEvidence("phone", tav.phone, label, null, "ai-tavily", 78);
      }
      if (tav.linkedin) {
        const arr = linkedinHits.get(tav.linkedin) ?? []; arr.push(label); linkedinHits.set(tav.linkedin, arr);
        recordEvidence("social", tav.linkedin, label, null, "ai-tavily", 73, { network: "linkedin" });
      }
      if (tav.instagram) {
        const arr = igHits.get(tav.instagram) ?? []; arr.push(label); igHits.set(tav.instagram, arr);
        recordEvidence("social", tav.instagram, label, null, "ai-tavily", 73, { network: "instagram" });
      }
      if (tav.twitter) {
        const arr = twHits.get(tav.twitter) ?? []; arr.push(label); twHits.set(tav.twitter, arr);
        recordEvidence("social", tav.twitter, label, null, "ai-tavily", 73, { network: "twitter" });
      }
      if (tav.ownershipSummary && !result.ownershipSummary) result.ownershipSummary = tav.ownershipSummary;
      for (const owner of tav.ownerResolutions) {
        addOwnerResolution(owner, label);
      }
      for (const oc of tav.ownerContacts) {
        if (!tav.ownerResolutions.some((o: OwnerResolution) => o.name.toLowerCase() === oc.name.toLowerCase())) {
          addOwnerResolution({
            ...oc,
            role: "associated_person",
            ownershipStatus: "not_established",
            basis: null,
            sourceUrls: [],
          }, label);
        }
      }
      // Tavily result URLs → scrape queue + domain injection
      for (const url of tav.citations.slice(0, 4)) urlsToScrape.add(url);
      const tavDomains: string[] = [];
      for (const url of tav.citations) {
        try {
          const hostname = new URL(url).hostname.replace(/^www\./, "");
          if (!CITATION_SKIP_DOMAINS.has(hostname) && !tavDomains.includes(hostname)) {
            tavDomains.push(hostname);
          }
        } catch { /* ignore malformed URLs */ }
      }
      if (tavDomains.length > 0) {
        domainTargets.unshift(...tavDomains.slice(0, 3));
        logger.info({ entityId: entity.id, tavDomains }, "Phase 0.6: injected Tavily result domains into scrape targets");
      }
      allSearchText += " " + JSON.stringify({
        ownershipSummary: tav.ownershipSummary,
        ownerResolutions: tav.ownerResolutions,
        owners: tav.owners,
      });
      result.queriesFired++;
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Phase 0.6: Tavily processing failed");
  }

  // ── Phase 0.7: Exa results (already fetched above in parallel) ──────────
  // Exa uses neural/semantic retrieval — different ranking model from Perplexity,
  // Gemini, and Tavily. Especially strong for people + company identity lookups.
  try {
    if (typeof exa !== "undefined" && exa.source === "exa") {
      const label = "Exa";
      result.sources.push(label);
      if (exa.email) {
        const arr = emailHits.get(exa.email) ?? []; arr.push(label); emailHits.set(exa.email, arr);
        recordEvidence("email", exa.email, label, null, "ai-exa", 78);
      }
      if (exa.phone) {
        const arr = phoneHits.get(exa.phone) ?? []; arr.push(label); phoneHits.set(exa.phone, arr);
        recordEvidence("phone", exa.phone, label, null, "ai-exa", 78);
      }
      if (exa.linkedin) {
        const arr = linkedinHits.get(exa.linkedin) ?? []; arr.push(label); linkedinHits.set(exa.linkedin, arr);
        recordEvidence("social", exa.linkedin, label, null, "ai-exa", 73, { network: "linkedin" });
      }
      if (exa.instagram) {
        const arr = igHits.get(exa.instagram) ?? []; arr.push(label); igHits.set(exa.instagram, arr);
        recordEvidence("social", exa.instagram, label, null, "ai-exa", 73, { network: "instagram" });
      }
      if (exa.twitter) {
        const arr = twHits.get(exa.twitter) ?? []; arr.push(label); twHits.set(exa.twitter, arr);
        recordEvidence("social", exa.twitter, label, null, "ai-exa", 73, { network: "twitter" });
      }
      if (exa.ownershipSummary && !result.ownershipSummary) result.ownershipSummary = exa.ownershipSummary;
      for (const owner of exa.ownerResolutions) {
        addOwnerResolution(owner, label);
      }
      for (const oc of exa.ownerContacts) {
        if (!exa.ownerResolutions.some((o: OwnerResolution) => o.name.toLowerCase() === oc.name.toLowerCase())) {
          addOwnerResolution({
            ...oc,
            role: "associated_person",
            ownershipStatus: "not_established",
            basis: null,
            sourceUrls: [],
          }, label);
        }
      }
      for (const url of exa.citations.slice(0, 4)) urlsToScrape.add(url);
      const exaDomains: string[] = [];
      for (const url of exa.citations) {
        try {
          const hostname = new URL(url).hostname.replace(/^www\./, "");
          if (!CITATION_SKIP_DOMAINS.has(hostname) && !exaDomains.includes(hostname)) {
            exaDomains.push(hostname);
          }
        } catch { /* ignore malformed URLs */ }
      }
      if (exaDomains.length > 0) {
        domainTargets.unshift(...exaDomains.slice(0, 3));
        logger.info({ entityId: entity.id, exaDomains }, "Phase 0.7: injected Exa result domains into scrape targets");
      }
      allSearchText += " " + JSON.stringify({
        ownershipSummary: exa.ownershipSummary,
        ownerResolutions: exa.ownerResolutions,
        owners: exa.owners,
      });
      result.queriesFired++;
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Phase 0.7: Exa processing failed");
  }

  // ── Phase 1: DDG search (locale-aware) ─────────────────────────────────
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i]!;
    const label = `DDG[q${i + 1}]`;
    try {
      const sr = await duckduckgoSearch(query, locale);
      result.queriesFired++;
      allSearchText += " " + sr.text;
      collectSearchResult(sr, label);
    } catch { /* skip */ }
    if (i < queries.length - 1) await jitteredDelay(900);
  }

  // ── Phase 1.5: Wikipedia lookup ────────────────────────────────────────
  // Wikipedia page summaries frequently name founders, CEOs, and principals
  // in a structured, attributed way — better than relying purely on search
  // snippet extraction. Runs only for corporations to avoid irrelevant hits.
  if (isCorp) {
    try {
      const wikiResult = await wikipediaLookup(trading, country);
      if (wikiResult && wikiResult.extract) {
        allSearchText += " " + wikiResult.extract;
        // Extract persons from the Wikipedia summary text directly (GLiNER if available, regex fallback)
        const wikiPersons = await extractPersonCandidatesAsync(wikiResult.extract);
        for (const p of wikiPersons) {
          if (!result.personsDiscovered.includes(p)) result.personsDiscovered.push(p);
        }
        // Record Wikipedia page as a source for any emails/phones in the summary (rare but possible)
        for (const e of extractEmails(wikiResult.extract)) {
          const arr = emailHits.get(e) ?? []; arr.push("Wikipedia"); emailHits.set(e, arr);
        }
        const ph = extractPhone(wikiResult.extract);
        if (ph) { const arr = phoneHits.get(ph) ?? []; arr.push("Wikipedia"); phoneHits.set(ph, arr); }
        result.queriesFired++;
        logger.debug(
          { entityId: entity.id, pageUrl: wikiResult.pageUrl, personsFound: wikiPersons.length },
          "Phase 1.5 Wikipedia hit",
        );
      }
    } catch { /* non-fatal */ }
  }

  // ── Phase 2: Qwant for French entities (much better French coverage) ───
  const qwantQueries = isFrench
    ? queries.filter(q => q.includes(trading) || (city && q.includes(city))).slice(0, 3)
    : [];
  for (let i = 0; i < qwantQueries.length; i++) {
    const query = qwantQueries[i]!;
    const label = `Qwant[q${i + 1}]`;
    try {
      const sr = await qwantSearch(query, "fr_FR");
      result.queriesFired++;
      allSearchText += " " + sr.text;
      collectSearchResult(sr, label);
    } catch { /* skip */ }
    if (i < qwantQueries.length - 1) await jitteredDelay(1000);
  }

  // ── Phase 3: Bing on top queries (country-aware) ────────────────────────
  // Include contact/email queries + the linkedin query (Bing handles site: and
  // linkedin queries far more reliably than DDG for company page discovery).
  const bingQueries = queries.filter(q =>
    q.includes("email") || q.includes("contact") || q.includes("réservations") || q.includes("linkedin")
  ).slice(0, 3);
  for (let i = 0; i < bingQueries.length; i++) {
    const query = bingQueries[i]!;
    const label = `Bing[q${i + 1}]`;
    try {
      const sr = await bingSearch(query, country);
      result.queriesFired++;
      allSearchText += " " + sr.text;
      if (sr.text) {
        for (const e of extractEmails(sr.text)) {
          const arr = emailHits.get(e) ?? []; arr.push(label); emailHits.set(e, arr);
        }
        const ph = extractPhone(sr.text);
        if (ph) { const arr = phoneHits.get(ph) ?? []; arr.push(label); phoneHits.set(ph, arr); }
        // Also check sr.urls — Bing result URLs may contain LinkedIn company pages
        // that don't appear in snippet text
        let li = extractLinkedIn(sr.text);
        if (!li) {
          li = sr.urls.find(u => /linkedin\.com\/(company|school)\/[a-zA-Z0-9\-_%]+/i.test(u))
               ?.replace(/[?#].*$/, "").replace(/\/$/, "") ?? null;
        }
        if (li) { const arr = linkedinHits.get(li) ?? []; arr.push(label); linkedinHits.set(li, arr); }
      }
      for (const u of sr.urls) { if (urlsToScrape.size < 8) urlsToScrape.add(u); }
    } catch { /* skip */ }
    if (i < bingQueries.length - 1) await jitteredDelay(1000);
  }

  // ── Phase 4: Corp → Person hop ─────────────────────────────────────────
  // Extract person names from all search snippets collected so far.
  // Then run targeted person queries — this is how we get from "BAOLI SAS"
  // to "Christophe Caucino" without needing an AI model.
  if (isCorp && allSearchText.length > 200) {
    const persons = await extractPersonCandidatesAsync(allSearchText);
    if (persons.length > 0) {
      result.personsDiscovered.push(...persons);
      logger.info({ entityId: entity.id, persons }, "Corp→Person hop: discovered person candidates");

      for (const personName of persons.slice(0, 3)) {
        const label = `PersonHop[${personName.split(" ")[0]}]`;

        // Primary: contact/LinkedIn search. These results remain review-only:
        // a person discovered in public text must not become the corporation's
        // contact vector without an explicit identity-resolution decision.
        try {
          const personQuery = city
            ? `"${personName}" "${trading}" "${city}" owner founder director email linkedin`
            : `"${personName}" "${trading}" owner founder director email linkedin`;
          const sr = await duckduckgoSearch(personQuery, locale);
          result.queriesFired++;
          collectSearchResult(sr, label, "person_candidate", personName);
        } catch { /* skip */ }
        await jitteredDelay(600);

        // Press/news context: confirms person↔venue link + surfaces more evidence
        // Especially powerful for French/European targets where regional press covers venue owners
        const pressEngine = isFrench ? qwantSearch : duckduckgoSearch;
        const pressLocale = isFrench ? "fr_FR" : locale;
        const pressQuery  = isFrench
          ? `"${personName}" "${trading}" OR "${city ?? ""}" fondateur propriétaire`
          : `"${personName}" "${trading}" owner founder`;
        try {
          const pr = await pressEngine(pressQuery, pressLocale);
          result.queriesFired++;
          collectSearchResult(pr, `${label}[press]`, "person_candidate", personName);
        } catch { /* skip */ }
        await jitteredDelay(500);

        // ── Targeted personal Instagram search ──────────────────────────────
        // "Christophe Caucino" instagram → finds instagram.com/christoph_cau
        // This single query is what Google does to get from a person's name to their handle.
        // Result goes to evidence as person_candidate ONLY — not to igHits (entity's own social).
        try {
          const igQuery = `"${personName}" instagram`;
          const igSr = await duckduckgoSearch(igQuery, locale);
          result.queriesFired++;
          // Try text regex first, then fall back to parsing result URLs directly
          let igUrl = extractInstagram(igSr.text);
          if (!igUrl) {
            for (const u of igSr.urls) {
              const m = u.match(/instagram\.com\/([^/?#\s]+)/i);
              if (m && m[1] && m[1].length >= 2 && m[1].length <= 30
                  && !["p","reel","stories","explore","accounts","tv"].includes(m[1].toLowerCase())) {
                igUrl = `https://instagram.com/${m[1]}`;
                break;
              }
            }
          }
          if (igUrl) {
            recordEvidence("social", igUrl, `${label}[ig-personal]`, igSr.sourceUrl,
              "person-social-search", 72, {
                scope: "person_candidate", personName,
                relationship: "personal-handle-candidate", network: "instagram",
              });
            logger.info({ entityId: entity.id, personName, igUrl }, "Person hop: personal Instagram found");
          }
          for (const u of igSr.urls.slice(0, 2)) urlsToScrape.add(u);
        } catch { /* skip */ }
        await jitteredDelay(350);

        // ── Targeted personal LinkedIn search ───────────────────────────────
        try {
          const liQuery = `"${personName}" site:linkedin.com/in`;
          const liSr = await duckduckgoSearch(liQuery, locale);
          result.queriesFired++;
          const liUrl = extractLinkedIn(liSr.text)
            ?? liSr.urls.find(u => /linkedin\.com\/in\//i.test(u))
            ?? null;
          if (liUrl) {
            recordEvidence("social", liUrl, `${label}[li-personal]`, liSr.sourceUrl,
              "person-social-search", 70, {
                scope: "person_candidate", personName,
                relationship: "personal-handle-candidate", network: "linkedin",
              });
          }
          for (const u of liSr.urls.slice(0, 2)) urlsToScrape.add(u);
        } catch { /* skip */ }
        await jitteredDelay(350);
      }
    }
  }

  // ── Phase 5: Direct domain scraping + contact-page crawl + Wayback fallback ─
  // Critical order: guessed domains first, then contact sub-pages, then Wayback.
  // findContactPages returns Array<{url, scraped}> — iterate the array, do NOT treat as single page.
  for (const domain of domainTargets.slice(0, 4)) {
    try {
      const label = `Domain[${domain}]`;
      // Root page — fast check; also feeds page text into AI accumulator
      const rootScrape = await scrapePage(`https://${domain}`);
      result.pagesScraped++;
      allSearchText += " " + rootScrape.text.slice(0, 2000);
      collectScrapedPage(rootScrape, label, `https://${domain}`);

      // Crawl contact / about / team sub-pages when root has no email OR no LinkedIn.
      // For Corp entities (VC firms, law firms) ALWAYS crawl sub-pages regardless of
      // what the root returned — team/partners pages list ALL named partners.
      if (isCorp || !rootScrape.email || !rootScrape.linkedinUrl) {
        const contactPages = await findContactPages(domain, isCorp);
        for (const { url: cpUrl, scraped: cp } of contactPages) {
          const cpLabel = `${label}[${cpUrl.split("/").slice(-1)[0] ?? "contact"}]`;
          allSearchText += " " + cp.text.slice(0, 2000);
          collectScrapedPage(cp, cpLabel, cpUrl);
          // For Corps: never break early — scrape all team/partner pages to surface every named GP.
          // For venues/individuals: stop as soon as we have email + LinkedIn.
          if (!isCorp && cp.email && (cp.linkedinUrl || linkedinHits.size > 0)) break;
          if (!isCorp && cp.email) break; // safety fallback for non-corps
        }
      }

      // Wayback Machine fallback: live site returned a Cloudflare/bot-protection challenge or
      // near-empty response.  Check botBlocked flag (CF signatures) AND short-text guard.
      const liveHit = rootScrape.email || rootScrape.phone || rootScrape.instagramUrl;
      if (!liveHit && (rootScrape.botBlocked || rootScrape.text.length < 500)) {
        const wbUrls = await waybackSnapshotUrls(domain);
        for (const wbUrl of wbUrls.slice(0, 3)) {
          try {
            const wb = await scrapePage(wbUrl);
            result.pagesScraped++;
            const wbLabel = `Wayback[${domain}]`;
            allSearchText += " " + wb.text.slice(0, 2000);
            collectScrapedPage(wb, wbLabel, wbUrl);
            if (wb.email || wb.phone) break;
          } catch { /* skip */ }
          await sleep(500);
        }
      }
    } catch { /* domain doesn't resolve */ }
    await jitteredDelay(600);
  }

  // ── Phase 6: Scrape search-result URLs ─────────────────────────────────
  const scrapeTargets = [...urlsToScrape].slice(0, 5);
  for (const url of scrapeTargets) {
    try {
      const scraped = await scrapePage(url);
      result.pagesScraped++;
      allSearchText += " " + scraped.text.slice(0, 3000); // page content feeds AI pass
      const label = `Page[${new URL(url).hostname.replace(/^www\./, "").substring(0, 20)}]`;
      collectScrapedPage(scraped, label, url);
    } catch { /* skip */ }
    await jitteredDelay(700);
  }

  // ── Phase 7: AI extraction pass (Groq llama-3.3-70b) ──────────────────
  // Runs over all accumulated search + page text. Catches what regex missed:
  // obfuscated emails, international phones, inline social handles, owner names.
  if (allSearchText.length > 100) {
    try {
      const ai = await extractWithAI(allSearchText, entity.name, entity.type, country);
      if (ai.source !== "none") {
        const label = `AI[${ai.source}]`;
        if (ai.email) { const arr = emailHits.get(ai.email) ?? []; arr.push(label); emailHits.set(ai.email, arr); }
        if (ai.phone) { const arr = phoneHits.get(ai.phone) ?? []; arr.push(label); phoneHits.set(ai.phone, arr); }
        if (ai.linkedin) { const arr = linkedinHits.get(ai.linkedin) ?? []; arr.push(label); linkedinHits.set(ai.linkedin, arr); }
        if (ai.instagram) { const arr = igHits.get(ai.instagram) ?? []; arr.push(label); igHits.set(ai.instagram, arr); }
        if (ai.twitter) { const arr = twHits.get(ai.twitter) ?? []; arr.push(label); twHits.set(ai.twitter, arr); }
        // Merge AI-discovered persons without duplicating existing regex finds
        for (const person of ai.owners) {
          if (!result.personsDiscovered.includes(person)) result.personsDiscovered.push(person);
        }
        if (!result.ownershipSummary && ai.ownershipSummary) {
          result.ownershipSummary = ai.ownershipSummary;
        }
        for (const owner of ai.ownerResolutions) {
          addOwnerResolution(owner, label);
        }

        // ── Integrate per-owner personal social handles ──────────────────
        // This is the Google/Gemini parity gap: when the LLM sees "Christophe Caucino
        // (@christoph_cau)" in the text, it returns that as an ownerContact with a personal
        // Instagram handle — NOT the venue's @baolicannes account.
        // These go to evidence as person_candidate ONLY, never to igHits/twHits/linkedinHits,
        // so the entity's own social fields stay org-level while evidence carries personal vectors.
        for (const oc of ai.ownerContacts) {
          if (!result.personsDiscovered.includes(oc.name)) result.personsDiscovered.push(oc.name);
          const ocLabel = `AI[owner:${oc.name.split(" ")[0]}]`;
          const ocDetails = (network: string) => ({
            scope: "person_candidate" as const, personName: oc.name,
            relationship: "personal-handle-candidate", network,
          });
          if (oc.instagram) recordEvidence("social",   oc.instagram, ocLabel, null, "ai-owner-extraction", 74, ocDetails("instagram"));
          if (oc.twitter)   recordEvidence("social",   oc.twitter,   ocLabel, null, "ai-owner-extraction", 74, ocDetails("twitter"));
          if (oc.linkedin)  recordEvidence("social",   oc.linkedin,  ocLabel, null, "ai-owner-extraction", 74, ocDetails("linkedin"));
          if (oc.email)     recordEvidence("email",    oc.email,     ocLabel, null, "ai-owner-extraction", 66, {
            scope: "person_candidate", personName: oc.name, relationship: "personal-email-candidate",
          });
        }
        if (ai.ownerContacts.length > 0) {
          logger.info({
            entityId: entity.id,
            owners: ai.ownerContacts.map(o => ({ name: o.name, ig: !!o.instagram, li: !!o.linkedin })),
          }, "AI owner contacts with personal handles extracted");
        }

        logger.info({ entityId: entity.id, hasEmail: !!ai.email, persons: ai.owners.length, ownerContacts: ai.ownerContacts.length, source: ai.source }, "AI extraction phase complete");
      }
    } catch (err: any) {
      logger.debug({ err: err?.message }, "AI extraction phase skipped");
    }
  }

  // ── Phase 7.5: Iterative Perplexity follow-up on newly discovered persons ─
  // Phase 0 queried the entity. By now (after DDG/scraping/AI) we know real
  // person names (founders, owners, directors) that weren't in Phase 0.
  // Fire targeted Perplexity sonar calls on those persons — this closes the
  // Gemini gap: find a name → immediately ask Perplexity about that person
  // in context of the entity → get personal contacts/social handles.
  // Cap at 2 persons and 1 extra domain scrape to control credit spend.
  {
    const alreadyQueriedNames = new Set(
      result.ownerResolutions.map(o => o.name.toLowerCase()),
    );
    const followUpPersons = result.personsDiscovered
      .filter(n => looksLikePersonName(n) && !alreadyQueriedNames.has(n.toLowerCase()))
      .slice(0, 2);

    const alreadyScrapedUrls = new Set<string>([...urlsToScrape]);

    for (const personName of followUpPersons) {
      try {
        logger.info({ entityId: entity.id, personName }, "Phase 7.5: follow-up Perplexity+Gemini+Tavily+Exa for discovered person");
        const followUpResults = await Promise.allSettled([
          researchWithPerplexity(personName, "HNWI", country, {
            tradingName: entity.name,
            city,
            reachability: realism,
          }),
          researchWithGemini(personName, "HNWI", country, {
            tradingName: entity.name,
            city,
            reachability: realism,
          }),
          researchWithTavily(personName, "HNWI", country, {
            tradingName: entity.name,
            city,
            reachability: realism,
          }),
          researchWithExa(personName, "HNWI", country, {
            tradingName: entity.name,
            city,
            reachability: realism,
          }),
        ]);
        const [fuPerp, fuGem, fuTav, fuExa] = followUpResults.map((item) =>
          item.status === "fulfilled" ? item.value : { source: "none" },
        ) as any[];
        for (const [index, item] of followUpResults.entries()) {
          if (item.status === "rejected") {
            logger.warn({ providerIndex: index, personName, err: item.reason?.message ?? String(item.reason) }, "Follow-up provider failed independently");
          }
        }

        // Process Perplexity follow-up
        if (fuPerp.source === "perplexity-sonar") {
          const label = `Perplexity[fu:${personName.split(" ")[0]}]`;
          result.sources.push(label);
          const pdDetails = { scope: "person_candidate" as const, personName, relationship: "personal-contact-followup" };
          if (fuPerp.email) {
            const arr = emailHits.get(fuPerp.email) ?? []; arr.push(label); emailHits.set(fuPerp.email, arr);
            recordEvidence("email", fuPerp.email, label, null, "ai-perplexity-sonar-followup", 76, pdDetails);
          }
          if (fuPerp.phone) {
            const arr = phoneHits.get(fuPerp.phone) ?? []; arr.push(label); phoneHits.set(fuPerp.phone, arr);
            recordEvidence("phone", fuPerp.phone, label, null, "ai-perplexity-sonar-followup", 76, pdDetails);
          }
          if (fuPerp.linkedin) {
            const arr = linkedinHits.get(fuPerp.linkedin) ?? []; arr.push(label); linkedinHits.set(fuPerp.linkedin, arr);
            recordEvidence("social", fuPerp.linkedin, label, null, "ai-perplexity-sonar-followup", 72, { ...pdDetails, network: "linkedin" });
          }
          if (fuPerp.instagram) {
            recordEvidence("social", fuPerp.instagram, label, null, "ai-perplexity-sonar-followup", 72, { ...pdDetails, network: "instagram" });
          }
          if (fuPerp.twitter) {
            recordEvidence("social", fuPerp.twitter, label, null, "ai-perplexity-sonar-followup", 72, { ...pdDetails, network: "twitter" });
          }
          for (const owner of fuPerp.ownerResolutions) {
            addOwnerResolution(owner, label);
          }
          for (const url of fuPerp.citations.slice(0, 3)) urlsToScrape.add(url);
          for (const url of fuPerp.citations) {
            try {
              const hostname = new URL(url).hostname.replace(/^www\./, "");
              if (!CITATION_SKIP_DOMAINS.has(hostname) && !domainTargets.includes(hostname)) domainTargets.push(hostname);
            } catch { /* skip malformed */ }
          }
          allSearchText += " " + JSON.stringify({ personName, ownershipSummary: fuPerp.ownershipSummary, ownerResolutions: fuPerp.ownerResolutions });
          result.queriesFired++;
        }

        // Process Gemini follow-up
        if (fuGem.source === "gemini-flash") {
          const label = `Gemini[fu:${personName.split(" ")[0]}]`;
          result.sources.push(label);
          const pdDetails = { scope: "person_candidate" as const, personName, relationship: "personal-contact-followup" };
          if (fuGem.email) {
            const arr = emailHits.get(fuGem.email) ?? []; arr.push(label); emailHits.set(fuGem.email, arr);
            recordEvidence("email", fuGem.email, label, null, "ai-gemini-flash-followup", 76, pdDetails);
          }
          if (fuGem.phone) {
            const arr = phoneHits.get(fuGem.phone) ?? []; arr.push(label); phoneHits.set(fuGem.phone, arr);
            recordEvidence("phone", fuGem.phone, label, null, "ai-gemini-flash-followup", 76, pdDetails);
          }
          if (fuGem.linkedin) {
            const arr = linkedinHits.get(fuGem.linkedin) ?? []; arr.push(label); linkedinHits.set(fuGem.linkedin, arr);
            recordEvidence("social", fuGem.linkedin, label, null, "ai-gemini-flash-followup", 72, { ...pdDetails, network: "linkedin" });
          }
          if (fuGem.instagram) {
            recordEvidence("social", fuGem.instagram, label, null, "ai-gemini-flash-followup", 72, { ...pdDetails, network: "instagram" });
          }
          if (fuGem.twitter) {
            recordEvidence("social", fuGem.twitter, label, null, "ai-gemini-flash-followup", 72, { ...pdDetails, network: "twitter" });
          }
          for (const owner of fuGem.ownerResolutions) {
            addOwnerResolution(owner, label);
          }
          for (const url of fuGem.citations.slice(0, 3)) urlsToScrape.add(url);
          for (const url of fuGem.citations) {
            try {
              const hostname = new URL(url).hostname.replace(/^www\./, "");
              if (!CITATION_SKIP_DOMAINS.has(hostname) && !domainTargets.includes(hostname)) domainTargets.push(hostname);
            } catch { /* skip malformed */ }
          }
          allSearchText += " " + JSON.stringify({ personName, ownershipSummary: fuGem.ownershipSummary, ownerResolutions: fuGem.ownerResolutions });
          result.queriesFired++;
        }

        // Process Tavily follow-up
        if (fuTav.source === "tavily") {
          const label = `Tavily[fu:${personName.split(" ")[0]}]`;
          result.sources.push(label);
          const pdDetails = { scope: "person_candidate" as const, personName, relationship: "personal-contact-followup" };
          if (fuTav.email) {
            const arr = emailHits.get(fuTav.email) ?? []; arr.push(label); emailHits.set(fuTav.email, arr);
            recordEvidence("email", fuTav.email, label, null, "ai-tavily-followup", 74, pdDetails);
          }
          if (fuTav.phone) {
            const arr = phoneHits.get(fuTav.phone) ?? []; arr.push(label); phoneHits.set(fuTav.phone, arr);
            recordEvidence("phone", fuTav.phone, label, null, "ai-tavily-followup", 74, pdDetails);
          }
          if (fuTav.linkedin) {
            const arr = linkedinHits.get(fuTav.linkedin) ?? []; arr.push(label); linkedinHits.set(fuTav.linkedin, arr);
            recordEvidence("social", fuTav.linkedin, label, null, "ai-tavily-followup", 70, { ...pdDetails, network: "linkedin" });
          }
          if (fuTav.instagram) {
            recordEvidence("social", fuTav.instagram, label, null, "ai-tavily-followup", 70, { ...pdDetails, network: "instagram" });
          }
          if (fuTav.twitter) {
            recordEvidence("social", fuTav.twitter, label, null, "ai-tavily-followup", 70, { ...pdDetails, network: "twitter" });
          }
          for (const owner of fuTav.ownerResolutions) {
            addOwnerResolution(owner, label);
          }
          for (const url of fuTav.citations.slice(0, 3)) urlsToScrape.add(url);
          for (const url of fuTav.citations) {
            try {
              const hostname = new URL(url).hostname.replace(/^www\./, "");
              if (!CITATION_SKIP_DOMAINS.has(hostname) && !domainTargets.includes(hostname)) domainTargets.push(hostname);
            } catch { /* skip malformed */ }
          }
          allSearchText += " " + JSON.stringify({ personName, ownershipSummary: fuTav.ownershipSummary, ownerResolutions: fuTav.ownerResolutions });
          result.queriesFired++;
        }

        // Process Exa follow-up
        if (fuExa.source === "exa") {
          const label = `Exa[fu:${personName.split(" ")[0]}]`;
          result.sources.push(label);
          const pdDetails = { scope: "person_candidate" as const, personName, relationship: "personal-contact-followup" };
          if (fuExa.email) {
            const arr = emailHits.get(fuExa.email) ?? []; arr.push(label); emailHits.set(fuExa.email, arr);
            recordEvidence("email", fuExa.email, label, null, "ai-exa-followup", 74, pdDetails);
          }
          if (fuExa.phone) {
            const arr = phoneHits.get(fuExa.phone) ?? []; arr.push(label); phoneHits.set(fuExa.phone, arr);
            recordEvidence("phone", fuExa.phone, label, null, "ai-exa-followup", 74, pdDetails);
          }
          if (fuExa.linkedin) {
            const arr = linkedinHits.get(fuExa.linkedin) ?? []; arr.push(label); linkedinHits.set(fuExa.linkedin, arr);
            recordEvidence("social", fuExa.linkedin, label, null, "ai-exa-followup", 70, { ...pdDetails, network: "linkedin" });
          }
          if (fuExa.instagram) {
            recordEvidence("social", fuExa.instagram, label, null, "ai-exa-followup", 70, { ...pdDetails, network: "instagram" });
          }
          if (fuExa.twitter) {
            recordEvidence("social", fuExa.twitter, label, null, "ai-exa-followup", 70, { ...pdDetails, network: "twitter" });
          }
          for (const owner of fuExa.ownerResolutions) {
            addOwnerResolution(owner, label);
          }
          for (const url of fuExa.citations.slice(0, 3)) urlsToScrape.add(url);
          for (const url of fuExa.citations) {
            try {
              const hostname = new URL(url).hostname.replace(/^www\./, "");
              if (!CITATION_SKIP_DOMAINS.has(hostname) && !domainTargets.includes(hostname)) domainTargets.push(hostname);
            } catch { /* skip malformed */ }
          }
          allSearchText += " " + JSON.stringify({ personName, ownershipSummary: fuExa.ownershipSummary, ownerResolutions: fuExa.ownerResolutions });
          result.queriesFired++;
        }
      } catch (err: any) {
        logger.warn({ err: err?.message, personName }, "Phase 7.5: follow-up Perplexity/Gemini/Tavily/Exa failed");
      }
      await jitteredDelay(500);
    }

    // ── Phase 7.6: Scrape new URLs surfaced by follow-up Perplexity ────────
    const newScrapeUrls = [...urlsToScrape].filter(u => !alreadyScrapedUrls.has(u)).slice(0, 3);
    for (const url of newScrapeUrls) {
      try {
        const scraped = await scrapePage(url);
        result.pagesScraped++;
        allSearchText += " " + scraped.text.slice(0, 2000);
        const label = `FollowUp[${new URL(url).hostname.replace(/^www\./, "").substring(0, 20)}]`;
        collectScrapedPage(scraped, label, url);
      } catch { /* skip */ }
      await jitteredDelay(500);
    }
  }

  // ── Phase 8: Pick best-corroborated values ──────────────────────────────
  // Build a set of "entity-owned" domain tokens from the name and guessed domains.
  // Emails whose domain has no overlap with these tokens are third-party contacts
  // (e.g. secretariat@ifswf.org found on a membership-listing page) and must
  // stay as evidence-only candidates, never promoted to the entity's primary email.
  const entityDomainTokens = new Set<string>();
  const tradingLower = trading.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (tradingLower.length >= 4) entityDomainTokens.add(tradingLower);
  // Add first 6+ char word from entity name
  for (const w of entity.name.toLowerCase().split(/\s+/)) {
    if (w.length >= 5) entityDomainTokens.add(w.replace(/[^a-z0-9]/g, ""));
  }
  for (const d of domainTargets.slice(0, 3)) {
    const base = d.replace(/^www\./, "").split(".")[0] ?? "";
    if (base.length >= 4) entityDomainTokens.add(base.replace(/[^a-z0-9]/g, ""));
  }

  let bestEmail = ""; let bestEmailCount = 0;
  for (const [email, srcs] of emailHits.entries()) {
    const emailDomain = email.split("@")[1] ?? "";
    const emailLocal  = email.split("@")[0] ?? "";
    const emailDomainBase = emailDomain.split(".")[0]?.replace(/[^a-z0-9]/g, "") ?? "";

    // Apply the shared public-contact validator before promotion. The evidence
    // row is still retained below for auditability, but malformed, registrar,
    // privacy-relay, and placeholder addresses cannot become entity contacts.
    if (!isValidPublicEmail(email)) continue;

    // Never promote generic shared inboxes (info@, contact@, sales@, etc.)
    if (isGenericEmailPrefix(emailLocal)) continue;

    // Never promote emails scraped from financial data aggregators / news wires
    if (FINANCIAL_AGGREGATOR_DOMAINS.has(emailDomain)) continue;

    // Organisation pages are valuable evidence but their addresses belong to
    // the organisation, not automatically to the person being researched.
    // Permit the same value only when a person-level candidate independently
    // supports it (for example, an owner-resolution result).
    const emailEvidence = result.evidence.filter(
      ev => ev.vectorType === "email" && ev.value.toLowerCase() === email.toLowerCase(),
    );
    const hasOrganizationEvidence = emailEvidence.some(
      ev => ev.details?.scope === "organization",
    );
    const hasPersonEvidence = emailEvidence.some(
      ev => ev.details?.scope === "person_candidate",
    );
    if (hasOrganizationEvidence && !hasPersonEvidence) continue;

    // Domain match check:
    //  • Known entity domain → email domain must overlap with entity name tokens
    //  • Unknown entity domain → only promote if 2+ independent sources agree
    //    (single-source unknown-domain emails are evidence leads, not contact data)
    const domainMatchesEntity = entityDomainTokens.size === 0
      ? srcs.length >= 2
      : [...entityDomainTokens].some(tok => emailDomainBase.includes(tok) || tok.includes(emailDomainBase));
    if (!domainMatchesEntity) continue;

    if (srcs.length > bestEmailCount) { bestEmail = email; bestEmailCount = srcs.length; }
  }
  if (bestEmail) {
    result.email = bestEmail;
    result.emailConfidence = scoreByCorroboration(bestEmailCount, result.evidence, bestEmail);
    result.sources.push(...(emailHits.get(bestEmail) ?? []));
  }

  // Phone validation: reject garbage numbers (< 7 real digits, country code +0, placeholder patterns,
  // and US-format local numbers for non-US/CA entities)
  function isValidPhone(phone: string): boolean {
    if (!phone) return false;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7) return false;                  // too short to be real
    if (/^\+?0[0-9]{1,3}-/.test(phone)) return false;    // starts with +0... (invalid country code)
    if (/^[+\d]?0+[-\s]?0+/.test(phone)) return false;   // all-zeros pattern
    if (/(\d)\1{5,}/.test(digits)) return false;          // 6+ repeated same digit (placeholder)
    if (digits.length > 15) return false;                 // E.164 max is 15
    // Reject US-format 10-digit NPA-NXX-XXXX (no +1 prefix) for non-US/CA entities
    const nonNorthAmerican = country && !["US", "CA"].includes(country);
    const looksUsLocal = /^\d{3}[-.\s]\d{3}[-.\s]\d{4}$/.test(phone.trim()) && digits.length === 10;
    if (nonNorthAmerican && looksUsLocal) return false;
    return true;
  }

  let bestPhone = ""; let bestPhoneCount = 0;
  for (const [phone, srcs] of phoneHits.entries()) {
    if (!isValidPhone(phone)) continue;

    // Do not promote a switchboard or public office number found only on an
    // organisation page. Keep it in contact_evidence for review instead.
    const phoneDigits = phone.replace(/\D/g, "");
    const phoneEvidence = result.evidence.filter(
      ev => ev.vectorType === "phone" && ev.value.replace(/\D/g, "") === phoneDigits,
    );
    const hasOrganizationEvidence = phoneEvidence.some(
      ev => ev.details?.scope === "organization",
    );
    const hasPersonEvidence = phoneEvidence.some(
      ev => ev.details?.scope === "person_candidate",
    );
    if (hasOrganizationEvidence && !hasPersonEvidence) continue;

    if (srcs.length > bestPhoneCount) { bestPhone = phone; bestPhoneCount = srcs.length; }
  }
  if (bestPhone) {
    result.phone = bestPhone;
    result.phoneConfidence = scoreByCorroboration(bestPhoneCount, result.evidence, bestPhone);
    result.sources.push(...(phoneHits.get(bestPhone) ?? []));
  }

  // LinkedIn validation: reject org pages whose slug has zero token overlap with the entity name
  function linkedInSlugMatchesEntity(liUrl: string): boolean {
    try {
      const slug = new URL(liUrl).pathname.split("/").filter(Boolean).pop() ?? "";
      const slugClean = slug.toLowerCase().replace(/[^a-z0-9]/g, "");
      // Entity name tokens (4+ chars)
      const nameTokens = entity.name.toLowerCase().split(/\s+/)
        .map(w => w.replace(/[^a-z0-9]/g, "")).filter(w => w.length >= 4);
      if (nameTokens.length === 0) return true; // can't validate, allow
      return nameTokens.some(tok => slugClean.includes(tok) || tok.includes(slugClean.slice(0, 6)));
    } catch { return true; }
  }

  let bestLinkedIn = ""; let bestLinkedInCount = 0;
  for (const [li, srcs] of linkedinHits.entries()) {
    if (!linkedInSlugMatchesEntity(li)) continue;
    if (srcs.length > bestLinkedInCount) { bestLinkedIn = li; bestLinkedInCount = srcs.length; }
  }
  if (bestLinkedIn) {
    result.linkedinUrl = bestLinkedIn;
    result.sources.push(...(linkedinHits.get(bestLinkedIn) ?? []));
  }

  let bestIg = ""; let bestIgCount = 0;
  for (const [ig, srcs] of igHits.entries()) {
    if (srcs.length > bestIgCount) { bestIg = ig; bestIgCount = srcs.length; }
  }
  if (bestIg) {
    result.instagramUrl = bestIg;
    result.sources.push(...(igHits.get(bestIg) ?? []));
  }

  let bestTw = ""; let bestTwCount = 0;
  for (const [tw, srcs] of twHits.entries()) {
    if (srcs.length > bestTwCount) { bestTw = tw; bestTwCount = srcs.length; }
  }
  if (bestTw) {
    result.twitterUrl = bestTw;
    result.sources.push(...(twHits.get(bestTw) ?? []));
  }

  result.sources = [...new Set(result.sources)];
  return result;
}
