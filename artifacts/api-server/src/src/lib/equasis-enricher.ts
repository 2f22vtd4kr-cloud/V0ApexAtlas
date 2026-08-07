/**
 * Equasis Vessel / Yacht Enricher
 *
 * Equasis (equasis.org) is the maritime equivalent of the FAA aircraft registry —
 * vessel ownership, beneficial owners behind flag-of-convenience registrations,
 * ISM company details, and port state control inspections.
 * Free account required for full access; we scrape the public-facing search
 * and fall back to MarineTraffic/VesselFinder open endpoints.
 *
 * Primary source: Equasis HTML scraper (with optional session cookie)
 * Fallback 1: VesselFinder API (free, no auth)
 * Fallback 2: MarineTraffic public vessel search (HTML scrape)
 *
 * Env: EQUASIS_SESSION (optional) — session cookie from a logged-in Equasis account
 *
 * This enricher is called for entities tagged with maritime assets (yachts,
 * vessels) or for European HNWIs where yacht ownership is likely.
 */

import { logger } from "./logger";

const VESSEL_FINDER_API = "https://www.vessel-finder.com/api/vessels";
const EQUASIS_SEARCH = "https://www.equasis.org/EquasisWeb/restricted/Search";
const MARINE_TRAFFIC_SEARCH = "https://www.marinetraffic.com/en/ais/index/ships/range/shiptyp:6";

export interface VesselRecord {
  imo?: string;
  mmsi?: string;
  vesselName: string;
  flag?: string;
  type?: string;
  grossTonnage?: number;
  yearBuilt?: number;
  shipManager?: string;
  registeredOwner?: string;
  technicalManager?: string;
  docCompany?: string;
  portOfRegistry?: string;
  callSign?: string;
  status?: string;
  lastPosition?: {
    lat?: number;
    lon?: number;
    speed?: number;
    course?: number;
    timestamp?: string;
    port?: string;
  };
  source: "equasis" | "vessel-finder" | "marinetraffic" | "opennames";
  profileUrl?: string;
}

export interface EquasisResult {
  found: boolean;
  vessels: VesselRecord[];
  query: string;
  source: string;
  error?: string;
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
};

// ── VesselFinder fallback ─────────────────────────────────────────────────────

async function searchVesselFinder(vesselName: string): Promise<VesselRecord[]> {
  try {
    // VesselFinder AIS API — free, no auth, returns live positions
    const url = `${VESSEL_FINDER_API}?search=${encodeURIComponent(vesselName)}&format=json`;
    const resp = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!resp.ok) return [];

    const data = await resp.json() as any;
    const vessels: any[] = Array.isArray(data) ? data : (data?.vessels ?? data?.data ?? []);

    return vessels.slice(0, 10).map((v: any): VesselRecord => ({
      imo: v?.imo ? String(v.imo) : undefined,
      mmsi: v?.mmsi ? String(v.mmsi) : undefined,
      vesselName: v?.name ?? v?.vessel_name ?? vesselName,
      flag: v?.flag ?? v?.country ?? undefined,
      type: v?.type ?? v?.vessel_type ?? undefined,
      grossTonnage: v?.gt ?? v?.gross_tonnage ?? undefined,
      yearBuilt: v?.year_built ?? undefined,
      status: v?.status ?? undefined,
      lastPosition: v?.lat && v?.lon ? {
        lat: Number(v.lat),
        lon: Number(v.lon),
        speed: v?.speed ? Number(v.speed) : undefined,
        course: v?.course ? Number(v.course) : undefined,
        timestamp: v?.timestamp ?? v?.time ?? undefined,
        port: v?.port ?? v?.destination ?? undefined,
      } : undefined,
      source: "vessel-finder",
      profileUrl: v?.imo ? `https://www.vessel-finder.com/vessels/${v.imo}` : undefined,
    }));
  } catch (err: any) {
    logger.debug({ err: err.message }, "[Equasis] VesselFinder search failed");
    return [];
  }
}

// ── IMO / MMSI lookup via OpenSea / public vessel databases ──────────────────

async function lookupByImo(imo: string): Promise<VesselRecord | null> {
  try {
    // MyShipTracking / Vessel database has free IMO lookups
    const url = `https://www.myshiptracking.com/vessels/mmsi-${imo}.html`;
    const resp = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    const extract = (label: string): string | undefined => {
      const re = new RegExp(`${label}[^<]*<[^>]+>\\s*([^<]{2,80})`, "i");
      const m = html.match(re);
      return m?.[1]?.trim() ?? undefined;
    };

    const name = extract("Vessel Name") ?? extract("Ship Name");
    if (!name) return null;

    return {
      imo,
      vesselName: name,
      flag: extract("Flag"),
      type: extract("Ship Type") ?? extract("Vessel Type"),
      grossTonnage: extract("Gross Tonnage") ? Number(extract("Gross Tonnage")?.replace(/,/g, "")) : undefined,
      registeredOwner: extract("Registered Owner") ?? extract("Owner"),
      shipManager: extract("Ship Manager") ?? extract("Manager"),
      source: "opennames",
      profileUrl: url,
    };
  } catch {
    return null;
  }
}

// ── Equasis HTML scraper (with optional session cookie) ───────────────────────

async function searchEquasis(vesselName: string): Promise<VesselRecord[]> {
  const sessionCookie = process.env["EQUASIS_SESSION"];
  if (!sessionCookie) return []; // Equasis requires login

  try {
    // POST the search form
    const body = new URLSearchParams({
      P_PAGE: "1",
      P_COUNTRY_OF_SEARCH: "",
      P_IMO_SEARCH: "",
      P_MMSI_SEARCH: "",
      P_NAME_SEARCH: vesselName,
      P_TYPE_SEARCH: "",
      P_FLAG_SEARCH: "",
      P_CALL_SIGN_SEARCH: "",
    });

    const resp = await fetch(EQUASIS_SEARCH, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": sessionCookie,
        "Referer": "https://www.equasis.org/EquasisWeb/restricted/Search",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) return [];
    const html = await resp.text();

    // Parse vessel rows from HTML table
    const rowRe = /<tr[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const tagRe = /<[^>]+>/g;
    const vessels: VesselRecord[] = [];

    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(html)) !== null) {
      const cells: string[] = [];
      let cellMatch: RegExpExecArray | null;
      const cellReCopy = new RegExp(cellRe.source, "gi");
      while ((cellMatch = cellReCopy.exec(rowMatch[1]!)) !== null) {
        cells.push(cellMatch[1]!.replace(tagRe, "").trim());
      }
      if (cells.length >= 4) {
        const [name, imo, flag, type] = cells;
        if (name && imo) {
          vessels.push({
            vesselName: name,
            imo: imo.replace(/[^0-9]/g, ""),
            flag,
            type,
            source: "equasis",
            profileUrl: imo ? `https://www.equasis.org/EquasisWeb/restricted/ShipInfo?fs=Search&P_IMO=${imo.replace(/[^0-9]/g, "")}` : undefined,
          });
        }
      }
    }

    return vessels.slice(0, 10);
  } catch (err: any) {
    logger.debug({ err: err.message }, "[Equasis] HTML scrape failed");
    return [];
  }
}

// ── Main enrichment function ──────────────────────────────────────────────────

/**
 * Search for vessels associated with an entity.
 * Tries Equasis (if session available), then VesselFinder, then IMO lookup.
 *
 * @param vesselName   Name of the vessel or person/company likely to own one
 * @param imoNumber    Known IMO number (9 digits)
 */
export async function enrichWithEquasis(
  vesselName: string,
  imoNumber?: string
): Promise<EquasisResult> {
  const query = vesselName.trim();

  // 1. Direct IMO lookup (most accurate)
  if (imoNumber && /^\d{7,9}$/.test(imoNumber)) {
    const vessel = await lookupByImo(imoNumber);
    if (vessel) {
      logger.info({ imoNumber, name: vessel.vesselName }, "[Equasis] found vessel by IMO");
      return { found: true, vessels: [vessel], query, source: "opennames" };
    }
  }

  // 2. Equasis (requires EQUASIS_SESSION)
  const equasisVessels = await searchEquasis(query);
  if (equasisVessels.length > 0) {
    logger.info({ query, count: equasisVessels.length }, "[Equasis] found vessels via Equasis");
    return { found: true, vessels: equasisVessels, query, source: "equasis" };
  }

  // 3. VesselFinder fallback
  const vfVessels = await searchVesselFinder(query);
  if (vfVessels.length > 0) {
    logger.info({ query, count: vfVessels.length }, "[Equasis] found vessels via VesselFinder");
    return { found: true, vessels: vfVessels, query, source: "vessel-finder" };
  }

  return { found: false, vessels: [], query, source: "none" };
}

/** Format vessel findings for notes */
export function summariseVesselFindings(result: EquasisResult): string | null {
  if (!result.found || result.vessels.length === 0) return null;
  const lines = [`Vessel Registry (${result.source}) — ${result.vessels.length} vessel(s):`];
  for (const v of result.vessels.slice(0, 5)) {
    const parts: string[] = [`  • ${v.vesselName}`];
    if (v.imo) parts.push(`IMO ${v.imo}`);
    if (v.flag) parts.push(`[${v.flag}]`);
    if (v.type) parts.push(`${v.type}`);
    if (v.registeredOwner) parts.push(`— Owner: ${v.registeredOwner}`);
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}
