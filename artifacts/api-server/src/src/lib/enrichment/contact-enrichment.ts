/**
 * enrichment/contact-enrichment.ts
 *
 * Public surface for free-source contact & identity enrichment:
 * Wikidata · Wikipedia · GitHub · Gravatar · DNS/RDAP · ProPublica 990
 *
 * Consolidates: in-house-enricher (the only implementation file)
 *
 * Consumers import from here; the implementation file remains in lib/ as-is.
 */

export type { InHouseEnrichResult, InHouseEnrichInput } from "../in-house-enricher";
export { enrichInHouse } from "../in-house-enricher";
