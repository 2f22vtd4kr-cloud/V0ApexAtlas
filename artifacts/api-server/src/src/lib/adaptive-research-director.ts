import {
  researchWithExa,
  researchWithPerplexity,
  researchWithTavily,
  type AIExtractResult,
  type AIResearchContext,
  type AIResearchLane,
} from "./ai-extractor";

export type AdaptiveActionKind =
  | "resolve_identity"
  | "resolve_structure"
  | "identify_people"
  | "official_routes"
  | "follow_person"
  | "verify_exact_claim"
  | "complementary_lane"
  | "stop_review";

export interface AdaptiveResearchState {
  targetName: string;
  targetType: string;
  country: string | null;
  relatedOrganizations: string[];
  candidateDomains: string[];
  discoveredPeople: string[];
  followedPeople: string[];
  completedActions: AdaptiveActionKind[];
  completedLanes: AIResearchLane[];
  identityAssessment: AIExtractResult["identityAssessment"];
  identityBasis: string | null;
  evidenceCount: number;
  claimUrls: number;
  noProgressPasses: number;
}

export interface AdaptiveAction {
  kind: AdaptiveActionKind;
  lane: AIResearchLane | null;
  subject: string;
  reason: string;
  signature: string;
}

export interface AdaptiveProviderResult {
  provider: "perplexity" | "tavily" | "exa";
  action: AdaptiveAction;
  result: AIExtractResult;
}

export interface AdaptiveResearchDirectorResult {
  actions: AdaptiveAction[];
  providerResults: AdaptiveProviderResult[];
  discoveredPeople: string[];
  candidateDomains: string[];
  searchGaps: string[];
  negativeFindings: string[];
  stoppedBecause: string;
}

export interface AdaptiveResearchSnapshot {
  actions: Array<{
    kind: AdaptiveActionKind;
    lane: AIResearchLane | null;
    subject: string;
    reason: string;
  }>;
  providerResults: Array<{
    provider: AdaptiveProviderResult["provider"];
    action: AdaptiveActionKind;
    subject: string;
    source: AIExtractResult["source"];
    citations: string[];
    people: string[];
    identityAssessment: AIExtractResult["identityAssessment"];
  }>;
  discoveredPeople: string[];
  candidateDomains: string[];
  searchGaps: string[];
  negativeFindings: string[];
  stoppedBecause: string;
}

/** Compact persisted audit view; full provider payloads remain in the evidence ledger. */
export function summarizeAdaptiveResearch(
  result: AdaptiveResearchDirectorResult,
): AdaptiveResearchSnapshot {
  return {
    actions: result.actions.slice(0, 8).map((action) => ({
      kind: action.kind,
      lane: action.lane,
      subject: action.subject,
      reason: action.reason,
    })),
    providerResults: result.providerResults.slice(0, 8).map((item) => ({
      provider: item.provider,
      action: item.action.kind,
      subject: item.action.subject,
      source: item.result.source,
      citations: (item.result.citations ?? []).slice(0, 8),
      people: [
        ...(item.result.ownerResolutions ?? []).map((owner) => owner.name),
        ...(item.result.ownerContacts ?? []).map((owner) => owner.name),
      ].filter((name, index, names) => names.indexOf(name) === index).slice(0, 12),
      identityAssessment: item.result.identityAssessment,
    })),
    discoveredPeople: result.discoveredPeople.slice(0, 12),
    candidateDomains: result.candidateDomains.slice(0, 12),
    searchGaps: result.searchGaps.slice(0, 16),
    negativeFindings: result.negativeFindings.slice(0, 16),
    stoppedBecause: result.stoppedBecause,
  };
}

export interface AdaptiveResearchDirectorInput {
  targetName: string;
  targetType: string;
  country: string | null;
  context: Omit<AIResearchContext, "lane">;
  maxActions?: number;
  onStep?: (step: {
    action: AdaptiveAction;
    status: "active" | "complete" | "review";
    summary?: string;
  }) => void | Promise<void>;
}

const ACTION_LIMIT = 5;

const SKIP_DOMAINS = new Set([
  "google.com", "bing.com", "yahoo.com", "duckduckgo.com", "qwant.com",
  "linkedin.com", "twitter.com", "x.com", "instagram.com", "facebook.com",
  "youtube.com", "tiktok.com", "wikipedia.org", "wikidata.org",
  "crunchbase.com", "pitchbook.com", "booking.com", "tripadvisor.com",
  "companieshouse.gov.uk", "companies-house.gov.uk", "sec.gov",
]);

const NAVIGATION_NOISE = new Set([
  "cerca vai", "english un", "search menu", "read more", "learn more",
  "privacy policy", "cookie policy", "contact us", "click here",
]);

function cleanDomain(value: string): string | null {
  try {
    const host = new URL(value.includes("://") ? value : `https://${value}`)
      .hostname.toLowerCase().replace(/^www\./, "");
    if (!host || SKIP_DOMAINS.has(host) || host.includes("webcache")) return null;
    return host;
  } catch {
    return null;
  }
}

function domainsFromResult(result: AIExtractResult): string[] {
  return [...new Set((result.citations ?? [])
    .map(cleanDomain)
    .filter((domain): domain is string => Boolean(domain)))].slice(0, 8);
}

function usablePersonName(value: string, targetName: string): boolean {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name || name.toLowerCase() === targetName.trim().toLowerCase()) return false;
  if (name.length < 6 || name.length > 90 || NAVIGATION_NOISE.has(name.toLowerCase())) return false;
  if (/[|/<>@]/.test(name) || /\b(?:contact|menu|search|privacy|cookie|english|cerca|vai)\b/i.test(name)) return false;
  return name.split(" ").filter(Boolean).length >= 2;
}

function addUnique(target: string[], values: readonly string[], limit: number): void {
  for (const value of values) {
    const clean = value.trim();
    if (clean && !target.some((item) => item.toLowerCase() === clean.toLowerCase())) target.push(clean);
    if (target.length >= limit) break;
  }
}

export function createAdaptiveResearchState(input: AdaptiveResearchDirectorInput): AdaptiveResearchState {
  return {
    targetName: input.targetName,
    targetType: input.targetType,
    country: input.country,
    relatedOrganizations: [...new Set(input.context.relatedOrganizations ?? [])].slice(0, 6),
    candidateDomains: [...new Set(input.context.candidateDomains ?? [])].slice(0, 8),
    discoveredPeople: [],
    followedPeople: [],
    completedActions: [],
    completedLanes: [],
    identityAssessment: "not_established",
    identityBasis: null,
    evidenceCount: 0,
    claimUrls: 0,
    noProgressPasses: 0,
  };
}

/**
 * Selects one bounded next action from the current evidence state. The order is
 * intentionally gap-driven rather than a fixed provider ladder: a newly found
 * person or official domain changes the next action immediately.
 */
export function selectNextAdaptiveAction(
  state: AdaptiveResearchState,
  maxActions = ACTION_LIMIT,
): AdaptiveAction {
  const hasAction = (kind: AdaptiveActionKind) => state.completedActions.includes(kind);
  const hasLane = (lane: AIResearchLane) => state.completedLanes.includes(lane);
  const subject = state.targetName;

  if (state.completedActions.length >= maxActions || state.noProgressPasses >= 2) {
    return {
      kind: "stop_review",
      lane: null,
      subject,
      reason: state.noProgressPasses >= 2 ? "two consecutive passes added no new research lead" : "adaptive action budget exhausted",
      signature: `stop:${state.completedActions.length}:${state.noProgressPasses}`,
    };
  }
  if (state.identityAssessment !== "confirmed" && !hasAction("resolve_identity")) {
    return {
      kind: "resolve_identity",
      lane: "official_records",
      subject,
      reason: "identity is not yet confirmed; establish exact target anchors before trusting people or routes",
      signature: `identity:${subject}`,
    };
  }
  if (state.relatedOrganizations.length > 0 && !hasAction("resolve_structure")) {
    return {
      kind: "resolve_structure",
      lane: "semantic_discovery",
      subject: state.relatedOrganizations[0]!,
      reason: "an operator, parent, or C/O lead exists and should be resolved before generic contact searching",
      signature: `structure:${state.relatedOrganizations[0]!.toLowerCase()}`,
    };
  }
  if (state.candidateDomains.length > 0 && !hasAction("official_routes")) {
    return {
      kind: "official_routes",
      lane: "official_records",
      subject: state.candidateDomains[0]!,
      reason: "a candidate official domain is available; fetch its team, leadership, and contact routes",
      signature: `official:${state.candidateDomains.slice(0, 3).join(",")}`,
    };
  }
  const nextPerson = state.discoveredPeople.find((person) => !state.followedPeople.includes(person));
  if (nextPerson) {
    return {
      kind: "follow_person",
      lane: "people_press",
      subject: nextPerson,
      reason: "a named person was discovered; search that person in the target and role context",
      signature: `person:${nextPerson.toLowerCase()}`,
    };
  }
  if (state.discoveredPeople.length > 0 && state.candidateDomains.length > 0 && !hasAction("verify_exact_claim")) {
    return {
      kind: "verify_exact_claim",
      lane: "official_records",
      subject: state.discoveredPeople[0]!,
      reason: "a named person and official domain now exist; verify the role or route on an exact page",
      signature: `claim:${state.discoveredPeople[0]!.toLowerCase()}:${state.candidateDomains[0]}`,
    };
  }
  const lanes: AIResearchLane[] = ["semantic_discovery", "people_press", "contact_routes", "official_records"];
  const missingLane = lanes.find((lane) => !hasLane(lane));
  if (missingLane) {
    return {
      kind: "complementary_lane",
      lane: missingLane,
      subject,
      reason: `the ${missingLane} evidence lane is still uncovered`,
      signature: `lane:${missingLane}`,
    };
  }
  return {
    kind: "stop_review",
    lane: null,
    subject,
    reason: "available lanes and follow-up leads are exhausted; retain the result for review",
    signature: `stop:complete:${state.completedActions.length}`,
  };
}

function providerForAction(action: AdaptiveAction): AdaptiveProviderResult["provider"] {
  if (action.lane === "official_records") return "tavily";
  if (action.lane === "semantic_discovery") return "exa";
  if (action.lane === "contact_routes") return "tavily";
  return "perplexity";
}

function contextForAction(
  input: AdaptiveResearchDirectorInput,
  state: AdaptiveResearchState,
  action: AdaptiveAction,
): AIResearchContext {
  const isPersonFollowUp = action.kind === "follow_person" || action.kind === "verify_exact_claim";
  return {
    ...input.context,
    lane: action.lane ?? "people_press",
    relatedOrganizations: [
      ...(input.context.relatedOrganizations ?? []),
      ...(isPersonFollowUp ? [input.targetName] : []),
    ].slice(0, 6),
    candidateDomains: state.candidateDomains.slice(0, 4),
    anchors: [
      ...(input.context.anchors ?? []),
      ...(isPersonFollowUp ? [`target relationship: ${input.targetName}`, `research subject: ${action.subject}`] : []),
    ].slice(0, 8),
    disambiguationNotes: [
      ...(input.context.disambiguationNotes ?? []),
      ...(isPersonFollowUp ? [`follow-up role/person lead: ${action.subject}`] : []),
    ].slice(0, 8),
  };
}

async function runProvider(
  provider: AdaptiveProviderResult["provider"],
  action: AdaptiveAction,
  input: AdaptiveResearchDirectorInput,
  state: AdaptiveResearchState,
): Promise<AIExtractResult> {
  const subject = action.kind === "follow_person" || action.kind === "verify_exact_claim"
    ? action.subject
    : input.targetName;
  const type = action.kind === "follow_person" || action.kind === "verify_exact_claim"
    ? "HNWI"
    : input.targetType;
  const context = contextForAction(input, state, action);
  if (provider === "tavily") return researchWithTavily(subject, type, input.country, context);
  if (provider === "exa") return researchWithExa(subject, type, input.country, context);
  return researchWithPerplexity(subject, type, input.country, context);
}

export async function runAdaptiveResearchDirector(
  input: AdaptiveResearchDirectorInput,
): Promise<AdaptiveResearchDirectorResult> {
  const state = createAdaptiveResearchState(input);
  const actions: AdaptiveAction[] = [];
  const providerResults: AdaptiveProviderResult[] = [];
  const discoveredPeople: string[] = [];
  const candidateDomains = [...state.candidateDomains];
  const searchGaps: string[] = [];
  const negativeFindings: string[] = [];
  const seenSignatures = new Set<string>();
  const maxActions = Math.max(1, Math.min(input.maxActions ?? ACTION_LIMIT, ACTION_LIMIT));

  for (;;) {
    const action = selectNextAdaptiveAction(state, maxActions);
    if (action.kind === "stop_review") {
      actions.push(action);
      break;
    }
    if (seenSignatures.has(action.signature)) {
      state.noProgressPasses++;
      if (state.noProgressPasses >= 2) break;
      continue;
    }
    seenSignatures.add(action.signature);
    actions.push(action);
    await input.onStep?.({ action, status: "active" });

    const provider = providerForAction(action);
    let result: AIExtractResult;
    try {
      result = await runProvider(provider, action, input, state);
    } catch (error) {
      result = {
        source: "none",
        email: null, phone: null, linkedin: null, instagram: null, twitter: null,
        owners: [], ownerContacts: [], ownerResolutions: [], discoveryCandidates: [], ownershipSummary: null,
        ownershipSources: [], citations: [], negativeFindings: [],
        searchGaps: [error instanceof Error ? error.message : "provider call failed"],
      };
    }
    const beforePeople = discoveredPeople.length;
    const beforeDomains = candidateDomains.length;
    for (const owner of result.ownerResolutions ?? []) {
      if (usablePersonName(owner.name, input.targetName)) addUnique(discoveredPeople, [owner.name], 12);
    }
    for (const owner of result.ownerContacts ?? []) {
      if (usablePersonName(owner.name, input.targetName)) addUnique(discoveredPeople, [owner.name], 12);
    }
    for (const candidate of result.discoveryCandidates ?? []) {
      if (usablePersonName(candidate.name, input.targetName)) addUnique(discoveredPeople, [candidate.name], 12);
    }
    addUnique(candidateDomains, domainsFromResult(result), 12);
    addUnique(state.discoveredPeople, discoveredPeople.slice(beforePeople), 12);
    addUnique(state.candidateDomains, candidateDomains.slice(beforeDomains), 12);
    state.identityAssessment = result.identityAssessment ?? state.identityAssessment;
    state.identityBasis = result.identityBasis ?? state.identityBasis;
    state.evidenceCount += (result.citations?.length ?? 0)
      + (result.ownerResolutions?.length ?? 0)
      + (result.email ? 1 : 0)
      + (result.phone ? 1 : 0);
    state.claimUrls += result.citations?.length ?? 0;
    state.completedActions.push(action.kind);
    if (action.lane && !state.completedLanes.includes(action.lane)) state.completedLanes.push(action.lane);
    if (action.kind === "follow_person") state.followedPeople.push(action.subject);
    for (const gap of result.searchGaps ?? []) if (!searchGaps.includes(gap)) searchGaps.push(gap);
    for (const finding of result.negativeFindings ?? []) if (!negativeFindings.includes(finding)) negativeFindings.push(finding);
    if (beforePeople === discoveredPeople.length && beforeDomains === candidateDomains.length && result.citations?.length === 0) {
      state.noProgressPasses++;
    } else {
      state.noProgressPasses = 0;
    }
    providerResults.push({ provider, action, result });
    await input.onStep?.({
      action,
      status: result.source === "none" ? "review" : "complete",
      summary: `${provider} · ${result.citations?.length ?? 0} citation(s) · ${result.ownerResolutions?.length ?? 0} named person lead(s)`,
    });
  }

  return {
    actions,
    providerResults,
    discoveredPeople: [...new Set(discoveredPeople)].slice(0, 12),
    candidateDomains: [...new Set(candidateDomains)].slice(0, 12),
    searchGaps: searchGaps.slice(0, 16),
    negativeFindings: negativeFindings.slice(0, 16),
    stoppedBecause: actions.at(-1)?.reason ?? "adaptive loop ended",
  };
}