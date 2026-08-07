import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

export const improvementLogsTable = pgTable("improvement_logs", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id")
    .notNull()
    .references(() => entitiesTable.id, { onDelete: "cascade" }),
  persona: text("persona").notNull(),
  // 'data_engineer' | 'data_analyst' | 'intel_systems_analyst' | 'business_engineer' | 'ux_designer' | 'architect'
  category: text("category").notNull(),
  // 'data_quality' | 'scoring' | 'outreach' | 'structure' | 'display' | 'classification'
  priority: text("priority").notNull().default("medium"),
  // 'high' | 'medium' | 'low'
  title: text("title").notNull(),
  description: text("description").notNull(),
  actionTaken: text("action_taken"),  // concrete action applied / proposed
  status: text("status").notNull().default("pending"),
  // 'pending' | 'applied' | 'dismissed'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertImprovementLogSchema = createInsertSchema(improvementLogsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertImprovementLog = z.infer<typeof insertImprovementLogSchema>;
export type ImprovementLog = typeof improvementLogsTable.$inferSelect;
