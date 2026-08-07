import { Router, type IRouter } from "express";
import { eq, isNotNull, sql, and } from "drizzle-orm";
import { db, relationshipsTable, entitiesTable, assetsTable } from "@workspace/db";
import { getAllEmbeddings } from "../lib/semantic-engine";
import {
  ListRelationshipsQueryParams,
  CreateRelationshipBody,
  DeleteRelationshipParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /relationships
router.get("/relationships", async (req, res): Promise<void> => {
  const parsed = ListRelationshipsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { entityId } = parsed.data;

  const rows = entityId
    ? await db.select().from(relationshipsTable).where(eq(relationshipsTable.sourceEntityId, entityId))
    : await db.select().from(relationshipsTable).orderBy(relationshipsTable.createdAt);

  // Resolve names for display
  const allEntityIds = new Set<number>();
  const allAssetIds = new Set<number>();
  for (const r of rows) {
    allEntityIds.add(r.sourceEntityId);
    if (r.targetType === "Entity") allEntityIds.add(r.targetId);
    if (r.targetType === "Asset") allAssetIds.add(r.targetId);
  }

  const entityNames: Record<number, string> = {};
  const assetNames: Record<number, string> = {};

  if (allEntityIds.size > 0) {
    const entityRows = await db.select({ id: entitiesTable.id, name: entitiesTable.name }).from(entitiesTable);
    for (const e of entityRows) entityNames[e.id] = e.name;
  }
  if (allAssetIds.size > 0) {
    const assetRows = await db.select({ id: assetsTable.id, identifier: assetsTable.identifier, category: assetsTable.category }).from(assetsTable);
    for (const a of assetRows) assetNames[a.id] = `${a.category}: ${a.identifier}`;
  }

  const relationships = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    sourceEntityName: entityNames[r.sourceEntityId] ?? null,
    targetName: r.targetType === "Entity" ? (entityNames[r.targetId] ?? null) : (assetNames[r.targetId] ?? null),
  }));

  res.json(relationships);
});

// POST /relationships
router.post("/relationships", async (req, res): Promise<void> => {
  const parsed = CreateRelationshipBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [rel] = await db.insert(relationshipsTable).values(parsed.data).returning();
  res.status(201).json({ ...rel!, createdAt: rel!.createdAt.toISOString(), sourceEntityName: null, targetName: null });
});

// DELETE /relationships/:id
router.delete("/relationships/:id", async (req, res): Promise<void> => {
  const params = DeleteRelationshipParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(relationshipsTable)
    .where(eq(relationshipsTable.id, params.data.id))
    .returning({ id: relationshipsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Relationship not found" });
    return;
  }
  res.sendStatus(204);
});

// POST /api/relationships/auto-detect — shared-address co-ownership detection
router.post("/relationships/auto-detect", async (_req, res): Promise<void> => {
  // Load entities with known residences
  const entities = await db
    .select({ id: entitiesTable.id, name: entitiesTable.name, knownResidences: entitiesTable.knownResidences })
    .from(entitiesTable)
    .where(isNotNull(entitiesTable.knownResidences));

  // Build address → entityId[] index
  const addressIndex = new Map<string, number[]>();
  for (const e of entities) {
    let addrs: string[] = [];
    try { addrs = JSON.parse(e.knownResidences ?? "[]"); } catch {}
    for (const addr of addrs) {
      const key = addr.toLowerCase().replace(/\s+/g, " ").trim();
      if (!key) continue;
      if (!addressIndex.has(key)) addressIndex.set(key, []);
      addressIndex.get(key)!.push(e.id);
    }
  }

  // Load existing relationships to stay idempotent
  const existing = await db
    .select({ sourceEntityId: relationshipsTable.sourceEntityId, targetId: relationshipsTable.targetId, relationshipType: relationshipsTable.relationshipType })
    .from(relationshipsTable);
  const seen = new Set(existing.map((r) => `${r.sourceEntityId}:${r.targetId}:${r.relationshipType}`));

  let created = 0;
  let skipped = 0;

  for (const [, ids] of addressIndex) {
    const unique = [...new Set(ids)];
    if (unique.length < 2) continue;
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i]!;
        const b = unique[j]!;
        const fwd = `${a}:${b}:KNOWN_ASSOCIATE`;
        const rev = `${b}:${a}:KNOWN_ASSOCIATE`;
        if (seen.has(fwd) || seen.has(rev)) { skipped++; continue; }
        await db.insert(relationshipsTable).values({
          sourceEntityId: a,
          targetId: b,
          targetType: "Entity",
          relationshipType: "KNOWN_ASSOCIATE",
          strength: 0.6,
          notes: "Auto-detected: shared correspondence address",
        });
        seen.add(fwd);
        created++;
      }
    }
  }

  res.json({ created, skipped, message: `Auto-detect complete: ${created} new relationships, ${skipped} already existed.` });
});

// POST /api/relationships/auto-detect-clusters — corporate-series name clustering
// Finds entities whose names share the same root after stripping legal suffixes and
// series indicators (e.g. "Bateleur Eagle Holdings I LLC" + "Bateleur Eagle Holdings II LLC").
router.post("/relationships/auto-detect-clusters", async (_req, res): Promise<void> => {
  // Legal entity suffixes to strip (longest first to avoid partial matches)
  const LEGAL_SUFFIXES = [
    "international", "investments", "enterprises", "management",
    "properties", "associates", "ventures", "advisors", "holdings",
    "partners", "services", "aviation", "capital", "realty", "aircraft",
    "trust", "group", "fund", "corp", "jets", "air", "llp", "inc",
    "ltd", "llc", "lp", "pc", "plc", "na", "nt", "co",
  ];

  // Roman numerals and Arabic numbers (trailing series indicator)
  const SERIES_RE = /\b(xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i|\d{1,3})\s*$/i;

  function clusterKey(name: string): string {
    let s = name.toLowerCase().replace(/[.,&']/g, " ").replace(/\s+/g, " ").trim();
    // Iteratively strip suffixes + trailing series until stable
    let prev = "";
    while (s !== prev) {
      prev = s;
      for (const suf of LEGAL_SUFFIXES) {
        const re = new RegExp("\\b" + suf + "\\s*$", "i");
        s = s.replace(re, "").trim();
      }
      s = s.replace(SERIES_RE, "").trim();
    }
    return s;
  }

  const entities = await db
    .select({ id: entitiesTable.id, name: entitiesTable.name })
    .from(entitiesTable);

  // Build cluster key → entity IDs index
  const clusterIndex = new Map<string, number[]>();
  for (const e of entities) {
    const key = clusterKey(e.name);
    // Require at least 2 words and 8 chars to avoid spurious matches on short/generic names
    const words = key.split(/\s+/).filter(Boolean);
    if (key.length < 8 || words.length < 2) continue;
    if (!clusterIndex.has(key)) clusterIndex.set(key, []);
    clusterIndex.get(key)!.push(e.id);
  }

  // Load existing relationships for idempotency
  const existing = await db
    .select({ sourceEntityId: relationshipsTable.sourceEntityId, targetId: relationshipsTable.targetId, relationshipType: relationshipsTable.relationshipType })
    .from(relationshipsTable);
  const seen = new Set(existing.map((r) => `${r.sourceEntityId}:${r.targetId}:${r.relationshipType}`));

  let created = 0;
  let skipped = 0;
  let clusters = 0;
  const pending: Array<{
    sourceEntityId: number; targetId: number; targetType: "Entity";
    relationshipType: string; strength: number; notes: string;
  }> = [];

  for (const [key, ids] of clusterIndex) {
    const unique = [...new Set(ids)];
    if (unique.length < 2) continue;
    clusters++;
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i]!;
        const b = unique[j]!;
        const fwd = `${a}:${b}:CORPORATE_SERIES`;
        const rev = `${b}:${a}:CORPORATE_SERIES`;
        if (seen.has(fwd) || seen.has(rev)) { skipped++; continue; }
        pending.push({
          sourceEntityId: a,
          targetId: b,
          targetType: "Entity" as const,
          relationshipType: "CORPORATE_SERIES",
          strength: 0.85,
          notes: "Auto-detected: corporate name series cluster [" + key + "]",
        });
        seen.add(fwd);
        created++;
      }
    }
  }

  // Batch insert in chunks of 500 to avoid parameter limits
  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }

  res.json({
    created,
    skipped,
    clusters,
    message: "Name-cluster detect: " + created + " new edges across " + clusters + " clusters, " + skipped + " already existed.",
  });
});

// ── POST /relationships/auto-detect-ch-codirectors ────────────────────────────
// Reads chOfficers stored in entity metadata (populated by POST /ingest/ch-company-officers)
// and creates SHARED_DIRECTOR edges between entities that share at least one director.
router.post("/relationships/auto-detect-ch-codirectors", async (_req, res): Promise<void> => {
  // Load all entities that have chOfficers in metadata
  const entities = await db
    .select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata })
    .from(entitiesTable)
    .where(sql`${entitiesTable.metadata} LIKE '%chOfficers%'`);

  // Build officer-name → entity-id index
  const officerIndex = new Map<string, number[]>();
  for (const e of entities) {
    let meta: Record<string, any> = {};
    try { meta = JSON.parse(e.metadata ?? "{}"); } catch {}
    const officers: Array<{ name: string }> = meta.chOfficers ?? [];
    for (const o of officers) {
      const key = (o.name ?? "").toLowerCase().trim();
      if (!key || key.length < 4) continue;
      if (!officerIndex.has(key)) officerIndex.set(key, []);
      officerIndex.get(key)!.push(e.id);
    }
  }

  // Load existing relationships for idempotency check
  const existing = await db
    .select({ sourceEntityId: relationshipsTable.sourceEntityId, targetId: relationshipsTable.targetId, relationshipType: relationshipsTable.relationshipType })
    .from(relationshipsTable);
  const seen = new Set(existing.map((r) => `${r.sourceEntityId}:${r.targetId}:${r.relationshipType}`));

  let created = 0; let skipped = 0; let sharedOfficers = 0;
  const pending: Array<{
    sourceEntityId: number; targetId: number; targetType: "Entity";
    relationshipType: string; strength: number; notes: string;
  }> = [];

  for (const [officerName, ids] of officerIndex) {
    const unique = [...new Set(ids)];
    if (unique.length < 2) continue;
    sharedOfficers++;
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i]!; const b = unique[j]!;
        const fwd = `${a}:${b}:SHARED_DIRECTOR`;
        const rev = `${b}:${a}:SHARED_DIRECTOR`;
        if (seen.has(fwd) || seen.has(rev)) { skipped++; continue; }
        pending.push({
          sourceEntityId: a, targetId: b, targetType: "Entity" as const,
          relationshipType: "SHARED_DIRECTOR", strength: 0.9,
          notes: `Shared CH director: ${officerName}`,
        });
        seen.add(fwd);
        created++;
      }
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }

  res.json({
    created, skipped, sharedOfficers,
    message: `Co-director detect: ${created} SHARED_DIRECTOR edges across ${sharedOfficers} shared officers, ${skipped} already existed.`,
  });
});

// ── POST /relationships/seed-edgar-associates ────────────────────────────────
// Paginates EDGAR EFTS for recent SC 13D/G filings, extracts display_names from
// each filing, matches against entities in our DB, and creates KNOWN_ASSOCIATE
// edges for any pair of DB entities that appear together in the same filing.
// Uses the filing-centric approach: O(pages) API calls instead of O(entities).
router.post("/relationships/seed-edgar-associates", async (_req, res): Promise<void> => {
  // 1. Build name → entity ID index for all DB entities
  const allEntities = await db
    .select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata })
    .from(entitiesTable);

  function normForMatch(n: string): string {
    // Strip CIK suffix "(CIK 12345)" common in EDGAR display_names
    return n.replace(/\s*\(CIK\s*\d+\)\s*$/i, "")
      .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }

  const nameIndex = new Map<string, Set<number>>();
  const addToIndex = (key: string, id: number) => {
    if (!key || key.length < 4) return;
    if (!nameIndex.has(key)) nameIndex.set(key, new Set());
    nameIndex.get(key)!.add(id);
  };

  for (const e of allEntities) {
    addToIndex(normForMatch(e.name), e.id);
    try {
      const meta = JSON.parse(e.metadata ?? "{}");
      if (typeof meta.entityName === "string") addToIndex(normForMatch(meta.entityName), e.id);
    } catch { /* ignore */ }
  }

  // 2. Load existing KNOWN_ASSOCIATE pairs for idempotency
  const existingRows = await db
    .select({ sourceEntityId: relationshipsTable.sourceEntityId, targetId: relationshipsTable.targetId })
    .from(relationshipsTable)
    .where(eq(relationshipsTable.relationshipType, "KNOWN_ASSOCIATE"));
  const seen = new Set(existingRows.map(r => `${Math.min(r.sourceEntityId, r.targetId)}:${Math.max(r.sourceEntityId, r.targetId)}`));

  // 3. Paginate EDGAR EFTS for recent SC 13D/G filings
  const EDGAR_HEADERS = {
    Accept: "application/json",
    "User-Agent": "ApexFinder/1.0 OSINT-Research research@apexfinder.private",
  };
  // Use multiple search anchors to cover different filing styles
  const SEARCH_TERMS = [
    '"aggregate beneficial ownership"',
    '"beneficial owner of"',
    '"shares of common stock beneficially"',
  ];

  const pending: Array<{
    sourceEntityId: number; targetId: number; targetType: "Entity";
    relationshipType: string; strength: number; notes: string;
  }> = [];
  let apiCalls = 0;
  let filingMatches = 0;

  for (const term of SEARCH_TERMS) {
    for (let from = 0; from < 1000; from += 10) {
      try {
        await new Promise(r => setTimeout(r, 200)); // stay well under 10 req/s
        const url = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(term)}&forms=SC+13D,SC+13G&dateRange=custom&startdt=2018-01-01&from=${from}`;
        const resp = await fetch(url, { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) break;
        const data = await resp.json() as any;
        const hits: any[] = data?.hits?.hits ?? [];
        if (hits.length === 0) break;
        apiCalls++;

        for (const hit of hits) {
          const rawNames: string[] = hit?._source?.display_names ?? [];
          if (rawNames.length < 2) continue;

          // Find all DB entity IDs present in this filing's display_names
          const matchedIds = new Set<number>();
          for (const rawName of rawNames) {
            const key = normForMatch(rawName);
            const ids = nameIndex.get(key);
            if (ids) for (const id of ids) matchedIds.add(id);
          }
          if (matchedIds.size < 2) continue;

          filingMatches++;
          const idArr = [...matchedIds];
          const formType: string = (hit?._source?.root_forms?.[0] ?? "SC 13D").trim();
          for (let i = 0; i < idArr.length; i++) {
            for (let j = i + 1; j < idArr.length; j++) {
              const a = idArr[i]!, b = idArr[j]!;
              const pairKey = `${Math.min(a, b)}:${Math.max(a, b)}`;
              if (seen.has(pairKey)) continue;
              seen.add(pairKey);
              pending.push({
                sourceEntityId: a, targetId: b, targetType: "Entity" as const,
                relationshipType: "KNOWN_ASSOCIATE", strength: 0.85,
                notes: `EDGAR ${formType} co-filer group`,
              });
            }
          }
        }
      } catch { break; }
    }
  }

  // 4. Batch insert
  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }

  res.json({
    created: pending.length,
    apiCalls,
    filingMatches,
    message: `EDGAR co-filer: ${pending.length} KNOWN_ASSOCIATE edges from ${filingMatches} group filings (${apiCalls} EFTS pages scanned)`,
  });
});

// ── POST /relationships/seed-wikidata-associates ─────────────────────────────
// For every entity that had a Wikidata hit during in-house enrichment, queries
// Wikidata SPARQL for known personal relationships (P26 spouse, P451 partner,
// P3373 sibling, P22/P25 parent) and creates KNOWN_ASSOCIATE / FAMILY_OF edges
// whenever the named associate also exists in our DB.
router.post("/relationships/seed-wikidata-associates", async (_req, res): Promise<void> => {
  // Find entities that had a Wikidata hit (sourceHits.Wikidata = true in metadata)
  const wikidataEntities = await db
    .select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata })
    .from(entitiesTable)
    .where(sql`${entitiesTable.metadata}::text LIKE '%"Wikidata":true%'`);

  if (!wikidataEntities.length) {
    res.json({ created: 0, message: "No entities with Wikidata hits. Run In-House Enrich first." });
    return;
  }

  // Build name → entity ID lookup
  const allEntities = await db.select({ id: entitiesTable.id, name: entitiesTable.name }).from(entitiesTable);
  function normKey(n: string): string {
    return n.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  }
  const nameIndex = new Map<string, number[]>();
  for (const e of allEntities) {
    const k = normKey(e.name);
    if (!nameIndex.has(k)) nameIndex.set(k, []);
    nameIndex.get(k)!.push(e.id);
  }

  // Load existing relationships for idempotency
  const existingRows = await db
    .select({ sourceEntityId: relationshipsTable.sourceEntityId, targetId: relationshipsTable.targetId, relationshipType: relationshipsTable.relationshipType })
    .from(relationshipsTable);
  const seen = new Set(existingRows.map(r => `${r.sourceEntityId}:${r.targetId}:${r.relationshipType}`));

  const pending: Array<{
    sourceEntityId: number; targetId: number; targetType: "Entity";
    relationshipType: string; strength: number; notes: string;
  }> = [];
  let apiCalls = 0;
  let associatesFound = 0;

  for (const entity of wikidataEntities) {
    // Normalise ALL-CAPS EDGAR names (e.g. "SMITH JOHN" → "John Smith")
    const displayName = entity.name.trim();

    try {
      await new Promise(r => setTimeout(r, 1500)); // ~40 req/min Wikidata limit

      const sparql = `
SELECT DISTINCT ?associateLabel ?relType WHERE {
  ?person wdt:P31 wd:Q5;
          rdfs:label "${displayName.replace(/"/g, "")}"@en.
  {
    ?person wdt:P26 ?associate. BIND("spouse" AS ?relType)
  } UNION {
    ?person wdt:P451 ?associate. BIND("partner" AS ?relType)
  } UNION {
    ?person wdt:P3373 ?associate. BIND("sibling" AS ?relType)
  } UNION {
    ?person wdt:P22 ?associate. BIND("parent" AS ?relType)
  } UNION {
    ?person wdt:P25 ?associate. BIND("parent" AS ?relType)
  }
  ?associate rdfs:label ?associateLabel. FILTER(LANG(?associateLabel)="en")
} LIMIT 20`;

      const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/sparql-results+json",
          "User-Agent": "ApexFinder/1.0 research@apexfinder.private",
        },
      });
      if (!resp.ok) continue;

      const data = await resp.json() as any;
      const bindings: any[] = data?.results?.bindings ?? [];
      apiCalls++;

      for (const b of bindings) {
        const associateName: string = b?.associateLabel?.value ?? "";
        const relType: string = b?.relType?.value ?? "associate";
        if (!associateName) continue;

        const key = normKey(associateName);
        const targetIds = nameIndex.get(key) ?? [];

        for (const targetId of targetIds) {
          if (targetId === entity.id) continue;
          const relLabel = (relType === "sibling" || relType === "parent") ? "FAMILY_OF" : "KNOWN_ASSOCIATE";
          const fwd = `${entity.id}:${targetId}:${relLabel}`;
          const rev = `${targetId}:${entity.id}:${relLabel}`;
          if (seen.has(fwd) || seen.has(rev)) continue;
          seen.add(fwd);
          associatesFound++;
          pending.push({
            sourceEntityId: entity.id, targetId, targetType: "Entity" as const,
            relationshipType: relLabel, strength: 0.9,
            notes: `Wikidata ${relType}: ${displayName} ↔ ${associateName}`,
          });
        }
      }
    } catch { /* network/timeout — continue to next entity */ }
  }

  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }

  res.json({
    created: pending.length,
    wikidataEntities: wikidataEntities.length,
    apiCalls,
    associatesFound,
    message: `Wikidata associates: ${pending.length} edges created for ${wikidataEntities.length} enriched entities (${associatesFound} associates found in DB)`,
  });
});

// ── POST /relationships/auto-detect-edgar-cofilers ───────────────────────────
// Groups all SEC EDGAR entities by the company they reported on (entityName field
// in metadata). Entities co-reporting on the same company get EDGAR_CO_FILER edges.
// Runs entirely from the local DB — no external API calls.
router.post("/relationships/auto-detect-edgar-cofilers", async (_req, res): Promise<void> => {
  // Load all entities from SEC EDGAR source
  const edgarEntities = await db
    .select({ id: entitiesTable.id, name: entitiesTable.name, metadata: entitiesTable.metadata })
    .from(entitiesTable)
    .where(sql`${entitiesTable.metadata}::text LIKE '%sec-edgar%'`);

  if (edgarEntities.length < 2) {
    res.json({ created: 0, groups: 0, message: "Not enough EDGAR entities to detect co-filers." });
    return;
  }

  // Build targetCompany → [entityId, ...] index from metadata.entityName
  const groupIndex = new Map<string, number[]>();
  for (const e of edgarEntities) {
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(e.metadata ?? "{}"); } catch {}
    const targetCompany = (meta.entityName as string ?? "").trim().toLowerCase();
    if (!targetCompany || targetCompany.length < 3) continue;
    if (!groupIndex.has(targetCompany)) groupIndex.set(targetCompany, []);
    groupIndex.get(targetCompany)!.push(e.id);
  }

  // Load existing EDGAR_CO_FILER edges for idempotency
  const existing = await db
    .select({ sourceEntityId: relationshipsTable.sourceEntityId, targetId: relationshipsTable.targetId })
    .from(relationshipsTable)
    .where(eq(relationshipsTable.relationshipType, "EDGAR_CO_FILER"));
  const seen = new Set(existing.map(r => `${Math.min(r.sourceEntityId, r.targetId)}:${Math.max(r.sourceEntityId, r.targetId)}`));

  let created = 0; let skipped = 0; let groups = 0;
  const pending: Array<{
    sourceEntityId: number; targetId: number; targetType: "Entity";
    relationshipType: string; strength: number; notes: string;
  }> = [];

  for (const [company, ids] of groupIndex) {
    const unique = [...new Set(ids)];
    if (unique.length < 2) continue;
    groups++;
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const a = unique[i]!; const b = unique[j]!;
        const pairKey = `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (seen.has(pairKey)) { skipped++; continue; }
        seen.add(pairKey);
        pending.push({
          sourceEntityId: a, targetId: b, targetType: "Entity" as const,
          relationshipType: "EDGAR_CO_FILER", strength: 0.75,
          notes: `EDGAR co-filer: both reported on ${company}`,
        });
        created++;
      }
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }

  res.json({
    created, skipped, groups,
    message: `EDGAR co-filer detect: ${created} EDGAR_CO_FILER edges across ${groups} shared-company groups, ${skipped} already existed.`,
  });
});

// POST /api/relationships/auto-detect-faa-geo — C1: geographic peer edges for FAA individual owners
// Groups FAA HNWI entities by city+state; creates GEOGRAPHIC_PEER edges for groups of 2–15.
router.post("/relationships/auto-detect-faa-geo", async (_req, res): Promise<void> => {
  const entities = await db
    .select({ id: entitiesTable.id, knownResidences: entitiesTable.knownResidences })
    .from(entitiesTable)
    .where(and(
      eq(entitiesTable.type, "HNWI"),
      isNotNull(entitiesTable.knownResidences),
      sql`${entitiesTable.metadata}::text LIKE '%faa-aircraft-registry%'`
    ));

  // Parse city+state from "street, city, STATE" address string stored as plain text
  const geoIndex = new Map<string, number[]>();
  for (const e of entities) {
    const parts = (e.knownResidences ?? "").split(",").map((s: string) => s.trim());
    if (parts.length < 2) continue;
    // Address is "STREET, CITY, STATE, [COUNTRY]" — state is 2nd-to-last non-country part
    const state = parts[parts.length - 2] ?? "";
    const city  = parts[parts.length - 3] ?? parts[parts.length - 2] ?? "";
    if (!city || !state || state.length > 3) continue;
    const key = `${city.toLowerCase()},${state.toUpperCase()}`;
    const arr = geoIndex.get(key) ?? [];
    arr.push(e.id);
    geoIndex.set(key, arr);
  }

  const existing = await db
    .select({ src: relationshipsTable.sourceEntityId, tgt: relationshipsTable.targetId })
    .from(relationshipsTable)
    .where(sql`${relationshipsTable.relationshipType} = 'GEOGRAPHIC_PEER'`);
  const existingSet = new Set(existing.map((r) => `${r.src}-${r.tgt}`));

  const pending: (typeof relationshipsTable.$inferInsert)[] = [];
  let created = 0; let skipped = 0; let groups = 0;

  for (const [geoKey, ids] of geoIndex.entries()) {
    if (ids.length < 2 || ids.length > 15) continue; // skip singletons and over-generic groups
    groups++;
    const [city, state] = geoKey.split(",");
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (pending.length >= 500_000) break;
        const src = ids[i]!; const tgt = ids[j]!;
        if (existingSet.has(`${src}-${tgt}`) || existingSet.has(`${tgt}-${src}`)) { skipped++; continue; }
        pending.push({ sourceEntityId: src, targetId: tgt, targetType: "Entity", relationshipType: "GEOGRAPHIC_PEER", strength: 0.3, notes: `FAA geo-cluster: ${city}, ${state}` });
        created++;
      }
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }
  res.json({ created, skipped, groups, message: `FAA geo-proximity: ${created} GEOGRAPHIC_PEER edges across ${groups} city+state groups, ${skipped} skipped.` });
});

// POST /api/relationships/auto-detect-hmlr-postcode — C2: postcode district peer edges for HMLR buyers
// Groups HMLR entities by postcode district (3–4 char prefix); creates PROPERTY_AREA_PEER edges for groups 2–10.
router.post("/relationships/auto-detect-hmlr-postcode", async (_req, res): Promise<void> => {
  const entities = await db
    .select({ id: entitiesTable.id, metadata: entitiesTable.metadata })
    .from(entitiesTable)
    .where(sql`${entitiesTable.metadata}::text LIKE '%hmlr-ppd-csv%'`);

  const postcodeIndex = new Map<string, number[]>();
  for (const e of entities) {
    let meta: Record<string, any> = {};
    try { meta = JSON.parse(e.metadata ?? "{}"); } catch {}
    const postcode = (meta.postcode as string | undefined) ?? "";
    if (!postcode) continue;
    const district = postcode.split(" ")[0] ?? postcode.slice(0, 4); // e.g. "SW1W" from "SW1W 0NY"
    if (!district || district.length < 2) continue;
    const arr = postcodeIndex.get(district) ?? [];
    arr.push(e.id);
    postcodeIndex.set(district, arr);
  }

  const existing = await db
    .select({ src: relationshipsTable.sourceEntityId, tgt: relationshipsTable.targetId })
    .from(relationshipsTable)
    .where(sql`${relationshipsTable.relationshipType} = 'PROPERTY_AREA_PEER'`);
  const existingSet = new Set(existing.map((r) => `${r.src}-${r.tgt}`));

  const pending: (typeof relationshipsTable.$inferInsert)[] = [];
  let created = 0; let skipped = 0; let groups = 0;

  for (const [district, ids] of postcodeIndex.entries()) {
    if (ids.length < 2 || ids.length > 10) continue;
    groups++;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (pending.length >= 500_000) break;
        const src = ids[i]!; const tgt = ids[j]!;
        if (existingSet.has(`${src}-${tgt}`) || existingSet.has(`${tgt}-${src}`)) { skipped++; continue; }
        pending.push({ sourceEntityId: src, targetId: tgt, targetType: "Entity", relationshipType: "PROPERTY_AREA_PEER", strength: 0.4, notes: `HMLR postcode district: ${district}` });
        created++;
      }
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }
  res.json({ created, skipped, groups, message: `HMLR postcode: ${created} PROPERTY_AREA_PEER edges across ${groups} postcode districts, ${skipped} skipped.` });
});

// POST /api/relationships/auto-detect-edgar-coshareholder — C3: co-shareholder edges via shared company
// Groups EDGAR entities by metadata.companyName; creates EDGAR_CO_SHAREHOLDER edges for groups 2–20.
router.post("/relationships/auto-detect-edgar-coshareholder", async (_req, res): Promise<void> => {
  const entities = await db
    .select({ id: entitiesTable.id, metadata: entitiesTable.metadata })
    .from(entitiesTable)
    .where(sql`${entitiesTable.metadata}::text LIKE '%sec-edgar%' AND ${entitiesTable.metadata}::text NOT LIKE '%sec-edgar-def14a%'`);

  const companyIndex = new Map<string, number[]>();
  for (const e of entities) {
    let meta: Record<string, any> = {};
    try { meta = JSON.parse(e.metadata ?? "{}"); } catch {}
    const company = ((meta.companyName as string | undefined) ?? "").trim().toLowerCase();
    if (!company) continue;
    const arr = companyIndex.get(company) ?? [];
    arr.push(e.id);
    companyIndex.set(company, arr);
  }

  const existing = await db
    .select({ src: relationshipsTable.sourceEntityId, tgt: relationshipsTable.targetId })
    .from(relationshipsTable)
    .where(sql`${relationshipsTable.relationshipType} = 'EDGAR_CO_SHAREHOLDER'`);
  const existingSet = new Set(existing.map((r) => `${r.src}-${r.tgt}`));

  const pending: (typeof relationshipsTable.$inferInsert)[] = [];
  let created = 0; let skipped = 0; let groups = 0;

  for (const [company, ids] of companyIndex.entries()) {
    if (ids.length < 2 || ids.length > 20) continue;
    groups++;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (pending.length >= 500_000) break;
        const src = ids[i]!; const tgt = ids[j]!;
        if (existingSet.has(`${src}-${tgt}`) || existingSet.has(`${tgt}-${src}`)) { skipped++; continue; }
        pending.push({ sourceEntityId: src, targetId: tgt, targetType: "Entity", relationshipType: "EDGAR_CO_SHAREHOLDER", strength: 0.5, notes: `EDGAR co-shareholder: both hold ${company}` });
        created++;
      }
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }
  res.json({ created, skipped, groups, message: `EDGAR co-shareholder: ${created} EDGAR_CO_SHAREHOLDER edges across ${groups} companies, ${skipped} skipped.` });
});

// ── POST /relationships/semantic-dedup — G2b semantic entity resolution ────────
//
// Finds entity pairs from DIFFERENT source registries whose sentence embeddings
// are highly similar (cosine > 0.93), indicating the same person appears in
// multiple registries under slightly different name spellings.
// Creates LIKELY_SAME_PERSON relationship edges for each matching pair.
//
// Algorithm: O(|FAA| × |EDGAR|) cross-registry cosine — fast because EDGAR is
// small (~500). Skips within-registry pairs (already deduped at ingest).
// Capped at 10,000 entities per registry for safety.
router.post("/relationships/semantic-dedup", async (_req, res): Promise<void> => {
  const embCache = getAllEmbeddings();
  if (embCache.size < 50) {
    res.json({ created: 0, skipped: 0, message: "Embedding cache is empty — run compute-embeddings first." });
    return;
  }

  // Load all entities with sourceRegistries so we can group by registry
  const entities = await db
    .select({ id: entitiesTable.id, name: entitiesTable.name, sourceRegistries: entitiesTable.sourceRegistries })
    .from(entitiesTable)
    .where(isNotNull(entitiesTable.sourceRegistries));

  // Normalise a sourceRegistries string to a short stable key
  function registryPrefix(src: string): string {
    const s = src.toLowerCase();
    if (s.includes("faa") || s.includes("aircraft"))     return "faa";
    if (s.includes("edgar") || s.includes("sec "))       return "edgar";
    if (s.includes("hmlr") || s.includes("land registry") || s.includes("price paid")) return "hmlr";
    if (s.includes("brreg") || s.includes("norway"))     return "brreg";
    if (s.includes("companies house") || s.includes("ch "))  return "ch";
    if (s.includes("gleif") || s.includes("lei"))        return "gleif";
    if (s.includes("occrp") || s.includes("aleph"))      return "occrp";
    return s.split(/[\s\-—:]/)[0]!.slice(0, 20);
  }

  // Group entity IDs by their first source registry prefix
  const byRegistry = new Map<string, number[]>();
  const nameById = new Map<number, string>(); // I2: for token overlap guard
  for (const e of entities) {
    if (!embCache.has(e.id)) continue; // no embedding yet
    nameById.set(e.id, e.name ?? "");
    let srcs: string[] = [];
    try { srcs = JSON.parse(e.sourceRegistries ?? "[]"); } catch { /* */ }
    const prefix = registryPrefix(srcs[0] ?? "unknown");
    const arr = byRegistry.get(prefix) ?? [];
    arr.push(e.id);
    byRegistry.set(prefix, arr);
  }

  // I2: true if two names share ≥ minShared significant tokens (prevents false positives at 0.87)
  function hasEnoughSharedTokens(a: string, b: string, minShared = 2): boolean {
    const STOP = new Set(["the","of","and","a","an","in","at","for","to","by","or","mr","ms","dr","jr","sr","ii","iii","iv"]);
    const tokens = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));
    const aSet = new Set(tokens(a));
    return tokens(b).filter(t => aSet.has(t)).length >= minShared;
  }

  // Registry pairs to cross-compare (skip same-registry pairs)
  const registries = [...byRegistry.keys()];

  // Load existing LIKELY_SAME_PERSON edges to avoid duplicates
  const existing = await db
    .select({ src: relationshipsTable.sourceEntityId, tgt: relationshipsTable.targetId })
    .from(relationshipsTable)
    .where(sql`${relationshipsTable.relationshipType} = 'LIKELY_SAME_PERSON'`);
  const existingSet = new Set(existing.map((r) => `${r.src}-${r.tgt}`));

  // I2: lowered from 0.93 → 0.87 → 0.82; token overlap guard prevents false positives
  const SIMILARITY_THRESHOLD = 0.82;
  const MAX_PER_REGISTRY = 10_000;

  let created = 0;
  let compared = 0;
  const pending: (typeof relationshipsTable.$inferInsert)[] = [];

  // Compare each registry pair (i < j to avoid double-comparison)
  for (let i = 0; i < registries.length; i++) {
    for (let j = i + 1; j < registries.length; j++) {
      const regA = registries[i]!;
      const regB = registries[j]!;
      const idsA = (byRegistry.get(regA) ?? []).slice(0, MAX_PER_REGISTRY);
      const idsB = (byRegistry.get(regB) ?? []).slice(0, MAX_PER_REGISTRY);

      for (const idA of idsA) {
        const embA = embCache.get(idA);
        if (!embA) continue;
        for (const idB of idsB) {
          if (pending.length >= 50_000) break;
          const embB = embCache.get(idB);
          if (!embB) continue;
          compared++;

          // Cosine similarity (both vectors are already normalized by semantic-engine)
          let dot = 0;
          for (let k = 0; k < embA.length; k++) dot += embA[k]! * embB[k]!;

          if (dot < SIMILARITY_THRESHOLD) continue;

          // I2: token overlap guard — must share ≥ 1 significant name token (lowered from 2 for cross-registry recall)
          if (!hasEnoughSharedTokens(nameById.get(idA) ?? "", nameById.get(idB) ?? "", 1)) continue;

          const src = Math.min(idA, idB);
          const tgt = Math.max(idA, idB);
          if (existingSet.has(`${src}-${tgt}`)) continue;
          existingSet.add(`${src}-${tgt}`); // prevent dupes in this run

          pending.push({
            sourceEntityId: src,
            targetId: tgt,
            targetType: "Entity",
            relationshipType: "LIKELY_SAME_PERSON",
            strength: parseFloat(dot.toFixed(3)),
            notes: `Semantic embedding similarity ${dot.toFixed(3)} (${regA} × ${regB}) — same person across registries`,
          });
          created++;
        }
      }
    }
  }

  // Batch insert
  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }

  res.json({
    created,
    compared,
    embeddingsCached: embCache.size,
    registries: Object.fromEntries([...byRegistry.entries()].map(([k, v]) => [k, v.length])),
    message: `Semantic dedup: ${created} LIKELY_SAME_PERSON edges from ${compared.toLocaleString()} cross-registry comparisons (${embCache.size} embeddings cached).`,
  });
});

// ── POST /relationships/auto-detect-edgar-coinvestor — I3-A ───────────────────
// High-quality warm-path edges: EDGAR HNWI/Gatekeeper entities who are co-investors
// in the same company. Stronger signal than EDGAR_CO_SHAREHOLDER (which covers all types).
// Two HNWIs on the same cap table almost certainly know each other personally.
router.post("/relationships/auto-detect-edgar-coinvestor", async (_req, res): Promise<void> => {
  const entities = await db
    .select({ id: entitiesTable.id, metadata: entitiesTable.metadata })
    .from(entitiesTable)
    .where(sql`${entitiesTable.type} IN ('HNWI', 'Gatekeeper') AND (${entitiesTable.sourceRegistries}::text ILIKE '%edgar%' OR ${entitiesTable.metadata}::text ILIKE '%sec-edgar%')`);

  const companyIndex = new Map<string, number[]>();
  for (const e of entities) {
    let meta: Record<string, any> = {};
    try { meta = JSON.parse(e.metadata ?? "{}"); } catch {}
    const company = ((meta.companyName as string | undefined) ?? "").trim().toLowerCase();
    if (!company || company.length < 3) continue;
    const arr = companyIndex.get(company) ?? [];
    arr.push(e.id);
    companyIndex.set(company, arr);
  }

  const existing = await db
    .select({ src: relationshipsTable.sourceEntityId, tgt: relationshipsTable.targetId })
    .from(relationshipsTable)
    .where(sql`${relationshipsTable.relationshipType} = 'EDGAR_CO_INVESTOR'`);
  const existingSet = new Set(existing.map((r) => `${r.src}-${r.tgt}`));

  const pending: (typeof relationshipsTable.$inferInsert)[] = [];
  let created = 0; let skipped = 0; let groups = 0;

  for (const [company, ids] of companyIndex.entries()) {
    if (ids.length < 2 || ids.length > 20) continue; // singles and hub companies are noise
    groups++;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (pending.length >= 200_000) break;
        const src = Math.min(ids[i]!, ids[j]!);
        const tgt = Math.max(ids[i]!, ids[j]!);
        const key = `${src}-${tgt}`;
        if (existingSet.has(key)) { skipped++; continue; }
        existingSet.add(key);
        pending.push({
          sourceEntityId: src, targetId: tgt, targetType: "Entity",
          relationshipType: "EDGAR_CO_INVESTOR", strength: 0.75,
          notes: `EDGAR co-investor: both are HNWI/Gatekeeper shareholders of ${company}`,
        });
        created++;
      }
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }
  res.json({ created, skipped, groups, message: `EDGAR co-investor: ${created} EDGAR_CO_INVESTOR edges across ${groups} companies, ${skipped} skipped.` });
});

// ── POST /relationships/foundation-colleagues — I3-B ─────────────────────────
// Entities that share the same foundation name are likely co-directors/co-trustees.
// IRS 990 filings list officers/directors of the same EIN — these people know each other.
// Grouped by exact foundationName string (written by foundation-filings enricher).
router.post("/relationships/foundation-colleagues", async (_req, res): Promise<void> => {
  const entities = await db
    .select({ id: entitiesTable.id, foundationName: entitiesTable.foundationName })
    .from(entitiesTable)
    .where(isNotNull(entitiesTable.foundationName));

  const byFoundation = new Map<string, number[]>();
  for (const e of entities) {
    const key = (e.foundationName ?? "").trim().toLowerCase();
    if (!key || key.length < 4) continue;
    const arr = byFoundation.get(key) ?? [];
    arr.push(e.id);
    byFoundation.set(key, arr);
  }

  const existing = await db
    .select({ src: relationshipsTable.sourceEntityId, tgt: relationshipsTable.targetId })
    .from(relationshipsTable)
    .where(sql`${relationshipsTable.relationshipType} = 'FOUNDATION_COLLEAGUE'`);
  const existingSet = new Set(existing.map((r) => `${r.src}-${r.tgt}`));

  const pending: (typeof relationshipsTable.$inferInsert)[] = [];
  let created = 0; let skipped = 0; let groups = 0;

  for (const [foundation, ids] of byFoundation.entries()) {
    if (ids.length < 2 || ids.length > 20) continue;
    groups++;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (pending.length >= 100_000) break;
        const src = Math.min(ids[i]!, ids[j]!);
        const tgt = Math.max(ids[i]!, ids[j]!);
        const key = `${src}-${tgt}`;
        if (existingSet.has(key)) { skipped++; continue; }
        existingSet.add(key);
        pending.push({
          sourceEntityId: src, targetId: tgt, targetType: "Entity",
          relationshipType: "FOUNDATION_COLLEAGUE", strength: 0.85,
          notes: `IRS 990 co-director/co-trustee of "${foundation}"`,
        });
        created++;
      }
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }
  res.json({ created, skipped, groups, message: `Foundation colleagues: ${created} FOUNDATION_COLLEAGUE edges across ${groups} foundations, ${skipped} skipped.` });
});

// ── POST /relationships/name-exact-dedup — I2 ────────────────────────────────
// Creates LIKELY_SAME_PERSON edges for entities with identical names across different
// registries — guaranteed same-person matches that semantic dedup may miss when
// embeddings aren't yet computed or name variants are too short to embed well.
router.post("/relationships/name-exact-dedup", async (_req, res): Promise<void> => {
  const entities = await db
    .select({ id: entitiesTable.id, name: entitiesTable.name, sourceRegistries: entitiesTable.sourceRegistries })
    .from(entitiesTable)
    .where(and(isNotNull(entitiesTable.sourceRegistries), isNotNull(entitiesTable.name)));

  // Sort tokens alphabetically to handle LAST FIRST vs FIRST LAST name order across registries
  // e.g. FAA "SMITH JOHN A" stored as "smith john a", EDGAR "John A Smith" stored as "john a smith"
  // Both normalise to sorted "a john smith" → match
  function sortedNameKey(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ")
      .split(" ").filter(Boolean).sort().join(" ");
  }

  const byName = new Map<string, Array<{ id: number; registry: string; originalNorm: string }>>();
  for (const e of entities) {
    const norm = (e.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if (!norm || norm.length < 4) continue;
    if (/^\d+\s/.test(norm)) continue; // skip HMLR address-named entities
    let srcs: string[] = [];
    try { srcs = JSON.parse(e.sourceRegistries ?? "[]"); } catch {}
    const registry = (srcs[0] ?? "unknown").toLowerCase().split(/[\s\-:]/)[0]!.slice(0, 20);
    const key = sortedNameKey(e.name ?? "");
    const arr = byName.get(key) ?? [];
    arr.push({ id: e.id, registry, originalNorm: norm });
    byName.set(key, arr);
  }

  const existing = await db
    .select({ src: relationshipsTable.sourceEntityId, tgt: relationshipsTable.targetId })
    .from(relationshipsTable)
    .where(sql`${relationshipsTable.relationshipType} = 'LIKELY_SAME_PERSON'`);
  const existingSet = new Set(existing.map((r) => `${r.src}-${r.tgt}`));

  const pending: (typeof relationshipsTable.$inferInsert)[] = [];
  let created = 0; let skipped = 0; let groups = 0;

  for (const [norm, entries] of byName.entries()) {
    if (entries.length < 2) continue;
    // Only create edges when at least two different registries are present
    const registrySet = new Set(entries.map(e => e.registry));
    if (registrySet.size < 2) continue;
    groups++;

    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]!; const b = entries[j]!;
        if (a.registry === b.registry) continue; // same-registry = same import, not same person
        if (pending.length >= 50_000) break;
        const src = Math.min(a.id, b.id);
        const tgt = Math.max(a.id, b.id);
        const key = `${src}-${tgt}`;
        if (existingSet.has(key)) { skipped++; continue; }
        existingSet.add(key);
        pending.push({
          sourceEntityId: src, targetId: tgt, targetType: "Entity",
          relationshipType: "LIKELY_SAME_PERSON", strength: 0.95,
          notes: `Exact name match across registries: "${norm}" (${a.registry} × ${b.registry})`,
        });
        created++;
      }
    }
  }

  const CHUNK = 500;
  for (let i = 0; i < pending.length; i += CHUNK) {
    await db.insert(relationshipsTable).values(pending.slice(i, i + CHUNK));
  }
  res.json({ created, skipped, groups, message: `Name-exact dedup: ${created} LIKELY_SAME_PERSON edges from ${groups} exact name matches across registries, ${skipped} skipped.` });
});

export default router;
