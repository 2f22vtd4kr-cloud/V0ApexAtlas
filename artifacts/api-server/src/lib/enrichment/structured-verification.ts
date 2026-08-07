/**
 * enrichment/structured-verification.ts
 *
 * Public surface for structured-registry verification:
 * Companies House officer lookup, OCCRP Aleph cross-reference.
 *
 * Consolidates: registry-enricher (canonical) · companies-house-enricher
 *
 * Consumers import from here; the implementation files remain in lib/ as-is.
 */

export type { EnrichmentResult } from "../registry-enricher";
export {
  runCompanyOfficersEnrichment,
  runCompaniesHouseEnrichment,
  runOccrpEnrichment,
} from "../registry-enricher";
