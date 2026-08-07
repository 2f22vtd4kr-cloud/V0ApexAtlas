import { pgTable, serial, text, doublePrecision, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { entitiesTable } from "./entities";

export const relationshipsTable = pgTable("relationships", {
  id: serial("id").primaryKey(),
  sourceEntityId: integer("source_entity_id")
    .notNull()
    .references(() => entitiesTable.id, { onDelete: "cascade" }),
  targetId: integer("target_id").notNull(), // can reference entities or assets
  targetType: text("target_type").notNull(), // 'Entity' | 'Asset'
  relationshipType: text("relationship_type").notNull(),
  // 'OWNS' | 'MANAGES' | 'BOARD_MEMBER_OF' | 'GEOMETRA_FOR' | 'MEMBER_OF'
  // | 'SHARES_GATEKEEPER' | 'KNOWN_ASSOCIATE' | 'FAMILY_OF' | 'NOMINEE_OF'
  strength: doublePrecision("strength"), // 0-1 confidence score
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRelationshipSchema = createInsertSchema(relationshipsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertRelationship = z.infer<typeof insertRelationshipSchema>;
export type Relationship = typeof relationshipsTable.$inferSelect;
