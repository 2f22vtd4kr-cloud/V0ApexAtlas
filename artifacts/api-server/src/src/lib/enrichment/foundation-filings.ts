/**
 * Foundation Filings Module (H3-C)
 *
 * Discovers HNWI contact data via IRS 990 filings (US nonprofit foundations).
 * US HNWIs frequently appear as trustees/officers of private foundations.
 * Uses ProPublica Nonprofit Explorer API — free, no auth required.
 *
 * Writes: foundationName, and enriches email/address when found in filing.
 * Confidence: 85 (IRS government filing = very high source quality).
 */

import { logger } from "../logger";

export interface FoundationFilingResult {
  foundationName: string | null;
  foundationEin:  string | null;
  address:        string | null;
  email:          string | null;
  confidence:     number;
  sources:        string[];
}

const PROPUBLICA_BASE = "https://projects.propublica.org/nonprofits/api/v2";

/** Fuzzy name match — true if at least 2 significant tokens are shared. */
function nameMatch(a: string, b: string): boolean {
  const STOP = new Set(["the", "of", "and", "a", "an", "in", "at", "for", "to", "by", "or", "llc", "inc", "corp", "ltd", "foundation", "fund"]);
  const tokens = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
     .filter(t => t.length > 2 && !STOP.has(t));
  const aSet = new Set(tokens(a));
  const shared = tokens(b).filter(t => aSet.has(t));
  return shared.length >= 2;
}

async function fetchJson(url: string): Promise<any> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "ApexFinderPro/1.0 (OSINT research tool)", Accept: "application/json" },
      signal:  AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** Search ProPublica for an entity name and check if they appear as an officer/trustee. */
export async function discoverViaFoundationFilings(entity: {
  name: string;
  type?: string | null;
}): Promise<FoundationFilingResult> {
  const result: FoundationFilingResult = {
    foundationName: null,
    foundationEin:  null,
    address:        null,
    email:          null,
    confidence:     0,
    sources:        [],
  };

  // ProPublica 990s are for US nonprofits — most relevant for HNWI/Gatekeeper types
  const name = entity.name.trim();
  if (!name || name.length < 4) return result;

  // Step 1: Search ProPublica for organizations matching the name
  const searchData = await fetchJson(
    `${PROPUBLICA_BASE}/search.json?q=${encodeURIComponent(name)}&state[id]=&ntee[id]=`
  );
  if (!searchData?.organizations?.length) return result;

  // Step 2: Check each org — is the entity listed as an officer/trustee?
  for (const org of searchData.organizations.slice(0, 5)) {
    const filingData = await fetchJson(`${PROPUBLICA_BASE}/organizations/${org.ein}.json`);
    if (!filingData) continue;

    // Small delay between filings API calls
    await new Promise(r => setTimeout(r, 500));

    const filing = filingData.filings_with_data?.[0];
    if (!filing) continue;

    // Check officer list
    const officers: Array<{ name: string; title?: string; address?: string; compensation?: number }> =
      filing.officers ?? [];

    for (const officer of officers) {
      if (nameMatch(officer.name ?? "", name)) {
        result.foundationName = org.name;
        result.foundationEin  = String(org.ein);
        result.confidence     = 85; // IRS filing — very high confidence
        result.sources.push("propublica-990");

        // Address from officer record
        if (officer.address) {
          result.address = officer.address;
          result.sources.push("propublica-officer-address");
        }

        // Contact email from organization filing (sometimes present)
        if (filing.contact_email) {
          result.email = filing.contact_email;
          result.sources.push("propublica-org-email");
        }

        return result; // First confirmed match wins
      }
    }

    // Also check if the entity IS the organization (founder, primary contact)
    if (nameMatch(org.name ?? "", name)) {
      result.foundationName = org.name;
      result.foundationEin  = String(org.ein);
      result.confidence     = 60; // Org name match only — lower confidence
      result.sources.push("propublica-org-match");
      if (filing.contact_email) {
        result.email = filing.contact_email;
        result.sources.push("propublica-org-email");
      }
      // Don't return early — continue to look for officer-level match
    }
  }

  return result;
}
