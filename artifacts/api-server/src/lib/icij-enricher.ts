/**
 * ICIJ Offshore Leaks Enricher
 *
 * Uses the free ICIJ Offshore Leaks reconciliation API to find offshore
 * structures (BVI SPVs, foundations, trusts) linked to an entity name.
 * Covers: Panama Papers, Pandora Papers, Paradise Papers, Bahamas Leaks,
 * and Offshore Leaks — 810,000+ offshore entities with UBOs, intermediaries,
 * and registered agents.
 *
 * API: POST https://offshoreleaks.icij.org/reconcile
 * No auth required. Free. No rate limits documented.
 *
 * Docs: https://offshoreleaks.icij.org/docs/reconciliation
 */

import { logger } from "./logger";

const RECONCILE_URL = "https://offshoreleaks.icij.org/reconcile";
const ENTITY_DETAIL_URL = "https://offshoreleaks.icij.org/nodes";

export interface IcijMatch {
  id: string;
  name: string;
  score: number;
  match: boolean;
  type: Array<{ id: string; name: string }>;
  // Extended fields from node detail fetch
  jurisdiction?: string | null;
  incorporationDate?: string | null;
  inactivationDate?: string | null;
  registeredAddress?: string | null;
  countryCode?: string | null;
  sourceId?: string | null; // panama_papers, pandora_papers, paradise_papers, etc.
  nodeType?: string | null; // Entity, Officer, Intermediary, Address, Other
  linkedOfficers?: Array<{ name: string; relationship: string }>;
  status?: string | null;
  profileUrl?: string | null;
}

export interface IcijEnrichResult {
  found: boolean;
  totalMatches: number;
  matches: IcijMatch[];
  sources: string[]; // Which leak datasets produced results
  queryName: string;
  error?: string;
}

/** POST the reconciliation API with up to 5 queries at once */
async function reconcile(
  queries: Record<string, { query: string; type?: string; limit?: number }>
): Promise<Record<string, { result: IcijMatch[] }>> {
  const resp = await fetch(RECONCILE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "ApexFinder-OSINT/2.0 (research@apexfinder.private)",
      "Accept": "application/json",
    },
    body: `queries=${encodeURIComponent(JSON.stringify(queries))}`,
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    throw new Error(`ICIJ reconcile HTTP ${resp.status}: ${resp.statusText}`);
  }

  return resp.json() as Promise<Record<string, { result: IcijMatch[] }>>;
}

/** Fetch extended node detail from the ICIJ graph */
async function fetchNodeDetail(nodeId: string): Promise<Partial<IcijMatch>> {
  try {
    // The public node endpoint returns HTML — parse JSON-LD or structured data
    const url = `${ENTITY_DETAIL_URL}/${encodeURIComponent(nodeId)}.json`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "ApexFinder-OSINT/2.0",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return {};
    const data = await resp.json() as any;
    return {
      jurisdiction: data?.jurisdiction ?? data?.country_codes?.[0] ?? null,
      incorporationDate: data?.incorporation_date ?? null,
      inactivationDate: data?.inactivation_date ?? null,
      registeredAddress: data?.registered_address ?? null,
      status: data?.status ?? null,
      nodeType: data?.node_type ?? null,
      sourceId: data?.sourceID ?? data?.source_id ?? null,
      profileUrl: `https://offshoreleaks.icij.org/nodes/${nodeId}`,
      linkedOfficers: (data?.linked_relationships ?? []).map((r: any) => ({
        name: r?.node?.name ?? r?.name ?? "Unknown",
        relationship: r?.relationship_type ?? r?.rel_type ?? "linked",
      })).slice(0, 20),
    };
  } catch {
    return {};
  }
}

/**
 * Main enrichment function.
 * Queries the ICIJ Offshore Leaks database for an entity name and optional aliases.
 *
 * @param entityName  Primary entity name to search
 * @param aliases     Optional alternative names / transliterations
 * @param fetchDetail Whether to fetch extended node details (slower, more data)
 */
export async function enrichWithIcij(
  entityName: string,
  aliases: string[] = [],
  fetchDetail = false
): Promise<IcijEnrichResult> {
  const queryName = entityName.trim();
  if (!queryName) {
    return { found: false, totalMatches: 0, matches: [], sources: [], queryName };
  }

  // Build multi-query payload (primary + up to 4 aliases)
  const allNames = [queryName, ...aliases.slice(0, 4)];
  const queries: Record<string, { query: string; type: string; limit: number }> = {};
  allNames.forEach((name, i) => {
    queries[`q${i}`] = { query: name, type: "/Entity", limit: 5 };
  });

  let rawResults: Record<string, { result: IcijMatch[] }>;
  try {
    rawResults = await reconcile(queries);
  } catch (err: any) {
    logger.warn({ err: err.message, entityName }, "[ICIJ] reconcile API error");
    return { found: false, totalMatches: 0, matches: [], sources: [], queryName, error: err.message };
  }

  // Flatten and deduplicate by ID
  const seen = new Set<string>();
  const allMatches: IcijMatch[] = [];
  for (const key of Object.keys(queries)) {
    for (const match of rawResults[key]?.result ?? []) {
      if (!seen.has(match.id)) {
        seen.add(match.id);
        allMatches.push(match);
      }
    }
  }

  // Sort by score descending, cap at 15
  allMatches.sort((a, b) => b.score - a.score);
  const topMatches = allMatches.slice(0, 15);

  // Optionally enrich top matches with node detail
  if (fetchDetail && topMatches.length > 0) {
    const detailLimit = Math.min(topMatches.length, 5); // max 5 detail fetches
    const details = await Promise.allSettled(
      topMatches.slice(0, detailLimit).map(m => fetchNodeDetail(m.id))
    );
    details.forEach((r, i) => {
      if (r.status === "fulfilled") {
        Object.assign(topMatches[i]!, r.value);
      }
    });
  }

  // Determine which leak databases produced results
  const sourceMap: Record<string, string> = {
    panama_papers: "Panama Papers",
    pandora_papers: "Pandora Papers",
    paradise_papers: "Paradise Papers",
    bahamas_leaks: "Bahamas Leaks",
    offshore_leaks: "Offshore Leaks",
    icij: "ICIJ",
  };
  const foundSources = new Set<string>();
  for (const m of topMatches) {
    if (m.sourceId) {
      const label = sourceMap[m.sourceId.toLowerCase()] ?? m.sourceId;
      foundSources.add(label);
    }
  }

  logger.info(
    { entityName, matchCount: topMatches.length, sources: [...foundSources] },
    "[ICIJ] enrichment complete"
  );

  return {
    found: topMatches.length > 0,
    totalMatches: topMatches.length,
    matches: topMatches,
    sources: [...foundSources],
    queryName,
  };
}

/**
 * Summarise ICIJ findings for injection into entity notes / metadata.
 * Returns a compact string or null if no offshore structures found.
 */
export function summariseIcijFindings(result: IcijEnrichResult): string | null {
  if (!result.found || result.matches.length === 0) return null;

  const lines: string[] = [`ICIJ Offshore Leaks — ${result.totalMatches} match(es):`];
  for (const m of result.matches.slice(0, 5)) {
    const parts: string[] = [`  • ${m.name} (score: ${m.score.toFixed(2)})`];
    if (m.jurisdiction) parts.push(`[${m.jurisdiction}]`);
    if (m.sourceId) parts.push(`via ${m.sourceId.replace(/_/g, " ")}`);
    if (m.nodeType) parts.push(`— ${m.nodeType}`);
    if (m.profileUrl) parts.push(`→ ${m.profileUrl}`);
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}
