/**
 * TF-IDF Vector Space Model
 *
 * Approximates semantic search using cosine similarity over TF-IDF vectors.
 * Includes bigrams for better phrase matching ("private jet", "jet owner").
 * No neural model or external API — fully deterministic.
 *
 * Refreshed every 5 minutes (same TTL as BM25 index).
 */

import { db, entitiesTable } from "@workspace/db";

const CORPUS_TTL_MS = 5 * 60 * 1000;

interface CorpusDoc {
  id: number;
  vector: Map<string, number>;
  magnitude: number;
}

interface TFIDFCorpus {
  docs: CorpusDoc[];
  idf: Map<string, number>;
  builtAt: number;
}

let _corpus: TFIDFCorpus | null = null;

// ── Tokenizer with bigrams ────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  const unigrams = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  // Bigrams for phrase matching ("private jet", "us millionaire", etc.)
  const bigrams = unigrams
    .slice(0, -1)
    .map((t, i) => `${t}_${unigrams[i + 1]}`);

  return [...unigrams, ...bigrams];
}

function magnitude(v: Map<string, number>): number {
  let s = 0;
  for (const val of v.values()) s += val * val;
  return Math.sqrt(s);
}

// ── Corpus builder ────────────────────────────────────────────────────────────

async function buildCorpus(): Promise<TFIDFCorpus> {
  const rows = await db
    .select({
      id: entitiesTable.id,
      name: entitiesTable.name,
      notes: entitiesTable.notes,
      nationality: entitiesTable.nationality,
      knownResidences: entitiesTable.knownResidences,
      sourceRegistries: entitiesTable.sourceRegistries,
      metadata: entitiesTable.metadata,
    })
    .from(entitiesTable);

  const raw = rows.map((e) => {
    let meta: any = {};
    try { meta = JSON.parse(e.metadata ?? "{}"); } catch { /* */ }

    const text = [
      e.name, e.name, e.name,
      e.notes ?? "",
      e.nationality ?? "",
      e.knownResidences ?? "",
      meta.engineLabel ?? "",
      meta.state ?? "",
    ].join(" ");

    return { id: e.id, tokens: tokenize(text) };
  });

  // IDF (smooth: log((N+1)/(df+1)) + 1)
  const df = new Map<string, number>();
  for (const doc of raw) {
    for (const term of new Set(doc.tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const N = raw.length;
  const idf = new Map<string, number>();
  for (const [term, freq] of df) {
    idf.set(term, Math.log((N + 1) / (freq + 1)) + 1);
  }

  // Build TF-IDF vectors
  const docs: CorpusDoc[] = raw.map((doc) => {
    const tf = new Map<string, number>();
    for (const term of doc.tokens) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }
    const len = Math.max(1, doc.tokens.length);
    const vector = new Map<string, number>();
    for (const [term, count] of tf) {
      const idfVal = idf.get(term);
      if (idfVal) vector.set(term, (count / len) * idfVal);
    }
    return { id: doc.id, vector, magnitude: magnitude(vector) };
  });

  return { docs, idf, builtAt: Date.now() };
}

async function getCorpus(): Promise<TFIDFCorpus> {
  if (!_corpus || Date.now() - _corpus.builtAt > CORPUS_TTL_MS) {
    _corpus = await buildCorpus();
  }
  return _corpus;
}

export function invalidateTFIDFCorpus(): void {
  _corpus = null;
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SemanticResult {
  id: number;
  score: number;
}

export async function semanticSearch(
  query: string,
  topK = 100,
): Promise<SemanticResult[]> {
  const corpus = await getCorpus();
  if (corpus.docs.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  // Query TF-IDF vector
  const qtf = new Map<string, number>();
  for (const term of queryTokens) qtf.set(term, (qtf.get(term) ?? 0) + 1);
  const qlen = Math.max(1, queryTokens.length);

  const qvec = new Map<string, number>();
  for (const [term, count] of qtf) {
    const idfVal = corpus.idf.get(term);
    if (idfVal) qvec.set(term, (count / qlen) * idfVal);
  }
  const qmag = magnitude(qvec);
  if (qmag === 0) return [];

  // Cosine similarity
  const results: SemanticResult[] = [];
  for (const doc of corpus.docs) {
    if (doc.magnitude === 0) continue;
    let dot = 0;
    for (const [term, qval] of qvec) {
      const dval = doc.vector.get(term);
      if (dval) dot += qval * dval;
    }
    const cosine = dot / (qmag * doc.magnitude);
    if (cosine > 0.01) results.push({ id: doc.id, score: cosine });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}
