import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { researchCasesTable } from "./research_cases";

/** Append-only decisions, assignments, tool observations, and human directives. */
export const researchCaseEventsTable = pgTable("research_case_events", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id")
    .notNull()
    .references(() => researchCasesTable.id, { onDelete: "cascade" }),
  iteration: integer("iteration").notNull().default(0),
  actorRole: text("actor_role").notNull(), // head_investigator | specialist | human_operator | system
  eventType: text("event_type").notNull(), // case_opened | decision | assignment | observation | directive | status
  status: text("status").notNull().default("recorded"),
  summary: text("summary").notNull(),
  payload: text("payload").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertResearchCaseEventSchema = createInsertSchema(researchCaseEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertResearchCaseEvent = z.infer<typeof insertResearchCaseEventSchema>;
export type ResearchCaseEvent = typeof researchCaseEventsTable.$inferSelect;