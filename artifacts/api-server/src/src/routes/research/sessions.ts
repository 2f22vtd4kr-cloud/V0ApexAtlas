import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db, entitiesTable, contactEvidenceTable, researchEvidenceTable, researchRunEventsTable, researchSessionsTable } from "@workspace/db";
import {
  ListResearchSessionsQueryParams,
  GetResearchSessionParams,
} from "@workspace/api-zod";
import { deriveIntroPathCandidate } from "../../lib/intro-path-candidate";

const router = Router();

// GET /research/intro-path/:entityId
// Returns at most one review-only route from durable evidence. This never
// promotes an entity contact field and never sends or schedules outreach.
router.get("/research/intro-path/:entityId", async (req, res): Promise<void> => {
  const entityId = Number(req.params.entityId);
  if (!Number.isInteger(entityId) || entityId <= 0) {
    res.status(400).json({ error: "Invalid entity ID" });
    return;
  }
  const [entity] = await db.select({
    id: entitiesTable.id,
    name: entitiesTable.name,
    type: entitiesTable.type,
  }).from(entitiesTable).where(eq(entitiesTable.id, entityId));
  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  const evidence = await db.select({
    vectorType: contactEvidenceTable.vectorType,
    value: contactEvidenceTable.value,
    source: contactEvidenceTable.source,
    sourceUrl: contactEvidenceTable.sourceUrl,
    validationStatus: contactEvidenceTable.validationStatus,
    metadata: contactEvidenceTable.metadata,
  }).from(contactEvidenceTable).where(eq(contactEvidenceTable.entityId, entityId));
  res.json({
    targetEntityId: entityId,
    candidate: deriveIntroPathCandidate(entity, evidence),
  });
});

function candidateFunnelFromMetadata(metadata: string | null | undefined): unknown {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return parsed.deepWebCandidateFunnel ?? null;
  } catch {
    return null;
  }
}

function investigatorResearchPlanFromMetadata(metadata: string | null | undefined): unknown {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return parsed.investigatorResearchPlan ?? null;
  } catch {
    return null;
  }
}

function routeHierarchyFromMetadata(metadata: string | null | undefined): unknown {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return parsed.routeHierarchy ?? null;
  } catch {
    return null;
  }
}

// GET /research/sessions
router.get("/research/sessions", async (req, res): Promise<void> => {
  const parsed = ListResearchSessionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { entityId, status, limit = 50 } = parsed.data;

  const rows = await db
    .select({ session: researchSessionsTable, entityName: entitiesTable.name, entityMetadata: entitiesTable.metadata })
    .from(researchSessionsTable)
    .leftJoin(entitiesTable, eq(researchSessionsTable.targetEntityId, entitiesTable.id))
    .orderBy(desc(researchSessionsTable.createdAt))
    .limit(limit);

  const sessions = rows
    .filter((r) => {
      if (entityId && r.session.targetEntityId !== entityId) return false;
      if (status && status !== "research_review") return false;
      return true;
    })
    .map(({ session, entityName, entityMetadata }) => ({
      ...session,
      targetEntityName: entityName ?? null,
      candidateFunnel: candidateFunnelFromMetadata(entityMetadata),
      investigatorResearchPlan: investigatorResearchPlanFromMetadata(entityMetadata),
      routeHierarchy: routeHierarchyFromMetadata(entityMetadata),
      createdAt: session.createdAt.toISOString(),
      researchStatus: "research_review",
    }));

  res.json(sessions);
});

// GET /research/sessions/:id
router.get("/research/sessions/:id", async (req, res): Promise<void> => {
  const params = GetResearchSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select({ session: researchSessionsTable, entityName: entitiesTable.name, entityMetadata: entitiesTable.metadata })
    .from(researchSessionsTable)
    .leftJoin(entitiesTable, eq(researchSessionsTable.targetEntityId, entitiesTable.id))
    .where(eq(researchSessionsTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: "Research session not found" });
    return;
  }

  res.json({
    ...row.session,
    targetEntityName: row.entityName ?? null,
    candidateFunnel: candidateFunnelFromMetadata(row.entityMetadata),
    investigatorResearchPlan: investigatorResearchPlanFromMetadata(row.entityMetadata),
    routeHierarchy: routeHierarchyFromMetadata(row.entityMetadata),
    createdAt: row.session.createdAt.toISOString(),
    researchStatus: "research_review",
  });
});

// GET /research/sessions/:id/evidence
router.get("/research/sessions/:id/evidence", async (req, res): Promise<void> => {
  const params = GetResearchSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [session] = await db
    .select({ id: researchSessionsTable.id })
    .from(researchSessionsTable)
    .where(eq(researchSessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Research session not found" });
    return;
  }

  const rows = await db
    .select()
    .from(researchEvidenceTable)
    .where(eq(researchEvidenceTable.sessionId, params.data.id))
    .orderBy(desc(researchEvidenceTable.createdAt));

  res.json(rows.map((row) => ({
    ...row,
    observedAt: row.observedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    validFrom: row.validFrom?.toISOString() ?? null,
    validTo: row.validTo?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  })));
});

// GET /research/sessions/:id/audit
router.get("/research/sessions/:id/audit", async (req, res): Promise<void> => {
  const params = GetResearchSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [session] = await db
    .select({ id: researchSessionsTable.id })
    .from(researchSessionsTable)
    .where(eq(researchSessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Research session not found" });
    return;
  }
  const rows = await db
    .select()
    .from(researchRunEventsTable)
    .where(eq(researchRunEventsTable.sessionId, params.data.id))
    .orderBy(desc(researchRunEventsTable.createdAt));
  res.json(rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  })));
});

export default router;
