import { pgTable, serial, integer, text, doublePrecision, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { entitiesTable } from "./entities";
import { enrichmentRunsTable } from "./enrichment_runs";

/**
 * Durable Phase J evidence. Values are normalized contact/domain candidates,
 * never raw page dumps. This makes every promotion auditable.
 */
export const contactEvidenceTable = pgTable("contact_evidence", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id").notNull().references(() => entitiesTable.id, { onDelete: "cascade" }),
  runId: integer("run_id").references(() => enrichmentRunsTable.id, { onDelete: "set null" }),
  vectorType: text("vector_type").notNull(), // email | phone | social | domain | website | address
  value: text("value").notNull(),
  source: text("source").notNull(),
  sourceUrl: text("source_url"),
  extractionMethod: text("extraction_method"),
  sourceReliability: doublePrecision("source_reliability").notNull().default(0),
  identityMatch: doublePrecision("identity_match").notNull().default(0),
  recencyScore: doublePrecision("recency_score").notNull().default(0),
  directnessScore: doublePrecision("directness_score").notNull().default(0),
  independentCorroboration: integer("independent_corroboration").notNull().default(0),
  validationStatus: text("validation_status").notNull().default("candidate"), // candidate | verified | rejected
  rejectionReason: text("rejection_reason"),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: text("metadata").notNull().default("{}"),
}, (table) => ({
  evidenceUnique: uniqueIndex("contact_evidence_entity_vector_unique").on(
    table.entityId, table.vectorType, table.value, table.source,
  ),
}));

/**
 * Per-entity scheduler state. A missing row means the entity has never entered
 * a Phase J pass; state survives imports and server restarts.
 */
export const enrichmentStateTable = pgTable("enrichment_state", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id").notNull().unique().references(() => entitiesTable.id, { onDelete: "cascade" }),
  passNumber: integer("pass_number").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  successfulPasses: integer("successful_passes").notNull().default(0),
  lastPass: text("last_pass"),
  lastSource: text("last_source"),
  lastOutcome: text("last_outcome"),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  retryReason: text("retry_reason"),
  sourceCooldowns: text("source_cooldowns").notNull().default("{}"),
  graphContext: text("graph_context").notNull().default("[]"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Re-import and canary snapshots used to compare cohort quality over time. */
export const phaseJCheckpointsTable = pgTable("phase_j_checkpoints", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  cohort: text("cohort").notNull().default("all"),
  totalEntities: integer("total_entities").notNull().default(0),
  directCandidate: integer("direct_candidate").notNull().default(0),
  directVerified: integer("direct_verified").notNull().default(0),
  socialOnly: integer("social_only").notNull().default(0),
  organizationContact: integer("organization_contact").notNull().default(0),
  evidenceOnly: integer("evidence_only").notNull().default(0),
  noneCount: integer("none_count").notNull().default(0),
  byRegistry: text("by_registry").notNull().default("{}"),
  byEntityType: text("by_entity_type").notNull().default("{}"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContactEvidence = typeof contactEvidenceTable.$inferSelect;
export type EnrichmentState = typeof enrichmentStateTable.$inferSelect;
export type PhaseJCheckpoint = typeof phaseJCheckpointsTable.$inferSelect;