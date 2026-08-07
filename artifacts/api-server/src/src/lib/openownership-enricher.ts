/**
 * OpenOwnership BODS Enricher
 *
 * Queries the OpenOwnership Beneficial Ownership Data Standard (BODS) dataset
 * for beneficial ownership records. Aggregates data from:
 *   - UK PSC (Persons with Significant Control) — richer than CH alone
 *   - Ukraine Beneficial Ownership Register
 *   - Denmark Ownership Register
 *   - Slovakia Business Register
 *   - And more jurisdictions via the BODS standard
 *
 * API: https://api.openownership.org/  (no auth required)
 * Bulk data: https://bods-data.openownership.org/
 *
 * Also queries OpenCorporates network API for UBO chains where available.
 */

import { logger } from "./logger";

const OO_API = "https://api.openownership.org";
const OO_SEARCH = `${OO_API}/entities`;

export interface BodsOwner {
  name: string;
  type: "person" | "entity" | "unknown";
  nationality?: string;
  residenceCountry?: string;
  birthYear?: number;
  ownershipPercentage?: number;
  controlDescription?: string;
  startDate?: string;
  endDate?: string;
  isActive: boolean;
  identifiers?: Array<{ scheme: string; id: string }>;
  sourceRegister?: string;
  jurisdiction?: string;
}

export interface BodsEntity {
  id: string;
  name: string;
  jurisdiction?: string;
  incorporationDate?: string;
  dissolutionDate?: string;
  companyNumber?: string;
  registeredAddress?: string;
  isActive?: boolean;
  entityType?: string;
  owners: BodsOwner[];
  sourceStatements?: string[];
  profileUrl?: string;
}

export interface OpenOwnershipResult {
  found: boolean;
  entities: BodsEntity[];
  query: string;
  totalMatches: number;
  error?: string;
}

// ── OpenOwnership API client ──────────────────────────────────────────────────

async function searchOpenOwnership(name: string, limit = 10): Promise<BodsEntity[]> {
  try {
    const url = `${OO_SEARCH}?name=${encodeURIComponent(name)}&per_page=${limit}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "ApexFinder-OSINT/2.0 (research@apexfinder.private)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      // API may return 404 for no results — treat as empty
      if (resp.status === 404) return [];
      throw new Error(`OpenOwnership API HTTP ${resp.status}`);
    }

    const data = await resp.json() as any;
    const items: any[] = data?.data ?? data?.results ?? (Array.isArray(data) ? data : []);

    return items.slice(0, limit).map((item: any): BodsEntity => {
      const owners: BodsOwner[] = (item?.beneficial_owners ?? item?.owners ?? []).map((o: any): BodsOwner => ({
        name: o?.name ?? o?.entity_name ?? "Unknown",
        type: o?.entity_type === "natural-person" ? "person" : o?.entity_type === "legal-entity" ? "entity" : "unknown",
        nationality: o?.nationality ?? undefined,
        residenceCountry: o?.residence_country ?? undefined,
        birthYear: o?.birth_year ?? (o?.birth_date ? parseInt(o.birth_date.slice(0, 4)) : undefined),
        ownershipPercentage: o?.ownership_percentage ?? o?.share_percentage ?? undefined,
        controlDescription: o?.control_description ?? o?.mechanism ?? undefined,
        startDate: o?.start_date ?? undefined,
        endDate: o?.end_date ?? undefined,
        isActive: !o?.end_date,
        identifiers: o?.identifiers ?? undefined,
        sourceRegister: o?.source_register ?? o?.data_source ?? undefined,
        jurisdiction: o?.jurisdiction ?? undefined,
      }));

      return {
        id: item?.id ?? item?.entity_id ?? String(Math.random()),
        name: item?.name ?? item?.company_name ?? name,
        jurisdiction: item?.jurisdiction ?? item?.country ?? undefined,
        incorporationDate: item?.incorporation_date ?? undefined,
        dissolutionDate: item?.dissolution_date ?? undefined,
        companyNumber: item?.company_number ?? item?.registration_number ?? undefined,
        registeredAddress: item?.registered_address ?? undefined,
        isActive: item?.dissolution_date == null,
        entityType: item?.entity_type ?? undefined,
        owners,
        profileUrl: item?.id ? `${OO_API}/entities/${item.id}` : undefined,
      };
    });
  } catch (err: any) {
    logger.debug({ name, err: err.message }, "[OpenOwnership] search failed");
    return [];
  }
}

// ── UK PSC supplemental query ─────────────────────────────────────────────────

/** Query PSC data directly from Companies House for richer UK ownership data */
async function queryUkPsc(companyName: string): Promise<BodsOwner[]> {
  const chKey = process.env["COMPANIES_HOUSE_API_KEY"];
  if (!chKey) return [];

  try {
    // Search for company
    const searchResp = await fetch(
      `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=3`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${chKey}:`).toString("base64")}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!searchResp.ok) return [];
    const searchData = await searchResp.json() as any;
    const companies: any[] = searchData?.items ?? [];
    if (!companies.length) return [];

    const companyNumber: string = companies[0]?.company_number;
    if (!companyNumber) return [];

    // Get PSC (Persons with Significant Control)
    const pscResp = await fetch(
      `https://api.company-information.service.gov.uk/company/${companyNumber}/persons-with-significant-control`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${chKey}:`).toString("base64")}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!pscResp.ok) return [];
    const pscData = await pscResp.json() as any;
    const pscs: any[] = pscData?.items ?? [];

    return pscs.map((psc: any): BodsOwner => ({
      name: psc?.name ?? "Unknown",
      type: psc?.kind === "individual-person-with-significant-control" ? "person" : "entity",
      nationality: psc?.nationality ?? undefined,
      residenceCountry: psc?.country_of_residence ?? undefined,
      birthYear: psc?.date_of_birth?.year ?? undefined,
      ownershipPercentage: psc?.natures_of_control?.includes("ownership-of-shares-more-than-25-percent-registered-overseas-entity") ? 25 : undefined,
      controlDescription: (psc?.natures_of_control ?? []).join("; "),
      startDate: psc?.notified_on ?? undefined,
      endDate: psc?.ceased_on ?? undefined,
      isActive: !psc?.ceased_on,
      sourceRegister: "uk-psc",
      jurisdiction: "GB",
    }));
  } catch (err: any) {
    logger.debug({ companyName, err: err.message }, "[OpenOwnership] UK PSC query failed");
    return [];
  }
}

// ── Main enrichment function ──────────────────────────────────────────────────

/**
 * Search OpenOwnership BODS data for beneficial ownership records.
 *
 * @param entityName  Company or person name to search
 * @param includeUkPsc  Whether to also query UK PSC directly (slower, richer for UK entities)
 */
export async function enrichWithOpenOwnership(
  entityName: string,
  includeUkPsc = true
): Promise<OpenOwnershipResult> {
  const query = entityName.trim();
  if (!query) {
    return { found: false, entities: [], query, totalMatches: 0 };
  }

  const [ooEntities, ukPscOwners] = await Promise.all([
    searchOpenOwnership(query),
    includeUkPsc ? queryUkPsc(query) : Promise.resolve<BodsOwner[]>([]),
  ]);

  // Merge UK PSC results into the first matching OO entity, or create a new one
  if (ukPscOwners.length > 0) {
    if (ooEntities.length > 0 && ooEntities[0]) {
      // Merge into existing entity, avoiding duplicates
      const existingNames = new Set(ooEntities[0].owners.map(o => o.name.toLowerCase()));
      for (const psc of ukPscOwners) {
        if (!existingNames.has(psc.name.toLowerCase())) {
          ooEntities[0].owners.push(psc);
        }
      }
    } else {
      // Create a synthetic entity from PSC data
      ooEntities.push({
        id: `uk-psc-${query}`,
        name: query,
        jurisdiction: "GB",
        isActive: true,
        entityType: "legal-entity",
        owners: ukPscOwners,
        sourceStatements: ["uk-psc"],
      });
    }
  }

  logger.info(
    { query, entityCount: ooEntities.length, totalOwners: ooEntities.reduce((s, e) => s + e.owners.length, 0) },
    "[OpenOwnership] enrichment complete"
  );

  return {
    found: ooEntities.length > 0,
    entities: ooEntities,
    query,
    totalMatches: ooEntities.length,
  };
}

/** Format OpenOwnership findings for notes */
export function summariseOwnershipFindings(result: OpenOwnershipResult): string | null {
  if (!result.found || result.entities.length === 0) return null;
  const lines = [`OpenOwnership BODS — ${result.entities.length} entity(ies):`];
  for (const e of result.entities.slice(0, 3)) {
    lines.push(`  • ${e.name} [${e.jurisdiction ?? "?"}]${e.isActive === false ? " (dissolved)" : ""}`);
    for (const o of e.owners.slice(0, 5)) {
      const pct = o.ownershipPercentage ? ` ${o.ownershipPercentage}%` : "";
      lines.push(`    → ${o.name} (${o.type})${pct}${o.isActive ? "" : " [ceased]"}`);
    }
  }
  return lines.join("\n");
}
