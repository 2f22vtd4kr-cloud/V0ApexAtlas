/**
 * contact-attribution.ts — J6 Multi-Dimensional Contact Attribution Scoring
 *
 * Evaluates a contact candidate on five independent dimensions and returns
 * an attribution score (0–1) alongside the per-dimension breakdown.
 *
 * A candidate is "attributed" when score ≥ THRESHOLD and at least one valid
 * contact vector (email or phone) is present.
 *
 * Dimensions:
 *   1. sourceAuthority   — how reliable is the most authoritative source?
 *   2. corroboration     — how many independent source families agree?
 *   3. validation        — does the contact pass structural + local-part checks?
 *   4. directness        — personal contact vs. organisation switchboard?
 *   5. domainFit         — does the email domain match the resolved employer?
 *
 * Proximity evidence (shared club, event, asset, geography) may influence
 * research prioritisation but must NOT raise any attribution dimension.
 */

// ── Attribution threshold ──────────────────────────────────────────────────────

const ATTRIBUTION_THRESHOLD = 0.52;

// ── Source authority table ────────────────────────────────────────────────────

const SOURCE_AUTHORITY_MAP: Record<string, number> = {
  Wikidata:              0.92,
  EDGAR:                 0.90,
  CompaniesHouse:        0.90,
  BRREG:                 0.88,
  ProPublica:            0.87,
  GLEIF:                 0.85,
  ORCID:                 0.83,
  GitHub:                0.80,
  ContactPage:           0.79,
  "Website-Scrape":      0.72,
  "website-scrape":      0.72,
  GraphNeighbour:        0.65,
  Wikipedia:             0.60,
  Wayback:               0.58,
  DDG:                   0.52,
  "phase-j-in-house":    0.45,
};

// ── Generic/organisation local-part detection ─────────────────────────────────

const ORG_LOCAL_PARTS = new Set([
  "info", "contact", "hello", "admin", "office", "mail", "support",
  "ir", "media", "press", "noreply", "no-reply", "webmaster", "legal",
  "careers", "jobs", "billing", "sales", "hr", "enquiries", "helpdesk",
  "help", "service", "team", "general", "all", "news", "marketing",
  "customerservice", "customer-service", "client", "clientservices",
]);

export function isGenericLocalPart(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  return ORG_LOCAL_PARTS.has(local);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AttributionDimensions {
  sourceAuthority: number;   // 0-1
  corroboration:   number;   // 0-1
  validation:      number;   // 0-1
  directness:      number;   // 0-1
  domainFit:       number;   // 0-1
}

export interface AttributionResult {
  attributed:  boolean;
  score:       number;                // geometric mean of all dimensions, 0-1
  dimensions:  AttributionDimensions;
  explanation: string;
  /** Which threshold was used (informational) */
  threshold:   number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authorityOf(source: string): number {
  for (const [key, score] of Object.entries(SOURCE_AUTHORITY_MAP)) {
    if (source.startsWith(key)) return score;
  }
  return 0.38;
}

function geometricMean(values: number[]): number {
  if (!values.length) return 0;
  const product = values.reduce((acc, v) => acc * Math.max(v, 0.01), 1);
  return Math.pow(product, 1 / values.length);
}

// ── Main scoring function ─────────────────────────────────────────────────────

export function scoreAttribution(params: {
  email:           string | null;
  phone:           string | null;
  sources:         string[];
  entityType:      string;
  resolvedDomain:  string | null;
  isValidEmail:    boolean;
  isValidPhone:    boolean;
}): AttributionResult {
  const { email, phone, sources, entityType, resolvedDomain, isValidEmail, isValidPhone } = params;

  // 1. Source authority — best single source
  const authority = sources.length ? Math.max(...sources.map(authorityOf)) : 0.28;

  // 2. Corroboration — independent source families (split on first separator)
  const families = new Set(
    sources.map(s => s.split(/[-_\s]/)[0]?.toLowerCase() ?? s.toLowerCase()),
  );
  // 1 family = 0.33, 2 families = 0.67, 3+ = 1.0
  const corroboration = Math.min(families.size / 3, 1.0);

  // 3. Validation — structural validity + not generic
  let validation = 0;
  if (email && isValidEmail) {
    validation = isGenericLocalPart(email) ? 0.28 : 0.90;
  } else if (phone && isValidPhone) {
    validation = 0.72;
  }

  // 4. Directness — personal vs organisation-level contact
  let directness = 0.72;  // default: assume personal for HNWI / Gatekeeper
  if (["Corporation", "Trust"].includes(entityType)) {
    if (email && !isGenericLocalPart(email)) directness = 0.60;
    else if (email) directness = 0.28;
    else directness = 0.40;
  }
  if (email && isGenericLocalPart(email)) directness = Math.min(directness, 0.28);
  if (!email && !phone) directness = 0.08;

  // 5. Domain fit — does email domain match resolved employer domain?
  let domainFit = 0.48;  // neutral when no domain context
  if (email && isValidEmail && resolvedDomain) {
    const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";
    if (emailDomain === resolvedDomain) {
      domainFit = 1.0;  // exact match
    } else if (
      emailDomain.endsWith(`.${resolvedDomain}`) ||
      resolvedDomain.endsWith(`.${emailDomain}`)
    ) {
      domainFit = 0.85;  // subdomain / parent-domain match
    } else {
      domainFit = 0.18;  // mismatch is a meaningful red flag
    }
  } else if (phone && isValidPhone && resolvedDomain) {
    domainFit = 0.52;  // phones are domain-agnostic but domain knowledge helps
  } else if (email && isValidEmail) {
    domainFit = 0.44;  // no domain context — slightly below neutral
  }

  const dimensions: AttributionDimensions = {
    sourceAuthority: authority,
    corroboration,
    validation,
    directness,
    domainFit,
  };

  const score = geometricMean(Object.values(dimensions));
  const attributed = score >= ATTRIBUTION_THRESHOLD && (isValidEmail || isValidPhone);

  // Build human-readable explanation
  const parts: string[] = [];
  if (authority >= 0.85) parts.push("high-authority source");
  if (families.size >= 2) parts.push(`${families.size} independent source families`);
  if (email && isValidEmail && !isGenericLocalPart(email)) parts.push("personal local-part");
  if (domainFit >= 0.80 && resolvedDomain) parts.push(`domain match: ${resolvedDomain}`);
  if (score < ATTRIBUTION_THRESHOLD) parts.push("below attribution threshold");

  return {
    attributed,
    score,
    dimensions,
    explanation: parts.length ? parts.join("; ") : "insufficient evidence for attribution",
    threshold: ATTRIBUTION_THRESHOLD,
  };
}

/**
 * Combine attribution results across multiple contact candidates and return
 * whether any one of them clears the threshold.
 */
export function anyAttributed(
  candidates: Array<{ email: string | null; phone: string | null; sources: string[]; entityType: string; resolvedDomain: string | null; isValidEmail: boolean; isValidPhone: boolean }>,
): boolean {
  return candidates.some(c => scoreAttribution(c).attributed);
}
