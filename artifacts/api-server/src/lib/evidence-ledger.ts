export type SourceFamily = "official" | "registry" | "press" | "social" | "search" | "unknown";

export interface EvidenceItem {
  url: string;
  value: string;
  label?: string | null;
}

export interface CanonicalEvidenceItem extends EvidenceItem {
  canonicalUrl: string | null;
  canonicalDomain: string | null;
  normalizedValue: string;
  sourceFamily: SourceFamily;
}

export interface LedgerSummary {
  totalItems: number;
  uniqueItems: number;
  corroboratingFamilies: number;
  corroboratingDomains: number;
  conflictCount: number;
  score: number;
}

const TRACKING_PARAM_RE = /^(utm_(source|medium|campaign|term|content|id)|gclid|fbclid|mc_cid|mc_eid|ref|ref_src|igshid|cmpid|yclid|mkt_tok)$/i;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function canonicalizeUrl(raw: string | null | undefined): string | null {
  const input = raw?.trim();
  if (!input) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hostname = host;
  url.hash = "";
  const keptParams = new URLSearchParams();
  url.searchParams.forEach((value, key) => {
    if (!TRACKING_PARAM_RE.test(key)) keptParams.append(key, value);
  });
  const search = keptParams.toString();
  url.search = search ? `?${search}` : "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function getSourceFamily(hostname: string | null | undefined): SourceFamily {
  const host = hostname?.trim().toLowerCase().replace(/^www\./, "") ?? "";
  if (!host) return "unknown";
  if (/\b(go|gov|edu)\b/.test(host) || host.endsWith(".gov") || host.endsWith(".edu")) return "official";
  if (/(registry|registr|register|companieshouse|handelsregister|brreg|opencorporates|sec\.gov|fca\.org\.uk|lei|gleif|edgar|inpi|infogreffe|sbi|kvk|kbo|zefix|cvr|ytj|bodacc|ares|landregistry|hmlr|faa)/.test(host)) return "registry";
  if (/(press|news|media|prnewswire|globenewswire|businesswire|reuters|apnews|bloomberg|forbes|wsj|ft\.com|economist)/.test(host)) return "press";
  if (/(twitter\.com|x\.com|linkedin\.com|instagram\.com|facebook\.com|t\.me|telegram\.me|youtube\.com|github\.com|reddit\.com|medium\.com|substack\.com)/.test(host)) return "social";
  if (/(google\.com|bing\.com|duckduckgo\.com|yahoo\.com|search\.|baidu\.com|yandex\.com)/.test(host)) return "search";
  return "unknown";
}

export function normalizeEvidenceValue(value: string | null | undefined): string {
  return normalizeWhitespace((value ?? "").toLowerCase());
}

export function canonicalizeEvidenceItem(item: EvidenceItem): CanonicalEvidenceItem {
  const canonicalUrl = canonicalizeUrl(item.url);
  const canonicalDomain = canonicalUrl ? new URL(canonicalUrl).hostname : null;
  return {
    ...item,
    url: item.url.trim(),
    value: item.value,
    canonicalUrl,
    canonicalDomain,
    normalizedValue: normalizeEvidenceValue(item.value),
    sourceFamily: getSourceFamily(canonicalDomain),
  };
}

export function dedupeEvidence(items: readonly EvidenceItem[]): CanonicalEvidenceItem[] {
  const seen = new Set<string>();
  const result: CanonicalEvidenceItem[] = [];
  for (const item of items) {
    const canonical = canonicalizeEvidenceItem(item);
    const key = `${canonical.canonicalUrl ?? ""}|${canonical.canonicalDomain ?? ""}|${canonical.normalizedValue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(canonical);
  }
  return result;
}

export function scoreCorroboration(items: readonly EvidenceItem[]): LedgerSummary {
  const unique = dedupeEvidence(items);
  const familySet = new Set(unique.map((item) => item.sourceFamily).filter((family) => family !== "unknown"));
  const domainSet = new Set(unique.map((item) => item.canonicalDomain).filter((domain): domain is string => Boolean(domain)));
  const normalizedToDomains = new Map<string, Set<string>>();
  for (const item of unique) {
    const domains = normalizedToDomains.get(item.normalizedValue) ?? new Set<string>();
    if (item.canonicalDomain) domains.add(item.canonicalDomain);
    normalizedToDomains.set(item.normalizedValue, domains);
  }
  let conflicts = 0;
  for (const domains of normalizedToDomains.values()) {
    if (domains.size > 1) conflicts += domains.size - 1;
  }
  const corroboratingFamilies = familySet.size;
  const corroboratingDomains = domainSet.size;
  const base = corroboratingFamilies * 20 + corroboratingDomains * 5 + unique.length * 3;
  const score = Math.max(0, Math.min(100, base - conflicts * 15));
  return {
    totalItems: items.length,
    uniqueItems: unique.length,
    corroboratingFamilies,
    corroboratingDomains,
    conflictCount: conflicts,
    score,
  };
}
