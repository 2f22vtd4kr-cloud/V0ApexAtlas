/**
 * Phase J completion layer — J4 through J9.
 *
 * J4  Employer/domain resolution (domain-resolver.ts)
 * J5  Lawful digital-footprint discovery (digital-footprint.ts)
 * J6  Multi-dimensional attribution scoring (contact-attribution.ts)
 * J7  Budgeted multi-pass scheduler with source cooldowns (enrichment_state)
 * J8  Graph-assisted contextual discovery (graphContext column)
 * J9  Source quality dashboard + re-import checkpoints
 */
import { Router, type Request, type Response } from "express";
import {
  db,
  entitiesTable,
  relationshipsTable,
  enrichmentRunsTable,
  contactEvidenceTable,
  enrichmentStateTable,
  phaseJCheckpointsTable,
  improvementLogsTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { appendJobLog, createJob, getActiveJob, setActiveJob, updateJob } from "../lib/job-queue";
import { enrichInHouse } from "../lib/enrichment/contact-enrichment";
import {
  computeContactConfidence,
  computeContactOutcome,
  isHeuristicEmailEvidence,
  isPersonalContactOutcome,
  type ContactOutcome,
} from "../lib/contact-confidence";
import {
  isValidPublicEmail,
  sanitizePublicEmail,
  sanitizePublicPhone,
  sanitizePublicSocialUrl,
  isValidPublicSocialHandle,
} from "../lib/contact-validation";
import { resolveEmployerDomain } from "../lib/domain-resolver";
import { discoverDigitalFootprint } from "../lib/digital-footprint";
import { scoreAttribution, isGenericLocalPart } from "../lib/contact-attribution";
import { logger } from "../lib/logger";
import { canonicalizeUrl } from "../lib/evidence-ledger";
import { runPersonasForEntity } from "../lib/persona-engine";

const router = Router();

async function updateAtlasTelemetry(
  mirrorJobId: string | undefined,
  telemetry: {
    stage: string;
    status: "active" | "complete" | "blocked" | "review";
    targetName?: string;
    targetType?: string;
    toolIds: string[];
    activeToolId?: string;
    inputSummary?: string;
    resultSummary?: string;
    sources?: number;
    evidence?: number;
    contacts?: number;
    personaNames?: string[];
  },
): Promise<void> {
  if (!mirrorJobId) return;
  await updateJob(mirrorJobId, { atlasTelemetry: JSON.stringify(telemetry) });
  await appendJobLog(mirrorJobId, `ATLAS_EVENT ${JSON.stringify({
    kind: "telemetry",
    stage: telemetry.stage,
    status: telemetry.status,
    targetName: telemetry.targetName,
    targetType: telemetry.targetType,
    activeToolId: telemetry.activeToolId,
    toolIds: telemetry.toolIds,
    inputSummary: telemetry.inputSummary?.slice(0, 600),
    resultSummary: telemetry.resultSummary?.slice(0, 700),
    sources: telemetry.sources,
    evidence: telemetry.evidence,
    contacts: telemetry.contacts,
    personaNames: telemetry.personaNames,
  })}`);
}

async function runAtlasPersonaReview(
  entityId: number,
): Promise<{ findings: number; personas: string[] }> {
  const [entity] = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId))
    .limit(1);
  if (!entity) return { findings: 0, personas: [] };

  const suggestions = await runPersonasForEntity(entity);
  let findings = 0;
  const personas = new Set<string>();

  for (const suggestion of suggestions) {
    const existing = await db
      .select({ id: improvementLogsTable.id })
      .from(improvementLogsTable)
      .where(sql`
        ${improvementLogsTable.entityId} = ${suggestion.entityId}
        AND ${improvementLogsTable.persona} = ${suggestion.persona}
        AND ${improvementLogsTable.title} = ${suggestion.title}
        AND ${improvementLogsTable.status} = 'pending'
      `)
      .limit(1);
    if (existing.length > 0) continue;

    await db.insert(improvementLogsTable).values({
      entityId: suggestion.entityId,
      persona: suggestion.persona,
      category: suggestion.category,
      priority: suggestion.priority,
      title: suggestion.title,
      description: suggestion.description,
      actionTaken: suggestion.actionTaken,
      status: "pending",
    });
    findings += 1;
    personas.add(suggestion.persona);
  }

  return { findings, personas: [...personas] };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

type JsonMap = Record<string, unknown>;

function parseJson<T>(val: string | null | undefined, fallback: T): T {
  try { return val ? JSON.parse(val) as T : fallback; } catch { return fallback; }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function registryOf(metadata: string | null, sourceRegistries: string | null): string {
  const meta = parseJson<JsonMap>(metadata, {});
  if (meta["nNumber"]) return "faa";
  if (meta["formType"] || meta["edgarUrl"]) return "edgar";
  if (meta["orgnr"]) return "brreg";
  if (meta["companyNumber"]) return "companies-house";
  if (meta["titleNumber"]) return "hmlr";
  const sources = parseJson<unknown[]>(sourceRegistries, []);
  return sources.length ? String(sources[0]) : "other";
}

function normalizePhone(val: string | null | undefined): string | null {
  const raw = val?.trim() ?? "";
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? raw.replace(/[^\d+\-\s().]/g, "") : null;
}

function sourceReliabilityScore(source: string): number {
  if (/^(Wikidata|EDGAR|CompaniesHouse|BRREG|ProPublica)/i.test(source)) return 0.90;
  if (/^(GLEIF|ORCID|GitHub)/i.test(source)) return 0.83;
  if (/^ContactPage/i.test(source)) return 0.79;
  if (/^(Wikipedia|Wayback)/i.test(source)) return 0.58;
  if (/^DDG/i.test(source)) return 0.52;
  if (/^GraphNeighbour/i.test(source)) return 0.65;
  return 0.42;
}

function isOrgContact(entityType: string, email: string | null, _phone: string | null): boolean {
  if (!["Corporation", "Trust"].includes(entityType)) return false;
  return isGenericLocalPart(email ?? "");
}

function correctedPersonalRunMetrics(run: {
  byEntityType?: string | null;
  directConfirmed?: number;
  directVerified?: number;
  candidateAttributed?: number;
}): {
  directConfirmed: number;
  directVerified: number;
  candidateAttributed: number;
} {
  const breakdown = parseJson<Record<string, Record<string, number>>>(run.byEntityType, {});
  const counts = Object.values(breakdown).reduce(
    (totals, outcomes) => {
      totals.candidate += Number(outcomes.direct_contact_candidate ?? 0);
      totals.verified += Number(outcomes.direct_contact_verified ?? 0);
      return totals;
    },
    { candidate: 0, verified: 0 },
  );

  // Older runs counted validated organisation routes as direct. If a
  // breakdown is present, derive the personal metrics from its outcome
  // labels; otherwise preserve the stored values for compatibility.
  if (Object.keys(breakdown).length === 0) {
    return {
      directConfirmed: Number(run.directConfirmed ?? 0),
      directVerified: Number(run.directVerified ?? 0),
      candidateAttributed: Number(run.candidateAttributed ?? 0),
    };
  }

  return {
    directConfirmed: counts.candidate + counts.verified,
    directVerified: counts.verified,
    candidateAttributed: counts.verified,
  };
}

// ── J8: graph context loader ──────────────────────────────────────────────────

interface GraphEdge { targetId: number; type: string; strength: number | null }

async function loadGraphContext(entityId: number): Promise<GraphEdge[]> {
  const rows = await db
    .select({ targetId: relationshipsTable.targetId, type: relationshipsTable.relationshipType, strength: relationshipsTable.strength })
    .from(relationshipsTable)
    .where(and(eq(relationshipsTable.sourceEntityId, entityId), eq(relationshipsTable.targetType, "Entity")))
    .orderBy(desc(relationshipsTable.strength))
    .limit(8);
  return rows;
}

/** Fetch names and domains for neighbouring entity IDs (J8 graph-assisted). */
async function loadNeighbourContext(targetIds: number[]): Promise<{ names: string[]; domains: string[] }> {
  if (!targetIds.length) return { names: [], domains: [] };
  const rows = await db
    .select({ name: entitiesTable.name, metadata: entitiesTable.metadata })
    .from(entitiesTable)
    .where(inArray(entitiesTable.id, targetIds.slice(0, 8)));
  const names: string[] = [];
  const domains: string[] = [];
  for (const row of rows) {
    names.push(row.name);
    const meta = parseJson<JsonMap>(row.metadata, {});
    const website = typeof meta["website"] === "string" ? meta["website"] : null;
    if (website) {
      try {
        const hostname = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
        if (hostname && !domains.includes(hostname)) domains.push(hostname);
      } catch { /* skip malformed */ }
    }
  }
  return { names, domains };
}

// ── Evidence persistence ──────────────────────────────────────────────────────

type PersistableContactEvidence = {
  type: string;
  value: string;
  source: string;
  sourceUrl: string | null;
  confidence: number;
  queryTemplate?: string;
  extractionMethod?: string;
  details?: Record<string, unknown>;
};

async function persistEvidence(
  entityId: number,
  runId: number,
  entityType: string,
  sources: string[],
  email: string | null,
  phone: string | null,
  linkedinUrl: string | null,
  domain: string | null,
  verified: boolean,
  footprintEvidence: PersistableContactEvidence[],
): Promise<void> {
  const rows: Array<typeof contactEvidenceTable.$inferInsert> = [];
  const corroboration = new Set(sources.map(s => s.split(/[-_]/)[0])).size;

  function baseRow(src: string, validationStatus: "verified" | "candidate", sourceUrl: string | null, extra: Record<string, unknown> = {}) {
    return {
      entityId, runId,
      source: src,
      sourceReliability: sourceReliabilityScore(src),
      // These are intentionally conservative defaults. The evidence row must
      // carry its own URL and metadata rather than inheriting a score from the
      // merged winner or from provider repetition.
      identityMatch: 0.50,
      recencyScore: 0.50,
      independentCorroboration: corroboration,
      validationStatus,
      sourceUrl,
      metadata: JSON.stringify({ sources, entityType, ...extra }),
    };
  }

  function addContactVector(vectorType: string, value: string | null, fallbackSource: string): void {
    if (!value) return;
    const matches = footprintEvidence.filter((e) =>
      e.type === vectorType && e.value.trim().toLowerCase() === value.trim().toLowerCase(),
    );
    const unique = new Set<string>();
    for (const evidence of matches) {
      const sourceUrl = canonicalizeUrl(evidence.sourceUrl);
      const key = `${evidence.source}|${sourceUrl ?? ""}`;
      if (unique.has(key)) continue;
      unique.add(key);
      const validationStatus = verified ? "verified" : "candidate";
      rows.push({
        ...baseRow(evidence.source, validationStatus, sourceUrl, {
          queryTemplate: evidence.queryTemplate ?? null,
          evidenceDetails: evidence.details ?? null,
        }),
        vectorType,
        value,
        directnessScore: verified ? Math.min(0.95, evidence.confidence) : Math.min(0.75, evidence.confidence),
        extractionMethod: evidence.extractionMethod ?? "public-source-parser",
      });
    }
    if (!matches.length) {
      rows.push({
        ...baseRow(fallbackSource, "candidate", null, {
          provenance: "merged-result-without-source-row",
        }),
        vectorType,
        value,
        directnessScore: 0.25,
        extractionMethod: "merged-result-without-source-row",
      });
    }
  }

  addContactVector("email", email, sources[0] ?? "phase-j");
  addContactVector("phone", phone, sources[0] ?? "phase-j");
  if (linkedinUrl) rows.push({
    ...baseRow("LinkedIn", "candidate", canonicalizeUrl(linkedinUrl), { vector: "social" }),
    vectorType: "social", value: linkedinUrl, directnessScore: 0.20,
    extractionMethod: "public-profile-discovery",
  });
  if (domain) rows.push({
    ...baseRow("domain-resolver", "candidate", canonicalizeUrl(`https://${domain}`), { vector: "domain" }),
    vectorType: "domain", value: domain, directnessScore: 0.10,
    extractionMethod: "J4-domain-resolution",
  });

  // Add footprint evidence rows (J5)
  for (const fe of footprintEvidence.slice(0, 20)) {
    if (["email", "phone", "linkedin"].includes(fe.type) && fe.value && !["email", "phone"].includes(fe.type)) {
      rows.push({
        entityId, runId,
        source: fe.source,
        vectorType: fe.type === "linkedin" ? "social" : fe.type,
        value: fe.value,
        sourceUrl: canonicalizeUrl(fe.sourceUrl),
        sourceReliability: sourceReliabilityScore(fe.source),
        identityMatch: 0.50,
        recencyScore: 0.50,
        directnessScore: fe.confidence,
        independentCorroboration: 1,
        validationStatus: "candidate",
        extractionMethod: fe.extractionMethod ?? `J5-${fe.queryTemplate ?? "discovery"}`,
        metadata: JSON.stringify({ queryTemplate: fe.queryTemplate ?? null, entityType, details: fe.details ?? null }),
      });
    }
  }

  if (rows.length) {
    await db.insert(contactEvidenceTable).values(rows).onConflictDoNothing();
  }
}

// ── J7: source-cooldown helpers ───────────────────────────────────────────────

function mergeCooldowns(existing: Record<string, string>, updates: Record<string, string>): Record<string, string> {
  const merged = { ...existing };
  for (const [src, ts] of Object.entries(updates)) {
    const existingTs = merged[src];
    // Keep the further-future cooldown
    if (!existingTs || new Date(ts) > new Date(existingTs)) {
      merged[src] = ts;
    }
  }
  return merged;
}

// ── Core pass runner ──────────────────────────────────────────────────────────

type PassEntity = {
  id: number; name: string; type: string;
  nationality: string | null; sourceRegistries: string | null;
  knownResidences: string | null; metadata: string | null;
  notes: string | null; email: string | null; phone: string | null;
  linkedinUrl: string | null; twitterHandle: string | null;
  instagramHandle: string | null; telegramHandle: string | null;
  passNumber: number;
  sourceCooldowns: string | null;
  savedGraphContext: string | null;
};

export type { PassEntity };

export async function runPhaseJBatch(
  jobId: string,
  batchSize: number,
  mirrorJobId?: string,
  targetEntityIds?: number[],
): Promise<{ ran: number; message: string }> {
  const targetFilter = targetEntityIds?.length
    ? inArray(entitiesTable.id, targetEntityIds)
    : sql`TRUE`;
  const dueFilter = targetEntityIds?.length
    ? sql`TRUE`
    : sql`(
      ${enrichmentStateTable.nextAttemptAt} IS NULL
      OR ${enrichmentStateTable.nextAttemptAt} <= NOW()
    )`;
  const entities = await db
    .select({
      id: entitiesTable.id, name: entitiesTable.name, type: entitiesTable.type,
      nationality: entitiesTable.nationality, sourceRegistries: entitiesTable.sourceRegistries,
      knownResidences: entitiesTable.knownResidences, metadata: entitiesTable.metadata,
      notes: entitiesTable.notes, email: entitiesTable.email, phone: entitiesTable.phone,
      linkedinUrl: entitiesTable.linkedinUrl, twitterHandle: entitiesTable.twitterHandle,
      instagramHandle: entitiesTable.instagramHandle, telegramHandle: entitiesTable.telegramHandle,
      passNumber: sql<number>`COALESCE(${enrichmentStateTable.passNumber}, 0)`,
      sourceCooldowns: enrichmentStateTable.sourceCooldowns,
      savedGraphContext: enrichmentStateTable.graphContext,
    })
    .from(entitiesTable)
    .leftJoin(enrichmentStateTable, eq(enrichmentStateTable.entityId, entitiesTable.id))
    .where(sql`
      ${targetFilter} AND
      ${entitiesTable.type} IN ('HNWI', 'Gatekeeper', 'Corporation', 'Trust')
      AND COALESCE(${entitiesTable.contactOutcome}, 'none') <> 'direct_contact_verified'
      AND ${dueFilter}
    `)
    .orderBy(desc(entitiesTable.isHot), desc(entitiesTable.bayesianScore))
    .limit(batchSize);

  if (!entities.length) return { ran: 0, message: "No Phase J candidates due." };

  const run = await db.insert(enrichmentRunsTable).values({
    source: "phase-j", pass: "J4-J9", cohort: "atlas-run",
    totalSelected: entities.length,
  }).returning({ id: enrichmentRunsTable.id });
  const runId = run[0]!.id;

  await runPhaseJPass(jobId, runId, entities as PassEntity[], mirrorJobId);
  return { ran: entities.length, message: `Phase J complete — ${entities.length} entities processed.` };
}

async function runPhaseJPass(
  jobId: string,
  runId: number,
  entities: PassEntity[],
  mirrorJobId?: string,
): Promise<void> {
  const totals = {
    found: 0, persisted: 0, direct: 0, verified: 0, social: 0,
    evidence: 0, organization: 0, errors: 0, domains: 0,
    validated: 0, attributed: 0, identity: 0,
  };
  const byRegistry: Record<string, Record<string, number>> = {};
  const byEntityType: Record<string, Record<string, number>> = {};
  const started = Date.now();

  for (let idx = 0; idx < entities.length; idx++) {
    const entity = entities[idx]!;
    try {
      await updateJob(jobId, {
        status: "running", progress: idx, total: entities.length,
        inserted: totals.persisted, errors: totals.errors,
        message: `J4-J9 pass ${entity.passNumber + 1}: ${entity.name}`,
      });
      if (mirrorJobId) {
        await updateJob(mirrorJobId, {
          status: "running",
          progress: 8,
          total: 10,
          inserted: totals.persisted,
          errors: totals.errors,
          atlasPhase: 8,
          atlasPhaseTotal: 10,
          message: `Phase 8/10: J4-J9 pass ${idx + 1}/${entities.length}: ${entity.name}`,
          entityProgress: idx,
          entityTotal: entities.length,
          entityNames: JSON.stringify([entity.name]),
        });
        await updateAtlasTelemetry(mirrorJobId, {
          stage: "PHASE J ATTRIBUTION",
          status: "active",
          targetName: entity.name,
          targetType: entity.type,
          toolIds: ["domain-resolver", "digital-footprint", "contact-attribution", "graph", "source-cooldowns"],
          activeToolId: "domain-resolver",
          inputSummary: `J4–J9 attribution pass ${idx + 1}/${entities.length} · one target at a time`,
        });
      }

      const meta = parseJson<JsonMap>(entity.metadata, {});
      const cooldowns = parseJson<Record<string, string>>(entity.sourceCooldowns, {});

      // ── J4: Employer / Domain Resolution ──────────────────────────────────
      const domainInfo = await withTimeout(
        resolveEmployerDomain({
          name: entity.name,
          type: entity.type,
          metadata: entity.metadata,
          notes: entity.notes,
          sourceRegistries: entity.sourceRegistries,
        }),
        20_000,
        `J4 domain resolution for ${entity.name}`,
      );
      if (domainInfo.domain) totals.domains += 1;
      await updateAtlasTelemetry(mirrorJobId, {
        stage: "PHASE J · J4 DOMAIN RESOLUTION",
        status: "active",
        targetName: entity.name,
        targetType: entity.type,
        toolIds: ["domain-resolver", "digital-footprint", "contact-attribution", "graph", "source-cooldowns"],
        activeToolId: "digital-footprint",
        inputSummary: domainInfo.domain
          ? `Resolved domain ${domainInfo.domain} · confidence ${(domainInfo.confidence * 100).toFixed(0)}%`
          : "No employer domain resolved yet; continuing with public evidence and graph context",
      });

      // ── J8: Load graph neighbours for contextual query enrichment ─────────
      const savedEdges = parseJson<GraphEdge[]>(entity.savedGraphContext, []);
      // If graph context is stale/empty, reload from DB
      const graphEdges = savedEdges.length > 0 ? savedEdges : await loadGraphContext(entity.id);
      const neighbourIds = graphEdges.map(e => e.targetId);
      const { names: neighbourNames, domains: neighbourDomains } = await loadNeighbourContext(neighbourIds);

      // ── Baseline: existing in-house enrichment ────────────────────────────
      const inHouseResult = await withTimeout(
        enrichInHouse({
          ...entity,
          bizLocation: typeof meta["bizLocation"] === "string" ? meta["bizLocation"] : null,
          entityName: typeof meta["entityName"] === "string" ? meta["entityName"] : null,
        }),
        90_000,
        `J4-J5 in-house enrichment for ${entity.name}`,
      );

      // ── J5: Digital-Footprint Discovery ───────────────────────────────────
      const employer =
        typeof meta["entityName"] === "string" && meta["entityName"] ? meta["entityName"] :
        typeof meta["companyName"] === "string" && meta["companyName"] ? meta["companyName"] :
        ["Corporation", "Trust"].includes(entity.type) ? entity.name : null;

      const role =
        typeof meta["role"] === "string" ? meta["role"] :
        typeof meta["title"] === "string" ? meta["title"] : null;

      const footprint = await withTimeout(
        discoverDigitalFootprint(
          {
            name: entity.name,
            type: entity.type,
            nationality: entity.nationality,
            bizLocation: typeof meta["bizLocation"] === "string" ? meta["bizLocation"] : null,
            employer,
            role,
            graphNeighbourDomains: neighbourDomains,
            graphNeighbourNames: neighbourNames,
          },
          domainInfo.domain,
          domainInfo.officialContactPaths,
          cooldowns,
        ),
        90_000,
        `J5 digital footprint for ${entity.name}`,
      );
      await updateAtlasTelemetry(mirrorJobId, {
        stage: "PHASE J · J5 DIGITAL FOOTPRINT",
        status: "active",
        targetName: entity.name,
        targetType: entity.type,
        toolIds: ["domain-resolver", "digital-footprint", "contact-attribution", "graph", "source-cooldowns"],
        activeToolId: "contact-attribution",
        inputSummary: `${footprint.queriesRun} public footprint queries · ${footprint.evidence.length} evidence candidates`,
        sources: footprint.queriesRun,
        evidence: footprint.evidence.length,
      });

      // ── Merge results: in-house + footprint ───────────────────────────────
      const mergedSources = [...inHouseResult.sources];
      for (const ev of footprint.evidence) {
        if (!mergedSources.includes(ev.source)) mergedSources.push(ev.source);
      }

      // Best email: prefer in-house (structured sources) over footprint
      let bestEmail = sanitizePublicEmail(inHouseResult.email ?? entity.email);
      if (!bestEmail) {
        // Fall back to highest-confidence footprint email
        const footprintEmails = footprint.evidence
          .filter(e => e.type === "email")
          .sort((a, b) => b.confidence - a.confidence);
        bestEmail = footprintEmails.length ? sanitizePublicEmail(footprintEmails[0]!.value) : null;
      }

      const bestPhone = sanitizePublicPhone(
        inHouseResult.phone ?? entity.phone ??
        footprint.evidence.find(e => e.type === "phone")?.value,
      );

      const bestLinkedIn =
        sanitizePublicSocialUrl(
          inHouseResult.linkedinUrl ?? entity.linkedinUrl ??
          footprint.evidence.find(e => e.type === "linkedin")?.value ?? null,
          "linkedin",
          "person",
        );
      const bestTwitter = isValidPublicSocialHandle(inHouseResult.twitter, "twitter")
        ? inHouseResult.twitter!.replace(/^@/, "")
        : entity.twitterHandle;

      // ── J6: Multi-Dimensional Attribution Scoring ──────────────────────────
      const validEmail = Boolean(bestEmail && isValidPublicEmail(bestEmail));
      const validPhone = Boolean(bestPhone);
      const heuristicEmail = isHeuristicEmailEvidence({
        email: bestEmail,
        emailSource: inHouseResult.emailSource,
        metadata: {
          ...meta,
          enrichmentSources: mergedSources,
          sourceHits: inHouseResult.sourceHits,
        },
      });
      const activeEmail = heuristicEmail ? null : bestEmail;
      const attribution = scoreAttribution({
        email: activeEmail,
        phone: bestPhone,
        sources: mergedSources,
        entityType: entity.type,
        resolvedDomain: domainInfo.domain,
        isValidEmail: Boolean(activeEmail && isValidPublicEmail(activeEmail)),
        isValidPhone: validPhone,
      // A search hit, domain match, SMTP result, or provider repetition is not
      // an identity claim. Verification requires both an exact fetched claim
      // URL and explicit target-person attribution.
      exactClaimObserved: false,
      targetPersonEvidence: false,
      });
      await updateAtlasTelemetry(mirrorJobId, {
        stage: "PHASE J · J6 ATTRIBUTION",
        status: "active",
        targetName: entity.name,
        targetType: entity.type,
        toolIds: ["domain-resolver", "digital-footprint", "contact-attribution", "graph", "source-cooldowns"],
        activeToolId: "graph",
        inputSummary: `${mergedSources.length} evidence sources · ${neighbourNames.length} graph neighbours · attribution score ${(attribution.score * 100).toFixed(0)}/100`,
        sources: mergedSources.length,
        evidence: footprint.evidence.length + inHouseResult.evidence.length,
        contacts: [activeEmail, bestPhone, bestLinkedIn, bestTwitter].filter(Boolean).length,
      });

      // Determine outcome
      const orgContact = isOrgContact(entity.type, bestEmail, bestPhone);
      const outcome: ContactOutcome = orgContact
        ? "organization_contact"
        : computeContactOutcome({
          email: activeEmail,
          phone: bestPhone,
          phoneSource: inHouseResult.phoneSource ?? (meta["phoneSource"] as string | null | undefined),
          linkedinUrl: bestLinkedIn,
          twitterHandle: inHouseResult.twitter ?? entity.twitterHandle,
          instagramHandle: entity.instagramHandle,
          telegramHandle: entity.telegramHandle,
          website: inHouseResult.website ?? (meta["website"] as string | null | undefined),
          bizLocation: inHouseResult.address ?? (meta["bizLocation"] as string | null | undefined),
          validatedDirectContact: attribution.attributed,
          metadata: {
            ...meta,
            ...(inHouseResult.phoneSource ? { phoneSource: inHouseResult.phoneSource } : {}),
            ...(inHouseResult.emailSource ? { emailSource: inHouseResult.emailSource } : {}),
            phaseJ: {
              ...(typeof meta.phaseJ === "object" && meta.phaseJ ? meta.phaseJ : {}),
              J6attributed: attribution.attributed,
            },
          },
        });

       // ── Track totals ───────────────────────────────────────────────────────
       // Validated evidence and personal direct reachability are separate
       // measurements. Organization inboxes/switchboards may be structurally
       // valid and even attribution-scored, but must never inflate the
       // personal direct-contact counters.
       const personalOutcome = isPersonalContactOutcome(outcome);
      if (inHouseResult.email || inHouseResult.phone || inHouseResult.linkedinUrl || footprint.evidence.length > 0) totals.found += 1;
       if (personalOutcome) totals.direct += 1;
       if (outcome === "direct_contact_verified") totals.verified += 1;
       if (attribution.attributed && personalOutcome) totals.attributed += 1;
      if (validEmail || validPhone) totals.validated += 1;
      if (outcome === "social_only") totals.social += 1;
      if (outcome === "evidence_only") totals.evidence += 1;
      if (outcome === "organization_contact") totals.organization += 1;
      if (mergedSources.some(s => /^(Wikidata|EDGAR|CompaniesHouse|BRREG)/i.test(s))) totals.identity += 1;

      const registry = registryOf(entity.metadata, entity.sourceRegistries);
      for (const bucket of [byRegistry[registry] ?? (byRegistry[registry] = {}), byEntityType[entity.type] ?? (byEntityType[entity.type] = {})]) {
        bucket[outcome] = (bucket[outcome] ?? 0) + 1;
      }

      // ── Write entity updates ───────────────────────────────────────────────
      const nextMeta: JsonMap = {
        ...meta,
        ...(inHouseResult.phoneSource ? { phoneSource: inHouseResult.phoneSource } : {}),
        contactOutcome: outcome,
        phaseJ: {
          pass: "J4-J9",
          J4domain: domainInfo.domain,
          J4domainConfidence: domainInfo.confidence,
          J4mxVerified: domainInfo.mxVerified,
          J5queriesRun: footprint.queriesRun,
          J5evidenceCount: footprint.evidence.length,
          J6attributed: attribution.attributed,
          J6score: attribution.score,
          J6explanation: attribution.explanation,
          J8neighboursUsed: neighbourNames.length,
          sources: mergedSources,
          observedAt: new Date().toISOString(),
        },
      };

      const entityUpdates: Record<string, unknown> = {
        contactConfidence: computeContactConfidence({
          type: entity.type,
          email: activeEmail ?? (heuristicEmail ? null : entity.email),
          phone: bestPhone ?? entity.phone,
          phoneSource: inHouseResult.phoneSource ?? (meta["phoneSource"] as string | null | undefined),
          linkedinUrl: bestLinkedIn,
          twitterHandle: bestTwitter,
          instagramHandle: entity.instagramHandle,
          telegramHandle: entity.telegramHandle,
          knownResidences: entity.knownResidences,
        }),
        contactOutcome: outcome,
        metadata: JSON.stringify(nextMeta),
        updatedAt: new Date(),
      };
       if (activeEmail && !entity.email) entityUpdates.email = activeEmail;
      if (bestPhone && !entity.phone) entityUpdates.phone = bestPhone;
      if (bestLinkedIn && !entity.linkedinUrl) entityUpdates.linkedinUrl = bestLinkedIn;
      if (bestTwitter && !entity.twitterHandle) entityUpdates.twitterHandle = bestTwitter;

      await db.update(entitiesTable).set(entityUpdates as any).where(eq(entitiesTable.id, entity.id));

      // ── Persist evidence rows ──────────────────────────────────────────────
      await persistEvidence(
        entity.id, runId, entity.type, mergedSources,
        bestEmail, bestPhone, bestLinkedIn,
        domainInfo.domain, attribution.attributed,
        [
          ...inHouseResult.evidence.map((e) => ({
            type: e.vectorType,
            value: e.value,
            source: e.source,
            sourceUrl: e.sourceUrl,
            confidence: e.confidence / 100,
            extractionMethod: e.extractionMethod,
            details: e.details,
          })),
          ...footprint.evidence,
        ],
      );

      // ── J7: Update enrichment state + source cooldowns ─────────────────────
      const updatedCooldowns = mergeCooldowns(cooldowns, footprint.cooldownUpdates);
      const retry = attribution.attributed
        ? null
        : new Date(Date.now() + (outcome === "social_only" ? 24 : 72) * 60 * 60 * 1_000);

      await db.insert(enrichmentStateTable).values({
        entityId: entity.id,
        passNumber: entity.passNumber + 1,
        attempts: 1,
        successfulPasses: (bestEmail || bestPhone) ? 1 : 0,
        lastPass: "J4-J9",
        lastSource: mergedSources.join(",").slice(0, 500) || "phase-j",
        lastOutcome: outcome,
        lastAttemptAt: new Date(),
        nextAttemptAt: retry,
        retryReason: attribution.attributed ? null : `J6-score:${attribution.score.toFixed(2)}`,
        sourceCooldowns: JSON.stringify(updatedCooldowns),
        graphContext: JSON.stringify(graphEdges),
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: enrichmentStateTable.entityId,
        set: {
          passNumber: sql`${enrichmentStateTable.passNumber} + 1`,
          attempts: sql`${enrichmentStateTable.attempts} + 1`,
          successfulPasses: sql`${enrichmentStateTable.successfulPasses} + ${(bestEmail || bestPhone) ? 1 : 0}`,
          lastPass: "J4-J9",
          lastSource: mergedSources.join(",").slice(0, 500) || "phase-j",
          lastOutcome: outcome,
          lastAttemptAt: new Date(),
          nextAttemptAt: retry,
          retryReason: attribution.attributed ? null : `J6-score:${attribution.score.toFixed(2)}`,
          sourceCooldowns: JSON.stringify(updatedCooldowns),
          graphContext: JSON.stringify(graphEdges),
          updatedAt: new Date(),
        },
      });

      totals.persisted += 1;
      await updateAtlasTelemetry(mirrorJobId, {
        stage: "PHASE J · PERSONA REVIEW",
        status: "active",
        targetName: entity.name,
        targetType: entity.type,
        toolIds: [
          "domain-resolver", "digital-footprint", "contact-attribution", "graph",
          "source-cooldowns", "persona-review",
        ],
        activeToolId: "persona-review",
        inputSummary: "11 deterministic personas reviewing the persisted Phase J checkpoint",
        sources: mergedSources.length,
        evidence: footprint.evidence.length + inHouseResult.evidence.length,
        contacts: [activeEmail, bestPhone, bestLinkedIn, bestTwitter].filter(Boolean).length,
      });

      let personaReview: { findings: number; personas: string[] } = { findings: 0, personas: [] };
      try {
        personaReview = await withTimeout(
          runAtlasPersonaReview(entity.id),
          30_000,
          `J persona review for ${entity.name}`,
        );
      } catch (reviewError) {
        logger.warn(
          { entityId: entity.id, err: reviewError instanceof Error ? reviewError.message : String(reviewError) },
          "Atlas persona review failed after Phase J checkpoint",
        );
      }

      await updateAtlasTelemetry(mirrorJobId, {
        stage: "PHASE J · PERSONA REVIEW",
        status: personaReview.findings > 0 ? "review" : "complete",
        targetName: entity.name,
        targetType: entity.type,
        toolIds: [
          "domain-resolver", "digital-footprint", "contact-attribution", "graph",
          "source-cooldowns", "persona-review",
        ],
        activeToolId: "persona-review",
        resultSummary:
          `${outcome.replace(/_/g, " ")} · ${personaReview.findings} new review finding(s) from ` +
          `${personaReview.personas.length || "0"} persona(s)`,
        personaNames: personaReview.personas,
        sources: mergedSources.length,
        evidence: footprint.evidence.length + inHouseResult.evidence.length,
        contacts: [activeEmail, bestPhone, bestLinkedIn, bestTwitter].filter(Boolean).length,
      });
    } catch (err) {
      totals.errors += 1;
      logger.warn({ entityId: entity.id, err: err instanceof Error ? err.message : String(err) }, "Phase J entity failed");
    }
  }

  await db.update(enrichmentRunsTable).set({
    finishedAt: new Date(),
    totalFound: totals.found,
    totalPersisted: totals.persisted,
    directConfirmed: totals.direct,
    directVerified: totals.verified,
    identityResolved: totals.identity,
    domainResolved: totals.domains,
    candidateValidated: totals.validated,
    candidateAttributed: totals.attributed,
    socialOnly: totals.social,
    evidenceOnly: totals.evidence,
    organizationContact: totals.organization,
    errors: totals.errors,
    byRegistry: JSON.stringify(byRegistry),
    byEntityType: JSON.stringify(byEntityType),
    durationMs: Date.now() - started,
    notes: "J4 domain resolution · J5 digital-footprint discovery · J6 multi-dim attribution · J7 source cooldowns · J8 graph-assisted · J9 checkpoint-ready",
  }).where(eq(enrichmentRunsTable.id, runId));

  await updateJob(jobId, {
    status: "done",
    progress: entities.length, total: entities.length,
    inserted: totals.persisted, errors: totals.errors,
    finishedAt: new Date().toISOString(),
     message: `Phase J complete — ${totals.verified} direct verified, ${totals.direct} personal direct candidates, ${totals.validated} validated vectors, ${totals.organization} organization contacts, ${totals.domains} domains resolved.`,
  });
  if (mirrorJobId) {
    await updateJob(mirrorJobId, {
      status: "running",
      progress: 8,
      total: 10,
      inserted: totals.persisted,
      errors: totals.errors,
      atlasPhase: 8,
      atlasPhaseTotal: 10,
      message: `Phase 8/10: Phase J complete — ${totals.verified} direct verified, ${totals.direct} personal direct candidates, ${totals.validated} validated vectors.`,
      entityProgress: entities.length,
      entityTotal: entities.length,
      entityNames: JSON.stringify(entities.slice(-1).map((entity) => entity.name)),
    });
    await updateAtlasTelemetry(mirrorJobId, {
      stage: "PHASE J COMPLETE",
      status: "complete",
      targetName: entities.at(-1)?.name,
      targetType: entities.at(-1)?.type,
      toolIds: ["domain-resolver", "digital-footprint", "contact-attribution", "graph", "source-cooldowns"],
      activeToolId: "source-cooldowns",
      resultSummary: `${totals.verified} direct verified · ${totals.direct} personal direct candidates · ${totals.validated} validated vectors · ${totals.organization} organization contacts · ${totals.domains} domains resolved`,
      sources: Object.keys(byRegistry).length,
      evidence: totals.evidence,
      contacts: totals.direct,
    });
  }
  await setActiveJob("phase-j-pass", "");
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /pipeline/phase-j/status
 * Returns implementation status and current funnel metrics.
 */
router.get("/pipeline/phase-j/status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [latestRun, latestCheckpoint, stateCounts, evidenceCounts] = await Promise.all([
      db.select().from(enrichmentRunsTable)
        .where(sql`${enrichmentRunsTable.source} = 'phase-j'`)
        .orderBy(desc(enrichmentRunsTable.id)).limit(1),
      db.select().from(phaseJCheckpointsTable).orderBy(desc(phaseJCheckpointsTable.id)).limit(1),
      db.execute(sql`
        SELECT COALESCE(last_outcome, 'never_attempted') AS outcome, COUNT(*)::int AS count
        FROM enrichment_state GROUP BY last_outcome ORDER BY count DESC
      `),
      db.execute(sql`
        SELECT validation_status, vector_type, COUNT(*)::int AS count
        FROM contact_evidence
        GROUP BY validation_status, vector_type
        ORDER BY validation_status, vector_type
      `),
    ]);
    const storedLatestRun = latestRun[0] ?? null;
    const latestRunMetrics = storedLatestRun ? correctedPersonalRunMetrics(storedLatestRun) : null;
    const reportedLatestRun = storedLatestRun && latestRunMetrics
      ? { ...storedLatestRun, ...latestRunMetrics }
      : storedLatestRun;

    res.json({
      phase: "J",
      // J4-J9 are now truly implemented (not stubs)
      implementation: {
        J0: true,  // measurement contract
        J1: true,  // non-terminal social state
        J2: true,  // western registry coverage matrix
        J3: true,  // identity bundles + multi-candidate resolution
        J4: true,  // employer/domain resolution (domain-resolver.ts)
        J5: true,  // lawful digital-footprint discovery (digital-footprint.ts)
        J6: true,  // multi-dimensional attribution scoring (contact-attribution.ts)
        J7: true,  // budgeted multi-pass scheduler with source cooldowns
        J8: true,  // graph-assisted contextual discovery
        J9: true,  // source quality dashboard + re-import checkpoints
      },
      modules: {
        J4: "domain-resolver.ts — GLEIF, metadata, DNS MX + SPF",
        J5: "digital-footprint.ts — DDG query templates, contact-page scraper, graph-neighbour scraping",
        J6: "contact-attribution.ts — 5-dimension geometric-mean score, threshold 0.52",
        J7: "enrichment_state.source_cooldowns — per-source ISO timestamps, budgeted batch selection",
        J8: "graph-context — neighbour names/domains used as J5 query context",
        J9: "phase_j_checkpoints + /pipeline/phase-j/source-quality endpoint",
      },
      latestRun: reportedLatestRun,
      metricSemantics: {
        directConfirmed: "person-level direct candidate or verified outcome",
        directVerified: "person-level direct_contact_verified outcome",
        candidateValidated: "validated contact vectors, including organization routes",
        candidateAttributed: "person-level routes passing attribution",
        organizationContact: "validated organization inboxes, switchboards, or company routes",
      },
      latestCheckpoint: latestCheckpoint[0] ?? null,
      stateCounts: stateCounts.rows,
      evidenceCounts: evidenceCounts.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Phase J status unavailable" });
  }
});

/**
 * POST /ingest/phase-j-pass
 * Starts a Phase J pass (J4-J9) over due candidates.
 *
 * Body: { batchSize?: number (1-100, default 25), pass?: string }
 */
router.post("/ingest/phase-j-pass", async (req: Request, res: Response): Promise<void> => {
  const existing = await getActiveJob("phase-j-pass");
  if (existing) {
    res.status(409).json({ error: "A Phase J pass is already running.", jobId: existing });
    return;
  }

  const requested = Math.min(Math.max(Number(req.body?.batchSize) || 25, 1), 100);
  const pass = String(req.body?.pass ?? "J4-J9");
  const jobId = await createJob("phase-j-pass");

  // ── J7: Select due candidates (respects nextAttemptAt cooldown) ──────────
  const entities = await db
    .select({
      id: entitiesTable.id, name: entitiesTable.name, type: entitiesTable.type,
      nationality: entitiesTable.nationality, sourceRegistries: entitiesTable.sourceRegistries,
      knownResidences: entitiesTable.knownResidences, metadata: entitiesTable.metadata,
      notes: entitiesTable.notes, email: entitiesTable.email, phone: entitiesTable.phone,
      linkedinUrl: entitiesTable.linkedinUrl, twitterHandle: entitiesTable.twitterHandle,
      instagramHandle: entitiesTable.instagramHandle, telegramHandle: entitiesTable.telegramHandle,
      passNumber: sql<number>`COALESCE(${enrichmentStateTable.passNumber}, 0)`,
      sourceCooldowns: enrichmentStateTable.sourceCooldowns,
      savedGraphContext: enrichmentStateTable.graphContext,
    })
    .from(entitiesTable)
    .leftJoin(enrichmentStateTable, eq(enrichmentStateTable.entityId, entitiesTable.id))
    .where(sql`
      ${entitiesTable.type} IN ('HNWI', 'Gatekeeper', 'Corporation', 'Trust')
      AND COALESCE(${entitiesTable.contactOutcome}, 'none') <> 'direct_contact_verified'
      AND (
        ${enrichmentStateTable.nextAttemptAt} IS NULL
        OR ${enrichmentStateTable.nextAttemptAt} <= NOW()
      )
    `)
    .orderBy(desc(entitiesTable.isHot), desc(entitiesTable.bayesianScore))
    .limit(requested);

  if (!entities.length) {
    res.json({ jobId: null, total: 0, message: "No Phase J candidates are currently due." });
    return;
  }

  const run = await db.insert(enrichmentRunsTable).values({
    source: "phase-j", pass, cohort: "due-candidates",
    totalSelected: entities.length,
  }).returning({ id: enrichmentRunsTable.id });
  const runId = run[0]!.id;

  await setActiveJob("phase-j-pass", jobId);
  await updateJob(jobId, { status: "queued", total: entities.length, message: `Phase J ${pass} pass queued — ${entities.length} candidates.` });

  void runPhaseJPass(jobId, runId, entities as PassEntity[]).catch(async (err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "Phase J pass crashed");
    await db.update(enrichmentRunsTable)
      .set({ finishedAt: new Date(), errors: entities.length, notes: "Pass crashed before completion." })
      .where(eq(enrichmentRunsTable.id, runId));
    await updateJob(jobId, { status: "failed", message: err instanceof Error ? err.message : "Phase J pass failed" });
    await setActiveJob("phase-j-pass", "");
  });

  res.status(202).json({ jobId, runId, total: entities.length, pass, pollUrl: `/api/ingest/job/${jobId}` });
});

/**
 * POST /pipeline/phase-j/checkpoint
 * Saves a re-import snapshot of the current Phase J funnel (J9).
 */
router.post("/pipeline/phase-j/checkpoint", async (req: Request, res: Response): Promise<void> => {
  const name = String(req.body?.name ?? `phase-j-${new Date().toISOString()}`);
  const [outcomeCounts, regBreakdown, typBreakdown] = await Promise.all([
    db.execute(sql`SELECT COALESCE(contact_outcome, 'none') AS outcome, COUNT(*)::int AS count FROM entities GROUP BY contact_outcome`),
    db.execute(sql`
      SELECT COALESCE(last_outcome, 'none') AS outcome,
             SUBSTRING(last_source, 1, 30) AS source_family,
             COUNT(*)::int AS count
      FROM enrichment_state GROUP BY outcome, source_family LIMIT 40
    `),
    db.execute(sql`
      SELECT e.type, COALESCE(e.contact_outcome, 'none') AS outcome, COUNT(*)::int AS count
      FROM entities e GROUP BY e.type, outcome
    `),
  ]);

  const counts: Record<string, number> = {};
  for (const row of outcomeCounts.rows as Array<{ outcome: string; count: number }>) {
    counts[row.outcome] = Number(row.count);
  }
  const total = Object.values(counts).reduce((s, v) => s + v, 0);

  const checkpoint = await db.insert(phaseJCheckpointsTable).values({
    name,
    totalEntities: total,
    directCandidate: counts.direct_contact_candidate ?? 0,
    directVerified: counts.direct_contact_verified ?? 0,
    socialOnly: counts.social_only ?? 0,
    organizationContact: counts.organization_contact ?? 0,
    evidenceOnly: counts.evidence_only ?? 0,
    noneCount: counts.none ?? 0,
    byRegistry: JSON.stringify(regBreakdown.rows),
    byEntityType: JSON.stringify(typBreakdown.rows),
    notes: "J9 re-import checkpoint — direct/social/org/evidence outcomes by registry and entity type.",
  }).returning();

  res.status(201).json(checkpoint[0]);
});

/**
 * GET /pipeline/phase-j/source-quality
 * J9 source quality dashboard — per-source success rates and verified yield.
 */
router.get("/pipeline/phase-j/source-quality", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [bySource, recentRuns, outcomeSummary] = await Promise.all([
      db.execute(sql`
        SELECT
          source,
          COUNT(*)::int                                                            AS total_evidence,
          COUNT(*) FILTER (WHERE validation_status = 'verified')::int             AS verified_count,
          COUNT(*) FILTER (WHERE validation_status = 'candidate')::int            AS candidate_count,
          COUNT(*) FILTER (WHERE validation_status = 'rejected')::int             AS rejected_count,
          ROUND(AVG(source_reliability)::numeric, 3)::float                       AS avg_reliability,
          ROUND(AVG(directness_score)::numeric, 3)::float                         AS avg_directness,
          ROUND(AVG(independent_corroboration)::numeric, 2)::float                AS avg_corroboration,
          COUNT(DISTINCT entity_id)::int                                          AS entities_covered,
          COUNT(DISTINCT vector_type)::int                                        AS vector_types
        FROM contact_evidence
        GROUP BY source
        ORDER BY verified_count DESC, total_evidence DESC
        LIMIT 30
      `),
      db.execute(sql`
        SELECT id, source, pass, total_selected, total_found, total_persisted,
               direct_confirmed, direct_verified, domain_resolved, candidate_attributed,
               social_only, evidence_only, errors, duration_ms, finished_at
        FROM enrichment_runs
        WHERE source = 'phase-j'
        ORDER BY id DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT
          COALESCE(contact_outcome, 'none')                            AS outcome,
          COUNT(*)::int                                                AS count,
          ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1)::float AS pct
        FROM entities
        GROUP BY contact_outcome
        ORDER BY count DESC
      `),
    ]);

    res.json({
      bySource: bySource.rows,
      recentRuns: recentRuns.rows,
      outcomeSummary: outcomeSummary.rows,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Source quality unavailable" });
  }
});

export default router;
