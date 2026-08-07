import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { researchSessionsTable } from "./research_sessions";

export const researchRunEventsTable = pgTable("research_run_events", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => researchSessionsTable.id, { onDelete: "cascade" }),
  phase: text("phase").notNull(),
  status: text("status").notNull(), // done | skipped | failed
  durationMs: integer("duration_ms").notNull().default(0),
  message: text("message").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertResearchRunEventSchema = createInsertSchema(researchRunEventsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertResearchRunEvent = z.infer<typeof insertResearchRunEventSchema>;
export type ResearchRunEvent = typeof researchRunEventsTable.$inferSelect;