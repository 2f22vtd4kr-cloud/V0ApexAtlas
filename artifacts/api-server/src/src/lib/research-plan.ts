export type ResearchStageId =
  | "identity"
  | "structure"
  | "people"
  | "official_routes"
  | "person_followups"
  | "route_ranking";

export type ResearchStageStatus = "planned" | "active" | "complete" | "review" | "blocked" | "unavailable";

export type ResearchCoverageStatus = "complete" | "review" | "blocked" | "unavailable";

export type RouteTier =
  | "direct_person"
  | "executive"
  | "operator_parent"
  | "gatekeeper_intermediary"
  | "organization"
  | "registry";

export interface ResearchPlanStage {
  id: ResearchStageId;
  label: string;
  purpose: string;
  status: ResearchStageStatus;
  targetNames: string[];
  queryFamilies: string[];
  tools: string[];
}

export interface InvestigatorResearchPlan {
  version: 1;
  method: "investigator_v1";
  target: {
    legalName: string;
    tradingName: string;
    city: string | null;
    country: string | null;
    entityType: string;
    subjectKind?: string;
    anchors?: string[];
    disambiguationNotes?: string[];
  };
  relatedOrganizations: string[];
  candidateDomains: string[];
  stages: ResearchPlanStage[];
  coverage?: {
    lanes: Record<string, ResearchCoverageStatus>;
    negativeFindings: string[];
    searchGaps: string[];
  };
}

export interface RankedResearchRoute {
  rank: number;
  tier: RouteTier;
  tierLabel: string;
  vectorType: string;
  value: string;
  personName: string | null;
  role: string | null;
  relationship: string | null;
  state: string;
  score: number;
  scope: string;
  sourceUrls: string[];
  sourceDomains: string[];
  note: string;
}

const TIER_LABELS: Record<RouteTier, string> = {
  direct_person: "Direct named-person route",
  executive: "Executive / principal route",
  operator_parent: "Operator / parent route",
  gatekeeper_intermediary: "Named intermediary route",
  organization: "Organization route",
  registry: "Registry route",
};

const TIER_SCORES: Record<RouteTier, number> = {
  direct_person: 100,
  executive: 82,
  operator_parent: 68,
  gatekeeper_intermediary: 57,
  organization: 42,
  registry: 25,
};

export function buildInvestigatorResearchPlan(input: {
  legalName: string;
  tradingName: string;
  city: string | null;
  country: string | null;
  entityType: string;
  relatedOrganizations?: string[];
  candidateDomains?: string[];
  subjectKind?: string;
  anchors?: string[];
  disambiguationNotes?: string[];
  coverage?: InvestigatorResearchPlan["coverage"];
}): InvestigatorResearchPlan {
  const relatedOrganizations = [...new Set((input.relatedOrganizations ?? []).filter(Boolean))].slice(0, 6);
  const candidateDomains = [...new Set((input.candidateDomains ?? []).filter(Boolean))].slice(0, 8);
  const isPerson = input.entityType === "HNWI" || input.entityType === "Gatekeeper";
  return {
    version: 1,
    method: "investigator_v1",
    target: {
      legalName: input.legalName,
      tradingName: input.tradingName,
      city: input.city,
      country: input.country,
      entityType: input.entityType,
      ...(input.subjectKind ? { subjectKind: input.subjectKind } : {}),
      ...(input.anchors?.length ? { anchors: [...new Set(input.anchors)].slice(0, 8) } : {}),
      ...(input.disambiguationNotes?.length
        ? { disambiguationNotes: [...new Set(input.disambiguationNotes)].slice(0, 8) }
        : {}),
    },
    relatedOrganizations,
    candidateDomains,
    ...(input.coverage ? { coverage: input.coverage } : {}),
    stages: [
      {
        id: "identity",
        label: "Identify the exact target",
        purpose: "Resolve the legal/trading identity before following people or contact routes.",
        status: "planned",
        targetNames: [input.legalName, input.tradingName].filter(Boolean),
        queryFamilies: ["exact legal name", "trading name", "registry identifier", "location"],
        tools: ["registry anchors", "Tavily", "Exa", "Perplexity", "Gemini"],
      },
      {
        id: "structure",
        label: "Map ownership and operating structure",
        purpose: "Find C/O entities, parents, operators, holdings, and the official business domain.",
        status: relatedOrganizations.length > 0 ? "active" : "planned",
        targetNames: relatedOrganizations,
        queryFamilies: ["parent/operator", "C/O relationship", "holding structure", "official domain"],
        tools: ["Tavily", "Exa", "public registries", "web search"],
      },
      {
        id: "people",
        label: "Identify useful people",
        purpose: isPerson
          ? "Find the target's explicitly named assistants, advisers, family-office, or professional intermediaries."
          : "Find owners, controllers, founders, directors, executives, operators, and named intermediaries.",
        status: "planned",
        targetNames: [...relatedOrganizations, input.tradingName].filter(Boolean),
        queryFamilies: ["owners/controllers", "directors/officers", "executives", "operators", "intermediaries"],
        tools: ["official pages", "filings", "press", "professional profiles"],
      },
      {
        id: "official_routes",
        label: "Collect official public routes",
        purpose: "Fetch exact team, leadership, contact, and named-person pages and retain nearby contacts.",
        status: "planned",
        targetNames: [...relatedOrganizations, input.tradingName].filter(Boolean),
        queryFamilies: ["team", "leadership", "management", "contact", "named person"],
        tools: ["official websites", "Wayback", "exact-page parser"],
      },
      {
        id: "person_followups",
        label: "Follow each useful person",
        purpose: "Search each discovered person in the context of the target rather than stopping at the first organization hit.",
        status: "planned",
        targetNames: [],
        queryFamilies: ["person + organization", "person + role", "person + public contact", "person + professional profile"],
        tools: ["Tavily", "Exa", "Perplexity", "official pages", "web search"],
      },
      {
        id: "route_ranking",
        label: "Rank the complete route hierarchy",
        purpose: "Show the most direct route first while preserving operator, executive, intermediary, and organization paths.",
        status: "planned",
        targetNames: [],
        queryFamilies: ["direct person", "executive", "operator/parent", "gatekeeper", "organization"],
        tools: ["claim provenance", "candidate reconciliation", "manual review"],
      },
    ],
  };
}

export function routeTierForDetails(
  details: Record<string, unknown> | undefined,
  scope: string,
  vectorType: string,
): RouteTier {
  const explicit = details?.routeTier;
  if (
    explicit === "direct_person" ||
    explicit === "executive" ||
    explicit === "operator_parent" ||
    explicit === "gatekeeper_intermediary" ||
    explicit === "organization" ||
    explicit === "registry"
  ) return explicit;

  const relationship = String(details?.relationship ?? "").toLowerCase();
  const role = String(details?.role ?? "").toLowerCase();
  if (scope === "target_person" || relationship.includes("target-person")) return "direct_person";
  if (/operator|parent|holding|management|c\/o/.test(relationship)) return "operator_parent";
  if (scope === "person_candidate") {
    if (/assistant|chief.?of.?staff|family.?office|advisor|adviser|solicitor|lawyer|secretary|office/.test(role)) {
      return "gatekeeper_intermediary";
    }
    if (/owner|beneficial|founder|controller|operator|director|officer|ceo|president|partner|principal|executive|named-executive/.test(`${role} ${relationship}`)) {
      return "executive";
    }
    return vectorType === "email" || vectorType === "phone" ? "executive" : "gatekeeper_intermediary";
  }
  if (scope === "organization") return "organization";
  return "registry";
}

export function routeTierLabel(tier: RouteTier): string {
  return TIER_LABELS[tier];
}

export function routeTierScore(tier: RouteTier): number {
  return TIER_SCORES[tier];
}
