import type { Entity } from "@workspace/db";

export type IntroPathCandidate = {
  status: "review_required";
  routeKind: "intermediary_candidate" | "organization_route";
  target: { id: number; name: string; type: string };
  route: {
    label: string;
    value: string;
    vectorType: "email" | "phone";
    personName: string | null;
    role: string | null;
  };
  evidence: Array<{
    source: string;
    sourceUrl: string;
    exactClaim: boolean;
    scope: string;
  }>;
  corroboration: {
    sourceDomains: string[];
    independentDomains: number;
  };
  whyItMayHelp: string;
  nextManualAction: string;
  warnings: string[];
};

type ContactEvidenceRow = {
  vectorType: string;
  value: string;
  source: string;
  sourceUrl?: string | null;
  validationStatus?: string | null;
  metadata?: string | null;
};

function parseMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function hostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedPublisher(url: string): boolean {
  const host = hostname(url);
  if (!host) return true;
  return [
    "contactout.com", "signalhire.com", "rocketreach.co", "zoominfo.com",
    "veripages.com", "whitepages.com", "spokeo.com", "peoplefinders.com",
    "idcrawl.com", "theorg.com", "dnb.com", "crunchbase.com", "pitchbook.com",
  ].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function exactSourceUrls(row: ContactEvidenceRow, details: Record<string, unknown>): string[] {
  const urls = [
    row.sourceUrl,
    ...(Array.isArray(details.sourceUrls)
      ? details.sourceUrls.filter((value): value is string => typeof value === "string")
      : []),
  ];
  return [...new Set(urls.filter((url) => /^https?:\/\//i.test(url) && !isBlockedPublisher(url)))];
}

function isIntermediaryRole(role: unknown): role is string {
  if (typeof role !== "string") return false;
  return /director|officer|operator|gatekeeper|assistant|chief.?of.?staff|advisor|adviser|solicitor|lawyer|office|manager|secretary/i.test(role);
}

function candidateRank(row: ContactEvidenceRow, details: Record<string, unknown>): number {
  const scope = details.scope;
  const personName = typeof details.personName === "string" ? details.personName : "";
  const role = details.role;
  const exactClaim = details.exactClaimObserved === true;
  const sourceUrl = exactSourceUrls(row, details)[0];
  if (!sourceUrl || row.validationStatus === "rejected") return -1;
  if (row.vectorType !== "email" && row.vectorType !== "phone") return -1;

  let score = 0;
  // A named person is eligible here only as a possible professional
  // intermediary. Generic target-person contact candidates stay in the
  // contact-evidence funnel and do not become intro paths.
  if (scope === "person_candidate" && personName && isIntermediaryRole(role)) score += 125;
  if (scope === "target_person" && personName && isIntermediaryRole(role)) score += 105;
  if (scope === "organization") score += 25;
  if ((scope === "person_candidate" || scope === "target_person") && !isIntermediaryRole(role)) return -1;
  if (exactClaim) score += 30;
  if (row.vectorType === "email") score += 10;
  if (row.source.toLowerCase().includes("claimpage")) score += 15;
  if (row.source.toLowerCase().includes("ai-ensemble")) score -= 20;
  return score;
}

export function deriveIntroPathCandidate(
  target: Pick<Entity, "id" | "name" | "type">,
  rows: readonly ContactEvidenceRow[],
): IntroPathCandidate | null {
  const ranked = rows
    .map((row) => ({ row, details: parseMetadata(row.metadata), score: candidateRank(row, parseMetadata(row.metadata)) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score);
  const selected = ranked[0];
  if (!selected) return null;

  const { row, details } = selected;
  const sourceUrls = exactSourceUrls(row, details);
  const sourceDomains = [...new Set(sourceUrls.map(hostname).filter((value): value is string => Boolean(value)))];
  const scope = typeof details.scope === "string" ? details.scope : "unknown";
  const personName = typeof details.personName === "string" ? details.personName : null;
  const role = typeof details.role === "string" ? details.role : null;
  const exactClaim = details.exactClaimObserved === true || sourceUrls.length > 0;
  const isPersonCandidate = (scope === "person_candidate" || scope === "target_person")
    && Boolean(personName)
    && isIntermediaryRole(role);

  return {
    status: "review_required",
    routeKind: isPersonCandidate ? "intermediary_candidate" : "organization_route",
    target: { id: target.id, name: target.name, type: target.type },
    route: {
      label: isPersonCandidate
        ? `Public ${row.vectorType} intermediary candidate: ${personName}`
        : `Public organization ${row.vectorType} route`,
      value: row.value,
      vectorType: row.vectorType === "phone" ? "phone" : "email",
      personName,
      role,
    },
    evidence: sourceUrls.slice(0, 3).map((sourceUrl) => ({
      source: row.source,
      sourceUrl,
      exactClaim,
      scope,
    })),
    corroboration: {
      sourceDomains,
      independentDomains: sourceDomains.length,
    },
    whyItMayHelp: isPersonCandidate
      ? `A public source links this ${row.vectorType} candidate to a named professional associated with the target. That person may be an intermediary, but the role and current affiliation still require verification.`
      : `A public organization route is associated with the target's research evidence and may reach an office or intermediary.`,
    nextManualAction: isPersonCandidate
      ? "Open the source, confirm the person identity, professional role, and current affiliation, then verify that they are an appropriate intermediary before any manual contact."
      : "Open the source, confirm the organization is still connected to the target, and identify the appropriate office or intermediary before any manual contact.",
    warnings: [
      "Review required: this is not a verified personal contact.",
      "Do not send or schedule outreach from this result automatically.",
      ...(role ? [`The source labels the person as ${role}; that does not establish ownership or authorization.`] : []),
    ],
  };
}