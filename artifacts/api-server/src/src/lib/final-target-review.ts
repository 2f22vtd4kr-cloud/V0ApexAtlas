import type { ReconciledCandidate } from "./contact-candidate";

export type FinalReviewDecision = "publish" | "review" | "reject";

export interface FinalReviewAsset {
  category: string;
  identifier: string;
  jurisdiction: string;
  description?: string | null;
  sourceRegistry?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface FinalTargetReviewInput {
  targetName: string;
  targetType: string;
  proposedContacts: Record<string, string | null>;
  candidates: readonly ReconciledCandidate[];
  evidence: readonly {
    vectorType: string;
    value: string;
    source: string;
    sourceUrl: string | null;
    validationStatus?: string | null;
  }[];
  proposedAssets: readonly FinalReviewAsset[];
  reachabilityStatus?: string | null;
}

export interface FinalTargetReviewResult {
  decision: FinalReviewDecision;
  approvedContactValues: string[];
  approvedAssetIdentifiers: string[];
  reasons: string[];
  reviewerSource: string;
}

export type TargetResearchDisposition = "contact_route_found" | "needs_follow_up";

export function deriveTargetResearchDisposition(
  review: Pick<FinalTargetReviewResult, "approvedContactValues">,
): {
  disposition: TargetResearchDisposition;
  nextAction: string;
} {
  if (review.approvedContactValues.length > 0) {
    return {
      disposition: "contact_route_found",
      nextAction: "Keep the exact approved route in target-scoped review and proceed to manual access review.",
    };
  }
  return {
    disposition: "needs_follow_up",
    nextAction:
      "Run another target-scoped OSINT pass. Prioritize identity/domain resolution, exact claim-page retrieval, " +
      "and validation of review-only candidates before any contact promotion.",
  };
}

/**
 * Build the bounded, target-scoped input given to the final reviewer.
 * The reviewer is explicitly told that the arrays are the complete universe of
 * claims and that it may only select exact values from them.
 */
export function buildFinalTargetReviewPrompt(input: FinalTargetReviewInput): string {
  return `You are the final publication reviewer for one OSINT target.

TARGET: ${input.targetName}
TYPE: ${input.targetType}
REACHABILITY STATUS: ${input.reachabilityStatus ?? "unknown"}

Review ONLY this target. The JSON arrays below are the complete set of claims
available for publication in this run. You must not add, normalize, infer,
complete, pattern-match, or substitute any value. A contact is publishable only
when the supplied candidate is target-person attributed, has an exact fetched
claim URL, has no conflict, and is in verified_direct_route state. Social
accounts may be published only when their supplied candidate meets the same
exact-claim and target-person attribution rule. Organization-only and
person-candidate values remain review-only.

PROPOSED CONTACTS:
${JSON.stringify(input.proposedContacts)}

UNTRUSTED EVIDENCE START
ELIGIBLE CANDIDATES:
${JSON.stringify(input.candidates)}

DURABLE EVIDENCE:
${JSON.stringify(input.evidence)}

PROPOSED ASSETS:
${JSON.stringify(input.proposedAssets)}
UNTRUSTED EVIDENCE END

Return ONLY JSON:
{
  "decision": "publish" | "review" | "reject",
  "approvedContactValues": ["exact values copied from ELIGIBLE CANDIDATES"],
  "approvedAssetIdentifiers": ["exact identifiers copied from PROPOSED ASSETS"],
  "reasons": ["short evidence-based reasons"]
}

Use "review" when evidence is incomplete, contradictory, weakly attributed, or
the target is research-only. Use "reject" when the supplied claims are
clearly invalid or unrelated. Never approve a value merely because multiple
providers repeated it.`;
}

function exactMatch(value: string, allowed: readonly string[]): boolean {
  return allowed.some((candidate) => candidate === value);
}

/**
 * Fail-closed deterministic boundary around the model's recommendation.
 * The LLM can select or downgrade supplied claims, but it cannot invent them.
 */
export function adjudicateFinalTargetReview(
  input: FinalTargetReviewInput,
  raw: unknown,
  reviewerSource: string,
): FinalTargetReviewResult {
  const payload = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const requestedDecision = payload.decision === "publish"
    || payload.decision === "reject"
    || payload.decision === "review"
    ? payload.decision
    : "review";
  const organizationTarget = input.targetType === "Corporation"
    || input.targetType === "Corp"
    || input.targetType === "Trust";
  const requiredScope = organizationTarget ? "organization" : "target_person";
  const eligibleContacts = input.reachabilityStatus === "research_only"
    ? []
    : input.candidates
    .filter((candidate) => {
      if (candidate.state !== "verified_direct_route") return false;
      if (candidate.conflictCount > 0 || !candidate.exactClaimObserved) return false;
      if (!candidate.scopes.includes(requiredScope)) return false;
      return candidate.vectorType === "email"
        || candidate.vectorType === "phone"
        || candidate.vectorType === "social";
    })
    .map((candidate) => candidate.value);
  const approvedContactValues = Array.isArray(payload.approvedContactValues)
    ? payload.approvedContactValues
      .filter((value): value is string => typeof value === "string")
      .filter((value, index, values) => values.indexOf(value) === index)
      .filter((value) => exactMatch(value, eligibleContacts))
    : [];
  const proposedAssetIdentifiers = input.proposedAssets.map((asset) => asset.identifier);
  const approvedAssetIdentifiers = Array.isArray(payload.approvedAssetIdentifiers)
    ? payload.approvedAssetIdentifiers
      .filter((value): value is string => typeof value === "string")
      .filter((value, index, values) => values.indexOf(value) === index)
      .filter((value) => exactMatch(value, proposedAssetIdentifiers))
    : [];
  const reasons = Array.isArray(payload.reasons)
    ? payload.reasons.filter((reason): reason is string => typeof reason === "string").slice(0, 12)
    : [];

  // Publication requires at least one exact, eligible claim or a reviewed
  // asset. A malformed/empty model response can never publish anything.
  const decision: FinalReviewDecision =
    requestedDecision === "publish" && (approvedContactValues.length > 0 || approvedAssetIdentifiers.length > 0)
      ? "publish"
      : requestedDecision === "reject"
        ? "reject"
        : "review";

  return {
    decision,
    approvedContactValues,
    approvedAssetIdentifiers,
    reasons: reasons.length > 0 ? reasons : ["Final reviewer did not provide an actionable evidence-based decision."],
    reviewerSource,
  };
}