/**
 * N4 — Entity Deduplication Reviews
 *
 * Persists reviewer decisions for cross-registry entity pairs that share name tokens.
 * "dismissed" — the reviewer confirmed these are different people/companies.
 * "merged"    — the reviewer merged them; keepEntityId is the surviving record.
 *
 * Pair key is always stored as (lower id, higher id) so both orderings map to
 * the same row.
 */

import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { entitiesTable } from "./entities";

export const dedupReviewsTable = pgTable("dedup_reviews", {
  id: serial("id").primaryKey(),
  entityAId: integer("entity_a_id").notNull().references(() => entitiesTable.id, { onDelete: "cascade" }),
  entityBId: integer("entity_b_id").notNull().references(() => entitiesTable.id, { onDelete: "cascade" }),
  /** "dismissed" | "merged" */
  decision: text("decision").notNull(),
  /** Populated when decision = "merged"; the entity that survives. */
  keepEntityId: integer("keep_entity_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pairUnique: uniqueIndex("dedup_reviews_entity_pair_unique").on(table.entityAId, table.entityBId),
}));

export type DedupReview = typeof dedupReviewsTable.$inferSelect;
export type InsertDedupReview = typeof dedupReviewsTable.$inferInsert;
