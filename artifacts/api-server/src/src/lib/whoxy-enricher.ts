/**
 * Whoxy Reverse WHOIS Enricher
 *
 * Given an email address or person/company name, returns ALL domains ever
 * registered by that registrant across 708M domain records and 1,596 TLDs.
 * This is the "email → digital footprint" bridge: a HNWI who owns a Monaco
 * property via a Luxembourg holding company may have registered the holding
 * company's domain under their personal email in 2009 before privacy shields.
 *
 * Free tier: 250,000 queries/month (requires WHOXY_API_KEY env var).
 * API: https://api.whoxy.com/
 * Docs: https://www.whoxy.com/reverse-whois/
 *
 * Graceful degradation: returns empty result when WHOXY_API_KEY is not set.
 */

import { logger } from "./logger";

const WHOXY_BASE = "https://api.whoxy.com/";

export interface WhoxyDomain {
  domain_name: string;
  create_date?: string;
  update_date?: string;
  expiry_date?: string;
  registrar_name?: string;
  registrant?: {
    full_name?: string;
    company_name?: string;
    mailing_address?: string;
    city_name?: string;
    state_name?: string;
    zip_code?: string;
    country_name?: string;
    email_address?: string;
    phone_number?: string;
  };
}

export interface WhoxyResult {
  found: boolean;
  totalDomains: number;
  domains: WhoxyDomain[];
  queryType: "email" | "name" | "company";
  queryValue: string;
  error?: string;
  // Whether WHOXY_API_KEY was available
  apiKeyPresent: boolean;
}

function getApiKey(): string | null {
  return process.env["WHOXY_API_KEY"] ?? null;
}

/**
 * Query Whoxy reverse WHOIS by email address.
 * This is the highest-value query: find all domains registered with an email.
 */
export async function reverseWhoisByEmail(email: string): Promise<WhoxyResult> {
  const key = getApiKey();
  const base: WhoxyResult = {
    found: false,
    totalDomains: 0,
    domains: [],
    queryType: "email",
    queryValue: email,
    apiKeyPresent: !!key,
  };

  if (!key) {
    logger.debug("[Whoxy] WHOXY_API_KEY not set — skipping reverse WHOIS by email");
    return base;
  }

  if (!email?.includes("@")) return base;

  try {
    const url = `${WHOXY_BASE}?key=${encodeURIComponent(key)}&reverse=whois&email=${encodeURIComponent(email)}&mode=mini`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "ApexFinder-OSINT/2.0 (research@apexfinder.private)" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      throw new Error(`Whoxy HTTP ${resp.status}: ${resp.statusText}`);
    }

    const data = await resp.json() as any;

    if (data?.status !== 1) {
      const msg = data?.status_reason ?? "Whoxy API error";
      logger.warn({ email, msg }, "[Whoxy] API returned non-success status");
      return { ...base, error: msg };
    }

    const domains: WhoxyDomain[] = (data?.search_result ?? []).map((d: any) => ({
      domain_name: d?.domain_name ?? "",
      create_date: d?.create_date ?? undefined,
      update_date: d?.update_date ?? undefined,
      expiry_date: d?.expiry_date ?? undefined,
      registrar_name: d?.registrar?.registrar_name ?? undefined,
      registrant: d?.registrant
        ? {
            full_name: d.registrant.full_name,
            company_name: d.registrant.company_name,
            mailing_address: d.registrant.mailing_address,
            city_name: d.registrant.city_name,
            state_name: d.registrant.state_name,
            zip_code: d.registrant.zip_code,
            country_name: d.registrant.country_name,
            email_address: d.registrant.email_address,
            phone_number: d.registrant.phone_number,
          }
        : undefined,
    })).filter((d: WhoxyDomain) => d.domain_name);

    logger.info({ email, count: domains.length }, "[Whoxy] reverse WHOIS by email complete");

    return {
      found: domains.length > 0,
      totalDomains: data?.total_results ?? domains.length,
      domains,
      queryType: "email",
      queryValue: email,
      apiKeyPresent: true,
    };
  } catch (err: any) {
    logger.warn({ email, err: err.message }, "[Whoxy] reverse WHOIS by email failed");
    return { ...base, error: err.message };
  }
}

/**
 * Query Whoxy reverse WHOIS by registrant name (person or company).
 */
export async function reverseWhoisByName(
  name: string,
  type: "name" | "company" = "name"
): Promise<WhoxyResult> {
  const key = getApiKey();
  const base: WhoxyResult = {
    found: false,
    totalDomains: 0,
    domains: [],
    queryType: type,
    queryValue: name,
    apiKeyPresent: !!key,
  };

  if (!key) {
    logger.debug("[Whoxy] WHOXY_API_KEY not set — skipping reverse WHOIS by name");
    return base;
  }

  if (!name?.trim()) return base;

  try {
    const param = type === "company" ? "company" : "name";
    const url = `${WHOXY_BASE}?key=${encodeURIComponent(key)}&reverse=whois&${param}=${encodeURIComponent(name.trim())}&mode=mini`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "ApexFinder-OSINT/2.0 (research@apexfinder.private)" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) throw new Error(`Whoxy HTTP ${resp.status}`);

    const data = await resp.json() as any;
    if (data?.status !== 1) {
      return { ...base, error: data?.status_reason ?? "Whoxy API error" };
    }

    const domains: WhoxyDomain[] = (data?.search_result ?? []).map((d: any) => ({
      domain_name: d?.domain_name ?? "",
      create_date: d?.create_date,
      update_date: d?.update_date,
      expiry_date: d?.expiry_date,
      registrar_name: d?.registrar?.registrar_name,
      registrant: d?.registrant ?? undefined,
    })).filter((d: WhoxyDomain) => d.domain_name);

    logger.info({ name, type, count: domains.length }, "[Whoxy] reverse WHOIS by name complete");

    return {
      found: domains.length > 0,
      totalDomains: data?.total_results ?? domains.length,
      domains,
      queryType: type,
      queryValue: name,
      apiKeyPresent: true,
    };
  } catch (err: any) {
    logger.warn({ name, err: err.message }, "[Whoxy] reverse WHOIS by name failed");
    return { ...base, error: err.message };
  }
}

/**
 * Run both email and name queries for an entity and merge results.
 * Deduplicates by domain_name.
 */
export async function enrichWithWhoxy(params: {
  email?: string | null;
  name?: string | null;
  companyName?: string | null;
}): Promise<{
  emailDomains: WhoxyResult;
  nameDomains: WhoxyResult;
  companyDomains: WhoxyResult;
  allUniqueDomains: WhoxyDomain[];
  totalUnique: number;
  apiKeyPresent: boolean;
}> {
  const [emailDomains, nameDomains, companyDomains] = await Promise.all([
    params.email ? reverseWhoisByEmail(params.email) : Promise.resolve<WhoxyResult>({ found: false, totalDomains: 0, domains: [], queryType: "email", queryValue: "", apiKeyPresent: !!getApiKey() }),
    params.name ? reverseWhoisByName(params.name, "name") : Promise.resolve<WhoxyResult>({ found: false, totalDomains: 0, domains: [], queryType: "name", queryValue: "", apiKeyPresent: !!getApiKey() }),
    params.companyName ? reverseWhoisByName(params.companyName, "company") : Promise.resolve<WhoxyResult>({ found: false, totalDomains: 0, domains: [], queryType: "company", queryValue: "", apiKeyPresent: !!getApiKey() }),
  ]);

  const seen = new Set<string>();
  const allUniqueDomains: WhoxyDomain[] = [];
  for (const result of [emailDomains, nameDomains, companyDomains]) {
    for (const d of result.domains) {
      if (d.domain_name && !seen.has(d.domain_name)) {
        seen.add(d.domain_name);
        allUniqueDomains.push(d);
      }
    }
  }

  return {
    emailDomains,
    nameDomains,
    companyDomains,
    allUniqueDomains,
    totalUnique: allUniqueDomains.length,
    apiKeyPresent: !!getApiKey(),
  };
}

/** Format Whoxy findings for notes injection */
export function summariseWhoxyFindings(domains: WhoxyDomain[], limit = 10): string | null {
  if (!domains.length) return null;
  const lines = [`Whoxy Reverse WHOIS — ${domains.length} domain(s) found:`];
  for (const d of domains.slice(0, limit)) {
    const parts: string[] = [`  • ${d.domain_name}`];
    if (d.create_date) parts.push(`(reg: ${d.create_date})`);
    if (d.registrant?.country_name) parts.push(`[${d.registrant.country_name}]`);
    lines.push(parts.join(" "));
  }
  if (domains.length > limit) lines.push(`  … and ${domains.length - limit} more`);
  return lines.join("\n");
}
