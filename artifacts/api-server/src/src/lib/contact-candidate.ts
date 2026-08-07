import { canonicalizeUrl } from "./evidence-ledger";

export type CandidateScope =
  | "organization"
  | "target_person"
  | "person_candidate"
  | "unknown";

export type CandidateState =
  | "discovered"
  | "source_linked"
  | "attribution_review"
  | "independently_corroborated"
  | "verified_direct_route"
  | "rejected";

export type CandidateVector = "email" | "phone" | "social" | "domain" | "website" | "address";

export interface ContactCandidateEvidence {
  vectorType: CandidateVector;
  value: string;
  source: string;
  sourceUrl?: string | null;
  confidence?: number;
  details?: Record<string, unknown>;
}

export interface StoredContactEvidenceRow {
  id: number;
  vectorType: string;
  value: string;
  source: string;
  sourceUrl?: string | null;
  metadata?: string | null;
}

export interface ReconciledCandidate {
  key: string;
  vectorType: CandidateVector;
  value: string;
  providers: string[];
  sourceDomains: string[];
  sourceUrls: string[];
  scopes: CandidateScope[];
  personNames: string[];
  state: CandidateState;
  conflictCount: number;
  rejectionReason?: string | null;
  exactClaimObserved: boolean;
  blockedSourceUrls: string[];
}

export interface CandidateFunnel {
  totalCandidates: number;
  discovered: number;
  sourceLinked: number;
  attributionReview: number;
  independentlyCorroborated: number;
  verifiedDirectRoute: number;
  rejected: number;
  organizationOnly: number;
  conflicted: number;
  independentSourceDomains: number;
  candidates: ReconciledCandidate[];
}

const CANDIDATE_VECTORS = new Set<CandidateVector>([
  "email", "phone", "social", "domain", "website", "address",
]);

function parseStoredDetails(metadata: string | null | undefined): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const parsed: unknown = JSON.parse(metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/** Reconstructs the same funnel used during ingestion from durable evidence. */
export function reconcileStoredContactEvidence(
  rows: readonly StoredContactEvidenceRow[],
): CandidateFunnel {
  return reconcileContactCandidates(
    rows
      .filter((row): row is StoredContactEvidenceRow & { vectorType: CandidateVector } =>
        CANDIDATE_VECTORS.has(row.vectorType as CandidateVector) && Boolean(row.value?.trim()),
      )
      .map((row) => ({
        vectorType: row.vectorType,
        value: row.value,
        source: row.source,
        sourceUrl: row.sourceUrl ?? null,
        details: parseStoredDetails(row.metadata),
      })),
  );
}

const BLOCKED_DIRECT_CONTACT_PUBLISHER_DOMAINS = new Set([
  "contactout.com",
  "signalhire.com",
  "rocketreach.co",
  "zoominfo.com",
  "veripages.com",
  "whitepages.com",
  "spokeo.com",
  "peoplefinders.com",
  "idcrawl.com",
  "theorg.com",
  "dnb.com",
  "crunchbase.com",
  "pitchbook.com",
]);

/**
 * Directory/lead-generation pages can discover a value, but they are not
 * canonical claim publishers for a personal contact route.
 */
export function isPromotableDirectContactUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return ![...BLOCKED_DIRECT_CONTACT_PUBLISHER_DOMAINS]
      .some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/**
 * A social candidate may be used as a personal research pivot only after
 * attribution is strong enough to distinguish it from an organization account
 * or a same-name public figure. Target-person evidence needs an exact claim URL;
 * a person-candidate needs corroboration from at least two canonical domains.
 */
export function isEligiblePersonalSocialCandidate(
  candidate: Pick<ReconciledCandidate, "scopes" | "sourceUrls" | "sourceDomains" | "state" | "exactClaimObserved">,
): boolean {
  if (candidate.sourceUrls.length === 0) return false;
  if (!candidate.exactClaimObserved) return false;
  if (candidate.scopes.includes("target_person")) return true;
  return candidate.scopes.includes("person_candidate")
    && !candidate.scopes.every((scope) => scope === "organization")
    && candidate.sourceDomains.length >= 2
    && (candidate.state === "independently_corroborated" || candidate.state === "verified_direct_route");
}

export function candidateKey(vectorType: CandidateVector, value: string): string {
  const trimmed = value.trim().toLowerCase();
  const normalized = vectorType === "phone"
    ? trimmed.replace(/\D/g, "")
    : vectorType === "social" || vectorType === "domain" || vectorType === "website"
      ? trimmed
        .replace(/^https?:\/\/(www\.)?/, "")
        .replace(/^twitter\.com\//, "x.com/")
        .replace(/^www\.twitter\.com\//, "x.com/")
        .split(/[?#]/, 1)[0]!
        .replace(/\/+$/, "")
      : trimmed;
  return `${vectorType}|${normalized}`;
}

/**
 * Compare a candidate with a value observed on a fetched claim page.
 * Phone formatting is not evidence, so compare digits only; email matching is
 * case-insensitive and whitespace-insensitive.
 */
export function exactContactValueMatches(
  vectorType: CandidateVector,
  candidateValue: string,
  observedValue: string,
): boolean {
  if (vectorType === "phone") {
    const candidateDigits = candidateValue.replace(/\D/g, "");
    const observedDigits = observedValue.replace(/\D/g, "");
    return candidateDigits.length >= 7 && candidateDigits === observedDigits;
  }
  if (vectorType === "email") {
    return candidateValue.trim().toLowerCase() === observedValue.trim().toLowerCase();
  }
  if (vectorType === "social") {
    return candidateKey("social", candidateValue) === candidateKey("social", observedValue);
  }
  return false;
}

function normalizedValue(vectorType: CandidateVector, value: string): string {
  const key = candidateKey(vectorType, value);
  return key.slice(vectorType.length + 1);
}

function sourceUrlsFor(item: ContactCandidateEvidence): string[] {
  const urls = [
    item.sourceUrl,
    ...(Array.isArray(item.details?.sourceUrls)
      ? item.details.sourceUrls.filter((url): url is string => typeof url === "string")
      : []),
    ...(item.vectorType === "social" && Array.isArray(item.details?.discoveryUrls)
      ? item.details.discoveryUrls.filter((url): url is string => typeof url === "string")
      : []),
  ];
  const canonicalUrls = [...new Set(urls.map((url) => canonicalizeUrl(url)).filter((url): url is string => Boolean(url)))];
  if (item.vectorType === "email" || item.vectorType === "phone") {
    return canonicalUrls.filter(isPromotableDirectContactUrl);
  }
  return canonicalUrls;
}

function canonicalUrlsFor(item: ContactCandidateEvidence): string[] {
  const urls = [
    item.sourceUrl,
    ...(Array.isArray(item.details?.sourceUrls)
      ? item.details.sourceUrls.filter((url): url is string => typeof url === "string")
      : []),
    ...(Array.isArray(item.details?.discoveryUrls)
      ? item.details.discoveryUrls.filter((url): url is string => typeof url === "string")
      : []),
  ];
  return [...new Set(urls.map((url) => canonicalizeUrl(url)).filter((url): url is string => Boolean(url)))];
}

function scopeFor(item: ContactCandidateEvidence): CandidateScope {
  const scope = item.details?.scope;
  if (scope === "organization" || scope === "target_person" || scope === "person_candidate") return scope;
  return "unknown";
}

function candidateValueRejectionReason(vectorType: CandidateVector, value: string): string | null {
  if (vectorType === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim())) {
    return "Invalid or unsupported email value.";
  }
  if (vectorType === "phone") {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return "Invalid or unsupported phone value.";
  }
  if (vectorType === "social") {
    try {
      const url = new URL(value.trim());
      const host = url.hostname.replace(/^www\./, "").toLowerCase();
      const supported = ["linkedin.com", "instagram.com", "twitter.com", "x.com"]
        .some((domain) => host === domain || host.endsWith(`.${domain}`));
      if (!supported || url.pathname === "/") return "Unsupported social profile URL.";
    } catch {
      return "Invalid or unsupported social profile URL.";
    }
  }
  return null;
}

function publisherFamily(source: string, url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const parts = hostname.split(".");
    return parts.length >= 2 ? parts.slice(-2).join(".") : hostname;
  } catch {
    // Provider labels are only a fallback when no URL exists. They are never
    // stronger evidence than a canonical publisher URL.
    return source.trim().toLowerCase();
  }
}

/**
 * Reconciles provider/parser output without treating provider agreement as proof.
 * A provider label is useful for audit, but independent canonical publisher domains
 * are the corroboration unit. Organization-only evidence can never become a
 * target-person route.
 */
export function reconcileContactCandidates(
  evidence: readonly ContactCandidateEvidence[],
): CandidateFunnel {
  const groups = new Map<string, ReconciledCandidate>();
  for (const item of evidence) {
    if (!item.value?.trim()) continue;
    const normalized = normalizedValue(item.vectorType, item.value);
    if (!normalized) continue;
    const key = `${item.vectorType}|${normalized}`;
    const rawUrls = canonicalUrlsFor(item);
    const urls = sourceUrlsFor(item);
    const blockedSourceUrls = (item.vectorType === "email" || item.vectorType === "phone")
      ? rawUrls.filter((url) => !isPromotableDirectContactUrl(url))
      : [];
    const domains = urls
      .map((url) => {
        try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
      })
      .filter((domain): domain is string => Boolean(domain));
    const scope = scopeFor(item);
    const personName = typeof item.details?.personName === "string"
      ? item.details.personName.trim()
      : "";
    const current = groups.get(key) ?? {
      key,
      vectorType: item.vectorType,
      value: item.value.trim(),
      providers: [],
      sourceDomains: [],
      sourceUrls: [],
      scopes: [],
      personNames: [],
      state: "discovered",
      conflictCount: 0,
      exactClaimObserved: false,
      blockedSourceUrls: [],
    };
    if (!current.providers.includes(item.source)) current.providers.push(item.source);
    for (const url of urls) if (!current.sourceUrls.includes(url)) current.sourceUrls.push(url);
    for (const domain of domains) if (!current.sourceDomains.includes(domain)) current.sourceDomains.push(domain);
    for (const url of blockedSourceUrls) if (!current.blockedSourceUrls.includes(url)) current.blockedSourceUrls.push(url);
    if (!current.scopes.includes(scope)) current.scopes.push(scope);
    if (personName && !current.personNames.includes(personName)) current.personNames.push(personName);
    if (item.details?.exactClaimObserved === true) current.exactClaimObserved = true;
    groups.set(key, current);
  }

  const candidates = [...groups.values()].map((candidate) => {
    const isDirectVector = candidate.vectorType === "email" || candidate.vectorType === "phone";
    const hasTargetAttribution = candidate.scopes.includes("target_person");
    const hasPersonAttribution = hasTargetAttribution || candidate.scopes.includes("person_candidate");
    const organizationOnly = candidate.scopes.length > 0
      && candidate.scopes.every((scope) => scope === "organization");
    const rejected = (candidate.vectorType === "email" || candidate.vectorType === "phone")
      && candidate.sourceDomains.length === 0
      && candidate.blockedSourceUrls.length > 0;
    const valueRejectionReason = candidateValueRejectionReason(candidate.vectorType, candidate.value);
    const organizationSocialRejected = candidate.vectorType === "social" && organizationOnly;
    const attributionRejected = candidate.scopes.includes("unknown")
      && candidate.sourceUrls.length > 0
      && candidate.exactClaimObserved === false
      && candidate.providers.some((provider) => provider.toLowerCase().includes("attribution-rejected"));
    const rejectionReason = rejected
      ? "Only blocked lead-directory or people-search publishers supplied this direct-contact value."
      : organizationSocialRejected
        ? "Social profile is organization-only and cannot be promoted as a personal route."
        : valueRejectionReason
          ? valueRejectionReason
          : attributionRejected
            ? "Attribution did not distinguish the candidate from a same-name or unrelated person."
            : null;
    const state: CandidateState =
      rejectionReason ? "rejected"
      : organizationOnly ? (candidate.sourceDomains.length ? "source_linked" : "discovered")
      : hasTargetAttribution && isDirectVector && candidate.sourceDomains.length >= 2
        ? "verified_direct_route"
        : candidate.sourceDomains.length >= 2
          ? "independently_corroborated"
        : hasPersonAttribution
          ? "attribution_review"
          : candidate.sourceDomains.length
            ? "source_linked"
            : "discovered";
    return {
      ...candidate,
      state,
      conflictCount: 0,
      rejectionReason,
    };
  });

  const byVector = new Map<CandidateVector, ReconciledCandidate[]>();
  for (const candidate of candidates) {
    const list = byVector.get(candidate.vectorType) ?? [];
    list.push(candidate);
    byVector.set(candidate.vectorType, list);
  }
  // Different values from the same publisher family are a conflict. Different
  // publishers are independent disagreement signals, but must not be marked as
  // same-publisher conflict; keeping that distinction prevents disagreement
  // from being misreported as corroboration while preserving every value.
  for (const list of byVector.values()) {
    if (list.length < 2) continue;
    for (const candidate of list) {
      const candidateFamilies = new Set(
        candidate.sourceUrls.map((url) => publisherFamily(candidate.providers[0] ?? "", url)),
      );
      const competingSamePublisher = list.filter((other) => {
        if (other.key === candidate.key) return false;
        const otherFamilies = new Set(
          other.sourceUrls.map((url) => publisherFamily(other.providers[0] ?? "", url)),
        );
        return [...candidateFamilies].some((family) => otherFamilies.has(family));
      });
      candidate.conflictCount = competingSamePublisher.length;
    }
  }

  const count = (state: CandidateState) => candidates.filter((candidate) => candidate.state === state).length;
  return {
    totalCandidates: candidates.length,
    discovered: count("discovered"),
    sourceLinked: count("source_linked"),
    attributionReview: count("attribution_review"),
    independentlyCorroborated: count("independently_corroborated"),
    verifiedDirectRoute: count("verified_direct_route"),
    rejected: count("rejected"),
    organizationOnly: candidates.filter((candidate) =>
      candidate.scopes.length > 0 && candidate.scopes.every((scope) => scope === "organization"),
    ).length,
    conflicted: candidates.filter((candidate) => candidate.conflictCount > 0).length,
    independentSourceDomains: new Set(candidates.flatMap((candidate) => candidate.sourceDomains)).size,
    candidates,
  };
}