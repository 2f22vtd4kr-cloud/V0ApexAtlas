export type CascadeStage = "retrieval" | "graph" | "critic" | "evidence-review";

export interface CascadeDecision {
  runCritic: boolean;
  runEvidenceReview: boolean;
  reason: string;
  completedStages: CascadeStage[];
}

/**
 * Decide whether a deeper stage can add meaningful evidence. Retrieval and
 * graph inspection are cheap foundations; critic/orchestration and evidence
 * review are only justified when uncertainty or missing corroboration remains.
 */
export function decideResearchCascade(input: {
  hybridCandidates: number;
  independentSources: number;
  hasDirectContact: boolean;
  hasGatekeeperPath: boolean;
  pathNodes: number;
  identityScore: number;
  accessScore: number;
  requestedDepth: number;
}): CascadeDecision {
  const completedStages: CascadeStage[] = ["retrieval", "graph"];
  const reliableDirectRoute =
    input.hasDirectContact &&
    input.identityScore >= 0.7 &&
    input.accessScore >= 0.65;
  const reliableIntermediaryRoute =
    input.hasGatekeeperPath &&
    input.pathNodes >= 2 &&
    input.independentSources >= 2 &&
    input.identityScore >= 0.65;

  if (reliableDirectRoute || reliableIntermediaryRoute) {
    return {
      runCritic: false,
      runEvidenceReview: false,
      reason: reliableDirectRoute
        ? "Validated direct route is already present; skipped redundant broad critic search."
        : "Corroborated gatekeeper path is already present; skipped redundant broad critic search.",
      completedStages,
    };
  }

  const sparseEvidence =
    input.hybridCandidates === 0 &&
    input.independentSources < 2 &&
    input.pathNodes <= 1;
  return {
    runCritic: true,
    runEvidenceReview: false,
    reason: sparseEvidence
      ? "Evidence is sparse; critic search is required to test identity and relationship hypotheses."
      : `Evidence remains mixed (${input.hybridCandidates} candidates, ${input.independentSources} source families); critic search retained.`,
    completedStages,
  };
}