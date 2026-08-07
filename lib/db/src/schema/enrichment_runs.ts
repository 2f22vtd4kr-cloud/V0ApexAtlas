/**
 * enrichment_runs — J0 Measurement Contract
 *
 * Stores per-run funnel metrics for every enrichment pass so we can answer
 * "where did candidates disappear?" across passes and re-imports.
 *
 * Phase J0 gate: a full enrichment run reports direct, social, organization,
 * and evidence-only outcomes separately.
 */

import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const enrichmentRunsTable = pgTable("enrichment_runs", {
  id:                  serial("id").primaryKey(),
  startedAt:           timestamp("started_at",  { withTimezone: true }).notNull().defaultNow(),
  finishedAt:          timestamp("finished_at", { withTimezone: true }),
  /** enricher name: "in-house-enrich" | "social-discovery" | "messenger-discovery" | "web-osint" | "foundation-filings" | "deep-web-osint" */
  source:              text("source").notNull(),
  /** Phase J pass name, e.g. identity, domain, direct-contact, retry. */
  pass:                text("pass"),
  cohort:              text("cohort"),
  /** how many entities were selected for this pass */
  totalSelected:       integer("total_selected").notNull().default(0),
  /** how many produced any result (evidence or contact) */
  totalFound:          integer("total_found").notNull().default(0),
  /** how many were persisted to the DB */
  totalPersisted:      integer("total_persisted").notNull().default(0),
  /** direct_contact_candidate or direct_contact_verified outcomes */
  directConfirmed:     integer("direct_confirmed").notNull().default(0),
  directVerified:      integer("direct_verified").notNull().default(0),
  identityResolved:    integer("identity_resolved").notNull().default(0),
  domainResolved:      integer("domain_resolved").notNull().default(0),
  candidateValidated:  integer("candidate_validated").notNull().default(0),
  candidateAttributed: integer("candidate_attributed").notNull().default(0),
  /** social_only outcomes (LinkedIn/Twitter/Telegram without email/phone) */
  socialOnly:          integer("social_only").notNull().default(0),
  /** evidence_only outcomes (website/address/filing, no contact) */
  evidenceOnly:        integer("evidence_only").notNull().default(0),
  /** organization_contact outcomes (company inbox / switchboard) */
  organizationContact: integer("organization_contact").notNull().default(0),
  /** errors / timeouts */
  errors:              integer("errors").notNull().default(0),
  /** JSON: { faa: {direct:n, social:n, evidence:n}, edgar: {...}, ... } */
  byRegistry:          text("by_registry"),
  /** JSON: { HNWI: {direct:n, social:n}, Corporation: {...}, ... } */
  byEntityType:        text("by_entity_type"),
  durationMs:          integer("duration_ms"),
  notes:               text("notes"),
});

export type EnrichmentRun       = typeof enrichmentRunsTable.$inferSelect;
export type InsertEnrichmentRun = typeof enrichmentRunsTable.$inferInsert;
