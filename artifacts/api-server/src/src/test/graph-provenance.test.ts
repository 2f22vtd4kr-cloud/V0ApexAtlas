import { describe, expect, it } from "vitest";
import { buildGraph } from "../lib/graph-engine";

describe("graph provenance", () => {
  it("raises edge quality for cited verified relationships", () => {
    const graph = buildGraph(
      [
        { id: 1, name: "Target", type: "HNWI", bayesianScore: 0.8 },
        { id: 2, name: "Gatekeeper", type: "Gatekeeper", bayesianScore: 0.4 },
      ],
      [],
      [{
        id: 1,
        sourceEntityId: 1,
        targetId: 2,
        targetType: "Entity",
        relationshipType: "KNOWN_ASSOCIATE",
        strength: 0.7,
        notes: "Verified in official filing. Source: https://example.org/filing",
      }],
    );

    const arc = graph.adjacency.get("e:1")?.[0]?.arc;
    expect(arc?.evidenceStatus).toBe("supported");
    expect(arc?.citationCount).toBe(2);
    expect(arc?.provenanceScore).toBeGreaterThanOrEqual(0.9);
  });

  it("marks disputed edges and lowers their provenance score", () => {
    const graph = buildGraph(
      [
        { id: 1, name: "Target", type: "HNWI", bayesianScore: 0.8 },
        { id: 2, name: "Candidate", type: "HNWI", bayesianScore: 0.4 },
      ],
      [],
      [{
        id: 2,
        sourceEntityId: 1,
        targetId: 2,
        targetType: "Entity",
        relationshipType: "KNOWN_ASSOCIATE",
        strength: 0.9,
        notes: "Disputed and unverified.",
      }],
    );

    const arc = graph.adjacency.get("e:1")?.[0]?.arc;
    expect(arc?.evidenceStatus).toBe("disputed");
    expect(arc?.provenanceScore).toBeLessThan(0.3);
  });
});