/**
 * GLEIF LEI Register Client — Global Legal Entity Identifier Foundation
 *
 * Source: https://api.gleif.org/api/v1/
 * Free, no API key required. Rate limit: ~60 req/min.
 *
 * Returns real legal entity records with LEI codes, legal addresses,
 * jurisdiction, registration authority, and entity status.
 * Every result traces to GLEIF's official register.
 *
 * Docs: https://www.gleif.org/en/lei-data/gleif-api
 */

export interface GleifResult {
  name: string;
  type: "Corporation";
  nationality?: string;
  knownResidences?: string;
  sourceRegistries: string;
  notes?: string;
  metadata?: string;
}

export async function searchGleif(
  query: string,
  limit: number = 10,
): Promise<GleifResult[]> {
  const params = new URLSearchParams({
    "filter[fulltext]": query,
    "page[size]": String(Math.min(limit, 20)),
    "page[number]": "1",
  });

  const url = `https://api.gleif.org/api/v1/lei-records?${params}`;

  const resp = await fetch(url, {
    headers: {
      Accept: "application/vnd.api+json",
      "User-Agent": "ApexFinder/1.0 OSINT-Intelligence research@apexfinder.private",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `GLEIF ${resp.status}: ${body.slice(0, 200) || resp.statusText}`,
    );
  }

  const data = (await resp.json()) as any;
  const records: any[] = data?.data ?? [];

  return records.map((r: any): GleifResult => {
    const attrs = r?.attributes ?? {};
    const entity = attrs?.entity ?? {};
    const reg = attrs?.registration ?? {};

    const legalName: string =
      entity?.legalName?.name ?? entity?.otherNames?.[0]?.name ?? "Unknown";
    const jurisdiction: string =
      entity?.jurisdiction ?? entity?.legalAddress?.country ?? "Unknown";

    const addr = entity?.legalAddress;
    const addrParts = addr
      ? [
          ...(addr.addressLines ?? []),
          addr.city,
          addr.postalCode,
          addr.country,
        ].filter(Boolean)
      : [];
    const addrStr = addrParts.join(", ") || undefined;

    const lei: string = attrs?.lei ?? "";
    const entityStatus: string = entity?.status ?? "";
    const entityCategory: string = entity?.category ?? "";
    const legalForm: string = entity?.legalForm?.id ?? "";
    const regAuthority: string = reg?.managingLou ?? "";

    const notes = [
      lei ? `LEI: ${lei}` : null,
      entityStatus ? `Status: ${entityStatus}` : null,
      entityCategory ? `Category: ${entityCategory}` : null,
      legalForm ? `Form: ${legalForm}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    return {
      name: legalName,
      type: "Corporation",
      nationality: jurisdiction || undefined,
      knownResidences: addrStr,
      sourceRegistries: JSON.stringify(["GLEIF LEI Register"]),
      notes: notes || undefined,
      metadata: JSON.stringify({
        source: "gleif",
        lei,
        jurisdiction,
        entityStatus,
        entityCategory,
        legalForm,
        managingLou: regAuthority,
        gleifUrl: `https://search.gleif.org/#/record/${lei}`,
      }),
    };
  });
}
