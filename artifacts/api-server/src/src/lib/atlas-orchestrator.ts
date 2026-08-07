/**
 * Apex Atlas Orchestrator
 *
 * Full 8-phase investor discovery pipeline that fires every data source,
 * enricher, and OSINT tool in the optimal cross-reference order.
 *
 * Phase 0  — Mass ingestion (parallel): FAA + Western HNWI (EDGAR/CH/BRREG) + optional Land Registry
 * Phase 1  — Registry cross-reference (parallel): OCCRP/OFAC + live ADS-B + CH Company Officers
 * Phase 2  — Identity & ownership (parallel): CH contact enrichment + OpenOwnership BODS + Foundation filings
 * Phase 3  — Populate metadata: notes + stock assets + live source markers
 * Phase 4  — In-house OSINT (7 free sources): Wikidata, GitHub, RDAP, DNS, Gravatar, ProPublica 990
 * Phase 5  — Social / Messenger / Broad discovery
 * Phase 6  — AI OSINT sweep: Perplexity + Tavily + Exa + Groq extraction
 *              → Maigret (3 000+ platforms) + Holehe (120+ services)
 *              → Web-OSINT re-run if Maigret finds 3+ new signals
 * Phase 7  — Forensic cross-reference (parallel): ICIJ Offshore Leaks + Whoxy + Equasis + ADSB history + OpenOwnership
 * Phase 8  — Attribution: Phase J (J4–J9) domain resolution + digital footprint + graph-assisted scoring
 * Phase 9  — Semantic layer: embeddings + net worth backfill + contact outcome backfill + confidence recompute
 * Phase 10 — MCTS research on hot leads (strictly one target at a time)
 */

import { db, entitiesTable, assetsTable, contactEvidenceTable } from "@workspace/db";
import { sql, eq, and, desc, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { updateJob, clearJobFields, createJob, setActiveJob, ownsActiveJob, clearActiveJobIfOwned, appendJobLog } from "./job-queue";
import { runWesternHnwiIngestion } from "./western-hnwi-ingestion";
import { runFaaIngestion } from "./faa-ingestor";
import { runLandRegistryIngestion } from "./land-registry-ingestor";
import { runOccrpEnrichment, runCompaniesHouseEnrichment } from "./enrichment/structured-verification";
import { runOpenSkyEnrichment } from "./opensky-ingestor";
import { enrichInHouse } from "./enrichment/contact-enrichment";
import { deepWebOsintEnrich } from "./enrichment/web-discovery";
import { discoverSocialPresence } from "./enrichment/social-discovery";
import { discoverMessengerPresence } from "./enrichment/messenger-discovery";
import { discoverViaFoundationFilings } from "./enrichment/foundation-filings";
import { runBroadDiscovery } from "./enrichment/broad-discovery";
import { enrichWithIcij } from "./icij-enricher";
import { enrichWithWhoxy } from "./whoxy-enricher";
import { enrichWithEquasis } from "./equasis-enricher";
import { enrichWithAdsbHistory } from "./adsbtrack-enricher";
import { enrichWithOpenOwnership } from "./openownership-enricher";
import { runHolehe, runMaigret, runSherlock } from "./python-tools";
import { buildPerplexityPrompt, runFinalTargetReview } from "./ai-extractor";
import { reconcileStoredContactEvidence } from "./contact-candidate";
import { deriveTargetResearchDisposition } from "./final-target-review";
import { assessTargetReachability, reachabilityDirective } from "./reachability-realism";
import { computeContactConfidence, computeContactOutcome, computeContactState, hasMeaningfulDirectContact } from "./contact-confidence";
import {
  sanitizePublicEmail,
  sanitizePublicPhone,
  sanitizePublicSocialUrl,
  isValidPublicSocialHandle,
  isGenericEmailPrefix,
} from "./contact-validation";
import { contactCacheSet } from "./redis";
import { runPhaseJBatch } from "../routes/phase-j";
import { reachabilityOrderExpr } from "./reachability-rank";
import { backfillWealthLLM } from "./wealth-estimator";
import { materializeBusinessAsset } from "./business-assets";
import { runTargetResearch } from "./target-research";

// ── Jurisdiction → approximate coordinates lookup (for asset geocoding) ───────
const JURISDICTION_COORDS: Record<string, [number, number]> = {
  // Western Europe
  "France": [46.2276, 2.2137], "French Riviera": [43.7102, 7.2620], "Côte d'Azur": [43.7102, 7.2620],
  "Monaco": [43.7384, 7.4246], "Paris": [48.8566, 2.3522], "Nice": [43.7102, 7.2620],
  "Italy": [41.8719, 12.5674], "Sicily": [37.5994, 14.0154], "Sardinia": [40.1209, 9.0129],
  "Rome": [41.9028, 12.4964], "Milan": [45.4642, 9.1900], "Venice": [45.4408, 12.3155],
  "UK": [51.5074, -0.1278], "England": [52.3555, -1.1743], "Scotland": [56.4907, -4.2026],
  "London": [51.5074, -0.1278], "HMLR": [51.5074, -0.1278],
  "Spain": [40.4168, -3.7038], "Mallorca": [39.6953, 3.0176], "Ibiza": [38.9067, 1.4206],
  "Barcelona": [41.3851, 2.1734], "Madrid": [40.4168, -3.7038], "Marbella": [36.5101, -4.8817],
  "Germany": [51.1657, 10.4515], "Austria": [47.5162, 14.5501], "Switzerland": [46.8182, 8.2275],
  "Netherlands": [52.1326, 5.2913], "Belgium": [50.8503, 4.3517], "Luxembourg": [49.8153, 6.1296],
  "Sweden": [59.3293, 18.0686], "Norway": [59.9139, 10.7522], "Denmark": [55.6761, 12.5683],
  "Finland": [60.1699, 24.9384], "Iceland": [64.1355, -21.8954],
  "Portugal": [38.7169, -9.1399], "Lisbon": [38.7169, -9.1399],
  "Greece": [37.9838, 23.7275], "Athens": [37.9838, 23.7275], "Mykonos": [37.4467, 25.3289],
  "Turkey": [41.0082, 28.9784], "Istanbul": [41.0082, 28.9784],
  "Croatia": [45.8150, 15.9819], "Montenegro": [42.4411, 19.2636], "Malta": [35.8997, 14.5146],
  "Cyprus": [35.1264, 33.4299], "Czech Republic": [50.0755, 14.4378], "Poland": [52.2297, 21.0122],
  "Hungary": [47.4979, 19.0402], "Romania": [44.4268, 26.1025], "Russia": [55.7558, 37.6173],
  "Ireland": [53.3498, -6.2603],
  // Middle East / Africa
  "UAE": [25.2048, 55.2708], "Dubai": [25.2048, 55.2708], "Abu Dhabi": [24.4539, 54.3773],
  "Saudi Arabia": [24.7136, 46.6753], "Riyadh": [24.7136, 46.6753],
  "Qatar": [25.2854, 51.5310], "Doha": [25.2854, 51.5310],
  "Kuwait": [29.3759, 47.9774], "Bahrain": [26.0667, 50.5577], "Oman": [23.5880, 58.3829],
  "Israel": [31.7683, 35.2137], "Egypt": [30.0444, 31.2357],
  "South Africa": [26.2041, 28.0473], "Morocco": [33.9716, -6.8498],
  "Nigeria": [9.0820, 8.6753], "Kenya": [1.2921, 36.8219],
  // Americas
  "USA": [37.0902, -95.7129], "United States": [37.0902, -95.7129],
  "FAA": [37.0902, -95.7129],
  "Florida": [27.6648, -81.5158], "Miami": [25.7617, -80.1918], "Palm Beach": [26.7153, -80.0534],
  "California": [36.7783, -119.4179], "Los Angeles": [34.0522, -118.2437],
  "New York": [40.7128, -74.0060], "Manhattan": [40.7831, -73.9712],
  "Texas": [31.9686, -99.9018], "Houston": [29.7604, -95.3698],
  "Colorado": [39.5501, -105.7821], "Aspen": [39.1911, -106.8175],
  "Nevada": [38.8026, -116.4194], "Las Vegas": [36.1699, -115.1398],
  "Canada": [56.1304, -106.3468], "Vancouver": [49.2827, -123.1207], "Toronto": [43.6532, -79.3832],
  "Mexico": [23.6345, -102.5528], "Mexico City": [19.4326, -99.1332],
  "Brazil": [14.2350, -51.9253], "São Paulo": [23.5505, 46.6333], "Rio de Janeiro": [22.9068, 43.1729],
  "Argentina": [38.4161, -63.6167], "Chile": [35.6751, -71.5430],
  "Cayman Islands": [19.3133, -81.2546], "British Virgin Islands": [18.4207, -64.6400],
  "Bahamas": [25.0343, -77.3963], "Bermuda": [32.3078, -64.7505],
  "Panama": [8.9936, -79.5197],
  // Asia Pacific
  "China": [35.8617, 104.1954], "Beijing": [39.9042, 116.4074], "Shanghai": [31.2304, 121.4737],
  "Hong Kong": [22.3193, 114.1694], "Singapore": [1.3521, 103.8198],
  "Japan": [36.2048, 138.2529], "Tokyo": [35.6762, 139.6503],
  "South Korea": [35.9078, 127.7669], "Thailand": [15.8700, 100.9925], "Bangkok": [13.7563, 100.5018],
  "Indonesia": [0.7893, 113.9213], "Malaysia": [4.2105, 101.9758],
  "India": [20.5937, 78.9629], "Mumbai": [19.0760, 72.8777], "New Delhi": [28.6139, 77.2090],
  "Australia": [25.2744, 133.7751], "Sydney": [33.8688, 151.2093], "Melbourne": [37.8136, 144.9631],
  "New Zealand": [40.9006, -174.8860],
  // Registries / special
  "IMO": [43.7102, 7.2620],
  "Unknown": [48.8566, 2.3522],
};

function jurisdictionToCoords(jurisdiction: string): [number, number] | null {
  if (!jurisdiction || jurisdiction === "Unknown") return null;
  const j = jurisdiction.trim();
  if (JURISDICTION_COORDS[j]) return JURISDICTION_COORDS[j];
  // Try case-insensitive / contains match
  const lower = j.toLowerCase();
  for (const [key, coords] of Object.entries(JURISDICTION_COORDS)) {
    if (key.toLowerCase() === lower) return coords;
    if (lower.includes(key.toLowerCase()) && key.length > 4) return coords;
  }
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AtlasOptions {
  /** Target entity count for Western HNWI (EDGAR + CH + BRREG). Default: 15 000 */
  targetCount?: number;
  /** Max FAA aircraft records to ingest. Default: 60 000 */
  faaMaxRecords?: number;
  /** Include UK Land Registry OCOD (300 MB download). Default: false */
  includeLandRegistry?: boolean;
  /** Per-entity batch size for enrichment phases. Default: 200 */
  batchSize?: number;
  /** Phase J batch size. Default: 50 */
  phaseJBatchSize?: number;
  /** Skip Phase 0 ingestion (data already imported). Default: false */
  skipIngestion?: boolean;
  /** Only process entities with bayesianScore >= 0.5. Default: false */
  hotLeadsOnly?: boolean;
  /** Run MCTS research on hot leads at end. Default: true */
  runResearch?: boolean;
  /** Max MCTS sessions in Phase 10. Default: 10 */
  researchLimit?: number;
  /** Maximum time allowed for one target's sequential enrichment journey. Default: 180s. */
  targetTimeoutMs?: number;
  /**
   * Discovery-first mode: diverse web searches (hotels, golf clubs, funds, venues…)
   * run BEFORE registry ingestion. FAA is skipped unless skipFaa=false.
   * Default: false (legacy FAA-first behaviour).
   */
  discoveryFirst?: boolean;
  /** Skip FAA aircraft ingestion entirely. Default: false */
  skipFaa?: boolean;
  /**
   * Number of randomised broad-discovery categories to run in Phase 0.
   * Each category fires ~10 venue/venue/fund queries and extracts owner names.
   * Default: 3 when discoveryFirst=true, 1 otherwise.
   */
  broadCategories?: number;
  /**
   * Run one existing entity through the complete target-scoped enrichment
   * journey. This deliberately bypasses discovery, registry ingestion, and
   * global backfills so no other target is touched.
   */
  singleTargetId?: number;
}

export interface AtlasResult {
  phase: number;
  ingested: number;
  enriched: number;
  contactsFound: number;
  hotLeads: number;
  durationMs: number;
  phaseSummary: Record<string, string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_TARGET_TIMEOUT_MS = 180_000;
const timedOutTargets = new Map<string, Set<number>>();

class AtlasTargetTimeoutError extends Error {
  constructor(
    public readonly entityId: number,
    public readonly phase: string,
    public readonly timeoutMs: number,
  ) {
    super(`Target ${entityId} exceeded the ${Math.round(timeoutMs / 1_000)}s ${phase} timeout.`);
    this.name = "AtlasTargetTimeoutError";
  }
}

function targetWasTimedOut(atlasJobId: string, entityId: number): boolean {
  return timedOutTargets.get(atlasJobId)?.has(entityId) ?? false;
}

function markTargetTimedOut(atlasJobId: string, entityId: number): void {
  const ids = timedOutTargets.get(atlasJobId) ?? new Set<number>();
  ids.add(entityId);
  timedOutTargets.set(atlasJobId, ids);
}

async function recordTargetTimeout(
  entity: { id: number; name: string; metadata?: string | null },
  phase: string,
  timeoutMs: number,
): Promise<void> {
  const row = await db.select({
    metadata: entitiesTable.metadata,
    notes: entitiesTable.notes,
  }).from(entitiesTable).where(eq(entitiesTable.id, entity.id)).then((rows: any[]) => rows[0]);
  const metadata = safeJson<Record<string, unknown>>(row?.metadata ?? entity.metadata, {});
  const timeoutAt = new Date().toISOString();
  const nextAction = "Retry a target-scoped OSINT pass before treating this target as complete.";
  metadata.atlasTargetOutcome = "timeout_review";
  metadata.atlasLastError = `Target enrichment exceeded ${Math.round(timeoutMs / 1_000)}s in ${phase}.`;
  metadata.atlasTimeoutAt = timeoutAt;
  metadata.atlasNextAction = nextAction;
  await db.update(entitiesTable).set({
    metadata: JSON.stringify(metadata),
    notes: sql`CASE
      WHEN ${entitiesTable.notes} IS NULL OR ${entitiesTable.notes} = '' THEN ${`Atlas timeout review: ${phase} exceeded ${Math.round(timeoutMs / 1_000)}s. ${nextAction}`}
      WHEN ${entitiesTable.notes} NOT LIKE ${`%Atlas timeout review: ${phase}%`} THEN ${entitiesTable.notes} || E'\n' || ${`Atlas timeout review: ${phase} exceeded ${Math.round(timeoutMs / 1_000)}s. ${nextAction}`}
      ELSE ${entitiesTable.notes}
    END`,
    cookedAt: null,
    updatedAt: new Date(),
  }).where(eq(entitiesTable.id, entity.id));
}

function safeJson<T>(str: string | null | undefined, fallback: T): T {
  try { return str ? JSON.parse(str) as T : fallback; } catch { return fallback; }
}

type ReviewOnlyPersonCandidate = {
  name: string;
  role: string;
  ownershipStatus: string;
  basis: string | null;
  sourceUrls: string[];
  jurisdiction: string | null;
  evidence: Array<{
    source: string;
    sourceUrl: string | null;
    extractionMethod: string;
    confidence: number;
  }>;
  reviewOnly: true;
  admission: "not_an_hnwi";
};

function inferEntityJurisdiction(
  entity: { nationality?: string | null; knownResidences?: string | null; sourceRegistries?: string | null },
  metadata: Record<string, unknown>,
): string | null {
  const direct = [
    metadata.country,
    metadata.countryName,
    metadata.jurisdiction,
    entity.nationality,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 1);
  if (direct) return direct.trim();

  const context = [
    entity.knownResidences,
    entity.sourceRegistries,
    typeof metadata.bizLocation === "string" ? metadata.bizLocation : null,
    typeof metadata.entityLocation === "string" ? metadata.entityLocation : null,
  ].filter(Boolean).join(" ").toLowerCase();
  const jurisdictionHints: Array<[RegExp, string]> = [
    [/\bsweden|swedish|brreg\b/, "Sweden"],
    [/\bnorway|norwegian\b/, "Norway"],
    [/\bunited kingdom|england|scotland|wales|companies house\b/, "United Kingdom"],
    [/\bfrance|french\b/, "France"],
    [/\bgermany|german\b/, "Germany"],
    [/\bitaly|italian\b/, "Italy"],
    [/\bspain|spanish\b/, "Spain"],
    [/\bdenmark|danish\b/, "Denmark"],
    [/\bfinland|finnish\b/, "Finland"],
  ];
  return jurisdictionHints.find(([pattern]) => pattern.test(context))?.[1] ?? null;
}

/**
 * Turn named people found while researching an organization into a durable,
 * review-only handoff. This deliberately does not create an entity, classify
 * an HNWI, create a relationship, or promote a contact.
 */
function buildReviewOnlyPersonCandidates(
  result: {
    personsDiscovered?: string[];
    discoveryCandidates?: Array<Record<string, unknown>>;
    ownerResolutions?: Array<Record<string, unknown>>;
    evidence?: Array<Record<string, unknown>>;
  },
  jurisdiction: string | null,
): ReviewOnlyPersonCandidate[] {
  const byName = new Map<string, ReviewOnlyPersonCandidate>();
  const ownerResolutions = Array.isArray(result.ownerResolutions) ? result.ownerResolutions : [];
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];

  const evidenceFor = (name: string) => evidence
    .filter((item) => {
      const details = item.details && typeof item.details === "object"
        ? item.details as Record<string, unknown>
        : {};
      return details.personName === name;
    })
    .slice(0, 12)
    .map((item) => ({
      source: typeof item.source === "string" ? item.source : "web-osint",
      sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : null,
      extractionMethod: typeof item.extractionMethod === "string" ? item.extractionMethod : "person-discovery",
      confidence: typeof item.confidence === "number" ? item.confidence : 0,
    }));

  const add = (raw: Record<string, unknown>) => {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return;
    const key = name.toLocaleLowerCase();
    const existing = byName.get(key);
    const sourceUrls = Array.isArray(raw.sourceUrls)
      ? raw.sourceUrls.filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url)).slice(0, 8)
      : [];
    const candidate: ReviewOnlyPersonCandidate = {
      name,
      role: typeof raw.role === "string" && raw.role.trim() ? raw.role : "associated_person",
      ownershipStatus: typeof raw.ownershipStatus === "string" && raw.ownershipStatus.trim()
        ? raw.ownershipStatus
        : "not_established",
      basis: typeof raw.basis === "string" && raw.basis.trim() ? raw.basis.trim() : null,
      sourceUrls: [...new Set(sourceUrls)],
      jurisdiction,
      evidence: evidenceFor(name),
      reviewOnly: true,
      admission: "not_an_hnwi",
    };
    if (!existing) {
      byName.set(key, candidate);
      return;
    }
    existing.sourceUrls = [...new Set([...existing.sourceUrls, ...candidate.sourceUrls])].slice(0, 8);
    existing.evidence = [...existing.evidence, ...candidate.evidence]
      .filter((item, index, items) => items.findIndex((other) =>
        other.source === item.source && other.sourceUrl === item.sourceUrl,
      ) === index)
      .slice(0, 12);
    if (existing.role === "associated_person" && candidate.role !== "associated_person") existing.role = candidate.role;
    if (existing.ownershipStatus === "not_established" && candidate.ownershipStatus !== "not_established") {
      existing.ownershipStatus = candidate.ownershipStatus;
    }
    if (!existing.basis && candidate.basis) existing.basis = candidate.basis;
  };

  for (const owner of ownerResolutions) add(owner);
  for (const candidate of Array.isArray(result.discoveryCandidates) ? result.discoveryCandidates : []) {
    add({
      ...candidate,
      role: candidate.role ?? "associated_person",
      ownershipStatus: "not_established",
      basis: candidate.basis ?? "Broad provider discovery lead; target attribution remains unresolved.",
    });
  }
  for (const name of Array.isArray(result.personsDiscovered) ? result.personsDiscovered : []) {
    add({ name });
  }
  return [...byName.values()].slice(0, 24);
}

/** Fetch a page of entities suitable for per-entity enrichment. */
async function fetchEntities(opts: {
  batchSize: number;
  hotLeadsOnly: boolean;
  types?: string[];
  requireEmail?: boolean;
  requireAviationAsset?: boolean;
  targetId?: number;
}) {
  const types = opts.types ?? ["HNWI", "Gatekeeper", "Corporation", "Trust"];
  const conditions: any[] = [
    sql`${entitiesTable.type} IN (${sql.join(types.map(t => sql`${t}`), sql`, `)})`,
  ];
  if (opts.hotLeadsOnly) conditions.push(sql`${entitiesTable.bayesianScore} >= 0.5`);
  if (opts.requireEmail) conditions.push(sql`${entitiesTable.email} IS NOT NULL`);
  if (opts.targetId != null) conditions.push(eq(entitiesTable.id, opts.targetId));

  return db.select({
    id: entitiesTable.id,
    name: entitiesTable.name,
    type: entitiesTable.type,
    nationality: entitiesTable.nationality,
    sourceRegistries: entitiesTable.sourceRegistries,
    knownResidences: entitiesTable.knownResidences,
    metadata: entitiesTable.metadata,
    notes: entitiesTable.notes,
    email: entitiesTable.email,
    phone: entitiesTable.phone,
    linkedinUrl: entitiesTable.linkedinUrl,
    twitterHandle: entitiesTable.twitterHandle,
    instagramHandle: entitiesTable.instagramHandle,
    telegramHandle: entitiesTable.telegramHandle,
    phoneSource: entitiesTable.phoneSource,
    bayesianScore: entitiesTable.bayesianScore,
    contactConfidence: entitiesTable.contactConfidence,
  })
    .from(entitiesTable)
    .where(and(...conditions))
    .orderBy(desc(entitiesTable.bayesianScore), desc(entitiesTable.isHot))
    .limit(opts.batchSize);
}

/** Run a per-entity async fn strictly in sequence.
 *
 * The source-provider calls inside one entity may still use their intended
 * parallelism, but the next entity never starts until the previous entity's
 * complete enrichment and final validation have finished.
 */
async function runEntityBatch<T>(
  atlasJobId: string,
  phase: string,
  entities: Array<{ id: number; name: string }>,
  fn: (entity: any) => Promise<T>,
  _concurrency = 1,
  onResult?: (entity: any, result: T) => Promise<void>,
  targetTimeoutMs = DEFAULT_TARGET_TIMEOUT_MS,
): Promise<{ ok: number; err: number }> {
  let ok = 0; let errCount = 0;

  for (let i = 0; i < entities.length; i++) {
    await ensureAtlasActive(atlasJobId);
    const entity = entities[i]!;
    const slice = [entity];
    await updateJob(atlasJobId, {
      status: "running",
      progress: i,
      total: entities.length,
      message: `${phase}: ${slice.map(e => e.name).join(", ")}…`,
      entityProgress: i,
      entityTotal: entities.length,
      entityNames: JSON.stringify(slice.map(e => e.name)),
    });

    try {
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        fn(entity),
        new Promise<T>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            markTargetTimedOut(atlasJobId, entity.id);
            reject(new AtlasTargetTimeoutError(entity.id, phase, targetTimeoutMs));
          }, targetTimeoutMs);
        }),
      ]).finally(() => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      });
      if (onResult) await onResult(entity, result).catch(() => {});
      ok++;
    } catch (err) {
      if (err instanceof AtlasCancelledError) throw err;
      errCount++;
      if (err instanceof AtlasTargetTimeoutError) {
        await recordTargetTimeout(entity, phase, targetTimeoutMs).catch((recordErr: any) => {
          logger.warn({ entityId: entity.id, phase, err: recordErr?.message }, "[Atlas] timeout outcome recording failed");
        });
        logger.warn({
          entityId: entity.id,
          phase,
          timeoutMs: targetTimeoutMs,
        }, "[Atlas] target timed out; continuing with next sequential target");
      } else {
        logger.warn({ entityId: entity.id, phase, err: (err as Error).message }, "[Atlas] entity error");
      }
    }
    await updateJob(atlasJobId, {
      entityProgress: i + 1,
      entityTotal: entities.length,
      entityNames: JSON.stringify(slice.map(e => e.name)),
    });
  }

  return { ok, err: errCount };
}

class AtlasCancelledError extends Error {
  constructor() {
    super("Atlas run cancelled.");
    this.name = "AtlasCancelledError";
  }
}

async function ensureAtlasActive(atlasJobId: string, entityId?: number): Promise<void> {
  if (!(await ownsActiveJob("atlas-run", atlasJobId))) {
    throw new AtlasCancelledError();
  }
  if (entityId != null && targetWasTimedOut(atlasJobId, entityId)) {
    throw new AtlasTargetTimeoutError(entityId, "target enrichment", DEFAULT_TARGET_TIMEOUT_MS);
  }
}

// ── Per-entity full-circle enricher ───────────────────────────────────────────
// Runs all enrichment phases (4–8) on a single entity and stamps cookedAt.
// Called immediately after each entity is discovered — users see progress live.

type EntityRow = {
  id: number; name: string; type: string;
  email: string | null; phone: string | null;
  phoneSource: string | null;
  linkedinUrl: string | null; twitterHandle: string | null;
  instagramHandle: string | null; telegramHandle: string | null;
  bayesianScore: number | null; contactConfidence: number | null;
  knownResidences: string | null; metadata: string | null;
  notes: string | null; sourceRegistries: string | null;
};

type AtlasTelemetry = {
  stage: string;
  status: "active" | "complete" | "blocked" | "review";
  targetName?: string;
  targetType?: string;
  toolIds: string[];
  activeToolId?: string;
  prompt?: string;
  inputSummary?: string;
  resultSummary?: string;
  sources?: number;
  evidence?: number;
  contacts?: number;
  nextAction?: string;
  disposition?: "contact_route_found" | "needs_follow_up";
  personaNames?: string[];
};

async function setAtlasTelemetry(
  atlasJobId: string,
  telemetry: AtlasTelemetry,
  entityId?: number,
): Promise<void> {
  if (entityId != null && targetWasTimedOut(atlasJobId, entityId)) return;
  await updateJob(atlasJobId, { atlasTelemetry: JSON.stringify(telemetry) });
  await appendJobLog(atlasJobId, `ATLAS_EVENT ${JSON.stringify({
    kind: "telemetry",
    stage: telemetry.stage,
    status: telemetry.status,
    targetName: telemetry.targetName,
    targetType: telemetry.targetType,
    activeToolId: telemetry.activeToolId,
    toolIds: telemetry.toolIds,
    prompt: telemetry.prompt?.slice(0, 1200),
    inputSummary: telemetry.inputSummary?.slice(0, 600),
    resultSummary: telemetry.resultSummary?.slice(0, 700),
    sources: telemetry.sources,
    evidence: telemetry.evidence,
    contacts: telemetry.contacts,
    personaNames: (telemetry as AtlasTelemetry & { personaNames?: string[] }).personaNames,
  })}`);
}

/** Reduce a stored social-URL or @handle to a bare handle for consistent DB storage. */
function normalizeHandle(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url
    .replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com|instagram\.com|t\.me)\//, "")
    .replace(/\/$/, "")
    .replace(/^@/, "")
    .trim();
  return s && !s.startsWith("http") ? s : null;
}

const PLACEHOLDER_ENTITY_NAMES = new Set([
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "test",
  "test entity",
  "sample",
  "sample entity",
  "placeholder",
  "mock",
  "dummy",
]);

export function isPlaceholderEntityName(name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, " ").toLowerCase();
  return PLACEHOLDER_ENTITY_NAMES.has(normalized)
    || /^entity\s+\d+$/i.test(normalized);
}

async function enrichEntityFullCircle(atlasJobId: string, entity: EntityRow): Promise<void> {
  const { id, name } = entity;
  try {
    // Registry adapters can occasionally emit a missing-name placeholder.
    // Never spend OSINT/provider budget on it or let it generate synthetic
    // person candidates; stamp it cooked so the sequential loop advances.
    if (isPlaceholderEntityName(name)) {
      logger.warn({ entityId: id, name }, "[Atlas] Skipping placeholder entity");
      await db.update(entitiesTable).set({
        cookedAt: new Date(),
        updatedAt: new Date(),
        notes: sql`CASE WHEN notes IS NULL THEN 'Skipped placeholder entity name.' ELSE notes || E'\nSkipped placeholder entity name.' END`,
      }).where(eq(entitiesTable.id, id));
      return;
    }

    // Keep a strict pre-run boundary. New contacts/assets are not published
    // until the target-scoped final review approves exact current-run claims.
    const [baselineEvidence, baselineAssets] = await Promise.all([
      db.select({ id: contactEvidenceTable.id })
        .from(contactEvidenceTable)
        .where(eq(contactEvidenceTable.entityId, id)),
      db.select({ id: assetsTable.id })
        .from(assetsTable)
        .where(eq(assetsTable.ownerEntityId, id)),
    ]);
    const baselineEvidenceIds = new Set(baselineEvidence.map((row) => row.id));
    const baselineContacts = {
      email: entity.email,
      phone: entity.phone,
      linkedinUrl: entity.linkedinUrl,
      twitterHandle: entity.twitterHandle,
      instagramHandle: entity.instagramHandle,
    };
    let pendingAssetRows: Array<Record<string, unknown>> = [];

    // ── Step A: In-house OSINT (Wikidata, GitHub, RDAP, DNS, Gravatar, ProPublica) ──
    await setAtlasTelemetry(atlasJobId, {
      stage: "IN-HOUSE OSINT",
      status: "active",
      targetName: name,
      targetType: entity.type,
      toolIds: ["inhouse"],
      activeToolId: "inhouse",
      inputSummary: "Registry identity, known residence, notes, and public identifiers",
    }, id);
    const meta = safeJson<Record<string, unknown>>(entity.metadata, {});
    const ihResult = await enrichInHouse({
      ...entity,
      bizLocation: meta.bizLocation as string ?? null,
      entityName: meta.entityName as string ?? null,
    } as any).catch(() => null);

    if (ihResult) {
      const ihEmail = sanitizePublicEmail(ihResult.email);
      const ihPhone = sanitizePublicPhone(ihResult.phone);
      const ihLinkedIn = sanitizePublicSocialUrl(ihResult.linkedinUrl, "linkedin", "person");
      const ihTwitter = isValidPublicSocialHandle(ihResult.twitter, "twitter")
        ? ihResult.twitter!.replace(/^@/, "")
        : null;
      if (ihEmail && !entity.email) {
        entity = { ...entity, email: ihEmail };
      }
      if (ihLinkedIn && !entity.linkedinUrl) {
        entity = { ...entity, linkedinUrl: ihLinkedIn };
      }
      if (ihPhone && !entity.phone) {
        entity = { ...entity, phone: ihPhone };
      }
      if (ihTwitter && !entity.twitterHandle) {
        entity = { ...entity, twitterHandle: ihTwitter };
      }
      if (ihResult.evidence?.length) {
        const cleanEvidence = ihResult.evidence.filter((ev: any) => {
          if (ev.vectorType === "email") return Boolean(sanitizePublicEmail(ev.value));
          if (ev.vectorType === "phone") return Boolean(sanitizePublicPhone(ev.value));
          if (ev.vectorType === "social") {
            const network = ev.details?.network;
            return network === "linkedin"
              ? Boolean(sanitizePublicSocialUrl(ev.value, "linkedin", "person"))
              : network === "twitter"
                ? isValidPublicSocialHandle(ev.value, "twitter")
                : network === "instagram"
                  ? isValidPublicSocialHandle(ev.value, "instagram")
                  : false;
          }
          return true;
        });
        if (cleanEvidence.length) {
          await db.insert(contactEvidenceTable).values(cleanEvidence.map((ev: any) => ({
            entityId: id, vectorType: ev.vectorType, value: ev.value, source: ev.source,
            sourceUrl: ev.sourceUrl ?? null, extractionMethod: ev.extractionMethod,
            sourceReliability: Math.min(1, ev.confidence / 100), identityMatch: 0.75, recencyScore: 0.70,
            directnessScore: ev.vectorType === "email" ? 0.80 : ev.vectorType === "phone" ? 0.75 : 0.20,
            independentCorroboration: 1, validationStatus: "candidate" as const,
            metadata: JSON.stringify(ev.details ?? {}), observedAt: new Date(ev.observedAt),
          }))).onConflictDoNothing().catch(() => {});
        }
      }
    }

    // ── Step B: Social + Messenger discovery ───────────────────────────────────
    await setAtlasTelemetry(atlasJobId, {
      stage: "SOCIAL + MESSENGER",
      status: "active",
      targetName: name,
      targetType: entity.type,
      toolIds: ["webdisc", "inhouse"],
      activeToolId: "webdisc",
      inputSummary: "Validated target identity and public profile candidates",
    }, id);
    const [socialResult, messengerResult] = await Promise.all([
      discoverSocialPresence(entity as any).catch(() => null),
      discoverMessengerPresence(entity as any).catch(() => null),
    ]);
    const socialLinkedIn = sanitizePublicSocialUrl(socialResult?.linkedinUrl, "linkedin", "person");
    const socialTwitter = isValidPublicSocialHandle(socialResult?.twitterHandle, "twitter")
      ? socialResult!.twitterHandle!.replace(/^@/, "")
      : null;
    const socialInstagram = isValidPublicSocialHandle(socialResult?.instagramHandle, "instagram")
      ? socialResult!.instagramHandle!.replace(/^@/, "")
      : null;
    if (socialLinkedIn && !entity.linkedinUrl) {
      entity = { ...entity, linkedinUrl: socialLinkedIn };
    }
    if (socialTwitter && !entity.twitterHandle) {
      entity = { ...entity, twitterHandle: socialTwitter };
    }
    if (socialInstagram && !entity.instagramHandle) {
      entity = { ...entity, instagramHandle: socialInstagram };
    }
    // Telegram is intentionally kept in the in-memory target context only.
    // The final review contract currently covers email, phone, and social
    // routes; no newly discovered contact field is persisted before it runs.
    if (messengerResult?.telegramHandle && !entity.telegramHandle) {
      entity = { ...entity, telegramHandle: messengerResult.telegramHandle };
    }

    await ensureAtlasActive(atlasJobId, id);
    // ── Step C: AI OSINT sweep (Perplexity + Tavily + Exa + Groq) ────
    await updateJob(atlasJobId, { status: "running", message: `🤖 ${name}: AI OSINT…` });
    const telemetryReachability = assessTargetReachability({
      type: entity.type,
      email: entity.email,
      phone: entity.phone,
      phoneSource: entity.phoneSource,
      contactOutcome: (entity as any).contactOutcome,
      contactConfidence: entity.contactConfidence,
      knownResidences: entity.knownResidences,
      metadata: entity.metadata,
      notes: entity.notes,
      sourceRegistries: entity.sourceRegistries,
    });
    const prompt = buildPerplexityPrompt(
      name,
      entity.type,
      null,
      { reachability: reachabilityDirective(telemetryReachability) },
    );
    await setAtlasTelemetry(atlasJobId, {
      stage: "AI WEB OSINT",
      status: "active",
      targetName: name,
      targetType: entity.type,
      toolIds: ["perp0", "tavily", "exa", "hf-open-deep-research", "groq"],
      activeToolId: "perp0",
      prompt: prompt.slice(0, 2200),
      inputSummary: `${entity.type} target · ${telemetryReachability.status} reachability · provider fan-out is parallel within this target`,
    }, id);
    const aiResult = await deepWebOsintEnrich({
      ...(entity as any),
      onTelemetry: async (event: any) => {
        await setAtlasTelemetry(atlasJobId, {
          stage: event.stage,
          status: event.status,
          targetName: name,
          targetType: entity.type,
          toolIds: event.toolIds,
          activeToolId: event.activeToolId,
          inputSummary: event.inputSummary,
          resultSummary: event.resultSummary,
          sources: event.sources,
          evidence: event.evidence,
          contacts: event.contacts,
        }, id);
      },
    }).catch(() => null);
    const aiReviewCandidates = aiResult
      ? buildReviewOnlyPersonCandidates(
        aiResult as any,
        inferEntityJurisdiction(entity as any, safeJson<Record<string, unknown>>(entity.metadata, {})),
      )
      : [];
    if (aiResult && (aiReviewCandidates.length > 0 || aiResult.ownershipSummary || aiResult.ownershipSources.length > 0)) {
      // Persist named principals independently of contact discovery. A company
      // can have useful director/operator evidence even when no personal email,
      // phone, or social vector is found.
      const metadata = safeJson<Record<string, unknown>>(entity.metadata, {});
      if (aiResult.personsDiscovered.length > 0) {
        metadata.deepWebPersonsDiscovered = [...new Set(aiResult.personsDiscovered)].slice(0, 24);
      }
      if (aiResult.ownerResolutions.length > 0) {
        metadata.deepWebOwnerResolutions = aiResult.ownerResolutions.slice(0, 24);
      }
      if (aiResult.discoveryCandidates.length > 0) {
        metadata.deepWebDiscoveryCandidates = aiResult.discoveryCandidates.slice(0, 24);
        metadata.deepWebDiscoveryCandidatesReviewOnly = true;
      }
      if (aiResult.ownershipSummary) {
        metadata.deepWebOwnershipSummary = aiResult.ownershipSummary;
      }
      if (aiResult.ownershipSources.length > 0) {
        metadata.deepWebOwnershipSources = [...new Set(aiResult.ownershipSources)].slice(0, 8);
      }
      if (aiReviewCandidates.length > 0) {
        metadata.atlasPersonCandidates = aiReviewCandidates;
        metadata.atlasPersonCandidateCount = aiReviewCandidates.length;
        metadata.atlasPersonCandidatesReviewOnly = true;
      }
      await db.update(entitiesTable)
        .set({ metadata: JSON.stringify(metadata), updatedAt: new Date() })
        .where(eq(entitiesTable.id, id));
    }
    if (aiResult && aiResult.openDeepResearchStatus && (
      aiResult.openDeepResearchReport || aiResult.openDeepResearchCitations.length > 0
    )) {
      const metadata = safeJson<Record<string, unknown>>(entity.metadata, {});
      // Preserve the person handoff written above; this metadata write is
      // intentionally additive because it happens after the AI result returns.
      const existingMetadata = await db.select({ metadata: entitiesTable.metadata })
        .from(entitiesTable)
        .where(eq(entitiesTable.id, id))
        .then((rows: any[]) => rows[0]?.metadata ?? entity.metadata);
      Object.assign(metadata, safeJson<Record<string, unknown>>(existingMetadata, {}));
      metadata.huggingFaceOpenDeepResearch = {
        status: aiResult.openDeepResearchStatus,
        model: aiResult.openDeepResearchModel,
        report: aiResult.openDeepResearchReport,
        citations: aiResult.openDeepResearchCitations,
        reviewOnly: true,
        claimsPromoted: false,
      };
      await db.update(entitiesTable)
        .set({ metadata: JSON.stringify(metadata), updatedAt: new Date() })
        .where(eq(entitiesTable.id, id));
    }
    await setAtlasTelemetry(atlasJobId, {
      stage: "AI WEB OSINT",
      status: aiResult ? "complete" : "review",
      targetName: name,
      targetType: entity.type,
      toolIds: ["perp0", "tavily", "exa", "hf-open-deep-research", "groq"],
      activeToolId: "groq",
      prompt: prompt.slice(0, 2200),
      inputSummary: `${entity.type} target · ${telemetryReachability.status} reachability`,
      resultSummary: aiResult
        ? `${aiResult.sources.length} provider/source lanes · ${aiResult.queriesFired} web queries · ${aiResult.pagesScraped} pages · ${aiResult.evidence?.length ?? 0} evidence candidates · ${aiReviewCandidates.length} named person candidates (review-only)`
        : "No usable AI/web result returned; retained review-only state",
      sources: aiResult?.sources.length ?? 0,
      evidence: aiResult?.evidence?.length ?? 0,
      contacts: [aiResult?.email, aiResult?.phone, aiResult?.linkedinUrl, aiResult?.instagramUrl, aiResult?.twitterUrl].filter(Boolean).length,
    }, id);
    const aiHasSignal = aiResult && (
      aiResult.email || aiResult.phone || aiResult.linkedinUrl ||
      aiResult.instagramUrl || aiResult.twitterUrl || (aiResult.evidence?.length ?? 0) > 0
    );

    if (aiHasSignal && aiResult) {
      const isCorpOrTrust = ["Corporation", "Corp", "Trust"].includes(entity.type);
      const cleanEmail = sanitizePublicEmail(aiResult.email);
      const cleanPhone = sanitizePublicPhone(aiResult.phone);
      const cleanLinkedIn = sanitizePublicSocialUrl(aiResult.linkedinUrl, "linkedin", "person");
      const cleanInstagram = sanitizePublicSocialUrl(aiResult.instagramUrl, "instagram", "person");
      const cleanTwitter = sanitizePublicSocialUrl(aiResult.twitterUrl, "twitter", "person");
      if (cleanEmail)        entity = { ...entity, email:          cleanEmail };
      if (cleanPhone)        entity = { ...entity, phone:          cleanPhone };
      if (cleanLinkedIn)     entity = { ...entity, linkedinUrl:    cleanLinkedIn };
      if (cleanTwitter  && !entity.twitterHandle)   entity = { ...entity, twitterHandle:   normalizeHandle(cleanTwitter) };
      if (cleanInstagram && !entity.instagramHandle) entity = { ...entity, instagramHandle: normalizeHandle(cleanInstagram) };
      if (aiResult.evidence?.length) {
        const cleanEvidence = aiResult.evidence.filter((ev: any) => {
          if (ev.vectorType === "email") return Boolean(sanitizePublicEmail(ev.value));
          if (ev.vectorType === "phone") return Boolean(sanitizePublicPhone(ev.value));
          if (ev.vectorType === "social") {
            const network = ev.details?.network;
            return network === "linkedin"
              ? Boolean(sanitizePublicSocialUrl(ev.value, "linkedin", "person"))
              : network === "twitter"
                ? isValidPublicSocialHandle(ev.value, "twitter")
                : network === "instagram"
                  ? isValidPublicSocialHandle(ev.value, "instagram")
                  : false;
          }
          return true;
        });
        if (cleanEvidence.length) {
          await db.insert(contactEvidenceTable).values(cleanEvidence.map((ev: any) => ({
            entityId: id, vectorType: ev.vectorType, value: ev.value, source: ev.source,
            sourceUrl: ev.sourceUrl ?? null, extractionMethod: ev.extractionMethod ?? "deep-web-osint",
            sourceReliability: Math.min(1, ev.confidence / 100), identityMatch: 0.65, recencyScore: 0.7,
            directnessScore: ev.vectorType === "email" ? 0.9 : ev.vectorType === "phone" ? 0.85 : 0.6,
            independentCorroboration: 1, validationStatus: "candidate" as const,
            observedAt: new Date(), metadata: JSON.stringify(ev.details ?? {}),
          }))).onConflictDoNothing().catch(() => {});
        }
      }
    }

    await ensureAtlasActive(atlasJobId, id);
    // ── Step D: Maigret (3 000+ platforms) + Holehe (120+ services) ───────────
    const rawHandle = (
      (aiResult?.twitterUrl ?? "").replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com)\//, "").replace(/\?.*$/, "")
      || (entity.twitterHandle ?? "").replace(/^@/, "")
      || (aiResult?.instagramUrl ?? "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\?.*$/, "")
      || (entity.instagramHandle ?? "").replace(/^@/, "")
    ).replace(/[^a-zA-Z0-9._\-]/g, "").trim();
    const emailForHolehe = (() => {
      const email = entity.email?.trim().toLowerCase() ?? "";
      const localPart = email.split("@")[0] ?? "";
      return email && !isGenericEmailPrefix(localPart) ? email : null;
    })();

    if (rawHandle || emailForHolehe) {
      await updateJob(atlasJobId, { status: "running", message: `🕵️ ${name}: Maigret + Holehe…` });
      await setAtlasTelemetry(atlasJobId, {
        stage: "IDENTITY DISCOVERY",
        status: "active",
        targetName: name,
        targetType: entity.type,
        toolIds: ["maigret", "sherlock", "holehe"],
        activeToolId: rawHandle ? "maigret" : "holehe",
        inputSummary: `${rawHandle ? `Username candidate "${rawHandle}"` : "No username candidate"} · ${emailForHolehe ? "validated non-generic email candidate" : "no email candidate"}`,
      }, id);
      const [maigretResult, holeheResult] = await Promise.all([
        rawHandle      ? runMaigret(rawHandle).catch(() => null)      : Promise.resolve(null),
        emailForHolehe ? runHolehe(emailForHolehe).catch(() => null)  : Promise.resolve(null),
      ]);
      const sherlockResult = rawHandle
        ? await runSherlock(rawHandle).catch(() => null)
        : null;
      await setAtlasTelemetry(atlasJobId, {
        stage: "IDENTITY DISCOVERY",
        status: "complete",
        targetName: name,
        targetType: entity.type,
        toolIds: ["maigret", "sherlock", "holehe"],
        activeToolId: sherlockResult ? "sherlock" : emailForHolehe ? "holehe" : "maigret",
        inputSummary: `Review-only username and email-service checks for ${name}`,
        resultSummary: [
          `Maigret ${maigretResult?.found.length ?? 0} profile(s)`,
          `Sherlock ${sherlockResult?.found.length ?? 0} profile(s)`,
          `Holehe ${holeheResult?.found.length ?? 0} service hit(s)`,
          "no result independently proves identity or personal access",
        ].join(" · "),
        sources: (maigretResult?.found.length ?? 0) + (sherlockResult?.found.length ?? 0),
        evidence: (maigretResult?.found.length ?? 0) + (sherlockResult?.found.length ?? 0) + (holeheResult?.found.length ?? 0),
        contacts: 0,
      }, id);
      if (maigretResult?.found.length) {
        await db.insert(contactEvidenceTable).values(
          maigretResult.found.slice(0, 15).map((p: any) => ({
            entityId: id, vectorType: "social" as const, value: p.url ?? p.siteName,
            source: "maigret", sourceUrl: p.url ?? null, extractionMethod: "maigret-username-search",
            sourceReliability: 0.7, identityMatch: 0.65, recencyScore: 0.5, directnessScore: 0.6,
            independentCorroboration: 1, validationStatus: "candidate" as const,
            metadata: JSON.stringify({ siteName: p.siteName, tags: p.tags ?? [] }),
          })),
        ).onConflictDoNothing().catch(() => {});
        // Flexible re-entry: Maigret found 3+ platforms but no email → re-run AI with platform hints
        if (maigretResult.found.length >= 3 && !entity.email) {
          const platformList = maigretResult.found.slice(0, 6).map((p: any) => p.siteName).join(", ");
          const result2 = await deepWebOsintEnrich({ ...entity, notes: `${entity.notes ?? ""} — Active on: ${platformList}` } as any).catch(() => null);
          if (result2?.email) entity = { ...entity, email: sanitizePublicEmail(result2.email) ?? entity.email };
        }
      }
      if (holeheResult?.found.length) {
        await db.insert(contactEvidenceTable).values(
          holeheResult.found.slice(0, 10).map((p: any) => ({
            entityId: id, vectorType: "social" as const, value: p.url ?? p.name,
            source: "holehe", sourceUrl: p.url ?? null, extractionMethod: "holehe-email-check",
            sourceReliability: 0.8, identityMatch: 0.8, recencyScore: 0.5, directnessScore: 0.7,
            independentCorroboration: 1, validationStatus: "candidate" as const,
            metadata: JSON.stringify({ platform: p.name }),
          })),
        ).onConflictDoNothing().catch(() => {});
      }
      if (sherlockResult?.found.length) {
        await db.insert(contactEvidenceTable).values(
          sherlockResult.found.slice(0, 15).map((p: any) => ({
            entityId: id,
            vectorType: "social" as const,
            value: p.url ?? p.siteName,
            source: "sherlock",
            sourceUrl: p.url ?? null,
            extractionMethod: "sherlock-username-search",
            sourceReliability: 0.6,
            identityMatch: 0.45,
            recencyScore: 0.4,
            directnessScore: 0.35,
            independentCorroboration: 1,
            validationStatus: "candidate" as const,
            metadata: JSON.stringify({ siteName: p.siteName, reviewOnly: true }),
          })),
        ).onConflictDoNothing().catch(() => {});
      }
    }

    await ensureAtlasActive(atlasJobId, id);
    // ── Step E: Forensic cross-reference (ICIJ Offshore Leaks + Whoxy WHOIS) ──
    await Promise.allSettled([
      enrichWithIcij(name, [], false).then(async (res: any) => {
        if (res.totalMatches > 0) {
          const note = `ICIJ Offshore Leaks: ${res.totalMatches} match(es) — ${res.datasets?.join(", ") ?? "unknown dataset"}`;
          await db.update(entitiesTable)
            .set({ notes: sql`CASE WHEN notes IS NULL THEN ${note} ELSE notes || E'\n' || ${note} END`, updatedAt: new Date() })
            .where(eq(entitiesTable.id, id));
        }
      }).catch(() => {}),
      (entity.email || entity.type === "HNWI") ? enrichWithWhoxy({
        email: entity.email ?? undefined,
        name:  entity.type === "HNWI" ? name : undefined,
      }).then(async (res) => {
        const domains: string[] = (res as any).allUniqueDomains ?? [];
        if (domains.length) {
          const note = `Whoxy WHOIS: ${domains.length} domain(s) — ${domains.slice(0, 5).join(", ")}`;
          await db.update(entitiesTable)
            .set({ notes: sql`CASE WHEN notes IS NULL THEN ${note} ELSE notes || E'\n' || ${note} END`, updatedAt: new Date() })
            .where(eq(entitiesTable.id, id));
          // Write each discovered domain as a DigitalAsset row
          const domainAssets = domains.slice(0, 10).map((domain: string) => ({
            category: "DigitalAsset",
            identifier: domain,
            jurisdiction: "WHOIS",
            description: `Registered domain linked to ${name} via Whoxy reverse-WHOIS`,
            sourceRegistry: "Whoxy WHOIS",
            ownerEntityId: id,
          }));
          pendingAssetRows.push(...domainAssets);
        }
      }).catch(() => {}) : Promise.resolve(),
    ]);

    // ── Step G: Groq asset extraction — pull structured assets from AI context ──
    // Uses the notes/context accumulated above to extract real estate, aviation,
    // marine, hospitality businesses (hotels/restaurants/resorts/clubs), and
    // other business assets as structured rows in the assets table.
    try {
      const groqKeys: string[] = [];
      const _gNames = ["GROQ_API_KEY"];
      for (let i = 1; i <= 10; i++) _gNames.push(`GROQ_API_KEY_${i}`);
      _gNames.forEach(k => { const v = process.env[k]; if (v) groqKeys.push(v); });

      if (groqKeys.length) {
        // Fetch current entity notes + metadata for rich context
        const ctxRow = await db.select({
          notes: entitiesTable.notes,
          knownResidences: entitiesTable.knownResidences,
          nationality: entitiesTable.nationality,
          sourceRegistries: entitiesTable.sourceRegistries,
          metadata: entitiesTable.metadata,
        }).from(entitiesTable).where(eq(entitiesTable.id, id)).then((r: any[]) => r[0]);

        const srcRegs: string[] = safeJson<string[]>(ctxRow?.sourceRegistries, []);
        const meta: Record<string, unknown> = safeJson<Record<string, unknown>>(ctxRow?.metadata, {});

        const context = [
          ctxRow?.notes,
          ctxRow?.knownResidences ? `Known residences / locations: ${ctxRow.knownResidences}` : null,
          ctxRow?.nationality ? `Nationality: ${ctxRow.nationality}` : null,
          srcRegs.length ? `Source registries: ${srcRegs.join(", ")}` : null,
          meta.companyName ? `Associated company: ${meta.companyName}` : null,
          meta.bizLocation ? `Business location: ${meta.bizLocation}` : null,
          entity.type ? `Entity type: ${entity.type}` : null,
        ].filter(Boolean).join("\n");

        if (context.length > 60) {
          const groqKey = groqKeys[Math.floor(Math.random() * groqKeys.length)];
          const prompt = `You are an expert OSINT analyst extracting structured ASSET DATA about a high-net-worth individual.

Person: "${name}"

Context (discovery notes, OSINT findings, WHOIS data, registry information):
${context}

Extract ALL REAL ASSETS this person OWNS, OPERATES, or CONTROLS — including businesses they run day-to-day:

ASSET CATEGORIES:
- "Hospitality": hotels, resorts, restaurants, spas, golf clubs, beach clubs, ski resorts, private dining clubs, luxury lodges, marinas that they own or operate as a business
- "RealEstate": residential or commercial properties, villas, châteaux, estates, vineyards, land
- "Aviation": private jets, helicopters, aircraft (use FAA tail number if mentioned)
- "Marine": yachts, superyachts, boats, vessels (use IMO number or vessel name)
- "Business": other companies they founded/own/control (tech, retail, manufacturing, trading, media, finance)
- "PrivateClub": exclusive private membership clubs or societies they own or chair
- "Investment": private equity funds, hedge funds, stock positions, financial stakes

Respond ONLY with a JSON array. Each item must have:
- "category": one of the categories above (use "Hospitality" for hotels/restaurants/clubs/resorts)
- "identifier": SPECIFIC name/identifier — hotel name + city, property address, N-number, company name, vessel name (NOT vague like "a hotel in Italy")
- "jurisdiction": country, state, or registry (e.g. "Italy", "France", "UK", "FAA", "IMO")
- "description": one sentence: what the asset is and the person's role (owner, founder, operator, etc.)

IMPORTANT: A hotel, restaurant, resort, or golf club that a person OWNS is one of their most important assets — always include it.
Only include assets with a SPECIFIC identifier. If nothing concrete is mentioned, respond with [].`;

          const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
            body: JSON.stringify({
              model: "llama-3.3-70b-versatile",
              messages: [{ role: "user", content: prompt }],
              temperature: 0, max_tokens: 1024,
            }),
            signal: AbortSignal.timeout(15_000),
          }).then(r => r.json()).catch(() => null);

          const raw = resp?.choices?.[0]?.message?.content?.trim() ?? "";
          const jsonMatch = raw.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const extracted: Array<{ category: string; identifier: string; jurisdiction: string; description?: string }> =
              JSON.parse(jsonMatch[0]);
            const validCategories = new Set(["RealEstate", "Aviation", "Marine", "Hospitality", "Business", "PrivateClub", "Investment"]);
            const assetRows = extracted
              .filter(a => a.identifier?.length > 2 && validCategories.has(a.category))
              .slice(0, 12)
              .map(a => {
                const juris = a.jurisdiction ?? "Unknown";
                const coords = jurisdictionToCoords(juris);
                return {
                  category: a.category,
                  identifier: a.identifier,
                  jurisdiction: juris,
                  description: a.description ?? null,
                  sourceRegistry: "AI OSINT (Groq extraction)",
                  ownerEntityId: id,
                  latitude:  coords ? coords[0] : null,
                  longitude: coords ? coords[1] : null,
                };
              });
            if (assetRows.length) {
              pendingAssetRows.push(...assetRows);
              logger.info({ entityId: id, name, assetCount: assetRows.length }, "[Atlas] Assets held for final target review");
            }
          }
        }
      }
    } catch (assetErr) {
      logger.warn({ entityId: id, name, err: String(assetErr) }, "[Atlas] Step G asset extraction failed");
    }

    // ── Step H: Final target-scoped web/LLM sanity review ───────────────────
    // The model receives only this target's exact evidence universe. Its
    // response is passed through a deterministic adjudicator that cannot
    // invent a contact or asset identifier.
    await ensureAtlasActive(atlasJobId, id);
    const reviewEntity = await db.select({
      metadata: entitiesTable.metadata,
      notes: entitiesTable.notes,
      sourceRegistries: entitiesTable.sourceRegistries,
      knownResidences: entitiesTable.knownResidences,
      estimatedNetWorth: entitiesTable.estimatedNetWorth,
    }).from(entitiesTable).where(eq(entitiesTable.id, id)).then((rows: any[]) => rows[0]);
    const reviewEvidence = await db.select().from(contactEvidenceTable)
      .where(eq(contactEvidenceTable.entityId, id));
    const candidateFunnel = reconcileStoredContactEvidence(reviewEvidence as any);
    const reachability = assessTargetReachability({
      type: entity.type,
      estimatedNetWorth: reviewEntity?.estimatedNetWorth,
      email: entity.email,
      phone: entity.phone,
      phoneSource: entity.phoneSource,
      contactOutcome: computeContactOutcome(entity),
      contactConfidence: entity.contactConfidence,
      knownResidences: reviewEntity?.knownResidences ?? entity.knownResidences,
      metadata: reviewEntity?.metadata ?? entity.metadata,
      sourceRegistries: reviewEntity?.sourceRegistries ?? entity.sourceRegistries,
    });
    const finalReview = await runFinalTargetReview({
      targetName: name,
      targetType: entity.type,
      proposedContacts: {
        email: entity.email,
        phone: entity.phone,
        linkedin: entity.linkedinUrl,
        instagram: entity.instagramHandle,
        twitter: entity.twitterHandle,
      },
      candidates: candidateFunnel.candidates,
      evidence: reviewEvidence.map((row) => ({
        vectorType: row.vectorType,
        value: row.value,
        source: row.source,
        sourceUrl: row.sourceUrl,
        validationStatus: row.validationStatus,
      })),
      proposedAssets: pendingAssetRows.map((row) => ({
        category: String(row.category ?? ""),
        identifier: String(row.identifier ?? ""),
        jurisdiction: String(row.jurisdiction ?? ""),
        description: row.description == null ? null : String(row.description),
        sourceRegistry: row.sourceRegistry == null ? null : String(row.sourceRegistry),
        latitude: typeof row.latitude === "number" ? row.latitude : null,
        longitude: typeof row.longitude === "number" ? row.longitude : null,
      })),
      reachabilityStatus: reachability.status,
    });
    const researchDisposition = deriveTargetResearchDisposition(finalReview);
    const reviewableCandidateCount = candidateFunnel.candidates.filter(
      (candidate) => candidate.state !== "rejected" && ["email", "phone", "social"].includes(candidate.vectorType),
    ).length;
    logger.info({
      entityId: id,
      decision: finalReview.decision,
      approvedContacts: finalReview.approvedContactValues.length,
      approvedAssets: finalReview.approvedAssetIdentifiers.length,
      reviewer: finalReview.reviewerSource,
      disposition: researchDisposition.disposition,
      reviewableCandidateCount,
    }, "[Atlas] Final target review complete");

    const approvedValues = new Set(finalReview.approvedContactValues);
    const approvedCandidateValues = new Set(
      candidateFunnel.candidates
        .filter((candidate) => approvedValues.has(candidate.value))
        .map((candidate) => candidate.value),
    );
    const isApproved = (value: string | null | undefined) =>
      Boolean(value && approvedCandidateValues.has(value));
    const approvedLinkedIn = candidateFunnel.candidates.find(
      (candidate) => candidate.vectorType === "social"
        && approvedValues.has(candidate.value)
        && /linkedin\.com\/in\//i.test(candidate.value),
    )?.value ?? null;
    const approvedInstagram = candidateFunnel.candidates.find(
      (candidate) => candidate.vectorType === "social"
        && approvedValues.has(candidate.value)
        && /instagram\.com\//i.test(candidate.value),
    )?.value ?? null;
    const approvedTwitter = candidateFunnel.candidates.find(
      (candidate) => candidate.vectorType === "social"
        && approvedValues.has(candidate.value)
        && /(twitter|x)\.com\//i.test(candidate.value),
    )?.value ?? null;
    const approvedEmail = candidateFunnel.candidates.find(
      (candidate) => candidate.vectorType === "email" && approvedValues.has(candidate.value),
    )?.value ?? null;
    const approvedPhone = candidateFunnel.candidates.find(
      (candidate) => candidate.vectorType === "phone" && approvedValues.has(candidate.value),
    )?.value ?? null;
    const publish = finalReview.decision === "publish";
    const finalContacts = {
      email: baselineContacts.email ?? (publish && isApproved(approvedEmail) ? approvedEmail : null),
      phone: baselineContacts.phone ?? (publish && isApproved(approvedPhone) ? approvedPhone : null),
      linkedinUrl: baselineContacts.linkedinUrl ?? (publish ? approvedLinkedIn : null),
      instagramHandle: baselineContacts.instagramHandle ?? (publish ? normalizeHandle(approvedInstagram) : null),
      twitterHandle: baselineContacts.twitterHandle ?? (publish ? normalizeHandle(approvedTwitter) : null),
    };
    const {
      atlasTargetOutcome: _previousTargetOutcome,
      atlasLastError: _previousLastError,
      atlasTimeoutAt: _previousTimeoutAt,
      ...priorMetadata
    } = safeJson<Record<string, unknown>>(reviewEntity?.metadata ?? entity.metadata, {});
    const cleanNotes = String(reviewEntity?.notes ?? "")
      .split("\n")
      .filter((line) => !line.startsWith("Atlas timeout review:"))
      .join("\n")
      .trim() || null;
    const reviewMetadata = {
      ...priorMetadata,
      atlasTargetOutcome: "completed_review",
      finalTargetReview: finalReview,
      finalTargetReviewAt: new Date().toISOString(),
      atlasResearchDisposition: researchDisposition.disposition,
      atlasNextAction: researchDisposition.nextAction,
      atlasReviewableCandidateCount: reviewableCandidateCount,
    };
    await db.update(entitiesTable).set({
      email: finalContacts.email,
      phone: finalContacts.phone,
      linkedinUrl: finalContacts.linkedinUrl,
      instagramHandle: finalContacts.instagramHandle,
      twitterHandle: finalContacts.twitterHandle,
      notes: cleanNotes,
      metadata: JSON.stringify(reviewMetadata),
      updatedAt: new Date(),
    }).where(eq(entitiesTable.id, id));
    entity = { ...entity, ...finalContacts };

    // Only exact values selected by the final reviewer become verified. A
    // reviewer rejection is durable; an unavailable/uncertain review remains
    // candidate evidence for later manual adjudication.
    for (const row of reviewEvidence) {
      if (baselineEvidenceIds.has(row.id)) continue;
      const candidate = candidateFunnel.candidates.find(
        (item) => item.vectorType === row.vectorType
          && item.value.trim().toLowerCase() === row.value.trim().toLowerCase(),
      );
      if (!candidate) continue;
      if (publish && approvedValues.has(candidate.value)) {
        await db.update(contactEvidenceTable)
          .set({ validationStatus: "verified", rejectionReason: null })
          .where(eq(contactEvidenceTable.id, row.id));
      } else if (finalReview.decision === "reject") {
        await db.update(contactEvidenceTable)
          .set({
            validationStatus: "rejected",
            rejectionReason: finalReview.reasons.join(" ").slice(0, 500),
          })
          .where(eq(contactEvidenceTable.id, row.id));
      }
    }

    const approvedAssets = new Set(finalReview.approvedAssetIdentifiers);
    if (publish) {
      const rowsToInsert = pendingAssetRows.filter((row) =>
        approvedAssets.has(String(row.identifier ?? "")),
      );
      if (rowsToInsert.length) {
        await db.insert(assetsTable).values(rowsToInsert as any).onConflictDoNothing();
      }
    }
    pendingAssetRows = [];

    // ── Step F: Final confidence recompute + bayesian score + isHot + cookedAt ─
    const fresh = await db.select({
      type: entitiesTable.type,
      email: entitiesTable.email, phone: entitiesTable.phone,
      linkedinUrl: entitiesTable.linkedinUrl, twitterHandle: entitiesTable.twitterHandle,
      instagramHandle: entitiesTable.instagramHandle, telegramHandle: entitiesTable.telegramHandle,
      phoneSource: entitiesTable.phoneSource,
      knownResidences: entitiesTable.knownResidences, sourceRegistries: entitiesTable.sourceRegistries,
      nationality: entitiesTable.nationality, estimatedNetWorth: entitiesTable.estimatedNetWorth,
    }).from(entitiesTable).where(eq(entitiesTable.id, id)).then((r: any[]) => r[0]);

    if (fresh) {
      const contactConf = computeContactConfidence(fresh);

      // Fetch assets written in Steps E + G for bayesian scoring
      const entityAssets = await db.select({
        category: assetsTable.category,
        estimatedValue: assetsTable.estimatedValue,
        jurisdiction: assetsTable.jurisdiction,
      }).from(assetsTable).where(eq(assetsTable.ownerEntityId, id)).catch(() => []);

      const assetCategories = [...new Set(entityAssets.map((a: any) => a.category).filter(Boolean))] as string[];
      const totalAssetValue = entityAssets.reduce((s: number, a: any) => s + (Number(a.estimatedValue) || 0), 0);
      const jurisdictionCount = new Set(entityAssets.map((a: any) => a.jurisdiction).filter(Boolean)).size;

      const { computeBayesianScore } = await import("./bayesian-scorer");
      const bayesScore = computeBayesianScore(0.05, {
        entityType:               entity.type,
        assetCount:               entityAssets.length,
        assetCategories,
        totalAssetValue,
        hasRecentActivity:        true,
        recentActivityDays:       0,
        networkDegree:            0,
        hasGatekeeperConnection:  false,
        hasKnownInvestorConnection: false,
        hasShellCompany:          false,
        hasAviationAsset:         assetCategories.includes("Aviation"),
        hasMarineAsset:           assetCategories.includes("Marine"),
        hasClubMembership:        assetCategories.some(c => ["PrivateClub","Hospitality"].includes(c)),
        hasLuxuryRealEstate:      assetCategories.includes("RealEstate"),
        jurisdictionCount,
        contactConfidence:        contactConf,
      });

      // isHot: entity is a real lead when we have a direct contact vector
      const isHot = hasMeaningfulDirectContact({
        type: fresh.type,
        email: fresh.email,
        phone: fresh.phone,
        phoneSource: fresh.phoneSource,
        contactOutcome: computeContactOutcome(fresh),
      }) && computeContactOutcome(fresh) === "direct_contact_verified";

      await db.update(entitiesTable).set({
        contactConfidence: contactConf,
        contactOutcome:    computeContactOutcome(fresh),
        bayesianScore:     Math.max(entity.bayesianScore ?? 0, bayesScore),
        isHot,
        // `cookedAt` is reserved for a completed research disposition.
        // A safe review with no validated personal route remains retryable.
        cookedAt:          researchDisposition.disposition === "contact_route_found" ? new Date() : null,
        updatedAt:         new Date(),
      }).where(eq(entitiesTable.id, id));
    }

    await materializeBusinessAsset({
      id,
      name,
      type: entity.type,
      sourceRegistries: entity.sourceRegistries,
      metadata: entity.metadata,
    }).catch((err: any) => logger.warn({ entityId: id, err: err?.message }, "[Atlas] Business asset materialization skipped"));

    logger.info({
      entityId: id,
      name,
      disposition: researchDisposition.disposition,
      nextAction: researchDisposition.nextAction,
    }, researchDisposition.disposition === "contact_route_found"
      ? "[Atlas] ✅ Entity has a reviewed contact route"
      : "[Atlas] ⚠️ Entity requires another OSINT follow-up pass");
  } catch (err: any) {
    if (err instanceof AtlasCancelledError || err instanceof AtlasTargetTimeoutError) throw err;
    logger.warn({ entityId: id, name, err: err.message }, "[Atlas] Full-circle enrichment failed (non-fatal)");
    // Do not stamp cookedAt on an error: cookedAt marks completed research
    // boundary, and failed enrichment must remain eligible for retry.
    await db.update(entitiesTable).set({ cookedAt: null, updatedAt: new Date() }).where(eq(entitiesTable.id, id)).catch(() => {});
  }
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

/**
 * Bounded, target-scoped Atlas run.
 *
 * The normal Atlas pipeline is intentionally broad and contains global
 * maintenance phases. Those are useful after ingestion, but are the wrong
 * behaviour when an analyst explicitly asks to finish one target before
 * moving on. This branch keeps the full per-target A–H journey and optional
 * MCTS research while avoiding discovery, registry ingestion, and global
 * embedding/wealth/contact passes.
 */
async function runSingleTargetPipeline(
  atlasJobId: string,
  opts: AtlasOptions,
  startMs: number,
): Promise<AtlasResult> {
  const targetId = opts.singleTargetId!;
  const summary: Record<string, string> = {};
  const targetRows = await fetchEntities({
    batchSize: 1,
    hotLeadsOnly: false,
    targetId,
  });

  if (targetRows.length === 0) {
    throw new Error(`Atlas target entity ${targetId} was not found.`);
  }

  const target = targetRows[0]!;
  await updateJob(atlasJobId, {
    status: "running",
    progress: 0,
    total: 10,
    atlasPhase: 0,
    atlasPhaseTotal: 10,
    message: `Single-target Atlas: ${target.name} — full journey queued…`,
    entityProgress: 0,
    entityTotal: 1,
    entityNames: JSON.stringify([target.name]),
  });
  await setAtlasTelemetry(atlasJobId, {
    stage: "TARGET INITIALIZATION",
    status: "active",
    targetName: target.name,
    targetType: target.type,
    toolIds: ["target"],
    activeToolId: "target",
    inputSummary: `Exact existing entity ID ${targetId}; no discovery or unrelated targets`,
  });

  const result = await runEntityBatch(
    atlasJobId,
    "TARGET 1/1",
    targetRows,
    (entity) => enrichEntityFullCircle(atlasJobId, entity as EntityRow),
    1,
    undefined,
    opts.targetTimeoutMs ?? DEFAULT_TARGET_TIMEOUT_MS,
  );
  summary["Target journey"] = `${target.name}: ${result.ok ? "complete" : "failed"} (${result.err} errors)`;

  if (opts.runResearch !== false) {
    await ensureAtlasActive(atlasJobId);
    await updateJob(atlasJobId, {
      status: "running",
      progress: 10,
      total: 10,
      atlasPhase: 10,
      atlasPhaseTotal: 10,
      message: `Phase 10/10: MCTS research target ${target.name}…`,
      entityProgress: 0,
      entityTotal: 1,
      entityNames: JSON.stringify([target.name]),
    });
    await setAtlasTelemetry(atlasJobId, {
      stage: "UCT RESEARCH",
      status: "active",
      targetName: target.name,
      targetType: target.type,
      toolIds: ["graph", "mcts", "prac", "evidence-review"],
      activeToolId: "mcts",
      inputSummary: "One completed target journey; reachability-gated adaptive research",
    });
    try {
      const researchResult = await runTargetResearch(target.id, 3);
      summary["Target research"] =
        `UCT complete (${researchResult.mcts.mctsSteps.length} steps, ` +
        `candidate path ${(researchResult.pathScore * 100).toFixed(0)}/100; manual review)`;
    } catch (err: any) {
      summary["Target research"] = `MCTS review: ${err?.message ?? "failed"}`;
      logger.warn({ entityId: target.id, err: err?.message }, "[Atlas] single-target MCTS failed");
    }
    await updateJob(atlasJobId, {
      entityProgress: 1,
      entityTotal: 1,
      entityNames: JSON.stringify([target.name]),
    });
  } else {
    summary["Target research"] = "Skipped (runResearch=false)";
  }

  const [hotRow, totalRow, contactRow] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(entitiesTable).where(sql`${entitiesTable.bayesianScore} >= 0.5`),
    db.select({ count: sql<number>`count(*)::int` }).from(entitiesTable),
    db.select({ count: sql<number>`count(*)::int` }).from(entitiesTable)
      .where(sql`(${entitiesTable.email} IS NOT NULL OR ${entitiesTable.phone} IS NOT NULL OR ${entitiesTable.linkedinUrl} IS NOT NULL)`),
  ]);
  const hotLeads = Number(hotRow[0]?.count ?? 0);
  const totalEntities = Number(totalRow[0]?.count ?? 0);
  const totalContacts = Number(contactRow[0]?.count ?? 0);
  const durationMs = Date.now() - startMs;
  const finalMsg = [
    `Single-target Atlas pass finished in ${Math.round(durationMs / 60_000)}min.`,
    `${target.name} was processed with no unrelated discovery or global backfill.`,
    Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join(" | "),
  ].join(" ");
  const targetAfterRun = await db.select({
    metadata: entitiesTable.metadata,
    contactOutcome: entitiesTable.contactOutcome,
    cookedAt: entitiesTable.cookedAt,
  }).from(entitiesTable).where(eq(entitiesTable.id, target.id)).then((rows: any[]) => rows[0]);
  const targetMetadata = safeJson<Record<string, unknown>>(targetAfterRun?.metadata, {});
  const disposition = targetMetadata.atlasResearchDisposition === "contact_route_found"
    ? "contact_route_found"
    : "needs_follow_up";
  const nextAction = typeof targetMetadata.atlasNextAction === "string"
    ? targetMetadata.atlasNextAction
    : "Run another target-scoped OSINT pass before treating this target as outreach-ready.";
  const processOutcome = disposition === "contact_route_found" ? "complete" : "incomplete";

  await setAtlasTelemetry(atlasJobId, {
    stage: "TARGET COMPLETE",
    status: processOutcome === "complete" ? "complete" : "review",
    targetName: target.name,
    targetType: target.type,
    toolIds: ["target", "inhouse", "webdisc", "deepweb", "perp0", "exa", "tavily", "groq", "maigret", "occrp", "whoxy", "graph", "mcts", "prac", "evidence-review"],
    inputSummary: `Exact entity ID ${targetId}`,
    resultSummary: `${finalMsg} Disposition: ${disposition}. Next action: ${nextAction}`,
    nextAction,
    disposition,
  });
  await ensureAtlasActive(atlasJobId);
  await updateJob(atlasJobId, {
    status: "done",
    progress: 10,
    total: 10,
    atlasPhase: 10,
    atlasPhaseTotal: 10,
    outcome: processOutcome,
    inserted: 0,
    finishedAt: new Date().toISOString(),
    message: `${finalMsg} Disposition: ${disposition}. Next action: ${nextAction}`,
    entityProgress: 1,
    entityTotal: 1,
    entityNames: JSON.stringify([target.name]),
  });
  await clearActiveJobIfOwned("atlas-run", atlasJobId);
  return {
    phase: 10,
    ingested: 0,
    enriched: result.ok,
    contactsFound: totalContacts,
    hotLeads,
    durationMs,
    phaseSummary: { ...summary, Scope: `Target ${target.id} only (${totalEntities} entities remain untouched)` },
  };
}

export async function runAtlasPipeline(atlasJobId: string, opts: AtlasOptions): Promise<AtlasResult> {
  const startMs = Date.now();
  const summary: Record<string, string> = {};
  let totalIngested = 0;
  let totalEnriched = 0;
  let totalContacts = 0;
  let cookedCount = 0;

  const batch = opts.batchSize ?? 200;
  const hot = opts.hotLeadsOnly ?? false;

  if (opts.singleTargetId != null) {
    return runSingleTargetPipeline(atlasJobId, opts, startMs);
  }

  async function status(msg: string, phaseNum?: number) {
    await ensureAtlasActive(atlasJobId);
    logger.info({ phase: phaseNum, msg }, "[Atlas]");
    await updateJob(atlasJobId, {
      status: "running",
      progress: phaseNum ?? 0,
      total: 10,
      message: msg,
      atlasPhase: phaseNum ?? 0,
      atlasPhaseTotal: 10,
      entityProgress: undefined,
      entityTotal: undefined,
      entityNames: undefined,
    });
    await clearJobFields(atlasJobId, ["entityProgress", "entityTotal", "entityNames"]);
  }

  // ── Phase 0: Pre-run cross-references ──────────────────────────────────────
  // Cross-reference whatever is already in the DB. Run once at the start.
  if (!opts.skipIngestion) {
    // ── Pre-run: OCCRP/OFAC + live ADS-B + CH Officers (cross-reference existing DB) ──
    await status("Phase 0/10: Pre-run cross-references — OCCRP/OFAC + live ADS-B + CH Officers…", 0);

    const occrpJobId   = await createJob("occrp");
    const openskyJobId = await createJob("opensky");
    await setActiveJob("occrp", occrpJobId);
    await setActiveJob("opensky", openskyJobId);

    const [occrpRes, openskyRes, officersRes] = await Promise.all([
      runOccrpEnrichment({ jobId: occrpJobId, limit: 5_000 })
        .catch(e => { logger.error({ err: e.message }, "[Atlas] OCCRP failed"); return { inserted: 0, skipped: 0, errors: 1, durationMs: 0 }; }),
      runOpenSkyEnrichment({ jobId: openskyJobId })
        .catch(e => { logger.error({ err: e.message }, "[Atlas] OpenSky failed"); return { inserted: 0, skipped: 0, errors: 1, liveAircraft: 0, durationMs: 0 }; }),
      (async () => {
        try {
          const { runCompanyOfficersEnrichment } = await import("./registry-enricher");
          const chOffJobId = await createJob("ch-officers");
          await setActiveJob("ch-officers", chOffJobId);
          return await runCompanyOfficersEnrichment({ jobId: chOffJobId, batchSize: 100 });
        } catch (e: any) {
          logger.error({ err: e.message }, "[Atlas] CH Officers failed");
          return { enriched: 0, skipped: 0, errors: 1, durationMs: 0 };
        }
      })(),
    ]);

    summary["Phase 0"] = `OCCRP/OFAC: ${occrpRes.inserted ?? 0} | Live ADS-B: ${(openskyRes as any).inserted ?? 0} matched | CH Officers: ${(officersRes as any).enriched ?? 0}`;

    // Identity passes: CH contact enrichment + OpenOwnership + Foundation filings
    const chEnrichJobId = await createJob("companies-house-enrich");
    await setActiveJob("companies-house-enrich", chEnrichJobId);
    const entities0 = await fetchEntities({ batchSize: 200, hotLeadsOnly: false });

    // These streams share the same target set. Keep them strictly sequential
    // so Phase 0 never researches multiple targets concurrently, even though
    // individual provider calls inside one target may remain parallel.
    const chRes = await runCompaniesHouseEnrichment({ jobId: chEnrichJobId, batchSize: 1 })
      .catch(e => {
        logger.error({ err: e.message }, "[Atlas] CH enrichment failed");
        return { enriched: 0, skipped: 0, errors: 1, durationMs: 0 };
      });
    await runEntityBatch(atlasJobId, "Phase 0/OpenOwnership", entities0.slice(0, 100), async (e) => {
      await setAtlasTelemetry(atlasJobId, {
        stage: "OWNERSHIP CROSS-REFERENCE",
        status: "active",
        targetName: e.name,
        targetType: e.type,
        toolIds: ["openownership"],
        activeToolId: "openownership",
        inputSummary: "Exact target name sent to Open Ownership BODS lookup",
      }, e.id);
      const res = await enrichWithOpenOwnership(e.name, true) as any;
      const ownershipCount = Number(res.totalMatches ?? res.entities?.length ?? (res.found ? 1 : 0));
      await setAtlasTelemetry(atlasJobId, {
        stage: "OWNERSHIP CROSS-REFERENCE",
        status: "complete",
        targetName: e.name,
        targetType: e.type,
        toolIds: ["openownership"],
        activeToolId: "openownership",
        resultSummary: `${ownershipCount} ownership record(s) returned; stored as registry evidence`,
        sources: ownershipCount,
        evidence: ownershipCount,
        contacts: 0,
        nextAction: "Continue with foundation filings and target-scoped enrichment",
      }, e.id);
      if (ownershipCount > 0) {
        const note = `OpenOwnership BODS: ${ownershipCount} ownership record(s) found.`;
        const existing = (e as any).notes ?? "";
        await db.update(entitiesTable).set({ notes: existing ? `${existing}\n${note}` : note, updatedAt: new Date() }).where(eq(entitiesTable.id, e.id));
      }
    }, 1);
    await runEntityBatch(atlasJobId, "Phase 0/FoundationFilings", entities0.filter(e => e.type === "HNWI").slice(0, 100), async (e) => {
      await setAtlasTelemetry(atlasJobId, {
        stage: "FOUNDATION FILINGS",
        status: "active",
        targetName: e.name,
        targetType: e.type,
        toolIds: ["foundation"],
        activeToolId: "foundation",
        inputSummary: "HNWI target name and known public identity context",
      }, e.id);
      await discoverViaFoundationFilings(e as any);
      await setAtlasTelemetry(atlasJobId, {
        stage: "FOUNDATION FILINGS",
        status: "complete",
        targetName: e.name,
        targetType: e.type,
        toolIds: ["foundation"],
        activeToolId: "foundation",
        resultSummary: "Foundation filing pass completed; only attributable public evidence is retained",
        nextAction: "Continue with discovery and full-circle enrichment",
      }, e.id);
    }, 1);

    summary["Phase 0b"] = `CH contact: ${(chRes as any).enriched ?? 0} | OpenOwnership + Foundation filings done`;
  } else {
    summary["Phase 0"] = "Skipped (skipIngestion=true)";
  }

  // ── Discovery + Full-circle loop ─────────────────────────────────────────────
  // Interleaved sources: broad web-search categories + registry rounds.
  // Each source round admits at most one new entity. That entity is immediately
  // enriched through ALL phases and stamped cookedAt before the next source runs.
  await status("Phase 1/10: Discovery + full-circle enrichment loop…", 1);

  type DiscoverySource =
    | { kind: "broad"; category: number; label: string }
    | { kind: "registry"; label: string; clearFirst?: boolean };

  const DISCOVERY_SOURCES: DiscoverySource[] = [
    { kind: "broad",    category: 6,  label: "European venue owners (Monte Carlo, Italian hotels, resorts…)" },
    { kind: "registry", label: "EDGAR/CH/BRREG/BODACC — batch 1", clearFirst: true },
    { kind: "broad",    category: 11, label: "Italian & Mediterranean (hotel Sicily, villa Amalfi coast…)" },
    { kind: "broad",    category: 7,  label: "Nordic & Scandinavian (golf clubs Norway, shipping Bergen, BRREG…)" },
    { kind: "registry", label: "EDGAR/CH/BRREG/BODACC — batch 2" },
    { kind: "broad",    category: 13, label: "Middle East business (investment funds Dubai, Qatar family office…)" },
    { kind: "broad",    category: 14, label: "Private clubs & marinas (yacht clubs, polo, golf, private members…)" },
    { kind: "registry", label: "EDGAR/CH/BRREG/BODACC — batch 3" },
    { kind: "broad",    category: 12, label: "French Riviera & Alpine (ski resort Courchevel, château Bordeaux…)" },
    { kind: "broad",    category: 8,  label: "Asian wealth centres (Singapore family office, Tokyo billionaire…)" },
    { kind: "registry", label: "EDGAR/CH/BRREG/BODACC — batch 4" },
    { kind: "broad",    category: 1,  label: "Family offices & private wealth (London, Geneva, Monaco, Zurich…)" },
    { kind: "broad",    category: 10, label: "Tier-1 fund principals (general partner AUM billion, PE managing…)" },
    { kind: "registry", label: "EDGAR/CH/BRREG/BODACC — batch 5" },
    { kind: "broad",    category: 15, label: "UK country houses, estates & private members clubs" },
    { kind: "broad",    category: 2,  label: "Luxury assets & aviation (superyacht owner, private jet N-number…)" },
    { kind: "broad",    category: 9,  label: "Latin American & Eastern European (São Paulo, Warsaw, Kyiv…)" },
    { kind: "registry", label: "EDGAR/CH/BRREG/BODACC — batch 6" },
    { kind: "broad",    category: 3,  label: "SEC filings & corporate (Schedule 13D, Form 4 insider transactions…)" },
    { kind: "broad",    category: 4,  label: "Philanthropy & foundations (private foundation trustee 990 filing…)" },
    { kind: "broad",    category: 5,  label: "Public mentions & networks (billionaire interview, angel investor…)" },
  ];

  const includeFaa = !(opts.skipFaa ?? true); // skip FAA by default
  // Discovery-first mode is intentionally bounded. Keep all registry anchor
  // rounds, but honor broadCategories so a "3 category" launch does not
  // silently expand into every broad source and recreate the prior OOM risk.
  const selectedBroadCategories = opts.discoveryFirst && opts.broadCategories
    ? new Set(
        DISCOVERY_SOURCES
          .filter((source): source is Extract<DiscoverySource, { kind: "broad" }> => source.kind === "broad")
          .slice(0, Math.max(1, opts.broadCategories))
          .map(source => source.category),
      )
    : null;
  const sourcesToRun = selectedBroadCategories
    ? DISCOVERY_SOURCES.filter(source => source.kind === "registry" || selectedBroadCategories.has(source.category))
    : DISCOVERY_SOURCES;
  const targetLimit = Math.max(0, opts.targetCount ?? (opts.discoveryFirst ? 500 : 15_000));
  let admittedTargets = 0;
  let sourceRound = 0;
  const phaseJJobId = await createJob("phase-j-pass");

  for (const source of sourcesToRun) {
    await ensureAtlasActive(atlasJobId);
    if (admittedTargets >= targetLimit) {
      logger.info({ targetLimit, admittedTargets, sourceRound }, "[Atlas] Target admission limit reached; ending discovery loop");
      break;
    }
    sourceRound++;
    const runStart = new Date();
    const remainingTargetBudget = targetLimit - admittedTargets;

    try {
      await status(`[${sourceRound}/${sourcesToRun.length}] ${source.label}…`, 1);

      if (source.kind === "broad") {
        const { discoverSingleTemplate } = await import("./enrichment/broad-discovery");
        const broadRes = await discoverSingleTemplate(source.category, 10, Math.min(1, remainingTargetBudget))
          .catch(e => { logger.error({ err: e.message }, "[Atlas] Broad discovery failed"); return { entitiesDiscovered: 0, queriesFired: 0, resultsScraped: 0, entitiesSkipped: 0, newEntities: [] }; });
        totalIngested += broadRes.entitiesDiscovered;
      } else {
        const hnwiJobId = await createJob("western-hnwi");
        await setActiveJob("western-hnwi", hnwiJobId);
        const hnwiRes = await runWesternHnwiIngestion({
          // This is an admission round, not a bulk import. Full-circle
          // enrichment below must finish before another target is admitted.
          targetCount: Math.min(1, remainingTargetBudget),
          batchSize: 1,
          jobId: hnwiJobId,
          clearDedupFirst: (source as any).clearFirst ?? false,
        }).catch(e => { logger.error({ err: e.message }, "[Atlas] HNWI ingestion failed"); return { inserted: 0, skipped: 0, errors: 1, durationMs: 0 }; });
        await setActiveJob("western-hnwi", "");
        totalIngested += hnwiRes.inserted;

        // Optional FAA between registry batches 3 and 4
        if (includeFaa && sourceRound === 8) {
          const faaJobId = await createJob("faa");
          await setActiveJob("faa", faaJobId);
          const faaRes = await runFaaIngestion({ jobId: faaJobId, maxRecords: 1, forceRefresh: false })
            .catch(e => { logger.error({ err: e.message }, "[Atlas] FAA failed"); return { inserted: 0 }; });
          await setActiveJob("faa", "");
          totalIngested += faaRes.inserted;
        }
      }
    } catch (e: any) {
      logger.error({ err: e.message, sourceRound }, "[Atlas] Discovery source failed");
    }

    // Fetch entities created in this batch that haven't been cooked yet
    const newEntities = await db.select({
      id: entitiesTable.id, name: entitiesTable.name, type: entitiesTable.type,
      email: entitiesTable.email, phone: entitiesTable.phone,
      linkedinUrl: entitiesTable.linkedinUrl, twitterHandle: entitiesTable.twitterHandle,
      instagramHandle: entitiesTable.instagramHandle, telegramHandle: entitiesTable.telegramHandle,
      bayesianScore: entitiesTable.bayesianScore, contactConfidence: entitiesTable.contactConfidence,
      knownResidences: entitiesTable.knownResidences, metadata: entitiesTable.metadata,
      notes: entitiesTable.notes, sourceRegistries: entitiesTable.sourceRegistries,
    })
      .from(entitiesTable)
      .where(and(
        sql`${entitiesTable.createdAt} >= ${runStart.toISOString()}`,
        sql`${entitiesTable.cookedAt} IS NULL`,
      ))
      .orderBy(desc(entitiesTable.createdAt))
      .limit(1);

    logger.info({ sourceRound, label: source.label, newCount: newEntities.length }, "[Atlas] Starting full-circle enrichment");
    admittedTargets += newEntities.length;

    if (newEntities.length > 0) {
      const batchResult = await runEntityBatch(
        atlasJobId,
        `[${sourceRound}/${sourcesToRun.length}] 🍳`,
        newEntities,
        (entity) => enrichEntityFullCircle(atlasJobId, entity as EntityRow),
        1,
        undefined,
        opts.targetTimeoutMs ?? DEFAULT_TARGET_TIMEOUT_MS,
      );
      cookedCount += batchResult.ok;
      totalEnriched += batchResult.ok;
    }

    // Phase J attribution after each source round (processes all pending entities)
    try {
      await setActiveJob("phase-j-pass", phaseJJobId);
      await status("Phase 8/10: Phase J attribution and graph-assisted analysis…", 8);
      const phaseJResult = await runPhaseJBatch(
        phaseJJobId,
        opts.phaseJBatchSize ?? 50,
        atlasJobId,
      );
      summary[`Phase J round ${sourceRound}`] = phaseJResult.message;
      await setActiveJob("phase-j-pass", "");
    } catch (e: any) {
      logger.warn({ err: e.message }, "[Atlas] Phase J round failed (non-fatal)");
      await status(`Phase 8/10: Phase J failed for this round — ${e.message}`, 8);
    }

    summary[`Src ${sourceRound}`] = `${source.label.split("(")[0].trim()}: ${newEntities.length} → cooked`;
  }

  summary["Discovery loop"] = `${totalEnriched} target journeys completed across ${sourceRound} sources (admitted ${admittedTargets}/${targetLimit}; contact-route completions remain separately gated)`;

  // ── Phase 3: Metadata population ───────────────────────────────────────────
  await ensureAtlasActive(atlasJobId);
  await status("Phase 3/10: Populate notes + EDGAR stock assets + live-source markers…", 3);

  try {
    // Populate notes from metadata
    let notesUpdated = 0;
    const noteRows = await db.select({ id: entitiesTable.id, notes: entitiesTable.notes, metadata: entitiesTable.metadata, sourceRegistries: entitiesTable.sourceRegistries, type: entitiesTable.type, nationality: entitiesTable.nationality, knownResidences: entitiesTable.knownResidences })
      .from(entitiesTable)
      .where(sql`${entitiesTable.metadata} IS NOT NULL AND ${entitiesTable.metadata} != '{}'`)
      .limit(10_000);

    for (const row of noteRows) {
      const meta: Record<string, any> = safeJson(row.metadata, {});
      const sources: string[] = safeJson(row.sourceRegistries, []);
      const parts: string[] = [];
      if (sources.length) parts.push(`Source: ${sources.join("; ")}.`);
      if (meta.formType) parts.push(`Filing: ${meta.formType}${meta.fileDate ? ` (${meta.fileDate})` : ""}.`);
      if (meta.companyName) parts.push(`Company: ${meta.companyName}.`);
      if (meta.orgnr) parts.push(`Org: ${meta.orgnr}.`);
      if (meta.roleDesc) parts.push(`Role: ${meta.roleDesc}.`);
      if (row.nationality) parts.push(`Nationality: ${row.nationality}.`);
      if (row.type) parts.push(`Type: ${row.type}.`);
      const newNotes = parts.join(" ");
      // Only write baseline metadata notes when the entity has no notes yet.
      // Entities already enriched (ICIJ hits, Whoxy, AI notes) must not be overwritten.
      if (newNotes && !row.notes) {
        await db.update(entitiesTable).set({ notes: newNotes }).where(eq(entitiesTable.id, row.id));
        notesUpdated++;
      }
    }

    // Create EDGAR stock assets
    const edgarEntities = await db.select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata, knownResidences: entitiesTable.knownResidences })
      .from(entitiesTable)
      .where(sql`${entitiesTable.metadata} LIKE '%sec-edgar%' AND ${entitiesTable.metadata} NOT LIKE '%sec-edgar-def14a%'`)
      .limit(5_000);
    const existingAssetIds = new Set(
      (await db.select({ ownerEntityId: assetsTable.ownerEntityId }).from(assetsTable).where(sql`${assetsTable.ownerEntityId} IS NOT NULL`))
        .map(r => r.ownerEntityId!),
    );
    const toCreate = edgarEntities.filter(e => !existingAssetIds.has(e.id));
    if (toCreate.length) {
      const assetRows = toCreate.map(e => {
        const meta: Record<string, any> = safeJson(e.metadata, {});
        return {
          category: "StockHolding" as const,
          identifier: `EDGAR-${(meta.formType ?? "SC13G").replace(/\s/g, "")}-${e.id}`,
          jurisdiction: "SEC EDGAR",
          description: `Large-shareholder position per ${meta.formType ?? "SC 13G"} filing. Beneficial owner: ${e.name}.`,
          address: meta.bizLocation ?? null,
          sourceRegistry: `SEC EDGAR — ${meta.formType ?? "SC 13G"}`,
          ownerEntityId: e.id,
          lastActivityDate: meta.fileDate ?? null,
        };
      });
      for (let i = 0; i < assetRows.length; i += 500) {
        await db.insert(assetsTable).values(assetRows.slice(i, i + 500)).onConflictDoNothing();
      }
    }

    summary["Phase 3"] = `Notes: ${notesUpdated} updated | EDGAR assets: ${toCreate.length} created`;
  } catch (e: any) {
    logger.error({ err: e.message }, "[Atlas] Phase 3 metadata failed");
    summary["Phase 3"] = `Error: ${e.message}`;
  }

  // ── Phase 9: Semantic layer ─────────────────────────────────────────────────
  // (Phases 4-8 are now handled per-entity inside enrichEntityFullCircle above)
  await ensureAtlasActive(atlasJobId);
  await status("Phase 9/10: Semantic embeddings + net worth backfill + confidence recompute…", 9);

  try {
    const embJobId = await createJob("compute-embeddings");
    await setActiveJob("compute-embeddings", embJobId);
    await updateJob(embJobId, { status: "running", message: "Loading all-MiniLM-L6-v2 model…" });

    const { embedText, entityToEmbedText, storeEmbedding, getEmbeddingCacheSize, getAllEmbeddings } = await import("./semantic-engine");
    const embRows = await db.select({ id: entitiesTable.id, name: entitiesTable.name, notes: entitiesTable.notes, nationality: entitiesTable.nationality, knownResidences: entitiesTable.knownResidences, metadata: entitiesTable.metadata }).from(entitiesTable).limit(50_000);
    const existingCache = getAllEmbeddings();
    const toEmbed = embRows.filter(e => !existingCache.has(e.id));
    let embProcessed = 0;
    const CHUNK = 10;
    for (let i = 0; i < toEmbed.length; i += CHUNK) {
      await Promise.allSettled(toEmbed.slice(i, i + CHUNK).map(async e => {
        const emb = await embedText(entityToEmbedText(e));
        await storeEmbedding(e.id, emb);
        embProcessed++;
      }));
    }
    await updateJob(embJobId, { status: "done", progress: embProcessed, total: toEmbed.length, message: `${embProcessed} embeddings computed. Cache: ${getEmbeddingCacheSize()}` });
    await setActiveJob("compute-embeddings", "");

    // Net worth backfill — LLM forced-estimate pass (primary) + asset formula (secondary)
    // The LLM prompt is engineered so models CANNOT respond "I don't know" — they
    // must derive a figure from role, company, registry signals, and sector norms.
    await status("Phase 9/10: LLM wealth estimation…", 9);
    try {
      const wealthResult = await backfillWealthLLM({ onlyMissing: true, batchSize: 8 });
      summary["Phase 9 — Wealth"] = `LLM wealth estimates: ${wealthResult.updated} updated, ${wealthResult.skipped} skipped, ${wealthResult.errors} errors`;
      logger.info(wealthResult, "[Atlas] LLM wealth backfill complete");
    } catch (wealthErr: any) {
      logger.warn({ err: wealthErr.message }, "[Atlas] LLM wealth backfill failed — falling back to asset formula");
      // Asset-formula fallback for any remaining nulls
      await db.execute(sql`
        UPDATE entities SET estimated_net_worth = (
          SELECT COALESCE(SUM(estimated_value), 0) * 3
          FROM assets WHERE owner_entity_id = entities.id
        )
        WHERE (estimated_net_worth IS NULL OR estimated_net_worth = 0)
          AND EXISTS (SELECT 1 FROM assets WHERE owner_entity_id = entities.id AND estimated_value > 0)
      `);
    }

    // Normalize stored social handles — strip URL prefixes so only bare handles are stored.
    // Fixes entities enriched before normalizeHandle() was added to Step C.
    await db.execute(sql`
      UPDATE entities
      SET twitter_handle = regexp_replace(twitter_handle, '^https?://(www\\.)?(twitter\\.com|x\\.com)/', '', 'i'),
          instagram_handle = regexp_replace(instagram_handle, '^https?://(www\\.)?instagram\\.com/', '', 'i')
      WHERE twitter_handle LIKE 'http%' OR instagram_handle LIKE 'http%'
    `).catch(() => {});

    // Clear obfuscated/protected emails that were scraped from Cloudflare-protected pages.
    await db.execute(sql`
      UPDATE entities SET email = NULL WHERE email ILIKE '%protected%'
    `).catch(() => {});

    // Reconcile confidence, outcome, and hot status together. Keeping this
    // pass on the shared classifier prevents a stale raw SQL backfill from
    // promoting unverified candidate emails or registry switchboards.
    const confEntities = await db.select({
      id: entitiesTable.id,
      type: entitiesTable.type,
      email: entitiesTable.email,
      phone: entitiesTable.phone,
      phoneSource: entitiesTable.phoneSource,
      linkedinUrl: entitiesTable.linkedinUrl,
      twitterHandle: entitiesTable.twitterHandle,
      instagramHandle: entitiesTable.instagramHandle,
      telegramHandle: entitiesTable.telegramHandle,
      knownResidences: entitiesTable.knownResidences,
      metadata: entitiesTable.metadata,
      contactConfidence: entitiesTable.contactConfidence,
      contactOutcome: entitiesTable.contactOutcome,
      isHot: entitiesTable.isHot,
    }).from(entitiesTable).limit(50_000);
    for (let i = 0; i < confEntities.length; i += 1000) {
      for (const e of confEntities.slice(i, i + 1000)) {
        let metadata: Record<string, unknown> = {};
        try {
          const parsed = e.metadata ? JSON.parse(e.metadata) : {};
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed;
        } catch {
          // Malformed metadata remains untouched and cannot validate access.
        }
        const state = computeContactState({
          type: e.type,
          email: e.email,
          phone: e.phone,
          phoneSource: e.phoneSource,
          linkedinUrl: e.linkedinUrl,
          twitterHandle: e.twitterHandle,
          instagramHandle: e.instagramHandle,
          telegramHandle: e.telegramHandle,
          knownResidences: e.knownResidences,
          metadata: e.metadata,
          website: typeof metadata.website === "string" ? metadata.website : null,
          bizLocation: typeof metadata.bizLocation === "string" ? metadata.bizLocation : null,
          emailSource: typeof metadata.emailSource === "string" ? metadata.emailSource : null,
          validatedDirectContact: metadata.validatedDirectContact === true,
          isGenericPrefix: metadata.isGenericPrefix === true,
        });
        if (
          state.contactConfidence !== (e.contactConfidence ?? 0) ||
          state.contactOutcome !== e.contactOutcome ||
          state.isHot !== e.isHot
        ) {
          await db.update(entitiesTable).set({
            contactConfidence: state.contactConfidence,
            contactOutcome: state.contactOutcome,
            isHot: state.isHot,
            updatedAt: new Date(),
          }).where(eq(entitiesTable.id, e.id));
        }
      }
    }

    // Recompute bayesian scores for all cooked entities using current weights
    const scoreEntities = await db.select({
      id: entitiesTable.id, type: entitiesTable.type, bayesianScore: entitiesTable.bayesianScore,
      contactConfidence: entitiesTable.contactConfidence,
    }).from(entitiesTable).where(sql`${entitiesTable.cookedAt} IS NOT NULL`).limit(50_000);
    const { computeBayesianScore: recomputeScore } = await import("./bayesian-scorer");
    let bayesUpdated = 0;
    for (const e of scoreEntities) {
      const newScore = recomputeScore(0.05, {
        entityType: e.type ?? "HNWI",
        assetCount: 0, assetCategories: [], totalAssetValue: 0,
        hasRecentActivity: true, recentActivityDays: 0,
        networkDegree: 0, hasGatekeeperConnection: false, hasKnownInvestorConnection: false,
        hasShellCompany: false, hasAviationAsset: false, hasMarineAsset: false,
        hasClubMembership: false, hasLuxuryRealEstate: false, jurisdictionCount: 0,
        contactConfidence: e.contactConfidence ?? 0,
      });
      const finalScore = Math.max(e.bayesianScore ?? 0, newScore);
      if (Math.abs(finalScore - (e.bayesianScore ?? 0)) > 0.001) {
        await db.update(entitiesTable).set({ bayesianScore: finalScore }).where(eq(entitiesTable.id, e.id));
        bayesUpdated++;
      }
    }

    summary["Phase 9"] = `Embeddings: ${embProcessed} | Net worth backfill done | Confidence recomputed | Bayesian scores recomputed: ${bayesUpdated}`;
  } catch (e: any) {
    logger.error({ err: e.message }, "[Atlas] Phase 9 failed");
    summary["Phase 9"] = `Error: ${e.message}`;
  }

  // ── Phase 10: MCTS Research on hot leads ───────────────────────────────────
  if (opts.runResearch !== false) {
    await ensureAtlasActive(atlasJobId);
    await status("Phase 10/10: MCTS research on hot leads…", 10);
    try {
      // Target selection is reachability-first, NOT wealth-first: a $2B net worth
      // recluse with no contact vector (the "Peter Thiel class") must never outrank
      // a moderately wealthy person we can actually reach. bayesianScore only breaks
      // ties here — see reachability-rank.ts for the full ordering rationale.
      const researchLimit = opts.researchLimit ?? 10;
      const hotEntities = await db.select({ id: entitiesTable.id })
        .from(entitiesTable)
        .where(sql`${entitiesTable.type} = 'HNWI' AND ${entitiesTable.isHidden} = false`)
        .orderBy(reachabilityOrderExpr())
        .limit(researchLimit);

      let researched = 0;
      for (let i = 0; i < hotEntities.length; i++) {
        await ensureAtlasActive(atlasJobId);
        const e = hotEntities[i]!;
        await updateJob(atlasJobId, {
          status: "running",
          progress: 10,
          total: 10,
          message: `MCTS research target ${i + 1}/${hotEntities.length}: ${e.id}…`,
          entityProgress: i,
          entityTotal: hotEntities.length,
          entityNames: JSON.stringify([String(e.id)]),
        });
        try {
          await setAtlasTelemetry(atlasJobId, {
            stage: "UCT / MCTS RESEARCH",
            status: "active",
            targetName: String(e.id),
            targetType: "HNWI",
            toolIds: ["mcts", "prac", "graph", "evidence-review"],
            activeToolId: "mcts",
            inputSummary: `Reachability-ranked HNWI research target ${i + 1}/${hotEntities.length} · one target at a time`,
          });
          await runTargetResearch(e.id, 3);
          researched++;
          await setAtlasTelemetry(atlasJobId, {
            stage: "UCT / MCTS RESEARCH",
            status: "complete",
            targetName: String(e.id),
            targetType: "HNWI",
            toolIds: ["mcts", "prac", "graph", "evidence-review"],
            activeToolId: "prac",
            resultSummary: "Target research completed; outcome remains subject to reachability and evidence gates.",
          });
        } catch (err: any) {
          await setAtlasTelemetry(atlasJobId, {
            stage: "UCT / MCTS RESEARCH",
            status: "review",
            targetName: String(e.id),
            targetType: "HNWI",
            toolIds: ["mcts", "prac", "graph", "evidence-review"],
            activeToolId: "mcts",
            resultSummary: `Target research did not complete: ${err?.message ?? "unknown error"}`,
          });
          logger.warn({ entityId: e.id, err: err?.message }, "[Atlas] single-target MCTS failed");
        }
        await updateJob(atlasJobId, {
          entityProgress: i + 1,
          entityTotal: hotEntities.length,
          entityNames: JSON.stringify([String(e.id)]),
        });
      }
      summary["Phase 10"] = `MCTS: ${researched}/${hotEntities.length} hot leads researched`;
    } catch (e: any) {
      logger.error({ err: e.message }, "[Atlas] MCTS phase failed");
      summary["Phase 10"] = `MCTS: error — ${e.message}`;
    }
  } else {
    summary["Phase 10"] = "Skipped (runResearch=false)";
  }

  // ── Final count ────────────────────────────────────────────────────────────
  const [hotRow, totalRow] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(entitiesTable).where(sql`${entitiesTable.bayesianScore} >= 0.5`),
    db.select({ count: sql<number>`count(*)::int` }).from(entitiesTable),
  ]);

  const hotLeads = Number(hotRow[0]?.count ?? 0);
  const durationMs = Date.now() - startMs;

  // Count entities with at least one confirmed contact vector
  const contactRow = await db.select({ count: sql<number>`count(*)::int` })
    .from(entitiesTable)
    .where(sql`(${entitiesTable.email} IS NOT NULL OR ${entitiesTable.phone} IS NOT NULL OR ${entitiesTable.linkedinUrl} IS NOT NULL)`);
  totalContacts = Number(contactRow[0]?.count ?? 0);

  const finalMsg = [
    `Atlas complete in ${Math.round(durationMs / 60_000)}min.`,
    `${Number(totalRow[0]?.count ?? 0).toLocaleString()} entities | ${hotLeads} hot leads | ${totalContacts} contacts found.`,
    Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join(" | "),
  ].join(" ");

  await ensureAtlasActive(atlasJobId);
  await updateJob(atlasJobId, {
    status: "done",
    progress: 10, total: 10,
    atlasPhase: 10,
    atlasPhaseTotal: 10,
    inserted: totalIngested,
    finishedAt: new Date().toISOString(),
    message: finalMsg,
  });
  await clearActiveJobIfOwned("atlas-run", atlasJobId);
  logger.info({ durationMs, hotLeads, summary }, "[Atlas] Pipeline complete");

  return { phase: 10, ingested: totalIngested, enriched: totalEnriched, contactsFound: totalContacts, hotLeads, durationMs, phaseSummary: summary };
}
