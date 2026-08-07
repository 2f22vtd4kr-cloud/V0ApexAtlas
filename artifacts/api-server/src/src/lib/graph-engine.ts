/**
 * Graph Engine — in-memory entity/asset relationship graph
 * Uses adjacency maps to support BFS path finding, subgraph extraction,
 * and centrality analysis without external graph libraries.
 */

export interface GraphVertex {
  id: string; // "e:{id}" for entities, "a:{id}" for assets
  label: string;
  nodeType: string; // 'HNWI' | 'Corporation' | 'Trust' | 'Gatekeeper' | 'RealEstate' | 'Aviation' | 'Marine' | 'PrivateClub'
  bayesianScore?: number | null;
  estimatedValue?: number | null;
  nationality?: string | null;
  metadata?: string | null;
  contactConfidence?: number | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  phoneSource?: string | null;
  contactOutcome?: string | null;
}

export interface GraphArc {
  id: string;
  source: string;
  target: string;
  label: string;
  strength?: number | null;
  provenanceScore: number;
  citationCount: number;
  freshnessScore: number;
  evidenceStatus: "supported" | "review" | "disputed" | "rejected";
}

export interface InMemoryGraph {
  vertices: Map<string, GraphVertex>;
  adjacency: Map<string, Array<{ neighbor: string; arc: GraphArc }>>;
}

export interface EntityRow {
  id: number;
  name: string;
  type: string;
  bayesianScore: number;
  nationality?: string | null;
  estimatedNetWorth?: number | null;
  metadata?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactConfidence?: number | null;
  phoneSource?: string | null;
  contactOutcome?: string | null;
}

export interface AssetRow {
  id: number;
  category: string;
  identifier: string;
  jurisdiction: string;
  estimatedValue?: number | null;
  ownerEntityId?: number | null;
}

export interface RelationshipRow {
  id: number;
  sourceEntityId: number;
  targetId: number;
  targetType: string;
  relationshipType: string;
  strength?: number | null;
  notes?: string | null;
}

function deriveArcProvenance(relationship: RelationshipRow): Pick<GraphArc, "provenanceScore" | "citationCount" | "freshnessScore" | "evidenceStatus"> {
  const notes = relationship.notes ?? "";
  const citationCount = (notes.match(/https?:\/\/|source\s*:/gi) ?? []).length;
  const hasExplicitDispute = /disputed|rejected|unverified|not attributable/i.test(notes);
  const hasVerification = /verified|corroborat|official filing|registry/i.test(notes);
  const provenanceScore = hasExplicitDispute
    ? 0.15
    : Math.min(
        1,
        (relationship.strength ?? 0.35) +
          Math.min(0.3, citationCount * 0.1) +
          (hasVerification ? 0.2 : 0),
      );

  return {
    provenanceScore: Number(provenanceScore.toFixed(3)),
    citationCount,
    freshnessScore: /stale|historical|expired/i.test(notes) ? 0.2 : 0.7,
    evidenceStatus: hasExplicitDispute ? "disputed" : provenanceScore >= 0.7 ? "supported" : "review",
  };
}

function isIdentityRelationship(relationshipType: string): boolean {
  return /identity|same[_ -]?(person|company|entity)|duplicate/i.test(relationshipType);
}

export function identityPairKey(sourceEntityId: number, targetEntityId: number): string {
  return `${Math.min(sourceEntityId, targetEntityId)}:${Math.max(sourceEntityId, targetEntityId)}`;
}

export function buildGraph(
  entities: EntityRow[],
  assets: AssetRow[],
  relationships: RelationshipRow[],
  acceptedIdentityPairs: ReadonlySet<string> = new Set(),
): InMemoryGraph {
  const vertices = new Map<string, GraphVertex>();
  const adjacency = new Map<string, Array<{ neighbor: string; arc: GraphArc }>>();

  const addVertex = (v: GraphVertex) => {
    vertices.set(v.id, v);
    if (!adjacency.has(v.id)) adjacency.set(v.id, []);
  };

  const addArc = (arc: GraphArc) => {
    const list = adjacency.get(arc.source) ?? [];
    list.push({ neighbor: arc.target, arc });
    adjacency.set(arc.source, list);

    // Also add reverse edge for undirected traversal
    const revList = adjacency.get(arc.target) ?? [];
    revList.push({ neighbor: arc.source, arc: { ...arc, source: arc.target, target: arc.source, id: arc.id + "_rev" } });
    adjacency.set(arc.target, revList);
  };

  for (const e of entities) {
    addVertex({
      id: `e:${e.id}`,
      label: e.name,
      nodeType: e.type,
      bayesianScore: e.bayesianScore,
      nationality: e.nationality,
      estimatedValue: e.estimatedNetWorth,
      metadata: e.metadata,
      contactConfidence: e.contactConfidence,
      contactEmail: e.contactEmail,
      contactPhone: e.contactPhone,
      phoneSource: e.phoneSource,
      contactOutcome: e.contactOutcome,
    });
  }

  for (const a of assets) {
    addVertex({
      id: `a:${a.id}`,
      label: `${a.category}: ${a.identifier}`,
      nodeType: a.category,
      estimatedValue: a.estimatedValue,
    });
  }

  for (const r of relationships) {
    if (
      r.targetType === "Entity" &&
      isIdentityRelationship(r.relationshipType) &&
      !acceptedIdentityPairs.has(identityPairKey(r.sourceEntityId, r.targetId))
    ) continue;
    const sourceId = `e:${r.sourceEntityId}`;
    const targetId = r.targetType === "Asset" ? `a:${r.targetId}` : `e:${r.targetId}`;

    if (!adjacency.has(sourceId)) adjacency.set(sourceId, []);
    if (!adjacency.has(targetId)) adjacency.set(targetId, []);

    addArc({
      id: `r:${r.id}`,
      source: sourceId,
      target: targetId,
      label: r.relationshipType,
      strength: r.strength,
      ...deriveArcProvenance(r),
    });
  }

  return { vertices, adjacency };
}

/**
 * BFS shortest path from source to target.
 * Returns the vertex IDs along the path, or null if unreachable.
 */
export function findShortestPath(
  graph: InMemoryGraph,
  sourceVertexId: string,
  targetVertexId: string,
): { path: string[]; arcs: GraphArc[] } | null {
  if (!graph.vertices.has(sourceVertexId) || !graph.vertices.has(targetVertexId)) {
    return null;
  }
  if (sourceVertexId === targetVertexId) {
    return { path: [sourceVertexId], arcs: [] };
  }

  const visited = new Set<string>([sourceVertexId]);
  const queue: Array<{ id: string; path: string[]; arcs: GraphArc[] }> = [
    { id: sourceVertexId, path: [sourceVertexId], arcs: [] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = graph.adjacency.get(current.id) ?? [];

    for (const { neighbor, arc } of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      const newPath = [...current.path, neighbor];
      const newArcs = [...current.arcs, arc];

      if (neighbor === targetVertexId) {
        return { path: newPath, arcs: newArcs };
      }
      queue.push({ id: neighbor, path: newPath, arcs: newArcs });
    }
  }

  return null;
}

/**
 * Extract subgraph up to `depth` hops from a given entity vertex.
 */
export function extractSubgraph(
  graph: InMemoryGraph,
  centerVertexId: string,
  depth: number,
): { nodes: GraphVertex[]; edges: GraphArc[] } {
  const visited = new Map<string, number>(); // id -> depth reached
  const arcsSeen = new Set<string>();
  const resultEdges: GraphArc[] = [];

  const queue: Array<{ id: string; d: number }> = [{ id: centerVertexId, d: 0 }];
  visited.set(centerVertexId, 0);

  while (queue.length > 0) {
    const { id, d } = queue.shift()!;
    if (d >= depth) continue;

    const neighbors = graph.adjacency.get(id) ?? [];
    for (const { neighbor, arc } of neighbors) {
      // De-duplicate arcs (we add both directions)
      const baseArcId = arc.id.replace("_rev", "");
      if (!arcsSeen.has(baseArcId)) {
        arcsSeen.add(baseArcId);
        resultEdges.push(arc);
      }

      if (!visited.has(neighbor)) {
        visited.set(neighbor, d + 1);
        queue.push({ id: neighbor, d: d + 1 });
      }
    }
  }

  const nodes = [...visited.keys()]
    .map((id) => graph.vertices.get(id))
    .filter((v): v is GraphVertex => v !== undefined);

  return { nodes, edges: resultEdges };
}

/**
 * Compute degree centrality for each vertex.
 * Returns top N central vertices (potential gatekeepers).
 */
export function computeCentrality(
  graph: InMemoryGraph,
): Array<{ vertexId: string; degree: number }> {
  const degrees: Array<{ vertexId: string; degree: number }> = [];

  for (const [id, neighbors] of graph.adjacency.entries()) {
    // Deduplicate reverse edges
    const uniqueNeighbors = new Set(neighbors.map((n) => n.neighbor));
    degrees.push({ vertexId: id, degree: uniqueNeighbors.size });
  }

  return degrees.sort((a, b) => b.degree - a.degree);
}

/**
 * Identify entities that serve as central "gatekeeper" hubs.
 * These are typically geometri, lawyers, wealth managers, club secretaries.
 */
export function identifyGatekeepers(
  graph: InMemoryGraph,
  entities: EntityRow[],
  topN = 5,
): string[] {
  const central = computeCentrality(graph);
  const gatekeeperSet = new Set(
    entities.filter((e) => e.type === "Gatekeeper").map((e) => `e:${e.id}`),
  );

  const candidates = central
    .filter((c) => c.vertexId.startsWith("e:"))
    .filter((c) => gatekeeperSet.has(c.vertexId) || c.degree >= 2)
    .slice(0, topN)
    .map((c) => c.vertexId);

  return candidates;
}
