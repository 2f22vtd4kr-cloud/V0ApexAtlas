/**
 * Apex Atlas Orchestrator
 *
 * Full 8-phase investor discovery pipeline that fires every data source,
 * enricher, and OSINT tool in the optimal cross-reference order.
 *
 * Phase 0  — Mass ingestion (parallel): FAA + Western HNWI (EDGAR/CH/BRREG) + optional Land Registry
 * Phase 1  — Registry cross-reference (parallel): OCCRP Aleph + OpenSky live flights + CH Company Officers
 * Phase 2  — Identity & ownership (parallel): CH contact enrichment + OpenOwnership BODS + Foundation filings
 * Phase 3  — Populate metadata: notes + stock assets + live source markers
 * Phase 4  — In-house OSINT (7 free sources): Wikidata, GitHub, RDAP, DNS, Gravatar, ProPublica 990
 * Phase 5  — Social / Messenger / Broad discovery
 * Phase 6  — AI OSINT sweep: Perplexity + Gemini + Tavily + Exa + Groq extraction
 *              → Maigret (3 000+ platforms) + Holehe (120+ services)
 *              → Web-OSINT re-run if Maigret finds 3+ new signals
 * Phase 7  — Forensic cross-reference (parallel): ICIJ Offshore Leaks + Whoxy + Equasis + ADSB history + OpenOwnership
 * Phase 8  — Attribution: Phase J (J4–J9) domain resolution + digital footprint + graph-assisted scoring
 * Phase 9  — Semantic layer: embeddings + net worth backfill + contact outcome backfill + confidence recompute
 * Phase 10 — MCTS research on hot leads (batches of 5)
 */

import { db, entitiesTable, assetsTable, contactEvidenceTable } from "@workspace/db";
import { sql, eq, and, desc, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { updateJob, clearJobFields, createJob, setActiveJob, ownsActiveJob, clearActiveJobIfOwned } from "./job-queue";
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
import { runHolehe, runMaigret } from "./python-tools";
import { computeContactConfidence, computeContactOutcome, hasMeaningfulDirectContact } from "./contact-confidence";
import {
  sanitizePublicEmail,
  sanitizePublicPhone,
  sanitizePublicSocialUrl,
  isValidPublicSocialHandle,
} from "./contact-validation";
import { contactCacheSet } from "./redis";
import { runPhaseJBatch } from "../routes/phase-j";
import { reachabilityOrderExpr } from "./reachability-rank";
import { backfillWealthLLM } from "./wealth-estimator";

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

function safeJson<T>(str: string | null | undefined, fallback: T): T {
  try { return str ? JSON.parse(str) as T : fallback; } catch { return fallback; }
}

/** Fetch a page of entities suitable for per-entity enrichment. */
async function fetchEntities(opts: {
  batchSize: number;
  hotLeadsOnly: boolean;
  types?: string[];
  requireEmail?: boolean;
  requireAviationAsset?: boolean;
}) {
  const types = opts.types ?? ["HNWI", "Gatekeeper", "Corporation", "Trust"];
  const conditions: any[] = [
    sql`${entitiesTable.type} IN (${sql.join(types.map(t => sql`${t}`), sql`, `)})`,
  ];
  if (opts.hotLeadsOnly) conditions.push(sql`${entitiesTable.bayesianScore} >= 0.5`);
  if (opts.requireEmail) conditions.push(sql`${entitiesTable.email} IS NOT NULL`);

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
    bayesianScore: entitiesTable.bayesianScore,
    contactConfidence: entitiesTable.contactConfidence,
  })
    .from(entitiesTable)
    .where(and(...conditions))
    .orderBy(desc(entitiesTable.bayesianScore), desc(entitiesTable.isHot))
    .limit(opts.batchSize);
}

/** Run a per-entity async fn with bounded concurrency and update the Atlas job. */
async function runEntityBatch<T>(
  atlasJobId: string,
  phase: string,
  entities: Array<{ id: number; name: string }>,
  fn: (entity: any) => Promise<T>,
  concurrency = 3,
  onResult?: (entity: any, result: T) => Promise<void>,
): Promise<{ ok: number; err: number }> {
  let ok = 0; let errCount = 0;

  for (let i = 0; i < entities.length; i += concurrency) {
    await ensureAtlasActive(atlasJobId);
    const slice = entities.slice(i, i + concurrency);
    await updateJob(atlasJobId, {
      status: "running",
      progress: i,
      total: entities.length,
      message: `${phase}: ${slice.map(e => e.name).join(", ")}…`,
      entityProgress: i,
      entityTotal: entities.length,
      entityNames: JSON.stringify(slice.map(e => e.name)),
    });

    const results = await Promise.allSettled(
      slice.map(async (entity) => {
        try {
          const result = await fn(entity);
          if (onResult) await onResult(entity, result).catch(() => {});
          ok++;
        } catch (err) {
          if (err instanceof AtlasCancelledError) throw err;
          errCount++;
          logger.warn({ entityId: entity.id, phase, err: (err as Error).message }, "[Atlas] entity error");
        }
      }),
    );
    const cancellation = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected" && result.reason instanceof AtlasCancelledError,
    );
    if (cancellation) throw cancellation.reason;
    await updateJob(atlasJobId, {
      entityProgress: i + slice.length,
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

async function ensureAtlasActive(atlasJobId: string): Promise<void> {
  if (!(await ownsActiveJob("atlas-run", atlasJobId))) {
    throw new AtlasCancelledError();
  }
}

// ── Per-entity full-circle enricher ───────────────────────────────────────────
// Runs all enrichment phases (4–8) on a single entity and stamps cookedAt.
// Called immediately after each entity is discovered — users see progress live.

type EntityRow = {
  id: number; name: string; type: string;
  email: string | null; phone: string | null;
  linkedinUrl: string | null; twitterHandle: string | null;
  instagramHandle: string | null; telegramHandle: string | null;
  bayesianScore: number | null; contactConfidence: number | null;
  knownResidences: string | null; metadata: string | null;
  notes: string | null; sourceRegistries: string | null;
};

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

async function enrichEntityFullCircle(atlasJobId: string, entity: EntityRow): Promise<void> {
  const { id, name } = entity;
  try {
    // ── Step A: In-house OSINT (Wikidata, GitHub, RDAP, DNS, Gravatar, ProPublica) ──
    const meta = safeJson<Record<string, unknown>>(entity.metadata, {});
    const ihResult = await enrichInHouse({
      ...entity,
      bizLocation: meta.bizLocation as string ?? null,
      entityName: meta.entityName as string ?? null,
    } as any).catch(() => null);

    if (ihResult) {
      const up: Record<string, unknown> = { updatedAt: new Date() };
      const ihEmail = sanitizePublicEmail(ihResult.email);
      const ihPhone = sanitizePublicPhone(ihResult.phone);
      const ihLinkedIn = sanitizePublicSocialUrl(ihResult.linkedinUrl, "linkedin", "person");
      const ihTwitter = isValidPublicSocialHandle(ihResult.twitter, "twitter")
        ? ihResult.twitter!.replace(/^@/, "")
        : null;
      if (ihEmail && !entity.email) {
        up.email = ihEmail;
        entity = { ...entity, email: ihEmail };
      }
      if (ihLinkedIn && !entity.linkedinUrl) {
        up.linkedinUrl = ihLinkedIn;
        entity = { ...entity, linkedinUrl: ihLinkedIn };
      }
      if (ihPhone && !entity.phone) {
        up.phone = ihPhone;
        entity = { ...entity, phone: ihPhone };
      }
      if (ihTwitter && !entity.twitterHandle) {
        up.twitterHandle = ihTwitter;
        entity = { ...entity, twitterHandle: ihTwitter };
      }
      if (Object.keys(up).length > 1) {
        up.contactConfidence = computeContactConfidence({
          type: entity.type,
          email: entity.email,
          phone: entity.phone,
          linkedinUrl: entity.linkedinUrl,
          twitterHandle: entity.twitterHandle,
          knownResidences: entity.knownResidences,
        });
        up.contactOutcome = computeContactOutcome({
          email: entity.email,
          phone: entity.phone,
          linkedinUrl: entity.linkedinUrl,
          twitterHandle: entity.twitterHandle,
        });
        await db.update(entitiesTable).set(up as any).where(eq(entitiesTable.id, id));
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

    // ── Step B: Social + Messenger discovery ───────────────────────────────────
    const [socialResult, messengerResult] = await Promise.all([
      discoverSocialPresence(entity as any).catch(() => null),
      discoverMessengerPresence(entity as any).catch(() => null),
    ]);
    const socUp: Record<string, unknown> = {};
    const socialLinkedIn = sanitizePublicSocialUrl(socialResult?.linkedinUrl, "linkedin", "person");
    const socialTwitter = isValidPublicSocialHandle(socialResult?.twitterHandle, "twitter")
      ? socialResult!.twitterHandle!.replace(/^@/, "")
      : null;
    const socialInstagram = isValidPublicSocialHandle(socialResult?.instagramHandle, "instagram")
      ? socialResult!.instagramHandle!.replace(/^@/, "")
      : null;
    if (socialLinkedIn && !entity.linkedinUrl) {
      socUp.linkedinUrl = socialLinkedIn;
      entity = { ...entity, linkedinUrl: socialLinkedIn };
    }
    if (socialTwitter && !entity.twitterHandle) {
      socUp.twitterHandle = socialTwitter;
      entity = { ...entity, twitterHandle: socialTwitter };
    }
    if (socialInstagram && !entity.instagramHandle) {
      socUp.instagramHandle = socialInstagram;
      entity = { ...entity, instagramHandle: socialInstagram };
    }
    if (messengerResult?.telegramHandle && !entity.telegramHandle) { socUp.telegramHandle = messengerResult.telegramHandle; entity = { ...entity, telegramHandle: messengerResult.telegramHandle }; }
    if (Object.keys(socUp).length) { socUp.updatedAt = new Date(); await db.update(entitiesTable).set(socUp as any).where(eq(entitiesTable.id, id)); }

    await ensureAtlasActive(atlasJobId);
    // ── Step C: AI OSINT sweep (Perplexity + Gemini + Tavily + Exa + Groq) ────
    await updateJob(atlasJobId, { status: "running", message: `🤖 ${name}: AI OSINT…` });
    const aiResult = await deepWebOsintEnrich(entity as any).catch(() => null);
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
      const confidence = computeContactConfidence({
        type: entity.type,
        email: cleanEmail, phone: cleanPhone, linkedinUrl: cleanLinkedIn,
        instagramHandle: cleanInstagram, twitterHandle: cleanTwitter,
        knownResidences: entity.knownResidences,
      });
      await db.update(entitiesTable).set({
        ...(cleanEmail        ? { email:          cleanEmail }        : {}),
        ...(cleanPhone        ? { phone:          cleanPhone }        : {}),
        ...(cleanLinkedIn     ? { linkedinUrl:    cleanLinkedIn }     : {}),
        ...(cleanInstagram && !entity.instagramHandle && !isCorpOrTrust ? { instagramHandle: normalizeHandle(cleanInstagram) } : {}),
        ...(cleanTwitter   && !entity.twitterHandle   && !isCorpOrTrust ? { twitterHandle:   normalizeHandle(cleanTwitter) }   : {}),
        contactConfidence: confidence, updatedAt: new Date(),
        contactOutcome: computeContactOutcome({
          email: cleanEmail,
          phone: cleanPhone,
          linkedinUrl: cleanLinkedIn,
          twitterHandle: cleanTwitter,
          instagramHandle: cleanInstagram,
        }),
      }).where(eq(entitiesTable.id, id));
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

    await ensureAtlasActive(atlasJobId);
    // ── Step D: Maigret (3 000+ platforms) + Holehe (120+ services) ───────────
    const rawHandle = (
      (aiResult?.twitterUrl ?? "").replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com)\//, "").replace(/\?.*$/, "")
      || (entity.twitterHandle ?? "").replace(/^@/, "")
      || (aiResult?.instagramUrl ?? "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/\?.*$/, "")
      || (entity.instagramHandle ?? "").replace(/^@/, "")
    ).replace(/[^a-zA-Z0-9._\-]/g, "").trim();
    const emailForHolehe = entity.email ?? null;

    if (rawHandle || emailForHolehe) {
      await updateJob(atlasJobId, { status: "running", message: `🕵️ ${name}: Maigret + Holehe…` });
      const [maigretResult, holeheResult] = await Promise.all([
        rawHandle      ? runMaigret(rawHandle).catch(() => null)      : Promise.resolve(null),
        emailForHolehe ? runHolehe(emailForHolehe).catch(() => null)  : Promise.resolve(null),
      ]);
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
          if (result2?.email) await db.update(entitiesTable).set({ email: result2.email, updatedAt: new Date() }).where(eq(entitiesTable.id, id));
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
    }

    await ensureAtlasActive(atlasJobId);
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
          await db.insert(assetsTable).values(domainAssets).onConflictDoNothing().catch(() => {});
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
              await db.insert(assetsTable).values(assetRows).onConflictDoNothing().catch(() => {});
              logger.info({ entityId: id, name, assetCount: assetRows.length }, "[Atlas] ✅ Assets extracted");
            }
          }
        }
      }
    } catch (assetErr) {
      logger.warn({ entityId: id, name, err: String(assetErr) }, "[Atlas] Step G asset extraction failed");
    }

    // ── Step F: Final confidence recompute + bayesian score + isHot + cookedAt ─
    const fresh = await db.select({
      type: entitiesTable.type,
      email: entitiesTable.email, phone: entitiesTable.phone,
      linkedinUrl: entitiesTable.linkedinUrl, twitterHandle: entitiesTable.twitterHandle,
      instagramHandle: entitiesTable.instagramHandle, telegramHandle: entitiesTable.telegramHandle,
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
        contactOutcome: computeContactOutcome(fresh),
      });

      await db.update(entitiesTable).set({
        contactConfidence: contactConf,
        contactOutcome:    computeContactOutcome(fresh),
        bayesianScore:     Math.max(entity.bayesianScore ?? 0, bayesScore),
        isHot,
        cookedAt:          new Date(),
        updatedAt:         new Date(),
      }).where(eq(entitiesTable.id, id));
    }

    logger.info({ entityId: id, name }, "[Atlas] ✅ Entity fully cooked");
  } catch (err: any) {
    if (err instanceof AtlasCancelledError) throw err;
    logger.warn({ entityId: id, name, err: err.message }, "[Atlas] Full-circle enrichment failed (non-fatal)");
    // Still stamp cookedAt so we don't retry endlessly on problematic entities
    await db.update(entitiesTable).set({ cookedAt: new Date(), updatedAt: new Date() }).where(eq(entitiesTable.id, id)).catch(() => {});
  }
}

// ── Main Orchestrator ─────────────────────────────────────────────────────────

export async function runAtlasPipeline(atlasJobId: string, opts: AtlasOptions): Promise<AtlasResult> {
  const startMs = Date.now();
  const summary: Record<string, string> = {};
  let totalIngested = 0;
  let totalEnriched = 0;
  let totalContacts = 0;
  let cookedCount = 0;

  const batch = opts.batchSize ?? 200;
  const hot = opts.hotLeadsOnly ?? false;

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
    // ── Pre-run: OCCRP + OpenSky + CH Officers (cross-reference existing DB) ──
    await status("Phase 0/10: Pre-run cross-references — OCCRP + OpenSky + CH Officers…", 0);

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

    summary["Phase 0"] = `OCCRP: ${occrpRes.inserted ?? 0} | OpenSky: ${(openskyRes as any).inserted ?? 0} live | CH Officers: ${(officersRes as any).enriched ?? 0}`;

    // Identity passes: CH contact enrichment + OpenOwnership + Foundation filings
    const chEnrichJobId = await createJob("companies-house-enrich");
    await setActiveJob("companies-house-enrich", chEnrichJobId);
    const entities0 = await fetchEntities({ batchSize: 200, hotLeadsOnly: false });

    const [chRes] = await Promise.all([
      runCompaniesHouseEnrichment({ jobId: chEnrichJobId, batchSize: 50 })
        .catch(e => { logger.error({ err: e.message }, "[Atlas] CH enrichment failed"); return { enriched: 0, skipped: 0, errors: 1, durationMs: 0 }; }),
      runEntityBatch(atlasJobId, "Phase 0/OpenOwnership", entities0.slice(0, 100), async (e) => {
        const res = await enrichWithOpenOwnership(e.name, true) as any;
        if ((res.totalEntities ?? res.found ?? 0) > 0) {
          const note = `OpenOwnership BODS: ${res.totalEntities ?? res.found ?? 0} ownership record(s) found.`;
          const existing = (e as any).notes ?? "";
          await db.update(entitiesTable).set({ notes: existing ? `${existing}\n${note}` : note, updatedAt: new Date() }).where(eq(entitiesTable.id, e.id));
        }
      }, 2),
      runEntityBatch(atlasJobId, "Phase 0/FoundationFilings", entities0.filter(e => e.type === "HNWI").slice(0, 100), async (e) => {
        await discoverViaFoundationFilings(e as any);
      }, 2),
    ]);

    summary["Phase 0b"] = `CH contact: ${(chRes as any).enriched ?? 0} | OpenOwnership + Foundation filings done`;
  } else {
    summary["Phase 0"] = "Skipped (skipIngestion=true)";
  }

  // ── Discovery + Full-circle loop ─────────────────────────────────────────────
  // 21 interleaved sources: 15 broad web-search categories + 6 registry batches.
  // After each source, every new entity is immediately enriched through ALL phases
  // and stamped cookedAt — users see "cooked" entities appear progressively.
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
  let sourceRound = 0;
  const phaseJJobId = await createJob("phase-j-pass");

  for (const source of sourcesToRun) {
    await ensureAtlasActive(atlasJobId);
    sourceRound++;
    const runStart = new Date();

    try {
      await status(`[${sourceRound}/${sourcesToRun.length}] ${source.label}…`, 1);

      if (source.kind === "broad") {
        const { discoverSingleTemplate } = await import("./enrichment/broad-discovery");
        const broadRes = await discoverSingleTemplate(source.category, 10)
          .catch(e => { logger.error({ err: e.message }, "[Atlas] Broad discovery failed"); return { entitiesDiscovered: 0, queriesFired: 0, resultsScraped: 0, entitiesSkipped: 0, newEntities: [] }; });
        totalIngested += broadRes.entitiesDiscovered;
      } else {
        const hnwiJobId = await createJob("western-hnwi");
        await setActiveJob("western-hnwi", hnwiJobId);
        const hnwiRes = await runWesternHnwiIngestion({
          targetCount: opts.targetCount ?? 120,
          batchSize: 100,
          jobId: hnwiJobId,
          clearDedupFirst: (source as any).clearFirst ?? false,
        }).catch(e => { logger.error({ err: e.message }, "[Atlas] HNWI ingestion failed"); return { inserted: 0, skipped: 0, errors: 1, durationMs: 0 }; });
        await setActiveJob("western-hnwi", "");
        totalIngested += hnwiRes.inserted;

        // Optional FAA between registry batches 3 and 4
        if (includeFaa && sourceRound === 8) {
          const faaJobId = await createJob("faa");
          await setActiveJob("faa", faaJobId);
          const faaRes = await runFaaIngestion({ jobId: faaJobId, maxRecords: opts.faaMaxRecords ?? 10_000, forceRefresh: false })
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
      .limit(1000);

    logger.info({ sourceRound, label: source.label, newCount: newEntities.length }, "[Atlas] Starting full-circle enrichment");

    if (newEntities.length > 0) {
      const batchResult = await runEntityBatch(
        atlasJobId,
        `[${sourceRound}/${sourcesToRun.length}] 🍳`,
        newEntities,
        (entity) => enrichEntityFullCircle(atlasJobId, entity as EntityRow),
        3,
      );
      cookedCount += batchResult.ok;
      totalEnriched += batchResult.ok;
    }

    // Phase J attribution after each source round (processes all pending entities)
    try {
      await setActiveJob("phase-j-pass", phaseJJobId);
      await runPhaseJBatch(phaseJJobId, 50);
      await setActiveJob("phase-j-pass", "");
    } catch (e: any) {
      logger.warn({ err: e.message }, "[Atlas] Phase J round failed (non-fatal)");
    }

    summary[`Src ${sourceRound}`] = `${source.label.split("(")[0].trim()}: ${newEntities.length} → cooked`;
  }

  summary["Discovery loop"] = `${cookedCount} entities fully cooked across ${sourceRound} sources`;

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

    // Backfill contact outcomes for all entities
    await db.execute(sql`
      UPDATE entities
      SET contact_outcome = CASE
        WHEN email IS NOT NULL AND phone IS NOT NULL THEN 'direct_contact_verified'
        WHEN email IS NOT NULL THEN 'direct_contact_candidate'
        WHEN linkedin_url IS NOT NULL OR twitter_handle IS NOT NULL THEN 'social_only'
        WHEN notes IS NOT NULL AND length(notes) > 50 THEN 'evidence_only'
        ELSE 'none'
      END
      WHERE contact_outcome IS NULL
    `);

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

    // Backfill isHot for all entities — only a meaningful person-level direct
    // contact vector is a priority lead.
    // This repairs entities enriched before the isHot-stamping logic existed.
    await db.execute(sql`
      UPDATE entities
      SET is_hot = (
        (
          (email IS NOT NULL AND email !~* '^(info|contact|hello|sales|support|office|admin|press|media|enquiries|inquiries|reservations|booking|investor|ir)@')
          OR (phone IS NOT NULL AND COALESCE(phone_source, '') NOT IN ('EDGAR-Phone', 'CompaniesHouse-Phone'))
        )
        AND entity_type NOT IN ('Corporation', 'Corp', 'Trust')
      )
      WHERE is_hot IS DISTINCT FROM (
        (
          (email IS NOT NULL AND email !~* '^(info|contact|hello|sales|support|office|admin|press|media|enquiries|inquiries|reservations|booking|investor|ir)@')
          OR (phone IS NOT NULL AND COALESCE(phone_source, '') NOT IN ('EDGAR-Phone', 'CompaniesHouse-Phone'))
        )
        AND entity_type NOT IN ('Corporation', 'Corp', 'Trust')
      )
    `);

    // Recompute contact confidence for all
    const confEntities = await db.select({ id: entitiesTable.id, email: entitiesTable.email, phone: entitiesTable.phone, linkedinUrl: entitiesTable.linkedinUrl, twitterHandle: entitiesTable.twitterHandle, instagramHandle: entitiesTable.instagramHandle, telegramHandle: entitiesTable.telegramHandle, knownResidences: entitiesTable.knownResidences, contactConfidence: entitiesTable.contactConfidence }).from(entitiesTable).limit(50_000);
    for (let i = 0; i < confEntities.length; i += 1000) {
      for (const e of confEntities.slice(i, i + 1000)) {
        const c = computeContactConfidence({ email: e.email, phone: e.phone, linkedinUrl: e.linkedinUrl, twitterHandle: e.twitterHandle, instagramHandle: e.instagramHandle, telegramHandle: e.telegramHandle, knownResidences: e.knownResidences });
        if (c !== (e.contactConfidence ?? 0)) await db.update(entitiesTable).set({ contactConfidence: c }).where(eq(entitiesTable.id, e.id));
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
      const MCTS_BATCH = 5;
      for (let i = 0; i < hotEntities.length; i += MCTS_BATCH) {
        await ensureAtlasActive(atlasJobId);
        const batch5 = hotEntities.slice(i, i + MCTS_BATCH);
        await updateJob(atlasJobId, { status: "running", progress: 10, total: 10, message: `MCTS research batch ${Math.floor(i / MCTS_BATCH) + 1}/${Math.ceil(hotEntities.length / MCTS_BATCH)}…` });
        await Promise.allSettled(batch5.map(async (e) => {
          try {
            const { runResearchSession } = await import("./mcts-agent");
            await (runResearchSession as any)(e.id);
            researched++;
          } catch {}
        }));
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
