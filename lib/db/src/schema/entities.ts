import { pgTable, serial, text, doublePrecision, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const entitiesTable = pgTable("entities", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'HNWI' | 'Corporation' | 'Trust' | 'Gatekeeper'
  bayesianScore: doublePrecision("bayesian_score").notNull().default(0.05),
  nationality: text("nationality"),
  estimatedNetWorth: doublePrecision("estimated_net_worth"),
  knownResidences: text("known_residences"), // JSON array stored as text
  linkedinUrl: text("linkedin_url"),
  linkedinHeadline: text("linkedin_headline"),
  twitterHandle: text("twitter_handle"),
  twitterBio: text("twitter_bio"),
  instagramHandle: text("instagram_handle"),
  telegramHandle: text("telegram_handle"),
  telegramBio: text("telegram_bio"),
  personalWebsite: text("personal_website"),
  foundationName: text("foundation_name"),
  phone: text("phone"),
  phoneSource: text("phone_source"),
  email: text("email"),
  contactMethod: text("contact_method"), // 'WhatsApp' | 'Email' | 'LinkedIn' | 'Signal'
  notes: text("notes"),
  sourceRegistries: text("source_registries"), // JSON array stored as text
  metadata: text("metadata"), // JSON blob
  isHot: boolean("is_hot").notNull().default(false),
  isStarred: boolean("is_starred").notNull().default(false),
  isHidden: boolean("is_hidden").notNull().default(false),
  contactConfidence: integer("contact_confidence").notNull().default(0),
  /**
   * J0 Measurement Contract — outcome label set by every enricher after each pass.
   *
   * "none"                   — not yet enriched / no evidence found
   * "evidence_only"          — website, address, filing, or org record only
   * "social_only"            — LinkedIn/Twitter/Instagram/Telegram found, no email/phone
   * "organization_contact"   — company phone/inbox/contact-page (not personal)
   * "direct_contact_candidate" — person-level email or phone (public evidence, not fully verified)
   * "direct_contact_verified"  — validated person-level contact with attribution
   *
   * J1 rule: only direct_contact_candidate/verified are terminal enrichment states.
   * social_only and evidence_only remain eligible for follow-up passes.
   */
  contactOutcome: text("contact_outcome"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  /**
   * Timestamp set when this entity has completed all full-circle enrichment phases.
   * NULL = not yet fully processed. Non-null = "cooked" — ready for outreach.
   */
  cookedAt: timestamp("cooked_at", { withTimezone: true }),
});

export const insertEntitySchema = createInsertSchema(entitiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEntity = z.infer<typeof insertEntitySchema>;
export type Entity = typeof entitiesTable.$inferSelect;
