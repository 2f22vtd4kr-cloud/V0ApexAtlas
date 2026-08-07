/**
 * Live Registry Client — fetches real entity data from public OSINT registries.
 *
 * Supported registries:
 *   - OpenCorporates  (optional API access; explicit-only)
 *   - Companies House UK (free API key required: COMPANIES_HOUSE_API_KEY)
 *   - SEC EDGAR (free, no key)
 *   - GLEIF LEI Register (free, no key)
 *   - BRREG Norway (free, no key)
 *   - ARES Czechia (free, no key)
 *   - BODACC France (free, no key)
 *
 * Returns normalised RegistryResult[] ready to be inserted as EntityInput.
 */

import { searchGleif } from "./gleif-client";
import { REGISTRY_COVERAGE_MATRIX } from "./registry-matrix";
import { logger } from "./logger";

export interface RegistryResult {
  name: string;
  type: "Corporation" | "HNWI" | "Gatekeeper";
  nationality?: string;
  knownResidences?: string;
  sourceRegistries: string; // JSON array string
  notes?: string;
  metadata?: string; // JSON object string — raw registry payload
}

export interface RegistrySearchParams {
  query: string;
  registry: RegistryId;
  limit?: number;
}

export const REGISTRY_IDS = [
  "sec-edgar",
  "companies-house",
  "brreg",
  "ares-czechia",
  "bodacc-france",
  "gleif",
  "cvr-denmark",
  "zefix-switzerland",
  "offeneregister-germany",
  "bolagsverket-sweden",
  "ytj-finland",
  "atoka-italy",
  "borme-spain",
  "kvk-netherlands",
  "kbo-belgium",
  "opencorporates",
] as const;
export type RegistryId = (typeof REGISTRY_IDS)[number];

/**
 * Sources that can participate in the controlled random target-discovery pass.
 * FAA and HMLR are intentionally absent because they are bulk ingestors, not
 * queryable registries. OpenCorporates remains explicit-only until a working
 * API entitlement is configured; its free endpoint currently returns 401.
 */
export const RANDOM_DISCOVERY_REGISTRIES = [
  "sec-edgar",
  "companies-house",
  "brreg",
  "ares-czechia",
  "bodacc-france",
  "gleif",
  "cvr-denmark",
  "zefix-switzerland",
  "offeneregister-germany",
  "bolagsverket-sweden",
  "ytj-finland",
  "atoka-italy",
  "borme-spain",
  "kvk-netherlands",
  "kbo-belgium",
] as const satisfies readonly RegistryId[];

export function getRandomDiscoveryRegistries(): RegistryId[] {
  return RANDOM_DISCOVERY_REGISTRIES.filter(
    (registry) => registry !== "companies-house" || Boolean(process.env["COMPANIES_HOUSE_API_KEY"]),
  );
}

// ─── OpenCorporates ──────────────────────────────────────────────────────────
// Free tier, no API key, rate-limited at 50 requests/day.
// Docs: https://api.opencorporates.com/v0.4/

async function searchOpenCorporates(
  query: string,
  limit: number,
): Promise<RegistryResult[]> {
  const url =
    `https://api.opencorporates.com/v0.4/companies/search` +
    `?q=${encodeURIComponent(query)}` +
    `&per_page=${Math.min(limit, 20)}` +
    `&order=score`;

  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ApexFinder/1.0 OSINT-Intelligence-Platform",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `OpenCorporates ${resp.status}: ${body.slice(0, 200) || resp.statusText}`,
    );
  }

  const data = (await resp.json()) as any;
  const companies: any[] = data?.results?.companies ?? [];

  return companies.map((item: any) => {
    const co = item?.company ?? {};
    const jcode: string = co?.jurisdiction_code ?? "";
    const jurisdiction = (jcode.split("_")[0]?.toUpperCase() ?? jcode.toUpperCase()) || "Unknown";

    const addr = co?.registered_address;
    const addrStr = addr
      ? [addr.street_address, addr.locality, addr.country]
          .filter(Boolean)
          .join(", ")
      : undefined;

    return {
      name: co?.name ?? "Unknown Company",
      type: "Corporation" as const,
      nationality: jurisdiction || undefined,
      knownResidences: addrStr,
      sourceRegistries: JSON.stringify(["OpenCorporates", `${jurisdiction} Registry`]),
      notes: [
        `Reg #${co?.company_number ?? "—"}`,
        co?.company_type ? `Type: ${co.company_type}` : null,
        co?.current_status ? `Status: ${co.current_status}` : null,
        co?.incorporation_date ? `Inc: ${co.incorporation_date}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
      metadata: JSON.stringify({
        source: "opencorporates",
        companyNumber: co?.company_number,
        jurisdictionCode: co?.jurisdiction_code,
        companyType: co?.company_type,
        currentStatus: co?.current_status,
        incorporationDate: co?.incorporation_date,
        openCorporatesUrl: co?.opencorporates_url,
      }),
    };
  });
}

// ─── Companies House UK ───────────────────────────────────────────────────────
// Free API key: https://developer.company-information.service.gov.uk/
// Key is used as HTTP Basic Auth username (empty password).
// Searches both companies AND officers (people) — officers become HNWI candidates.

async function searchCompaniesHouse(
  query: string,
  apiKey: string,
  limit: number,
): Promise<RegistryResult[]> {
  const auth = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  const headers = { Authorization: auth, Accept: "application/json" };
  const signal = AbortSignal.timeout(10_000);
  const n = Math.min(limit, 20);

  const [companiesResp, officersResp] = await Promise.all([
    fetch(
      `https://api.company-information.service.gov.uk/search/companies` +
        `?q=${encodeURIComponent(query)}&items_per_page=${n}`,
      { headers, signal },
    ),
    fetch(
      `https://api.company-information.service.gov.uk/search/officers` +
        `?q=${encodeURIComponent(query)}&items_per_page=${Math.min(limit, 10)}`,
      { headers, signal },
    ),
  ]);

  const results: RegistryResult[] = [];

  // Companies
  if (companiesResp.ok) {
    const data = (await companiesResp.json()) as any;
    for (const item of data?.items ?? []) {
      const addr = item?.registered_office_address;
      const addrStr = addr
        ? [addr.premises, addr.address_line_1, addr.locality, addr.postal_code, addr.country]
            .filter(Boolean)
            .join(", ")
        : undefined;

      results.push({
        name: item?.title ?? "Unknown Company",
        type: "Corporation",
        nationality: "GB",
        knownResidences: addrStr,
        sourceRegistries: JSON.stringify(["Companies House UK"]),
        notes: [
          `Reg #${item?.company_number ?? "—"}`,
          item?.company_type ? `Type: ${item.company_type}` : null,
          item?.company_status ? `Status: ${item.company_status}` : null,
          item?.date_of_creation ? `Created: ${item.date_of_creation}` : null,
          item?.sic_codes?.length ? `SIC: ${item.sic_codes.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" | "),
        metadata: JSON.stringify({
          source: "companies-house",
          companyNumber: item?.company_number,
          companyType: item?.company_type,
          companyStatus: item?.company_status,
          dateOfCreation: item?.date_of_creation,
          sicCodes: item?.sic_codes,
        }),
      });
    }
  }

  // Officers (people) — high-value contacts / potential HNWIs
  if (officersResp.ok) {
    const data = (await officersResp.json()) as any;
    for (const item of data?.items ?? []) {
      const addr = item?.address;
      const addrStr = addr
        ? [addr.premises, addr.address_line_1, addr.locality, addr.postal_code, addr.country]
            .filter(Boolean)
            .join(", ")
        : undefined;

      const dob = item?.date_of_birth;
      const dobStr = dob ? `${dob.month}/${dob.year}` : null;

      results.push({
        name: item?.title ?? "Unknown Officer",
        type: "HNWI",
        nationality: item?.nationality ?? undefined,
        knownResidences: addrStr,
        sourceRegistries: JSON.stringify(["Companies House UK (Officers)"]),
        notes: [
          item?.officer_role ? `Role: ${item.officer_role}` : null,
          dobStr ? `DOB: ${dobStr}` : null,
          item?.occupation ? `Occupation: ${item.occupation}` : null,
          item?.appointed_on ? `Appointed: ${item.appointed_on}` : null,
        ]
          .filter(Boolean)
          .join(" | "),
        metadata: JSON.stringify({
          source: "companies-house-officers",
          officerRole: item?.officer_role,
          dateOfBirth: item?.date_of_birth,
          nationality: item?.nationality,
          occupation: item?.occupation,
          appointedOn: item?.appointed_on,
        }),
      });
    }
  }

  return results;
}

// ─── SEC EDGAR ───────────────────────────────────────────────────────────────
// Free, no API key required.
// Searches EDGAR full-text for a person/company name across:
//   - SC 13D / SC 13G  (large shareholders >5% — high net worth indicator)
//   - DEF 14A          (proxy statements listing directors & executives)
// Returns both Corporation and HNWI results.

async function searchSecEdgar(
  query: string,
  limit: number,
): Promise<RegistryResult[]> {
  const forms = "SC+13D,SC+13G,DEF+14A";
  const url =
    `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${query}"`)}&forms=${forms}&dateRange=custom&startdt=2018-01-01&_source=file_date,entity_name,file_num,period_of_report,form_type,biz_states,biz_location,inc_states&hits.hits.total.value=true&hits.hits._source=true&hits.hits.highlight=true&hits.hits._source.includes=entity_name,file_date,form_type,period_of_report,biz_location,inc_states&hits.hits.total.relation=eq&hits.hits.sort=score&hits.hits._source.excludes=&category=form-type&dateRange=custom`;

  // Simpler URL:
  const searchUrl =
    `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${query}"`)}&forms=SC+13D,SC+13G,DEF+14A&dateRange=custom&startdt=2018-01-01`;

  const resp = await fetch(searchUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ApexFinder/1.0 OSINT-Research research@apexfinder.private",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`SEC EDGAR ${resp.status}: ${body.slice(0, 200) || resp.statusText}`);
  }

  const data = (await resp.json()) as any;
  const hits: any[] = data?.hits?.hits ?? [];

  // Deduplicate by entity name
  const seen = new Set<string>();
  const results: RegistryResult[] = [];

  for (const hit of hits) {
    if (results.length >= limit) break;
    const src = hit?._source ?? {};
    const entityName: string = src?.entity_name ?? src?.display_names?.[0]?.name ?? "Unknown";
    const formType: string = src?.form_type ?? "";
    const fileDate: string = src?.file_date ?? "";
    const biz: string = src?.biz_location ?? src?.inc_states ?? "US";

    const key = entityName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    // SC 13D/G filers are large shareholders — likely HNWI or fund
    const isLargeholder = formType.startsWith("SC 13") || formType.startsWith("SC13");
    // DEF 14A lists directors/executives — treat as potential HNWI gatekeepers
    const isProxy = formType === "DEF 14A" || formType === "DEF14A";

    const type: RegistryResult["type"] =
      isLargeholder ? "HNWI" : isProxy ? "Gatekeeper" : "Corporation";

    results.push({
      name: entityName,
      type,
      nationality: "US",
      knownResidences: biz || undefined,
      sourceRegistries: JSON.stringify(["SEC EDGAR", `Form ${formType}`]),
      notes: [
        formType ? `Filing: ${formType}` : null,
        fileDate ? `Date: ${fileDate}` : null,
        src?.period_of_report ? `Period: ${src.period_of_report}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
      metadata: JSON.stringify({
        source: "sec-edgar",
        formType,
        fileDate,
        entityName,
        bizLocation: src?.biz_location,
        incStates: src?.inc_states,
        cik: src?.entity_id,
      }),
    });
  }

  return results;
}

// ─── BRREG Norway ─────────────────────────────────────────────────────────────

export function normalizeBrregEntity(item: any): RegistryResult | null {
  const orgnr = String(item?.organisasjonsnummer ?? "").trim();
  const name = String(item?.navn ?? "").trim();
  if (!orgnr || !name) return null;

  const address = item?.forretningsadresse ?? item?.postadresse;
  const addressText = address
    ? [
        ...(Array.isArray(address.adresse) ? address.adresse : []),
        address.postnummer,
        address.poststed,
        address.land,
      ].filter(Boolean).join(", ")
    : undefined;

  const website = item?.hjemmeside
    ? (/^https?:\/\//i.test(String(item.hjemmeside)) ? String(item.hjemmeside) : `https://${item.hjemmeside}`)
    : undefined;

  return {
    name,
    type: "Corporation",
    nationality: "NO",
    knownResidences: addressText,
    sourceRegistries: JSON.stringify(["BRREG Norway — Enhetsregisteret"]),
    notes: [
      `Org #${orgnr}`,
      item?.organisasjonsform?.beskrivelse ? `Form: ${item.organisasjonsform.beskrivelse}` : null,
      item?.naeringskode1?.beskrivelse ? `Industry: ${item.naeringskode1.beskrivelse}` : null,
      item?.stiftelsesdato ? `Founded: ${item.stiftelsesdato}` : null,
      item?.telefon ? `Phone: ${item.telefon}` : null,
    ].filter(Boolean).join(" | "),
    metadata: JSON.stringify({
      source: "brreg-norway",
      productionReviewStatus: "review_required",
      orgnr,
      organizationForm: item?.organisasjonsform,
      website,
      phone: item?.telefon,
      industry: item?.naeringskode1,
      municipality: address?.kommune,
      registeredDate: item?.registreringsdatoEnhetsregisteret,
      updatedDate: item?.oppdateringsdato,
      brregUrl: `https://data.brreg.no/enhetsregisteret/api/enheter/${orgnr}`,
    }),
  };
}

async function searchBrreg(query: string, limit: number): Promise<RegistryResult[]> {
  const params = new URLSearchParams({ navn: query, size: String(Math.min(limit, 20)) });
  const resp = await fetch(
    `https://data.brreg.no/enhetsregisteret/api/enheter?${params.toString()}`,
    {
      headers: { Accept: "application/json", "User-Agent": "ApexFinder/1.0 OSINT-Research" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`BRREG ${resp.status}: ${body.slice(0, 200) || resp.statusText}`);
  }
  const data = (await resp.json()) as any;
  return (data?._embedded?.enheter ?? [])
    .map(normalizeBrregEntity)
    .filter((result: RegistryResult | null): result is RegistryResult => Boolean(result))
    .slice(0, limit);
}

// ─── ARES Czechia ─────────────────────────────────────────────────────────────

export function normalizeAresEntity(item: any): RegistryResult | null {
  const ico = String(item?.ico ?? item?.icoId ?? "").trim();
  const name = String(item?.obchodniJmeno ?? "").trim();
  if (!ico || !name) return null;

  const address = item?.sidlo;
  const addressText = String(address?.textovaAdresa ?? "").trim() ||
    [
      address?.nazevUlice,
      address?.cisloDomovni,
      address?.nazevObce,
      address?.psc,
      address?.nazevStatu,
    ].filter(Boolean).join(", ") || undefined;

  return {
    name,
    type: "Corporation",
    nationality: "CZ",
    knownResidences: addressText,
    sourceRegistries: JSON.stringify(["ARES Czech Republic"]),
    notes: [
      `IČO ${ico}`,
      item?.pravniForma ? `Legal form: ${item.pravniForma}` : null,
      item?.datumVzniku ? `Founded: ${item.datumVzniku}` : null,
      item?.datumAktualizace ? `Updated: ${item.datumAktualizace}` : null,
      item?.dic ? `VAT: ${item.dic}` : null,
    ].filter(Boolean).join(" | "),
    metadata: JSON.stringify({
      source: "ares-czechia",
      productionReviewStatus: "review_required",
      ico,
      vatId: item?.dic,
      legalForm: item?.pravniForma,
      legalFormRos: item?.pravniFormaRos,
      foundedDate: item?.datumVzniku,
      updatedDate: item?.datumAktualizace,
      primarySource: item?.primarniZdroj,
      aresUrl: `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`,
    }),
  };
}

async function searchAres(query: string, limit: number): Promise<RegistryResult[]> {
  const normalizedQuery = query.trim();
  // ARES has a separate exact-record endpoint. Prefer it for IČO queries so
  // a numeric identifier never gets sent through the broad name search.
  if (/^\d{8}$/.test(normalizedQuery)) {
    const exact = await fetch(
      `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${encodeURIComponent(normalizedQuery)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (exact.status === 404) return [];
    if (!exact.ok) {
      const body = await exact.text().catch(() => "");
      throw new Error(`ARES ${exact.status}: ${body.slice(0, 200) || exact.statusText}`);
    }
    const result = normalizeAresEntity(await exact.json());
    return result ? [result] : [];
  }

  const resp = await fetch(
    "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat",
    {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        obchodniJmeno: query,
        strankovani: { pocet: Math.min(limit, 20), start: 0 },
      }),
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    if (resp.status === 400 && /příliš mnoho výsledků|too many results/i.test(body)) {
      throw new Error(
        "ARES query is too broad. Search with a more specific Czech company name or an 8-digit IČO.",
      );
    }
    throw new Error(`ARES ${resp.status}: ${body.slice(0, 200) || resp.statusText}`);
  }
  const data = (await resp.json()) as any;
  return (data?.ekonomickeSubjekty ?? [])
    .map(normalizeAresEntity)
    .filter((result: RegistryResult | null): result is RegistryResult => Boolean(result))
    .slice(0, limit);
}

// ─── BODACC France ────────────────────────────────────────────────────────────

function parseJsonObject(value: unknown): Record<string, any> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizeBodaccRecord(record: any): RegistryResult | null {
  const people = parseJsonObject(record?.listepersonnes);
  const person = people?.personne ?? people;
  const name = String(
    person?.denomination ??
    record?.commercant ??
    person?.nomCommercial ??
    "",
  ).split(",")[0]?.trim();
  const announcementId = String(record?.id ?? "").trim();
  if (!name || !announcementId) return null;

  const address = person?.adresseSiegeSocial;
  const addressText = [
    address?.numeroVoie,
    address?.typeVoie,
    address?.nomVoie,
    address?.codePostal,
    address?.ville,
    address?.pays,
    record?.ville,
    record?.departement_nom_officiel,
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || undefined;
  const registrationNumbers = Array.isArray(record?.registre)
    ? record.registre.filter(Boolean)
    : record?.registre ? [record.registre] : [];

  return {
    name,
    type: "Corporation",
    nationality: "FR",
    knownResidences: addressText,
    sourceRegistries: JSON.stringify(["BODACC France"]),
    notes: [
      `Announcement ${announcementId}`,
      record?.familleavis_lib ? `Family: ${record.familleavis_lib}` : null,
      record?.dateparution ? `Published: ${record.dateparution}` : null,
      registrationNumbers.length ? `RCS: ${registrationNumbers.join(", ")}` : null,
    ].filter(Boolean).join(" | "),
    metadata: JSON.stringify({
      source: "bodacc-france",
      productionReviewStatus: "review_required",
      evidenceKind: "commercial_announcement",
      announcementId,
      announcementFamily: record?.familleavis,
      announcementFamilyLabel: record?.familleavis_lib,
      publishedDate: record?.dateparution,
      registrationNumbers,
      court: record?.tribunal,
      url: record?.url_complete,
      personEvidence: person?.administration ?? null,
    }),
  };
}

async function searchBodacc(query: string, limit: number): Promise<RegistryResult[]> {
  const params = new URLSearchParams({
    where: `search("${query.replace(/"/g, '\\"')}")`,
    limit: String(Math.min(limit * 3, 60)),
    order_by: "dateparution DESC",
  });
  const resp = await fetch(
    `https://bodacc-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?${params.toString()}`,
    {
      headers: { Accept: "application/json", "User-Agent": "ApexFinder/1.0 OSINT-Research" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`BODACC ${resp.status}: ${body.slice(0, 200) || resp.statusText}`);
  }
  const data = (await resp.json()) as any;
  const seen = new Set<string>();
  const results: RegistryResult[] = [];
  for (const record of data?.results ?? []) {
    const result = normalizeBodaccRecord(record);
    if (!result) continue;
    const key = `${result.name.toLowerCase()}|${result.metadata}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(result);
    if (results.length >= limit) break;
  }
  return results;
}

// ─── CVR Denmark ─────────────────────────────────────────────────────────────
// Free API, no auth. Returns phone and email directly for Danish companies.
// Docs: https://cvrapi.dk/documentation

async function searchCvrDenmark(query: string, limit: number): Promise<RegistryResult[]> {
  const results: RegistryResult[] = [];
  // CVR API returns one company per query — search up to 3 name variants
  const queries = [query, ...query.split(/\s+/).filter(w => w.length > 3)].slice(0, 3);
  const seen = new Set<string>();
  for (const q of queries) {
    try {
      const url = `https://cvrapi.dk/api?search=${encodeURIComponent(q)}&country=dk`;
      const resp = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "ApexFinder/1.0 OSINT-Research (public data only)",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) continue;
      const data = (await resp.json()) as any;
      const name: string = data?.name ?? "";
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      const vat: string = data?.vat ? String(data.vat) : "";
      const city: string = data?.city ?? "";
      const zipcode: string = data?.zipcode ?? "";
      const address: string = [data?.address, zipcode, city, "Denmark"].filter(Boolean).join(", ");
      results.push({
        name,
        type: "Corporation",
        nationality: "DK",
        knownResidences: address || undefined,
        sourceRegistries: JSON.stringify(["CVR Denmark"]),
        notes: [
          vat ? `CVR: ${vat}` : null,
          data?.phone ? `Phone: ${data.phone}` : null,
          data?.email ? `Email: ${data.email}` : null,
          data?.startdate ? `Founded: ${data.startdate}` : null,
        ].filter(Boolean).join(" | "),
        metadata: JSON.stringify({
          source: "cvr-denmark",
          vat,
          phone: data?.phone ?? null,
          email: data?.email ?? null,
          address,
          city,
          startdate: data?.startdate ?? null,
          industrydesc: data?.industrydesc ?? null,
        }),
      });
      if (results.length >= limit) break;
    } catch { /* next variant */ }
  }
  return results;
}

// ─── Zefix Switzerland ────────────────────────────────────────────────────────
// Free REST API, no auth. Swiss commercial register.
// Docs: https://www.zefix.ch/en/search/entity/list/search

async function searchZefixSwitzerland(query: string, limit: number): Promise<RegistryResult[]> {
  const url = `https://www.zefix.ch/ZefixREST/api/v1/firm/search.json`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "ApexFinder/1.0 OSINT-Research (public data only)",
    },
    body: JSON.stringify({ name: query, maxEntries: Math.min(limit, 20), searchType: "0" }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Zefix ${resp.status}: ${body.slice(0, 200) || resp.statusText}`);
  }
  const data = (await resp.json()) as any;
  const firms: any[] = Array.isArray(data) ? data : (data?.list ?? []);
  const results: RegistryResult[] = [];
  for (const firm of firms.slice(0, limit)) {
    const name: string = firm?.name ?? "";
    if (!name) continue;
    const uid: string = firm?.uid ?? firm?.ehraid ?? "";
    const canton: string = firm?.cantonAbbreviation ?? firm?.legalSeat ?? "";
    const municipality: string = firm?.legalSeat ?? "";
    const address = [municipality, canton, "Switzerland"].filter(Boolean).join(", ");
    results.push({
      name,
      type: "Corporation",
      nationality: "CH",
      knownResidences: address || undefined,
      sourceRegistries: JSON.stringify(["Zefix Switzerland"]),
      notes: [
        uid ? `UID: ${uid}` : null,
        firm?.status ? `Status: ${firm.status}` : null,
        canton ? `Canton: ${canton}` : null,
      ].filter(Boolean).join(" | "),
      metadata: JSON.stringify({
        source: "zefix-switzerland",
        uid,
        ehraid: firm?.ehraid ?? null,
        canton,
        legalSeat: firm?.legalSeat ?? null,
        status: firm?.status ?? null,
        chid: firm?.chid ?? null,
      }),
    });
  }
  return results;
}

// ─── Open Handelsregister Germany ────────────────────────────────────────────
// offeneregister.de — community mirror of the German commercial register.
// Datasette JSON API, no auth, free.
// Docs: https://offeneregister.de/

async function searchOffeneregisterGermany(query: string, limit: number): Promise<RegistryResult[]> {
  // Datasette SQL-over-HTTP: full-text search on company name
  const sql = `SELECT id, current_name, registered_address, company_type_code, jurisdiction_code, current_status FROM companies WHERE current_name LIKE '%${query.replace(/'/g, "''")}%' LIMIT ${Math.min(limit, 20)}`;
  const url = `https://db.offeneregister.de/handelsregister.json?sql=${encodeURIComponent(sql)}`;
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "ApexFinder/1.0 OSINT-Research (public data only)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as any;
    const rows: any[] = data?.rows ?? [];
    const columns: string[] = data?.columns ?? [];
    const results: RegistryResult[] = [];
    for (const row of rows) {
      // Map positional row array to named fields using columns array
      const get = (col: string) => {
        const i = columns.indexOf(col);
        return i >= 0 ? row[i] : null;
      };
      const name: string = get("current_name") ?? "";
      if (!name) continue;
      const address: string = get("registered_address") ?? "";
      const companyType: string = get("company_type_code") ?? "";
      const jurisdiction: string = get("jurisdiction_code") ?? "";
      const status: string = get("current_status") ?? "";
      const id: string = get("id") ?? "";
      results.push({
        name,
        type: "Corporation",
        nationality: "DE",
        knownResidences: address || undefined,
        sourceRegistries: JSON.stringify(["Handelsregister Germany (offeneregister.de)"]),
        notes: [
          companyType ? `Type: ${companyType}` : null,
          jurisdiction ? `Court: ${jurisdiction}` : null,
          status ? `Status: ${status}` : null,
        ].filter(Boolean).join(" | "),
        metadata: JSON.stringify({
          source: "offeneregister-germany",
          id,
          companyType,
          jurisdiction,
          status,
          offeneregisterUrl: id ? `https://offeneregister.de/companies/${id}` : null,
        }),
      });
    }
    return results;
  } catch {
    return [];
  }
}

// ─── Bolagsverket Sweden ──────────────────────────────────────────────────────
// Swedish Companies Registration Office — open data API, no auth.
// Basic search via the Bolagsverket open-data endpoint.
// Docs: https://bolagsverket.se/foretag/apitjanster/

async function searchBolagsverketSweden(query: string, limit: number): Promise<RegistryResult[]> {
  // Use the Allabolag public search API as a fallback — it wraps Bolagsverket data.
  // Primary: Allabolag search (free, no key, returns JSON)
  const url = `https://www.allabolag.se/api/search/company?query=${encodeURIComponent(query)}&limit=${Math.min(limit, 20)}`;
  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ApexFinder/1.0 OSINT-Research (public data only)",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!resp.ok) throw new Error(`Allabolag ${resp.status}`);
    const data = (await resp.json()) as any;
    const hits: any[] = data?.hits ?? data?.results ?? data?.companies ?? [];
    const results: RegistryResult[] = [];
    for (const hit of hits.slice(0, limit)) {
      const name: string = hit?.name ?? hit?.companyName ?? "";
      if (!name) continue;
      const orgNumber: string = hit?.orgNumber ?? hit?.organizationNumber ?? hit?.org_number ?? "";
      const city: string = hit?.city ?? hit?.municipality ?? "";
      const status: string = hit?.status ?? "";
      const legalForm: string = hit?.legalForm ?? hit?.legal_form ?? "";
      const address = [hit?.address, city, "Sweden"].filter(Boolean).join(", ");
      results.push({
        name,
        type: "Corporation",
        nationality: "SE",
        knownResidences: address || city ? address : undefined,
        sourceRegistries: JSON.stringify(["Bolagsverket Sweden"]),
        notes: [
          orgNumber ? `Org: ${orgNumber}` : null,
          legalForm ? `Form: ${legalForm}` : null,
          status ? `Status: ${status}` : null,
        ].filter(Boolean).join(" | "),
        metadata: JSON.stringify({
          source: "bolagsverket-sweden",
          orgNumber,
          legalForm,
          status,
          city,
        }),
      });
    }
    return results;
  } catch {
    // Fallback: Bolagsverket open data SPARQL is complex; return empty gracefully
    return [];
  }
}

// ─── YTJ Finland ─────────────────────────────────────────────────────────────
// Finnish Patent and Registration Office — free REST API, no auth required.
// Docs: https://avoindata.prh.fi/
// Returns company name, business ID, address, registration status.
// Uniquely valuable: one of the few EU registries that returns direct phone/email
// fields in the detail endpoint for some company types.

async function searchYtjFinland(query: string, limit: number): Promise<RegistryResult[]> {
  // PRH Open Data API v3 — correct endpoint and response schema
  // Returns companies: [{businessId:{value, registrationDate}, names:[{name, type}], companyForms, ...}]
  const url = `https://avoindata.prh.fi/opendata-ytj-api/v3/companies?name=${encodeURIComponent(query)}&maxResults=${Math.min(limit, 5)}`;
  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ApexFinder/1.0 OSINT-Research (public data only)",
      },
      signal: AbortSignal.timeout(14_000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as any;
    const companies: any[] = data?.companies ?? [];
    const results: RegistryResult[] = [];

    for (const co of companies.slice(0, limit)) {
      const businessId: string = co?.businessId?.value ?? "";
      if (!businessId) continue;

      // Primary name = type "1" (current Finnish name), fall back to first in array
      const names: any[] = co?.names ?? [];
      const currentName = names.find((n: any) => n?.type === "1" && !n?.endDate) ?? names[0];
      const name: string = currentName?.name ?? "";
      if (!name) continue;

      // Company form (Osakeyhtiö = Oy, etc.)
      const forms: any[] = co?.companyForms ?? [];
      const formDesc = forms[0]?.descriptions?.find((d: any) => d?.languageCode === "3")?.description
        ?? forms[0]?.descriptions?.[0]?.description ?? "";

      // Registration date
      const regDate: string = co?.businessId?.registrationDate ?? "";

      // Fetch detail record for address + contact (best-effort, caps to 1 extra request)
      let address = "Finland";
      let phone: string | null = null;
      let email: string | null = null;
      let website: string | null = null;
      try {
        const detResp = await fetch(
          `https://avoindata.prh.fi/opendata-ytj-api/v3/companies/${encodeURIComponent(businessId)}`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) },
        );
        if (detResp.ok) {
          const det = (await detResp.json()) as any;
          const det0 = det?.companies?.[0] ?? det;
          // Address from addresses array
          const addrs: any[] = det0?.addresses ?? [];
          const mainAddr = addrs.find((a: any) => a?.type === "1" && !a?.endDate) ?? addrs[0];
          if (mainAddr) {
            address = [mainAddr.street, mainAddr.postCode, mainAddr.city, "Finland"]
              .filter(Boolean).join(", ");
          }
          // Contact details (phone, email, website)
          const contacts: any[] = det0?.contactDetails ?? [];
          for (const c of contacts) {
            // type "3" = phone, "4" = email, "5" = website in PRH schema
            const v: string = c?.value ?? "";
            if (!v) continue;
            if ((c?.type === "3" || v.startsWith("+") || /^\d[\d\s\-()]{6,}/.test(v)) && !phone) phone = v;
            else if ((c?.type === "4" || v.includes("@")) && !email) email = v;
            else if ((c?.type === "5" || /^https?:/.test(v)) && !website) website = v;
          }
        }
      } catch { /* use defaults — never block a result on a detail fetch failure */ }

      const noteParts = [
        `Y-tunnus: ${businessId}`,
        formDesc ? `Form: ${formDesc}` : null,
        regDate  ? `Registered: ${regDate}` : null,
        phone    ? `Phone: ${phone}` : null,
        email    ? `Email: ${email}` : null,
        website  ? `Website: ${website}` : null,
      ].filter(Boolean);

      results.push({
        name,
        type: "Corporation",
        nationality: "FI",
        knownResidences: address,
        sourceRegistries: JSON.stringify(["YTJ Finland"]),
        notes: noteParts.join(". "),
        metadata: JSON.stringify({
          source: "ytj-finland",
          businessId,
          companyForm: formDesc || null,
          registrationDate: regDate || null,
          phone,
          email,
          website,
        }),
      });
    }
    return results;
  } catch (err: any) {
    logger.debug({ err: err?.message }, "YTJ Finland search failed");
    return [];
  }
}

// ─── Registro Imprese Italy ───────────────────────────────────────────────────
// Free endpoint: Italian startup / PMI innovativa register (Registro Imprese).
// Returns company details from the national Chamber of Commerce open data.
// Docs: https://startup.registroimprese.it/isin/static/startup/index.html#/ricerca
// Also tries the Italian government open-company endpoint for non-startup firms.

async function searchAtokaItaly(query: string, limit: number): Promise<RegistryResult[]> {
  const results: RegistryResult[] = [];
  const seen = new Set<string>();

  // Tier 1: Italian startup / PMI innovativa register — free, no auth
  try {
    const url = `https://startup.registroimprese.it/isin/api/v1/startup/search?text=${encodeURIComponent(query)}&lang=en&page=0&size=${Math.min(limit, 10)}`;
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ApexFinder/1.0 OSINT-Research (public data only)",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as any;
      const items: any[] = data?.content ?? data?.result ?? data?.data ?? [];
      for (const item of items.slice(0, limit)) {
        const name: string = item?.denominazione ?? item?.ragioneSociale ?? item?.name ?? "";
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        const cf: string = item?.codiceFiscale ?? item?.cf ?? "";
        const city: string = item?.comune ?? item?.city ?? item?.localita ?? "";
        const province: string = item?.provincia ?? item?.prov ?? "";
        const address = [item?.indirizzo, city, province, "Italy"].filter(Boolean).join(", ");
        results.push({
          name,
          type: "Corporation",
          nationality: "IT",
          knownResidences: address || undefined,
          sourceRegistries: JSON.stringify(["Registro Imprese Italy (startup)"]),
          notes: [
            cf ? `CF/PIVA: ${cf}` : null,
            item?.ateco ? `ATECO: ${item.ateco}` : null,
            item?.dataIscrizione ? `Registered: ${item.dataIscrizione}` : null,
          ].filter(Boolean).join(" | "),
          metadata: JSON.stringify({
            source: "atoka-italy",
            cf,
            city,
            province,
            ateco: item?.ateco ?? null,
            category: item?.categoria ?? null,
          }),
        });
        if (results.length >= limit) break;
      }
    }
  } catch { /* graceful — tier 2 follows */ }

  // Tier 2: Italian open-data company search via the government SPARQL/open-data proxy
  // (Only fires if tier 1 returned nothing)
  if (results.length === 0) {
    try {
      const url = `https://www.atoka.io/api/v1/companies?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 5)}`;
      const resp = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "ApexFinder/1.0 OSINT-Research (public data only)",
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as any;
        const items: any[] = data?.data ?? data?.items ?? data?.results ?? [];
        for (const item of items.slice(0, limit)) {
          const name: string = item?.name ?? item?.denominazione ?? "";
          if (!name || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          const vatNumber: string = item?.vatNumber ?? item?.cf ?? item?.id ?? "";
          const city: string = item?.registered_address?.city ?? item?.city ?? "";
          const address = [item?.registered_address?.street, city, "Italy"].filter(Boolean).join(", ");
          results.push({
            name,
            type: "Corporation",
            nationality: "IT",
            knownResidences: address || undefined,
            sourceRegistries: JSON.stringify(["Registro Imprese Italy"]),
            notes: vatNumber ? `PIVA: ${vatNumber}` : undefined,
            metadata: JSON.stringify({ source: "atoka-italy", vatNumber, city }),
          });
          if (results.length >= limit) break;
        }
      }
    } catch { /* return whatever we have */ }
  }

  return results;
}

// ─── BORME Spain ──────────────────────────────────────────────────────────────
// Boletín Oficial del Registro Mercantil — Spain's official commercial register gazette.
// Free BOE (Boletín Oficial del Estado) search API — no auth required.
// Docs: https://www.boe.es/api/
// Also queries the Spanish CNMV for listed company data.

async function searchBormeSpain(query: string, limit: number): Promise<RegistryResult[]> {
  const results: RegistryResult[] = [];
  const seen = new Set<string>();

  // Tier 1: BOE/BORME search API — returns publication summaries with company names
  try {
    const url = `https://boe.es/buscar/api.php?collection=BORME&q=${encodeURIComponent(query)}&lang=es&hits=${Math.min(limit * 2, 20)}`;
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ApexFinder/1.0 OSINT-Research (public data only)",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (resp.ok) {
      const data = (await resp.json()) as any;
      const items: any[] = data?.response?.results?.result ?? data?.items ?? [];
      for (const item of items) {
        // Extract company name from document title — BORME titles are "Company Name SL/SA/SLU"
        const raw: string = item?.titulo ?? item?.title ?? item?.descripcion ?? "";
        if (!raw) continue;
        // Strip BORME publication prefixes like "Actos inscritos: " etc.
        const name = raw.replace(/^[A-ZÁÉÍÓÚ\s]+:\s+/u, "").split(/[,;]/)[0]?.trim() ?? raw;
        if (!name || seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        const pubDate: string = item?.fecha ?? item?.date ?? "";
        const section: string = item?.seccion ?? "";
        const idBoe: string = item?.identificador ?? item?.id ?? "";
        results.push({
          name,
          type: "Corporation",
          nationality: "ES",
          knownResidences: "Spain",
          sourceRegistries: JSON.stringify(["BORME Spain (BOE)"]),
          notes: [
            pubDate ? `Published: ${pubDate}` : null,
            section ? `Section: ${section}` : null,
          ].filter(Boolean).join(" | "),
          metadata: JSON.stringify({
            source: "borme-spain",
            boeId: idBoe,
            pubDate,
            section,
            boeUrl: idBoe ? `https://www.boe.es/boe/dias/${pubDate?.replace(/-/g, "/")}/pdfs/${idBoe}.pdf` : null,
          }),
        });
        if (results.length >= limit) break;
      }
    }
  } catch { /* graceful fallback */ }

  return results;
}

// ─── KvK Netherlands ─────────────────────────────────────────────────────────
// openkvk.nl — community mirror of the Dutch Chamber of Commerce register.
// Free, no auth required. Returns company details including address and type.
// Docs: https://api.openkvk.nl/

async function searchKvkNetherlands(query: string, limit: number): Promise<RegistryResult[]> {
  try {
    // openkvk.nl community API: free, returns JSON, no auth
    const url = `https://api.openkvk.nl/api/v2/companies?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 20)}`;
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ApexFinder/1.0 OSINT-Research (public data only)",
        Origin: "https://www.openkvk.nl",
        Referer: "https://www.openkvk.nl/",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as any;
    const items: any[] = data?.data ?? data?.results ?? data?.companies ?? (Array.isArray(data) ? data : []);
    const results: RegistryResult[] = [];
    for (const item of items.slice(0, limit)) {
      const name: string = item?.naam ?? item?.name ?? item?.company_name ?? "";
      if (!name) continue;
      const kvkNumber: string = item?.kvk ?? item?.kvk_nummer ?? item?.kvknummer ?? item?.id ?? "";
      const city: string = item?.stad ?? item?.city ?? item?.vestigingsplaats ?? "";
      const address = [item?.adres ?? item?.address, item?.postcode ?? item?.zip, city, "Netherlands"]
        .filter(Boolean).join(", ");
      const legalForm: string = item?.rechtsvorm ?? item?.legal_form ?? "";
      const sbi: string = item?.sbi_code ?? "";
      results.push({
        name,
        type: "Corporation",
        nationality: "NL",
        knownResidences: address || undefined,
        sourceRegistries: JSON.stringify(["KvK Netherlands (openkvk.nl)"]),
        notes: [
          kvkNumber ? `KvK: ${kvkNumber}` : null,
          legalForm ? `Form: ${legalForm}` : null,
          sbi ? `SBI: ${sbi}` : null,
        ].filter(Boolean).join(" | "),
        metadata: JSON.stringify({
          source: "kvk-netherlands",
          kvkNumber,
          legalForm,
          city,
          sbi,
        }),
      });
    }
    return results;
  } catch {
    return [];
  }
}

// ─── KBO Belgium ─────────────────────────────────────────────────────────────
// Kruispuntbank van Ondernemingen (KBO) / Banque-Carrefour des Entreprises (BCE).
// Belgium's official company register. Free open-data endpoint, no auth.
// Docs: https://economie.fgov.be/fr/themes/entreprises/banque-carrefour-des

async function searchKboBelgium(query: string, limit: number): Promise<RegistryResult[]> {
  const results: RegistryResult[] = [];

  // Try the official KBO open data REST API
  try {
    const url = `https://kbopub.economie.fgov.be/kbopub/zoeknaamfonetischform.html?lang=nl&searchWord=${encodeURIComponent(query)}&pstcdeNummer=&postgemeente=&gemeente=&typeVennootschap=&status=&startdatum=&einddatum=&numberOfResults=${Math.min(limit, 10)}&resultaat=`;
    const resp = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "ApexFinder/1.0 OSINT-Research (public data only)",
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (resp.ok) {
      const html = await resp.text();
      // Extract company rows from the KBO search results table
      // Pattern: <a href="/kbopub/toonondernemingps.html?ondernemingsnummer=...">Company Name</a>
      const rowRe = /href="[^"]*ondernemingsnummer=(\d+)[^"]*"\s*>([^<]+)<\/a>/g;
      const cityRe = /class="resultaatValue"[^>]*>([^<]{3,40})<\/td>/g;
      let m: RegExpExecArray | null;
      const cities: string[] = [];
      let cityMatch;
      while ((cityMatch = cityRe.exec(html)) !== null) cities.push((cityMatch[1] ?? "").trim());
      let idx = 0;
      while ((m = rowRe.exec(html)) !== null && results.length < limit) {
        const enterpriseNumber = m[1] ?? "";
        const name = (m[2] ?? "").trim();
        if (!name || name.length < 2) { idx++; continue; }
        const city = cities[idx * 2 + 1] ?? cities[idx] ?? "";
        results.push({
          name,
          type: "Corporation",
          nationality: "BE",
          knownResidences: city ? `${city}, Belgium` : "Belgium",
          sourceRegistries: JSON.stringify(["KBO Belgium"]),
          notes: enterpriseNumber ? `KBO: ${enterpriseNumber.replace(/(\d{4})(\d{3})(\d{3})/, "$1.$2.$3")}` : undefined,
          metadata: JSON.stringify({
            source: "kbo-belgium",
            enterpriseNumber,
            city,
            kboUrl: enterpriseNumber ? `https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html?ondernemingsnummer=${enterpriseNumber}` : null,
          }),
        });
        idx++;
      }
    }
  } catch { /* graceful fallback */ }

  return results;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function searchRegistry(
  params: RegistrySearchParams,
): Promise<RegistryResult[]> {
  const { query, registry, limit = 10 } = params;

  if (!query.trim()) throw new Error("Search query cannot be empty.");

  if (registry === "opencorporates") {
    return searchOpenCorporates(query.trim(), limit);
  }

  if (registry === "companies-house") {
    const apiKey = process.env["COMPANIES_HOUSE_API_KEY"];
    if (!apiKey) {
      throw new Error(
        "COMPANIES_HOUSE_API_KEY is not configured. " +
          "Register for a free key at https://developer.company-information.service.gov.uk/ " +
          "and set it as an environment variable.",
      );
    }
    return searchCompaniesHouse(query.trim(), apiKey, limit);
  }

  if (registry === "sec-edgar") {
    return searchSecEdgar(query.trim(), limit);
  }

  if (registry === "gleif") {
    const results = await searchGleif(query.trim(), limit);
    return results.map((r) => ({
      name: r.name,
      type: r.type,
      nationality: r.nationality,
      knownResidences: r.knownResidences,
      sourceRegistries: r.sourceRegistries,
      notes: r.notes,
      metadata: r.metadata,
    }));
  }

  if (registry === "brreg") return searchBrreg(query.trim(), limit);
  if (registry === "ares-czechia") return searchAres(query.trim(), limit);
  if (registry === "bodacc-france") return searchBodacc(query.trim(), limit);
  if (registry === "cvr-denmark") return searchCvrDenmark(query.trim(), limit);
  if (registry === "zefix-switzerland") return searchZefixSwitzerland(query.trim(), limit);
  if (registry === "offeneregister-germany") return searchOffeneregisterGermany(query.trim(), limit);
  if (registry === "bolagsverket-sweden") return searchBolagsverketSweden(query.trim(), limit);
  if (registry === "ytj-finland") return searchYtjFinland(query.trim(), limit);
  if (registry === "atoka-italy") return searchAtokaItaly(query.trim(), limit);
  if (registry === "borme-spain") return searchBormeSpain(query.trim(), limit);
  if (registry === "kvk-netherlands") return searchKvkNetherlands(query.trim(), limit);
  if (registry === "kbo-belgium") return searchKboBelgium(query.trim(), limit);

  throw new Error(`Unknown registry: "${registry}". Use one of: ${REGISTRY_IDS.join(", ")}.`);
}
