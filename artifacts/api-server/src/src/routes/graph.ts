import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, entitiesTable, assetsTable, relationshipsTable } from "@workspace/db";
import { GetEntityGraphParams, GetEntityGraphQueryParams, GetConnectionPathQueryParams } from "@workspace/api-zod";
import {
  buildGraph,
  extractSubgraph,
  findShortestPath,
  computeCentrality,
  type GraphVertex,
  type GraphArc,
} from "../lib/graph-engine";

const router: IRouter = Router();

function vertexToNode(v: GraphVertex, centralSet: Set<string>, targetId: string) {
  return {
    id: v.id,
    label: v.label,
    nodeType: v.nodeType,
    bayesianScore: v.bayesianScore ?? null,
    estimatedValue: v.estimatedValue ?? null,
    metadata: v.metadata ?? null,
    nationality: v.nationality ?? null,
    contactConfidence: v.contactConfidence ?? null,
    contactEmail: v.contactEmail ?? null,
    isTarget: v.id === targetId,
    isCentral: centralSet.has(v.id),
  };
}

function arcToEdge(arc: GraphArc) {
  // Strip reverse suffixes for clean IDs
  return {
    id: arc.id.replace("_rev", ""),
    source: arc.source,
    target: arc.target,
    label: arc.label,
    strength: arc.strength ?? null,
  };
}

// GET /graph/hub-entity — returns a well-connected entity ID for use as graph default.
// Prefers PROPERTY_AREA_PEER hubs (geographic clusters, visually meaningful networks).
// Falls back to any moderate hub (10–150 edges) if no geographic hub exists.
router.get("/graph/hub-entity", async (_req, res): Promise<void> => {
  try {
    // First: prefer a geographic-peer hub (UK property area clusters) with 5–80 edges
    const geoRows = await db.execute<{ id: number; cnt: string }>(sql`
      SELECT source_entity_id AS id, COUNT(*) AS cnt
      FROM relationships
      WHERE relationship_type = 'PROPERTY_AREA_PEER'
      GROUP BY source_entity_id
      HAVING COUNT(*) BETWEEN 5 AND 80
      ORDER BY cnt DESC
      LIMIT 1
    `);
    const geoId = (geoRows as any).rows?.[0]?.id ?? (geoRows as any)[0]?.id;
    if (geoId) {
      res.json({ entityId: Number(geoId) });
      return;
    }

    // Fallback: any hub with 10–150 edges
    const fallbackRows = await db.execute<{ id: number; cnt: string }>(sql`
      SELECT from_e AS id, COUNT(*) AS cnt
      FROM (
        SELECT source_entity_id AS from_e FROM relationships
        UNION ALL
        SELECT target_id AS from_e FROM relationships WHERE target_type = 'Entity'
      ) t
      GROUP BY from_e
      HAVING COUNT(*) BETWEEN 10 AND 150
      ORDER BY cnt DESC
      LIMIT 1
    `);
    const fallbackId = (fallbackRows as any).rows?.[0]?.id ?? (fallbackRows as any)[0]?.id;
    res.json({ entityId: fallbackId ? Number(fallbackId) : 1 });
  } catch {
    res.json({ entityId: 1 });
  }
});

// GET /graph/entity/:id
router.get("/graph/entity/:id", async (req, res): Promise<void> => {
  const params = GetEntityGraphParams.safeParse(req.params);
  const query = GetEntityGraphQueryParams.safeParse(req.query);

  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const depth = query.success ? (query.data.depth ?? 2) : 2;
  const entityId = params.data.id;

  const [entity] = await db.select().from(entitiesTable).where(eq(entitiesTable.id, entityId));
  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }

  // Load full graph
  const [allEntities, allAssets, allRelationships] = await Promise.all([
    db.select().from(entitiesTable),
    db.select().from(assetsTable),
    db.select().from(relationshipsTable),
  ]);

  const graph = buildGraph(allEntities, allAssets, allRelationships);
  const centerVertexId = `e:${entityId}`;
  const { nodes: subNodes, edges: subEdges } = extractSubgraph(graph, centerVertexId, depth);

  // Compute centrality for this subgraph to mark hubs
  const centralityRanking = computeCentrality(graph);
  const topCentral = new Set(centralityRanking.slice(0, 5).map((c) => c.vertexId));

  // De-duplicate edges (forward + reverse)
  const seenEdgeIds = new Set<string>();
  const uniqueEdges: typeof subEdges = [];
  for (const e of subEdges) {
    const baseId = e.id.replace("_rev", "");
    if (!seenEdgeIds.has(baseId)) {
      seenEdgeIds.add(baseId);
      uniqueEdges.push(e);
    }
  }

  res.json({
    nodes: subNodes.map((v) => vertexToNode(v, topCentral, centerVertexId)),
    edges: uniqueEdges.map(arcToEdge),
    centralNodeId: centerVertexId,
    depth,
  });
});

// GET /graph/path
router.get("/graph/path", async (req, res): Promise<void> => {
  const parsed = GetConnectionPathQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { sourceId, targetId } = parsed.data;

  const [sourceEntity, targetEntity] = await Promise.all([
    db.select().from(entitiesTable).where(eq(entitiesTable.id, sourceId)).then((r) => r[0]),
    db.select().from(entitiesTable).where(eq(entitiesTable.id, targetId)).then((r) => r[0]),
  ]);

  if (!sourceEntity || !targetEntity) {
    res.status(404).json({ error: "One or both entities not found" });
    return;
  }

  const [allEntities, allAssets, allRelationships] = await Promise.all([
    db.select().from(entitiesTable),
    db.select().from(assetsTable),
    db.select().from(relationshipsTable),
  ]);

  const graph = buildGraph(allEntities, allAssets, allRelationships);
  const sourceVId = `e:${sourceId}`;
  const targetVId = `e:${targetId}`;

  const pathResult = findShortestPath(graph, sourceVId, targetVId);

  if (!pathResult) {
    res.json({
      found: false,
      path: [],
      edges: [],
      hops: 0,
      pathScore: null,
      recommendation: "No direct connection path found. Consider expanding the entity registry or running Hybrid Research to discover indirect routes via asset cross-ownership.",
    });
    return;
  }

  const centralityRanking = computeCentrality(graph);
  const topCentral = new Set(centralityRanking.slice(0, 5).map((c) => c.vertexId));

  const pathNodes = pathResult.path
    .map((vId) => graph.vertices.get(vId))
    .filter((v): v is GraphVertex => v !== undefined)
    .map((v) => vertexToNode(v, topCentral, targetVId));

  const pathEdges = pathResult.arcs.map(arcToEdge);

  // Calculate path score: deterministic — weighted by hops only. No random noise.
  const hops = pathResult.path.length - 1;
  const pathScore = Math.max(0.1, 1 - hops * 0.15);

  // Build recommendation
  const gatekeeperNode = pathNodes.find((n) => n.nodeType === "Gatekeeper");
  const recommendation = gatekeeperNode
    ? `Optimal path via ${gatekeeperNode.label}. Approach vector: ${
        gatekeeperNode.nodeType === "Gatekeeper"
          ? "WhatsApp/Email with referral commission offer (5%)"
          : "Professional introduction"
      }. Path confidence: ${(pathScore * 100).toFixed(0)}%.`
    : `${hops}-hop path identified. Run Hybrid Research for gatekeeper identification and optimal approach strategy.`;

  res.json({
    found: true,
    path: pathNodes,
    edges: pathEdges,
    hops,
    pathScore: parseFloat(pathScore.toFixed(3)),
    recommendation,
  });
});

export default router;
