export interface SourceReliability {
  source: string;
  reliability: number;
  identity: number;
  ownership: number;
  contact: number;
  freshness: number;
  rationale: string;
}

const SOURCE_PROFILES: Array<{
  match: RegExp;
  profile: Omit<SourceReliability, "source">;
}> = [
  {
    match: /sec\s*edgar|sec filing/i,
    profile: { reliability: 0.94, identity: 0.96, ownership: 0.92, contact: 0.35, freshness: 0.9, rationale: "Official US securities filings with named filers and dated disclosures." },
  },
  {
    match: /companies\s*house|psc|officers register/i,
    profile: { reliability: 0.91, identity: 0.94, ownership: 0.88, contact: 0.4, freshness: 0.88, rationale: "Official company register and officer/PSC records." },
  },
  {
    match: /brreg|enhetsregisteret/i,
    profile: { reliability: 0.9, identity: 0.93, ownership: 0.62, contact: 0.3, freshness: 0.9, rationale: "Official Norwegian entity register; role data is not universal beneficial ownership." },
  },
  {
    match: /faa|easa|aircraft|aviation registry/i,
    profile: { reliability: 0.88, identity: 0.95, ownership: 0.7, contact: 0.12, freshness: 0.8, rationale: "Official aviation registration supports aircraft identity/control, not personal access." },
  },
  {
    match: /land registry|hmlr|catasto|property register/i,
    profile: { reliability: 0.86, identity: 0.88, ownership: 0.9, contact: 0.08, freshness: 0.76, rationale: "Official land records support property and recorded ownership claims." },
  },
  {
    match: /gleif|lei register/i,
    profile: { reliability: 0.84, identity: 0.9, ownership: 0.76, contact: 0.12, freshness: 0.84, rationale: "Global legal-entity identifier and relationship register." },
  },
  {
    match: /wikidata|wikipedia/i,
    profile: { reliability: 0.58, identity: 0.6, ownership: 0.35, contact: 0.18, freshness: 0.5, rationale: "Useful discovery and corroboration lead; not sufficient alone for attribution." },
  },
  {
    match: /ai|groq|gemini|perplexity|tavily|exa|mcts|hybrid retrieval/i,
    profile: { reliability: 0.4, identity: 0.42, ownership: 0.28, contact: 0.22, freshness: 0.55, rationale: "Derived or discovery output; must remain bound to cited public sources." },
  },
];

export function getSourceReliability(source: string | null | undefined): SourceReliability {
  const label = source?.trim() || "Unknown source";
  const matched = SOURCE_PROFILES.find((entry) => entry.match.test(label));
  return {
    source: label,
    ...(matched?.profile ?? {
      reliability: 0.3,
      identity: 0.3,
      ownership: 0.2,
      contact: 0.15,
      freshness: 0.35,
      rationale: "Source family is not registered; manual review is required.",
    }),
  };
}

export function averageSourceReliability(sources: Array<string | null | undefined>): number {
  const unique = [...new Set(sources.filter((source): source is string => Boolean(source?.trim())))];
  if (unique.length === 0) return 0.3;
  return Number((unique.reduce((sum, source) => sum + getSourceReliability(source).reliability, 0) / unique.length).toFixed(3));
}