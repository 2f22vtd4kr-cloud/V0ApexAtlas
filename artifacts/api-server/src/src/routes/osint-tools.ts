/**
 * OSINT Tools Directory — Phase G5
 *
 * Serves the tomvaillant/osint-tool-database from Hugging Face Datasets.
 * 12,500+ categorised OSINT tools across 21 categories.
 *
 * GET /api/osint-tools          — paginated tool list (q, category, page, pageSize)
 * GET /api/osint-tools/categories — all category names + counts
 *
 * Data is fetched from the HuggingFace Datasets Server API and cached in Redis for 24h.
 * Falls back to an empty list gracefully if the HF API is unavailable.
 */

import { Router, type Request, type Response } from "express";
import { getCache, setCache } from "../lib/redis";

const router = Router();

const HF_DATASET = "tomvaillant/osint-tool-database";
const HF_API_BASE = "https://datasets-server.huggingface.co";
const CACHE_KEY = "osint-tools:v2:all";
const CACHE_TTL = 60 * 60 * 24; // 24 hours

interface OsintTool {
  tool_name: string;
  tool_url: string;
  category: string;
  short_description: string;
}

/** Fetch all rows from the HF dataset (paginated 100 at a time). */
async function fetchAllTools(): Promise<OsintTool[]> {
  const tools: OsintTool[] = [];
  const pageSize = 100;
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const url = `${HF_API_BASE}/rows?dataset=${encodeURIComponent(HF_DATASET)}&config=default&split=train&offset=${offset}&length=${pageSize}`;

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "ApexFinder/1.0 OSINT-Intelligence-Platform",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      console.warn(`[osint-tools] HF API ${resp.status} at offset ${offset}`);
      break;
    }

    const data = await resp.json() as {
      rows: Array<{ row: OsintTool }>;
      num_rows_total: number;
    };

    total = data.num_rows_total ?? 0;
    for (const item of data.rows ?? []) {
      if (item.row) tools.push(item.row);
    }

    offset += pageSize;

    // Safety cap at 15,000 rows
    if (tools.length >= 15_000) break;
  }

  return tools;
}

/** Return cached tools or fetch fresh from HF. */
async function getTools(): Promise<OsintTool[]> {
  // Try Redis cache first
  try {
    const cached = await getCache<string>(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as OsintTool[];
    }
  } catch { /* Redis miss — continue */ }

  // Fetch from HF
  let tools: OsintTool[] = [];
  try {
    tools = await fetchAllTools();
    if (tools.length > 0) {
      await setCache(CACHE_KEY, JSON.stringify(tools), CACHE_TTL);
    }
  } catch (err) {
    console.warn("[osint-tools] HF fetch failed:", (err as Error).message);
  }

  return tools;
}

// ── GET /api/osint-tools ──────────────────────────────────────────────────────

router.get("/osint-tools", async (req: Request, res: Response): Promise<void> => {
  try {
    const q          = ((req.query["q"] as string) ?? "").toLowerCase().trim();
    const category   = ((req.query["category"] as string) ?? "").toLowerCase().trim();
    const page       = Math.max(1, parseInt((req.query["page"] as string) ?? "1", 10));
    const pageSize   = Math.min(100, Math.max(1, parseInt((req.query["pageSize"] as string) ?? "50", 10)));

    const tools = await getTools();

    let filtered = tools;
    if (category) {
      filtered = filtered.filter((t) => t.category.toLowerCase() === category);
    }
    if (q) {
      filtered = filtered.filter(
        (t) =>
          t.tool_name.toLowerCase().includes(q) ||
          t.short_description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q),
      );
    }

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const items = filtered.slice(start, start + pageSize);

    res.json({
      tools: items,
      total,
      page,
      pageSize,
      pages: Math.ceil(total / pageSize),
      categories: [...new Set(tools.map((t) => t.category))].sort(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/osint-tools/categories ──────────────────────────────────────────

router.get("/osint-tools/categories", async (_req: Request, res: Response): Promise<void> => {
  try {
    const tools = await getTools();
    const counts: Record<string, number> = {};
    for (const t of tools) {
      counts[t.category] = (counts[t.category] ?? 0) + 1;
    }
    const categories = Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ categories, total: tools.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/osint-tools/status ───────────────────────────────────────────────

router.get("/osint-tools/status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const cached = await getCache<string>(CACHE_KEY);
    if (cached) {
      const tools = JSON.parse(cached) as OsintTool[];
      const counts: Record<string, number> = {};
      for (const t of tools) counts[t.category] = (counts[t.category] ?? 0) + 1;
      res.json({ cached: true, total: tools.length, categories: Object.keys(counts).length });
    } else {
      res.json({ cached: false, total: 0, categories: 0 });
    }
  } catch {
    res.json({ cached: false, total: 0, categories: 0 });
  }
});

export default router;
