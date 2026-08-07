/**
 * GLiNER Client — Zero-Shot Named Entity Recognition
 *
 * GLiNER (Generalist and Lightweight Model for NER) is a zero-shot NER model
 * that accepts entity type labels at runtime — no pre-training needed.
 * Given a block of text and labels like ["person name", "company name", "job title"],
 * it returns spans with confidence scores. This eliminates the entire class of
 * regex-based NER bugs ("Hotels CEO" garbage).
 *
 * Architecture:
 *   - Python microservice (scripts/gliner_service.py) runs on port 7890
 *   - This client calls it via HTTP (POST /extract)
 *   - Falls back to regex-based extraction if the service is unavailable
 *
 * Model: knowledgator/gliner-x-large (best for business/corporate text)
 * Fallback: urchade/gliner-multi-v2.1 (smaller, faster)
 *
 * Start service: see scripts/gliner_service.py
 * Replit workflow: added to artifact.toml as optional GLiNER NER Service
 */

import { logger } from "./logger";

const GLINER_PORT = 7890;
const GLINER_URL = `http://127.0.0.1:${GLINER_PORT}`;

let serviceAvailable: boolean | null = null;
let lastHealthCheck = 0;
const HEALTH_TTL = 30_000; // recheck every 30s

export interface GlinerEntity {
  text: string;
  label: string;
  score: number;
  start: number;
  end: number;
}

export interface GlinerResult {
  entities: GlinerEntity[];
  text: string;
  labels: string[];
  modelUsed?: string;
  serviceAvailable: boolean;
  error?: string;
}

// ── Health check ──────────────────────────────────────────────────────────────

async function checkHealth(): Promise<boolean> {
  if (serviceAvailable !== null && Date.now() - lastHealthCheck < HEALTH_TTL) {
    return serviceAvailable;
  }
  try {
    const resp = await fetch(`${GLINER_URL}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    serviceAvailable = resp.ok;
    lastHealthCheck = Date.now();
    return serviceAvailable;
  } catch {
    serviceAvailable = false;
    lastHealthCheck = Date.now();
    return false;
  }
}

// Force-reset cached health (call after attempting to start the service)
export function resetGlinerHealth(): void {
  serviceAvailable = null;
  lastHealthCheck = 0;
}

// ── Regex fallback NER ────────────────────────────────────────────────────────

const PERSON_WORD_BLOCKLIST = new Set([
  "ceo", "cfo", "coo", "cto", "cpo", "chro", "cmo", "evp", "svp", "vp",
  "president", "director", "manager", "partner", "associate", "analyst",
  "officer", "chairman", "chairwoman", "founder", "co-founder",
  "hotels", "group", "holdings", "capital", "fund", "partners",
  "management", "investments", "corporation", "enterprises", "international",
  "properties", "ventures", "solutions", "services", "systems",
  "inc", "llc", "ltd", "plc", "gmbh", "sa", "bv", "nv", "spa",
]);

const COMPANY_WORD_BLOCKLIST = new Set([
  "the", "and", "or", "of", "in", "at", "for", "to", "a", "an",
]);

/** Regex-based person name extraction (fallback when GLiNER unavailable) */
function regexExtractPersons(text: string): GlinerEntity[] {
  const entities: GlinerEntity[] = [];
  // Pattern: 2-4 capitalised words, not starting with blocked words
  const nameRe = /\b([A-Z][a-zÀ-ž]{1,20}(?:\s+[A-Z][a-zÀ-ž]{1,20}){1,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(text)) !== null) {
    const candidate = m[1]!;
    const words = candidate.toLowerCase().split(/\s+/);
    const hasBlocklisted = words.some(w => PERSON_WORD_BLOCKLIST.has(w));
    if (!hasBlocklisted && words.length >= 2) {
      entities.push({
        text: candidate,
        label: "person name",
        score: 0.6,
        start: m.index,
        end: m.index + candidate.length,
      });
    }
  }
  return entities;
}

/** Regex-based company name extraction (fallback) */
function regexExtractCompanies(text: string): GlinerEntity[] {
  const entities: GlinerEntity[] = [];
  const corpRe = /\b([A-Z][A-Za-zÀ-ž&\s]{2,60}(?:\s+(?:LLC|Ltd|Inc|Corp|GmbH|SA|BV|NV|SpA|SAS|SRL|PLC|LP|LLP|AG|SE))?)\b/g;
  let m: RegExpExecArray | null;
  while ((m = corpRe.exec(text)) !== null) {
    const candidate = m[1]!.trim();
    const words = candidate.toLowerCase().split(/\s+/);
    if (words.length >= 2 && !COMPANY_WORD_BLOCKLIST.has(words[0]!)) {
      entities.push({
        text: candidate,
        label: "company name",
        score: 0.5,
        start: m.index,
        end: m.index + candidate.length,
      });
    }
  }
  return entities;
}

// ── Main extraction function ──────────────────────────────────────────────────

const DEFAULT_LABELS = [
  "person name",
  "company name",
  "job title",
  "location",
  "email address",
  "phone number",
  "organization",
];

/**
 * Extract named entities from text using GLiNER.
 * Falls back to regex-based extraction if service unavailable.
 *
 * @param text    Text to analyse
 * @param labels  Entity type labels (default: person/company/job/location/email/phone)
 * @param threshold  Minimum confidence score (default 0.5)
 */
export async function extractEntities(
  text: string,
  labels: string[] = DEFAULT_LABELS,
  threshold = 0.5
): Promise<GlinerResult> {
  if (!text?.trim()) {
    return { entities: [], text, labels, serviceAvailable: false };
  }

  const healthy = await checkHealth();

  if (healthy) {
    try {
      const resp = await fetch(`${GLINER_URL}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, labels, threshold }),
        signal: AbortSignal.timeout(30_000),
      });

      if (resp.ok) {
        const data = await resp.json() as any;
        const entities: GlinerEntity[] = (data?.entities ?? []).map((e: any): GlinerEntity => ({
          text: e?.text ?? e?.span ?? "",
          label: e?.label ?? "",
          score: e?.score ?? e?.confidence ?? 0,
          start: e?.start ?? 0,
          end: e?.end ?? 0,
        })).filter((e: GlinerEntity) => e.text && e.score >= threshold);

        return {
          entities,
          text,
          labels,
          modelUsed: data?.model ?? "gliner",
          serviceAvailable: true,
        };
      }
    } catch (err: any) {
      serviceAvailable = false; // will recheck next time
      logger.debug({ err: err.message }, "[GLiNER] HTTP call failed, using regex fallback");
    }
  }

  // Fallback: regex-based NER
  const fallbackEntities: GlinerEntity[] = [];
  if (labels.some(l => l.includes("person"))) fallbackEntities.push(...regexExtractPersons(text));
  if (labels.some(l => l.includes("company") || l.includes("org"))) fallbackEntities.push(...regexExtractCompanies(text));

  return {
    entities: fallbackEntities,
    text,
    labels,
    serviceAvailable: false,
    error: healthy ? undefined : "GLiNER service not running — using regex fallback",
  };
}

/**
 * Convenience: extract only person names from text.
 * The primary replacement for extractPersonCandidates() regex patterns.
 */
export async function extractPersonNames(
  text: string,
  threshold = 0.5
): Promise<Array<{ name: string; score: number }>> {
  const result = await extractEntities(text, ["person name", "full name"], threshold);
  return result.entities
    .filter(e => e.label === "person name" || e.label === "full name")
    .map(e => ({ name: e.text, score: e.score }))
    .filter((e, i, arr) => arr.findIndex(x => x.name === e.name) === i); // dedup
}

/**
 * Convenience: extract company/org names from text.
 */
export async function extractCompanyNames(
  text: string,
  threshold = 0.5
): Promise<Array<{ name: string; score: number }>> {
  const result = await extractEntities(text, ["company name", "organization", "brand name"], threshold);
  return result.entities
    .filter(e => ["company name", "organization", "brand name"].includes(e.label))
    .map(e => ({ name: e.text, score: e.score }))
    .filter((e, i, arr) => arr.findIndex(x => x.name === e.name) === i);
}

/** Get GLiNER service status */
export async function getGlinerStatus(): Promise<{
  available: boolean;
  modelLoaded?: boolean;
  modelName?: string;
  port: number;
}> {
  try {
    const resp = await fetch(`${GLINER_URL}/status`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (resp.ok) {
      const data = await resp.json() as any;
      return {
        available: true,
        modelLoaded: data?.model_loaded ?? true,
        modelName: data?.model ?? "gliner",
        port: GLINER_PORT,
      };
    }
    return { available: false, port: GLINER_PORT };
  } catch {
    return { available: false, port: GLINER_PORT };
  }
}
