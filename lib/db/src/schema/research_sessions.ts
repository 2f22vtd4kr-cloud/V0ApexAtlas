import { pgTable, serial, text, doublePrecision, integer, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

export const researchSessionsTable = pgTable("research_sessions", {
  id: serial("id").primaryKey(),
  targetEntityId: integer("target_entity_id")
    .notNull()
    .references(() => entitiesTable.id, { onDelete: "cascade" }),
  winningPath: text("winning_path"), // JSON: array of path step objects
  mctsSteps: text("mcts_steps"), // JSON: array of MCTS reasoning steps shown in terminal
  generatedPitch: text("generated_pitch"), // full outreach pitch text
  safeUseStatus: text("safe_use_status").notNull().default("manual_review"),
  safeUseReviewedAt: timestamp("safe_use_reviewed_at", { withTimezone: true }),
  safeUseNote: text("safe_use_note"),
  crmStatus: text("crm_status").notNull().default("Lead Gen"),
  // 'Lead Gen' | 'Identified' | 'Graph Mapped' | 'MCTS Path Selected'
  // | 'Pitch Generated' | 'Contacted' | 'Follow-Up' | 'Closed'
  lastContactDate: date("last_contact_date", { mode: "string" }),
  followUpDate: date("follow_up_date", { mode: "string" }),
  notes: text("notes"),
  bayesianScoreAtRuntime: doublePrecision("bayesian_score_at_runtime"),
  pathScore: doublePrecision("path_score"), // MCTS UCT score of winning path
  identityScore: doublePrecision("identity_score"),
  ownershipScore: doublePrecision("ownership_score"),
  contactScore: doublePrecision("contact_score"),
  accessScore: doublePrecision("access_score"),
  wealthScore: doublePrecision("wealth_score"),
  freshnessScore: doublePrecision("freshness_score"),
  sourceQualityScore: doublePrecision("source_quality_score"),
  scoreBreakdown: text("score_breakdown"), // JSON: independent research scorecard
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertResearchSessionSchema = createInsertSchema(researchSessionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertResearchSession = z.infer<typeof insertResearchSessionSchema>;
export type ResearchSession = typeof researchSessionsTable.$inferSelect;
