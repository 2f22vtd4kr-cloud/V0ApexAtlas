/**
 * BM25 Keyword Search Index
 *
 * Builds an in-memory inverted index over entity text fields.
 * Refreshed every 5 minutes or on explicit invalidation.
 *
 * BM25 formula:
 *   score(D,Q) = Σ IDF(qi) × f(qi,D)×(k1+1) / (f(qi,D) + k1×(1−b+b×|D|/avgdl))
 *   k1=1.5, b=0.75 (standard Elasticsearch defaults)
 */

import { db, entitiesTable } from "@workspace/db";

const K1 = 1.5;
const B  = 0.75;
const INDEX_TTL_MS = 5 * 60 * 1000;

interface IndexDoc {
  id: number;
  tokens: string[];
}

interface BM25Index {
  docs: IndexDoc[];
  idf: Map<string, number>;
  avgDocLen: number;
  builtAt: number;
}

let _index: BM25Index | null = null;

// ── Tokenizer ─────────────────────────────────────────────────────────────────

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// ── Index builder ─────────────────────────────────────────────────────────────

async function buildIndex(): Promise<BM25Index> {
  const rows = await db
    .select({
      id: entitiesTable.id,
      name: entitiesTable.name,
      notes: entitiesTable.notes,
      nationality: entitiesTable.nationality,
      knownResidences: entitiesTable.knownResidences,
      sourceRegistries: entitiesTable.sourceRegistries,
      metadata: entitiesTable.metadata,
      // G2: contact fields — let users search "john smith email" or "tel texas"
      email: entitiesTable.email,
      phone: entitiesTable.phone,
      linkedinUrl: entitiesTable.linkedinUrl,
      estimatedNetWorth: entitiesTable.estimatedNetWorth,
    })
    .from(entitiesTable);

  const docs: IndexDoc[] = rows.map((e) => {
    let meta: any = {};
    try { meta = JSON.parse(e.metadata ?? "{}"); } catch { /* */ }

    // Net worth tier token so searches like "ultra hnw" or "100m" surface right entities
    let nwToken = "";
    if (e.estimatedNetWorth) {
      if (e.estimatedNetWorth >= 100_000_000) nwToken = "ultrahnw";
      else if (e.estimatedNetWorth >= 30_000_000) nwToken = "veryhnw";
      else if (e.estimatedNetWorth >= 4_000_000) nwToken = "hnw";
    }

    // Name weighted 3× — strongest identity signal
    // G2: also index contact fields so "john email" / "tech founder linkedin" queries work
    const text = [
      e.name, e.name, e.name,
      e.notes ?? "",
      e.nationality ?? "",
      e.knownResidences ?? "",
      e.sourceRegistries ?? "",
      meta.engineLabel ?? "",
      meta.state ?? "",
      meta.nNumber ?? "",
      meta.formType ?? "",
      meta.bizLocation ?? "",
      // Contact vector tokens
      e.email ? e.email.split("@")[0] ?? "" : "",
      e.phone ? "phone mobile tel" : "",
      e.linkedinUrl  ? "linkedin profile" : "",
      nwToken,
    ].join(" ");

    return { id: e.id, tokens: tokenize(text) };
  });

  // Document frequency
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc.tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  // IDF (Robertson-Sparck Jones)
  const N = docs.length;
  const idf = new Map<string, number>();
  for (const [term, docFreq] of df) {
    idf.set(term, Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1));
  }

  const avgDocLen = docs.length
    ? docs.reduce((s, d) => s + d.tokens.length, 0) / docs.length
    : 1;

  return { docs, idf, avgDocLen, builtAt: Date.now() };
}

async function getIndex(): Promise<BM25Index> {
  if (!_index || Date.now() - _index.builtAt > INDEX_TTL_MS) {
    _index = await buildIndex();
  }
  return _index;
}

export function invalidateBM25Index(): void {
  _index = null;
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface BM25Result {
  id: number;
  score: number;
}

export async function bm25Search(
  query: string,
  topK = 100,
): Promise<BM25Result[]> {
  const index = await getIndex();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || index.docs.length === 0) return [];

  const scores = new Map<number, number>();

  for (const qTerm of queryTokens) {
    const idfVal = index.idf.get(qTerm);
    if (!idfVal) continue;

    for (const doc of index.docs) {
      const tf = doc.tokens.filter((t) => t === qTerm).length;
      if (tf === 0) continue;

      const dl = doc.tokens.length;
      const bm25 =
        idfVal *
        ((tf * (K1 + 1)) /
          (tf + K1 * (1 - B + B * (dl / index.avgDocLen))));

      scores.set(doc.id, (scores.get(doc.id) ?? 0) + bm25);
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
