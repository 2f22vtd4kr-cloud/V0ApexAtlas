import { Router, type IRouter } from "express";
import { eq, ilike, and, gte, sql, inArray, or, desc, not } from "drizzle-orm";
import { db, entitiesTable, assetsTable, relationshipsTable, contactEvidenceTable, dedupReviewsTable } from "@workspace/db";
import {
  ListEntitiesQueryParams,
  CreateEntityBody,
  GetEntityParams,
  UpdateEntityParams,
  UpdateEntityBody,
  DeleteEntityParams,
} from "@workspace/api-zod";
import { getCache, setCache, delCachePattern } from "../lib/redis";
import { computeAccessScore } from "../lib/access-score";
import { reachabilityOrderExpr } from "../lib/reachability-rank";
import {
  computeContactConfidence,
  computeContactOutcome,
  hasMeaningfulDirectContact,
} from "../lib/contact-confidence";
import {
  sanitizePublicEmail,
  sanitizePublicPhone,
  sanitizePublicSocialUrl,
  sanitizePublicSocialHandle,
} from "../lib/contact-validation";

const router: IRouter = Router();

const ORGANIZATION_ENTITY_TYPES = new Set(["Corporation", "Corp", "Trust"]);

function normalizePresentedContactOutcome(entity: {
  type?: string | null;
  contactOutcome?: string | null;
  email?: string | null;
  phone?: string | null;
  phoneSource?: string | null;
  metadata?: string | null;
}): string | null {
  if (!ORGANIZATION_ENTITY_TYPES.has(entity.type ?? "")) return entity.contactOutcome ?? null;

  // Organization rows must never present a person-level outcome. Registry
  // phones and stale metadata are evidence about the organization, not a
  // validated personal route.
  if (entity.contactOutcome === "direct_contact_candidate" || entity.contactOutcome === "direct_contact_verified") {
    return "organization_contact";
  }
  return entity.contactOutcome ?? null;
}

const BOOLEAN_QUERY_KEYS = [
  "starred",
  "hidden",
  "contactable",
  "hasEmail",
  "hasPhone",
  "hasWhatsapp",
  "hasTelegram",
  "hasInstagram",
] as const;

function normalizeBooleanQueryValues(query: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...query };
  for (const key of BOOLEAN_QUERY_KEYS) {
    const value = normalized[key];
    if (typeof value === "string" && (value === "true" || value === "false")) {
      normalized[key] = value === "true";
    }
  }
  return normalized;
}

// GET /entities
router.get("/entities", async (req, res): Promise<void> => {
  const parsed = ListEntitiesQueryParams.safeParse(
    normalizeBooleanQueryValues(req.query as Record<string, unknown>),
  );
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { type, minScore, search, limit = 50, offset = 0, starred, hidden,
    contactable, hasEmail, hasPhone, hasWhatsapp, hasTelegram, hasInstagram,
    contactOutcome, minContactConfidence } = parsed.data;

  // Cache key encodes all query params — 30 s TTL (short, data changes frequently)
  const cacheKey = `entities:list:${type ?? ""}:${minScore ?? ""}:${search ?? ""}:${limit}:${offset}:${starred ?? ""}:${hidden ?? ""}:${contactable ?? ""}:${hasEmail ?? ""}:${hasPhone ?? ""}:${hasWhatsapp ?? ""}:${hasTelegram ?? ""}:${hasInstagram ?? ""}:${contactOutcome ?? ""}:${minContactConfidence ?? ""}`;
  const cached = await getCache<unknown[]>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const conditions = [];
  if (type) conditions.push(eq(entitiesTable.type, type));
  if (minScore !== undefined) conditions.push(gte(entitiesTable.bayesianScore, minScore));
  if (search) conditions.push(ilike(entitiesTable.name, `%${search}%`));
  // Visibility: starred view shows starred regardless of hidden; hidden view shows hidden only;
  // default view excludes hidden entities so they don't clutter the ledger.
  if (starred) {
    conditions.push(eq(entitiesTable.isStarred, true));
  } else if (hidden) {
    conditions.push(eq(entitiesTable.isHidden, true));
  } else {
    conditions.push(eq(entitiesTable.isHidden, false));
  }

  // Contact channel filters — server-side so pagination works correctly.
  // Treat blank strings as missing contact evidence; ingestion can leave empty
  // placeholders in nullable text columns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasValue = (column: any) =>
    sql`${column} IS NOT NULL AND btrim(${column}::text) <> ''`;

  // ── Legacy channel filters (kept for backward compat) ──────────────────────
  if (hasEmail) {
    conditions.push(hasValue(entitiesTable.email));
  } else if (hasPhone) {
    conditions.push(hasValue(entitiesTable.phone));
  } else if (hasWhatsapp) {
    conditions.push(ilike(entitiesTable.contactMethod, "%whatsapp%"));
  } else if (hasTelegram) {
    conditions.push(hasValue(entitiesTable.telegramHandle));
  } else if (hasInstagram) {
    conditions.push(hasValue(entitiesTable.instagramHandle));
  } else if (contactable) {
    // Contactable is an operational reachability filter, not a generic
    // "has a public vector" filter. Candidates and organization routes remain
    // reviewable through contactOutcome, but do not appear as reachable.
    conditions.push(eq(entitiesTable.contactOutcome, "direct_contact_verified"));
  }

  // ── Contact richness tier filter ───────────────────────────────────────────
  // "any"      → has any meaningful contact (social, org, direct, verified)
  // "direct"   → direct_contact_verified only (operationally reachable)
  // "candidate" / "direct_contact_candidate" → review-only person candidate
  // "verified" → direct_contact_verified only
  // "org"      → organization_contact only
  // "social"   → social_only
  if (contactOutcome === "any") {
    conditions.push(inArray(entitiesTable.contactOutcome, [
      "social_only", "organization_contact", "direct_contact_candidate", "direct_contact_verified",
    ]));
  } else if (contactOutcome === "direct") {
    conditions.push(eq(entitiesTable.contactOutcome, "direct_contact_verified"));
  } else if (contactOutcome === "candidate" || contactOutcome === "direct_contact_candidate") {
    conditions.push(eq(entitiesTable.contactOutcome, "direct_contact_candidate"));
    // Legacy rows can carry a candidate outcome despite being organization
    // records. Keep this review surface limited to person-level candidates;
    // organizations are classified and presented through organization_contact.
    conditions.push(not(inArray(entitiesTable.type, ["Corporation", "Corp", "Trust"])));
  } else if (contactOutcome === "verified") {
    conditions.push(eq(entitiesTable.contactOutcome, "direct_contact_verified"));
  } else if (contactOutcome === "org") {
    conditions.push(eq(entitiesTable.contactOutcome, "organization_contact"));
  } else if (contactOutcome === "social") {
    conditions.push(eq(entitiesTable.contactOutcome, "social_only"));
  }

  // ── Minimum confidence threshold ───────────────────────────────────────────
  if (minContactConfidence !== undefined && minContactConfidence > 0) {
    conditions.push(gte(entitiesTable.contactConfidence, minContactConfidence));
  }

  // Always rank by contact richness first (outcome tier, then confidence score),
  // then bayesian score. Entities with more/better contacts always float to the top
  // regardless of whether a contact filter is active — wealth is a secondary signal.
  const _isContactFilter = !!(contactable || hasEmail || hasPhone || hasWhatsapp || hasTelegram
    || hasInstagram || contactOutcome || (minContactConfidence && minContactConfidence > 0));
  // Reachability-first sort — shared with the dashboard hot-leads panel and the
  // Atlas Phase 10 MCTS target selection so ranking never drifts between surfaces.
  const orderExpr = reachabilityOrderExpr();

  const rows = await db
    .select()
    .from(entitiesTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(orderExpr)
    .limit(limit)
    .offset(offset);

  // Attach asset counts
  const ids = rows.map((r) => r.id);
  const assetCounts: Record<number, number> = {};
  if (ids.length > 0) {
    const counts = await db
      .select({
        ownerId: assetsTable.ownerEntityId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(assetsTable)
      .where(sql`${assetsTable.ownerEntityId} = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})`)
      .groupBy(assetsTable.ownerEntityId);
    for (const c of counts) {
      if (c.ownerId) assetCounts[c.ownerId] = c.cnt;
    }
  }

  const entities = rows.map((e) => ({
    ...e,
    bayesianScore: e.bayesianScore,
    contactOutcome: normalizePresentedContactOutcome(e),
    accessScore: computeAccessScore(e),
    estimatedNetWorth: e.estimatedNetWorth,
    createdAt: e.createdAt.toISOString(),
    assetCount: assetCounts[e.id] ?? 0,
  }));

  await setCache(cacheKey, entities, 30);
  res.json(entities);
});

// PATCH /entities/:id/star  — toggle starred flag
router.patch("/entities/:id/star", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const isStarred = req.body?.isStarred;
  if (typeof isStarred !== "boolean") { res.status(400).json({ error: "isStarred must be boolean" }); return; }
  const [updated] = await db
    .update(entitiesTable)
    .set({ isStarred })
    .where(eq(entitiesTable.id, id))
    .returning({ id: entitiesTable.id, isStarred: entitiesTable.isStarred });
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  await delCachePattern("entities:list:*");
  res.json(updated);
});

// PATCH /entities/:id/hide  — toggle hidden flag
router.patch("/entities/:id/hide", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const isHidden = req.body?.isHidden;
  if (typeof isHidden !== "boolean") { res.status(400).json({ error: "isHidden must be boolean" }); return; }
  const [updated] = await db
    .update(entitiesTable)
    .set({ isHidden })
    .where(eq(entitiesTable.id, id))
    .returning({ id: entitiesTable.id, isHidden: entitiesTable.isHidden });
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  await delCachePattern("entities:list:*");
  await delCachePattern("dashboard:stats");
  res.json(updated);
});

// PATCH /entities/:id/reject-contact — mark a contact field as bad and null it out
router.patch("/entities/:id/reject-contact", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { field } = req.body ?? {};
  const validFields = ["email", "phone", "linkedinUrl", "twitterHandle", "instagramHandle",
    "telegramHandle", "personalWebsite", "foundationName", "contactMethod"];
  if (!field || !validFields.includes(field)) {
    res.status(400).json({ error: "Invalid or missing field" }); return;
  }

  const [entity] = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, id));
  if (!entity) { res.status(404).json({ error: "Not found" }); return; }

  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(entity.metadata ?? "{}") as Record<string, unknown>; } catch { /* */ }
  const rejected: string[] = (meta.rejectedContacts as string[] | undefined) ?? [];
  if (!rejected.includes(field)) rejected.push(field);
  meta.rejectedContacts = rejected;

  // Null the specific contact field + save updated metadata
  const updates: Record<string, null | string | number | boolean> = { metadata: JSON.stringify(meta) };
  // Map field name to a null update (Drizzle accepts partial column objects)
  const fieldNulls: Record<string, any> = {
    email: { email: null },
    phone: { phone: null },
    linkedinUrl: { linkedinUrl: null },
    twitterHandle: { twitterHandle: null },
    instagramHandle: { instagramHandle: null },
    telegramHandle: { telegramHandle: null },
    personalWebsite: { personalWebsite: null },
    foundationName: { foundationName: null },
    contactMethod: { contactMethod: null },
  };
  const setObj = { ...updates, ...(fieldNulls[field] ?? {}) };
  const nextEntity = { ...entity, [field]: null };
  const nextConfidence = computeContactConfidence(nextEntity);
  const nextOutcome = computeContactOutcome(nextEntity);
  const nextIsHot = hasMeaningfulDirectContact(nextEntity);
  setObj.contactConfidence = nextConfidence;
  setObj.contactOutcome = nextOutcome;
  setObj.isHot = nextIsHot;
  await db.update(entitiesTable).set(setObj as any).where(eq(entitiesTable.id, id));
  await Promise.all([
    delCachePattern("entities:list:*"),
    delCachePattern("dashboard:*"),
  ]);
  res.json({ ok: true, rejectedField: field, contactConfidence: nextConfidence, contactOutcome: nextOutcome, isHot: nextIsHot });
});

// GET /entities/:id/occrp  — return Aleph adverse-media metadata for one entity
router.get("/entities/:id/occrp", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [entity] = await db
    .select({ name: entitiesTable.name, metadata: entitiesTable.metadata })
    .from(entitiesTable)
    .where(eq(entitiesTable.id, id));
  if (!entity) { res.status(404).json({ error: "Not found" }); return; }
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(entity.metadata ?? "{}") as Record<string, unknown>; } catch { /* */ }
  res.json({ entityName: entity.name, aleph: (meta.aleph ?? null) as unknown });
});

// GET /entities/:id/opensky  — return live-flight enrichment from aviation assets
router.get("/entities/:id/opensky", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const assets = await db
    .select()
    .from(assetsTable)
    .where(and(eq(assetsTable.ownerEntityId, id), eq(assetsTable.category, "Aviation")));
  const flights = assets
    .map((a) => {
      let meta: Record<string, unknown> = {};
      try { meta = JSON.parse(a.metadata ?? "{}") as Record<string, unknown>; } catch { /* */ }
      const osky = meta.opensky as Record<string, unknown> | undefined;
      if (!osky) return null;
      return {
        id: a.id,
        identifier: a.identifier,
        lastActivityDate: a.lastActivityDate,
        opensky: osky,
      };
    })
    .filter(Boolean);
  res.json({ flights });
});

// POST /entities
router.post("/entities", async (req, res): Promise<void> => {
  const parsed = CreateEntityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [entity] = await db.insert(entitiesTable).values(parsed.data).returning();
  // Invalidate all entity list caches and dashboard stats
  await Promise.all([
    delCachePattern("entities:list:*"),
    delCachePattern("dashboard:*"),
  ]);
  res.status(201).json({
    ...entity!,
    accessScore: computeAccessScore(entity!),
    createdAt: entity!.createdAt.toISOString(),
    assetCount: 0,
  });
});

// ── GET /entities/dedup-reviews — N4: load persisted dedup decisions ─────────
// MUST be before GET /entities/:id to avoid "dedup-reviews" matching as an ID.
router.get("/entities/dedup-reviews", async (_req, res): Promise<void> => {
  try {
    const reviews = await db
      .select()
      .from(dedupReviewsTable)
      .orderBy(desc(dedupReviewsTable.reviewedAt))
      .limit(2000);
    res.json({ reviews });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /entities/dedup-reviews — N4: record a dedup decision ───────────────
router.post("/entities/dedup-reviews", async (req, res): Promise<void> => {
  const { entityAId, entityBId, decision, keepEntityId } = req.body as {
    entityAId: number; entityBId: number; decision: string; keepEntityId?: number;
  };
  if (!entityAId || !entityBId || !decision) {
    res.status(400).json({ error: "entityAId, entityBId, and decision are required" });
    return;
  }
  // Store as (lower, higher) pair so ordering is canonical
  const [a, b] = [Math.min(entityAId, entityBId), Math.max(entityAId, entityBId)];
  try {
    await db.insert(dedupReviewsTable).values({
      entityAId: a, entityBId: b, decision, keepEntityId: keepEntityId ?? null,
    }).onConflictDoUpdate({
      target: [dedupReviewsTable.entityAId, dedupReviewsTable.entityBId],
      set: { decision, keepEntityId: keepEntityId ?? null, reviewedAt: new Date() },
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /entities/duplicate-candidates ───────────────────────────────────────
// Returns pairs of entities that share ≥2 significant name tokens, ranked by
// shared-token count. Used by the Duplicates review page to surface merge candidates.
// MUST be registered before GET /entities/:id to avoid "duplicate-candidates" being
// parsed as an entity ID.
router.get("/entities/duplicate-candidates", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select({ id: entitiesTable.id, name: entitiesTable.name, type: entitiesTable.type, bayesianScore: entitiesTable.bayesianScore })
      .from(entitiesTable);

    const STOP = new Set(["LLC", "INC", "LTD", "CO", "THE", "AND", "OF", "UK", "US", "LP", "LLP", "PLC", "CORP", "ET", "AL", "DE", "LA", "LE", "SA", "SRL", "BV", "NV", "AG", "GMBH", "LTD", "PTY", "ASA"]);
    const tokenize = (name: string): string[] =>
      name.toUpperCase().split(/\W+/).filter(t => t.length >= 3 && !STOP.has(t));

    const tokenIndex = new Map<string, number[]>();
    for (const row of rows) {
      // Count each entity once per token. Repeated words in a single name
      // must not create a self-pair such as entity 26419 × entity 26419.
      for (const token of new Set(tokenize(row.name))) {
        const arr = tokenIndex.get(token) ?? [];
        arr.push(row.id);
        tokenIndex.set(token, arr);
      }
    }

    const pairScores = new Map<string, number>();
    for (const [, ids] of tokenIndex.entries()) {
      if (ids.length < 2 || ids.length > 30) continue;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          if (ids[i] === ids[j]) continue;
          const key = `${Math.min(ids[i]!, ids[j]!)}_${Math.max(ids[i]!, ids[j]!)}`;
          pairScores.set(key, (pairScores.get(key) ?? 0) + 1);
        }
      }
    }

    const rowById = new Map(rows.map(r => [r.id, r]));
    const candidates = [...pairScores.entries()]
      .filter(([, score]) => score >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200)
      .map(([key, sharedTokens]) => {
        const [aId, bId] = key.split("_").map(Number);
        const a = rowById.get(aId!);
        const b = rowById.get(bId!);
        if (!a || !b) return null;
        return {
          entityA: { id: a.id, name: a.name, type: a.type, bayesianScore: a.bayesianScore },
          entityB: { id: b.id, name: b.name, type: b.type, bayesianScore: b.bayesianScore },
          sharedTokens,
        };
      })
      .filter(Boolean);

    res.json({ candidates, total: candidates.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Duplicate detection failed" });
  }
});

// ── GET /entities/same-source-name-clusters ───────────────────────────────────
// Returns exact-name clusters that occur more than once within the same source
// registry. These are usually multiple records for one name (for example,
// multiple FAA registrations), not cross-registry identity matches. Keep this
// review-only: operators decide whether any records should be merged.
router.get("/entities/same-source-name-clusters", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: entitiesTable.id,
        name: entitiesTable.name,
        type: entitiesTable.type,
        bayesianScore: entitiesTable.bayesianScore,
        sourceRegistries: entitiesTable.sourceRegistries,
      })
      .from(entitiesTable);

    const registryPrefix = (source: string): string => {
      const value = source.toLowerCase();
      if (value.includes("faa") || value.includes("aircraft") || value.includes("n-number")) return "FAA";
      if (value.includes("edgar") || value.includes("sec ")) return "EDGAR";
      if (value.includes("hmlr") || value.includes("land registry") || value.includes("price paid")) return "HMLR";
      if (value.includes("brreg") || value.includes("norway")) return "BRREG";
      if (value.includes("companies house") || value.includes("ch ")) return "Companies House";
      if (value.includes("gleif") || value.includes("lei")) return "GLEIF";
      if (value.includes("occrp") || value.includes("aleph")) return "OCCRP";
      return source.trim().split(/[\s\-—:]/)[0]?.slice(0, 20) || "Unknown";
    };

    const clusters = new Map<string, {
      name: string;
      registry: string;
      entities: Array<{ id: number; name: string; type: string; bayesianScore: number }>;
    }>();

    for (const row of rows) {
      const normalizedName = row.name.trim().toLowerCase().replace(/\s+/g, " ");
      if (!normalizedName || normalizedName.length < 4 || /^\d+\s/.test(normalizedName)) continue;

      let sources: string[] = [];
      try {
        const parsed = JSON.parse(row.sourceRegistries ?? "[]");
        sources = Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        sources = [];
      }
      const registries = new Set((sources.length > 0 ? sources : ["Unknown"]).map(registryPrefix));
      for (const registry of registries) {
        const key = `${registry}:${normalizedName}`;
        const cluster = clusters.get(key) ?? {
          name: row.name.trim(),
          registry,
          entities: [],
        };
        if (!cluster.entities.some(entity => entity.id === row.id)) {
          cluster.entities.push({
            id: row.id,
            name: row.name,
            type: row.type,
            bayesianScore: row.bayesianScore,
          });
        }
        clusters.set(key, cluster);
      }
    }

    const result = [...clusters.values()]
      .filter((cluster) => cluster.entities.length > 1)
      .sort((a, b) => {
        const countDelta = b.entities.length - a.entities.length;
        return countDelta || a.name.localeCompare(b.name);
      })
      .slice(0, 200)
      .map((cluster) => ({
        name: cluster.name,
        registry: cluster.registry,
        count: cluster.entities.length,
        entities: cluster.entities.sort((a, b) => b.bayesianScore - a.bayesianScore),
      }));

    res.json({ clusters: result, total: result.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Same-source cluster detection failed" });
  }
});

// ── GET /entities/:id/contact-evidence — L3: contact audit panel ─────────────
router.get("/entities/:id/contact-evidence", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "", 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid entity ID" }); return; }
  try {
    const evidence = await db
      .select()
      .from(contactEvidenceTable)
      .where(eq(contactEvidenceTable.entityId, id))
      .orderBy(desc(contactEvidenceTable.observedAt))
      .limit(50);
    res.json({ evidence });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /entities/:id
router.get("/entities/:id", async (req, res): Promise<void> => {
  const params = GetEntityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [entity] = await db
    .select()
    .from(entitiesTable)
    .where(eq(entitiesTable.id, params.data.id));

  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const [cnt] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(assetsTable)
    .where(eq(assetsTable.ownerEntityId, entity.id));

  res.json({
    ...entity,
    contactOutcome: normalizePresentedContactOutcome(entity),
    accessScore: computeAccessScore(entity),
    createdAt: entity.createdAt.toISOString(),
    assetCount: cnt?.cnt ?? 0,
  });
});

// PATCH /entities/:id
router.patch("/entities/:id", async (req, res): Promise<void> => {
  const params = UpdateEntityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateEntityBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [entity] = await db
    .update(entitiesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(entitiesTable.id, params.data.id))
    .returning();

  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  const [cnt] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(assetsTable)
    .where(eq(assetsTable.ownerEntityId, entity.id));

  await Promise.all([
    delCachePattern("entities:list:*"),
    delCachePattern("dashboard:*"),
  ]);
  res.json({
    ...entity,
    accessScore: computeAccessScore(entity),
    createdAt: entity.createdAt.toISOString(),
    assetCount: cnt?.cnt ?? 0,
  });
});

// ── POST /entities/:id/merge/:targetId ────────────────────────────────────────
// Merges targetId into id: assets + relationships reassigned, metadata merged,
// target entity deleted. Primary entity is kept; target is destroyed.
router.post("/entities/:id/merge/:targetId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const targetId = parseInt(req.params.targetId, 10);
  if (isNaN(id) || isNaN(targetId) || id === targetId) {
    res.status(400).json({ error: "Invalid entity IDs" });
    return;
  }

  const [[primary], [target]] = await Promise.all([
    db.select().from(entitiesTable).where(eq(entitiesTable.id, id)),
    db.select().from(entitiesTable).where(eq(entitiesTable.id, targetId)),
  ]);
  if (!primary) { res.status(404).json({ error: "Primary entity not found" }); return; }
  if (!target) { res.status(404).json({ error: "Target entity not found" }); return; }

  // Merge source registries (deduplicated union)
  const pSrc: string[] = (() => { try { return JSON.parse(primary.sourceRegistries ?? "[]"); } catch { return []; } })();
  const tSrc: string[] = (() => { try { return JSON.parse(target.sourceRegistries ?? "[]"); } catch { return []; } })();
  const mergedSources = [...new Set([...pSrc, ...tSrc])];

  // Merge metadata (primary wins on conflicts, record merge provenance)
  const pMeta: Record<string, unknown> = (() => { try { return JSON.parse(primary.metadata ?? "{}"); } catch { return {}; } })();
  const tMeta: Record<string, unknown> = (() => { try { return JSON.parse(target.metadata ?? "{}"); } catch { return {}; } })();
  const mergedMeta = { ...tMeta, ...pMeta, mergedFrom: targetId, mergedAt: new Date().toISOString() };

  // Merge text fields: take primary if non-null, fall back to target
  const mergedResidences = primary.knownResidences ?? target.knownResidences;
  const mergedNotes = [primary.notes, target.notes].filter(Boolean).join("\n\n---\n\n") || null;
  const mergedEmail = sanitizePublicEmail(primary.email) ?? sanitizePublicEmail(target.email);
  const mergedPhone = sanitizePublicPhone(primary.phone) ?? sanitizePublicPhone(target.phone);
  const mergedLinkedIn =
    sanitizePublicSocialUrl(primary.linkedinUrl, "linkedin", "person") ??
    sanitizePublicSocialUrl(target.linkedinUrl, "linkedin", "person");
  const mergedTwitter =
    sanitizePublicSocialHandle(primary.twitterHandle, "twitter") ??
    sanitizePublicSocialHandle(target.twitterHandle, "twitter");
  const mergedInstagram =
    sanitizePublicSocialHandle(primary.instagramHandle, "instagram") ??
    sanitizePublicSocialHandle(target.instagramHandle, "instagram");
  const mergedTelegram = primary.telegramHandle ?? target.telegramHandle;
  const mergedContactConfidence = computeContactConfidence({
    type: primary.type,
    email: mergedEmail,
    phone: mergedPhone,
    linkedinUrl: mergedLinkedIn,
    twitterHandle: mergedTwitter,
    instagramHandle: mergedInstagram,
    telegramHandle: mergedTelegram,
    knownResidences: mergedResidences,
  });
  const mergedContactOutcome = computeContactOutcome({
    email: mergedEmail,
    phone: mergedPhone,
    linkedinUrl: mergedLinkedIn,
    twitterHandle: mergedTwitter,
    instagramHandle: mergedInstagram,
    telegramHandle: mergedTelegram,
  });
  const mergedIsHot = hasMeaningfulDirectContact({
    type: primary.type,
    email: mergedEmail,
    phone: mergedPhone,
    phoneSource: primary.phoneSource ?? target.phoneSource,
  });

  await Promise.all([
    // Reassign assets owned by target → primary
    db.update(assetsTable).set({ ownerEntityId: id }).where(eq(assetsTable.ownerEntityId, targetId)),
    // Reassign relationships where target is the source entity
    db.update(relationshipsTable).set({ sourceEntityId: id }).where(eq(relationshipsTable.sourceEntityId, targetId)),
    // Reassign relationships where target is referenced as the target (Entity targetType)
    db.update(relationshipsTable)
      .set({ targetId: id })
      .where(and(eq(relationshipsTable.targetId, targetId), eq(relationshipsTable.targetType, "Entity"))),
    // Update primary entity with merged data
    db.update(entitiesTable).set({
      sourceRegistries: JSON.stringify(mergedSources),
      metadata: JSON.stringify(mergedMeta),
      knownResidences: mergedResidences ?? null,
      notes: mergedNotes ?? primary.notes,
      estimatedNetWorth: primary.estimatedNetWorth ?? target.estimatedNetWorth,
       email: mergedEmail,
       phone: mergedPhone,
       linkedinUrl: mergedLinkedIn,
       twitterHandle: mergedTwitter,
       instagramHandle: mergedInstagram,
       telegramHandle: mergedTelegram,
       contactConfidence: mergedContactConfidence,
       contactOutcome: mergedContactOutcome,
      bayesianScore: Math.max(primary.bayesianScore ?? 0, target.bayesianScore ?? 0),
       isHot: mergedIsHot,
      updatedAt: new Date(),
    }).where(eq(entitiesTable.id, id)),
  ]);

  // Delete target entity (cascade deletes its remaining relationships/assets via FK)
  await db.delete(entitiesTable).where(eq(entitiesTable.id, targetId));

  await Promise.all([
    delCachePattern("entities:list:*"),
    delCachePattern("dashboard:*"),
  ]);

  res.json({ merged: true, primaryId: id, deletedId: targetId, message: `Entity ${targetId} merged into ${id}` });
});

// DELETE /entities/:id
router.delete("/entities/:id", async (req, res): Promise<void> => {
  const params = DeleteEntityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(entitiesTable)
    .where(eq(entitiesTable.id, params.data.id))
    .returning({ id: entitiesTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  await Promise.all([
    delCachePattern("entities:list:*"),
    delCachePattern("dashboard:*"),
  ]);
  res.sendStatus(204);
});

export default router;
