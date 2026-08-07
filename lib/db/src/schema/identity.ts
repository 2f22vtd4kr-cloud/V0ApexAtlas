import { pgTable, serial, integer, text, doublePrecision, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Phase J3 identity bundles and review-only links.
 *
 * Identity evidence is deliberately separate from contact vectors. A match
 * must be reviewed before it can be used to attribute a person or company.
 */
export const identityBundlesTable = pgTable("identity_bundles", {
  id: serial("id").primaryKey(),
  entityId: integer("entity_id").notNull().unique(),
  normalizedName: text("normalized_name").notNull(),
  variants: text("variants").notNull().default("[]"),
  registryIdentifiers: text("registry_identifiers").notNull().default("[]"),
  affiliations: text("affiliations").notNull().default("[]"),
  location: text("location"),
  publicAddress: text("public_address"),
  assetIdentifiers: text("asset_identifiers").notNull().default("[]"),
  publicProfileUrls: text("public_profile_urls").notNull().default("[]"),
  provenance: text("provenance").notNull().default("[]"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const identityCandidatesTable = pgTable(
  "identity_candidates",
  {
    id: serial("id").primaryKey(),
    entityId: integer("entity_id").notNull(),
    candidateEntityId: integer("candidate_entity_id").notNull(),
    candidateName: text("candidate_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    matchScore: doublePrecision("match_score").notNull(),
    matchSignals: text("match_signals").notNull().default("[]"),
    sourceEvidence: text("source_evidence").notNull().default("[]"),
    status: text("status").notNull().default("pending"),
    identityDecision: text("identity_decision").notNull().default("review"),
    gateReason: text("gate_reason"),
    reviewerNote: text("reviewer_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entityPairUnique: uniqueIndex("identity_candidates_entity_pair_unique").on(
      table.entityId,
      table.candidateEntityId,
    ),
  }),
);

export type IdentityBundle = typeof identityBundlesTable.$inferSelect;
export type IdentityCandidate = typeof identityCandidatesTable.$inferSelect;