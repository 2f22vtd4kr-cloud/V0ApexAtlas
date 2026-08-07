/**
 * Extended OSINT Routes — Phase L
 *
 * New enrichment sources integrated in Phase L:
 *
 * POST /api/enrich/icij            — ICIJ Offshore Leaks reconciliation
 * POST /api/enrich/whoxy           — Whoxy reverse WHOIS (email/name → domains)
 * POST /api/enrich/holehe          — Holehe email → platform presence (120+ platforms)
 * POST /api/enrich/maigret         — Maigret username → cross-platform dossier
 * POST /api/enrich/sherlock        — Sherlock supplementary username discovery
 * POST /api/enrich/theharvester    — theHarvester domain → emails/subdomains
 * POST /api/enrich/equasis         — Equasis/VesselFinder vessel/yacht lookup
 * POST /api/enrich/adsb-history    — Historical ADS-B flight traces
 * POST /api/enrich/openownership   — OpenOwnership BODS beneficial ownership
 * GET  /api/enrich/gliner-status   — GLiNER NER service status
 * GET  /api/enrich/python-tools    — Python tool availability
 *
 * All endpoints accept both direct query params and entity IDs.
 * All degrade gracefully when optional services/keys are unavailable.
 */

import { Router, type Request, type Response } from "express";
import { db, entitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { enrichWithIcij, summariseIcijFindings } from "../lib/icij-enricher";
import { enrichWithWhoxy, summariseWhoxyFindings } from "../lib/whoxy-enricher";
import { enrichWithEquasis, summariseVesselFindings } from "../lib/equasis-enricher";
import { enrichWithAdsbHistory, summariseAdsbHistory } from "../lib/adsbtrack-enricher";
import { enrichWithOpenOwnership, summariseOwnershipFindings } from "../lib/openownership-enricher";
import { runHolehe, runMaigret, runSherlock, runTheHarvester, checkPythonToolsAvailability } from "../lib/python-tools";
import { getGlinerStatus } from "../lib/gliner-client";

const router = Router();

// ── Helper: resolve entity from DB ───────────────────────────────────────────

async function resolveEntity(entityId?: number): Promise<{
  id: number; name: string; type: string; metadata: string | null;
  email: string | null; website: string | null; notes: string | null;
  nationality: string | null;
} | null> {
  if (!entityId) return null;
  const rows = await db.select().from(entitiesTable).where(eq(entitiesTable.id, entityId)).limit(1);
  return rows[0] ?? null;
}

// ── POST /api/enrich/icij ─────────────────────────────────────────────────────

router.post("/enrich/icij", async (req: Request, res: Response): Promise<void> => {
  const { entityId, name, aliases = [], fetchDetail = false } = req.body as {
    entityId?: number;
    name?: string;
    aliases?: string[];
    fetchDetail?: boolean;
  };

  const entity = entityId ? await resolveEntity(entityId) : null;
  const queryName = (name ?? entity?.name ?? "").trim();

  if (!queryName) {
    res.status(400).json({ error: "name or entityId is required" });
    return;
  }

  try {
    const result = await enrichWithIcij(queryName, aliases, fetchDetail);
    const summary = summariseIcijFindings(result);

    // Persist summary to entity notes if entity found
    if (entity && summary) {
      const existing = entity.notes ?? "";
      const newNotes = existing
        ? `${existing}\n\n--- ICIJ Offshore Leaks (${new Date().toISOString().slice(0, 10)}) ---\n${summary}`
        : summary;
      await db.update(entitiesTable)
        .set({ notes: newNotes.slice(0, 10_000), updatedAt: new Date() })
        .where(eq(entitiesTable.id, entity.id));
      logger.info({ entityId: entity.id, matches: result.totalMatches }, "[ICIJ] persisted to entity notes");
    }

    res.json({ ...result, summary });
  } catch (err: any) {
    logger.error({ err: err.message }, "[ICIJ] route error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/enrich/whoxy ────────────────────────────────────────────────────

router.post("/enrich/whoxy", async (req: Request, res: Response): Promise<void> => {
  const { entityId, email, name, companyName } = req.body as {
    entityId?: number;
    email?: string;
    name?: string;
    companyName?: string;
  };

  const entity = entityId ? await resolveEntity(entityId) : null;
  const resolvedEmail = email ?? entity?.email ?? undefined;
  const resolvedName = name ?? (entity?.type === "HNWI" ? entity?.name : undefined) ?? undefined;
  const resolvedCompany = companyName ?? (entity?.type !== "HNWI" ? entity?.name : undefined) ?? undefined;

  if (!resolvedEmail && !resolvedName && !resolvedCompany) {
    res.status(400).json({ error: "At least one of: email, name, companyName, or entityId with email/name is required" });
    return;
  }

  try {
    const result = await enrichWithWhoxy({
      email: resolvedEmail,
      name: resolvedName,
      companyName: resolvedCompany,
    });

    const summary = summariseWhoxyFindings(result.allUniqueDomains);

    if (entity && summary) {
      const existing = entity.notes ?? "";
      const newNotes = existing
        ? `${existing}\n\n--- Whoxy Reverse WHOIS (${new Date().toISOString().slice(0, 10)}) ---\n${summary}`
        : summary;
      await db.update(entitiesTable)
        .set({ notes: newNotes.slice(0, 10_000), updatedAt: new Date() })
        .where(eq(entitiesTable.id, entity.id));
    }

    res.json({ ...result, summary });
  } catch (err: any) {
    logger.error({ err: err.message }, "[Whoxy] route error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/enrich/holehe ───────────────────────────────────────────────────

router.post("/enrich/holehe", async (req: Request, res: Response): Promise<void> => {
  const { entityId, email } = req.body as { entityId?: number; email?: string };

  const entity = entityId ? await resolveEntity(entityId) : null;
  const resolvedEmail = email ?? entity?.email ?? undefined;

  if (!resolvedEmail) {
    res.status(400).json({ error: "email is required (or entityId of an entity with an email)" });
    return;
  }

  try {
    const result = await runHolehe(resolvedEmail);

    if (entity && result.found.length > 0) {
      const summary = `Holehe Platform Check (${new Date().toISOString().slice(0, 10)}) — ${result.totalFound} platforms:\n` +
        result.found.slice(0, 20).map(p => `  • ${p.name}${p.url ? ` (${p.url})` : ""}`).join("\n");
      const existing = entity.notes ?? "";
      const newNotes = existing ? `${existing}\n\n${summary}` : summary;
      await db.update(entitiesTable)
        .set({ notes: newNotes.slice(0, 10_000), updatedAt: new Date() })
        .where(eq(entitiesTable.id, entity.id));
    }

    res.json(result);
  } catch (err: any) {
    logger.error({ err: err.message }, "[Holehe] route error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/enrich/maigret ──────────────────────────────────────────────────

router.post("/enrich/maigret", async (req: Request, res: Response): Promise<void> => {
  const { entityId, username } = req.body as { entityId?: number; username?: string };

  if (!username) {
    res.status(400).json({ error: "username is required" });
    return;
  }

  const entity = entityId ? await resolveEntity(entityId) : null;

  try {
    const result = await runMaigret(username);

    if (entity && result.found.length > 0) {
      const summary = `Maigret Dossier (${new Date().toISOString().slice(0, 10)}) — ${result.found.length} profiles:\n` +
        result.found.slice(0, 20).map(p => `  • ${p.siteName}${p.url ? ` → ${p.url}` : ""}`).join("\n");
      const existing = entity.notes ?? "";
      const newNotes = existing ? `${existing}\n\n${summary}` : summary;
      await db.update(entitiesTable)
        .set({ notes: newNotes.slice(0, 10_000), updatedAt: new Date() })
        .where(eq(entitiesTable.id, entity.id));
    }

    res.json(result);
  } catch (err: any) {
    logger.error({ err: err.message }, "[Maigret] route error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/enrich/sherlock ──────────────────────────────────────────────────
// Supplementary username discovery. Results are always review-only.

router.post("/enrich/sherlock", async (req: Request, res: Response): Promise<void> => {
  const { entityId, username } = req.body as { entityId?: number; username?: string };

  if (!username) {
    res.status(400).json({ error: "username is required" });
    return;
  }

  const entity = entityId ? await resolveEntity(entityId) : null;

  try {
    const result = await runSherlock(username);
    if (entity && result.found.length > 0) {
      const summary = `Sherlock Supplementary Dossier (${new Date().toISOString().slice(0, 10)}) — ${result.found.length} review-only profiles:\n` +
        result.found.slice(0, 20).map(p => `  • ${p.siteName} → ${p.url}`).join("\n");
      const existing = entity.notes ?? "";
      const newNotes = existing ? `${existing}\n\n${summary}` : summary;
      await db.update(entitiesTable)
        .set({ notes: newNotes.slice(0, 10_000), updatedAt: new Date() })
        .where(eq(entitiesTable.id, entity.id));
    }

    res.json(result);
  } catch (err: any) {
    logger.error({ err: err.message }, "[Sherlock] route error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/enrich/theharvester ────────────────────────────────────────────

router.post("/enrich/theharvester", async (req: Request, res: Response): Promise<void> => {
  const { entityId, domain, sources } = req.body as {
    entityId?: number;
    domain?: string;
    sources?: string;
  };

  const entity = entityId ? await resolveEntity(entityId) : null;
  // Derive domain from entity website if not provided
  let resolvedDomain = domain;
  if (!resolvedDomain && entity?.website) {
    resolvedDomain = entity.website.replace(/^https?:\/\//i, "").split("/")[0] ?? undefined;
  }
  if (!resolvedDomain) {
    res.status(400).json({ error: "domain is required (or entityId of an entity with a website)" });
    return;
  }

  try {
    const result = await runTheHarvester(resolvedDomain, sources);

    if (entity && (result.emails.length > 0 || result.subdomains.length > 0)) {
      const summary = [
        `theHarvester Scan (${new Date().toISOString().slice(0, 10)}) — domain: ${resolvedDomain}`,
        result.emails.length > 0 ? `  Emails: ${result.emails.slice(0, 10).join(", ")}` : null,
        result.subdomains.length > 0 ? `  Subdomains: ${result.subdomains.slice(0, 10).join(", ")}` : null,
      ].filter(Boolean).join("\n");
      const existing = entity.notes ?? "";
      const newNotes = existing ? `${existing}\n\n${summary}` : summary;
      await db.update(entitiesTable)
        .set({ notes: newNotes.slice(0, 10_000), updatedAt: new Date() })
        .where(eq(entitiesTable.id, entity.id));
    }

    res.json(result);
  } catch (err: any) {
    logger.error({ err: err.message }, "[theHarvester] route error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/enrich/equasis ──────────────────────────────────────────────────

router.post("/enrich/equasis", async (req: Request, res: Response): Promise<void> => {
  const { entityId, vesselName, imoNumber } = req.body as {
    entityId?: number;
    vesselName?: string;
    imoNumber?: string;
  };

  const entity = entityId ? await resolveEntity(entityId) : null;
  const resolvedName = vesselName ?? entity?.name ?? "";

  if (!resolvedName && !imoNumber) {
    res.status(400).json({ error: "vesselName or imoNumber is required" });
    return;
  }

  try {
    const result = await enrichWithEquasis(resolvedName, imoNumber);
    const summary = summariseVesselFindings(result);

    if (entity && summary) {
      const existing = entity.notes ?? "";
      const newNotes = existing
        ? `${existing}\n\n--- Vessel Registry (${new Date().toISOString().slice(0, 10)}) ---\n${summary}`
        : summary;
      await db.update(entitiesTable)
        .set({ notes: newNotes.slice(0, 10_000), updatedAt: new Date() })
        .where(eq(entitiesTable.id, entity.id));
    }

    res.json({ ...result, summary });
  } catch (err: any) {
    logger.error({ err: err.message }, "[Equasis] route error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/enrich/adsb-history ─────────────────────────────────────────────

router.post("/enrich/adsb-history", async (req: Request, res: Response): Promise<void> => {
  const { registration, icao24, daysBack = 30, fetchHistory = false } = req.body as {
    registration?: string;
    icao24?: string;
    daysBack?: number;
    fetchHistory?: boolean;
  };

  const target = registration ?? icao24;
  if (!target) {
    res.status(400).json({ error: "registration (N-number) or icao24 (hex) is required" });
    return;
  }

  try {
    const result = await enrichWithAdsbHistory(target, daysBack, fetchHistory);
    const summary = summariseAdsbHistory(result);
    res.json({ ...result, summary });
  } catch (err: any) {
    logger.error({ err: err.message }, "[ADSB] route error");
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/enrich/openownership ───────────────────────────────────────────

router.post("/enrich/openownership", async (req: Request, res: Response): Promise<void> => {
  const { entityId, name, includeUkPsc = true } = req.body as {
    entityId?: number;
    name?: string;
    includeUkPsc?: boolean;
  };

  const entity = entityId ? await resolveEntity(entityId) : null;
  const queryName = (name ?? entity?.name ?? "").trim();

  if (!queryName) {
    res.status(400).json({ error: "name or entityId is required" });
    return;
  }

  try {
    const result = await enrichWithOpenOwnership(queryName, includeUkPsc);
    const summary = summariseOwnershipFindings(result);

    if (entity && summary) {
      const existing = entity.notes ?? "";
      const newNotes = existing
        ? `${existing}\n\n--- OpenOwnership BODS (${new Date().toISOString().slice(0, 10)}) ---\n${summary}`
        : summary;
      await db.update(entitiesTable)
        .set({ notes: newNotes.slice(0, 10_000), updatedAt: new Date() })
        .where(eq(entitiesTable.id, entity.id));
    }

    res.json({ ...result, summary });
  } catch (err: any) {
    logger.error({ err: err.message }, "[OpenOwnership] route error");
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/enrich/gliner-status ─────────────────────────────────────────────

router.get("/enrich/gliner-status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await getGlinerStatus();
    res.json(status);
  } catch (err: any) {
    res.json({ available: false, port: 7890, error: err.message });
  }
});

// ── GET /api/enrich/python-tools ─────────────────────────────────────────────

router.get("/enrich/python-tools", async (_req: Request, res: Response): Promise<void> => {
  try {
    const availability = await checkPythonToolsAvailability();
    const gliner = await getGlinerStatus();
    res.json({
      tools: availability,
      gliner,
      installCommand: "bash scripts/install-python-tools.sh",
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
