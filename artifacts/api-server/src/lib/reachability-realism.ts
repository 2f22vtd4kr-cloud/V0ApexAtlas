import { hasMeaningfulDirectContact } from "./contact-confidence";

export type ReachabilityMode = "full" | "targeted" | "research_only";
export type ReachabilityStatus = "direct" | "intermediary" | "bounded" | "research_only";

export interface ReachabilityAssessment {
  status: ReachabilityStatus;
  mode: ReachabilityMode;
  score: number;
  hasDirectContact: boolean;
  hasIntermediaryPath: boolean;
  ultraWealthSignal: boolean;
  publicProminenceSignal: boolean;
  reasons: string[];
  blockers: string[];
}

export interface ReachabilityInput {
  type?: string | null;
  estimatedNetWorth?: number | null;
  email?: string | null;
  phone?: string | null;
  phoneSource?: string | null;
  contactOutcome?: string | null;
  contactConfidence?: number | null;
  linkedinUrl?: string | null;
  twitterHandle?: string | null;
  instagramHandle?: string | null;
  telegramHandle?: string | null;
  knownResidences?: string | null;
  notes?: string | null;
  metadata?: string | null;
  sourceRegistries?: string | null;
  networkDegree?: number;
  gatekeeperConnections?: number;
  intermediaryConnections?: number;
}

export interface ReachabilityDirective {
  mode: ReachabilityMode;
  status: ReachabilityStatus;
  score: number;
  reasons: string[];
  blockers: string[];
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function hasValue(value: string | null | undefined): boolean {
  return Boolean(value?.trim() && value.trim() !== "[]" && value.trim() !== "null");
}

/**
 * Classify practical access before spending deep research budget.
 *
 * Wealth, fame, assets, social handles, and registry presence are evidence of
 * importance, not evidence that a person can be reached. A target can remain
 * valuable for intelligence while being explicitly research-only for outreach.
 */
export function assessTargetReachability(input: ReachabilityInput): ReachabilityAssessment {
  const metadata = parseMetadata(input.metadata);
  const metadataText = JSON.stringify(metadata);
  const contextText = [
    input.notes,
    input.sourceRegistries,
    metadataText,
    typeof metadata.publicProminence === "string" ? metadata.publicProminence : "",
    typeof metadata.prominence === "string" ? metadata.prominence : "",
  ].filter(Boolean).join(" ").toLowerCase();

  const hasDirectContact = hasMeaningfulDirectContact({
    type: input.type,
    email: input.email,
    phone: input.phone,
    phoneSource: input.phoneSource,
  });
  const gatekeeperConnections = input.gatekeeperConnections ?? 0;
  const intermediaryConnections = input.intermediaryConnections ?? 0;
  const networkDegree = input.networkDegree ?? 0;
  const hasIntermediaryPath = gatekeeperConnections > 0 || intermediaryConnections > 0;

  const ultraWealthSignal = (input.estimatedNetWorth ?? 0) >= 500_000_000;
  const publicProminenceSignal =
    metadata.publicProminence === true ||
    metadata.prominence === "high" ||
    /\b(forbes|bloomberg|reuters|household name|world[- ]famous|public figure|head of state|royal family|celebrity)\b/i.test(contextText);

  const reasons: string[] = [];
  const blockers: string[] = [];

  if (hasDirectContact) {
    reasons.push("validated person-level direct contact is present");
  } else {
    blockers.push("no validated person-level direct phone or email is present");
  }
  if (hasIntermediaryPath) {
    reasons.push("a stored gatekeeper or intermediary relationship exists");
  } else {
    blockers.push("no corroborated assistant, family-office, executive-office, foundation, or other intermediary path is stored");
  }
  if (ultraWealthSignal) {
    reasons.push("ultra-high wealth signal increases the prior that access is protected");
    blockers.push("wealth evidence is not access evidence");
  }
  if (publicProminenceSignal) {
    reasons.push("public-prominence markers indicate a high-noise public profile");
    blockers.push("public visibility, press coverage, and social presence do not imply a monitored contact route");
  }
  if (networkDegree > 0) {
    reasons.push(`${networkDegree} relationship edge${networkDegree === 1 ? "" : "s"} can support targeted path discovery`);
  }
  if (input.contactOutcome === "social_only") {
    blockers.push("social-only presence is evidence of identity, not a reliable outreach channel");
  } else if (input.contactOutcome === "organization_contact") {
    blockers.push("organization contact is not personal access to the individual");
  }

  let status: ReachabilityStatus;
  let mode: ReachabilityMode;
  let score: number;

  if (hasDirectContact) {
    status = "direct";
    mode = "full";
    score = 82;
  } else if (hasIntermediaryPath) {
    status = "intermediary";
    mode = "full";
    score = 58;
  } else if (
    ultraWealthSignal &&
    (publicProminenceSignal || (input.type === "HNWI" && (input.estimatedNetWorth ?? 0) >= 1_000_000_000)) &&
    networkDegree < 2 &&
    !hasValue(input.knownResidences)
  ) {
    status = "research_only";
    mode = "research_only";
    score = 8;
  } else if (
    publicProminenceSignal &&
    input.contactOutcome === "social_only" &&
    networkDegree < 2
  ) {
    status = "research_only";
    mode = "research_only";
    score = 12;
  } else {
    status = "bounded";
    mode = "targeted";
    score = Math.min(42, 18 + Math.min(networkDegree, 3) * 6 + (hasValue(input.knownResidences) ? 5 : 0));
  }

  return {
    status,
    mode,
    score,
    hasDirectContact,
    hasIntermediaryPath,
    ultraWealthSignal,
    publicProminenceSignal,
    reasons: [...new Set(reasons)],
    blockers: [...new Set(blockers)],
  };
}

export function reachabilityDirective(assessment: ReachabilityAssessment): ReachabilityDirective {
  return {
    mode: assessment.mode,
    status: assessment.status,
    score: assessment.score,
    reasons: assessment.reasons,
    blockers: assessment.blockers,
  };
}

export function formatReachabilityDirective(assessment?: ReachabilityAssessment | ReachabilityDirective | null): string {
  if (!assessment) {
    return `REALISM RULES:
- Direct reachability must be supported by a validated person-level phone or email.
- A social profile, public prominence, wealth signal, asset, registry entry, press address, or company switchboard is not personal access.
- If no direct or corroborated intermediary route is found, explicitly return research_only and do not pad the result with speculative contact paths.`;
  }

  const reasons = assessment.reasons.length ? assessment.reasons.join("; ") : "No positive access evidence is recorded.";
  const blockers = assessment.blockers.length ? assessment.blockers.join("; ") : "No known blockers.";
  const objective = assessment.mode === "research_only"
    ? "This is a RESEARCH-ONLY target. Spend the bounded pass on confirming identity, control structure, and whether an authorized intermediary exists. Do not keep searching indefinitely for a personal email or phone."
    : assessment.mode === "targeted"
      ? "This is a TARGETED reachability pass. Prioritize one or two plausible intermediary routes before broad contact discovery."
      : "This target has enough access evidence for a normal, evidence-led research pass.";

  return `REALISM / REACHABILITY CONTROL:
Status: ${assessment.status.toUpperCase()} · practical access score ${assessment.score}/100.
${objective}
Positive evidence: ${reasons}
Known blockers: ${blockers}
Never upgrade reachability because the person is famous, wealthy, visible on social media, mentioned in the press, owns an asset, or appears in a registry.`;
}