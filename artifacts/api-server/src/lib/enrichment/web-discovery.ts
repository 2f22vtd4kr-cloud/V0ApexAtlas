/**
 * enrichment/web-discovery.ts
 *
 * Public surface for all web-based OSINT enrichment.
 * Consolidates: web-enricher (canonical) · web-osint-enricher · occrp-enricher
 *
 * Consumers import from here; the implementation files remain in lib/ as-is.
 */

// Web-OSINT and deep enrichment (canonical — covers web-osint-enricher's surface too)
export type {
  OsintResult,
  EntityOsintInput,
  DeepWebOsintInput,
  DeepWebOsintResult,
} from "../web-enricher";
export { enrichEntityOsint, deepWebOsintEnrich } from "../web-enricher";

// OCCRP Aleph
export type { OccrpEnrichParams, OccrpEnrichResult } from "../occrp-enricher";
export { runOccrpEnrichment as runOccrpWebEnrichment } from "../occrp-enricher";
