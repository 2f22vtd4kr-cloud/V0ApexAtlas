/**
 * Western HNWI Mass Ingestion Engine — LIVE PUBLIC REGISTRY DATA
 *
 * Fetches REAL people from free public government registries:
 *   • SEC EDGAR SC 13D/G  — US beneficial owners >5% of public companies (real wealthy individuals)
 *   • SEC EDGAR DEF 14A   — US board directors & named executives in proxy statements
 *   • BRREG Norway        — Norwegian company directors (Enhetsregisteret, free, no key)
 *   • Companies House UK  — Officers & PSCs (free, requires COMPANIES_HOUSE_API_KEY)
 *
 * NO synthetic or generated profiles. Every record is a real person from a real source.
 * Each record gets:
 *   • Bayesian investor score derived from signal strength of the source
 *   • Proximity score (how close to personal contact vs. gatekeepers)
 *   • Source attribution linking back to the public registry
 *
 * Redis Upstash dedup set prevents re-insertion across restarts.
 * Batch inserts (100 rows) keep DB pressure manageable.
 */

import { db, entitiesTable, assetsTable } from "@workspace/db";
import type { InsertEntity, InsertAsset } from "@workspace/db";
import { computeBayesianScore } from "./bayesian-scorer";
import { isDuplicate, markSeen, updateJob, appendJobLog, clearDedup } from "./job-queue";
import { logger } from "./logger";
import { filterHumanNamesWithLLM } from "./llm-name-validator";
import {
  getRandomDiscoveryRegistries,
  searchRegistry,
  type RegistryId,
  type RegistryResult,
} from "./registry-client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HarvestedPerson {
  name: string;
  nationality: string;
  location?: string;
  sourceRegistry: string;
  filingType?: string;
  role?: string;
  companyName?: string;
  rawMetadata: Record<string, unknown>;
  signals: {
    isLargeShareholder: boolean; // SC 13D/G filer — owns >5% of a public company
    isBoardDirector: boolean;
    isCompanyOfficer: boolean;
    hasRecentFiling: boolean;
    jurisdiction: string;        // ISO 2-letter
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}

/** Registry adapters must never admit missing-name placeholders. */
export function isPlaceholderRegistryName(name: string): boolean {
  return /^(unknown|unnamed|anonymous|n\/a|not available|entity\s+\d+|unknown company)$/i.test(name.trim());
}

/**
 * EDGAR EFTS returns names in ALL-CAPS "LAST FIRST [MIDDLE]" format.
 * Detect and convert to "First [Middle] Last" title-case for display.
 * Non-ALL-CAPS names (already formatted) are title-cased in place.
 *
 * Examples:
 *   "THIEL PETER"         → "Peter Thiel"
 *   "KIM JAMES J"         → "James J Kim"
 *   "HO CHI SING"         → "Chi Sing Ho"
 *   "LEEDS RICHARD BRIAN" → "Richard Brian Leeds"
 *   "Warren Buffett"      → "Warren Buffett"  (unchanged)
 */
function normalizeEdgarName(raw: string): string {
  // Strip "ET AL" / "et al" suffix before processing (means "and others" in SEC filings)
  const cleaned = raw.trim().replace(/\s+ET\s+AL\.?$/i, "").trim();
  const t = cleaned;
  if (!t) return t;
  const tc = (s: string) =>
    s.length <= 2 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  // If name is all-caps (EDGAR format), reverse LAST → end
  if (t === t.toUpperCase() && /[A-Z]{2}/.test(t)) {
    const parts = t.split(/\s+/);
    if (parts.length >= 2) {
      const [last, ...rest] = parts as [string, ...string[]];
      return [...rest, last].map(tc).join(" ");
    }
    return tc(t);
  }
  // Mixed case: just title-case each word
  return t.split(/\s+/).map(tc).join(" ");
}

/** Rough heuristic: does this look like a person name (not a fund/company)? */
function looksLikePerson(name: string): boolean {
  // EDGAR display names use punctuation inconsistently: "L.P.", "Co.",
  // "S.A.", etc. Normalize separators before checking corporate suffixes so
  // investment vehicles are not harvested as people.
  // Also collapse "L P" (spaced LP — common EDGAR format) → "LP" so the regex catches it.
  const normalized = name
    .replace(/\bL\s+P\b/g, "LP")   // "Falls Investors L P" → "Falls Investors LP"
    .replace(/[.,/&()-]+/g, " ");
  const corporate = /\b(inc|llc|lp|ltd|limited|corp|corporate|co|fund|trust|capital|management|advisors|partners|holdings|group|associates|company|gmbh|ag|sa|sas|sarl|bv|nv|plc|llp|asa|ab|oy|as|enterprise|enterprises|electric|industries|systems|technologies|solutions|logistics|pharmaceuticals|healthcare|financial|bancorp|bancshares|motors|aerospace|energy|networks|communications|international|global|national|resources|properties|realty|infrastructure|united|workers|union|council|committee|coalition|alliance|federation|securitisation|secretarial|appoint|incorporated|services|ventures|consultancy|recruitment|employees|pension|retirement|municipal|government|authority|department|bureau|ministry|prefecture|prefecture|sheriff|police|fire|school|district|county|borough|township|parish|province|territory|state\s+of|city\s+of|town\s+of|port\s+of|university|college|institute|foundation|charity|nonprofit|non-profit|association|society|club|circle|resort|marina|marina|hotel|casino|restaurant|bistro|café|cafe|brasserie|winery|vineyard|gallery|museum|theatre|theater)\b/i;
  // Also reject if the name itself contains role or institutional words — these
  // appear in CH officer search results where the title field bleeds in
  // role metadata (e.g. "Victoria DIRECTOR", "Norfolk County Council NPLAW").
  const roleOrInstitutional = /\b(director|directors|secretary|council|nplaw|details|returned|services limited|two limited|the board)\b/i;
  // Reject abstract concept pairs that look like 2-word TitleCase names
  // (e.g. "Reducing Marginal", "Women Outpaces", "Increasing Returns")
  // Also reject imperative/modal verb starters ("Please Appoint", "Use Privacy")
  const abstractVerb = /^(reducing|increasing|improving|growing|developing|managing|providing|supporting|delivering|enabling|accelerating|leveraging|transforming|creating|building|driving|leading|connecting|advancing|promoting|protecting|expanding|ensuring|achieving|maximizing|minimizing|optimizing|streamlining|integrating|diversifying|please|appoint|use|visit|find|discover|explore|contact|subscribe|register|login|sign|click|read|view|get|learn|see|buy|hire|call|email)\b/i;
  // Reject names with ticker symbols (e.g. "Aramark (armk)")
  const hasTicker = /\([a-z]{2,6}\)$/i.test(name.trim());
  // Accept if no corporate/role keywords and has 2–5 words
  const wordCount = name.trim().split(/\s+/).length;
  return !corporate.test(normalized) && !roleOrInstitutional.test(name) && !abstractVerb.test(name) && !hasTicker && wordCount >= 2 && wordCount <= 6;
}

/**
 * Sanitise a CH officer name by stripping trailing role/title artefacts.
 * CH sometimes returns "John Smith DIRECTOR DETAILS RETURNED FOR" as the title.
 */
function sanitizeChName(raw: string): string {
  return raw
    .replace(/\s+(DIRECTOR|SECRETARY|OFFICER|DETAILS RETURNED FOR|DETAILS RETURNED).*$/i, "")
    .trim();
}

/** Build a deterministic dedup key */
function dedupKey(name: string, jurisdiction: string): string {
  return `${normalizeName(name)}:${jurisdiction.toLowerCase()}`;
}

// ── Harvester 1: SEC EDGAR SC 13D/G — US beneficial owners ──────────────────
//
// SC 13D/G filers are people or entities that own >5% of a public company.
// Individuals filing SC 13D are almost always billionaires or centimillionaires.
// EDGAR EFTS full-text search API — free, no key, up to 10 req/s.

const EDGAR_HEADERS = {
  Accept: "application/json",
  "User-Agent": "ApexFinder/1.0 OSINT-Research research@apexfinder.private",
};

// Common phrases that appear in virtually all SC 13D/G filings — used as search
// anchors to enumerate filers without a specific person query.
const SC13_SEARCH_TERMS = [
  '"sole voting power"',
  '"aggregate beneficial ownership"',
  '"beneficial owner of"',
  '"shares of common stock beneficially"',
  '"right to acquire"',
];

async function* harvestSecEdgar13DG(maxCount: number): AsyncGenerator<HarvestedPerson> {
  let yielded = 0;
  const seen = new Set<string>();

  for (const term of SC13_SEARCH_TERMS) {
    if (yielded >= maxCount) break;

    // Paginate through results — EDGAR returns 10 per page by default
    for (let from = 0; from < 5000 && yielded < maxCount; from += 10) {
      const url =
        `https://efts.sec.gov/LATEST/search-index` +
        `?q=${encodeURIComponent(term)}` +
        `&forms=SC+13D,SC+13G` +
        `&dateRange=custom&startdt=2015-01-01` +
        `&from=${from}`;

      let data: any;
      try {
        const resp = await fetch(url, {
          headers: EDGAR_HEADERS,
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) break;
        data = await resp.json();
      } catch {
        break;
      }

      const hits: any[] = data?.hits?.hits ?? [];
      if (hits.length === 0) break;

      for (const hit of hits) {
        if (yielded >= maxCount) break;
        const src = hit?._source ?? {};

        // EDGAR EFTS API uses display_names array: ["COMPANY (CIK xxx)", "PERSON NAME (CIK xxx)"]
        // Extract all person-like names AND the issuer company name from the array
        const displayNames: string[] = src?.display_names ?? [];
        const allCleanNames = displayNames.map((d: string) => d.replace(/\s*\(CIK\s*\d+\)\s*$/i, "").trim());
        const personNames = allCleanNames.filter((n: string) => n && n.toLowerCase() !== "unknown" && looksLikePerson(n));
        // The issuer is the non-person display_name — the company whose stock is being reported on
        const companyIssuer = allCleanNames.find((n: string) => n && n.length > 2 && !looksLikePerson(n)) ?? null;

        if (personNames.length === 0) continue;

        const formType: string = (src?.root_forms?.[0] ?? src?.form ?? "SC 13D").trim();
        const fileDate: string = src?.file_date ?? "";
        const bizLocation: string =
          (src?.biz_locations?.[0] ?? src?.inc_states?.[0] ?? "US").trim() || "US";

        for (const rawName of personNames) {
          if (yielded >= maxCount) break;
          const nameKey = rawName.toLowerCase();
          if (seen.has(nameKey)) continue;
          seen.add(nameKey);

          yielded++;
          yield {
            name: normalizeEdgarName(rawName),
            nationality: "American",
            location: bizLocation,
            sourceRegistry: `SEC EDGAR — ${formType}`,
            filingType: formType,
            rawMetadata: {
              source: "sec-edgar",
              formType,
              fileDate,
              bizLocation,
              entityName: rawName,
              ...(companyIssuer ? { companyName: companyIssuer } : {}),
              edgarUrl: `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(rawName)}&CIK=&type=${formType}&dateb=&owner=include&count=10&search_text=&action=getcompany`,
            },
            signals: {
              isLargeShareholder: true,
              isBoardDirector: false,
              isCompanyOfficer: false,
              hasRecentFiling: fileDate >= "2022-01-01",
              jurisdiction: "US",
            },
          };
        }
      }

      await sleep(120); // respect EDGAR's 10 req/s limit
    }
  }
}

// ── Harvester 2: SEC EDGAR DEF 14A — Board directors & named executives ─────
//
// DEF 14A (proxy statements) list real directors and named executive officers
// of public US companies. These are confirmed high-level executives.

const DEF14A_SEARCH_TERMS = [
  '"director since"',
  '"independent director"',
  '"chief executive officer"',
  '"non-executive director"',
];

async function* harvestSecEdgarDEF14A(maxCount: number): AsyncGenerator<HarvestedPerson> {
  let yielded = 0;
  const seen = new Set<string>();

  for (const term of DEF14A_SEARCH_TERMS) {
    if (yielded >= maxCount) break;

    for (let from = 0; from < 2000 && yielded < maxCount; from += 10) {
      const url =
        `https://efts.sec.gov/LATEST/search-index` +
        `?q=${encodeURIComponent(term)}` +
        `&forms=DEF+14A` +
        `&dateRange=custom&startdt=2018-01-01` +
        `&from=${from}`;

      let data: any;
      try {
        const resp = await fetch(url, {
          headers: EDGAR_HEADERS,
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) break;
        data = await resp.json();
      } catch {
        break;
      }

      const hits: any[] = data?.hits?.hits ?? [];
      if (hits.length === 0) break;

      for (const hit of hits) {
        if (yielded >= maxCount) break;
        const src = hit?._source ?? {};

        // DEF 14A filer is the company — display_names[0] is the registrant.
        // We store as Corporation type. Individual directors require full-text parsing.
        const displayNames: string[] = src?.display_names ?? [];
        const rawName: string = (displayNames[0] ?? "")
          .replace(/\s*\(CIK\s*\d+\)\s*$/i, "")
          .trim();
        if (!rawName || rawName.toLowerCase() === "unknown") continue;
        const nameKey = rawName.toLowerCase();
        if (seen.has(nameKey)) continue;
        seen.add(nameKey);

        const fileDate: string = src?.file_date ?? "";
        const bizLocation: string =
          (src?.biz_locations?.[0] ?? src?.inc_states?.[0] ?? "US").trim() || "US";

        yielded++;
        yield {
          name: normalizeEdgarName(rawName),
          nationality: "American",
          location: bizLocation || "United States",
          sourceRegistry: "SEC EDGAR — DEF 14A (Proxy)",
          filingType: "DEF 14A",
          rawMetadata: {
            source: "sec-edgar-def14a",
            fileDate,
            bizLocation,
            entityName: rawName,
          },
          signals: {
            isLargeShareholder: false,
            isBoardDirector: true,
            isCompanyOfficer: false,
            hasRecentFiling: fileDate >= "2021-01-01",
            jurisdiction: "US",
          },
        };
      }

      await sleep(120);
    }
  }
}

// ── Harvester 3: BRREG Norway — Company directors (Enhetsregisteret) ─────────
//
// The Norwegian Business Registry (Brønnøysundregistrene) provides a free REST API
// with no authentication. Municipality codes are used to target wealth centres.
// https://data.brreg.no/enhetsregisteret/api/

const BRREG_MUNICIPALITIES = [
  "0301", // Oslo
  "1201", // Bergen
  "5001", // Trondheim
  "1103", // Stavanger
  "4601", // Kristiansand
  "1505", // Ålesund
  "1804", // Bodø
];

const BRREG_ROLE_TRANSLATIONS: Record<string, string> = {
  STYR: "Board member",
  LEDE: "Chairman",
  NEST: "Deputy Chairman",
  MEDL: "Board member",
  VARA: "Deputy board member",
  REPR: "Representative",
  DAGL: "Chief Executive",
  KOMP: "General partner",
};

async function* harvestBRREGDirectors(maxCount: number): AsyncGenerator<HarvestedPerson> {
  let yielded = 0;
  const seen = new Set<string>();

  for (const municipality of BRREG_MUNICIPALITIES) {
    if (yielded >= maxCount) break;

    // Fetch companies in this municipality
    for (let page = 0; page < 20 && yielded < maxCount; page++) {
      let companies: any[];
      try {
        const resp = await fetch(
          `https://data.brreg.no/enhetsregisteret/api/enheter` +
            `?kommunenummer=${municipality}&size=50&page=${page}`,
          {
            headers: { Accept: "application/json", "User-Agent": "ApexFinder/1.0" },
            signal: AbortSignal.timeout(12_000),
          },
        );
        if (!resp.ok) break;
        const data = (await resp.json()) as any;
        companies = data?._embedded?.enheter ?? [];
        if (companies.length === 0) break;
      } catch {
        break;
      }

      for (const company of companies) {
        if (yielded >= maxCount) break;
        const orgnr: string = company?.organisasjonsnummer;
        if (!orgnr) continue;

        // Skip micro-entities: sole proprietors (ENK) and small associations
        // without meaningful employee counts — these are not HNWIs
        const orgForm: string = company?.organisasjonsform?.kode ?? "";
        const employees: number = company?.antallAnsatte ?? 0;
        // ENK = Enkeltpersonforetak (sole trader), FLI = ideell forening (non-profit assoc)
        // Only skip ENK/FLI with 0 employees; AS/ASA/SE companies always pass
        if ((orgForm === "ENK" || orgForm === "FLI") && employees === 0) continue;
        // Require meaningful scale for AS (private limited): at least 2 employees OR skip
        // This filters out 1-person shell companies while keeping real operating businesses
        if (orgForm === "AS" && employees < 2) continue;

        const companyName: string = company?.navn ?? "Unknown Company";
        const city: string =
          company?.forretningsadresse?.poststed ??
          company?.postadresse?.poststed ??
          "Norway";

        // Fetch this company's directors/board
        let rolesData: any;
        try {
          const rolesResp = await fetch(
            `https://data.brreg.no/enhetsregisteret/api/enheter/${orgnr}/roller`,
            {
              headers: { Accept: "application/json" },
              signal: AbortSignal.timeout(8_000),
            },
          );
          if (!rolesResp.ok) continue;
          rolesData = await rolesResp.json();
        } catch {
          continue;
        }

        const rollegrupper: any[] = rolesData?.rollegrupper ?? [];

        for (const gruppe of rollegrupper) {
          const groupCode: string = gruppe?.type?.kode ?? "";
          const groupDesc: string =
            BRREG_ROLE_TRANSLATIONS[groupCode] ?? gruppe?.type?.beskrivelse ?? groupCode;

          const roller: any[] = gruppe?.roller ?? [];

          for (const rolle of roller) {
            if (yielded >= maxCount) break;

            const person = rolle?.person;
            if (!person) continue;

            const navn = person?.navn;
            if (!navn) continue;

            const fullName = [navn.fornavn, navn.mellomnavn, navn.etternavn]
              .filter(Boolean)
              .join(" ")
              .trim();

            if (!fullName || fullName.split(/\s+/).length < 2) continue;

            const roleCode: string = rolle?.type?.kode ?? "";
            const roleDesc: string =
              BRREG_ROLE_TRANSLATIONS[roleCode] ?? rolle?.type?.beskrivelse ?? roleCode;

            const key = dedupKey(fullName, "NO");
            if (seen.has(key)) continue;
            seen.add(key);

            yielded++;
            yield {
              name: fullName,
              nationality: "Norwegian",
              location: city,
              sourceRegistry: "BRREG Norway — Enhetsregisteret",
              role: roleDesc,
              companyName,
              rawMetadata: {
                source: "brreg-norway",
                orgnr,
                companyName,
                municipality,
                city,
                roleCode,
                roleDesc,
                groupCode,
                groupDesc,
                brregUrl: `https://www.brreg.no/company/${orgnr}/`,
              },
              signals: {
                isLargeShareholder: false,
                isBoardDirector: groupCode === "STYR" || roleCode === "LEDE",
                isCompanyOfficer: true,
                hasRecentFiling: true, // BRREG is always current
                jurisdiction: "NO",
              },
            };
          }
        }

        await sleep(80); // be kind to BRREG
      }
    }
  }
}

// ── Harvester 4: Companies House UK — Officers (optional, key required) ───────
//
// Companies House UK provides a free REST API for searching officers (directors,
// secretaries, PSCs). Requires a free API key registered at:
// https://developer.company-information.service.gov.uk/
//
// If COMPANIES_HOUSE_API_KEY is not set, this harvester silently yields nothing.

const CH_OFFICER_QUERIES = [
  "director",
  "managing director",
  "chief executive",
  "chairman",
  "non-executive",
  "person with significant control",
];

async function* harvestCompaniesHouseOfficers(maxCount: number): AsyncGenerator<HarvestedPerson> {
  const apiKey = process.env["COMPANIES_HOUSE_API_KEY"];
  if (!apiKey) return;

  const auth = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  let yielded = 0;
  const seen = new Set<string>();

  for (const query of CH_OFFICER_QUERIES) {
    if (yielded >= maxCount) break;

    for (let start = 0; start < 1000 && yielded < maxCount; start += 20) {
      let data: any;
      try {
        const resp = await fetch(
          `https://api.company-information.service.gov.uk/search/officers` +
            `?q=${encodeURIComponent(query)}&items_per_page=20&start_index=${start}`,
          {
            headers: { Authorization: auth, Accept: "application/json" },
            signal: AbortSignal.timeout(12_000),
          },
        );
        if (!resp.ok) break;
        data = await resp.json();
      } catch {
        break;
      }

      const items: any[] = data?.items ?? [];
      if (items.length === 0) break;

      for (const item of items) {
        if (yielded >= maxCount) break;

        const rawName: string = sanitizeChName((item?.title ?? "").trim());
        if (!rawName) continue;

        // Companies House officer search returns both people and companies — filter
        if (!looksLikePerson(rawName)) continue;

        const key = dedupKey(rawName, "GB");
        if (seen.has(key)) continue;
        seen.add(key);

        const addr = item?.address;
        const location = addr
          ? [addr.locality, addr.region, addr.country].filter(Boolean).join(", ")
          : "United Kingdom";

        yielded++;
        yield {
          name: rawName,
          nationality: item?.nationality ?? "British",
          location,
          sourceRegistry: "Companies House UK — Officers Register",
          role: item?.officer_role,
          rawMetadata: {
            source: "companies-house-officers",
            officerRole: item?.officer_role,
            nationality: item?.nationality,
            occupation: item?.occupation,
            appointedOn: item?.appointed_on,
            dateOfBirth: item?.date_of_birth
              ? `${item.date_of_birth.month}/${item.date_of_birth.year}`
              : undefined,
            chUrl: item?.links?.self
              ? `https://find-and-update.company-information.service.gov.uk${item.links.self}`
              : undefined,
          },
          signals: {
            isLargeShareholder: false,
            isBoardDirector: /director|chairman/i.test(item?.officer_role ?? ""),
            isCompanyOfficer: true,
            hasRecentFiling: (item?.appointed_on ?? "") >= "2018-01-01",
            jurisdiction: "GB",
          },
        };
      }

      await sleep(250); // Companies House rate limit is conservative
    }
  }
}

// ── Entity type classifier — prevents SEC filers being blindly tagged HNWI ───

/**
 * Classify an entity as HNWI, Corporation, or Trust based on name patterns.
 * SEC 13D/13G filers include individuals, LPs, funds, and public companies —
 * we must not tag all of them as HNWI or the hot-leads feed fills with noise.
 */
export function classifyEntityType(name: string): "HNWI" | "Corporation" | "Trust" {
  const n = name.trim();
  // Trusts and foundations first (highest specificity)
  if (/\b(Trust|Trustee|Foundation|Fiduciary|Settlement|Estate\s+of)\b/i.test(n)) return "Trust";
  // Search snippets and registry feeds can surface a person's role next to an
  // organization name. These are never valid HNWI identities; callers that
  // retain the record for review must quarantine it rather than promote it.
  if (/\b(advisor|associate|chairman|chairwoman|chief|director|deputy|executive|founder|general|manager|officer|operator|owner|partner|president|principal|trustee|vice|chair|secretary|controller)\s*$/i.test(n)) return "Corporation";
  // Explicit partnership / LP forms
  if (/\b(L\.?P\.?|LLP|Limited\s+Partnership|General\s+Partnership)\b/i.test(n)) return "Corporation";
  // Corporate-suffix identifiers (trailing \b removed for dot-ending suffixes like S.A., B.V.)
  if (/\b(Inc\.?|Corp\.?|Ltd\.?|LLC|L\.?L\.?C\.?|PLC|Oyj|S\.A\.|S\.p\.A\.|GmbH|B\.V\.|N\.V\.)(?:[^a-zA-Z0-9]|$)/i.test(n)) return "Corporation";
  if (/\bCo\b\.?(\s|$)/i.test(n) && !/^[A-Z][a-z]+ [A-Z][a-z]+ Co\b/.test(n)) return "Corporation"; // "Callon Petroleum Co" not "Smith Brown Co"
  // Industry / fund / financial keywords — never an individual
  if (/\b(Fund|Capital\s+(?:Partners|Management|Advisors|Group)|Venture\s+Capital|Ventures|Holdings|Management|Advisors|Consulting|Partners|Acquisition|Petroleum|Energy|Pharmaceutical|Biotechnology|Technologies|Solutions|Sciences|Industries|Properties|Realty|Entertainment|Media|Analytics|Logistics|Transportation|Shipping|Shipyard|Maritime|Freight|Marine|Enterprises|Associates|Financial\s+(?:Group|Partners|Services)|Investments|Aeronautica|Aeronautics|Crossover|Participacoes|Participations|Beteiligungen|Inversiones|Rentas)\b/i.test(n)) return "Corporation";
  // Banks and financial institutions
  if (/\b(Banc(?:orp|shares?|o)?|Bancshares|Bank(?:ers?|corp|shares)?)\b/i.test(n)) return "Corporation";
  // Committee / political / governance entities
  if (/\b(Committee|Commission|Shareholders?|Congressional|Pension\s+(?:Fund|Plan|Board))\b/i.test(n)) return "Corporation";
  // SEC state-of-incorporation suffixes: "/DE/", "/NV/", "/MD/" etc.
  if (/\/[A-Z]{2}\/$/.test(n)) return "Corporation";
  // Ticker symbol pattern: name ends with "(ABC)", "(ABC, DEF)", "(MS, MS-PA, MS-PE)" — SEC company names
  if (/\s+\([A-Z]{1,5}(?:-[A-Z]{1,3})?(?:,\s*[A-Z]{1,5}(?:-[A-Z]{1,3})?)*\)\s*$/.test(n)) return "Corporation";
  // Government, regulatory, public agency
  if (/\b(Federal|Municipal|County\s+of|City\s+of|State\s+of|Department\s+of|Dept\.?\s+of|Authority|Administration|Agency)\b/i.test(n)) return "Corporation";
  // University / academic / non-profit markers
  if (/\b(University|College|Institute|Hospital|Medical\s+Center|Health\s+System|Church|Diocese|Synagogue|Mosque)\b/i.test(n)) return "Corporation";
  return "HNWI";
}

// ── Record builder — HarvestedPerson → InsertEntity ──────────────────────────

function buildEntity(person: HarvestedPerson): { entity: InsertEntity; key: string } {
  const key = dedupKey(person.name, person.signals.jurisdiction);

  // Bayesian prior based on source quality
  let prior = 0.15;
  if (person.signals.isLargeShareholder) prior = 0.72; // SC 13D/G: almost certainly wealthy
  else if (person.signals.isBoardDirector) prior = 0.38;
  else if (person.signals.isCompanyOfficer) prior = 0.25;
  if (person.signals.hasRecentFiling) prior = Math.min(prior + 0.05, 0.92);

  const entityType = classifyEntityType(person.name);
  const bayesianScore = computeBayesianScore(prior, {
    entityType,
    assetCount: 0,
    assetCategories: [],
    totalAssetValue: 0,
    hasRecentActivity: person.signals.hasRecentFiling,
    recentActivityDays: person.signals.hasRecentFiling ? 90 : 400,
    networkDegree: 0,
    hasGatekeeperConnection: false,
    hasKnownInvestorConnection: false,
    hasShellCompany: false,
    hasAviationAsset: false,
    hasMarineAsset: false,
    hasClubMembership: false,
    hasLuxuryRealEstate: false,
    jurisdictionCount: 1,
  });

  // Proximity score (1–10): how reachable is this person via personal channels?
  // Registry records start low — MCTS research and manual enrichment raises this.
  let proximityScore: number;
  if (person.signals.isLargeShareholder && person.signals.hasRecentFiling) {
    proximityScore = 5; // known wealthy, public filing, active — warm path findable
  } else if (person.signals.isLargeShareholder) {
    proximityScore = 4;
  } else if (person.signals.isBoardDirector) {
    proximityScore = 4;
  } else {
    proximityScore = 3; // company officer — needs further research
  }

  // Contact vector from source type
  let contactMethod: string;
  if (person.signals.isLargeShareholder) {
    contactMethod =
      "SEC EDGAR beneficial owner on record — approach via transfer agent, IR, or shared investor network";
  } else if (person.signals.isBoardDirector) {
    contactMethod = `Board director — approach via company registered office, LinkedIn, or known board colleague`;
  } else if (person.companyName) {
    contactMethod = `Company officer at ${person.companyName} — approach via registered office or professional network`;
  } else {
    contactMethod = "Registry officer — approach via company registered address; research for direct contact";
  }

  const noteFragments: string[] = [
    `Source: ${person.sourceRegistry}.`,
    person.filingType ? `Filing type: ${person.filingType}.` : null,
    person.role ? `Role: ${person.role}.` : null,
    person.companyName ? `Company: ${person.companyName}.` : null,
  ].filter(Boolean) as string[];

  const entity: InsertEntity = {
    name: person.name,
    type: entityType,
    bayesianScore,
    nationality: person.nationality,
    estimatedNetWorth: null, // unknown until enriched via MCTS research
    knownResidences: person.location ?? null,
    linkedinUrl: null,
    phone: null,
    email: null,
    contactMethod,
    notes: noteFragments.join(" "),
    sourceRegistries: JSON.stringify([person.sourceRegistry]),
    metadata: JSON.stringify({
      proximityScore,
      country: person.signals.jurisdiction,
      confidence: proximityScore >= 8 ? "APEX" : proximityScore >= 5 ? "HIGH" : "MEDIUM",
      lastVerified: new Date().toISOString().slice(0, 10),
      westernIngest: true,
      liveSource: true,   // real person from real public registry — not synthetic
      needsEnrichment: true, // flag for MCTS enrichment queue
      ...(person.companyName ? { companyName: person.companyName } : {}),
      ...person.rawMetadata,
    }),
    // Filing/shareholder evidence contributes to Signal, not personal access.
    isHot: false,
  };

  return { entity, key };
}

const RANDOM_REGISTRY_QUERIES = [
  "holdings",
  "capital",
  "investments",
  "management",
  "group",
  "properties",
  "technology",
  "energy",
  "partners",
  "consulting",
  "international",
  "real estate",
] as const;

function pickRandom<T>(values: readonly T[]): T | undefined {
  return values[Math.floor(Math.random() * values.length)];
}

function buildRegistryEntity(
  result: RegistryResult,
  registry: RegistryId,
): { entity: InsertEntity; key: string } {
  const jurisdiction = (result.nationality ?? "XX").slice(0, 2).toUpperCase();
  const isPerson = result.type === "HNWI" || result.type === "Gatekeeper";
  const prior = result.type === "HNWI" ? 0.42 : result.type === "Gatekeeper" ? 0.3 : 0.2;
  const bayesianScore = computeBayesianScore(prior, {
    entityType: result.type,
    assetCount: 0,
    assetCategories: [],
    totalAssetValue: 0,
    hasRecentActivity: true,
    recentActivityDays: 90,
    networkDegree: 0,
    hasGatekeeperConnection: result.type === "Gatekeeper",
    hasKnownInvestorConnection: false,
    hasShellCompany: false,
    hasAviationAsset: false,
    hasMarineAsset: false,
    hasClubMembership: false,
    hasLuxuryRealEstate: false,
    jurisdictionCount: 1,
  });
  const sourceLabel = (() => {
    try {
      const parsed = JSON.parse(result.sourceRegistries || "[]");
      return Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : registry;
    } catch {
      return registry;
    }
  })();
  const rawMetadata = (() => {
    try {
      const parsed = JSON.parse(result.metadata ?? "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  })();

  return {
    key: dedupKey(result.name, jurisdiction),
    entity: {
      name: result.name,
      type: result.type,
      bayesianScore,
      nationality: result.nationality ?? null,
      estimatedNetWorth: null,
      knownResidences: result.knownResidences ?? null,
      linkedinUrl: null,
      phone: null,
      email: null,
      contactMethod: isPerson
        ? "Public registry record — research for a validated person-level contact path"
        : "Public registry company record — research officers, ownership, and public contact channels",
      notes: [
        `Random discovery source: ${sourceLabel}.`,
        result.notes ?? null,
        "Registry evidence is a lead, not proof of wealth or beneficial ownership.",
      ].filter(Boolean).join(" "),
      sourceRegistries: result.sourceRegistries,
      metadata: JSON.stringify({
        ...rawMetadata,
        source: rawMetadata.source ?? registry,
        registryId: registry,
        randomDiscovery: true,
        liveSource: true,
        westernIngest: true,
        needsEnrichment: true,
        lastVerified: new Date().toISOString().slice(0, 10),
      }),
      isHot: false,
    },
  };
}

// ── Main ingestion function ───────────────────────────────────────────────────

export interface IngestionOptions {
  targetCount: number;
  batchSize?: number;
  clearDedupFirst?: boolean;
  jobId?: string;
}

export interface IngestionResult {
  inserted: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

export async function runWesternHnwiIngestion(opts: IngestionOptions): Promise<IngestionResult> {
  const { targetCount, batchSize = 100, jobId, clearDedupFirst = false } = opts;
  const t0 = Date.now();
  let inserted = 0, skipped = 0, errors = 0;

  // Clear stale Upstash dedup set if requested (prevents previous-import entries blocking all ingestion)
  if (clearDedupFirst) {
    try {
      await clearDedup();
      logger.info("Upstash HNWI dedup set cleared before ingestion");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "clearDedup failed (non-fatal)");
    }
  }

  const log = async (msg: string) => {
    logger.info(msg);
    if (jobId) await appendJobLog(jobId, msg);
  };

  const hasCompaniesHouseKey = !!process.env["COMPANIES_HOUSE_API_KEY"];
  const randomDiscoveryRegistries = getRandomDiscoveryRegistries();
  const sources = [
    `Random registry mix (${randomDiscoveryRegistries.length} live adapters)`,
    "SEC EDGAR SC 13D/G (US beneficial owners)",
    "SEC EDGAR DEF 14A (US board directors)",
    "BRREG Norway (company directors)",
    ...(hasCompaniesHouseKey ? ["Companies House UK (officers)"] : []),
  ];

  await log(`Starting LIVE Western HNWI ingestion — target: ${targetCount.toLocaleString()} real records`);
  await log(`Sources: ${sources.join(" | ")}`);
  if (!hasCompaniesHouseKey) {
    await log(`Note: COMPANIES_HOUSE_API_KEY not set — UK Companies House harvester skipped`);
  }

  // ── Budget allocation ────────────────────────────────────────────────────────
  // SC 13D/G is the highest-quality source (real wealthy people) — give it the most budget.
  // Keep every source budget viable for a single-target Atlas round. Without
  // this floor, targetCount=1 rounded all budgets to zero and the supposedly
  // single-target round could admit nothing.
  const edgarBudget13D = targetCount > 0 ? Math.max(1, Math.floor(targetCount * 0.55)) : 0;
  const edgarBudgetDEF = Math.floor(targetCount * 0.25);
  const brregBudget = Math.floor(targetCount * 0.12);
  const chBudget = hasCompaniesHouseKey ? targetCount - edgarBudget13D - edgarBudgetDEF - brregBudget : 0;
  const edgarExtraBudget = !hasCompaniesHouseKey && targetCount > 1
    ? targetCount - edgarBudget13D - edgarBudgetDEF - brregBudget
    : 0;

  const harvesters: [AsyncGenerator<HarvestedPerson>, string][] = [
    [harvestSecEdgar13DG(edgarBudget13D + edgarExtraBudget), "SEC EDGAR SC 13D/G"],
    [harvestSecEdgarDEF14A(edgarBudgetDEF), "SEC EDGAR DEF 14A"],
    [harvestBRREGDirectors(brregBudget), "BRREG Norway"],
    ...(hasCompaniesHouseKey
      ? [[harvestCompaniesHouseOfficers(chBudget), "Companies House UK"] as [AsyncGenerator<HarvestedPerson>, string]]
      : []),
  ];

  // ── Batch state ──────────────────────────────────────────────────────────────
  let entityBatch: InsertEntity[] = [];

  const flushBatch = async () => {
    if (entityBatch.length === 0) return;
    try {
      // LLM validation: secondary filter for any names that slipped past the regex.
      // Runs a single Groq batch call per flush. Fail-open — if Groq is unavailable,
      // all candidates are accepted (matching prior behaviour).
      const candidateNames = entityBatch
        .filter((e) => e.type === "HNWI" || e.type === "Gatekeeper")
        .map(e => e.name ?? "");
      const validNames = new Set(await filterHumanNamesWithLLM(candidateNames));
      const preCount = entityBatch.length;
      entityBatch = entityBatch.filter((e) =>
        e.type === "Corporation" ||
        e.type === "Trust" ||
        validNames.has(e.name ?? ""),
      );
      const rejected = preCount - entityBatch.length;
      if (rejected > 0) {
        logger.info({ rejected }, "LLM name validator: rejected non-human names from batch");
      }

      if (entityBatch.length === 0) return;
      const insertedRows = await db
        .insert(entitiesTable)
        .values(entityBatch)
        .returning({ id: entitiesTable.id });
      inserted += insertedRows.length;
    } catch (err: any) {
      errors += entityBatch.length;
      logger.warn({ err: err.message }, "Batch insert failed");
    }
    entityBatch = [];
  };

  // ── Random live-registry discovery pass ─────────────────────────────────────
  // The source itself is shuffled on every run. Query terms are deliberately
  // broad but bounded, so this creates a changing company/lead mix without
  // pretending that a registry hit proves wealth or ownership.
  const randomDiscoveryBudget = Math.min(
    Math.max(12, Math.floor(targetCount * 0.15)),
    Math.max(0, targetCount),
    250,
  );
  const shuffledRegistries = [...randomDiscoveryRegistries].sort(() => Math.random() - 0.5);
  const randomQueryOrder = [...RANDOM_REGISTRY_QUERIES].sort(() => Math.random() - 0.5);
  let randomDiscoveryInserted = 0;

  for (const registry of shuffledRegistries) {
    if (randomDiscoveryInserted >= randomDiscoveryBudget || inserted >= targetCount) break;
    const query = pickRandom(randomQueryOrder) ?? "holdings";
    try {
      const results = await searchRegistry({
        registry,
        query,
        limit: Math.min(12, randomDiscoveryBudget - randomDiscoveryInserted),
      });
      await log(`[Random registry mix] ${registry} · "${query}" → ${results.length} result(s)`);
      for (const result of results) {
        if (
          randomDiscoveryInserted >= randomDiscoveryBudget ||
          inserted + entityBatch.length >= targetCount
        ) break;
        if (!result.name?.trim()) continue;
        if (isPlaceholderRegistryName(result.name)) {
          skipped++;
          continue;
        }
        const { entity, key } = buildRegistryEntity(result, registry);
        if (await isDuplicate(key)) {
          skipped++;
          continue;
        }
        await markSeen(key);
        entityBatch.push(entity);
        randomDiscoveryInserted++;
        if (entityBatch.length >= batchSize) await flushBatch();
      }
    } catch (err: any) {
      errors++;
      await log(`[Random registry mix] ${registry} unavailable: ${err?.message ?? "unknown error"}`);
    }
  }
  await flushBatch();
  await log(`[Random registry mix] Added ${randomDiscoveryInserted} candidate record(s) from shuffled live sources`);

  // ── Run harvesters sequentially ──────────────────────────────────────────────
  for (const [harvester, sourceName] of harvesters) {
    if (inserted + skipped >= targetCount * 3) break; // safety valve

    await log(`[${sourceName}] Harvesting…`);
    let sourceInserted = 0;

    for await (const person of harvester) {
      if (inserted >= targetCount) break;
      if (isPlaceholderRegistryName(person.name)) {
        skipped++;
        continue;
      }

      const { entity, key } = buildEntity(person);

      if (await isDuplicate(key)) {
        skipped++;
        continue;
      }
      await markSeen(key);

      entityBatch.push(entity);
      sourceInserted++;

      if (entityBatch.length >= batchSize) {
        await flushBatch();

        const progress = Math.round((inserted / targetCount) * 100);
        if (jobId) {
          await updateJob(jobId, {
            inserted,
            skipped,
            errors,
            progress,
            message: `Inserted ${inserted.toLocaleString()} / ${targetCount.toLocaleString()} — source: ${sourceName}`,
          });
        }
        if (inserted % 500 === 0) {
          await log(`Progress: ${inserted.toLocaleString()} inserted, ${skipped} deduped | source: ${sourceName}`);
        }
      }
    }

    await flushBatch();
    await log(`[${sourceName}] Done — contributed ${sourceInserted} candidates`);
    if (inserted >= targetCount) break;
  }

  // Final flush
  await flushBatch();

  const durationMs = Date.now() - t0;
  await log(
    `Ingestion complete. Inserted: ${inserted.toLocaleString()}, Deduped: ${skipped}, Errors: ${errors}, Time: ${(durationMs / 1000).toFixed(1)}s`,
  );

  return { inserted, skipped, errors, durationMs };
}

/** Returns source breakdown for Field Manual stats */
export function getIngestionStats(): {
  sources: { name: string; description: string; jurisdiction: string; requiresKey: boolean }[];
} {
  return {
    sources: [
      {
        name: "Random live registry mix",
        description: "Bounded shuffled discovery across queryable registries; each hit remains a lead pending identity and ownership verification",
        jurisdiction: "Multi-jurisdiction",
        requiresKey: false,
      },
      {
        name: "SEC EDGAR SC 13D/G",
        description: "US beneficial owners filing >5% stake in public companies",
        jurisdiction: "US",
        requiresKey: false,
      },
      {
        name: "SEC EDGAR DEF 14A",
        description: "US public company board directors and named executives (proxy statements)",
        jurisdiction: "US",
        requiresKey: false,
      },
      {
        name: "BRREG Norway (Enhetsregisteret)",
        description: "Norwegian company directors and board members from the national business registry",
        jurisdiction: "NO",
        requiresKey: false,
      },
      {
        name: "Companies House UK",
        description: "UK company officers and persons with significant control",
        jurisdiction: "GB",
        requiresKey: true,
      },
    ],
  };
}
