/**
 * Multi-Agent Reasoning Pipeline — Phase 5
 *
 * Four deterministic TypeScript agents coordinate in sequence:
 *
 *   Planner  — parses query intent, extracts asset/geo/name filters
 *   Retriever — runs hybrid search + optional SQL pre-filter
 *   Analyst  — validates source registries, applies signal boosts, generates reasoning
 *   Critic   — re-ranks, removes noise, produces final output
 *
 * No LLM calls. All logic is deterministic and traces back to real data.
 */

import { db, entitiesTable, assetsTable } from "@workspace/db";
import { eq, gte, sql, inArray } from "drizzle-orm";
import { hybridSearch, type HybridResult } from "./hybrid-search";

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 1: PLANNER
// ─────────────────────────────────────────────────────────────────────────────

export interface PlannerOutput {
  intent: "person" | "asset" | "company" | "mixed";
  assetFocus?: string;
  locations: string[];
  nameHints: string[];
  minScore?: number;
  hotOnly: boolean;
  strategy: "broad" | "asset-led" | "geo-led" | "name-led";
  reasoning: string;
  durationMs: number;
}

// Keyword dictionaries — deterministic intent extraction, no LLM
const GEO_MAP: Record<string, string> = {
  texas: "TX", california: "CA", florida: "FL", "new york": "NY",
  colorado: "CO", nevada: "NV", arizona: "AZ", georgia: "GA",
  uk: "British", "united kingdom": "British", britain: "British", british: "British",
  american: "US", "united states": "US", usa: "US", us: "US",
  swiss: "Switzerland", switzerland: "Switzerland",
  france: "France", french: "French",
  germany: "Germany", german: "German",
  italy: "Italy", italian: "Italian",
  norway: "Norway", norwegian: "Norwegian",
  canada: "Canada", canadian: "Canadian",
  australia: "Australia", australian: "Australian",
};

const ASSET_MAP: Record<string, string> = {
  jet: "Aviation", airplane: "Aviation", plane: "Aviation", aircraft: "Aviation",
  helicopter: "Aviation", turboprop: "Aviation", turbofan: "Aviation",
  "private jet": "Aviation", "private plane": "Aviation",
  yacht: "Marine", boat: "Marine", vessel: "Marine", ship: "Marine",
  villa: "RealEstate", property: "RealEstate", estate: "RealEstate",
  mansion: "RealEstate", house: "RealEstate",
};

// ─────────────────────────────────────────────────────────────────────────────
// QUERY EXPANSION
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical synonyms appended when the planner detects a specific asset category. */
const ASSET_EXPANSION: Record<string, string[]> = {
  Aviation:   ["aircraft", "airplane", "jet", "turbofan", "turboprop", "helicopter", "rotorcraft", "tail"],
  Marine:     ["yacht", "vessel", "boat", "ship", "marina"],
  RealEstate: ["property", "estate", "villa", "mansion", "residence", "freehold"],
};

/** Intent background terms that improve recall for person/company queries. */
const INTENT_EXPANSION: Record<string, string[]> = {
  person:  ["owner", "individual", "HNWI", "director", "beneficial", "officer"],
  company: ["corporation", "trust", "fund", "LLC", "Ltd", "Inc", "group"],
  asset:   [],
  mixed:   [],
};

/**
 * Single-pass query expansion.
 *
 * Takes the raw query string and the Planner's extracted plan, then returns an
 * enriched query by appending (without duplicating):
 *   1. Asset-category synonyms (e.g. "jet" → also "aircraft turbofan helicopter …")
 *   2. Canonical location forms extracted by the planner (e.g. "TX", "British")
 *   3. Name hints not already present in the raw query
 *   4. Intent-level background terms (e.g. "owner HNWI director" for person intent)
 *
 * The result is passed to hybridSearch (BM25 + TF-IDF) in a single pass.
 * No iterative feedback — one deterministic transformation per query.
 */
export function expandQuery(query: string, plan: PlannerOutput): string {
  const ql = query.toLowerCase();
  const extra: string[] = [];

  // 1. Asset synonyms
  if (plan.assetFocus) {
    for (const s of (ASSET_EXPANSION[plan.assetFocus] ?? [])) {
      if (!ql.includes(s.toLowerCase())) extra.push(s);
    }
  }

  // 2. Canonical location forms (planner maps e.g. "texas" → "TX";
  //    appending "TX" ensures the abbreviated form also hits BM25)
  for (const loc of plan.locations) {
    if (!ql.includes(loc.toLowerCase())) extra.push(loc);
  }

  // 3. Name hints not already present verbatim
  for (const hint of plan.nameHints) {
    if (!ql.includes(hint.toLowerCase())) extra.push(hint);
  }

  // 4. Intent background terms
  for (const t of (INTENT_EXPANSION[plan.intent] ?? [])) {
    if (!ql.includes(t.toLowerCase())) extra.push(t);
  }

  return extra.length > 0 ? `${query} ${extra.join(" ")}` : query;
}

export function planQuery(query: string): PlannerOutput {
  const t0 = Date.now();
  const ql = query.toLowerCase();

  // Asset focus — check bigrams first, then unigrams
  let assetFocus: string | undefined;
  for (const [kw, cat] of Object.entries(ASSET_MAP)) {
    if (ql.includes(kw)) { assetFocus = cat; break; }
  }

  // Locations
  const locations: string[] = [];
  for (const [kw, loc] of Object.entries(GEO_MAP)) {
    if (ql.includes(kw) && !locations.includes(loc)) locations.push(loc);
  }

  // Name hints: capitalised words that aren't common English words
  const STOP = new Set(["The", "And", "For", "With", "From", "Show", "Find", "Who", "Has"]);
  const nameHints = query
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w) && w.length > 2 && !STOP.has(w))
    .slice(0, 3);

  // Wealth / urgency flags
  const hotOnly = /\b(hot|top|richest|billionaire|ultra.?high)\b/.test(ql);
  const highWealth = /\b(billionaire|centi.?millionaire|ultra)\b/.test(ql);
  const minScore = highWealth ? 0.72 : hotOnly ? 0.60 : undefined;

  // Intent
  const isCompany = /\b(company|corp|inc\.|ltd|llc|fund|trust|group)\b/.test(ql);
  const isPerson = /\b(owner|person|individual|director|ceo|exec|who|officer)\b/.test(ql);
  const intent: PlannerOutput["intent"] =
    isCompany ? "company" : assetFocus ? "asset" : isPerson ? "person" : "mixed";

  // Strategy
  let strategy: PlannerOutput["strategy"] = "broad";
  if (assetFocus) strategy = "asset-led";
  else if (locations.length > 0) strategy = "geo-led";
  else if (nameHints.length > 0) strategy = "name-led";

  const reasoning = [
    `Intent classified as: ${intent}.`,
    assetFocus ? `Asset filter: ${assetFocus}.` : null,
    locations.length ? `Geographic filter: ${locations.join(", ")}.` : null,
    nameHints.length ? `Name hints extracted: ${nameHints.join(", ")}.` : null,
    minScore ? `Minimum Bayesian score: ${minScore}.` : null,
    `Search strategy: ${strategy}.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    intent,
    assetFocus,
    locations,
    nameHints,
    minScore,
    hotOnly,
    strategy,
    reasoning,
    durationMs: Date.now() - t0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 2: RETRIEVER
// ─────────────────────────────────────────────────────────────────────────────

export interface RetrieverMeta {
  bm25Hits: number;
  semanticHits: number;
  graphHits: number;
  totalCandidates: number;
  sqlPrefilter: number;
  expandedQuery: string;
  durationMs: number;
}

export interface RetrieverOutput {
  candidates: HybridResult[];
  meta: RetrieverMeta;
}

export async function retrieve(
  query: string,
  plan: PlannerOutput,
): Promise<RetrieverOutput> {
  const t0 = Date.now();

  let filterIds: number[] | undefined;

  // Build SQL pre-filter when filters are tight enough to be useful
  const hasFilters =
    plan.locations.length > 0 ||
    plan.hotOnly ||
    plan.minScore != null ||
    plan.assetFocus;

  if (hasFilters) {
    try {
      // Start with asset owners if asset focus is given
      let ownerIds: Set<number> | undefined;
      if (plan.assetFocus) {
        const assetRows = await db
          .select({ ownerId: assetsTable.ownerEntityId })
          .from(assetsTable)
          .where(eq(assetsTable.category, plan.assetFocus));
        ownerIds = new Set(
          assetRows.map((a) => a.ownerId).filter((id): id is number => id != null),
        );
      }

      // Entity-level conditions
      const clauses: string[] = [];
      if (plan.hotOnly) clauses.push(`is_hot = true`);
      if (plan.minScore != null) clauses.push(`bayesian_score >= ${plan.minScore}`);
      if (plan.locations.length > 0) {
        const locLike = plan.locations
          .map(
            (l) =>
              `(nationality ILIKE '%${l}%' OR known_residences ILIKE '%${l}%')`,
          )
          .join(" OR ");
        clauses.push(`(${locLike})`);
      }

      const whereClause = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const rows = await db.execute(
        sql.raw(`SELECT id FROM entities ${whereClause} LIMIT 1000`),
      );
      const entityIds = (rows.rows as any[]).map((r: any) => Number(r.id));

      filterIds = ownerIds
        ? entityIds.filter((id) => ownerIds!.has(id))
        : entityIds;
    } catch {
      // Fall back to unfiltered hybrid search
      filterIds = undefined;
    }
  }

  const expandedQuery = expandQuery(query, plan);
  const { results, meta } = await hybridSearch(expandedQuery, filterIds, 50);

  return {
    candidates: results,
    meta: {
      ...meta,
      sqlPrefilter: filterIds?.length ?? -1,
      expandedQuery,
      durationMs: Date.now() - t0,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 3: ANALYST
// ─────────────────────────────────────────────────────────────────────────────

export interface AnalystCandidate extends HybridResult {
  reasoning: string;
  confidence: "high" | "medium" | "low";
  sourceFlags: string[];
}

export interface AnalystOutput {
  scored: AnalystCandidate[];
  durationMs: number;
}

export function analyse(
  candidates: HybridResult[],
  plan: PlannerOutput,
): AnalystOutput {
  const t0 = Date.now();

  const scored: AnalystCandidate[] = candidates.map((c) => {
    const parts: string[] = [];
    const flags: string[] = [];

    // Source validation
    const hasFaa = c.sourceRegistries.some((s) => s.includes("FAA"));
    const hasEdgar = c.sourceRegistries.some((s) =>
      s.includes("SEC") || s.includes("EDGAR"),
    );
    const hasCH = c.sourceRegistries.some((s) => s.includes("Companies House"));
    const hasBrreg = c.sourceRegistries.some((s) =>
      s.includes("BRREG") || s.includes("Norway"),
    );
    const hasGleif = c.sourceRegistries.some((s) => s.includes("GLEIF"));

    if (hasFaa) { parts.push("FAA aircraft registry — verified individual owner"); flags.push("FAA"); }
    if (hasEdgar) { parts.push("SEC EDGAR filer (SC 13D/G or DEF 14A)"); flags.push("SEC EDGAR"); }
    if (hasCH) { parts.push("UK Companies House officer / PSC"); flags.push("Companies House"); }
    if (hasBrreg) { parts.push("Norwegian company director (BRREG)"); flags.push("BRREG"); }
    if (hasGleif) { parts.push("GLEIF LEI registered entity"); flags.push("GLEIF"); }

    // Asset analysis
    if (c.assetCount > 0) {
      parts.push(`${c.assetCount} verified asset(s): ${c.assetTypes.join(", ")}`);
    } else {
      parts.push("No linked assets yet — enrich via additional ingestion runs");
    }

    // Hot lead / score interpretation
    if (c.isHot) parts.push("🔴 Hot lead (turbine jet / turbofan owner)");
    if ((c.bayesianScore ?? 0) >= 0.80) parts.push("Bayesian score ≥80% — very strong HNWI signal");
    else if ((c.bayesianScore ?? 0) >= 0.65) parts.push("Bayesian score ≥65% — solid HNWI signal");

    // Plan alignment
    if (plan.assetFocus && c.assetTypes.includes(plan.assetFocus)) {
      parts.push(`✓ Matches requested ${plan.assetFocus} filter`);
    }
    if (plan.locations.length > 0) {
      const locMatch = plan.locations.some(
        (l) =>
          c.nationality?.includes(l) || c.knownResidences?.includes(l),
      );
      if (locMatch) parts.push("✓ Geographic location confirmed");
      else parts.push("⚠ Location not confirmed in registry data");
    }

    // Confidence
    const verified = hasFaa || hasEdgar || hasCH || hasBrreg;
    const confidence: AnalystCandidate["confidence"] =
      verified && c.assetCount > 0
        ? "high"
        : verified
        ? "medium"
        : "low";

    return {
      ...c,
      reasoning: parts.join(". ") + ".",
      confidence,
      sourceFlags: flags,
    };
  });

  return { scored, durationMs: Date.now() - t0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT 4: CRITIC
// ─────────────────────────────────────────────────────────────────────────────

export interface CriticOutput {
  final: AnalystCandidate[];
  removed: number;
  durationMs: number;
}

export function critique(
  scored: AnalystCandidate[],
  limit = 20,
): CriticOutput {
  const t0 = Date.now();

  // Prefer verified candidates unless there aren't enough
  const verified = scored.filter((c) => c.confidence !== "low");
  const pool = verified.length >= Math.min(limit, 3) ? verified : scored;

  // Final sort: RRF + hot boost + confidence boost
  const sorted = [...pool].sort((a, b) => {
    const aBoost = (a.isHot ? 0.04 : 0) + (a.confidence === "high" ? 0.02 : 0);
    const bBoost = (b.isHot ? 0.04 : 0) + (b.confidence === "high" ? 0.02 : 0);
    return b.scores.rrf + bBoost - (a.scores.rrf + aBoost);
  });

  const final = sorted.slice(0, limit).map((c, i) => ({ ...c, rank: i + 1 }));

  return { final, removed: pool.length - final.length, durationMs: Date.now() - t0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestrationResult {
  query: string;
  expandedQuery: string;
  pipeline: {
    planner: PlannerOutput;
    retriever: RetrieverMeta;
    analyst: { candidateCount: number; durationMs: number };
    critic: { finalCount: number; removed: number; durationMs: number };
  };
  results: AnalystCandidate[];
  isEmpty: boolean;
  totalMs: number;
}

export async function orchestrate(
  query: string,
  limit = 20,
): Promise<OrchestrationResult> {
  const t0 = Date.now();

  const plan       = planQuery(query);
  const { candidates, meta: retrieverMeta } = await retrieve(query, plan);
  const { scored, durationMs: analystMs }   = analyse(candidates, plan);
  const { final, removed, durationMs: criticMs } = critique(scored, limit);

  return {
    query,
    expandedQuery: retrieverMeta.expandedQuery,
    pipeline: {
      planner: plan,
      retriever: retrieverMeta,
      analyst: { candidateCount: scored.length, durationMs: analystMs },
      critic: { finalCount: final.length, removed, durationMs: criticMs },
    },
    results: final,
    isEmpty: final.length === 0,
    totalMs: Date.now() - t0,
  };
}
