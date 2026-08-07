/**
 * Web OSINT Enricher — Layer 1/3 contact discovery via public web sources
 *
 * Uses free, no-key public endpoints to surface LinkedIn URLs, emails,
 * and phone numbers for ingested entities. Deterministic TypeScript — no LLM.
 *
 * Sources (all public, no auth required):
 *   1. DuckDuckGo Instant Answer API  — LinkedIn URL discovery
 *   2. SEC EDGAR full-text search     — email in filings (for SEC-sourced entities)
 *   3. GLEIF / OpenCorporates         — official website → contact scrape
 *   4. DuckDuckGo HTML search         — deep OSINT: name + "email" / "@gmail" etc.
 */

import { logger } from "./logger";

const DDG_API   = "https://api.duckduckgo.com/";
const EDGAR_FT  = "https://efts.sec.gov/LATEST/search-index?q=";
const OC_API    = "https://api.opencorporates.com/v0.4/companies/search";
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
  sources:      string[];
}

// ─── Helper: extract first LinkedIn URL from arbitrary text ──────────────────
function extractLinkedIn(text: string): string | null {
  const m = text.match(/https?:\/\/(www\.)?linkedin\.com\/(in|pub|company)\/[a-zA-Z0-9\-_%]+\/?/i);
  return m ? m[0].replace(/\/$/, "") : null;
}

// ─── Helper: extract best email from text ────────────────────────────────────
const EMAIL_RE = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
const EMAIL_BLOCKLIST = new Set(["example.com", "domain.com", "email.com", "test.com", "foo.com", "noreply", "no-reply"]);

function extractEmail(text: string): string | null {
  const matches = [...text.matchAll(EMAIL_RE)].map(m => m[0].toLowerCase());
  // prefer non-generic: .edu, .gov are usually public contacts; filter blocklist
  const filtered = matches.filter(e => {
    const domain = e.split("@")[1] ?? "";
    return !EMAIL_BLOCKLIST.has(domain) && !domain.startsWith("example") && e.length < 80;
  });
  return filtered[0] ?? null;
}

// ─── Helper: extract phone from text ─────────────────────────────────────────
const PHONE_RE = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g;

function extractPhone(text: string): string | null {
  const m = text.match(PHONE_RE);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

// ─── Source 1: DuckDuckGo Instant Answer API ─────────────────────────────────
// Best for: LinkedIn URL and website discovery
// Rate limit: generous (no hard limit documented)

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

// ─── Source 2: SEC EDGAR full-text search for emails in filings ──────────────
// Only useful for SEC-sourced entities; returns email from filings metadata

async function edgarEmailSearch(name: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(`"${name}"`);
    const url = `${EDGAR_FT}${q}&dateRange=custom&startdt=2020-01-01&forms=SC+13D,SC+13G,DEF+14A&hits.hits._source=period_of_report,entity_name,file_date&hits.hits.total=1`;
    const resp = await fetch(url, { ...FETCH_OPTS, headers: { ...FETCH_OPTS.headers, Accept: "application/json" } });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const hits: any[] = data?.hits?.hits ?? [];
    // EDGAR filing metadata rarely has email; check filing text for SEC contact
    for (const hit of hits.slice(0, 2)) {
      const src = JSON.stringify(hit._source ?? {});
      const email = extractEmail(src);
      if (email) return email;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Source 3: OpenCorporates website field ───────────────────────────────────
async function ocWebsite(name: string): Promise<string | null> {
  try {
    const url = `${OC_API}?q=${encodeURIComponent(name)}&per_page=1&fields=registered_address,website`;
    const resp = await fetch(url, FETCH_OPTS);
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const co = data?.results?.companies?.[0]?.company;
    return co?.website ?? null;
  } catch {
    return null;
  }
}

// ─── Source 4: DuckDuckGo HTML lite search — deep OSINT ──────────────────────
// Parses DuckDuckGo Lite HTML to extract any email/phone found in snippets

async function ddgHtmlSearch(query: string): Promise<string> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ApexFinder/1.0; +https://apexfinder.private)",
        Accept: "text/html",
      },
    });
    if (!resp.ok) return "";
    const html = await resp.text();
    // Strip tags, return plain text of result snippets
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

// ─── Main enrichment function ─────────────────────────────────────────────────

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
  const result: OsintResult = { linkedinUrl: null, email: null, phone: null, website: null, sources: [] };
  const name = entity.name.trim();
  if (!name || name.length < 3) return result;

  const isIndividual = entity.type === "HNWI" || /^[A-Z][a-z]+ [A-Z]/.test(name);
  const isCorp = entity.type === "Corporation" || entity.type === "Trust";

  // ── Step 1: LinkedIn URL via DDG instant answer ───────────────────────────
  try {
    const liQuery = isIndividual
      ? `${name} linkedin profile`
      : `${name} company linkedin`;
    const ddgResult = await ddgInstantAnswer(liQuery);
    const allText = [ddgResult.abstract, ddgResult.url, ...ddgResult.relatedTopics].join(" ");
    const li = extractLinkedIn(allText);
    if (li) {
      result.linkedinUrl = li;
      result.sources.push("DuckDuckGo-LinkedIn");
    }
  } catch (err: any) {
    logger.debug({ err: err.message }, "DDG LinkedIn search failed");
  }

  await sleep(400); // polite rate limit

  // ── Step 2: Email via DDG HTML deep search ────────────────────────────────
  try {
    const emailQuery = isIndividual
      ? `"${name}" email contact site:linkedin.com OR site:bloomberg.com OR site:crunchbase.com`
      : `"${name}" contact email official`;
    const html = await ddgHtmlSearch(emailQuery);
    if (html) {
      const email = extractEmail(html);
      if (email) {
        result.email = email;
        result.sources.push("DuckDuckGo-Email");
      }
      const phone = extractPhone(html);
      if (phone && !result.phone) {
        result.phone = phone;
        result.sources.push("DuckDuckGo-Phone");
      }
      // Also check for LinkedIn in HTML results if not found yet
      if (!result.linkedinUrl) {
        const li = extractLinkedIn(html);
        if (li) {
          result.linkedinUrl = li;
          result.sources.push("DuckDuckGo-HTML-LinkedIn");
        }
      }
    }
  } catch (err: any) {
    logger.debug({ err: err.message }, "DDG HTML search failed");
  }

  await sleep(400);

  // ── Step 3: EDGAR email (for SEC-sourced entities) ────────────────────────
  if (!result.email) {
    const sources = safeParseJson<string[]>(entity.sourceRegistries, []);
    const isEdgar = sources.some(s => /EDGAR|SEC/i.test(s));
    if (isEdgar) {
      try {
        const email = await edgarEmailSearch(name);
        if (email) {
          result.email = email;
          result.sources.push("SEC-EDGAR-Filing");
        }
      } catch (err: any) {
        logger.debug({ err: err.message }, "EDGAR email search failed");
      }
      await sleep(300);
    }
  }

  // ── Step 3b: GLEIF LEI registry (free, no key) — corporate registered contact ──
  if (isCorp && !result.email) {
    try {
      const gleifUrl = `${GLEIF_API}${encodeURIComponent(name)}`;
      const resp = await fetch(gleifUrl, FETCH_OPTS);
      if (resp.ok) {
        const data = await resp.json() as any;
        const entry = data?.data?.[0]?.attributes;
        if (entry) {
          // GLEIF gives registered address + sometimes website
          const website = entry.entity?.registeredAs ? null : null; // LEI entry rarely has website
          const legalAddress = entry.entity?.legalAddress;
          if (legalAddress && !result.website) {
            // Use GLEIF registered address as a contact lead — build lookup URL
            const city = legalAddress.city ?? "";
            const country = legalAddress.country ?? "";
            if (city || country) result.sources.push(`GLEIF-LEI(${city},${country})`);
          }
          // Try to get official registration website from GLEIF relationship
          const reg = entry?.registration;
          if (reg?.managingLou) {
            // Has a LEI — entity is a real registered corporation, high data quality
            result.sources.push("GLEIF-Verified");
          }
        }
      }
    } catch (err: any) {
      logger.debug({ err: err.message }, "GLEIF search failed");
    }
    await sleep(200);
  }

  // ── Step 4: OpenCorporates website (for corporations) ────────────────────
  if (isCorp && !result.website && !result.email) {
    try {
      const website = await ocWebsite(name);
      if (website) {
        result.website = website;
        result.sources.push("OpenCorporates-Website");
        // Try to scrape the website for contact email
        const contactEmail = await scrapeContactEmail(website);
        if (contactEmail) {
          result.email = contactEmail;
          result.sources.push("Website-Scrape");
        }
      }
    } catch (err: any) {
      logger.debug({ err: err.message }, "OC website search failed");
    }
  }

  return result;
}

// ─── Scrape a corporate website's contact page for email ─────────────────────
async function scrapeContactEmail(website: string): Promise<string | null> {
  try {
    const base = website.replace(/\/$/, "");
    const attempts = [base, `${base}/contact`, `${base}/contact-us`, `${base}/about`];
    for (const url of attempts) {
      try {
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(8_000),
          headers: { "User-Agent": "Mozilla/5.0 (compatible; ApexFinder/1.0)", Accept: "text/html" },
        });
        if (!resp.ok) continue;
        const html = await resp.text();
        const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 5000);
        const email = extractEmail(text);
        if (email) return email;
      } catch { /* try next */ }
    }
    return null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function safeParseJson<T>(str: string | null | undefined, fallback: T): T {
  try { return str ? JSON.parse(str) as T : fallback; } catch { return fallback; }
}
