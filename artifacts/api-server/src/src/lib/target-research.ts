import {
  db,
  entitiesTable,
  assetsTable,
  relationshipsTable,
  identityCandidatesTable,
  researchSessionsTable,
  researchEvidenceTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildGraph, findShortestPath, identityPairKey } from "./graph-engine";
import { runMcts, type MctsResult } from "./mcts-agent";
import { assessTargetReachability } from "./reachability-realism";
import { buildResearchEvidenceRows } from "./research-evidence";
import { recordResearchAudit } from "./research-audit";

export interface TargetResearchResult {
  sessionId: number | null;
  mcts: MctsResult;
  pathScore: number;
  reachabilityStatus: string;
}

/**
 * Run the graph/UCT research layer for one already-enriched target.
 *
 * This is deliberately narrower than the HTTP research route: Atlas has
 * already completed the target-scoped OSINT and publication gate, so this
 * service records a manual-review research session without generating
 * outreach copy or publishing a path that has not been approved.
 */
export async function runTargetResearch(
  entityId: number,
  depth = 3,
): Promise<TargetResearchResult> {
  const [target] = await db.select().from(entitiesTable).where(eq(entitiesTable.id, entityId));
  if (!target) throw new Error(`Research target entity ${entityId} was not found.`);

  const [allEntities, allAssets, allRelationships, acceptedCandidates] = await Promise.all([
    db.select().from(entitiesTable),
    db.select().from(assetsTable),
    db.select().from(relationshipsTable),
    db.select().from(identityCandidatesTable),
  ]);

  const acceptedIdentityPairs = new Set(
    acceptedCandidates
      .filter((candidate) => candidate.status === "confirmed" && candidate.identityDecision === "accepted")
      .map((candidate) => identityPairKey(candidate.entityId, candidate.candidateEntityId)),
  );

  const graph = buildGraph(
    allEntities.map((entity) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      bayesianScore: entity.bayesianScore,
      nationality: entity.nationality,
      estimatedNetWorth: entity.estimatedNetWorth,
      metadata: entity.metadata,
      contactEmail: entity.email,
      contactPhone: entity.phone,
      contactConfidence: entity.contactConfidence,
      phoneSource: entity.phoneSource,
      contactOutcome: entity.contactOutcome,
    })),
    allAssets,
    allRelationships,
    acceptedIdentityPairs,
  );

  const targetVertexId = `e:${entityId}`;
  const gatekeeperVertices = allEntities
    .filter((entity) => entity.type === "Gatekeeper")
    .map((entity) => `e:${entity.id}`);
  let bestBfsPath: string[] | null = null;
  for (const gatekeeperId of gatekeeperVertices) {
    const candidate = findShortestPath(graph, gatekeeperId, targetVertexId);
    if (candidate && (!bestBfsPath || candidate.path.length < bestBfsPath.length)) {
      bestBfsPath = candidate.path;
    }
  }

  const mcts = runMcts(graph, targetVertexId, bestBfsPath, Math.max(1, Math.min(depth, 5)));
  const targetRelationships = allRelationships.filter((relationship) => relationship.sourceEntityId === entityId);
  const reachability = assessTargetReachability({
    type: target.type,
    estimatedNetWorth: target.estimatedNetWorth,
    email: target.email,
    phone: target.phone,
    phoneSource: target.phoneSource,
    contactOutcome: target.contactOutcome,
    contactConfidence: target.contactConfidence,
    linkedinUrl: target.linkedinUrl,
    twitterHandle: target.twitterHandle,
    instagramHandle: target.instagramHandle,
    telegramHandle: target.telegramHandle,
    knownResidences: target.knownResidences,
    notes: target.notes,
    metadata: target.metadata,
    sourceRegistries: target.sourceRegistries,
    networkDegree: targetRelationships.length,
  });

  const [session] = await db.insert(researchSessionsTable).values({
    targetEntityId: entityId,
    winningPath: JSON.stringify(mcts.winningPath),
    mctsSteps: JSON.stringify(mcts.mctsSteps),
    notes: [
      "Atlas target-scoped UCT research completed.",
      `Path candidate score ${(mcts.pathScore * 100).toFixed(0)}/100 retained for manual review.`,
      "Atlas is an OSINT research system; no communication artifact was generated.",
    ].join(" "),
    bayesianScoreAtRuntime: target.bayesianScore,
    pathScore: mcts.pathScore,
  }).returning({ id: researchSessionsTable.id });

  if (session) {
    await recordResearchAudit(session.id, [
      {
        algo: "L0 — Reachability Realism Preflight",
        contribution: `${reachability.status} target · ${reachability.score}/100`,
        status: "done",
      },
      {
        algo: "L4 — UCT Deep Path Exploration",
        contribution: `Candidate path score ${(mcts.pathScore * 100).toFixed(0)}/100 · ${mcts.mctsSteps.length} steps; publication remains manual review.`,
        status: "done",
      },
      {
        algo: "L6 — Research Review Boundary",
        contribution: "Evidence remains review-only; no communication artifact was generated.",
        status: "done",
      },
    ]);
    await db.insert(researchEvidenceTable).values(buildResearchEvidenceRows({
      sessionId: session.id,
      entityId,
      targetName: target.name,
      path: mcts.winningPath,
      steps: mcts.mctsSteps,
      reachability,
    }));
  }

  return {
    sessionId: session?.id ?? null,
    mcts,
    pathScore: mcts.pathScore,
    reachabilityStatus: reachability.status,
  };
}