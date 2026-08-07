import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, entitiesTable, assetsTable, identityCandidatesTable, relationshipsTable, researchEvidenceTable, researchSessionsTable } from "@workspace/db";
import { RunResearchBody } from "@workspace/api-zod";
import { buildGraph, findShortestPath, identityPairKey } from "../../lib/graph-engine";
import { computeBayesianScore } from "../../lib/bayesian-scorer";
import { runMcts } from "../../lib/mcts-agent";
import { generateOutreachSequence } from "../../lib/pitch-generator";
import { hybridSearch } from "../../lib/hybrid-search";
import { orchestrate } from "../../lib/agent-orchestrator";
import { assessTargetReachability } from "../../lib/reachability-realism";
import { buildResearchEvidenceRows } from "../../lib/research-evidence";
import { computeResearchScorecard } from "../../lib/research-scorecard";
import { decideResearchCascade } from "../../lib/research-cascade";
import { recordResearchAudit, type ResearchAuditStage } from "../../lib/research-audit";
import { averageSourceReliability } from "../../lib/source-reliability";

const router = Router();

// POST /research/run
router.post("/research/run", async (req, res): Promise<void> => {
  const parsed = RunResearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { entityId, depth = 3 } = parsed.data;

  const [targetEntity] = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, entityId));

  if (!targetEntity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const [allEntities, allAssets, allRelationships, acceptedIdentityCandidates] = await Promise.all([
    db.select().from(entitiesTable),
    db.select().from(assetsTable),
    db.select().from(relationshipsTable),
    db.select().from(identityCandidatesTable),
  ]);

  const acceptedIdentityPairs = new Set(
    acceptedIdentityCandidates
      .filter((candidate) => candidate.status === "confirmed" && candidate.identityDecision === "accepted")
      .map((candidate) => identityPairKey(candidate.entityId, candidate.candidateEntityId)),
  );
  const graph = buildGraph(allEntities, allAssets, allRelationships, acceptedIdentityPairs);

  const targetAssets = allAssets.filter((a) => a.ownerEntityId === entityId);
  const targetRelationships = allRelationships.filter((r) => r.sourceEntityId === entityId);
  const hasGatekeeperConn = targetRelationships.some((r) => {
    if (r.targetType !== "Entity") return false;
    const connEntity = allEntities.find((e) => e.id === r.targetId);
    return connEntity?.type === "Gatekeeper";
  });
  const hasKnownInvestorConn = targetRelationships.some((r) => {
    if (r.targetType !== "Entity") return false;
    const connEntity = allEntities.find((e) => e.id === r.targetId);
    return connEntity?.type === "HNWI" && connEntity.bayesianScore > 0.6;
  });
  const assetCategories = [...new Set(targetAssets.map((a) => a.category))];
  const totalAssetValue = targetAssets.reduce((sum, a) => sum + (a.estimatedValue ?? 0), 0);
  const latestActivity = targetAssets
    .map((a) => a.lastActivityDate)
    .filter(Boolean)
    .sort()
    .reverse()[0];
  const daysSinceActivity = latestActivity
    ? Math.floor((Date.now() - new Date(latestActivity).getTime()) / 86400000)
    : 999;

  // Recompute from the stable prior on every run. Feeding the previous posterior
  // back into the scorer compounds the same evidence on reruns and creates
  // unsupported score inflation.
  const updatedScore = computeBayesianScore(0.05, {
    entityType: targetEntity.type,
    assetCount: targetAssets.length,
    assetCategories,
    totalAssetValue,
    hasRecentActivity: daysSinceActivity < 180,
    recentActivityDays: daysSinceActivity,
    networkDegree: targetRelationships.length,
    hasGatekeeperConnection: hasGatekeeperConn,
    hasKnownInvestorConnection: hasKnownInvestorConn,
    hasShellCompany: allEntities.some(
      (e) => e.type === "Corporation" && allRelationships.some((r) => r.sourceEntityId === entityId && r.targetId === e.id),
    ),
    hasAviationAsset: assetCategories.includes("Aviation"),
    hasMarineAsset: assetCategories.includes("Marine"),
    hasClubMembership: assetCategories.includes("PrivateClub"),
    hasLuxuryRealEstate: assetCategories.includes("RealEstate") && totalAssetValue > 1_000_000,
    jurisdictionCount: new Set(targetAssets.map((a) => a.jurisdiction)).size,
    contactConfidence: targetEntity.contactConfidence ?? 0,
  });

  await db
    .update(entitiesTable)
    .set({ bayesianScore: updatedScore, updatedAt: new Date() })
    .where(eq(entitiesTable.id, entityId));

  const reachability = assessTargetReachability({
    type: targetEntity.type,
    estimatedNetWorth: targetEntity.estimatedNetWorth,
    email: targetEntity.email,
    phone: targetEntity.phone,
    contactOutcome: targetEntity.contactOutcome,
    contactConfidence: targetEntity.contactConfidence,
    linkedinUrl: targetEntity.linkedinUrl,
    twitterHandle: targetEntity.twitterHandle,
    instagramHandle: targetEntity.instagramHandle,
    telegramHandle: targetEntity.telegramHandle,
    knownResidences: targetEntity.knownResidences,
    notes: targetEntity.notes,
    metadata: targetEntity.metadata,
    sourceRegistries: targetEntity.sourceRegistries,
    networkDegree: targetRelationships.length,
    gatekeeperConnections: targetRelationships.filter((r) => {
      if (r.targetType !== "Entity") return false;
      return allEntities.find((e) => e.id === r.targetId)?.type === "Gatekeeper";
    }).length,
    intermediaryConnections: targetRelationships.filter((r) => {
      if (r.targetType !== "Entity") return false;
      const connected = allEntities.find((e) => e.id === r.targetId);
      return connected?.type === "Gatekeeper" || ["BOARD_MEMBER_OF", "KNOWN_ASSOCIATE", "FAMILY_OF", "SHARED_GATEKEEPER"].includes(r.relationshipType);
    }).length,
  });
  const targetSourceLabels = (() => {
    try {
      const parsed = JSON.parse(targetEntity.sourceRegistries ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
    } catch {
      return [];
    }
  })();
  const scorecard = computeResearchScorecard({
    bayesianScore: updatedScore,
    contactConfidence: targetEntity.contactConfidence,
    hasDirectContact: reachability.hasDirectContact,
    reachabilityScore: reachability.score,
    assetCount: targetAssets.length,
    ownershipRelationshipCount: targetRelationships.filter((r) =>
      ["OWNS", "MANAGES", "NOMINEE_OF", "BOARD_MEMBER_OF"].includes(r.relationshipType),
    ).length,
    sourceRegistryCount: (() => {
      try {
        const parsed = JSON.parse(targetEntity.sourceRegistries ?? "[]");
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    })(),
    corroboratingSourceCount: new Set([
      ...targetAssets.map((asset) => asset.sourceRegistry).filter(Boolean),
      ...targetRelationships.map((relationship) => relationship.relationshipType),
    ]).size,
    sourceReliabilityAverage: averageSourceReliability([
      ...targetSourceLabels,
      ...targetAssets.map((asset) => asset.sourceRegistry),
    ]),
    daysSinceActivity,
    hasRecentActivity: daysSinceActivity < 180,
  });

  // A prominent, isolated target with no direct or corroborated intermediary
  // route is still valuable for identity/control research, but should not
  // consume broad retrieval, orchestration, or MCTS budget.
  if (reachability.mode === "research_only") {
    const reason = [
      `Reachability preflight: ${reachability.status} (${reachability.score}/100).`,
      ...reachability.reasons.map((r) => `Evidence: ${r}.`),
      ...reachability.blockers.map((b) => `Constraint: ${b}.`),
      "Expensive retrieval, critic/orchestration, MCTS, and outreach generation were skipped.",
      "A future run may resume after a validated direct vector or corroborated intermediary path is added.",
    ].join(" ");
    const [session] = await db
      .insert(researchSessionsTable)
      .values({
        targetEntityId: entityId,
        winningPath: JSON.stringify([]),
        mctsSteps: JSON.stringify([]),
        crmStatus: "Research Review",
        notes: reason,
        bayesianScoreAtRuntime: updatedScore,
        pathScore: 0,
        generatedPitch: "",
        identityScore: scorecard.identity,
        ownershipScore: scorecard.ownership,
        contactScore: scorecard.contact,
        accessScore: scorecard.access,
        wealthScore: scorecard.wealth,
        freshnessScore: scorecard.freshness,
        sourceQualityScore: scorecard.sourceQuality,
        scoreBreakdown: JSON.stringify(scorecard),
        safeUseStatus: "manual_review",
      })
      .returning();
    if (session) {
      await db.insert(researchEvidenceTable).values(buildResearchEvidenceRows({
        sessionId: session.id,
        entityId,
        targetName: targetEntity.name,
        path: [],
        steps: [],
        reachability,
      }));
    }

    res.status(201).json({
      ...session!,
      targetEntityName: targetEntity.name,
      createdAt: session!.createdAt.toISOString(),
      reachability,
      algorithmPipeline: [
        {
          algo: "L0 — Reachability Realism Preflight",
          contribution: `${reachability.status} target · ${reachability.score}/100 · ${reachability.blockers.join(" ")}`,
          status: "done",
        },
        { algo: "L1 — Hybrid Retrieval", contribution: "Skipped: research-only target has no plausible access route", status: "skipped", durationMs: 0 },
        { algo: "L2 — Multi-Agent Reasoning", contribution: "Skipped: no access evidence to validate", status: "skipped", durationMs: 0 },
        { algo: "L4 — UCT Deep Path Exploration", contribution: "Skipped: no corroborated gatekeeper or intermediary path", status: "skipped", durationMs: 0 },
        { algo: "L5 — Bayesian-UCB Optimization", contribution: `Stable-prior score: ${updatedScore.toFixed(3)}`, status: "done", durationMs: 0 },
      ],
    });
    if (session) {
      await recordResearchAudit(session.id, [
        { algo: "L0 — Reachability Realism Preflight", contribution: `${reachability.status} target · ${reachability.score}/100`, status: "done", durationMs: 0 },
        { algo: "L1 — Hybrid Retrieval", contribution: "Skipped: research-only target has no plausible access route", status: "skipped", durationMs: 0 },
        { algo: "L2 — Multi-Agent Reasoning", contribution: "Skipped: no access evidence to validate", status: "skipped", durationMs: 0 },
        { algo: "L4 — UCT Deep Path Exploration", contribution: "Skipped: no corroborated gatekeeper or intermediary path", status: "skipped", durationMs: 0 },
        { algo: "L5 — Bayesian-UCB Optimization", contribution: `Stable-prior score: ${updatedScore.toFixed(3)}`, status: "done", durationMs: 0 },
      ]);
    }
    return;
  }

  // ── Layer 1: Hybrid Retrieval ─────────────────────────────────────────────
  let hybridMeta = { bm25Hits: 0, semanticHits: 0, graphHits: 0, totalCandidates: 0, durationMs: 0 };
  let hybridCount = 0;
  try {
    const { results: hybridResults, meta } = await hybridSearch(targetEntity.name, undefined, 15);
    hybridMeta = meta;
    hybridCount = hybridResults.length;
  } catch {
    // Non-fatal
  }

  const targetVertexId = `e:${entityId}`;
  // The graph was built before the persisted score update. Keep the in-memory
  // target vertex aligned so MCTS reasoning does not quote the stale score.
  const targetVertex = graph.vertices.get(targetVertexId);
  if (targetVertex) targetVertex.bayesianScore = updatedScore;
  const gatekeeperVertices = allEntities
    .filter((e) => e.type === "Gatekeeper")
    .map((e) => `e:${e.id}`);

  let bestBfsPath: string[] | null = null;
  for (const gkId of gatekeeperVertices) {
    const result = findShortestPath(graph, gkId, targetVertexId);
    if (result && (!bestBfsPath || result.path.length < bestBfsPath.length)) {
      bestBfsPath = result.path;
    }
  }

  // ── Layer 4: MCTS (120 rollouts) ──────────────────────────────────────────
  const mctsStartedAt = Date.now();
  const mctsResult = runMcts(graph, targetVertexId, bestBfsPath, depth);
  const mctsDurationMs = Date.now() - mctsStartedAt;

  // ── Layer 2: Multi-Agent Critic ───────────────────────────────────────────
  const pathNodes = mctsResult.winningPath.length;
  const hasGatekeeper = mctsResult.winningPath.some((p) => p.role === "GATEKEEPER");
  const independentSources = new Set([
    ...targetEntity.sourceRegistries
      ? (() => {
          try {
            const parsed = JSON.parse(targetEntity.sourceRegistries);
            return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
          } catch {
            return [];
          }
        })()
      : [],
    ...mctsResult.winningPath.map((node) => node.registry).filter((value): value is string => Boolean(value)),
  ]).size;
  const cascade = decideResearchCascade({
    hybridCandidates: hybridCount,
    independentSources,
    hasDirectContact: reachability.hasDirectContact,
    hasGatekeeperPath: hasGatekeeper,
    pathNodes,
    identityScore: scorecard.identity,
    accessScore: scorecard.access,
    requestedDepth: depth,
  });
  let critiqueNote: string;
  let criticDurationMs = 0;
  try {
    if (!cascade.runCritic) {
      critiqueNote = `${cascade.reason} Path score ${(mctsResult.pathScore * 100).toFixed(0)}/100 is retained for review.`;
    } else {
    const criticStartedAt = Date.now();
    const orchResult = await orchestrate(targetEntity.name, 5);
    criticDurationMs = Date.now() - criticStartedAt;
    const topCandidates = orchResult.results.slice(0, 3);
    if (topCandidates.length > 0) {
      const synthLines = topCandidates.map((c, i) => {
        const reasoning = (c.reasoning ?? "").slice(0, 100);
        return `#${i + 1} ${c.name} (${c.confidence} · RRF ${(c.scores.rrf * 100).toFixed(0)}%): ${reasoning}`;
      });
      const pathSuffix = pathNodes > 1 && hasGatekeeper
        ? ` | L4: ${pathNodes}-hop, gatekeeper confirmed`
        : pathNodes === 1
          ? " | L4: isolated — no graph edges yet"
          : ` | L4: ${pathNodes}-hop, no confirmed gatekeeper`;
      critiqueNote =
        `Critic synthesised ${topCandidates.length}/${orchResult.pipeline.analyst.candidateCount} candidate(s)` +
        ` (${orchResult.pipeline.critic.removed} pruned, ${orchResult.totalMs}ms).` +
        ` Top: ${synthLines.join(" · ")}${pathSuffix}.`;
    } else {
      critiqueNote = pathNodes > 1 && hasGatekeeper
        ? `Path validated — ${pathNodes} nodes, gatekeeper identified. No soft-neighbour candidates from hybrid search.`
        : pathNodes === 1
          ? "Isolated entity — no relationship edges. Enrich via Companies House to build graph."
          : `${pathNodes}-hop path found — no confirmed gatekeeper. Expand graph for better results.`;
    }
    }
  } catch {
    critiqueNote = pathNodes > 1 && hasGatekeeper
      ? `Path validated — ${pathNodes} nodes, gatekeeper identified.`
      : pathNodes === 1
        ? "Isolated entity — no relationship edges. Enrich via Companies House first."
        : `${pathNodes}-hop path found — no confirmed gatekeeper. Expand graph for better results.`;
  }

  const algorithmPipeline = [
    {
      algo: "L1 — Hybrid Retrieval (BM25 + Semantic + Graph)",
      contribution: (() => {
        const searchPart = hybridCount > 0
          ? `${hybridCount} related entities surfaced (${hybridMeta.durationMs}ms)`
          : "No soft neighbours — entity may be isolated";
        const bfsPart = bestBfsPath
          ? `BFS: ${bestBfsPath.length}-hop path to target`
          : "BFS: no gatekeeper path (empty graph)";
        return `${searchPart} · ${bfsPart}`;
      })(),
      status: "done",
      durationMs: hybridMeta.durationMs,
    },
    {
      algo: "L2 — Multi-Agent Reasoning (Planner→Retriever→Analyst→Critic)",
      contribution: critiqueNote,
      status: cascade.runCritic ? "done" : "skipped",
      durationMs: criticDurationMs,
    },
    {
      algo: "L3 — Query Expansion (single-pass expandQuery)",
      contribution: "Asset synonyms · GEO_MAP · intent background terms applied at retrieval",
      status: "done",
      durationMs: 0,
    },
    {
      algo: "L4 — UCT Deep Path Exploration (120 rollouts)",
      contribution: `Path score: ${(mctsResult.pathScore * 100).toFixed(0)}/100 · ${mctsResult.mctsSteps.length} step${mctsResult.mctsSteps.length !== 1 ? "s" : ""}`,
      status: "done",
      durationMs: mctsDurationMs,
    },
    {
      algo: "L5 — Bayesian-UCB Optimization",
      contribution: `Score: ${(targetEntity.bayesianScore ?? 0).toFixed(3)} → ${updatedScore.toFixed(3)} · UCB exploitation ${updatedScore >= 0.7 ? "high priority" : "standard"}`,
      status: "done",
      durationMs: 0,
    },
  ];

  const entityAssets = await db
    .select()
    .from(assetsTable)
    .where(eq(assetsTable.ownerEntityId, entityId));

  const gatekeeper = mctsResult.winningPath.find((p) => p.role === "GATEKEEPER") ?? null;
  const pitchCtx = {
    targetEntity: {
      name: targetEntity.name,
      type: targetEntity.type,
      nationality: targetEntity.nationality,
      estimatedNetWorth: targetEntity.estimatedNetWorth,
      knownResidences: targetEntity.knownResidences,
      notes: targetEntity.notes,
      contactEmail: targetEntity.email,
      contactPhone: targetEntity.phone,
      contactOutcome: targetEntity.contactOutcome,
      contactConfidence: targetEntity.contactConfidence,
    },
    gatekeeper,
    assets: entityAssets.map((a) => ({
      category: a.category,
      identifier: a.identifier,
      jurisdiction: a.jurisdiction,
      estimatedValue: a.estimatedValue,
      address: a.address,
    })),
    winningPath: mctsResult.winningPath,
    pathScore: mctsResult.pathScore,
  };
  let pitchText = "";
  try {
    const outreach = generateOutreachSequence(pitchCtx);
    pitchText = [
      outreach.initial,
      "---\n**7-day follow-up:**",
      outreach.followUp,
      "---\n**Intro script for gatekeeper:**",
      outreach.introScript,
    ].join("\n\n");
  } catch (pitchErr: any) {
    pitchText = `[Auto-pitch pending: ${pitchErr?.message ?? "generation error"}. Run /research/backfill-pitches to retry.]`;
  }

  const [session] = await db
    .insert(researchSessionsTable)
    .values({
      targetEntityId: entityId,
      winningPath: JSON.stringify(mctsResult.winningPath),
      mctsSteps: JSON.stringify(mctsResult.mctsSteps),
      crmStatus: pitchText.startsWith("[Auto-pitch pending")
        ? "Pitch Pending"
        : gatekeeper
          ? "Pitch Generated"
          : "Research Review",
      bayesianScoreAtRuntime: updatedScore,
      pathScore: mctsResult.pathScore,
      generatedPitch: pitchText,
      identityScore: scorecard.identity,
      ownershipScore: scorecard.ownership,
      contactScore: scorecard.contact,
      accessScore: scorecard.access,
      wealthScore: scorecard.wealth,
      freshnessScore: scorecard.freshness,
      sourceQualityScore: scorecard.sourceQuality,
      scoreBreakdown: JSON.stringify(scorecard),
      safeUseStatus: "manual_review",
    })
    .returning();
  if (session) {
    await recordResearchAudit(session.id, algorithmPipeline as ResearchAuditStage[]);
    await db.insert(researchEvidenceTable).values(buildResearchEvidenceRows({
      sessionId: session.id,
      entityId,
      targetName: targetEntity.name,
      path: mctsResult.winningPath,
      steps: mctsResult.mctsSteps,
      hybridMeta,
      reachability,
    }));
  }

  res.status(201).json({
    ...session!,
    targetEntityName: targetEntity.name,
    createdAt: session!.createdAt.toISOString(),
    algorithmPipeline,
  });
});

export default router;
