import { pgTable, serial, integer, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";
import { researchSessionsTable } from "./research_sessions";

/**
 * Claim-level evidence produced during a research run.
 *
 * This is intentionally separate from contact_evidence: a research claim can
 * support or dispute an approach path without being a promoted contact vector.
 */
export const researchEvidenceTable = pgTable("research_evidence", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => researchSessionsTable.id, { onDelete: "cascade" }),
  entityId: integer("entity_id")
    .notNull()
    .references(() => entitiesTable.id, { onDelete: "cascade" }),
  claimType: text("claim_type").notNull(), // identity | relationship | access | asset | process
  claim: text("claim").notNull(),
  value: text("value"),
  sourceName: text("source_name"),
  sourceUrl: text("source_url"),
  sourceDomain: text("source_domain"),
  status: text("status").notNull().default("review"), // supported | review | disputed
  confidence: doublePrecision("confidence").notNull().default(0),
  rejectionReason: text("rejection_reason"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validTo: timestamp("valid_to", { withTimezone: true }),
  freshnessScore: doublePrecision("freshness_score").notNull().default(0),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertResearchEvidenceSchema = createInsertSchema(researchEvidenceTable).omit({
  id: true,
  createdAt: true,
});

export type InsertResearchEvidence = z.infer<typeof insertResearchEvidenceSchema>;
export type ResearchEvidence = typeof researchEvidenceTable.$inferSelect;