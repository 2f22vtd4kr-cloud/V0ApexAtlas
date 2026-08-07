import { and, eq } from "drizzle-orm";
import { db, assetsTable } from "@workspace/db";

type BusinessEntity = {
  id: number;
  name: string;
  type: string;
  sourceRegistries?: string | null;
  metadata?: string | null;
};

const BUSINESS_WORDS = /\b(air|aviation|capital|energy|finance|financial|group|holdings?|hotel|investments?|partners?|shipping|ventures?|wealth|industr(?:y|ies)|logistics|properties|technolog(?:y|ies)|foods?|health|media|retail|resources?)\b/i;
const PLACEHOLDER_NAME = /^(unknown|n\/a|none|null|test|undefined)$/i;

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Treat a confirmed operating company as an asset without conflating it with
 * a person's aircraft, property, marine, or other personal wealth evidence.
 * The owner/category check makes this safe to call after every Atlas target.
 */
export async function materializeBusinessAsset(entity: BusinessEntity): Promise<boolean> {
  if (PLACEHOLDER_NAME.test(entity.name.trim())) return false;

  const sources = parseJson<string[]>(entity.sourceRegistries, []);
  const metadata = parseJson<Record<string, unknown>>(entity.metadata, {});
  const isBusinessEntity = entity.type === "Corporation";
  const isBusinessShapedPerson =
    entity.type === "HNWI" &&
    BUSINESS_WORDS.test(entity.name) &&
    (sources.length > 0 || Boolean(metadata.companyName || metadata.companyNumber || metadata.registryId));
  if (!isBusinessEntity && !isBusinessShapedPerson) return false;

  const [existing] = await db
    .select({ id: assetsTable.id })
    .from(assetsTable)
    .where(and(
      eq(assetsTable.ownerEntityId, entity.id),
      eq(assetsTable.category, "BusinessInterest"),
    ))
    .limit(1);
  if (existing) return false;

  await db.insert(assetsTable).values({
    category: "BusinessInterest",
    identifier: `BUSINESS-${entity.id}`,
    jurisdiction: typeof metadata.jurisdiction === "string" ? metadata.jurisdiction : "Entity record",
    description: `Operating business or corporate interest represented by ${entity.name}. This ledger item is separate from personal wealth assets.`,
    sourceRegistry: typeof metadata.registryId === "string" ? metadata.registryId : (sources[0] ?? "Public entity record"),
    ownerEntityId: entity.id,
    metadata: JSON.stringify({ kind: "entity_business", entityType: entity.type, evidenceSource: sources }),
  });
  return true;
}