/**
 * Idempotent, source-backed public-registry seeder.
 *
 * Writes directly to Apex's canonical entities, assets and relationships.
 * It does not create a parallel prospect database. Every imported object has
 * a deterministic source key in public_registry_seed_records.
 *
 * Registry evidence is not beneficial ownership, personal wealth or access.
 * Organization contacts remain organization contacts. No residential
 * addresses, aircraft home coordinates, passenger data or guessed values are
 * imported.
 */
import { createHash } from "node:crypto";
import {
  db,
  entitiesTable,
  assetsTable,
  relationshipsTable,
  publicRegistrySeedRecordsTable,
} from "@workspace/db";
import { eq, inArray, like } from "drizzle-orm";
import { appendJobLog, updateJob } from "./job-queue";
import { logger } from "./logger";

const REPOSITORY = "2f22vtd4kr-cloud/V0ApexAtlas";
const DEFAULT_DATA_REF = "04e424690df4bdd2c5a22ee672b4194bfccb710e"; // successful extractor release: FAA + BRREG; see exports/public-registry/summary.json
const DATA_REF = process.env["PUBLIC_REGISTRY_DATA_REF"]?.trim() || DEFAULT_DATA_REF;
const RAW_BASE = "https://raw.githubusercontent.com/" + REPOSITORY + "/" + DATA_REF + "/exports/public-registry";
const BATCH_SIZE = Math.max(100, Math.min(1_000, Number(process.env["PUBLIC_REGISTRY_SEED_BATCH_SIZE"] || 500) || 500));
const ACTIVE_AIRCRAFT_STATUSES = new Set([
  "valid registration",
  "first renewal notice",
  "valid registration (dealer)",
  "non-citizen corporation, flight hours not reported",
]);
const BUSINESS_JET_RE = /\b(gulfstream|falcon\s?\d|challenger|global\s?(express|[45-9]\d{2,4})|learjet|citation\s?(x|latitude|longitude|sovereign|excel|mustang)|phenom|legacy\s?\d|praetor|hawker\s?\d|beechjet|bbj|business\s?jet)\b/i;
const LARGE_OPERATOR_RE = /\b(airlines?|airways|air cargo|express corp|fedex|united airlines|delta air|american airlines|southwest|ups airlines|amazon\.com services|zipline|drone|aerospace|airbus|boeing|embraer|manufacturer|flight training|university|department of|state of|county of|city of)\b/i;
const TRUST_RE = /\b(trustee?|fiduciary|bank of utah|wilmington trust|tvpx|owner trust)\b/i;
const PRIORITY_BRREG_RE = /^(68\.1|68\.2|68\.3|69\.1|69\.2|70\.2|71\.1|71\.12|55\.1|56\.1|41\.1)/;
const VGT_USER_SUPPLIED_URL = "https://virtualglobetrotting.com/map/michel-ducros-house/";

export interface PublicRegistrySeedResult {
  insertedEntities: number;
  insertedAssets: number;
  insertedRelationships: number;
  skippedExisting: number;
  skippedRows: number;
  errors: number;
  datasetVersion: string;
  bySource: Record<string, number>;
}

type CsvRow = Record<string, string>;
type SeedIndexRow = {
  sourceKey: string;
  entityId: number | null;
  relatedEntityId: number | null;
  assetId: number | null;
};
type EntitySeed = {
  sourceKey: string;
  sourceName: string;
  entity: typeof entitiesTable.$inferInsert;
  recordType?: string;
};

function clean(value: unknown): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "nan" || text.toLowerCase() === "null") return "";
  return text;
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function asNumber(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceUrl(file: string): string {
  return RAW_BASE + "/" + file;
}

/** Streaming CSV reader with quoted-comma/newline and escaped-quote support. */
async function* readCsv(url: string): AsyncGenerator<CsvRow> {
  const response = await fetch(url, {
    headers: { Accept: "text/csv" },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body) throw new Error("CSV HTTP " + response.status + ": " + url);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let headers: string[] | null = null;
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let pendingQuote = false;
  let first = true;

  function* parseChunk(chunk: string): Generator<string[]> {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!;
      if (first) {
        first = false;
        if (ch === "\uFEFF") continue;
      }
      if (inQuotes) {
        if (pendingQuote) {
          if (ch === '"') {
            field += '"';
            pendingQuote = false;
            continue;
          }
          pendingQuote = false;
          inQuotes = false;
        } else if (ch === '"') {
          pendingQuote = true;
          continue;
        } else {
          field += ch;
          continue;
        }
      }
      if (ch === '"' && field.length === 0) inQuotes = true;
      else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        field = "";
        const ready = row;
        row = [];
        if (ready.length > 1 || ready[0]) yield ready;
      } else if (ch !== "\r") field += ch;
    }
  }

  try {
    while (true) {
      const next = await reader.read();
      const chunk = decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done });
      for (const values of parseChunk(chunk)) {
        if (!headers) {
          headers = values.map((value) => value.trim().replace(/^\uFEFF/, ""));
          continue;
        }
        const item: CsvRow = {};
        for (let i = 0; i < headers.length; i++) item[headers[i]!] = values[i] ?? "";
        yield item;
      }
      if (next.done) break;
    }
    if (pendingQuote) inQuotes = false;
    if (inQuotes) throw new Error("Malformed CSV: unterminated quoted field at " + url);
    if (field.length || row.length) {
      row.push(field);
      if (!headers) throw new Error("Malformed CSV: no header at " + url);
      const item: CsvRow = {};
      for (let i = 0; i < headers.length; i++) item[headers[i]!] = row[i] ?? "";
      yield item;
    }
  } finally {
    reader.releaseLock();
  }
}

async function loadSeedIndex(prefix: string): Promise<Map<string, SeedIndexRow>> {
  const rows = await db.select({
    sourceKey: publicRegistrySeedRecordsTable.sourceKey,
    entityId: publicRegistrySeedRecordsTable.entityId,
    relatedEntityId: publicRegistrySeedRecordsTable.relatedEntityId,
    assetId: publicRegistrySeedRecordsTable.assetId,
  }).from(publicRegistrySeedRecordsTable)
    .where(like(publicRegistrySeedRecordsTable.sourceKey, prefix + "%"));
  return new Map(rows.map((item) => [item.sourceKey, item]));
}

async function insertEntityBatch(
  batch: EntitySeed[],
  index: Map<string, SeedIndexRow>,
  datasetVersion: string,
): Promise<{ inserted: number; skipped: number }> {
  const fresh = batch.filter((item) => !index.has(item.sourceKey));
  const skipped = batch.length - fresh.length;
  if (!fresh.length) return { inserted: 0, skipped };

  await db.transaction(async (tx) => {
    const inserted = await tx.insert(entitiesTable)
      .values(fresh.map((item) => item.entity))
      .returning({ id: entitiesTable.id });
    if (inserted.length !== fresh.length) throw new Error("Seed entity insert count mismatch");
    await tx.insert(publicRegistrySeedRecordsTable).values(inserted.map((row, i) => ({
      sourceKey: fresh[i]!.sourceKey,
      recordType: fresh[i]!.recordType || "entity",
      sourceName: fresh[i]!.sourceName,
      datasetVersion,
      entityId: row.id,
    })));
    for (let i = 0; i < inserted.length; i++) {
      index.set(fresh[i]!.sourceKey, {
        sourceKey: fresh[i]!.sourceKey,
        entityId: inserted[i]!.id,
        relatedEntityId: null,
        assetId: null,
      });
    }
  });
  return { inserted: fresh.length, skipped };
}

function brregClassification(row: CsvRow): { tier: string; researchEligible: boolean } {
  const codes = clean(row.industry_codes).split("|").map((value) => value.trim()).filter(Boolean);
  const prioritySector = codes.some((code) => PRIORITY_BRREG_RE.test(code));
  const employees = asNumber(clean(row.employees)) ?? 0;
  const hasOrganizationRoute = Boolean(clean(row.business_email) || clean(row.business_phone) || clean(row.official_website));
  if (prioritySector && employees >= 20 && hasOrganizationRoute) {
    return { tier: "review-only-organization", researchEligible: true };
  }
  if (prioritySector && employees >= 5 && hasOrganizationRoute) {
    return { tier: "organization-bridge", researchEligible: true };
  }
  if (prioritySector) return { tier: "universe-only-professional-business", researchEligible: false };
  return { tier: "universe-only", researchEligible: false };
}

function buildBrregEntity(row: CsvRow, sourceKey: string, datasetVersion: string): EntitySeed {
  const orgnr = clean(row.organization_number);
  const name = clean(row.organization);
  const classification = brregClassification(row);
  const email = clean(row.business_email) || null;
  const phone = clean(row.business_phone) || null;
  const codes = clean(row.industry_codes).split("|").map((value) => value.trim()).filter(Boolean);
  const descriptions = clean(row.industry_descriptions).split("|").map((value) => value.trim()).filter(Boolean);
  const metadata = {
    source: "brreg-public-register",
    registryId: "Brønnøysundregistrene — Enhetsregisteret",
    orgnr,
    companyNumber: orgnr,
    legalForm: clean(row.legal_form),
    industryCodes: codes,
    industryDescriptions: descriptions,
    officialWebsite: clean(row.official_website) || null,
    organizationContact: { email, phone },
    businessAddress: [clean(row.business_address), clean(row.business_postcode), clean(row.business_city)].filter(Boolean).join(", "),
    employees: asNumber(clean(row.employees)),
    registeredShareCapital: {
      amount: asNumber(clean(row.registered_share_capital_amount)),
      currency: clean(row.registered_share_capital_currency) || null,
    },
    incorporationDate: clean(row.incorporation_date) || null,
    registeredInBusinessRegister: clean(row.registered_in_business_register) === "True",
    publicRegistrySeed: {
      sourceKey,
      datasetVersion,
      seedKind: "BRREG_COMPANY",
      seedTier: classification.tier,
      researchEligible: classification.researchEligible,
      researchState: classification.researchEligible ? "queued" : "not-queued",
      contactScope: "organization-only",
      personalWealth: "not-assessed",
    },
  };
  return {
    sourceKey,
    sourceName: "Brønnøysundregistrene — Enhetsregisteret",
    entity: {
      name,
      type: "Corporation",
      bayesianScore: classification.researchEligible ? 0.22 : 0.12,
      nationality: "NO",
      estimatedNetWorth: null,
      knownResidences: null,
      email,
      phone,
      phoneSource: phone ? "BRREG-Organization" : null,
      contactMethod: email || phone ? "Organization" : null,
      notes: "Active Norwegian " + (clean(row.legal_form) || "registered company") + " · " +
        descriptions.join("; ") + " · " + (asNumber(clean(row.employees)) ?? "employee count unreported") +
        " employees. Registered share capital and published organization contacts are corporate evidence, not personal wealth or personal access.",
      sourceRegistries: JSON.stringify(["Brønnøysundregistrene — Enhetsregisteret"]),
      metadata: JSON.stringify(metadata),
      isHot: false,
      isStarred: false,
      isHidden: false,
      contactConfidence: 0,
      contactOutcome: email || phone ? "organization_contact" : "evidence_only",
      cookedAt: null,
    },
  };
}

function faaCompanyKey(name: string): string {
  return "faa-company:" + hash(normalize(name));
}

function buildFaaCompanyEntity(
  record: { name: string; aircraftCount: number; models: string[]; tails: string[]; locations: string[]; registrantCountries: string[] },
  sourceKey: string,
  datasetVersion: string,
): EntitySeed {
  const modelText = record.models.join(" | ");
  const trust = TRUST_RE.test(record.name);
  const operator = LARGE_OPERATOR_RE.test(record.name);
  const privateJetSignal = BUSINESS_JET_RE.test(modelText);
  const researchEligible = privateJetSignal && !operator && !trust && record.aircraftCount <= 25;
  const tier = researchEligible
    ? "review-only-asset-signal"
    : trust ? "organization-bridge-fiduciary"
      : operator ? "organization-bridge-operator"
        : "universe-only";
  const metadata = {
    source: "faa-aircraft-registry",
    registryId: "OpenAirDocs — FAA Aircraft Registry",
    faaRegistrantName: record.name,
    registeredAircraftCount: record.aircraftCount,
    aircraftModelSamples: record.models.slice(0, 30),
    sampleNNumbers: record.tails.slice(0, 30),
    businessLocations: [...new Set(record.locations)].slice(0, 10),
    registrantCountries: [...new Set(record.registrantCountries)].filter(Boolean),
    publicRegistrySeed: {
      sourceKey,
      datasetVersion,
      seedKind: "FAA_CORPORATE_REGISTRANT",
      seedTier: tier,
      researchEligible,
      researchState: researchEligible ? "queued" : "not-queued",
      registrantIsBeneficialOwner: false,
      personalWealth: "not-assessed",
      contactability: "not-established-by-registry",
    },
  };
  return {
    sourceKey,
    sourceName: "OpenAirDocs — FAA Aircraft Registry",
    entity: {
      name: record.name,
      type: trust ? "Trust" : "Corporation",
      bayesianScore: researchEligible ? 0.24 : 0.12,
      nationality: null,
      estimatedNetWorth: null,
      knownResidences: null,
      email: null,
      phone: null,
      phoneSource: null,
      contactMethod: null,
      notes: "FAA identifies this legal entity as aircraft registrant for " + record.aircraftCount.toLocaleString() +
        " aircraft. Sample models: " + (record.models.slice(0, 5).join(", ") || "not listed") +
        ". Registrant identity is not evidence of beneficial ownership, individual wealth, passengers, or direct access.",
      sourceRegistries: JSON.stringify(["OpenAirDocs — FAA Aircraft Registry"]),
      metadata: JSON.stringify(metadata),
      isHot: false,
      isStarred: false,
      isHidden: false,
      contactConfidence: 0,
      contactOutcome: "evidence_only",
      cookedAt: null,
    },
  };
}

function repairStationKey(name: string, country: string, city: string): string {
  return "faa145:" + hash(normalize(name) + "|" + normalize(country) + "|" + normalize(city));
}

function buildRepairStationEntity(row: CsvRow, sourceKey: string, datasetVersion: string): EntitySeed {
  const name = clean(row.display_name) || clean(row.name);
  const email = clean(row.email) || null;
  const phone = clean(row.phone) || null;
  const country = clean(row.country) || "Unknown";
  const businessAddress = [
    clean(row.address_line_1), clean(row.address_line_2), clean(row.address_line_3),
    clean(row.city), clean(row.state_province), clean(row.postal_code), country,
  ].filter(Boolean).join(", ");
  const metadata = {
    source: "faa-part145-repair-stations",
    registryId: "FAA Part 145 Repair Station Directory",
    certificateNumbers: clean(row.certificate_number).split("|").filter(Boolean),
    businessAddress,
    businessContact: { email, phone },
    ratings: {
      airframe: clean(row.airframe_rating),
      powerplant: clean(row.powerplant_rating),
      propeller: clean(row.propeller_rating),
      radio: clean(row.radio_rating),
      instrument: clean(row.instrument_rating),
      accessory: clean(row.accessory_rating),
      limited: clean(row.limited_rating),
    },
    publicRegistrySeed: {
      sourceKey,
      datasetVersion,
      seedKind: "FAA_PART145_ORGANIZATION",
      seedTier: "aviation-service-organization",
      researchEligible: false,
      researchState: "not-queued",
      contactScope: "organization-only",
    },
  };
  return {
    sourceKey,
    sourceName: "FAA Part 145 Repair Station Directory",
    entity: {
      name,
      type: "Corporation",
      bayesianScore: 0.14,
      nationality: country,
      estimatedNetWorth: null,
      knownResidences: null,
      email,
      phone,
      phoneSource: phone ? "FAA-Part145-Organization" : null,
      contactMethod: email || phone ? "Organization" : null,
      notes: "FAA-listed Part 145 aviation repair/service station. Ratings are retained in source metadata. Organization contacts only; clients and beneficial ownership are not inferred.",
      sourceRegistries: JSON.stringify(["FAA Part 145 Repair Station Directory"]),
      metadata: JSON.stringify(metadata),
      isHot: false,
      isStarred: false,
      isHidden: false,
      contactConfidence: 0,
      contactOutcome: email || phone ? "organization_contact" : "evidence_only",
      cookedAt: null,
    },
  };
}

async function importBrregCompanies(
  datasetVersion: string,
  result: PublicRegistrySeedResult,
): Promise<Map<string, number>> {
  const prefix = "brreg-company:";
  const index = await loadSeedIndex(prefix);
  const orgnrToEntityId = new Map<string, number>();
  for (const row of index.values()) {
    if (row.entityId) orgnrToEntityId.set(row.sourceKey.slice(prefix.length), row.entityId);
  }
  let batch: EntitySeed[] = [];
  for await (const row of readCsv(sourceUrl("norway_real_estate_and_professional_companies.csv"))) {
    const orgnr = clean(row.organization_number);
    if (!orgnr || clean(row.bankruptcy) === "True" || clean(row.under_liquidation) === "True") {
      result.skippedRows++;
      continue;
    }
    const key = prefix + orgnr;
    if (index.has(key)) {
      result.skippedExisting++;
      if (index.get(key)?.entityId) orgnrToEntityId.set(orgnr, index.get(key)!.entityId!);
      continue;
    }
    batch.push(buildBrregEntity(row, key, datasetVersion));
    if (batch.length >= BATCH_SIZE) {
      const saved = await insertEntityBatch(batch, index, datasetVersion);
      result.insertedEntities += saved.inserted;
      result.skippedExisting += saved.skipped;
      for (const item of batch) {
        const id = index.get(item.sourceKey)?.entityId;
        if (id) orgnrToEntityId.set(item.sourceKey.slice(prefix.length), id);
      }
      batch = [];
    }
  }
  if (batch.length) {
    const saved = await insertEntityBatch(batch, index, datasetVersion);
    result.insertedEntities += saved.inserted;
    result.skippedExisting += saved.skipped;
    for (const item of batch) {
      const id = index.get(item.sourceKey)?.entityId;
      if (id) orgnrToEntityId.set(item.sourceKey.slice(prefix.length), id);
    }
  }
  result.bySource["BRREG companies"] = index.size;
  return orgnrToEntityId;
}

async function importFaaRegistrants(
  datasetVersion: string,
  result: PublicRegistrySeedResult,
): Promise<Map<string, number>> {
  const prefix = "faa-company:";
  const index = await loadSeedIndex(prefix);
  // Company name maps to the entity ID; all city/state subrows from the FAA
  // are consolidated before importing one canonical entity.
  const grouped = new Map<string, { name: string; aircraftCount: number; models: Set<string>; tails: Set<string>; locations: Set<string>; registrantCountries: Set<string> }>();
  for await (const row of readCsv(sourceUrl("faa_corporate_registrants.csv"))) {
    const name = clean(row.organization);
    const key = normalize(name);
    if (!name || !key) { result.skippedRows++; continue; }
    const item = grouped.get(key) || {
      name,
      aircraftCount: 0,
      models: new Set<string>(),
      tails: new Set<string>(),
      locations: new Set<string>(),
      registrantCountries: new Set<string>(),
    };
    item.aircraftCount += asNumber(clean(row.registered_aircraft_count)) || 0;
    clean(row.aircraft_models).split("|").map((x) => x.trim()).filter(Boolean).forEach((model) => item.models.add(model));
    clean(row.sample_n_numbers).split("|").map((x) => x.trim()).filter(Boolean).forEach((tail) => item.tails.add(tail));
    const location = [clean(row.registrant_city), clean(row.registrant_state), clean(row.registrant_country)].filter(Boolean).join(", ");
    if (location) item.locations.add(location);
    const registrantCountry = clean(row.registrant_country);
    if (registrantCountry) item.registrantCountries.add(registrantCountry);
    grouped.set(key, item);
  }

  let batch: EntitySeed[] = [];
  for (const [normalizedName, item] of grouped) {
    const key = faaCompanyKey(normalizedName);
    if (index.has(key)) { result.skippedExisting++; continue; }
    batch.push(buildFaaCompanyEntity({
      name: item.name,
      aircraftCount: item.aircraftCount,
      models: [...item.models].sort().slice(0, 50),
      tails: [...item.tails].sort().slice(0, 50),
      locations: [...item.locations].sort(),
      registrantCountries: [...item.registrantCountries].sort(),
    }, key, datasetVersion));
    if (batch.length >= BATCH_SIZE) {
      const saved = await insertEntityBatch(batch, index, datasetVersion);
      result.insertedEntities += saved.inserted;
      result.skippedExisting += saved.skipped;
      batch = [];
    }
  }
  if (batch.length) {
    const saved = await insertEntityBatch(batch, index, datasetVersion);
    result.insertedEntities += saved.inserted;
    result.skippedExisting += saved.skipped;
  }

  const nameToId = new Map<string, number>();
  for (const [normalizedName, item] of grouped) {
    const key = faaCompanyKey(normalizedName);
    const id = index.get(key)?.entityId;
    if (id) nameToId.set(normalizedName, id);
  }
  result.bySource["FAA corporate registrants"] = index.size;
  return nameToId;
}

async function importRepairStations(datasetVersion: string, result: PublicRegistrySeedResult): Promise<void> {
  const prefix = "faa145:";
  const index = await loadSeedIndex(prefix);
  const grouped = new Map<string, CsvRow>();
  for await (const row of readCsv(sourceUrl("faa_part145_repair_stations.csv"))) {
    const name = clean(row.display_name) || clean(row.name);
    const country = clean(row.country);
    const city = clean(row.city);
    if (!name || !clean(row.certificate_number)) { result.skippedRows++; continue; }
    const key = repairStationKey(name, country, city);
    const existing = grouped.get(key);
    if (existing) {
      const certs = new Set(clean(existing.certificate_number).split("|").filter(Boolean));
      certs.add(clean(row.certificate_number));
      existing.certificate_number = [...certs].join("|");
      continue;
    }
    grouped.set(key, { ...row, certificate_number: clean(row.certificate_number) });
  }
  let batch: EntitySeed[] = [];
  for (const [key, row] of grouped) {
    if (index.has(key)) { result.skippedExisting++; continue; }
    batch.push(buildRepairStationEntity(row, key, datasetVersion));
    if (batch.length >= BATCH_SIZE) {
      const saved = await insertEntityBatch(batch, index, datasetVersion);
      result.insertedEntities += saved.inserted;
      result.skippedExisting += saved.skipped;
      batch = [];
    }
  }
  if (batch.length) {
    const saved = await insertEntityBatch(batch, index, datasetVersion);
    result.insertedEntities += saved.inserted;
    result.skippedExisting += saved.skipped;
  }
  result.bySource["FAA repair stations"] = index.size;
}

async function importBrregManagingDirectors(
  datasetVersion: string,
  orgnrToEntityId: Map<string, number>,
  result: PublicRegistrySeedResult,
): Promise<void> {
  const prefix = "brreg-role:";
  const index = await loadSeedIndex(prefix);
  const companyIds = orgnrToEntityId;
  let batch: EntitySeed[] = [];
  const roleLinks: Array<{ personSourceKey: string; orgnr: string; personName: string; role: string; url: string }> = [];

  for await (const row of readCsv(sourceUrl("norway_business_people_roles.csv"))) {
    const role = clean(row.business_role);
    const person = clean(row.person);
    const orgnr = clean(row.organization_number);
    if (!/^daglig leder$/i.test(role) || !person || !orgnr || !companyIds.has(orgnr)) {
      result.skippedRows++;
      continue;
    }
    const key = prefix + hash(orgnr + "|" + normalize(person) + "|" + normalize(role));
    roleLinks.push({ personSourceKey: key, orgnr, personName: person, role, url: clean(row.source_url) });
    if (index.has(key)) { result.skippedExisting++; continue; }

    const companyName = clean(row.organization);
    const metadata = {
      source: "brreg-official-business-roles",
      registryId: "Brønnøysundregistrene — Enhetsregisteret roles endpoint",
      organizationNumber: orgnr,
      organizationName: companyName,
      officialRole: role,
      officialRoleUrl: clean(row.source_url),
      publicRegistrySeed: {
        sourceKey: key,
        datasetVersion,
        seedKind: "BRREG_MANAGING_DIRECTOR_CANDIDATE",
        seedTier: "professional-role-candidate",
        researchEligible: true,
        researchState: "queued",
        accessEvidence: "not-established",
        ownershipEvidence: "not-provided",
        personalWealth: "not-assessed",
      },
    };
    batch.push({
      sourceKey: key,
      sourceName: "Brønnøysundregistrene — official business role",
      recordType: "person_role",
      entity: {
        name: person,
        type: "Gatekeeper",
        bayesianScore: 0.12,
        nationality: null,
        estimatedNetWorth: null,
        knownResidences: null,
        email: null,
        phone: null,
        phoneSource: null,
        contactMethod: null,
        notes: "BRREG lists " + person + " as " + role + " at " + companyName + " (org. no. " + orgnr +
          "). This is an official professional role only; no ownership, personal wealth, client relationships, intermediary authority, or direct contact route is established.",
        sourceRegistries: JSON.stringify(["Brønnøysundregistrene — Enhetsregisteret"]),
        metadata: JSON.stringify(metadata),
        isHot: false,
        isStarred: false,
        isHidden: false,
        contactConfidence: 0,
        contactOutcome: "evidence_only",
        cookedAt: null,
      },
    });
    if (batch.length >= BATCH_SIZE) {
      const saved = await insertEntityBatch(batch, index, datasetVersion);
      result.insertedEntities += saved.inserted;
      result.skippedExisting += saved.skipped;
      batch = [];
    }
  }
  if (batch.length) {
    const saved = await insertEntityBatch(batch, index, datasetVersion);
    result.insertedEntities += saved.inserted;
    result.skippedExisting += saved.skipped;
  }

  const edgeIndex = await loadSeedIndex("brreg-role-edge:");
  const edgeBatch: Array<{ key: string; personId: number; companyId: number; person: string; role: string; url: string }> = [];
  for (const item of roleLinks) {
    const personId = index.get(item.personSourceKey)?.entityId;
    const companyId = companyIds.get(item.orgnr);
    if (!personId || !companyId) continue;
    const edgeKey = "brreg-role-edge:" + hash(personId + "|" + companyId + "|" + item.role);
    if (edgeIndex.has(edgeKey)) continue;
    edgeBatch.push({ key: edgeKey, personId, companyId, person: item.personName, role: item.role, url: item.url });
  }

  for (let i = 0; i < edgeBatch.length; i += BATCH_SIZE) {
    const chunk = edgeBatch.slice(i, i + BATCH_SIZE);
    await db.transaction(async (tx) => {
      await tx.insert(relationshipsTable).values(chunk.map((item) => ({
        sourceEntityId: item.personId,
        targetId: item.companyId,
        targetType: "Entity",
        relationshipType: "OFFICIAL_ROLE_AT",
        strength: 0.35,
        notes: "BRREG role record: " + item.person + " is listed as " + item.role +
          ". Official role attribution only; it does not imply shareholding, beneficial ownership, client relationships, or ability to introduce anyone. Source: " + item.url,
      })));
      await tx.insert(publicRegistrySeedRecordsTable).values(chunk.map((item) => ({
        sourceKey: item.key,
        recordType: "relationship",
        sourceName: "Brønnøysundregistrene — official business role",
        datasetVersion,
        entityId: item.personId,
        relatedEntityId: item.companyId,
      })));
    });
    for (const item of chunk) edgeIndex.set(item.key, {
      sourceKey: item.key,
      entityId: item.personId,
      relatedEntityId: item.companyId,
      assetId: null,
    });
    result.insertedRelationships += chunk.length;
  }
  result.bySource["BRREG managing-director role cards"] = index.size;
}

async function importFaaIndividualCandidates(
  datasetVersion: string,
  result: PublicRegistrySeedResult,
): Promise<Map<string, number>> {
  const prefix = "faa-individual-person:";
  const index = await loadSeedIndex(prefix);
  const personIds = new Map<string, number>();
  const existingEntityIds = [...index.values()].map((row) => row.entityId).filter((id): id is number => id != null);
  if (existingEntityIds.length) {
    for (let offset = 0; offset < existingEntityIds.length; offset += BATCH_SIZE) {
      const rows = await db.select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata })
        .from(entitiesTable).where(inArray(entitiesTable.id, existingEntityIds.slice(offset, offset + BATCH_SIZE)));
      for (const metadataRow of rows) {
        try {
          const meta = JSON.parse(metadataRow.metadata ?? "{}") as Record<string, any>;
          const location = meta.faaRegistrantArea ?? {};
          personIds.set(normalize(metadataRow.name) + "|" + normalize(String(location.city ?? "")) + "|" + normalize(String(location.state ?? "")) + "|" + normalize(String(location.registrantCountry ?? "")), metadataRow.id);
        } catch { /* ignore malformed metadata */ }
      }
    }
  }

  let batch: EntitySeed[] = [];
  const pendingKeys: string[] = [];
  for await (const row of readCsv(sourceUrl("faa_individual_candidates.csv"))) {
    const name = clean(row.person_name);
    const city = clean(row.registrant_city);
    const state = clean(row.registrant_state);
    const country = clean(row.registrant_country);
    const locationKey = normalize(name) + "|" + normalize(city) + "|" + normalize(state) + "|" + normalize(country);
    if (name.split(/\s+/).length < 2 || name.length < 5) {
      result.skippedRows++;
      continue;
    }
    const key = prefix + hash(locationKey);
    if (index.has(key)) {
      result.skippedExisting++;
      const existing = index.get(key)?.entityId;
      if (existing) personIds.set(locationKey, existing);
      continue;
    }
    const models = clean(row.aircraft_models).split("|").map((x) => x.trim()).filter(Boolean);
    const tails = clean(row.sample_n_numbers).split("|").map((x) => x.trim()).filter(Boolean);
    const metadata = {
      source: "faa-aircraft-registry-individual-registrant",
      registryId: "OpenAirDocs — FAA Aircraft Registry",
      faaRegistrantType: "Individual",
      faaRegistrantArea: {
        city: city || null,
        state: state || null,
        registrantCountry: clean(row.registrant_country) || null,
      },
      registeredAircraftCount: asNumber(clean(row.registered_aircraft_count)) ?? tails.length,
      aircraftModelSamples: models.slice(0, 30),
      sampleNNumbers: tails.slice(0, 30),
      sourceUrl: clean(row.source_url),
      publicRegistrySeed: {
        sourceKey: key,
        datasetVersion,
        seedKind: "FAA_INDIVIDUAL_AIRCRAFT_REGISTRANT",
        seedTier: "review-only-aircraft-signal",
        researchEligible: true,
        researchState: "queued",
        classification: "HNWI candidate only; not confirmed wealth",
        registrantIsBeneficialOwner: false,
        personalWealth: "not-assessed",
        contactability: "no-personal-contact-details-exported",
      },
    };
    batch.push({
      sourceKey: key,
      sourceName: "OpenAirDocs — FAA Aircraft Registry (individual registrant)",
      recordType: "person_candidate",
      entity: {
        name,
        type: "HNWI",
        bayesianScore: 0.2,
        nationality: null,
        estimatedNetWorth: null,
        knownResidences: null,
        email: null,
        phone: null,
        phoneSource: null,
        contactMethod: null,
        notes: "FAA currently lists this individual as registrant of " +
          (asNumber(clean(row.registered_aircraft_count)) ?? tails.length) +
          " qualifying aircraft. This is a review-only aviation asset signal, not verified beneficial ownership, personal net worth, a direct contact route, or proof of access.",
        sourceRegistries: JSON.stringify(["OpenAirDocs — FAA Aircraft Registry"]),
        metadata: JSON.stringify(metadata),
        isHot: false,
        isStarred: false,
        isHidden: false,
        contactConfidence: 0,
        contactOutcome: "evidence_only",
        cookedAt: null,
      },
    });
    pendingKeys.push(locationKey);
    if (batch.length >= BATCH_SIZE) {
      const saved = await insertEntityBatch(batch, index, datasetVersion);
      result.insertedEntities += saved.inserted;
      result.skippedExisting += saved.skipped;
      for (let i = 0; i < batch.length; i++) {
        const id = index.get(batch[i]!.sourceKey)?.entityId;
        if (id) personIds.set(pendingKeys[i]!, id);
      }
      batch = [];
      pendingKeys.length = 0;
    }
  }
  if (batch.length) {
    const saved = await insertEntityBatch(batch, index, datasetVersion);
    result.insertedEntities += saved.inserted;
    result.skippedExisting += saved.skipped;
    for (let i = 0; i < batch.length; i++) {
      const id = index.get(batch[i]!.sourceKey)?.entityId;
      if (id) personIds.set(pendingKeys[i]!, id);
    }
  }
  result.bySource["FAA individual HNWI candidates"] = index.size;
  return personIds;
}

async function importFaaAircraft(
  fileName: string,
  sourcePrefix: string,
  edgePrefix: string,
  registrantIds: Map<string, number>,
  isIndividual: boolean,
  datasetVersion: string,
  result: PublicRegistrySeedResult,
): Promise<void> {
  const assetIndex = await loadSeedIndex(sourcePrefix);
  const edgeIndex = await loadSeedIndex(edgePrefix);
  const oldAssets = await db.select({
    id: assetsTable.id,
    identifier: assetsTable.identifier,
    metadata: assetsTable.metadata,
  }).from(assetsTable).where(eq(assetsTable.category, "Aviation"));
  const assetByTail = new Map<string, number>();
  for (const item of oldAssets) {
    const raw = clean(item.identifier).toUpperCase();
    if (raw) assetByTail.set(raw.startsWith("N") ? raw : "N" + raw, item.id);
    try {
      const metadata = JSON.parse(item.metadata ?? "{}") as Record<string, unknown>;
      const nNumber = clean(metadata["nNumber"]).toUpperCase();
      if (nNumber) assetByTail.set(nNumber.startsWith("N") ? nNumber : "N" + nNumber, item.id);
    } catch { /* old metadata may be absent */ }
  }

  let batch: Array<{ sourceKey: string; row: CsvRow; registrantId: number; existingAssetId: number | null; registrantName: string }> = [];
  async function flush(chunk: typeof batch): Promise<void> {
    if (!chunk.length) return;
    const newAssets = chunk.filter((item) => item.existingAssetId == null);
    const insertedAssetCount = newAssets.length;
    const reusedAssetCount = chunk.length - newAssets.length;
    const freshEdges = chunk.filter((item) => {
      const tail = clean(item.row.n_number).toUpperCase();
      return !edgeIndex.has(edgePrefix + (tail.startsWith("N") ? tail : "N" + tail));
    });
    const insertedEdgeCount = freshEdges.length;
    const assetIdByKey = new Map<string, number>();

    await db.transaction(async (tx) => {
      let created: Array<{ id: number }> = [];
      if (newAssets.length) {
        created = await tx.insert(assetsTable).values(newAssets.map((item) => {
          const tailValue = clean(item.row.n_number).toUpperCase();
          const tail = tailValue.startsWith("N") ? tailValue : "N" + tailValue;
          const model = [clean(item.row.manufacturer), clean(item.row.model)].filter(Boolean).join(" ");
          return {
            category: "Aviation",
            identifier: tail,
            jurisdiction: "FAA",
            description: (model || "Aircraft") +
              (clean(item.row.year_manufactured) ? " · MFR year " + clean(item.row.year_manufactured) : "") +
              " · FAA registrant: " + item.registrantName + " (registrant only; beneficial owner not independently established)",
            estimatedValue: null,
            address: null,
            lastActivityDate: null,
            sourceRegistry: "OpenAirDocs — FAA Aircraft Registration (public data)",
            ownerEntityId: null,
            metadata: JSON.stringify({
              source: isIndividual ? "faa-aircraft-registry-individual-registrant" : "faa-aircraft-registry-corporate-registrant",
              sourceKey: item.sourceKey,
              nNumber: tail,
              registrantName: item.registrantName,
              registrantClass: isIndividual ? "Individual" : "Legal entity",
              city: clean(item.row.registrant_city) || null,
              state: clean(item.row.registrant_state) || null,
              registrantCountry: clean(item.row.registrant_country) || null,
              typeAircraft: clean(item.row.type_aircraft) || null,
              typeEngine: clean(item.row.type_engine) || null,
              serialNumber: clean(item.row.serial_number) || null,
              yearManufactured: clean(item.row.year_manufactured) || null,
              registrationStatus: clean(item.row.status),
              beneficialOwner: "not-independently-established",
              personalWealth: "not-assessed",
              publicRegistrySeed: { datasetVersion, seedTier: "asset-evidence-only" },
            }),
          };
        })).returning({ id: assetsTable.id });
      }
      for (let i = 0; i < newAssets.length; i++) assetIdByKey.set(newAssets[i]!.sourceKey, created[i]!.id);
      for (const item of chunk) {
        if (item.existingAssetId != null) assetIdByKey.set(item.sourceKey, item.existingAssetId);
      }

      if (freshEdges.length) {
        const relationshipRows = freshEdges.map((item) => {
          const tailRaw = clean(item.row.n_number).toUpperCase();
          const tail = tailRaw.startsWith("N") ? tailRaw : "N" + tailRaw;
          return {
            sourceEntityId: item.registrantId,
            targetId: assetIdByKey.get(item.sourceKey)!,
            targetType: "Asset",
            relationshipType: "FAA_REGISTRANT_OF",
            strength: 0.5,
            notes: "FAA identifies " + item.registrantName + " as the registered " +
              (isIndividual ? "person" : "legal entity") + " for " + tail +
              "; this is not independent proof of beneficial ownership, personal use, passengers, wealth, or direct access. Source: " +
              clean(item.row.source_record_url),
          };
        });
        await tx.insert(relationshipsTable).values(relationshipRows);
        await tx.insert(publicRegistrySeedRecordsTable).values(freshEdges.map((item) => {
          const tailRaw = clean(item.row.n_number).toUpperCase();
          const tail = tailRaw.startsWith("N") ? tailRaw : "N" + tailRaw;
          return {
            sourceKey: edgePrefix + tail,
            recordType: "relationship",
            sourceName: "OpenAirDocs — FAA Aircraft Registry",
            datasetVersion,
            entityId: item.registrantId,
            assetId: assetIdByKey.get(item.sourceKey)!,
          };
        }));
      }
      await tx.insert(publicRegistrySeedRecordsTable).values(chunk.map((item) => ({
        sourceKey: item.sourceKey,
        recordType: "asset",
        sourceName: "OpenAirDocs — FAA Aircraft Registry",
        datasetVersion,
        entityId: item.registrantId,
        assetId: assetIdByKey.get(item.sourceKey)!,
      })));
    });

    for (const item of chunk) {
      const tailRaw = clean(item.row.n_number).toUpperCase();
      const tail = tailRaw.startsWith("N") ? tailRaw : "N" + tailRaw;
      const assetId = assetIdByKey.get(item.sourceKey)!;
      assetIndex.set(item.sourceKey, {
        sourceKey: item.sourceKey,
        entityId: item.registrantId,
        relatedEntityId: null,
        assetId,
      });
      edgeIndex.set(edgePrefix + tail, {
        sourceKey: edgePrefix + tail,
        entityId: item.registrantId,
        relatedEntityId: null,
        assetId,
      });
      assetByTail.set(tail, assetId);
    }
    result.insertedAssets += insertedAssetCount;
    result.skippedExisting += reusedAssetCount;
    result.insertedRelationships += insertedEdgeCount;
  }

  for await (const row of readCsv(sourceUrl(fileName))) {
    const status = clean(row.status).toLowerCase();
    const tailRaw = clean(row.n_number).toUpperCase();
    const registrantName = isIndividual ? clean(row.person_name) : clean(row.registrant_name);
    if (!tailRaw || !registrantName || !ACTIVE_AIRCRAFT_STATUSES.has(status)) {
      result.skippedRows++;
      continue;
    }
    const personKey = normalize(registrantName) + "|" + normalize(clean(row.registrant_city)) + "|" +
      normalize(clean(row.registrant_state)) + "|" + normalize(clean(row.registrant_country));
    const registrantId = registrantIds.get(isIndividual ? personKey : normalize(registrantName));
    if (!registrantId) { result.skippedRows++; continue; }
    const tail = tailRaw.startsWith("N") ? tailRaw : "N" + tailRaw;
    const key = sourcePrefix + tail;
    if (assetIndex.has(key)) { result.skippedExisting++; continue; }
    batch.push({
      sourceKey: key,
      row,
      registrantId,
      existingAssetId: assetByTail.get(tail) ?? null,
      registrantName,
    });
    if (batch.length >= BATCH_SIZE) {
      await flush(batch);
      batch = [];
    }
  }
  if (batch.length) await flush(batch);
  result.bySource[isIndividual ? "FAA individual aircraft assets" : "FAA corporate aircraft assets"] = assetIndex.size;
}

async function importVgtReference(datasetVersion: string, result: PublicRegistrySeedResult): Promise<void> {
  const sourceKey = "user-reference:vgt:michel-ducros-house";
  const index = await loadSeedIndex("user-reference:vgt:");
  if (index.has(sourceKey)) { result.skippedExisting++; return; }
  const rows = await db.transaction(async (tx) => {
    const assets = await tx.insert(assetsTable).values({
      category: "RealEstate",
      identifier: "VGT-USER-REFERENCE-001",
      jurisdiction: "Unverified — user-supplied reference",
      description: "User-supplied Virtual Globetrotting URL retained as an unverified research pointer only. No page content, address, coordinates, image, owner, occupant, value, or HNWI identity has been verified.",
      estimatedValue: null,
      address: null,
      latitude: null,
      longitude: null,
      sourceRegistry: "User-supplied Virtual Globetrotting reference (not an authoritative registry)",
      ownerEntityId: null,
      metadata: JSON.stringify({
        source: "user-supplied-reference",
        url: VGT_USER_SUPPLIED_URL,
        verificationStatus: "unverified",
        contentHarvested: false,
        doNotInferOwner: true,
        doNotInferHnwi: true,
        noCoordinatesStored: true,
        publicRegistrySeed: { datasetVersion, seedTier: "manual-review-pointer", researchEligible: false },
      }),
    }).returning({ id: assetsTable.id });
    await tx.insert(publicRegistrySeedRecordsTable).values({
      sourceKey,
      recordType: "manual_asset_lead",
      sourceName: "User-supplied Virtual Globetrotting URL",
      datasetVersion,
      assetId: assets[0]!.id,
    });
    return assets;
  });
  if (rows.length) result.insertedAssets++;
  result.bySource["User-supplied VGT pointer"] = rows.length ? 1 : 0;
}

async function progress(jobId: string | undefined, result: PublicRegistrySeedResult, message: string): Promise<void> {
  if (!jobId) return;
  await updateJob(jobId, {
    status: "running",
    message,
    inserted: result.insertedEntities + result.insertedAssets,
    skipped: result.skippedExisting,
    errors: result.errors,
  });
  await appendJobLog(jobId, message);
}

export async function runPublicRegistrySeedImport(params: { jobId?: string } = {}): Promise<PublicRegistrySeedResult> {
  const result: PublicRegistrySeedResult = {
    insertedEntities: 0,
    insertedAssets: 0,
    insertedRelationships: 0,
    skippedExisting: 0,
    skippedRows: 0,
    errors: 0,
    datasetVersion: DATA_REF,
    bySource: {},
  };
  const startedAt = Date.now();
  await progress(params.jobId, result, "Public registry seed import started; source release " + DATA_REF + ".");
  try {
    const orgnrToEntityId = await importBrregCompanies(DATA_REF, result);
    await progress(params.jobId, result, "BRREG companies complete: " + result.bySource["BRREG companies"]);
    const faaCompanyIds = await importFaaRegistrants(DATA_REF, result);
    await progress(params.jobId, result, "FAA corporate registrants complete: " + result.bySource["FAA corporate registrants"]);
    await importRepairStations(DATA_REF, result);
    await progress(params.jobId, result, "FAA repair stations complete: " + result.bySource["FAA repair stations"]);
    await importBrregManagingDirectors(DATA_REF, orgnrToEntityId, result);
    await progress(params.jobId, result, "BRREG managing-director candidates complete: " + result.bySource["BRREG managing-director role cards"]);
    const faaIndividualIds = await importFaaIndividualCandidates(DATA_REF, result);
    await progress(params.jobId, result, "FAA individual HNWI candidates complete: " + result.bySource["FAA individual HNWI candidates"]);
    await importFaaAircraft("faa_corporate_aircraft.csv", "faa-aircraft:", "faa-registration-edge:", faaCompanyIds, false, DATA_REF, result);
    await progress(params.jobId, result, "FAA corporate aircraft assets complete: " + result.bySource["FAA corporate aircraft assets"]);
    await importFaaAircraft("faa_individual_aircraft.csv", "faa-individual-aircraft:", "faa-individual-registration-edge:", faaIndividualIds, true, DATA_REF, result);
    await progress(params.jobId, result, "FAA individual aircraft assets complete: " + result.bySource["FAA individual aircraft assets"]);
    await importVgtReference(DATA_REF, result);

    if (params.jobId) {
      await updateJob(params.jobId, {
        status: "done",
        progress: 100,
        inserted: result.insertedEntities + result.insertedAssets,
        skipped: result.skippedExisting,
        errors: result.errors,
        finishedAt: new Date().toISOString(),
        message: "Seed import complete — " + result.insertedEntities.toLocaleString() + " entities, " +
          result.insertedAssets.toLocaleString() + " assets, " +
          result.insertedRelationships.toLocaleString() + " relationships",
        result: JSON.stringify(result),
      }).catch(() => {});
      await appendJobLog(params.jobId, "Counts: " + JSON.stringify(result.bySource)).catch(() => {});
    }
    logger.info({ ...result, durationMs: Date.now() - startedAt }, "Public registry seed import finished");
    return result;
  } catch (err: any) {
    result.errors++;
    if (params.jobId) {
      await updateJob(params.jobId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        errors: result.errors,
        outcome: "incomplete",
        message: "Public registry seed import failed: " + (err?.message ?? String(err)),
        result: JSON.stringify(result),
      }).catch(() => {});
      await appendJobLog(params.jobId, "Failed: " + (err?.message ?? String(err))).catch(() => {});
    }
    logger.error({ err: err?.message, insertedEntities: result.insertedEntities, insertedAssets: result.insertedAssets }, "Public registry seed import failed");
    throw err;
  }
}
