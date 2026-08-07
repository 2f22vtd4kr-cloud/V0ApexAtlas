/**
 * LLM Wealth Estimator
 *
 * Forces a structured wealth estimate for every entity, regardless of whether
 * direct net-worth data was found. The prompt is engineered so that models
 * CANNOT respond with "I don't know" or "insufficient data" — every public
 * figure in a registry (company director, aircraft owner, property holder)
 * has enough associated context for a calibrated floor estimate.
 *
 * Strategy:
 *   1. Build a rich context block from all entity fields + assets + notes
 *   2. Send to Groq (llama-3.3-70b) with a hard-mandate prompt
 *   3. Fallback to Gemini if Groq fails / rate-limited
 *   4. Parse a JSON { pointEstimate, low, high, confidence, reasoning } response
 *   5. Write estimatedNetWorth = pointEstimate to DB; skip if already set
 *
 * Called from:
 *   - Atlas Phase 9 (after all enrichment)
 *   - POST /api/ingest/backfill-wealth-llm  (manual trigger)
 */

import { db } from "@workspace/db";
import { entities as entitiesTable, assets as assetsTable } from "@workspace/db";
import { sql, isNull, eq, or } from "drizzle-orm";
import { logger } from "./logger";

// ── API key pools ──────────────────────────────────────────────────────────────
const GROQ_KEY_NAMES = ["GROQ_API_KEY", ...Array.from({ length: 10 }, (_, i) => `GROQ_API_KEY_${i + 1}`)];
const GEMINI_KEY_NAMES = ["GEMINI_API_KEY", ...Array.from({ length: 10 }, (_, i) => `GEMINI_API_KEY_${i + 1}`)];

const GROQ_KEYS = GROQ_KEY_NAMES.map(k => process.env[k]).filter(Boolean) as string[];
const GEMINI_KEYS = GEMINI_KEY_NAMES.map(k => process.env[k]).filter(Boolean) as string[];

let groqKeyIdx = 0;
let geminiKeyIdx = 0;
function nextGroqKey(): string | null { return GROQ_KEYS.length ? GROQ_KEYS[groqKeyIdx++ % GROQ_KEYS.length]! : null; }
function nextGeminiKey(): string | null { return GEMINI_KEYS.length ? GEMINI_KEYS[geminiKeyIdx++ % GEMINI_KEYS.length]! : null; }

// ── Types ─────────────────────────────────────────────────────────────────────
export interface WealthEstimate {
  pointEstimate: number;   // best single number in USD
  low: number;             // conservative floor
  high: number;            // optimistic ceiling
  confidence: "high" | "medium" | "low";
  reasoning: string;       // one-paragraph chain of reasoning
  method: "llm-groq" | "llm-gemini" | "asset-formula" | "fallback";
}

// ── Context builder ───────────────────────────────────────────────────────────
interface EntityContext {
  id: number;
  name: string;
  type: string;
  nationality: string | null;
  knownResidences: string | null;
  notes: string | null;
  sourceRegistries: string | null;
  metadata: string | null;
  estimatedNetWorth: number | null;
  linkedinHeadline: string | null;
  foundationName: string | null;
  totalAssetValue: number;
  assetCount: number;
  assetDescriptions: string[];
}

function buildContextBlock(e: EntityContext): string {
  const lines: string[] = [
    `NAME: ${e.name}`,
    `TYPE: ${e.type ?? "HNWI"}`,
  ];
  if (e.nationality) lines.push(`NATIONALITY: ${e.nationality}`);
  if (e.knownResidences) lines.push(`KNOWN RESIDENCES: ${e.knownResidences}`);
  if (e.linkedinHeadline) lines.push(`LINKEDIN HEADLINE: ${e.linkedinHeadline}`);

  // Source registries are a strong signal for wealth tier
  if (e.sourceRegistries) {
    try {
      const regs = JSON.parse(e.sourceRegistries);
      if (Array.isArray(regs) && regs.length > 0) {
        lines.push(`SOURCE REGISTRIES: ${regs.join(", ")}`);
      }
    } catch {
      lines.push(`SOURCE REGISTRIES: ${e.sourceRegistries}`);
    }
  }

  // EDGAR metadata (shares, ticker, filing type) is a direct wealth signal
  if (e.metadata) {
    try {
      const meta = JSON.parse(e.metadata) as Record<string, unknown>;
      const keyFields = ["sharesOwned", "ticker", "filingType", "companyName", "reportingOwnerRelationship",
        "isDirector", "isOfficer", "is10PctOwner", "totalValue", "aum", "fundSize", "role", "sector"];
      const relevant = Object.entries(meta)
        .filter(([k]) => keyFields.includes(k))
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      if (relevant) lines.push(`FILING METADATA: ${relevant}`);
    } catch { /* ignore */ }
  }

  // Notes contain company names, deal descriptions, source context
  if (e.notes) {
    const truncated = e.notes.slice(0, 600).replace(/\n+/g, " ").trim();
    lines.push(`RESEARCH NOTES: ${truncated}`);
  }

  if (e.foundationName) lines.push(`CHARITABLE FOUNDATION: ${e.foundationName}`);

  if (e.assetCount > 0) {
    lines.push(`REGISTERED ASSETS: ${e.assetCount} asset(s), total estimated value $${(e.totalAssetValue / 1_000_000).toFixed(1)}M`);
    if (e.assetDescriptions.length > 0) {
      lines.push(`ASSET DETAILS: ${e.assetDescriptions.slice(0, 5).join(" | ")}`);
    }
  }

  return lines.join("\n");
}

// ── The forced-estimate prompt ────────────────────────────────────────────────
function buildWealthPrompt(entities: EntityContext[]): string {
  const contextBlocks = entities.map((e, i) =>
    `--- ENTITY ${i + 1} ---\n${buildContextBlock(e)}`
  ).join("\n\n");

  return `You are a private wealth analyst with access to global public registries, SEC filings, corporate databases, and property records. Your task is to produce a MANDATORY calibrated net worth estimate for each entity below.

CRITICAL RULES — READ BEFORE ANSWERING:
1. You MUST produce a dollar estimate for EVERY entity. No exceptions.
2. You are STRICTLY FORBIDDEN from responding with any of the following: "I cannot estimate", "insufficient data", "I don't know", "unable to determine", "not enough information", "no public data", "I'm not able to". These responses are not acceptable.
3. Every person in a public registry has ESTIMABLE wealth. Here is why you always have enough information:
   - SEC Form 3/4/5 filers own shares in public companies → shares × price = floor estimate
   - EDGAR DEF 14A / Form 4 filers are insiders of US public companies → salary + equity packages start at $500K/yr for directors
   - Aircraft owners (FAA registry) → business aircraft cost $2M-$80M; owners are UHNW
   - BRREG/Companies House directors of operating businesses → business value × ownership stake = floor
   - Anyone filing a 13D/13G with 5%+ ownership of a public company → stake × market cap = direct wealth
   - Foundation trustees with significant philanthropic history → donors typically give 5-15% of net worth
4. Use CONSERVATIVE assumptions. It is better to underestimate than fabricate. If unsure, set confidence = "low" and use a floor based purely on role/sector norms.
5. The pointEstimate should be your BEST SINGLE NUMBER. Not a range — a specific dollar figure.
6. Reasoning must be a factual chain: "X owns Y company (sector Z, $Nm revenue implies $Nm business value) → assuming A% ownership → floor $Bm."

WEALTH CALIBRATION REFERENCE (use as floor benchmarks):
- US public company board director: $2M-$20M (equity + salary accumulated over tenure)
- US public company CEO/CFO: $10M-$500M
- SEC 13D filer (activist, 5%+ block): stake value × 2 (they typically have more assets beyond the filing)
- EDGAR Form 4 insider (10%+ owner of small-cap): market cap × stake × 0.6 (illiquidity discount)
- Business aircraft owner (single engine/piston): $2M-$8M floor
- Business aircraft owner (turboprop/jet): $15M-$200M floor
- UK Companies House director of revenue >£10M company: £5M-£50M
- Norwegian BRREG director of AS (≥10 employees): NOK 10M-100M ($1M-$10M)
- Property developer (registered land assets): 3-5× total registered property value
- Private equity/hedge fund founder: AUM × 2-5% (carried interest) + personal stake
- Family office principal: minimum $30M (family offices exist for $30M+ net worth)

${contextBlocks}

Respond ONLY with a valid JSON array, one object per entity, in this exact format:
[
  {
    "entityIndex": 1,
    "name": "entity name",
    "pointEstimate": 45000000,
    "low": 20000000,
    "high": 100000000,
    "confidence": "medium",
    "reasoning": "One paragraph factual chain explaining the estimate."
  }
]

No preamble, no markdown, no explanation outside the JSON array. If you include ANYTHING other than the JSON array, the response is invalid.`;
}

// ── LLM call: Groq ────────────────────────────────────────────────────────────
async function callGroq(prompt: string): Promise<WealthEstimate[]> {
  const key = nextGroqKey();
  if (!key) throw new Error("No Groq keys available");

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Groq ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  return parseWealthResponse(text, "llm-groq");
}

// ── LLM call: Gemini ──────────────────────────────────────────────────────────
async function callGemini(prompt: string): Promise<WealthEstimate[]> {
  const key = nextGeminiKey();
  if (!key) throw new Error("No Gemini keys available");

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(45_000),
    }
  );

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Gemini ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  return parseWealthResponse(text, "llm-gemini");
}

// ── Response parser ───────────────────────────────────────────────────────────
function parseWealthResponse(text: string, method: WealthEstimate["method"]): WealthEstimate[] {
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  // Find the JSON array
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON array found in response. Got: ${cleaned.slice(0, 300)}`);

  const raw = JSON.parse(match[0]) as Array<{
    entityIndex: number;
    name?: string;
    pointEstimate?: number;
    low?: number;
    high?: number;
    confidence?: string;
    reasoning?: string;
  }>;

  return raw.map(r => ({
    pointEstimate: Math.max(0, Math.round(Number(r.pointEstimate ?? 0))),
    low: Math.max(0, Math.round(Number(r.low ?? 0))),
    high: Math.max(0, Math.round(Number(r.high ?? 0))),
    confidence: (["high", "medium", "low"].includes(r.confidence ?? "") ? r.confidence : "low") as WealthEstimate["confidence"],
    reasoning: String(r.reasoning ?? "").slice(0, 1000),
    method,
  }));
}

// ── Asset formula fallback ────────────────────────────────────────────────────
function assetFormulaEstimate(e: EntityContext): WealthEstimate {
  const base = e.totalAssetValue > 0 ? e.totalAssetValue * 3 : 2_000_000; // $2M floor
  return {
    pointEstimate: base,
    low: Math.round(base * 0.5),
    high: Math.round(base * 6),
    confidence: e.totalAssetValue > 0 ? "low" : "low",
    reasoning: e.totalAssetValue > 0
      ? `Asset-formula fallback: registered asset value $${(e.totalAssetValue / 1e6).toFixed(1)}M × 3 = $${(base / 1e6).toFixed(1)}M floor.`
      : `No assets or LLM data available. Applied minimum HNWI floor of $2M.`,
    method: "asset-formula",
  };
}

// ── Main export: estimate a batch of entities ─────────────────────────────────
export async function estimateWealthBatch(
  entities: EntityContext[],
): Promise<Map<number, WealthEstimate>> {
  const results = new Map<number, WealthEstimate>();
  if (entities.length === 0) return results;

  const prompt = buildWealthPrompt(entities);
  let estimates: WealthEstimate[] = [];

  // Try Groq first
  try {
    estimates = await callGroq(prompt);
    logger.info({ count: estimates.length }, "[WealthEstimator] Groq estimates received");
  } catch (groqErr: any) {
    logger.warn({ err: groqErr.message }, "[WealthEstimator] Groq failed — trying Gemini");
    try {
      estimates = await callGemini(prompt);
      logger.info({ count: estimates.length }, "[WealthEstimator] Gemini estimates received");
    } catch (geminiErr: any) {
      logger.warn({ err: geminiErr.message }, "[WealthEstimator] Gemini also failed — using asset formula");
    }
  }

  // Map results back to entity IDs by position
  entities.forEach((entity, idx) => {
    const est = estimates[idx] ?? assetFormulaEstimate(entity);
    // Sanity: enforce minimum $500K for any HNWI in a registry
    if (est.pointEstimate < 500_000) {
      est.pointEstimate = Math.max(est.pointEstimate, 500_000);
      est.low = Math.max(est.low, 250_000);
    }
    results.set(entity.id, est);
  });

  // Fill any missing with asset formula (parse mismatch)
  entities.forEach(entity => {
    if (!results.has(entity.id)) {
      results.set(entity.id, assetFormulaEstimate(entity));
    }
  });

  return results;
}

// ── Full DB backfill: process all entities without a net worth estimate ────────
export async function backfillWealthLLM(opts: {
  onlyMissing?: boolean;  // default true — skip entities that already have a value
  batchSize?: number;     // entities per LLM call, default 8
  onProgress?: (done: number, total: number) => void;
} = {}): Promise<{ updated: number; skipped: number; errors: number }> {
  const { onlyMissing = true, batchSize = 8 } = opts;

  // Fetch all entity context + their asset totals
  const rows = await db.execute(sql`
    SELECT
      e.id,
      e.name,
      e.type,
      e.nationality,
      e.known_residences,
      e.notes,
      e.source_registries,
      e.metadata,
      e.estimated_net_worth,
      e.linkedin_headline,
      e.foundation_name,
      COALESCE(SUM(a.estimated_value), 0)::float AS total_asset_value,
      COUNT(a.id)::int AS asset_count,
      ARRAY_AGG(
        CASE WHEN a.description IS NOT NULL
          THEN (a.category || ': ' || LEFT(a.description, 80))
          ELSE a.category
        END
      ) FILTER (WHERE a.id IS NOT NULL) AS asset_descriptions
    FROM entities e
    LEFT JOIN assets a ON a.owner_entity_id = e.id
    ${onlyMissing
      ? sql`WHERE e.estimated_net_worth IS NULL OR e.estimated_net_worth = 0`
      : sql``
    }
    GROUP BY e.id
    ORDER BY e.id
  `);

  const entities: EntityContext[] = (rows.rows as any[]).map(r => ({
    id: Number(r.id),
    name: String(r.name),
    type: String(r.type ?? "HNWI"),
    nationality: r.nationality ?? null,
    knownResidences: r.known_residences ?? null,
    notes: r.notes ?? null,
    sourceRegistries: r.source_registries ?? null,
    metadata: r.metadata ?? null,
    estimatedNetWorth: r.estimated_net_worth != null ? Number(r.estimated_net_worth) : null,
    linkedinHeadline: r.linkedin_headline ?? null,
    foundationName: r.foundation_name ?? null,
    totalAssetValue: Number(r.total_asset_value ?? 0),
    assetCount: Number(r.asset_count ?? 0),
    assetDescriptions: Array.isArray(r.asset_descriptions)
      ? r.asset_descriptions.filter(Boolean) as string[]
      : [],
  }));

  if (entities.length === 0) {
    logger.info("[WealthEstimator] No entities need wealth backfill");
    return { updated: 0, skipped: 0, errors: 0 };
  }

  logger.info({ total: entities.length, batchSize }, "[WealthEstimator] Starting LLM wealth backfill");

  let updated = 0, skipped = 0, errors = 0;

  for (let i = 0; i < entities.length; i += batchSize) {
    const batch = entities.slice(i, i + batchSize);
    try {
      const estimates = await estimateWealthBatch(batch);

      for (const entity of batch) {
        const est = estimates.get(entity.id);
        if (!est || est.pointEstimate <= 0) { skipped++; continue; }

        // Append reasoning to notes so it's visible in the UI
        const reasoningNote = `\n\n[Wealth Estimate — ${est.confidence} confidence]\n${est.reasoning}\nRange: $${(est.low / 1e6).toFixed(1)}M – $${(est.high / 1e6).toFixed(1)}M (method: ${est.method})`;

        await db.execute(sql`
          UPDATE entities
          SET
            estimated_net_worth = ${est.pointEstimate},
            notes = COALESCE(notes, '') || ${reasoningNote},
            updated_at = NOW()
          WHERE id = ${entity.id}
        `);
        updated++;
      }

      opts.onProgress?.(Math.min(i + batchSize, entities.length), entities.length);
    } catch (err: any) {
      logger.error({ err: err.message, batchStart: i }, "[WealthEstimator] Batch error");
      errors += batch.length;
    }

    // Pace between batches to avoid rate limits
    if (i + batchSize < entities.length) {
      await new Promise(r => setTimeout(r, 1200));
    }
  }

  logger.info({ updated, skipped, errors }, "[WealthEstimator] Backfill complete");
  return { updated, skipped, errors };
}
