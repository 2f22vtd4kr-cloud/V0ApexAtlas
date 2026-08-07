/**
 * Phase J3 — deterministic identity resolution.
 *
 * This module only produces review candidates. It never merges entities and
 * never promotes a contact. Contextual signals are required so a shared name
 * alone cannot create an attributable identity link.
 */

export interface IdentityEntityInput {
  id: number;
  name: string;
  type: string;
  nationality?: string | null;
  knownResidences?: string | null;
  sourceRegistries?: string | null;
  metadata?: string | null;
  notes?: string | null;
  linkedinUrl?: string | null;
  personalWebsite?: string | null;
  twitterHandle?: string | null;
  instagramHandle?: string | null;
  telegramHandle?: string | null;
}

export interface IdentityBundleData {
  normalizedName: string;
  variants: string[];
  registryIdentifiers: string[];
  affiliations: string[];
  location: string | null;
  publicAddress: string | null;
  assetIdentifiers: string[];
  publicProfileUrls: string[];
  provenance: Array<{ source: string; kind: string; value?: string }>;
}

export interface IdentityMatch {
  score: number;
  signals: string[];
}

const CORPORATE_SUFFIXES = new Set([
  "ag", "asa", "as", "bv", "co", "company", "corp", "corporation", "gmbh",
  "group", "inc", "limited", "llc", "lp", "ltd", "nv", "oy", "partners",
  "plc", "sa", "sarl", "sro", "trust",
]);

function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === "string" ? [item.trim()] : []);
  const text = asText(value);
  return text ? [text] : [];
}

export function normalizeIdentityName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalizeIdentityName(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !CORPORATE_SUFFIXES.has(token));
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function nameVariants(name: string): string[] {
  const normalized = normalizeIdentityName(name);
  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length < 2) return normalized ? [normalized] : [];

  const variants = [normalized];
  if (parts.length === 2) variants.push(`${parts[1]} ${parts[0]}`);
  if (parts.length === 3) {
    variants.push(`${parts[1]} ${parts[2]} ${parts[0]}`);
    variants.push(`${parts[2]} ${parts[0]} ${parts[1]}`);
  }
  const initials = parts.map((part) => part[0]).join("");
  if (initials.length >= 2) variants.push(`${parts[0]} ${initials}`);
  return unique(variants);
}

function findIdentifierValues(metadata: Record<string, unknown>, notes: string | null | undefined): string[] {
  const keys = [
    "cik", "companyNumber", "company_number", "orgnr", "organisasjonsnummer",
    "ico", "lei", "registrationNumber", "registration_number", "nNumber",
    "tailNumber", "aircraftRegistration", "accessionNumber",
  ];
  const values = keys.flatMap((key) => textList(metadata[key]));
  if (notes) {
    for (const pattern of [
      /\b(?:Reg|Company|Org(?:anisation)?|IČO|CIK|LEI|N-number|Tail)\s*[#:№]?\s*([A-Z0-9-]{4,})/gi,
    ]) {
      for (const match of notes.matchAll(pattern)) if (match[1]) values.push(match[1]);
    }
  }
  return unique(values.map((value) => value.toUpperCase()));
}

function sourceValues(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [value];
  } catch {
    return [value];
  }
}

export function buildIdentityBundle(entity: IdentityEntityInput): IdentityBundleData {
  const metadata = parseJson(entity.metadata);
  const sources = sourceValues(entity.sourceRegistries);
  const location = asText(entity.nationality) ?? asText(metadata.country) ?? null;
  const address = asText(entity.knownResidences) ?? asText(metadata.bizLocation) ?? asText(metadata.address);
  const affiliations = unique([
    ...textList(metadata.companyName),
    ...textList(metadata.employer),
    ...textList(metadata.affiliation),
    ...textList(metadata.affiliations),
  ]);
  const profileUrls = unique([
    entity.linkedinUrl, entity.personalWebsite,
    entity.twitterHandle, entity.instagramHandle, entity.telegramHandle,
  ].filter((value): value is string => Boolean(value?.trim())));

  return {
    normalizedName: normalizeIdentityName(entity.name),
    variants: nameVariants(entity.name),
    registryIdentifiers: findIdentifierValues(metadata, entity.notes),
    affiliations,
    location,
    publicAddress: address,
    assetIdentifiers: unique([
      ...textList(metadata.tailNumber),
      ...textList(metadata.nNumber),
      ...textList(metadata.aircraftRegistration),
      ...textList(metadata.propertyIdentifier),
    ]),
    publicProfileUrls: profileUrls,
    provenance: sources.map((source) => ({ source, kind: "registry" })),
  };
}

function tokenOverlap(left: string, right: string): number {
  const a = new Set(tokens(left));
  const b = new Set(tokens(right));
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.max(a.size, b.size);
}

function overlap(left: string[], right: string[]): number {
  let best = 0;
  for (const leftVariant of left) {
    for (const rightVariant of right) {
      best = Math.max(best, tokenOverlap(leftVariant, rightVariant));
    }
  }
  return best;
}

function sharesValue(left: string[], right: string[]): boolean {
  const b = new Set(right.map((value) => normalizeIdentityName(value)));
  return left.some((value) => b.has(normalizeIdentityName(value)));
}

function sameSource(left: IdentityBundleData, right: IdentityBundleData): boolean {
  return sharesValue(
    left.provenance.map((item) => item.source),
    right.provenance.map((item) => item.source),
  );
}

/**
 * Returns a 0–1 score and explainable signals. A name-only match is always
 * rejected because same-name rows from one registry are review noise.
 */
export function scoreIdentityMatch(
  left: IdentityBundleData,
  right: IdentityBundleData,
): IdentityMatch | null {
  const signals: string[] = [];
  const nameOverlap = overlap(left.variants, right.variants);
  if (nameOverlap < 0.5) return null;

  let score = nameOverlap * 0.55;
  if (sharesValue(left.registryIdentifiers, right.registryIdentifiers)) {
    score += 0.3;
    signals.push("shared_registry_identifier");
  }
  if (sharesValue(left.affiliations, right.affiliations)) {
    score += 0.1;
    signals.push("shared_affiliation");
  }
  if (left.location && right.location && normalizeIdentityName(left.location) === normalizeIdentityName(right.location)) {
    score += 0.08;
    signals.push("shared_location");
  }
  if (sharesValue(left.assetIdentifiers, right.assetIdentifiers)) {
    score += 0.12;
    signals.push("shared_asset_identifier");
  }
  if (sharesValue(left.publicProfileUrls, right.publicProfileUrls)) {
    score += 0.15;
    signals.push("shared_public_profile");
  }
  if (!sameSource(left, right)) signals.push("cross_registry");

  const hasContext = signals.some((signal) => signal !== "cross_registry");
  if (!hasContext || (sameSource(left, right) && signals.length === 0)) return null;
  if (score < 0.62) return null;
  return { score: Math.min(1, Number(score.toFixed(4))), signals };
}

export function candidateKey(entityId: number, candidateEntityId: number): string {
  return `${Math.min(entityId, candidateEntityId)}:${Math.max(entityId, candidateEntityId)}`;
}