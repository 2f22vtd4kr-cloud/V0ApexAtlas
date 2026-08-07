/**
 * Persona Improvement Engine — Phase 7 + Hybrid Architecture Auditor
 *
 * Eight specialist personas each analyse an entity and produce concrete
 * improvement suggestions. All logic is deterministic TypeScript; no
 * external AI APIs are used.
 *
 * Personas:
 *  1. Data Engineer                  — data completeness & source quality
 *  2. Data Analyst                   — Bayesian score accuracy & financial signals
 *  3. Intelligence Systems Analyst   — hybrid stack: search signal coverage, agent
 *                                      pipeline completeness, Bayesian-UCB convergence
 *  4. Business Engineer              — corporate structure & relationship depth
 *  5. UX Designer                    — profile display completeness
 *  6. Architect                      — entity classification & deduplication
 *  7. Data Integrity Auditor         — zero-synthetic-data compliance
 *  8. Hybrid Architecture Auditor    — ALL 5 layers of the Core Hybrid Architecture:
 *                                      L1 Hybrid Search · L2 Multi-Agent Reasoning ·
 *                                      L3 Query Expansion · L4 MCTS Path Exploration ·
 *                                      L5 Bayesian-UCB Optimisation
 *
 * Core Hybrid Architecture (all deterministic, no external AI):
 *  L1 — Hybrid Semantic + Keyword + Graph Search (hybrid-search.ts)
 *       BM25 keyword · TF-IDF cosine · NetworkX-style graph traversal · RRF fusion · Redis cache
 *  L2 — Agentic Multi-Agent Reasoning (agent-orchestrator.ts)
 *       Planner → Retriever → Analyst → Critic pipeline; hand-off logic; pitch synthesis
 *  L3 — Iterative Query Expansion + Relevance Feedback (agent-orchestrator.ts)
 *       expandQuery(): ASSET_EXPANSION synonyms · GEO_MAP canonical forms ·
 *       name hints · INTENT_EXPANSION background terms (single-pass, deterministic)
 *  L4 — Monte Carlo Tree Search (mcts-agent.ts)
 *       UCT selection · expansion · simulation · backpropagation ·
 *       reward = real relationship types + personal identifiers from registries
 *  L5 — Bayesian Optimisation / UCB (bayesian-scorer.ts + mcts-agent.ts)
 *       Log-odds prior per entity · UCB1 inside MCTS · signal-weighted posterior updates
 */

import { db, entitiesTable, assetsTable, relationshipsTable, researchSessionsTable } from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";
import type { Entity } from "@workspace/db";
import { logger } from "./logger";

export type PersonaId =
  | "data_engineer"
  | "data_analyst"
  | "intel_systems_analyst"
  | "business_engineer"
  | "ux_designer"
  | "architect"
  | "data_integrity_auditor"
  | "hybrid_architecture_auditor";

export type ImprovementCategory =
  | "data_quality"
  | "scoring"
  | "outreach"
  | "structure"
  | "display"
  | "classification"
  | "integrity";

export type Priority = "high" | "medium" | "low";
export type ImprovementStatus = "pending" | "applied" | "dismissed";

export interface ImprovementSuggestion {
  entityId: number;
  persona: PersonaId;
  category: ImprovementCategory;
  priority: Priority;
  title: string;
  description: string;
  actionTaken: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseJsonSafe<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try { return JSON.parse(val) as T; } catch { return fallback; }
}

function ageInDays(isoDate: string): number {
  return (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persona 1 — Data Engineer
// Focuses on field completeness and source quality
// ─────────────────────────────────────────────────────────────────────────────

async function runDataEngineer(entity: Entity): Promise<ImprovementSuggestion[]> {
  const suggestions: ImprovementSuggestion[] = [];
  const sources: string[] = parseJsonSafe(entity.sourceRegistries, []);

  const hasPhysicalAddress = !!(entity.knownResidences && entity.knownResidences.length > 2 && entity.knownResidences !== "[]");
  // Contact-vector flags only apply to HNWI and Gatekeeper — individual direct outreach targets.
  // Corporation/Trust entities are reached via their officers/directors (a separate enrichment path).
  const isDirectTarget = entity.type === "HNWI" || entity.type === "Gatekeeper";

  if (isDirectTarget) {
    if (!entity.phone && !entity.email && !entity.linkedinUrl && !hasPhysicalAddress) {
      // Truly contactless — no digital OR physical vector at all
      suggestions.push({
        entityId: entity.id,
        persona: "data_engineer",
        category: "data_quality",
        priority: "high",
        title: "No contact vectors whatsoever — physical or digital",
        description:
          "Entity has no phone, email, LinkedIn, or known physical address on record. Proximity-to-body score is critically low. " +
          "Suggested sources: SEC DEF 14A director filings, UK Companies House officer submissions, " +
          "yacht club membership records, aviation FBO logs.",
        actionTaken: "Flagged for enrichment from SEC, Companies House, and club registers.",
      });
    } else if (!entity.phone && !entity.email && !entity.linkedinUrl && hasPhysicalAddress) {
      // Has physical address — usable via physical mail / skip tracing
      suggestions.push({
        entityId: entity.id,
        persona: "data_engineer",
        category: "data_quality",
        priority: "medium",
        title: "Digital contact vectors missing — physical address only",
        description:
          "Entity has a known physical address but no email, phone, or LinkedIn on record. " +
          "Physical mail and skip-tracing services can reach this entity, but a digital channel would " +
          "significantly increase outreach velocity. Run Companies House officer lookup or web OSINT to find digital vectors.",
        actionTaken: "Physical-address-only flag: email/phone enrichment queued at medium priority.",
      });
    } else if (!entity.phone) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_engineer",
      category: "data_quality",
      priority: "medium",
      title: "Direct phone number missing",
      description:
        "No direct phone on record. Personal WhatsApp/Signal numbers are the highest-value contact vector. " +
        "Sources to try: aviation FBO client sheets, yacht marina records, private club rosters.",
      actionTaken: "Queued for phone enrichment sweep.",
    });
  }

  if (!entity.nationality) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_engineer",
      category: "data_quality",
      priority: "medium",
      title: "Nationality / jurisdiction unknown",
      description:
        "Nationality is unset. This limits tax-residency inference, sanctions screening, and jurisdiction-specific " +
        "outreach strategy. Cross-reference with asset jurisdictions and registry addresses to infer.",
      actionTaken: "Recommended cross-reference against asset jurisdictions.",
    });
  }

  if (sources.length === 0) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_engineer",
      category: "data_quality",
      priority: "high",
      title: "No source registries linked",
      description:
        "No provenance chain for this entity. Every data point must trace to a validated public registry. " +
        "Without sources, confidence scores default to minimum and the record cannot be exported for compliance use.",
      actionTaken: "Marked sourceRegistries as empty — manual source attribution required.",
    });
  } else if (sources.length === 1) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_engineer",
      category: "data_quality",
      priority: "low",
      title: "Single source — corroboration needed",
      description: `Only one registry (${sources[0]}) links to this entity. A second independent source increases ` +
        "confidence and reduces false-positive risk. Try cross-referencing with GLEIF, BRREG, or SEC.",
      actionTaken: "Single-source flag applied to confidence metadata.",
    });
  }

  if (!entity.knownResidences || entity.knownResidences === "[]") {
    suggestions.push({
      entityId: entity.id,
      persona: "data_engineer",
      category: "data_quality",
      priority: "low",
      title: "Known residences not populated",
      description:
        "No residential addresses on record. Residences help model seasonal presence and preferred meeting jurisdictions. " +
        "Sources: UK Land Registry, county assessor records, yacht club home port data.",
      actionTaken: "Residence gap logged for future enrichment pass.",
    });
  }

  return suggestions;
  }

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persona 2 — Data Analyst
// Focuses on Bayesian score accuracy and financial signal consistency
// ─────────────────────────────────────────────────────────────────────────────

async function runDataAnalyst(entity: Entity): Promise<ImprovementSuggestion[]> {
  const suggestions: ImprovementSuggestion[] = [];

  const [assetRow] = await db
    .select({ count: count(), totalValue: sql<number>`coalesce(sum(${assetsTable.estimatedValue}),0)` })
    .from(assetsTable)
    .where(eq(assetsTable.ownerEntityId, entity.id));

  const assetCount = Number(assetRow?.count ?? 0);
  const totalAssetValue = Number(assetRow?.totalValue ?? 0);
  const score = entity.bayesianScore;

  // Score too low given asset footprint
  if (assetCount >= 3 && score < 0.3) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_analyst",
      category: "scoring",
      priority: "high",
      title: "Bayesian score underestimates asset-backed wealth",
      description:
        `Entity holds ${assetCount} registered assets totalling ~$${(totalAssetValue / 1_000_000).toFixed(1)}M, ` +
        `yet Bayesian score is ${score.toFixed(3)}. Multi-asset HNWI footprint strongly indicates higher investable capital. ` +
        "Recommend upward score revision to reflect tangible asset evidence.",
      actionTaken: `Score flagged for recalibration. Asset-to-score ratio: ${assetCount}:${score.toFixed(2)}.`,
    });
  }

  // Score inconsistent with HNWI type
  if (entity.type === "HNWI" && score < 0.15) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_analyst",
      category: "scoring",
      priority: "medium",
      title: "HNWI classification with sub-threshold score",
      description:
        `Entity is classified as HNWI but has a Bayesian score of ${score.toFixed(3)}, ` +
        "below the 0.15 HNWI floor. Either the classification is premature or the score has not been updated " +
        "after recent asset/registry ingestion. Re-run Bayesian update with current asset evidence.",
      actionTaken: "Score-vs-type inconsistency logged for analyst review.",
    });
  }

  // Net worth not set but assets suggest significant value
  if (!entity.estimatedNetWorth && totalAssetValue > 1_000_000) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_analyst",
      category: "scoring",
      priority: "medium",
      title: "Net worth unset despite significant asset holdings",
      description:
        `Asset register shows ~$${(totalAssetValue / 1_000_000).toFixed(1)}M in registered assets, but ` +
        "estimatedNetWorth is null. Net worth is a key signal for prospect prioritisation and L4 path scoring. " +
        "Minimum estimate: set to 3× total registered asset value as a conservative floor.",
      actionTaken: `Recommended estimatedNetWorth floor: $${(totalAssetValue * 3 / 1_000_000).toFixed(1)}M.`,
    });
  }

  // Hot flag missing for high-scoring entity
  if (score >= 0.7 && !entity.isHot) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_analyst",
      category: "scoring",
      priority: "high",
      title: "High Bayesian score not reflected in hot-leads queue",
      description:
        `Score ${score.toFixed(3)} exceeds the 0.70 hot-lead threshold but isHot is false. ` +
        "This entity is invisible in the hot-leads sidebar and dashboard priority stack.",
      actionTaken: `isHot should be set to true — score ${score.toFixed(3)} ≥ 0.70 threshold.`,
    });
  }

  // Low entity value — no assets
  if (assetCount === 0 && entity.type === "HNWI") {
    suggestions.push({
      entityId: entity.id,
      persona: "data_analyst",
      category: "data_quality",
      priority: "medium",
      title: "HNWI with zero registered assets",
      description:
        "No asset records linked to this HNWI. Either assets haven't been ingested yet, " +
        "or the individual holds assets exclusively through corporate vehicles. " +
        "Run FAA ingestor and check SEC Schedule 13D for nominee holdings.",
      actionTaken: "Zero-asset HNWI flagged — recommend cross-reference with corporate subsidiaries.",
    });
  }

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persona 3 — Intelligence Systems Analyst
//
// Evaluates the entity across the full 5-layer Core Hybrid Architecture:
//
//  Layer 1 — Hybrid Retrieval (BM25 + Semantic + Graph)
//    Fast retrieval layer combining BM25 keyword search, TF-IDF semantic search,
//    and direct graph traversal (BFS shortest-path). Results fused via RRF.
//    Cached in Redis. Entities with no nationality, no linked assets, and no notes
//    are invisible to all three mechanisms and cannot be surfaced by any query.
//
//  Layer 2 — Multi-Agent Reasoning (Planner→Retriever→Analyst→Critic)
//    agent-orchestrator.ts runs four deterministic agents in sequence:
//    Planner (intent/geo/asset extraction) → Retriever (expandQuery + hybridSearch
//    + SQL pre-filter) → Analyst (RRF score fusion + Bayesian weighting) → Critic
//    (relevance pruning + final re-ranking). A complete pipeline ends with a
//    generated pitch. Incomplete pipelines leave the entity without an outreach
//    strategy. MCTS is Layer 4, not a sub-component of the Critic.
//
//  Layer 3 — Iterative Query Expansion + Relevance Feedback
//    expandQuery(rawQuery, plan) appends asset synonyms (ASSET_EXPANSION — e.g.
//    "jet" → "aircraft turbofan turboprop helicopter rotorcraft tail"), canonical
//    location forms from GEO_MAP (e.g. "texas" → also "TX"), name hints, and
//    intent background terms (INTENT_EXPANSION). This enriched string then hits
//    BM25 + TF-IDF cosine in hybridSearch. Single-pass (no iterative loop yet).
//
//  Layer 4 — MCTS Deep Path Exploration (UCT · 120 rollouts)
//    mcts-agent.ts uses UCT tree search to find optimal warm-introduction paths
//    through the relationship graph. Reward function based solely on real
//    relationship types and personal identifiers from registries (direct ownership
//    > shared assets > gatekeepers). Seeded by BFS path from Layer 1. Without
//    sessions, the outreach layer is blind. Stale sessions may route through
//    intermediaries displaced by new ingestion.
//
//  Layer 5 — Bayesian-UCB Optimization
//    bayesian-scorer.ts uses Bayesian log-odds updates on registry signals to
//    produce a prior estimate per entity. UCB1 inside MCTS (Layer 4) balances
//    exploitation of high-scoring paths vs. exploration of unvisited nodes.
//    If an entity's score hasn't been updated since creation, neither the Bayesian
//    update loop nor the UCB explorer has acted on it.
// ─────────────────────────────────────────────────────────────────────────────

async function runIntelSystemsAnalyst(entity: Entity): Promise<ImprovementSuggestion[]> {
  const suggestions: ImprovementSuggestion[] = [];

  // Corp/Trust are property vehicles — they don't get MCTS sessions.
  // Only HNWI and Gatekeeper are direct outreach targets.
  const isDirectOutreachTarget = entity.type === "HNWI" || entity.type === "Gatekeeper";

  // ── Fetch data needed across all four layers ────────────────────────────────
  const [sessions, relRow, assetRow] = await Promise.all([
    db.select()
      .from(researchSessionsTable)
      .where(eq(researchSessionsTable.targetEntityId, entity.id))
      .orderBy(sql`${researchSessionsTable.createdAt} desc`)
      .limit(5),
    db.select({ count: count() })
      .from(relationshipsTable)
      .where(eq(relationshipsTable.sourceEntityId, entity.id)),
    db.select({ count: count() })
      .from(assetsTable)
      .where(eq(assetsTable.ownerEntityId, entity.id)),
  ]);

  const relCount   = Number(relRow[0]?.count ?? 0);
  const assetCount = Number(assetRow[0]?.count ?? 0);
  const sources    = parseJsonSafe<string[]>(entity.sourceRegistries, []);
  const metadata   = parseJsonSafe<Record<string, unknown>>(entity.metadata, {});
  const score      = entity.bayesianScore;

  // ── Layer 4: MCTS Deep Path Exploration ────────────────────────────────────

  if (sessions.length === 0 && isDirectOutreachTarget) {
    suggestions.push({
      entityId: entity.id,
      persona: "intel_systems_analyst",
      category: "outreach",
      priority: "high",
      title: "Hybrid stack not activated — no intelligence session exists",
      description:
        "This entity has never been processed by the full hybrid pipeline. Without a Hybrid Research session, " +
        "the UCT path-finder, agent orchestrator, and pitch synthesiser have no baseline to work from. " +
        "The Pipeline CRM card is empty, the graph layer has no path scores, and outreach is unguided. " +
        "Start a session via the Intel Terminal to activate the Planner → Retriever → Analyst → Critic → Pitch pipeline.",
      actionTaken: "Entity flagged as pipeline-cold. Queued for Hybrid Research session at next cycle.",
    });
  } else if (sessions.length > 0) {
    const latest  = sessions[0]!;
    const ageDays = ageInDays(latest.createdAt.toISOString());

    if (ageDays > 30) {
      suggestions.push({
        entityId: entity.id,
        persona: "intel_systems_analyst",
        category: "outreach",
        priority: "medium",
        title: `Intelligence session is ${Math.floor(ageDays)}d stale — hybrid re-run recommended`,
        description:
          `Last pipeline run was ${Math.floor(ageDays)} days ago. The hybrid search index, graph centrality scores, ` +
          "and UCT tree are all anchored to the entity graph at that point in time. New FAA, HMLR, and HNWI " +
          "ingestion runs will have added nodes and edges that the current session never evaluated. " +
          "A fresh run will re-execute BM25 + graph RRF fusion and recalculate UCT-optimal paths through the updated graph.",
        actionTaken: `Session age ${Math.floor(ageDays)}d logged. Flagged for hybrid re-run.`,
      });
    }

    const pathScore = latest.pathScore ?? 0;
    if (pathScore < 0.3 && sessions.length < 3) {
      suggestions.push({
        entityId: entity.id,
        persona: "intel_systems_analyst",
        category: "outreach",
        priority: "medium",
        title: "UCT path score below threshold — Bayesian-UCB exploration needed",
        description:
          `Best UCT path score is ${pathScore.toFixed(3)} across ${sessions.length} simulation(s). ` +
          "The UCB1 exploration term (√(ln N / n)) favours unvisited branches — but only if more simulations run. " +
          "With fewer than 3 sessions, the Monte Carlo estimate has high variance and may have converged on a local optimum. " +
          "Increasing simulation depth and running the hybrid graph search on neighbouring nodes " +
          "(board co-members, club affiliates, aviation FBO contacts) may surface a higher-confidence warm path.",
        actionTaken: `UCT score ${pathScore.toFixed(3)} < 0.30 threshold. Depth-first re-run recommended.`,
      });
    }

    // Agent orchestrator pipeline completeness — pitch is the final synthesis step
    const noGeneratedPitch = sessions.every(s => !s.generatedPitch);
    if (noGeneratedPitch) {
      suggestions.push({
        entityId: entity.id,
        persona: "intel_systems_analyst",
        category: "outreach",
        priority: "medium",
        title: "Agent pipeline incomplete — Critic stage has no synthesised output",
        description:
          "Research sessions exist but the Critic agent has not produced a final outreach pitch. " +
          "The pipeline runs: Planner (query intent) → Retriever (BM25 + graph hybrid search) → " +
          "Analyst (RRF score fusion + Bayesian weighting) → Critic (relevance pruning) → Pitch synthesis. " +
          "The last stage converts the winning path context and mutual-interest signals into a ready-to-deploy " +
          "opening message. Complete the pipeline via the Intel Terminal → Generate Pitch.",
        actionTaken: "Pipeline incomplete — pitch synthesis stage not reached.",
      });
    }
  }

  // ── Layer 1: Hybrid Retrieval signal coverage ──────────────────────────────

  // Thin source registry = weak BM25 + graph anchor for cross-entity search
  if (sources.length <= 1 && score < 0.5) {
    suggestions.push({
      entityId: entity.id,
      persona: "intel_systems_analyst",
      category: "data_quality",
      priority: "medium",
      title: "Weak hybrid search anchor — single source limits BM25 and graph signals",
      description:
        `Entity has ${sources.length === 0 ? "no source registries" : `only one source (${sources[0]})`} ` +
        "and a sub-0.5 Bayesian score. The hybrid search layer (BM25 + TF-IDF cosine + graph centrality via RRF) " +
        "relies on registry metadata, name tokens, and graph edges to rank this entity in cross-entity queries. " +
        "With sparse anchors, this entity scores near zero in BM25 and has low graph centrality — " +
        "it will be invisible in operator deep-search and agent retrieval passes. " +
        "Add a second registry source (GLEIF, BRREG, SEC EDGAR, or Companies House) to strengthen all three layers.",
      actionTaken: "Thin-anchor flag set. Cross-registry enrichment recommended to improve hybrid search recall.",
    });
  }

  // Sparse metadata + no notes + no assets = invisible to all three expansion paths
  //
  // expandQuery() operates on the *search query*, not entity fields — but this entity
  // still needs to be *findable* via the expanded query. It won't be if:
  //   • no nationality  → SQL pre-filter (location ILIKE) never includes it
  //   • no linked assets → ASSET_EXPANSION synonyms produce no matching records
  //   • no notes/metadata → TF-IDF cosine vector is near-zero; BM25 matches only bare name
  const hasRichMetadata = Object.keys(metadata).length > 3;
  const hasNotes        = entity.notes && entity.notes.trim().length >= 50;
  if (!hasRichMetadata && !hasNotes && assetCount === 0) {
    suggestions.push({
      entityId: entity.id,
      persona: "intel_systems_analyst",
      category: "data_quality",
      priority: "medium",
      title: "Invisible to query expansion — no asset, location, or text anchors",
      description:
        "The Retriever's single-pass expandQuery() enriches the search string with asset synonyms " +
        "(ASSET_EXPANSION: e.g. 'jet' → 'aircraft turbofan helicopter…'), canonical location forms from GEO_MAP, " +
        "name hints, and intent background terms (INTENT_EXPANSION: e.g. 'owner HNWI director…'). " +
        "However, this entity is still unreachable via any of those paths: " +
        "(1) no nationality — the SQL pre-filter's location ILIKE clause never selects it; " +
        "(2) no linked assets — ASSET_EXPANSION synonyms match no records in the assets table; " +
        "(3) no notes and sparse metadata — TF-IDF cosine vector is near-zero and BM25 can only match the bare name. " +
        "To surface this entity in operator deep-search and agent retrieval passes, set nationality, " +
        "link at least one asset (or run the relevant ingestor), and add ≥50 chars of briefing notes.",
      actionTaken: "Zero-anchor flag — entity unreachable via asset synonym, location, and semantic expansion paths.",
    });
  }

  // ── Layer 5: Bayesian-UCB convergence ──────────────────────────────────────

  // Hot lead with no pipeline run — UCB exploitation hasn't started
  if (score >= 0.7 && sessions.length === 0 && isDirectOutreachTarget) {
    suggestions.push({
      entityId: entity.id,
      persona: "intel_systems_analyst",
      category: "outreach",
      priority: "high",
      title: "High-probability target — UCB exploitation not yet initiated",
      description:
        `Bayesian score ${score.toFixed(3)} places this entity in the top tier, ` +
        "but no Hybrid Research session has been run. The UCB1 formula rewards exploitation of high-scoring nodes " +
        "(high reward / low visit count = maximum UCB value). This entity has the highest possible UCB score " +
        "— it should be the first target the L4 UCT tree expands. " +
        "Running a session will immediately anchor the tree at this node and begin path scoring " +
        "through its relationship graph.",
      actionTaken: `UCB exploitation flag: score ${score.toFixed(3)} with 0 visits. Immediate Hybrid Research run recommended.`,
    });
  }

  // Score frozen since creation — feedback loop never ran
  const neverUpdated =
    entity.updatedAt &&
    entity.createdAt &&
    Math.abs(new Date(entity.updatedAt).getTime() - new Date(entity.createdAt).getTime()) < 60_000;

  if (neverUpdated && score > 0 && relCount > 0) {
    suggestions.push({
      entityId: entity.id,
      persona: "intel_systems_analyst",
      category: "scoring",
      priority: "low",
      title: "Bayesian score frozen at ingestion prior — no feedback loop has run",
      description:
        "Entity has relationship edges in the graph but its Bayesian score has never been updated since creation. " +
        "The Bayesian scorer (bayesian-scorer.ts) applies log-odds updates for each signal: asset count, " +
        "registry corroboration, relationship depth, and contact vectors. With graph edges present, " +
        "a score update pass should shift the posterior meaningfully. " +
        "Run the persona improvement loop to trigger a re-score, or update the entity record to force a " +
        "Bayesian recalculation with current evidence.",
      actionTaken: "Score-frozen flag: updatedAt ≈ createdAt despite graph edges. Bayesian re-score recommended.",
    });
  }

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persona 4 — Business Engineer
// Focuses on corporate structure and relationship network depth
// ─────────────────────────────────────────────────────────────────────────────

async function runBusinessEngineer(entity: Entity): Promise<ImprovementSuggestion[]> {
  const suggestions: ImprovementSuggestion[] = [];

  const [relRow] = await db
    .select({ count: count() })
    .from(relationshipsTable)
    .where(eq(relationshipsTable.sourceEntityId, entity.id));

  const relCount = Number(relRow?.count ?? 0);
  const metadata = parseJsonSafe<Record<string, unknown>>(entity.metadata, {});

  // Corp/Trust are property vehicles — their graph edges come from CH co-director detection,
  // not personal networking. Flag isolation differently by type.
  const isDirectOutreachTarget = entity.type === "HNWI" || entity.type === "Gatekeeper";

  if (relCount === 0) {
    if (isDirectOutreachTarget) {
      suggestions.push({
        entityId: entity.id,
        persona: "business_engineer",
        category: "structure",
        priority: "high",
        title: "Isolated node — no relationships mapped",
        description:
          "Entity has no relationship edges in the graph. Isolated nodes cannot benefit from Hybrid Research path-finding " +
          "and are invisible in the Network Graph view. " +
          "Immediate actions: link to known employers/directorships (SEC DEF 14A, Companies House); " +
          "map to private-club memberships; connect to asset-management vehicles (trusts, SPVs).",
        actionTaken: "Zero-relationship flag set — graph integration required.",
      });
    } else {
      // Corporation / Trust — edges come from CH co-director detection, not individual networking
      suggestions.push({
        entityId: entity.id,
        persona: "business_engineer",
        category: "structure",
        priority: "low",
        title: "Corporate vehicle has no relationship edges yet",
        description:
          `${entity.type} entity has no graph edges. Edges for corporate vehicles are built by the ` +
          "CH Co-Directors detection pass (shared directors → SHARED_DIRECTOR edges) and the " +
          "corporate name-series clustering (CORPORATE_SERIES edges). " +
          "Run both passes from the Data Sources page to populate the graph.",
        actionTaken: "Corporate vehicle edge-gap logged — run CH co-directors + name cluster detection.",
      });
    }
  } else if (relCount < 3) {
    suggestions.push({
      entityId: entity.id,
      persona: "business_engineer",
      category: "structure",
      priority: "medium",
      title: `Thin network — only ${relCount} relationship(s) mapped`,
      description:
        `Entity has only ${relCount} relationship edge(s). Wealthy individuals typically sit on 3–8 boards ` +
        "and participate in multiple club/investment networks. " +
        "Enrich via: directorship filings (SEC, Companies House), co-investment disclosures, alumni networks.",
      actionTaken: `Relationship depth score: ${relCount}/5 (sparse).`,
    });
  }

  // Check for corporate vehicle relationships
  const corporateKeys = ["employer", "board", "directorship", "trustee", "nominee", "orgnr", "companyname", "rolecode", "groupcode"];
  const hasCorporateHint = corporateKeys.some(
    k => JSON.stringify(metadata).toLowerCase().includes(k)
  );
  if (entity.type === "HNWI" && relCount < 2 && !hasCorporateHint) {
    suggestions.push({
      entityId: entity.id,
      persona: "business_engineer",
      category: "structure",
      priority: "medium",
      title: "No corporate vehicle linkage detected",
      description:
        "HNWI with no visible corporate structure. Ultra-HNW individuals almost always hold assets through " +
        "offshore trusts, family offices, or SPV holding companies. " +
        "Check: BVI company registers, Cayman Islands filings, UK LLP disclosure registers, " +
        "SEC Schedule 13G nominee block-holder filings.",
      actionTaken: "Corporate-vehicle gap noted — offshore structure search recommended.",
    });
  }

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persona 5 — UX Designer
// Focuses on profile display completeness and visual data richness
// ─────────────────────────────────────────────────────────────────────────────

async function runUxDesigner(entity: Entity): Promise<ImprovementSuggestion[]> {
  const suggestions: ImprovementSuggestion[] = [];

  const mappableAssets = await db
    .select({ id: assetsTable.id })
    .from(assetsTable)
    .where(
      sql`${assetsTable.ownerEntityId} = ${entity.id} AND ${assetsTable.latitude} IS NOT NULL`
    )
    .limit(1);

  // HMLR / Land Registry entities ARE the property record — their address is the asset.
  // Flagging them for missing GPS coordinates is noise: HMLR bulk CSV has no coordinates,
  // and the property address IS shown on the profile. Skip geo flag for these entities.
  const entitySources: string[] = parseJsonSafe(entity.sourceRegistries, []);
  const isLandRegistryEntity = entitySources.some(
    s => s.toLowerCase().includes("land registry") || s.toLowerCase().includes("hmlr") || s.toLowerCase().includes("price paid")
  );

  if (mappableAssets.length === 0 && !isLandRegistryEntity) {
    suggestions.push({
      entityId: entity.id,
      persona: "ux_designer",
      category: "display",
      priority: "medium",
      title: "No geolocated assets — profile map is empty",
      description:
        "The Apex Profile mini-map needs at least one asset with GPS coordinates. " +
        "Without it, the profile shows a blank grey tile. " +
        "Geotag registered assets using known addresses: mansion postcodes → lat/lon via geocoding, " +
        "marina berth locations, airport ICAO codes for aircraft.",
      actionTaken: "Geo-missing flag set — coordinate enrichment recommended for map display.",
    });
  }

  if (!entity.notes || entity.notes.trim().length < 50) {
    suggestions.push({
      entityId: entity.id,
      persona: "ux_designer",
      category: "display",
      priority: "low",
      title: "Profile notes too sparse for effective operator briefing",
      description:
        "The notes field is empty or very short. Operators using the profile during live outreach prep " +
        "need a quick situational brief: background, known interests, sporting affiliations, known associates, " +
        "public personality traits. A 100–300 word brief significantly improves outreach personalisation.",
      actionTaken: "Notes quality flag: < 50 chars. Briefing notes recommended.",
    });
  }

  const name = entity.name.trim();
  if (name.split(" ").length < 2) {
    suggestions.push({
      entityId: entity.id,
      persona: "ux_designer",
      category: "display",
      priority: "low",
      title: "Single-word name — may cause display and matching ambiguity",
      description:
        `Entity name "${name}" has only one word. Full names (given + family) are required for ` +
        "disambiguation in search results and personalised pitch generation. " +
        "Cross-check source filings for the full registered name.",
      actionTaken: "Single-word name logged — full name lookup recommended.",
    });
  }

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persona 6 — Architect
// Focuses on classification accuracy and deduplication
// ─────────────────────────────────────────────────────────────────────────────

async function runArchitect(entity: Entity): Promise<ImprovementSuggestion[]> {
  const suggestions: ImprovementSuggestion[] = [];

  // Type-vs-name heuristic checks
  const nameLower = entity.name.toLowerCase();
  const corpTerms = [" ltd", " llc", " inc", " corp", " plc", " gmbh", " sa ", " ag ", " bv", " holding", " group", " fund", " trust", " capital", " asset"];
  const looksLikeCorp = corpTerms.some(t => nameLower.includes(t));

  if (entity.type === "HNWI" && looksLikeCorp) {
    suggestions.push({
      entityId: entity.id,
      persona: "architect",
      category: "classification",
      priority: "high",
      title: "HNWI classification may be incorrect — name suggests corporate entity",
      description:
        `Entity name "${entity.name}" contains corporate/legal suffixes but is typed as HNWI. ` +
        "Misclassification affects L4 path weighting, graph clustering, and CRM track assignment. " +
        "Review the original registry filing to determine whether this is an individual or a legal vehicle.",
      actionTaken: "Classification anomaly flag: name pattern inconsistent with HNWI type.",
    });
  }

  const personTerms = ["mr ", "ms ", "mrs ", "dr ", "sir ", "lord ", "baron", "count"];
  const looksLikePerson = personTerms.some(t => nameLower.startsWith(t));
  if (entity.type === "Corporation" && looksLikePerson) {
    suggestions.push({
      entityId: entity.id,
      persona: "architect",
      category: "classification",
      priority: "medium",
      title: "Corporation classification may be incorrect — name suggests an individual",
      description:
        `Entity name "${entity.name}" appears to be a personal name (title prefix detected) but is classified ` +
        "as Corporation. If this is an individual, reclassify to HNWI or Gatekeeper for correct graph placement.",
      actionTaken: "Classification anomaly flag: personal-name pattern in Corporation entity.",
    });
  }

  // Check for potential near-duplicate by name fragment
  const firstWord = entity.name.split(" ")[0];
  if (firstWord && firstWord.length > 5) {
    const potentialDuplicates = await db
      .select({ id: entitiesTable.id, name: entitiesTable.name })
      .from(entitiesTable)
      .where(
        sql`${entitiesTable.id} != ${entity.id} AND lower(${entitiesTable.name}) LIKE ${`%${firstWord.toLowerCase()}%`}`
      )
      .limit(3);

    if (potentialDuplicates.length > 0) {
      const dupNames = potentialDuplicates.map(d => `"${d.name}" (id:${d.id})`).join(", ");
      suggestions.push({
        entityId: entity.id,
        persona: "architect",
        category: "classification",
        priority: "medium",
        title: "Potential duplicate entity detected",
        description:
          `Name fragment "${firstWord}" matches ${potentialDuplicates.length} other entity record(s): ${dupNames}. ` +
          "Duplicate entities fragment the graph, split asset ownership, and dilute Bayesian scores. " +
          "Review each match and merge if they refer to the same individual/corporation.",
        actionTaken: `Potential duplicate candidates flagged: ${potentialDuplicates.map(d => d.id).join(", ")}.`,
      });
    }
  }

  // Metadata structure check
  const metadataStr = entity.metadata ?? "{}";
  const hasMetadata = metadataStr !== "{}" && metadataStr.trim().length > 10;
  if (!hasMetadata) {
    suggestions.push({
      entityId: entity.id,
      persona: "architect",
      category: "classification",
      priority: "low",
      title: "Metadata payload is empty — enrichment context missing",
      description:
        "The metadata JSON blob is empty or minimal. Metadata carries structured enrichment: " +
        "source registry filing IDs, jurisdiction codes, company numbers, title/prefix, SEC CIK, " +
        "GLEIF LEI, and other machine-readable identifiers used by search and graph ranking.",
      actionTaken: "Empty-metadata flag logged — structured enrichment recommended.",
    });
  }

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persona 7 — Data Integrity Auditor
//
// ABSOLUTE RULE: Zero synthetic or mock data. Every entity in ApexFinder Pro
// must trace to a named public registry (FAA, SEC EDGAR, UK Companies House,
// BRREG Norway, HMLR). This persona is the enforcement layer — it scans for
// fabricated names, test contact details, synthetic asset identifiers, missing
// provenance, and any metadata flag that suggests the record was generated
// rather than ingested from a real primary source.
//
// A flag from this persona is a data-integrity violation, not a suggestion.
// Violations should be resolved by deleting the record and re-ingesting from
// a verified source, or by tracing the existing record to a real registry URL.
// ─────────────────────────────────────────────────────────────────────────────

async function runDataIntegrityAuditor(entity: Entity): Promise<ImprovementSuggestion[]> {
  const suggestions: ImprovementSuggestion[] = [];
  const metadata = parseJsonSafe<Record<string, unknown>>(entity.metadata, {});
  const sources: string[] = parseJsonSafe(entity.sourceRegistries, []);
  const metaRaw = (entity.metadata ?? "").toLowerCase();

  // ── 1. Explicit mock / synthetic flags in metadata ────────────────────────
  // Any metadata key that signals AI generation or placeholder insertion is a
  // hard violation. Real ingest pipelines never write these keys.
  const SYNTHETIC_KEYS = [
    "\"ismock\"", "\"synthetic\"", "\"fake\":",
    "\"placeholder\"", "\"testdata\"", "\"mockdata\"", "\"generated\":",
    "\"is_mock\"", "\"is_fake\"", "\"is_synthetic\"",
  ];
  if (SYNTHETIC_KEYS.some(k => metaRaw.includes(k))) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_integrity_auditor",
      category: "integrity",
      priority: "high",
      title: "Synthetic-data flag in metadata — integrity violation",
      description:
        "Entity metadata contains a key associated with mock or synthetic data generation " +
        "(isMock, synthetic, fake, placeholder, testData, mockData, generated). " +
        "All records must originate exclusively from FAA, SEC EDGAR, UK Companies House, BRREG, or HMLR. " +
        "Action: delete this entity and re-ingest from a real registry URL.",
      actionTaken: "INTEGRITY VIOLATION — synthetic flag detected. Entity quarantined for deletion.",
    });
  }

  // ── 2. No source registry and no provenance flag ──────────────────────────
  // Without a traceable origin the record is unverifiable and may be synthetic.
  const hasProvenance =
    sources.length > 0 ||
    metadata.liveSource === true ||
    metadata.westernIngest === true ||
    !!metadata.source ||
    !!metadata.orgnr ||   // BRREG
    !!metadata.formType;  // SEC EDGAR
  if (!hasProvenance) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_integrity_auditor",
      category: "integrity",
      priority: "high",
      title: "No source provenance — record cannot be verified as real",
      description:
        "Entity has no sourceRegistries, no liveSource flag, and no registry-specific metadata " +
        "(formType / orgnr / source). Without a traceable origin (FAA N-number, SEC EDGAR CIK, " +
        "UK CH company number, BRREG orgnr, or HMLR title number) this record is unverifiable. " +
        "Either re-ingest from a public registry or delete.",
      actionTaken: "INTEGRITY FLAG — provenance missing. Manual origin trace required before use.",
    });
  }

  // ── 3. Placeholder / test entity names ───────────────────────────────────
  const FAKE_NAME_RE = /^(test(\s+entity)?|sample(\s+entity)?|example(\s+entity)?|placeholder|mock(\s+entity)?|dummy(\s+entity)?|foo|bar|baz|john\s+doe|jane\s+doe|n\/a|unknown|entity\s+\d+|lorem ipsum|temp\s*\d*)$/i;
  if (FAKE_NAME_RE.test(entity.name.trim())) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_integrity_auditor",
      category: "integrity",
      priority: "high",
      title: `Entity name "${entity.name}" is a known placeholder`,
      description:
        "This name matches a common placeholder or test-data pattern. " +
        "Real registry records always carry a registered legal name, personal name, or aircraft N-number. " +
        "Delete and re-ingest from FAA, SEC EDGAR, Companies House, BRREG, or HMLR.",
      actionTaken: "INTEGRITY VIOLATION — placeholder name detected. Delete and re-ingest.",
    });
  }

  // ── 4. Fake / generated contact email ────────────────────────────────────
  if (entity.email) {
    const FAKE_EMAIL_RE = /^(test@|fake@|example@|placeholder@|noreply@|no-reply@|dummy@|sample@|mock@|admin@example|user@test|info@test)/i;
    const FAKE_DOMAIN_RE = /@(example\.|test\.|fake\.|localhost|placeholder\.|dummy\.|invalid\.)/i;
    if (FAKE_EMAIL_RE.test(entity.email) || FAKE_DOMAIN_RE.test(entity.email)) {
      suggestions.push({
        entityId: entity.id,
        persona: "data_integrity_auditor",
        category: "integrity",
        priority: "high",
        title: "Contact email matches synthetic / generated pattern",
        description:
          `Email "${entity.email}" matches a placeholder pattern (test@, fake@, example.com, ` +
          "@test.*, @placeholder.*, noreply@, etc.). " +
          "Only real, registry-sourced or operator-verified email addresses are permitted. " +
          "Remove this value; re-add only when sourced from a confirmed public filing.",
        actionTaken: "INTEGRITY VIOLATION — fake email detected. Contact field must be cleared.",
      });
    }
  }

  // ── 5. Fake phone numbers ─────────────────────────────────────────────────
  if (entity.phone) {
    const stripped = entity.phone.replace(/[\s\-().+]/g, "");
    const FAKE_PHONE_RE = /^(555\d{7}|0{7,}|1{7,}|9{7,}|1234567|0000000|9999999)/;
    if (FAKE_PHONE_RE.test(stripped) || /^(\d)\1{6,}$/.test(stripped)) {
      suggestions.push({
        entityId: entity.id,
        persona: "data_integrity_auditor",
        category: "integrity",
        priority: "high",
        title: "Phone number is a known fake pattern",
        description:
          `Phone "${entity.phone}" matches a known synthetic-data pattern (555-xxxx, ` +
          "all-same-digit, sequential, or zero-padded). " +
          "Only real phone numbers from verified registry filings are permitted.",
        actionTaken: "INTEGRITY VIOLATION — fake phone detected. Contact field must be cleared.",
      });
    }
  }

  // ── 6. Asset identifier integrity check ──────────────────────────────────
  // Synthetic asset identifiers (TEST-, MOCK-, FAKE-, etc.) mean an ingest
  // pipeline generated placeholder records instead of real registry data.
  const entityAssets = await db
    .select({ id: assetsTable.id, identifier: assetsTable.identifier, category: assetsTable.category })
    .from(assetsTable)
    .where(eq(assetsTable.ownerEntityId, entity.id));

  const FAKE_ID_RE = /^(TEST[-_]|MOCK[-_]|FAKE[-_]|SAMPLE[-_]|GENERATED[-_]|PLACEHOLDER[-_]|DUMMY[-_]|FOO[-_]|BAR[-_])/i;
  const fakeAssets = entityAssets.filter(a => a.identifier && FAKE_ID_RE.test(a.identifier));
  if (fakeAssets.length > 0) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_integrity_auditor",
      category: "integrity",
      priority: "high",
      title: `${fakeAssets.length} asset(s) carry synthetic identifiers`,
      description:
        `Asset identifier(s) ${fakeAssets.slice(0, 3).map(a => `"${a.identifier}"`).join(", ")} ` +
        "start with TEST-, MOCK-, FAKE-, SAMPLE-, GENERATED-, or PLACEHOLDER-. " +
        "Real assets must carry genuine registry identifiers: FAA N-numbers, HMLR title numbers, " +
        "ISIN codes, or vessel IMO numbers. Delete these assets and re-ingest from source.",
      actionTaken: `INTEGRITY VIOLATION — ${fakeAssets.length} synthetic-identifier asset(s) flagged for deletion.`,
    });
  }

  // ── 7. Hot lead still pending enrichment — incomplete real-data pipeline ──
  // Not a fabrication violation, but a real-data completeness gap for high-
  // priority targets: registry record exists but the enrichment pass that adds
  // contact details, officer data, and relationship edges hasn't run.
  if (
    metadata.needsEnrichment === true &&
    (entity.bayesianScore ?? 0) >= 0.70 &&
    sources.length > 0
  ) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_integrity_auditor",
      category: "integrity",
      priority: "medium",
      title: "Hot lead real-data pipeline incomplete — enrichment pending",
      description:
        `Entity is a hot lead (score ${(entity.bayesianScore ?? 0).toFixed(3)}) sourced from ` +
        `${sources.join(", ")}, but metadata.needsEnrichment=true. ` +
        "The record is real but incomplete. Run Companies House officer enricher (UK entities), " +
        "EDGAR stock assets creator, or populate-notes to fill the gaps. " +
        "Until enrichment completes, contact confidence and relationship edges are artificially low.",
      actionTaken: "Real-data completeness gap logged. CH enricher / EDGAR lookup queued.",
    });
  }

  // ── 8. Provenance flag missing on live-registry entity ───────────────────
  // Low priority — the data is real, but the liveSource marker is absent,
  // which weakens automated integrity checks in future pipeline runs.
  const LIVE_REGISTRIES = ["sec edgar", "faa", "companies house", "brreg", "hmlr", "land registry"];
  const isLiveRegistry = sources.some(s =>
    LIVE_REGISTRIES.some(r => s.toLowerCase().includes(r))
  );
  if (
    isLiveRegistry &&
    metadata.liveSource !== true &&
    metadata.westernIngest !== true &&
    !metadata.orgnr
  ) {
    suggestions.push({
      entityId: entity.id,
      persona: "data_integrity_auditor",
      category: "integrity",
      priority: "low",
      title: "Live-registry entity missing liveSource provenance marker",
      description:
        `Source registry "${sources[0]}" is a verified live public registry, but metadata.liveSource ` +
        "is not set. The provenance marker lets automated integrity scans confirm this record " +
        "entered via the real ingest path rather than a manual or scripted insert. " +
        "Update metadata to add liveSource:true and lastVerified timestamp.",
      actionTaken: "Provenance-marker gap logged. No data integrity risk — low priority housekeeping.",
    });
  }

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persona 8 — Hybrid Architecture Auditor
// Audits all 5 layers of the Core Hybrid Architecture independently.
// Intel Systems Analyst focuses on MCTS; this persona ensures the FULL stack
// is firing for every entity: L1 hybrid search, L2 multi-agent pipeline,
// L3 query expansion, L4 MCTS path exploration, L5 Bayesian-UCB optimisation.
// ─────────────────────────────────────────────────────────────────────────────

async function runHybridArchitectureAuditor(entity: Entity): Promise<ImprovementSuggestion[]> {
  const suggestions: ImprovementSuggestion[] = [];

  const [sessions, relRow, assetRow] = await Promise.all([
    db.select()
      .from(researchSessionsTable)
      .where(eq(researchSessionsTable.targetEntityId, entity.id))
      .orderBy(sql`${researchSessionsTable.createdAt} desc`)
      .limit(10),
    db.select({ count: count() })
      .from(relationshipsTable)
      .where(eq(relationshipsTable.sourceEntityId, entity.id)),
    db.select({ count: count() })
      .from(assetsTable)
      .where(eq(assetsTable.ownerEntityId, entity.id)),
  ]);

  const relCount   = Number(relRow[0]?.count ?? 0);
  const assetCount = Number(assetRow[0]?.count ?? 0);
  const sources    = parseJsonSafe<string[]>(entity.sourceRegistries, []);
  const metadata   = parseJsonSafe<Record<string, unknown>>(entity.metadata, {});
  const score      = entity.bayesianScore;
  const hasNotes   = !!entity.notes && entity.notes.trim().length >= 50;
  const hasNat     = !!entity.nationality && entity.nationality.trim().length > 0;
  const hasRichMetadata = Object.keys(metadata).length > 3;
  // Corp/Trust are property vehicles — they don't get MCTS sessions.
  const isDirectOutreachTarget = entity.type === "HNWI" || entity.type === "Gatekeeper";

  // ── L1: Hybrid Semantic + Keyword + Graph Search ───────────────────────────
  // Three components: BM25 keyword · TF-IDF cosine · graph traversal (RRF fusion)

  if (relCount === 0) {
    suggestions.push({
      entityId: entity.id,
      persona: "hybrid_architecture_auditor",
      category: "structure",
      priority: "high",
      title: "L1 graph traversal blind — entity has zero relationship edges",
      description:
        "The L1 hybrid search layer fuses three signals via Reciprocal Rank Fusion (RRF): BM25 keyword score, " +
        "TF-IDF cosine similarity, and graph traversal centrality. With zero relationship edges, the graph traversal " +
        "component contributes nothing — this entity always scores zero in the NetworkX graph layer of every query. " +
        "Fix: run 'Detect Relationship Clusters' (POST /relationships/auto-detect-clusters) and " +
        "'CH Co-Director Edges' (POST /relationships/auto-detect-ch-codirectors) from the Data Sources page. " +
        "Even one CORPORATE_SERIES or SHARED_DIRECTOR edge restores partial graph centrality for this entity.",
      actionTaken: "L1 graph traversal: 0 edges → contributes 0 to RRF graph component.",
    });
  }

  if (assetCount === 0 && !hasNotes && !hasRichMetadata) {
    suggestions.push({
      entityId: entity.id,
      persona: "hybrid_architecture_auditor",
      category: "data_quality",
      priority: "high",
      title: "L1 BM25 + TF-IDF near-zero — no asset text or briefing notes to index",
      description:
        "BM25 keyword search and TF-IDF cosine similarity both operate on token frequency in entity text fields " +
        "(name, notes, sourceRegistries, knownResidences, metadata). This entity has no registered assets " +
        `(0 records) and no briefing notes (${hasNotes ? "present" : "absent"}). Its BM25 term frequency vector ` +
        "and TF-IDF embedding are near-zero — it will be ranked at the bottom of every keyword and semantic query. " +
        "Fix: run 'Populate Notes' (POST /ingest/populate-notes) to fill briefing text from filing metadata, " +
        "or link an asset record via the relevant ingestor (FAA / Land Registry / EDGAR stock).",
      actionTaken: "L1 BM25+TF-IDF: near-zero term vector. Notes and asset enrichment recommended.",
    });
  }

  if (!hasNat && sources.length <= 1) {
    suggestions.push({
      entityId: entity.id,
      persona: "hybrid_architecture_auditor",
      category: "data_quality",
      priority: "medium",
      title: "L1 SQL pre-filter always skips this entity — no nationality or geo anchor",
      description:
        "The L1 Retriever applies a SQL pre-filter before hybrid scoring: `WHERE nationality ILIKE '%<location>%' " +
        "OR knownResidences ILIKE '%<location>%'`. This entity has no nationality set and only " +
        `${sources.length} source registry. Any geo-led query (e.g. 'UK investor', 'Norwegian director') ` +
        "will pre-filter this entity out before BM25 or graph scoring even runs. " +
        "Fix: set nationality from Companies House enrichment (POST /ingest/companies-house-enrich), " +
        "or cross-register with BRREG / SEC EDGAR to populate knownResidences.",
      actionTaken: "L1 geo pre-filter: no nationality anchor. Entity excluded from all geo-scoped queries.",
    });
  }

  // ── L2: Agentic Multi-Agent Reasoning (Planner → Retriever → Analyst → Critic) ──

  if (sessions.length === 0 && isDirectOutreachTarget) {
    suggestions.push({
      entityId: entity.id,
      persona: "hybrid_architecture_auditor",
      category: "outreach",
      priority: "high",
      title: "L2 multi-agent pipeline cold — Planner has never decomposed a query for this entity",
      description:
        "The L2 pipeline runs four agents in sequence: Planner (decomposes query intent into asset/geo/name filters), " +
        "Retriever (runs L1 hybrid search with expanded query), Analyst (validates against real ingested data, " +
        "applies signal boosts), Critic (re-ranks, removes noise, produces final output). None of these agents " +
        "have been invoked for this entity. The CRM has no pitch, the graph has no path score, and the " +
        "Bayesian-UCB layer (L5) has no session evidence to exploit. " +
        "Fix: trigger a research session from the Intel Terminal to activate all four agents.",
      actionTaken: "L2 pipeline: cold — 0 sessions, 0 agent invocations, 0 pitches.",
    });
  } else {
    const hasPitch = sessions.some(s => s.generatedPitch && s.generatedPitch.trim().length > 0);
    if (!hasPitch) {
      suggestions.push({
        entityId: entity.id,
        persona: "hybrid_architecture_auditor",
        category: "outreach",
        priority: "medium",
        title: "L2 Critic stage incomplete — sessions exist but no pitch synthesised",
        description:
          `${sessions.length} research session(s) on record, but the Critic agent has not produced a final pitch. ` +
          "The L2 pipeline: Planner → Retriever → Analyst → Critic → Pitch synthesis. The last stage converts " +
          "the Critic's re-ranked path context and mutual-interest signals into a deployable opening message. " +
          "Without a pitch, the CRM card is empty and outreach cannot proceed. " +
          "Fix: re-run the research session via the Intel Terminal — the current implementation calls orchestrate() " +
          "and appends the critiqueNote to the session record on every POST /research/run.",
        actionTaken: `L2 Critic: ${sessions.length} session(s), 0 pitches synthesised.`,
      });
    }
  }

  // ── L3: Iterative Query Expansion + Relevance Feedback ────────────────────
  // expandQuery() adds: ASSET_EXPANSION synonyms · GEO_MAP canonical forms ·
  // name hints from planner · INTENT_EXPANSION background terms

  const expansionBlocked = assetCount === 0 && !hasNat && sources.length === 0;
  if (expansionBlocked) {
    suggestions.push({
      entityId: entity.id,
      persona: "hybrid_architecture_auditor",
      category: "data_quality",
      priority: "medium",
      title: "L3 query expansion contributes nothing — all three expansion paths blocked",
      description:
        "The L3 expandQuery() function enriches every query before it hits the L1 hybrid search: " +
        "(1) ASSET_EXPANSION: appends asset-type synonyms only if this entity holds a matching asset record; " +
        "(2) GEO_MAP: appends canonical location forms only if entity.nationality is set; " +
        "(3) INTENT_EXPANSION: uses name hints from planner, which rely on sourceRegistries tokens. " +
        "This entity has 0 assets, no nationality, and 0 source registries — all three expansion paths return empty strings. " +
        "Expanded query = raw query. The retriever gets no extra signal, reducing recall by an estimated 30–50%. " +
        "Fix: ingest at least one asset, set nationality via CH enrichment, and ensure sourceRegistries is populated.",
      actionTaken: "L3 expansion: all three paths blocked (0 assets, no nationality, 0 registries).",
    });
  } else if (sessions.length > 0) {
    // Check if relevance feedback is producing any positive signal (path score > 0.45)
    const bestPathScore = Math.max(...sessions.map(s => s.pathScore ?? 0));
    if (bestPathScore < 0.45 && sessions.length >= 3) {
      suggestions.push({
        entityId: entity.id,
        persona: "hybrid_architecture_auditor",
        category: "outreach",
        priority: "low",
        title: "L3 relevance feedback stagnant — path scores below 0.45 after 3+ sessions",
        description:
          `Best path score across ${sessions.length} sessions: ${bestPathScore.toFixed(3)}. ` +
          "Relevance feedback in L3 works by using high-scoring paths (≥0.45) as anchors for subsequent " +
          "query expansion — they add confirmed graph neighbours and entity attributes to the next retrieval pass. " +
          "With all sessions below 0.45, the feedback loop has no positive signal to feed forward. " +
          "Root causes: (a) entity is isolated (0 graph edges), making the L4 reward function always low; " +
          "(b) entity has no contact vectors, reducing UCT warmth scores; " +
          "(c) asset-type synonyms are not matching any graph neighbours. " +
          "Fix: add relationship edges (cluster detect) and run CH enrichment to add contact vectors.",
        actionTaken: `L3 feedback: best path score ${bestPathScore.toFixed(3)} across ${sessions.length} sessions. Below 0.45 threshold.`,
      });
    }
  }

  // ── L4: Monte Carlo Tree Search — Deep Path Exploration ───────────────────
  // UCT selection · expansion · simulation · backpropagation
  // Reward = real relationship types + personal identifiers from registries

  if (sessions.length === 0 && score >= 0.6 && isDirectOutreachTarget) {
    suggestions.push({
      entityId: entity.id,
      persona: "hybrid_architecture_auditor",
      category: "outreach",
      priority: "high",
      title: "L4 UCT path-finding never run — high-value target has no path exploration",
      description:
        `Bayesian score ${score.toFixed(3)} places this entity in the high-value tier, ` +
        "but the L4 engine has never run a UCT tree search for this target. " +
        "L4 uses UCT formula: Q(v)/N(v) + C√(ln N_parent / N(v)). " +
        "The reward function scores path steps on real relationship types from registries " +
        "(direct ownership > shared assets > gatekeeper proximity > corporate co-membership). " +
        "Without a tree, there is no ranked warm-introduction path, no winning route to the CRM, " +
        "and the Bayesian-UCB layer (L5) has no visit counts to exploit. " +
        "Fix: run a Hybrid Research session from the Intel Terminal.",
      actionTaken: `L4: 0 UCT trees built. Score ${score.toFixed(3)} → immediate Hybrid Research session recommended.`,
    });
  } else if (sessions.length > 0) {
    const bestPath = Math.max(...sessions.map(s => s.pathScore ?? 0));
    if (bestPath < 0.35 && relCount === 0) {
      suggestions.push({
        entityId: entity.id,
        persona: "hybrid_architecture_auditor",
        category: "outreach",
        priority: "medium",
        title: "L4 UCT reward always near-zero — isolated entity has no real relationship paths",
        description:
          `Path score ${bestPath.toFixed(3)} across ${sessions.length} session(s). ` +
          "The L4 reward function assigns value based solely on real relationship types from ingested registries: " +
          "CORPORATE_SERIES (name-cluster), SHARED_DIRECTOR (CH co-directors), ASSET_CO_OWNER, GATEKEEPER_LINK. " +
          `This entity has ${relCount} edges — the L4 UCT tree expands into empty space and the simulation ` +
          "always backtracks to the root with near-zero reward. UCT selection cannot improve. " +
          "Fix: run 'Detect Relationship Clusters' to build CORPORATE_SERIES edges from name tokens, " +
          "then re-run the research session. Even 2–3 graph edges unlock multi-hop path finding.",
        actionTaken: `L4 reward: ${bestPath.toFixed(3)} — isolated node (${relCount} edges). Path finding blocked.`,
      });
    }
  }

  // ── L5: Bayesian Optimisation / UCB — Smart Direction Selection ───────────
  // Log-odds prior per entity · UCB1 inside MCTS (exploration constant √2) ·
  // Signal-weighted posterior: asset_count, corroboration, rel_depth, contact vectors

  const neverUpdated =
    entity.updatedAt &&
    entity.createdAt &&
    Math.abs(new Date(entity.updatedAt).getTime() - new Date(entity.createdAt).getTime()) < 60_000;

  if (neverUpdated && relCount > 0 && score > 0) {
    suggestions.push({
      entityId: entity.id,
      persona: "hybrid_architecture_auditor",
      category: "scoring",
      priority: "medium",
      title: "L5 Bayesian posterior frozen — graph evidence never fed back into score",
      description:
        "This entity has relationship edges but its Bayesian score has not been updated since creation " +
        "(updatedAt ≈ createdAt). The L5 Bayesian scorer (bayesian-scorer.ts) applies log-odds updates " +
        "for each signal: asset count (weight 0.8, LR 2.5), registry corroboration (0.6, 2.0), " +
        "relationship depth (0.5, 1.8), contact vectors (0.7, 3.0 / 0.4, 1.6). " +
        `With ${relCount} edges on record and score frozen at ${score.toFixed(3)}, the posterior has ` +
        "never incorporated the relationship evidence. UCB1 in L5 uses this score as the prior — " +
        "a stale prior biases the exploration tree toward or away from this entity incorrectly. " +
        "Fix: trigger a Bayesian re-score by re-running the persona improvement loop or syncing hot flags.",
      actionTaken: `L5 posterior: frozen at ${score.toFixed(3)} since creation despite ${relCount} graph edges.`,
    });
  }

  const hasAnyContactVector = !!(
    entity.email || entity.phone || entity.linkedinUrl ||
    (entity.knownResidences && entity.knownResidences.length > 2 && entity.knownResidences !== "[]")
  );
  // Only fire HIGH if truly contactless (no address either) AND high-value with sessions
  if (entity.contactConfidence === 0 && !hasAnyContactVector && score >= 0.65 && sessions.length >= 2) {
    suggestions.push({
      entityId: entity.id,
      persona: "hybrid_architecture_auditor",
      category: "outreach",
      priority: "high",
      title: "L5 UCB cannot exploit contact signal — zero contact confidence on high-value target",
      description:
        `Bayesian score ${score.toFixed(3)}, ${sessions.length} research sessions, but contactConfidence = 0 ` +
        "and no physical address on record. " +
        "The L5 UCB layer assigns a +0.15 warmth bonus in the L4 UCT formula for nodes with contactConfidence ≥ 50 " +
        "and +0.10 for any known email/phone. With all contact vectors absent, this entity gets no UCB exploitation bonus — " +
        "the tree treats it as a cold target even though the Bayesian score says it is high-value. " +
        "Fix: run Companies House enrichment or web OSINT to populate email, phone, or known address — " +
        "any one field raises contactConfidence ≥ 10 and unlocks the UCB warmth bonus.",
      actionTaken: `L5 UCB: fully contactless (score ${score.toFixed(3)}, ${sessions.length} sessions). UCB exploitation blocked.`,
    });
  } else if (entity.contactConfidence === 0 && hasAnyContactVector && score >= 0.65 && sessions.length >= 2) {
    suggestions.push({
      entityId: entity.id,
      persona: "hybrid_architecture_auditor",
      category: "scoring",
      priority: "low",
      title: "L5 contactConfidence stale — physical address exists but score not recomputed",
      description:
        `Bayesian score ${score.toFixed(3)}, ${sessions.length} session(s), physical address present, but contactConfidence = 0. ` +
        "Run POST /ingest/recompute-contact-confidence to update the column from existing address and contact fields. " +
        "Once updated, the UCB warmth bonus (≥10 confidence) will flow into L4 UCT node selection.",
      actionTaken: "L5 contactConfidence: stale at 0 despite address on record. Recompute queued.",
    });
  }

  return suggestions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — run all personas for one entity
// ─────────────────────────────────────────────────────────────────────────────

const PERSONA_RUNNERS: Record<PersonaId, (e: Entity) => Promise<ImprovementSuggestion[]>> = {
  data_engineer:              runDataEngineer,
  data_analyst:               runDataAnalyst,
  intel_systems_analyst:      runIntelSystemsAnalyst,
  business_engineer:          runBusinessEngineer,
  ux_designer:                runUxDesigner,
  architect:                  runArchitect,
  data_integrity_auditor:     runDataIntegrityAuditor,
  hybrid_architecture_auditor: runHybridArchitectureAuditor,
};

export const ALL_PERSONAS: PersonaId[] = Object.keys(PERSONA_RUNNERS) as PersonaId[];

export async function runPersonasForEntity(entity: Entity): Promise<ImprovementSuggestion[]> {
  const results: ImprovementSuggestion[] = [];
  for (const personaId of ALL_PERSONAS) {
    try {
      const suggestions = await PERSONA_RUNNERS[personaId](entity);
      results.push(...suggestions);
    } catch (err: any) {
      logger.warn({ err: err.message, persona: personaId, entityId: entity.id }, "Persona run failed");
    }
  }
  return results;
}

export const PERSONA_META: Record<PersonaId, { label: string; icon: string; color: string }> = {
  data_engineer:               { label: "Data Engineer",               icon: "Database",     color: "#3B82F6" },
  data_analyst:                { label: "Data Analyst",                icon: "TrendingUp",   color: "#10B981" },
  intel_systems_analyst:       { label: "Intel Systems Analyst",       icon: "Network",      color: "#A855F7" },
  business_engineer:           { label: "Business Engineer",           icon: "Briefcase",    color: "#F59E0B" },
  ux_designer:                 { label: "UX Designer",                 icon: "Palette",      color: "#EC4899" },
  architect:                   { label: "Architect",                   icon: "Layers",       color: "#06B6D4" },
  data_integrity_auditor:      { label: "Data Integrity Auditor",      icon: "ShieldCheck",  color: "#EF4444" },
  hybrid_architecture_auditor: { label: "Hybrid Architecture Auditor", icon: "GitBranch",    color: "#F97316" },
};
