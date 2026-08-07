import { Router, type IRouter } from "express";
import { desc, isNotNull, eq, sql, and, or, gte } from "drizzle-orm";
import { db, entitiesTable, assetsTable, relationshipsTable, researchSessionsTable } from "@workspace/db";
import { GetHotLeadsQueryParams } from "@workspace/api-zod";
import { getCache, setCache } from "../lib/redis";
import { computeAccessScore } from "../lib/access-score";
import { reachabilityOrderExpr } from "../lib/reachability-rank";

const router: IRouter = Router();

// GET /dashboard/hot-leads
router.get("/dashboard/hot-leads", async (req, res): Promise<void> => {
  const parsed = GetHotLeadsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { limit = 10 } = parsed.data;

  // Over-fetch ranked by contact richness first — outcome tier → confidence score → wealth.
  // Contacts are the primary priority signal; wealth is secondary context. Shared with
  // the entities list and Atlas Phase 10 MCTS target selection — keep ranking consistent.
  const entities = await db
    .select()
    .from(entitiesTable)
    .where(and(eq(entitiesTable.type, "HNWI"), eq(entitiesTable.isHidden, false)))
    .orderBy(reachabilityOrderExpr())
    .limit(Math.max(limit * 10, 100)); // enough candidates for final ranking

  // Get asset counts
  const assetCountMap: Record<number, number> = {};
  if (entities.length > 0) {
    const ids = entities.map((e) => e.id);
    const counts = await db
      .select({
        ownerId: assetsTable.ownerEntityId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(assetsTable)
      .where(sql`${assetsTable.ownerEntityId} = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})`)
      .groupBy(assetsTable.ownerEntityId);
    for (const c of counts) {
      if (c.ownerId) assetCountMap[c.ownerId] = c.cnt;
    }
  }

  // Get most recent asset activity per entity
  const activityMap: Record<number, string> = {};
  if (entities.length > 0) {
    const ids = entities.map((e) => e.id);
    const activities = await db
      .select({
        ownerId: assetsTable.ownerEntityId,
        lastDate: sql<string>`max(${assetsTable.lastActivityDate})`,
      })
      .from(assetsTable)
      .where(
        and(
          sql`${assetsTable.ownerEntityId} = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})`,
          isNotNull(assetsTable.lastActivityDate),
        ),
      )
      .groupBy(assetsTable.ownerEntityId);
    for (const a of activities) {
      if (a.ownerId && a.lastDate) activityMap[a.ownerId] = a.lastDate;
    }
  }

  // Get CRM status from latest research session per entity
  const crmMap: Record<number, string> = {};
  const sessionIds: Record<number, boolean> = {};
  if (entities.length > 0) {
    const ids = entities.map((e) => e.id);
    const sessions = await db
      .select({
        entityId: researchSessionsTable.targetEntityId,
        status: researchSessionsTable.crmStatus,
      })
      .from(researchSessionsTable)
      .where(sql`${researchSessionsTable.targetEntityId} = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})`)
      .orderBy(desc(researchSessionsTable.createdAt));
    for (const s of sessions) {
      if (!crmMap[s.entityId]) {
        crmMap[s.entityId] = s.status;
        sessionIds[s.entityId] = true;
      }
    }
  }

  // Build real signals from the entity's most recent asset (registry data only)
  const signalMap: Record<number, string> = {};
  if (entities.length > 0) {
    const ids = entities.map((e) => e.id);
    const latestAssets = await db
      .select({
        ownerId: assetsTable.ownerEntityId,
        category: assetsTable.category,
        identifier: assetsTable.identifier,
        description: assetsTable.description,
        sourceRegistry: assetsTable.sourceRegistry,
        lastActivityDate: assetsTable.lastActivityDate,
      })
      .from(assetsTable)
      .where(sql`${assetsTable.ownerEntityId} = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})`)
      .orderBy(desc(assetsTable.lastActivityDate));

    // Keep only the most recent asset per entity
    for (const a of latestAssets) {
      if (!a.ownerId || signalMap[a.ownerId]) continue;
      const desc = (a.description ?? "").slice(0, 90);
      const src = a.sourceRegistry ?? a.category;
      signalMap[a.ownerId] = `${a.category}: ${desc} · ${src}`;
    }
  }

  // Fallback: use the entity's own notes (contains real source attribution)
  function entitySignal(e: (typeof entities)[number]): string | null {
    if (signalMap[e.id]) return signalMap[e.id]!;
    // Notes field is populated by ingestors with real attribution text
    const note = (e.notes ?? "").trim();
    if (/identity seed|manual(?:ly)? entered|entered manually|seed record/i.test(note)) return null;
    if (note.length > 10) return note.slice(0, 120);
    return null;
  }

  const OUTCOME_RANK: Record<string, number> = {
    direct_contact_verified:  6,
    direct_contact_candidate: 5,
    organization_contact:     4,
    social_only:              3,
    evidence_only:            2,
  };

  const hotLeads = entities.map((e) => ({
    entityId: e.id,
    entityName: e.name,
    entityType: e.type,
    bayesianScore: e.bayesianScore,
    accessScore: computeAccessScore(e),
    contactOutcome: e.contactOutcome,
    contactConfidence: e.contactConfidence,
    signal: entitySignal(e),
    signalDate: activityMap[e.id] ?? new Date().toISOString().split("T")[0]!,
    assetCount: assetCountMap[e.id] ?? 0,
    estimatedNetWorth: e.estimatedNetWorth,
    crmStatus: crmMap[e.id] ?? null,
    hasResearchSession: sessionIds[e.id] ?? false,
    nationality: e.nationality,
    linkedinHeadline: e.linkedinHeadline,
    twitterBio: e.twitterBio,
    telegramBio: e.telegramBio,
    personalWebsite: e.personalWebsite,
    foundationName: e.foundationName,
  }));

  res.json(
    hotLeads
      .sort((a, b) => {
        // 1. Contact outcome tier (verified > direct > org > social > evidence > none)
        const ao = OUTCOME_RANK[a.contactOutcome ?? ""] ?? 1;
        const bo = OUTCOME_RANK[b.contactOutcome ?? ""] ?? 1;
        if (bo !== ao) return bo - ao;
        // 2. Contact confidence score
        const ac = a.contactConfidence ?? 0;
        const bc = b.contactConfidence ?? 0;
        if (bc !== ac) return bc - ac;
        // 3. Reachability / access as tiebreaker
        return (b.accessScore ?? 0) - (a.accessScore ?? 0);
      })
      .slice(0, limit),
  );
});

// GET /dashboard/stats
router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const cached = await getCache<object>("dashboard:stats");
  if (cached) { res.json(cached); return; }

  const [
    [entityCount],
    [assetCount],
    [relCount],
    [avgScore],
    [hotCount],
    [sessionCount],
    crmBreakdown,
    assetsByCategory,
    topScorers,
  ] = await Promise.all([
    db.select({ cnt: sql<number>`count(*)::int` }).from(entitiesTable),
    db.select({ cnt: sql<number>`count(*)::int` }).from(assetsTable),
    db.select({ cnt: sql<number>`count(*)::int` }).from(relationshipsTable),
    db.select({ avg: sql<number>`round(avg(${entitiesTable.bayesianScore})::numeric, 4)` }).from(entitiesTable),
    db.select({ cnt: sql<number>`count(*)::int` }).from(entitiesTable).where(and(
      eq(entitiesTable.isHot, true),
      sql`${entitiesTable.type} NOT IN ('Corporation', 'Corp', 'Trust')`,
    )),
    db.select({ cnt: sql<number>`count(*)::int` }).from(researchSessionsTable),
    db
      .select({
        status: researchSessionsTable.crmStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(researchSessionsTable)
      .groupBy(researchSessionsTable.crmStatus),
    db
      .select({
        category: assetsTable.category,
        count: sql<number>`count(*)::int`,
        totalValue: sql<number>`coalesce(sum(${assetsTable.estimatedValue}), 0)::float`,
      })
      .from(assetsTable)
      .groupBy(assetsTable.category),
    db
      .select()
      .from(entitiesTable)
      .where(eq(entitiesTable.type, "HNWI"))
      .orderBy(sql`
        CASE ${entitiesTable.contactOutcome}
          WHEN 'direct_contact_verified'   THEN 6
          WHEN 'direct_contact_candidate'  THEN 5
          WHEN 'organization_contact'      THEN 4
          WHEN 'social_only'               THEN 3
          WHEN 'evidence_only'             THEN 2
          ELSE 1
        END DESC,
        ${entitiesTable.contactConfidence} DESC NULLS LAST,
        ${entitiesTable.bayesianScore} DESC
      `)
      .limit(5),
  ]);

  // Get asset counts for top scorers
  const topIds = topScorers.map((e) => e.id);
  const topAssetCounts: Record<number, number> = {};
  if (topIds.length > 0) {
    const counts = await db
      .select({
        ownerId: assetsTable.ownerEntityId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(assetsTable)
      .where(sql`${assetsTable.ownerEntityId} = ANY(${sql.raw(`ARRAY[${topIds.join(",")}]::int[]`)})`)
      .groupBy(assetsTable.ownerEntityId);
    for (const c of counts) {
      if (c.ownerId) topAssetCounts[c.ownerId] = c.cnt;
    }
  }

  // Count western-ingested HNWIs (metadata text contains the flag)
  const [westernCount] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(entitiesTable)
    .where(sql`${entitiesTable.metadata} LIKE '%"westernIngest":true%'`);

  // Enrichment coverage + F3 wealth tier segmentation + L2 contact outcome split (parallel queries)
  const [[contactableCount], [anyContactCount], [wealthTiersRow], [contactOutcomeRow]] = await Promise.all([
    db.select({ cnt: sql<number>`count(*)::int` }).from(entitiesTable)
      .where(gte(entitiesTable.contactConfidence, 30)),  // phone alone (30pts) counts as contactable
    db.select({ cnt: sql<number>`count(*)::int` }).from(entitiesTable)
      .where(or(
        isNotNull(entitiesTable.email),
        isNotNull(entitiesTable.phone),
        isNotNull(entitiesTable.linkedinUrl),
      )),
    // F3: bucket estimatedNetWorth into 4 tiers for dashboard wealth distribution widget
    db.select({
      ultraHnw: sql<number>`count(*) filter (where ${entitiesTable.estimatedNetWorth} > 100000000)::int`,
      veryHnw:  sql<number>`count(*) filter (where ${entitiesTable.estimatedNetWorth} between 30000000 and 100000000)::int`,
      hnw:      sql<number>`count(*) filter (where ${entitiesTable.estimatedNetWorth} between 4000000 and 30000000)::int`,
      unknown:  sql<number>`count(*) filter (where ${entitiesTable.estimatedNetWorth} is null or ${entitiesTable.estimatedNetWorth} < 4000000)::int`,
    }).from(entitiesTable),
    // L2: break down the "Reachable" metric by outcome type so the dashboard
    // distinguishes personal contacts from organisational/social signals.
    db.select({
      personal: sql<number>`count(*) filter (where contact_outcome in ('direct_contact_candidate','direct_contact_verified'))::int`,
      verified: sql<number>`count(*) filter (where contact_outcome = 'direct_contact_verified')::int`,
      org:      sql<number>`count(*) filter (where contact_outcome = 'organization_contact')::int`,
      social:   sql<number>`count(*) filter (where contact_outcome = 'social_only')::int`,
    }).from(entitiesTable),
  ]);

  const total = entityCount?.cnt ?? 0;
  const enrichmentCoverage = total > 0
    ? Math.round(((anyContactCount?.cnt ?? 0) / total) * 100)
    : 0;

  const payload = {
    totalEntities: total,
    totalAssets: assetCount?.cnt ?? 0,
    totalRelationships: relCount?.cnt ?? 0,
    avgBayesianScore: parseFloat(String(avgScore?.avg ?? 0)),
    hotLeadsCount: hotCount?.cnt ?? 0,
    westernHnwiCount: westernCount?.cnt ?? 0,
    activeResearchSessions: sessionCount?.cnt ?? 0,
    contactableCount: contactableCount?.cnt ?? 0,
    enrichmentCoverage,
    // L2: true contact breakdown — personal vs org vs social-only
    reachablePersonal: contactOutcomeRow?.personal ?? 0,
    reachableVerified: contactOutcomeRow?.verified ?? 0,
    reachableOrg:      contactOutcomeRow?.org ?? 0,
    reachableSocial:   contactOutcomeRow?.social ?? 0,
    // F3: wealth tier segmentation
    wealthTiers: {
      ultraHnw: wealthTiersRow?.ultraHnw ?? 0,  // >$100M
      veryHnw:  wealthTiersRow?.veryHnw  ?? 0,  // $30M–$100M
      hnw:      wealthTiersRow?.hnw      ?? 0,  // $4M–$30M
      unknown:  wealthTiersRow?.unknown  ?? 0,  // null or <$4M
    },
    crmBreakdown: crmBreakdown.map((r) => ({ status: r.status, count: r.count })),
    assetsByCategory: assetsByCategory.map((r) => ({
      category: r.category,
      count: r.count,
      totalValue: r.totalValue,
    })),
    topScorers: topScorers.map((e) => ({
      ...e,
      accessScore: computeAccessScore(e),
      createdAt: e.createdAt.toISOString(),
      assetCount: topAssetCounts[e.id] ?? 0,
    })),
  };
  await setCache("dashboard:stats", payload, 60);
  res.json(payload);
});

// GET /dashboard/map-data
router.get("/dashboard/map-data", async (_req, res): Promise<void> => {
  const cached = await getCache<object[]>("dashboard:map");
  if (cached) { res.json(cached); return; }

  const rows = await db
    .select({
      asset: assetsTable,
      ownerName: entitiesTable.name,
      ownerScore: entitiesTable.bayesianScore,
    })
    .from(assetsTable)
    .leftJoin(entitiesTable, eq(assetsTable.ownerEntityId, entitiesTable.id))
    .where(and(isNotNull(assetsTable.latitude), isNotNull(assetsTable.longitude)))
    .orderBy(desc(entitiesTable.bayesianScore))
    .limit(1000);

  const mapData = rows
    .filter((r) => r.asset.latitude !== null && r.asset.longitude !== null)
    .map(({ asset, ownerName, ownerScore }) => ({
      id: asset.id,
      category: asset.category,
      identifier: asset.identifier,
      jurisdiction: asset.jurisdiction,
      latitude: asset.latitude as number,
      longitude: asset.longitude as number,
      estimatedValue: asset.estimatedValue,
      address: asset.address,
      description: asset.description,
      ownerEntityId: asset.ownerEntityId,
      ownerName: ownerName ?? null,
      ownerBayesianScore: ownerScore ?? null,
      lastActivityDate: asset.lastActivityDate,
      sourceRegistry: asset.sourceRegistry,
    }));

  await setCache("dashboard:map", mapData, 120);
  res.json(mapData);
});

export default router;
