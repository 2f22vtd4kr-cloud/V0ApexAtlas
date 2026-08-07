import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  entitiesTable,
  identityBundlesTable,
  identityCandidatesTable,
} from "@workspace/db";
import {
  buildIdentityBundle,
  candidateKey,
  scoreIdentityMatch,
  type IdentityEntityInput,
} from "../lib/identity-resolver";
import { evaluateIdentityGate } from "../lib/identity-gate";
import { createJob, getActiveJob, getJob, setActiveJob, updateJob } from "../lib/job-queue";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const identitySelect = {
  id: entitiesTable.id,
  name: entitiesTable.name,
  type: entitiesTable.type,
  nationality: entitiesTable.nationality,
  knownResidences: entitiesTable.knownResidences,
  sourceRegistries: entitiesTable.sourceRegistries,
  metadata: entitiesTable.metadata,
  notes: entitiesTable.notes,
  linkedinUrl: entitiesTable.linkedinUrl,
  personalWebsite: entitiesTable.personalWebsite,
  twitterHandle: entitiesTable.twitterHandle,
  instagramHandle: entitiesTable.instagramHandle,
  telegramHandle: entitiesTable.telegramHandle,
} as const;

function toIdentityInput(row: unknown): IdentityEntityInput {
  return row as unknown as IdentityEntityInput;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

async function runIdentityResolution(jobId: string, requestedLimit: number): Promise<void> {
  const rows = await db
    .select(identitySelect)
    .from(entitiesTable)
    .where(eq(entitiesTable.isHidden, false))
    .orderBy(desc(entitiesTable.bayesianScore))
    .limit(requestedLimit);

  await updateJob(jobId, {
    status: "running",
    total: rows.length,
    progress: 0,
    message: `Building identity bundles for ${rows.length.toLocaleString()} entities…`,
  });

  const bundles = new Map<number, ReturnType<typeof buildIdentityBundle>>();
  for (const row of rows) {
    const bundle = buildIdentityBundle(toIdentityInput(row));
    bundles.set(row.id, bundle);
    await db
      .insert(identityBundlesTable)
      .values({
        entityId: row.id,
        normalizedName: bundle.normalizedName,
        variants: json(bundle.variants),
        registryIdentifiers: json(bundle.registryIdentifiers),
        affiliations: json(bundle.affiliations),
        location: bundle.location,
        publicAddress: bundle.publicAddress,
        assetIdentifiers: json(bundle.assetIdentifiers),
        publicProfileUrls: json(bundle.publicProfileUrls),
        provenance: json(bundle.provenance),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: identityBundlesTable.entityId,
        set: {
          normalizedName: bundle.normalizedName,
          variants: json(bundle.variants),
          registryIdentifiers: json(bundle.registryIdentifiers),
          affiliations: json(bundle.affiliations),
          location: bundle.location,
          publicAddress: bundle.publicAddress,
          assetIdentifiers: json(bundle.assetIdentifiers),
          publicProfileUrls: json(bundle.publicProfileUrls),
          provenance: json(bundle.provenance),
          updatedAt: new Date(),
        },
      });
  }

  // Index each name variant so common names do not create an O(n²) scan.
  const variantIndex = new Map<string, number[]>();
  for (const [entityId, bundle] of bundles) {
    for (const variant of new Set(bundle.variants)) {
      const ids = variantIndex.get(variant) ?? [];
      ids.push(entityId);
      variantIndex.set(variant, ids);
    }
  }

  const matches = new Map<string, {
    entityId: number;
    candidateEntityId: number;
    candidateName: string;
    normalizedName: string;
    score: number;
    signals: string[];
    evidence: unknown[];
    identityDecision: "accepted" | "review" | "rejected";
    gateReason: string;
  }>();
  const rowById = new Map(rows.map((row) => [row.id, row]));

  for (const ids of variantIndex.values()) {
    if (ids.length < 2 || ids.length > 60) continue;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const leftId = ids[i]!;
        const rightId = ids[j]!;
        if (leftId === rightId) continue;
        const left = bundles.get(leftId);
        const right = bundles.get(rightId);
        if (!left || !right) continue;
        const match = scoreIdentityMatch(left, right);
        if (!match) continue;

        const entityId = Math.min(leftId, rightId);
        const candidateEntityId = Math.max(leftId, rightId);
        const candidate = rowById.get(candidateEntityId);
        const candidateBundle = bundles.get(candidateEntityId);
        if (!candidate || !candidateBundle) continue;
        const key = candidateKey(entityId, candidateEntityId);
        const gate = evaluateIdentityGate({
          score: match.score,
          signals: match.signals,
          leftSources: left.provenance.map((item) => item.source),
          rightSources: right.provenance.map((item) => item.source),
        });
        const prior = matches.get(key);
        if (!prior || match.score > prior.score) {
          matches.set(key, {
            entityId,
            candidateEntityId,
            candidateName: candidate.name,
            normalizedName: candidateBundle.normalizedName,
            score: match.score,
            signals: match.signals,
            evidence: [
              { entityId: leftId, sources: left.provenance },
              { entityId: rightId, sources: right.provenance },
            ],
            identityDecision: gate.decision,
            gateReason: gate.reason,
          });
        }
      }
    }
  }

  let persisted = 0;
  for (const match of matches.values()) {
    await db
      .insert(identityCandidatesTable)
      .values({
        entityId: match.entityId,
        candidateEntityId: match.candidateEntityId,
        candidateName: match.candidateName,
        normalizedName: match.normalizedName,
        matchScore: match.score,
        matchSignals: json(match.signals),
        sourceEvidence: json(match.evidence),
        status: "pending",
        identityDecision: match.identityDecision,
        gateReason: match.gateReason,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          identityCandidatesTable.entityId,
          identityCandidatesTable.candidateEntityId,
        ],
        set: {
          candidateName: match.candidateName,
          normalizedName: match.normalizedName,
          matchScore: match.score,
          matchSignals: json(match.signals),
          sourceEvidence: json(match.evidence),
          identityDecision: match.identityDecision,
          gateReason: match.gateReason,
          updatedAt: new Date(),
        },
      });
    persisted += 1;
  }

  await updateJob(jobId, {
    status: "done",
    progress: 100,
    inserted: persisted,
    skipped: Math.max(0, matches.size - persisted),
    message: `Identity resolution complete — ${persisted.toLocaleString()} review candidate(s).`,
    finishedAt: new Date().toISOString(),
  });
}

// POST /identity/resolve — build bundles and review-only candidate links.
router.post("/identity/resolve", async (req: Request, res: Response): Promise<void> => {
  const activeJobId = await getActiveJob("identity-resolve");
  if (activeJobId) {
    const active = await getJob(activeJobId);
    if (active?.status === "queued" || active?.status === "running") {
      res.status(409).json({ error: "Identity resolution is already running.", jobId: activeJobId });
      return;
    }
  }

  const limit = Math.min(Math.max(Number(req.body?.limit) || 5000, 100), 30000);
  const jobId = await createJob("identity-resolve");
  await setActiveJob("identity-resolve", jobId);

  void runIdentityResolution(jobId, limit).catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : "Identity resolution failed";
    logger.error({ err: message }, "Identity resolution failed");
    await updateJob(jobId, { status: "failed", message, finishedAt: new Date().toISOString() });
  });

  res.status(202).json({
    jobId,
    message: `Identity resolution started for up to ${limit.toLocaleString()} entities.`,
    reviewOnly: true,
    pollUrl: `/api/ingest/job/${jobId}`,
  });
});

// GET /identity/candidates — pending review queue, ranked by explainable score.
router.get("/identity/candidates", async (req: Request, res: Response): Promise<void> => {
  const requestedStatus = typeof req.query.status === "string" ? req.query.status : "pending";
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const conditions = requestedStatus === "all"
    ? undefined
    : eq(identityCandidatesTable.status, requestedStatus);
  const candidates = await db
    .select()
    .from(identityCandidatesTable)
    .where(conditions)
    .orderBy(desc(identityCandidatesTable.matchScore))
    .limit(limit);

  const ids = [...new Set(candidates.flatMap((candidate) => [candidate.entityId, candidate.candidateEntityId]))];
  const entities = ids.length
    ? await db.select({
        id: entitiesTable.id,
        name: entitiesTable.name,
        type: entitiesTable.type,
        sourceRegistries: entitiesTable.sourceRegistries,
      }).from(entitiesTable).where(inArray(entitiesTable.id, ids))
    : [];
  const entityMap = new Map(entities.map((entity) => [entity.id, entity]));
  res.json({
    candidates: candidates.map((candidate) => ({
      ...candidate,
      entity: entityMap.get(candidate.entityId) ?? null,
      candidateEntity: entityMap.get(candidate.candidateEntityId) ?? null,
      matchSignals: parseArray(candidate.matchSignals),
      sourceEvidence: parseArray(candidate.sourceEvidence),
      identityDecision: candidate.identityDecision,
      gateReason: candidate.gateReason,
    })),
    total: candidates.length,
    reviewOnly: true,
  });
});

router.get("/identity/stats", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select({ status: identityCandidatesTable.status, count: sql<number>`count(*)::int` })
    .from(identityCandidatesTable)
    .groupBy(identityCandidatesTable.status);
  const stats = Object.fromEntries(rows.map((row) => [row.status, row.count]));
  const [bundleCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(identityBundlesTable);
  res.json({
    phase: "J3",
    bundles: bundleCount?.count ?? 0,
    candidates: stats,
    reviewOnly: true,
  });
});

router.patch("/identity/candidates/:id", async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const status = req.body?.status;
  if (!Number.isInteger(id) || !["pending", "confirmed", "rejected"].includes(status)) {
    res.status(400).json({ error: "id and status (pending, confirmed, or rejected) are required." });
    return;
  }
  const [candidate] = await db
    .select()
    .from(identityCandidatesTable)
    .where(eq(identityCandidatesTable.id, id));
  if (!candidate) {
    res.status(404).json({ error: "Identity candidate not found." });
    return;
  }
  if (status === "confirmed" && candidate.identityDecision !== "accepted") {
    res.status(422).json({
      error: "Identity gate has not cleared this candidate.",
      decision: candidate.identityDecision,
      reason: candidate.gateReason ?? "Independent corroboration is required.",
    });
    return;
  }
  const [updated] = await db
    .update(identityCandidatesTable)
    .set({
      status,
      reviewerNote: typeof req.body?.reviewerNote === "string" ? req.body.reviewerNote.trim() || null : undefined,
      reviewedAt: status === "pending" ? null : new Date(),
      identityDecision: status === "rejected" ? "rejected" : candidate.identityDecision,
      updatedAt: new Date(),
    })
    .where(eq(identityCandidatesTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Identity candidate not found." });
    return;
  }
  res.json({ ...updated, reviewOnly: true });
});

function parseArray(value: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default router;