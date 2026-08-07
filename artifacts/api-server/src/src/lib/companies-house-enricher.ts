/**
 * Companies House Contact Enricher
 *
 * For each entity (optionally filtered by entityIds):
 *   1. If COMPANIES_HOUSE_API_KEY is set: searches CH /search/officers by name,
 *      picks the best-matching officer, extracts correspondence address →
 *      writes to knownResidences; extracts nationality if missing.
 *   2. Always: recomputes contactConfidence from email/phone/linkedin/address
 *      and persists it.
 *
 * No synthetic data — all addresses come directly from official CH officer filings.
 * Rate limit: CH allows ~600 req/5min (2/s). We sleep 550ms between calls.
 */

import { db, entitiesTable } from "@workspace/db";
import { eq, isNull, or, sql } from "drizzle-orm";
import { updateJob, appendJobLog } from "./job-queue";
import { computeContactConfidence } from "./contact-confidence";
import { logger } from "./logger";

// ── Companies House API ───────────────────────────────────────────────────────

const CH_BASE = "https://api.companieshouse.gov.uk";

function chAuthHeader(): string | null {
  const key = process.env.COMPANIES_HOUSE_API_KEY?.trim();
  if (!key) return null;
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

interface ChAddress {
  premises?: string;
  address_line_1?: string;
  address_line_2?: string;
  locality?: string;
  region?: string;
  postal_code?: string;
  country?: string;
}

interface ChOfficer {
  name?: string;
  address?: ChAddress;
  nationality?: string;
  country_of_residence?: string;
}

function formatAddress(addr: ChAddress | undefined): string | null {
  if (!addr) return null;
  const parts = [
    addr.premises,
    addr.address_line_1,
    addr.address_line_2,
    addr.locality,
    addr.region,
    addr.postal_code,
    addr.country,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Word-overlap name similarity 0–1 */
function nameSim(a: string, b: string): number {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  const wa = new Set(norm(a));
  const wb = norm(b);
  const overlap = wb.filter((w) => wa.has(w)).length;
  return overlap / Math.max(wa.size, wb.length, 1);
}

async function fetchChOfficer(
  name: string,
  auth: string,
): Promise<ChOfficer | null> {
  const url = `${CH_BASE}/search/officers?q=${encodeURIComponent(name)}&items_per_page=5`;
  try {
    const resp = await fetch(url, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.status === 401 || resp.status === 403) throw new Error("CH_KEY_INVALID");
    if (!resp.ok) return null;
    const data = (await resp.json()) as { items?: ChOfficer[] };
    const items = data.items ?? [];
    if (items.length === 0) return null;
    let best: ChOfficer | null = null;
    let bestScore = 0;
    for (const item of items) {
      const sim = nameSim(name, item.name ?? "");
      if (sim > bestScore) { bestScore = sim; best = item; }
    }
    return bestScore >= 0.4 ? best : null;
  } catch (err: any) {
    if (err.message === "CH_KEY_INVALID") throw err;
    return null; // network / timeout — skip silently
  }
}

// ── Company officers lookup ───────────────────────────────────────────────────

interface ChCompanyOfficer {
  name: string;
  officer_role: string;
}

/** Search CH companies register, then fetch officer list for best match. */
async function fetchChCompanyOfficers(
  companyName: string,
  auth: string,
): Promise<ChCompanyOfficer[]> {
  try {
    // Step 1: search companies
    const searchUrl = `${CH_BASE}/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=5`;
    const searchResp = await fetch(searchUrl, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!searchResp.ok) return [];
    const searchData = (await searchResp.json()) as {
      items?: Array<{ company_number?: string; title?: string }>;
    };
    const items = searchData.items ?? [];
    if (items.length === 0) return [];

    let bestNum: string | null = null;
    let bestScore = 0;
    for (const item of items) {
      const sim = nameSim(companyName, item.title ?? "");
      if (sim > bestScore) { bestScore = sim; bestNum = item.company_number ?? null; }
    }
    if (!bestNum || bestScore < 0.4) return [];

    // Step 2: fetch officers
    const officersUrl = `${CH_BASE}/company/${bestNum}/officers?items_per_page=20`;
    const officersResp = await fetch(officersUrl, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!officersResp.ok) return [];
    const officersData = (await officersResp.json()) as { items?: ChCompanyOfficer[] };
    return (officersData.items ?? []).filter((o) => o.name && o.officer_role);
  } catch {
    return [];
  }
}

/** Background job: for Corporation entities, fetch CH officers and store in metadata. */
export async function runCompanyOfficersEnrichment(opts: {
  jobId: string;
  batchSize?: number;
}): Promise<{ enriched: number; skipped: number; errors: number }> {
  const { jobId, batchSize = 100 } = opts;
  const auth = chAuthHeader();
  if (!auth) {
    await appendJobLog(jobId, "⚠ COMPANIES_HOUSE_API_KEY not set — skipping company officers enrichment.");
    return { enriched: 0, skipped: 0, errors: 0 };
  }

  const entities = await db
    .select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata })
    .from(entitiesTable)
    .where(sql`${entitiesTable.type} = 'Corporation' AND (${entitiesTable.metadata} IS NULL OR ${entitiesTable.metadata} NOT LIKE '%chOfficers%')`)
    .limit(Math.min(batchSize, 500));

  await updateJob(jobId, { total: entities.length, message: `Fetching CH officers for ${entities.length} corporations…` });

  let enriched = 0; let skipped = 0; let errors = 0;

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]!;
    try {
      const officers = await fetchChCompanyOfficers(entity.name, auth);
      if (officers.length === 0) { skipped++; }
      else {
        const existingMeta: Record<string, unknown> = (() => { try { return JSON.parse(entity.metadata ?? "{}"); } catch { return {}; } })();
        existingMeta.chOfficers = officers.map((o) => ({ name: o.name, role: o.officer_role }));
        await db.update(entitiesTable)
          .set({ metadata: JSON.stringify(existingMeta) })
          .where(eq(entitiesTable.id, entity.id));
        enriched++;
        await appendJobLog(jobId, `✓ ${entity.name} — ${officers.length} officer(s): ${officers.slice(0, 3).map((o) => o.name).join(", ")}`);
      }
      // Rate limit: 600ms between each set of 2 CH API calls
      await new Promise((r) => setTimeout(r, 600));
    } catch { errors++; }
    await updateJob(jobId, { progress: Math.round(((i + 1) / entities.length) * 100), inserted: enriched, skipped, errors });
  }
  return { enriched, skipped, errors };
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface EnrichmentResult {
  enriched: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

export async function runCompaniesHouseEnrichment(opts: {
  jobId: string;
  entityIds?: number[];
  batchSize?: number;
}): Promise<EnrichmentResult> {
  const start = Date.now();
  const { jobId, batchSize = 50 } = opts;

  const auth = chAuthHeader();
  const hasKey = auth !== null;

  if (!hasKey) {
    await appendJobLog(
      jobId,
      "⚠ COMPANIES_HOUSE_API_KEY not set — recomputing contactConfidence only (no CH lookups).",
    );
  }

  // ── Fetch target entities ─────────────────────────────────────────────────
  let entities: Array<typeof entitiesTable.$inferSelect>;

  if (opts.entityIds && opts.entityIds.length > 0) {
    entities = await db
      .select()
      .from(entitiesTable)
      .where(
        sql`${entitiesTable.id} = ANY(${sql.raw(
          `ARRAY[${opts.entityIds.join(",")}]::int[]`,
        )})`,
      );
  } else {
    // Prioritise un-enriched entities (no email AND no phone)
    entities = await db
      .select()
      .from(entitiesTable)
      .where(or(isNull(entitiesTable.email), isNull(entitiesTable.phone)))
      .limit(Math.min(batchSize, 500));
  }

  await updateJob(jobId, {
    total: entities.length,
    message: `Enriching ${entities.length} entities…`,
  });

  let enriched = 0;
  let skipped = 0;
  let errors = 0;
  let keyInvalid = false;

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]!;
    try {
      const updates: Partial<typeof entitiesTable.$inferInsert> = {};

      // ── CH address lookup ───────────────────────────────────────────────
      if (hasKey && auth && !keyInvalid) {
        const officer = await fetchChOfficer(entity.name, auth).catch((err) => {
          if (err.message === "CH_KEY_INVALID") { keyInvalid = true; }
          return null;
        });

        if (keyInvalid) {
          await appendJobLog(jobId, "✗ CH API key rejected — skipping remaining CH calls");
        } else if (officer) {
          const address = formatAddress(officer.address);
          if (address) {
            let residences: string[] = [];
            try { residences = JSON.parse(entity.knownResidences ?? "[]"); } catch {}
            if (!residences.includes(address)) {
              residences = [address, ...residences].slice(0, 5);
              updates.knownResidences = JSON.stringify(residences);
            }
          }
          if (!entity.nationality && (officer.nationality || officer.country_of_residence)) {
            updates.nationality = officer.nationality ?? officer.country_of_residence;
          }
          await appendJobLog(
            jobId,
            `✓ ${entity.name} — matched${officer.address ? " (address extracted)" : ""}`,
          );
        } else {
          await appendJobLog(jobId, `— ${entity.name} — no CH match`);
          skipped++;
        }

        // Rate limit: 550ms = ~1.8 req/s (safely under CH's 2/s limit)
        await new Promise((r) => setTimeout(r, 550));
      }

      // ── Always recompute contactConfidence ──────────────────────────────
      updates.contactConfidence = computeContactConfidence({ ...entity, ...updates });

      await db
        .update(entitiesTable)
        .set(updates)
        .where(eq(entitiesTable.id, entity.id));

      enriched++;
    } catch (err: any) {
      logger.error({ err: err.message, entityId: entity.id }, "Enrichment error");
      // Best-effort: at least recompute confidence
      try {
        await db
          .update(entitiesTable)
          .set({ contactConfidence: computeContactConfidence(entity) })
          .where(eq(entitiesTable.id, entity.id));
      } catch { /* ignore */ }
      errors++;
    }

    const progress = Math.round(((i + 1) / entities.length) * 100);
    await updateJob(jobId, { progress, inserted: enriched, skipped, errors });
  }

  return { enriched, skipped, errors, durationMs: Date.now() - start };
}
