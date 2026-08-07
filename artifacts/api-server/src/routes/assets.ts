import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, assetsTable, entitiesTable } from "@workspace/db";
import {
  ListAssetsQueryParams,
  CreateAssetBody,
  GetAssetParams,
  UpdateAssetParams,
  UpdateAssetBody,
  DeleteAssetParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// GET /assets
router.get("/assets", async (req, res): Promise<void> => {
  const parsed = ListAssetsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { category, entityId } = parsed.data;

  const conditions = [];
  if (category) conditions.push(eq(assetsTable.category, category));
  if (entityId !== undefined) conditions.push(eq(assetsTable.ownerEntityId, entityId));

  const rows = await db
    .select({
      asset: assetsTable,
      ownerName: entitiesTable.name,
    })
    .from(assetsTable)
    .leftJoin(entitiesTable, eq(assetsTable.ownerEntityId, entitiesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(assetsTable.createdAt);

  const assets = rows.map(({ asset, ownerName }) => ({
    ...asset,
    ownerName: ownerName ?? null,
    createdAt: asset.createdAt.toISOString(),
  }));

  res.json(assets);
});

// POST /assets
router.post("/assets", async (req, res): Promise<void> => {
  const parsed = CreateAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [asset] = await db.insert(assetsTable).values(parsed.data).returning();
  res.status(201).json({ ...asset!, ownerName: null, createdAt: asset!.createdAt.toISOString() });
});

// GET /assets/:id
router.get("/assets/:id", async (req, res): Promise<void> => {
  const params = GetAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [row] = await db
    .select({ asset: assetsTable, ownerName: entitiesTable.name })
    .from(assetsTable)
    .leftJoin(entitiesTable, eq(assetsTable.ownerEntityId, entitiesTable.id))
    .where(eq(assetsTable.id, params.data.id));

  if (!row) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  res.json({ ...row.asset, ownerName: row.ownerName ?? null, createdAt: row.asset.createdAt.toISOString() });
});

// PATCH /assets/:id
router.patch("/assets/:id", async (req, res): Promise<void> => {
  const params = UpdateAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateAssetBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [asset] = await db
    .update(assetsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(assetsTable.id, params.data.id))
    .returning();

  if (!asset) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  res.json({ ...asset, ownerName: null, createdAt: asset.createdAt.toISOString() });
});

// DELETE /assets/:id
router.delete("/assets/:id", async (req, res): Promise<void> => {
  const params = DeleteAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(assetsTable)
    .where(eq(assetsTable.id, params.data.id))
    .returning({ id: assetsTable.id });

  if (!deleted) {
    res.status(404).json({ error: "Asset not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
