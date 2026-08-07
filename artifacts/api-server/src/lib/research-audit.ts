import { db, researchRunEventsTable } from "@workspace/db";

export interface ResearchAuditStage {
  algo: string;
  contribution: string;
  status: string;
  durationMs?: number;
}

export async function recordResearchAudit(
  sessionId: number,
  stages: ResearchAuditStage[],
): Promise<void> {
  if (stages.length === 0) return;
  await db.insert(researchRunEventsTable).values(stages.map((stage) => ({
    sessionId,
    phase: stage.algo,
    status: ["done", "skipped", "failed"].includes(stage.status) ? stage.status : "done",
    durationMs: Math.max(0, Math.round(stage.durationMs ?? 0)),
    message: stage.contribution,
    metadata: JSON.stringify({ source: "research-pipeline" }),
  })));
}