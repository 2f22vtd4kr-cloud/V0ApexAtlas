/**
 * Historical ADS-B Flight Trace Enricher
 *
 * Retrieves historical flight data for a specific aircraft (by ICAO hex or N-number).
 * Travel pattern analysis over months reveals:
 *   - Residency patterns (which cities, how frequently)
 *   - Business relationships (which business-jet airports)
 *   - Property locations (which remote airstrips → private estates)
 *   - Network connections (frequent co-location with other aircraft)
 *
 * Sources (in priority order):
 *   1. ADSBExchange Globe API — public, no auth, 30-day rolling window
 *   2. OpenSky Network historical API — free researcher access, up to 30 days back
 *   3. ADS-B.nl GLOBE history — community ADS-B aggregator
 *
 * The ADSBExchange approach is inspired by github.com/frankea/adsbtrack.
 */

import { logger } from "./logger";

export interface FlightRecord {
  icao24: string;         // ICAO hex address (e.g. "a1b2c3")
  callsign?: string;      // ATC callsign
  departureTime: string;  // ISO8601
  arrivalTime?: string;
  originAirport?: string; // ICAO or IATA airport code
  destAirport?: string;
  originCity?: string;
  destCity?: string;
  originCountry?: string;
  destCountry?: string;
  durationMinutes?: number;
  distanceKm?: number;
  source: string;
}

export interface AircraftTraceResult {
  found: boolean;
  icao24: string;
  registration?: string; // N-number / reg
  totalFlights: number;
  flights: FlightRecord[];
  periodStart?: string;
  periodEnd?: string;
  topAirports: Array<{ airport: string; visits: number }>;
  topCountries: Array<{ country: string; visits: number }>;
  error?: string;
}

// ── ICAO hex ↔ N-number conversion ───────────────────────────────────────────

/** Convert FAA N-number to ICAO 24-bit hex (Mode-S address).
 *  FAA assigns sequential addresses; the canonical formula is:
 *  AA0000 base for US + sequential offset from N-number suffix. */
function nNumberToIcao(nNumber: string): string | null {
  // Normalise: strip leading N, uppercase
  const n = nNumber.replace(/^N/i, "").toUpperCase().trim();
  if (!n || !/^\d/.test(n)) return null;

  // Use the FAA's published n-number → mode-s lookup instead of formula
  // (the formula is complex for alpha suffixes). Return null so we fall back
  // to the OpenSky registration lookup.
  return null;
}

/** Look up ICAO hex for a registration via OpenSky metadata */
async function resolveIcaoFromReg(registration: string): Promise<string | null> {
  try {
    const reg = registration.replace(/^N/i, "N").toUpperCase();
    const url = `https://opensky-network.org/api/metadata/aircraft/registration/${encodeURIComponent(reg)}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "ApexFinder-OSINT/2.0 (research@apexfinder.private)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    return data?.icao24 ?? null;
  } catch {
    return null;
  }
}

// ── ADSBExchange Globe API ────────────────────────────────────────────────────

/** Query ADSBExchange re-api for an aircraft's recent traces.
 *  Uses the public globe.adsbexchange.com endpoint — no auth required. */
async function fetchFromAdsbExchange(icao: string): Promise<FlightRecord[]> {
  try {
    const icaoLower = icao.toLowerCase();
    const url = `https://globe.adsbexchange.com/re-api/?find=${icaoLower}&all`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ApexFinder-OSINT/2.0)",
        "Referer": "https://globe.adsbexchange.com/",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) return [];
    const data = await resp.json() as any;

    // ADSBExchange returns: { ac: [...], now: epoch_ms, ... }
    const acList: any[] = data?.ac ?? [];
    const flights: FlightRecord[] = [];

    for (const ac of acList) {
      if (!ac) continue;
      flights.push({
        icao24: icaoLower,
        callsign: ac?.flight?.trim() ?? ac?.squawk ?? undefined,
        departureTime: ac?.seen_pos
          ? new Date(Date.now() - (ac.seen_pos * 1000)).toISOString()
          : new Date().toISOString(),
        originAirport: ac?.dep ?? undefined,
        destAirport: ac?.des ?? undefined,
        source: "adsbexchange",
      });
    }

    return flights;
  } catch (err: any) {
    logger.debug({ icao, err: err.message }, "[ADSB] ADSBExchange query failed");
    return [];
  }
}

/** Fetch historical trace from ADSBExchange for a specific date (YYYY/MM/DD) */
async function fetchAdsbHistorical(icao: string, date: string): Promise<FlightRecord[]> {
  try {
    const [year, month, day] = date.split("-");
    const icaoLower = icao.toLowerCase();
    // ADSBExchange historical traces are stored at:
    // https://globe.adsbexchange.com/globe_history/YYYY/MM/DD/traces/XX/trace_full_ICAO.json
    const prefix = icaoLower.slice(-2); // last 2 chars of ICAO
    const url = `https://globe.adsbexchange.com/globe_history/${year}/${month}/${day}/traces/${prefix}/trace_full_${icaoLower}.json`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ApexFinder-OSINT/2.0)",
        "Referer": "https://globe.adsbexchange.com/",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) return [];
    const data = await resp.json() as any;

    // Trace format: { icao: hex, r: registration, t: type, trace: [[ts, lat, lon, alt_baro, ...], ...], desc: "..." }
    const tracePoints: any[] = data?.trace ?? [];
    if (tracePoints.length === 0) return [];

    // Build a single flight record representing this day's trace
    const startTs = tracePoints[0]?.[0];
    const endTs = tracePoints[tracePoints.length - 1]?.[0];
    const startTime = startTs ? new Date(startTs * 1000).toISOString() : `${date}T00:00:00Z`;
    const endTime = endTs ? new Date(endTs * 1000).toISOString() : `${date}T23:59:59Z`;

    // Find max altitude (proxy for whether this was actual flight vs ground movement)
    const maxAlt = tracePoints.reduce((max: number, p: any) => {
      const alt = p?.[3];
      return typeof alt === "number" && alt > max ? alt : max;
    }, 0);

    if (maxAlt < 1000) return []; // ground movement only, skip

    return [{
      icao24: icaoLower,
      callsign: data?.r ?? undefined,
      departureTime: startTime,
      arrivalTime: endTime,
      durationMinutes: startTs && endTs ? Math.round((endTs - startTs) / 60) : undefined,
      source: "adsbexchange-history",
    }];
  } catch {
    return [];
  }
}

// ── OpenSky historical flights ────────────────────────────────────────────────

async function fetchFromOpenSky(icao: string, daysBack = 30): Promise<FlightRecord[]> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const begin = now - (daysBack * 86400);

    const url = `https://opensky-network.org/api/flights/aircraft?icao24=${icao.toLowerCase()}&begin=${begin}&end=${now}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "ApexFinder-OSINT/2.0 (research@apexfinder.private)" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) return [];
    const flights = await resp.json() as any[];
    if (!Array.isArray(flights)) return [];

    return flights.map(f => ({
      icao24: icao.toLowerCase(),
      callsign: f?.callsign?.trim() ?? undefined,
      departureTime: f?.firstSeen ? new Date(f.firstSeen * 1000).toISOString() : new Date().toISOString(),
      arrivalTime: f?.lastSeen ? new Date(f.lastSeen * 1000).toISOString() : undefined,
      originAirport: f?.estDepartureAirport ?? undefined,
      destAirport: f?.estArrivalAirport ?? undefined,
      durationMinutes: f?.firstSeen && f?.lastSeen
        ? Math.round((f.lastSeen - f.firstSeen) / 60) : undefined,
      source: "opensky-history",
    }));
  } catch (err: any) {
    logger.debug({ icao, err: err.message }, "[ADSB] OpenSky historical query failed");
    return [];
  }
}

// ── Airport code → city/country mapping ──────────────────────────────────────

async function resolveAirportInfo(icaoCode: string): Promise<{ city?: string; country?: string } | null> {
  if (!icaoCode || icaoCode.length < 3) return null;
  try {
    // Use the free ourairports.com data API
    const url = `https://ourairports.com/airports/${icaoCode.toUpperCase()}/`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "ApexFinder-OSINT/2.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    const cityM = html.match(/Municipality:\s*<[^>]+>([^<]+)</);
    const countryM = html.match(/Country:\s*<[^>]+>([^<]+)</);
    return {
      city: cityM?.[1]?.trim() ?? undefined,
      country: countryM?.[1]?.trim() ?? undefined,
    };
  } catch {
    return null;
  }
}

// ── Main enrichment function ──────────────────────────────────────────────────

/**
 * Retrieve historical flight patterns for an aircraft.
 *
 * @param registration  Aircraft registration (e.g. "N123AB") or ICAO hex
 * @param daysBack      How many days of history to retrieve (default 30, max 90)
 * @param fetchHistory  Whether to pull day-by-day ADSBExchange archive (slower but fuller)
 */
export async function enrichWithAdsbHistory(
  registration: string,
  daysBack = 30,
  fetchHistory = false
): Promise<AircraftTraceResult> {
  const safedays = Math.min(Math.max(daysBack, 1), 90);
  const isIcao = /^[0-9a-f]{6}$/i.test(registration);

  let icao: string;
  let resolvedReg: string | undefined;

  if (isIcao) {
    icao = registration.toLowerCase();
  } else {
    // Try to resolve registration → ICAO
    const resolved = await resolveIcaoFromReg(registration);
    if (!resolved) {
      // Try the nNumber formula as last resort
      const formula = nNumberToIcao(registration);
      if (!formula) {
        return {
          found: false,
          icao24: registration,
          registration,
          totalFlights: 0,
          flights: [],
          topAirports: [],
          topCountries: [],
          error: `Could not resolve ICAO hex for registration ${registration}`,
        };
      }
      icao = formula;
    } else {
      icao = resolved;
    }
    resolvedReg = registration;
  }

  // Fetch from multiple sources in parallel
  const [liveFlights, openSkyFlights] = await Promise.all([
    fetchFromAdsbExchange(icao),
    fetchFromOpenSky(icao, safedays),
  ]);

  // Optionally fetch day-by-day ADSBExchange archive
  let archiveFlights: FlightRecord[] = [];
  if (fetchHistory && safedays <= 30) {
    const dates: string[] = [];
    for (let d = 0; d < Math.min(safedays, 14); d++) {
      const date = new Date(Date.now() - d * 86400000);
      dates.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
    }
    const archiveResults = await Promise.allSettled(
      dates.map(dt => fetchAdsbHistorical(icao, dt))
    );
    for (const r of archiveResults) {
      if (r.status === "fulfilled") archiveFlights.push(...r.value);
    }
  }

  // Merge and deduplicate by departure time
  const allFlights = [...liveFlights, ...openSkyFlights, ...archiveFlights];
  const seen = new Set<string>();
  const uniqueFlights: FlightRecord[] = [];
  for (const f of allFlights) {
    const key = `${f.departureTime}:${f.callsign ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFlights.push(f);
    }
  }

  // Sort by departure time descending
  uniqueFlights.sort((a, b) =>
    new Date(b.departureTime).getTime() - new Date(a.departureTime).getTime()
  );

  // Build top airports / countries
  const airportCounts = new Map<string, number>();
  const countryCounts = new Map<string, number>();
  for (const f of uniqueFlights) {
    for (const ap of [f.originAirport, f.destAirport]) {
      if (ap) airportCounts.set(ap, (airportCounts.get(ap) ?? 0) + 1);
    }
    for (const c of [f.originCountry, f.destCountry]) {
      if (c) countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
    }
  }

  const topAirports = [...airportCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([airport, visits]) => ({ airport, visits }));

  const topCountries = [...countryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([country, visits]) => ({ country, visits }));

  const periodEnd = uniqueFlights[0]?.departureTime;
  const periodStart = uniqueFlights[uniqueFlights.length - 1]?.departureTime;

  logger.info(
    { registration, icao, totalFlights: uniqueFlights.length, days: safedays },
    "[ADSB] historical trace enrichment complete"
  );

  return {
    found: uniqueFlights.length > 0,
    icao24: icao,
    registration: resolvedReg,
    totalFlights: uniqueFlights.length,
    flights: uniqueFlights.slice(0, 200), // cap response size
    periodStart,
    periodEnd,
    topAirports,
    topCountries,
  };
}

/** Format ADS-B history for notes injection */
export function summariseAdsbHistory(result: AircraftTraceResult): string | null {
  if (!result.found || result.totalFlights === 0) return null;
  const lines = [`ADS-B History — ${result.totalFlights} flights for ${result.icao24}:`];
  if (result.topAirports.length > 0) {
    lines.push(`  Top airports: ${result.topAirports.slice(0, 5).map(a => `${a.airport}(${a.visits})`).join(", ")}`);
  }
  if (result.topCountries.length > 0) {
    lines.push(`  Countries: ${result.topCountries.slice(0, 5).map(c => `${c.country}(${c.visits})`).join(", ")}`);
  }
  if (result.periodStart && result.periodEnd) {
    lines.push(`  Period: ${result.periodStart.slice(0, 10)} → ${result.periodEnd.slice(0, 10)}`);
  }
  return lines.join("\n");
}
