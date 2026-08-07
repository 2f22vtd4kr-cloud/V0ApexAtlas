import type { AIExtractResult, OwnerResolution } from "./ai-extractor";
import { canonicalizeUrl } from "./evidence-ledger";

export type EnsembleVector = "email" | "phone" | "linkedin" | "instagram" | "twitter";

export interface EnsembleProviderResult {
  provider: string;
  result: AIExtractResult;
}

export interface EnsembleClaim {
  vectorType: EnsembleVector;
  value: string;
  normalizedValue: string;
  supportingProviders: string[];
  sourceUrls: string[];
  sourceDomains: string[];
  agreementCount: number;
  confidence: number;
  selected: boolean;
}

export interface AIEnsembleResult {
  claims: EnsembleClaim[];
  selected: Partial<Record<EnsembleVector, string | null>>;
  agreement: Partial<Record<EnsembleVector, number>>;
  disagreements: Partial<Record<EnsembleVector, string[]>>;
  ownerResolutions: OwnerResolution[];
  sources: string[];
  citationUrls: string[];
  adjudicator?: {
    source: string;
    selectedValues: Partial<Record<EnsembleVector, string | null>>;
    disagreements: Partial<Record<EnsembleVector, string[]>>;
  };
}

export function buildEnsembleAdjudicationText(
  entityName: string,
  entityType: string,
  providerResults: readonly EnsembleProviderResult[],
): string {
  return [
    `ENSEMBLE ADJUDICATION for "${entityName}" (${entityType}).`,
    "Compare independent provider answers below. Preserve every plausible value as a candidate, but select a value only when the supplied evidence supports it.",
    "Never invent, normalize into a new value, or infer an email/phone. A disagreement must remain visible in the output.",
    ...providerResults.map(({ provider, result }) => JSON.stringify({
      provider,
      email: result.email,
      phone: result.phone,
      linkedin: result.linkedin,
      instagram: result.instagram,
      twitter: result.twitter,
      citations: result.citations,
      ownerResolutions: result.ownerResolutions,
    })),
  ].join("\n");
}

export function applyEnsembleAdjudication(
  ensemble: AIEnsembleResult,
  adjudicator: AIExtractResult,
): AIEnsembleResult {
  const selectedValues: Partial<Record<EnsembleVector, string | null>> = {};
  const vectorTypes: EnsembleVector[] = ["email", "phone", "linkedin", "instagram", "twitter"];

  for (const vectorType of vectorTypes) {
    const proposed = adjudicator[vectorType];
    if (!proposed) {
      selectedValues[vectorType] = ensemble.selected[vectorType] ?? null;
      continue;
    }
    const normalized = normalize(vectorType, proposed);
    const matchingClaim = ensemble.claims.find(
      (claim) => claim.vectorType === vectorType && claim.normalizedValue === normalized,
    );
    // The adjudicator may select among discovered claims, but may not invent a
    // new contact value that no search provider supplied.
    selectedValues[vectorType] = matchingClaim?.value ?? ensemble.selected[vectorType] ?? null;
    if (matchingClaim) {
      for (const claim of ensemble.claims) {
        if (claim.vectorType === vectorType) {
          claim.selected = claim.normalizedValue === matchingClaim.normalizedValue;
        }
      }
    }
  }

  return {
    ...ensemble,
    selected: selectedValues,
    adjudicator: {
      source: adjudicator.source,
      selectedValues,
      disagreements: ensemble.disagreements,
    },
  };
}

function normalize(vectorType: EnsembleVector, value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (vectorType === "phone") return trimmed.replace(/\D/g, "");
  if (vectorType === "email") return trimmed.replace(/\s+/g, "");
  return trimmed
    .replace(/^https?:\/\/(www\.)?/i, "")
    .split(/[?#]/, 1)[0]!
    .replace(/\/+$/, "");
}

function domainFor(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function valuesFor(result: AIExtractResult, vectorType: EnsembleVector): string[] {
  const value = result[vectorType];
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

/**
 * Reconcile independent search answers without discarding minority claims.
 *
 * Provider agreement is discovery evidence, not proof of a direct route. Every
 * distinct value remains in `claims`; `selected` is only the highest-support
 * value and is safe to use as an enrichment hint. Canonical citation domains
 * are retained separately so downstream promotion can still require fetched
 * claim pages and independent publishers.
 */
export function reconcileAIResults(
  providerResults: readonly EnsembleProviderResult[],
): AIEnsembleResult {
  const grouped = new Map<string, {
    vectorType: EnsembleVector;
    value: string;
    providers: Set<string>;
    urls: Set<string>;
  }>();
  const vectorTypes: EnsembleVector[] = ["email", "phone", "linkedin", "instagram", "twitter"];

  for (const { provider, result } of providerResults) {
    for (const vectorType of vectorTypes) {
      for (const value of valuesFor(result, vectorType)) {
        const normalizedValue = normalize(vectorType, value);
        if (!normalizedValue) continue;
        const key = `${vectorType}|${normalizedValue}`;
        const current = grouped.get(key) ?? {
          vectorType,
          value,
          providers: new Set<string>(),
          urls: new Set<string>(),
        };
        current.providers.add(provider);
        for (const url of result.citations) {
          const canonical = canonicalizeUrl(url);
          if (canonical) current.urls.add(canonical);
        }
        grouped.set(key, current);
      }
    }
  }

  const claims = [...grouped.values()].map((claim) => {
    const sourceUrls = [...claim.urls];
    const sourceDomains = [...new Set(sourceUrls.map(domainFor).filter((v): v is string => Boolean(v)))];
    const supportingProviders = [...claim.providers];
    return {
      vectorType: claim.vectorType,
      value: claim.value,
      normalizedValue: normalize(claim.vectorType, claim.value),
      supportingProviders,
      sourceUrls,
      sourceDomains,
      agreementCount: supportingProviders.length,
      confidence: Math.min(100, 40 + supportingProviders.length * 15 + Math.min(sourceDomains.length, 3) * 5),
      selected: false,
    };
  });

  const selected: Partial<Record<EnsembleVector, string | null>> = {};
  const agreement: Partial<Record<EnsembleVector, number>> = {};
  const disagreements: Partial<Record<EnsembleVector, string[]>> = {};
  for (const vectorType of vectorTypes) {
    const candidates = claims
      .filter((claim) => claim.vectorType === vectorType)
      .sort((a, b) =>
        b.agreementCount - a.agreementCount
        || b.sourceDomains.length - a.sourceDomains.length
        || b.sourceUrls.length - a.sourceUrls.length
        || a.value.localeCompare(b.value),
      );
    if (candidates.length === 0) {
      selected[vectorType] = null;
      agreement[vectorType] = 0;
      continue;
    }
    candidates[0]!.selected = true;
    selected[vectorType] = candidates[0]!.value;
    agreement[vectorType] = candidates[0]!.agreementCount;
    if (candidates.length > 1) disagreements[vectorType] = candidates.map((candidate) => candidate.value);
  }

  const ownerByKey = new Map<string, OwnerResolution>();
  for (const { result } of providerResults) {
    for (const owner of result.ownerResolutions) {
      const key = `${owner.name.trim().toLowerCase()}|${owner.role}`;
      const current = ownerByKey.get(key);
      if (!current) {
        ownerByKey.set(key, { ...owner, sourceUrls: [...owner.sourceUrls] });
        continue;
      }
      current.sourceUrls = [...new Set([...current.sourceUrls, ...owner.sourceUrls])];
      if (current.ownershipStatus !== "confirmed" && owner.ownershipStatus === "confirmed") {
        current.ownershipStatus = "confirmed";
      } else if (current.ownershipStatus === "not_established" && owner.ownershipStatus === "probable") {
        current.ownershipStatus = "probable";
      }
    }
  }

  return {
    claims,
    selected,
    agreement,
    disagreements,
    ownerResolutions: [...ownerByKey.values()].slice(0, 24),
    sources: [...new Set(providerResults.map(({ result }) => result.source).filter((source) => source !== "none"))],
    citationUrls: [...new Set(providerResults.flatMap(({ result }) => result.citations.map(canonicalizeUrl).filter((url): url is string => Boolean(url))))],
  };
}