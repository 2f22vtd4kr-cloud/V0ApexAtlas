import { Router } from "express";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import { db, entitiesTable, assetsTable, relationshipsTable, researchSessionsTable } from "@workspace/db";
import { createJob, updateJob, setActiveJob, getActiveJob, getJob, clearActiveJob } from "../../lib/job-queue";
import { buildGraph, findShortestPath } from "../../lib/graph-engine";
import { computeBayesianScore } from "../../lib/bayesian-scorer";
import { runMcts } from "../../lib/mcts-agent";
import { generateOutreachSequence } from "../../lib/pitch-generator";

const router = Router();

// POST /research/lead — create a bare Lead Gen session without running MCTS
router.post("/research/lead", async (req, res): Promise<void> => {
  const { targetEntityId } = req.body as { targetEntityId?: number };
  if (!targetEntityId || typeof targetEntityId !== "number") {
    res.status(400).json({ error: "targetEntityId is required" });
    return;
  }
  const [entity] = await db.select({ id: entitiesTable.id, score: entitiesTable.bayesianScore })
    .from(entitiesTable).where(eq(entitiesTable.id, targetEntityId));
  if (!entity) { res.status(404).json({ error: "Entity not found" }); return; }

  // Upsert: if a session already exists for this entity, just return it
  const [existing] = await db.select().from(researchSessionsTable)
    .where(eq(researchSessionsTable.targetEntityId, targetEntityId))
    .orderBy(desc(researchSessionsTable.createdAt))
    .limit(1);
  if (existing) { res.json(existing); return; }

  const [session] = await db.insert(researchSessionsTable).values({
    targetEntityId,
    crmStatus: "Lead Gen",
    bayesianScoreAtRuntime: entity.score ?? 0,
    pathScore: 0,
    winningPath: null,
    mctsSteps: null,
    safeUseStatus: "manual_review",
  }).returning();
  res.status(201).json(session);
});

// POST /research/bulk-run — run Hybrid Research on top N hot leads in a single background job
router.post("/research/bulk-run", async (req, res): Promise<void> => {
  const existing = await getActiveJob("bulk-hybrid-research");
  if (existing) {
    const existingJob = await getJob(existing);
    if (existingJob?.status === "running") {
      res.status(409).json({ error: "A bulk Hybrid Research run is already in progress.", jobId: existing });
      return;
    }

    // A queued job can only be legitimate for the few milliseconds between
    // createJob() and the worker's first update. Older queued jobs are ghosts
    // left by a killed process and must not block every future research pass.
    if (existingJob?.status === "queued") {
      const ageMs = existingJob.startedAt
        ? Date.now() - new Date(existingJob.startedAt).getTime()
        : Number.POSITIVE_INFINITY;
      if (ageMs < 5 * 60 * 1_000) {
        res.status(409).json({ error: "A bulk Hybrid Research run is being started.", jobId: existing });
        return;
      }
      await updateJob(existing, {
        status: "failed",
        message: "Stale queued job superseded by a new research pass.",
        finishedAt: new Date().toISOString(),
      });
    }

    await clearActiveJob("bulk-hybrid-research");
  }

  const batchSize  = Math.min(parseInt((req.body as any)?.batchSize ?? "60", 10), 300);
  const skipExisting = (req.body as any)?.skipExisting !== false;

  // Entity count guard — skip if DB is near-empty
  const ecResult = await db.execute(sql`SELECT COUNT(*) AS c FROM entities`);
  const entityCount = Number((ecResult.rows[0] as any)?.c ?? 0);
  if (entityCount < 500) {
    res.json({ message: `Skipped — only ${entityCount} entities in DB. Retry once ingestion completes.`, jobId: null, skippedReason: "insufficient_entities" });
    return;
  }

  const existingSessionEntityIds = skipExisting
    ? (await db.select({ eid: researchSessionsTable.targetEntityId }).from(researchSessionsTable)).map(r => r.eid)
    : [];

  const candidates = await db
    .select()
    .from(entitiesTable)
    .where(
      and(
        sql`${entitiesTable.isHot} = true`,
        inArray(entitiesTable.type, ["HNWI", "Gatekeeper"]),
        sql`${entitiesTable.name} !~ '^[0-9]'`,
      )
    )
    .orderBy(desc(entitiesTable.bayesianScore))
    .limit(batchSize * 6);

  const targets = candidates
    .filter(e => !existingSessionEntityIds.includes(e.id))
    .slice(0, batchSize);

  if (targets.length === 0) {
    res.json({ message: "All hot leads already have research sessions.", jobId: null });
    return;
  }

  const jobId = await createJob("bulk-hybrid-research");
  await setActiveJob("bulk-hybrid-research", jobId);

  res.status(202).json({
    jobId,
    pollUrl: `/api/ingest/job/${jobId}`,
    total: targets.length,
    message: `Bulk Hybrid Research started for ${targets.length} hot leads.`,
  });

  (async () => {
    let done = 0;
    let errors = 0;

    try {
      await updateJob(jobId, { progress: 0, total: targets.length, inserted: 0, message: "Loading graph from database…" });

      const [allEntities, allAssets, allRelationships] = await Promise.all([
        db.select().from(entitiesTable),
        db.select().from(assetsTable),
        db.select().from(relationshipsTable),
      ]);
      const graph = buildGraph(allEntities, allAssets, allRelationships);

      for (const targetEntity of targets) {
        try {
          await updateJob(jobId, {
            progress: done,
            total: targets.length,
            inserted: done,
            errors,
            message: `Running Hybrid Research for ${targetEntity.name} (${done + 1}/${targets.length})…`,
          });

          const entityId = targetEntity.id;
          const targetAssets = allAssets.filter(a => a.ownerEntityId === entityId);
          const targetRelationships = allRelationships.filter(r => r.sourceEntityId === entityId);
          const assetCategories = [...new Set(targetAssets.map(a => a.category))];
          const totalAssetValue = targetAssets.reduce((s, a) => s + (a.estimatedValue ?? 0), 0);
          const hasGatekeeperConn = targetRelationships.some(r => {
            if (r.targetType !== "Entity") return false;
            const e = allEntities.find(e => e.id === r.targetId);
            return e?.type === "Gatekeeper";
          });
          const hasKnownInvestorConn = targetRelationships.some(r => {
            if (r.targetType !== "Entity") return false;
            const e = allEntities.find(e => e.id === r.targetId);
            return e?.type === "HNWI" && (e.bayesianScore ?? 0) > 0.6;
          });

          const updatedScore = computeBayesianScore(targetEntity.bayesianScore ?? 0.05, {
            entityType: targetEntity.type,
            assetCount: targetAssets.length,
            assetCategories,
            totalAssetValue,
            hasRecentActivity: false,
            recentActivityDays: 999,
            networkDegree: targetRelationships.length,
            hasGatekeeperConnection: hasGatekeeperConn,
            hasKnownInvestorConnection: hasKnownInvestorConn,
            hasShellCompany: false,
            hasAviationAsset: assetCategories.includes("Aviation"),
            hasMarineAsset: assetCategories.includes("Marine"),
            hasClubMembership: assetCategories.includes("PrivateClub"),
            hasLuxuryRealEstate: assetCategories.includes("RealEstate") && totalAssetValue > 1_000_000,
            jurisdictionCount: new Set(targetAssets.map(a => a.jurisdiction)).size,
            contactConfidence: targetEntity.contactConfidence ?? 0,
          });

          await db.update(entitiesTable)
            .set({ bayesianScore: updatedScore, isHot: updatedScore >= 0.70, updatedAt: new Date() })
            .where(eq(entitiesTable.id, entityId));

          const targetVertexId = `e:${entityId}`;
          const gatekeeperVertices = allEntities.filter(e => e.type === "Gatekeeper").map(e => `e:${e.id}`);
          let bestBfsPath: string[] | null = null;
          for (const gkId of gatekeeperVertices) {
            const r = findShortestPath(graph, gkId, targetVertexId);
            if (r && (!bestBfsPath || r.path.length < bestBfsPath.length)) bestBfsPath = r.path;
          }
          const mctsResult = runMcts(graph, targetVertexId, bestBfsPath, 3);

          const pathNodes = mctsResult.winningPath.length;
          const hasGatekeeper = mctsResult.winningPath.some(p => p.role === "GATEKEEPER");
          const critiqueNote = pathNodes > 1 && hasGatekeeper
            ? `Bulk run — Path validated: ${pathNodes} nodes, gatekeeper confirmed. Score: ${(mctsResult.pathScore * 100).toFixed(0)}/100.`
            : pathNodes > 1
              ? `Bulk run — ${pathNodes}-hop path found, no confirmed gatekeeper. Score: ${(mctsResult.pathScore * 100).toFixed(0)}/100.`
              : `Bulk run — Isolated entity. 0 edges. Score: ${(mctsResult.pathScore * 100).toFixed(0)}/100. Run CH enrichment to build graph.`;

          const gatekeeper = mctsResult.winningPath.find(p => p.role === "GATEKEEPER") ?? null;
          let pitchText = "";
          try {
            const outreach = generateOutreachSequence({
              targetEntity: {
                name: targetEntity.name, type: targetEntity.type,
                nationality: targetEntity.nationality, estimatedNetWorth: targetEntity.estimatedNetWorth,
                knownResidences: targetEntity.knownResidences, notes: targetEntity.notes,
                contactEmail: targetEntity.email, contactPhone: targetEntity.phone,
              },
              gatekeeper,
              assets: targetAssets.map(a => ({
                category: a.category, identifier: a.identifier, jurisdiction: a.jurisdiction,
                estimatedValue: a.estimatedValue, address: a.address,
              })),
              winningPath: mctsResult.winningPath,
              pathScore: mctsResult.pathScore,
            });
            pitchText = [
              outreach.initial,
              "---\n**7-day follow-up:**",
              outreach.followUp,
              "---\n**Intro script for gatekeeper:**",
              outreach.introScript,
            ].join("\n\n");
          } catch {
            pitchText = `[Bulk Research pitch — ${targetEntity.name}. Path score: ${(mctsResult.pathScore * 100).toFixed(0)}/100. Run /research/backfill-pitches to regenerate.]`;
          }

          await db.insert(researchSessionsTable).values({
            targetEntityId: entityId,
            winningPath: JSON.stringify(mctsResult.winningPath),
            mctsSteps: JSON.stringify(mctsResult.mctsSteps),
            crmStatus: "Pitch Generated",
            bayesianScoreAtRuntime: updatedScore,
            pathScore: mctsResult.pathScore,
            generatedPitch: pitchText,
            notes: critiqueNote,
            safeUseStatus: "manual_review",
          });

          done++;
        } catch {
          errors++;
        }
      }

      await updateJob(jobId, {
        progress: targets.length,
        total: targets.length,
        inserted: done,
        errors,
        status: "done",
        message: `Bulk Hybrid Research complete — ${done} sessions created, ${errors} errors.`,
      });
    } catch (err: any) {
      await updateJob(jobId, {
        status: "failed",
        message: `Bulk Hybrid Research crashed: ${err.message}`,
      } as any);
    } finally {
      await setActiveJob("bulk-hybrid-research", "");
    }
  })().catch(() => setActiveJob("bulk-hybrid-research", ""));
});

export default router;
