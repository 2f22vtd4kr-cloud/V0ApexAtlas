import type { InsertResearchEvidence } from "@workspace/db";
import type { HybridSearchMeta } from "./hybrid-search";
import { computeFreshnessScore } from "./temporal-evidence";
import { decideEvidence } from "./evidence-decision";
import { getSourceReliability } from "./source-reliability";

type PathNode = {
  label?: string;
  role?: string;
  registry?: string;
  contactConfidence?: number | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
};

type MctsStep = {
  action?: string;
  target?: string;
  targetType?: string;
  registry?: string;
  warmthScore?: number;
  reasoning?: string;
};

export function buildResearchEvidenceRows(input: {
  sessionId: number;
  entityId: number;
  targetName: string;
  path: PathNode[];
  steps: MctsStep[];
  hybridMeta?: Partial<HybridSearchMeta>;
  reachability?: { status?: string; score?: number; reasons?: string[]; blockers?: string[] };
}): InsertResearchEvidence[] {
  const rows: InsertResearchEvidence[] = [];
  const add = (row: Omit<InsertResearchEvidence, "sessionId" | "entityId">) => {
    rows.push({
      ...row,
      sessionId: input.sessionId,
      entityId: input.entityId,
    });
  };
  const observedAt = new Date();
  const addClaim = (row: Omit<InsertResearchEvidence, "sessionId" | "entityId"> & {
    conflictReason?: string | null;
    negativeReason?: string | null;
    attributable?: boolean;
  }) => {
    const sourceReliability = getSourceReliability(row.sourceName);
    const decision = decideEvidence({
      confidence: row.confidence,
      sourceName: row.sourceName,
      sourceReliability: sourceReliability.reliability,
      conflictReason: row.conflictReason,
      negativeReason: row.negativeReason,
      attributable: row.attributable,
    });
    const { conflictReason: _conflictReason, negativeReason: _negativeReason, attributable: _attributable, ...evidence } = row;
    let metadata: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(evidence.metadata || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
    } catch {
      // Keep malformed source metadata visible while adding reliability context.
    }
    add({
      ...evidence,
      status: decision.status,
      rejectionReason: evidence.rejectionReason ?? decision.rejectionReason,
      metadata: JSON.stringify({
        ...metadata,
        sourceReliability: sourceReliability.reliability,
        sourceRationale: sourceReliability.rationale,
      }),
    });
  };

  addClaim({
    claimType: "identity",
    claim: `Research target is ${input.targetName}`,
    value: input.targetName,
    sourceName: "Apex Atlas target record",
    confidence: 0.5,
    observedAt,
    freshnessScore: computeFreshnessScore(observedAt, observedAt),
    metadata: JSON.stringify({ basis: "selected_entity" }),
  });

  for (const node of input.path) {
    const confidence = Math.max(0, Math.min(1, (node.contactConfidence ?? 0) / 100));
    addClaim({
      claimType: node.role === "GATEKEEPER" ? "access" : "relationship",
      claim: `${node.role ?? "PATH"} candidate: ${node.label ?? "unlabelled node"}`,
      value: node.label ?? null,
      sourceName: node.registry ?? "Graph path",
      confidence: confidence || 0.35,
      observedAt,
      freshnessScore: computeFreshnessScore(observedAt, observedAt),
      metadata: JSON.stringify({
        role: node.role ?? null,
        contactEmail: node.contactEmail ?? null,
        contactPhone: node.contactPhone ?? null,
        registry: node.registry ?? null,
      }),
      negativeReason: confidence < 0.7
        ? "The stored public contact vector is insufficient to attribute this path node as an authorized intermediary."
        : null,
    });
  }

  for (const step of input.steps) {
    addClaim({
      claimType: "process",
      claim: step.reasoning || `${step.action ?? "Research step"} → ${step.target ?? "unknown target"}`,
      value: step.target ?? null,
      sourceName: step.registry ?? "MCTS",
      confidence: Math.max(0, Math.min(1, step.warmthScore ?? 0)),
      observedAt,
      freshnessScore: computeFreshnessScore(observedAt, observedAt),
      metadata: JSON.stringify({ action: step.action ?? null, targetType: step.targetType ?? null }),
      negativeReason: (step.warmthScore ?? 0) < 0.7
        ? "Warmth is a prioritization signal, not independent proof of access or identity."
        : null,
    });
  }

  if (input.hybridMeta) {
    addClaim({
      claimType: "process",
      claim: `Retrieval returned ${input.hybridMeta.totalCandidates ?? 0} candidate records`,
      value: String(input.hybridMeta.totalCandidates ?? 0),
      sourceName: "Apex Atlas hybrid retrieval",
      confidence: (input.hybridMeta.totalCandidates ?? 0) > 0 ? 0.75 : 0.25,
      observedAt,
      freshnessScore: computeFreshnessScore(observedAt, observedAt),
      metadata: JSON.stringify(input.hybridMeta),
      negativeReason: (input.hybridMeta.totalCandidates ?? 0) === 0
        ? "No related candidates were returned by the configured retrieval signals."
        : null,
    });
  }

  if (input.reachability) {
    addClaim({
      claimType: "access",
      claim: `Reachability preflight: ${input.reachability.status ?? "unknown"}`,
      value: input.reachability.status ?? null,
      sourceName: "Apex Atlas reachability preflight",
      confidence: Math.max(0, Math.min(1, (input.reachability.score ?? 0) / 100)),
      observedAt,
      freshnessScore: computeFreshnessScore(observedAt, observedAt),
      rejectionReason: input.reachability.blockers?.join("; ") || null,
      metadata: JSON.stringify({
        reasons: input.reachability.reasons ?? [],
        blockers: input.reachability.blockers ?? [],
      }),
      negativeReason: input.reachability.status === "reachable"
        ? null
        : input.reachability.blockers?.join("; ") || "No validated direct or intermediary route was established.",
    });
  }

  return rows;
}