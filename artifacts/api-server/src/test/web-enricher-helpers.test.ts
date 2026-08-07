/**
 * Regression tests for web-enricher pure helpers.
 *
 * Covers the K1–K3 fixes that were motivated by the Bâoli Cannes session:
 *  - deriveTradingName:         legal name + city → searchable trading name
 *  - guessCompanyDomainWithCity: city-derived domain variants appear first
 *  - extractCity:               European postal-code and address formats
 *  - detectCountry (via locale): FR/DE/IT/ES entities get correct search locale
 *
 * Run: pnpm --filter @workspace/api-server test
 */

import { describe, it, expect } from "vitest";
import {
  deriveTradingName,
  guessCompanyDomainWithCity,
  extractCity,
  looksLikePersonName,
} from "../lib/web-enricher";

// ── deriveTradingName ────────────────────────────────────────────────────────

describe("deriveTradingName", () => {
  it("strips SAS suffix and appends city for short ambiguous names", () => {
    const result = deriveTradingName("BAOLI SAS", "Cannes");
    expect(result).toBe("Baoli Cannes");
  });

  it("strips SAS suffix without city for long enough names", () => {
    const result = deriveTradingName("RIVIERA HOSPITALITY SAS", "Cannes");
    expect(result).toBe("Riviera Hospitality");
  });

  it("strips GmbH suffix (German)", () => {
    expect(deriveTradingName("ACME LOGISTICS GMBH", null)).toBe("Acme Logistics");
  });

  it("strips Ltd suffix (UK)", () => {
    expect(deriveTradingName("SMITH PROPERTIES LTD", null)).toBe("Smith Properties");
  });

  it("strips SRL suffix (Italian)", () => {
    expect(deriveTradingName("ROSSI COSTRUZIONI SRL", "Rome")).toBe("Rossi Costruzioni");
  });

  it("handles already-titlecase names", () => {
    expect(deriveTradingName("Apple Inc", null)).toBe("Apple");
  });

  it("does not append city if name already includes city text", () => {
    const result = deriveTradingName("CANNES EVENTS SAS", "Cannes");
    // name is 12+ chars after stripping → city not appended
    expect(result).not.toMatch(/Cannes Cannes/);
  });

  it("titlecases ALL CAPS names", () => {
    expect(deriveTradingName("HOTEL DES ARTS SARL", null)).toBe("Hotel Des Arts");
  });
});

// ── guessCompanyDomainWithCity ───────────────────────────────────────────────

describe("guessCompanyDomainWithCity", () => {
  it("puts baolicannes.com first for BAOLI SAS + Cannes", () => {
    const domains = guessCompanyDomainWithCity("BAOLI SAS", "Cannes");
    expect(domains[0]).toBe("baolicannes.com");
  });

  it("includes hyphenated city variant", () => {
    const domains = guessCompanyDomainWithCity("BAOLI SAS", "Cannes");
    expect(domains).toContain("baoli-cannes.com");
  });

  it("includes standard .com fallback", () => {
    const domains = guessCompanyDomainWithCity("BAOLI SAS", "Cannes");
    expect(domains).toContain("baoli.com");
  });

  it("strips legal suffixes before building domain", () => {
    const domains = guessCompanyDomainWithCity("RIVIERA HOSPITALITY SAS", "Cannes");
    expect(domains[0]).toBe("rivierahospitalitycannes.com");
    // Key check: SAS suffix must not appear in any domain
    for (const d of domains) expect(d).not.toMatch(/sas/);
  });

  it("handles no city — returns standard variants only", () => {
    const domains = guessCompanyDomainWithCity("ACME LOGISTICS GMBH", null);
    expect(domains).toContain("acmelogistics.com");
    expect(domains).not.toContain("acmelogisticsnull.com");
  });

  it("handles accented city names (Zürich → zurich)", () => {
    const domains = guessCompanyDomainWithCity("SWISS PRIVATE AG", "Zürich");
    expect(domains[0]).toBe("swissprivatezurich.com");
  });

  it("strips accent from company name too", () => {
    const domains = guessCompanyDomainWithCity("RÉSIDENCE DU PALAIS SAS", "Cannes");
    expect(domains[0]).toMatch(/cannes/);
    for (const d of domains) expect(d).not.toMatch(/[éàîôù]/);
  });

  it("returns at most 8 results", () => {
    const domains = guessCompanyDomainWithCity("BIG GLOBAL CORP", "London");
    expect(domains.length).toBeLessThanOrEqual(8);
  });

  it("deduplicates identical variants", () => {
    const domains = guessCompanyDomainWithCity("ACME INC", null);
    expect(new Set(domains).size).toBe(domains.length);
  });
});

// ── extractCity ──────────────────────────────────────────────────────────────

describe("extractCity", () => {
  it("extracts city from European postal-code format '06400 Cannes'", () => {
    expect(extractCity("06400 Cannes, France", null)).toBe("Cannes");
  });

  it("extracts city from French address string", () => {
    expect(extractCity("Port Pierre Canto, Boulevard de la Croisette, 06400 Cannes", null)).toBe("Cannes");
  });

  it("extracts city from German postal-code format '10115 Berlin'", () => {
    expect(extractCity("Friedrichstraße 10, 10115 Berlin, Germany", null)).toBe("Berlin");
  });

  it("extracts city from Italian postal-code format '20121 Milano'", () => {
    expect(extractCity("Via Monte Napoleone 1, 20121 Milano, Italy", null)).toBe("Milano");
  });

  it("extracts city from JSON array of residence strings", () => {
    expect(extractCity(JSON.stringify(["Port Pierre Canto, 06400 Cannes, France"]), null)).toBe("Cannes");
  });

  it("extracts city from metadata JSON city field", () => {
    expect(extractCity(null, JSON.stringify({ city: "Monaco" }))).toBe("Monaco");
  });

  it("extracts city from metadata JSON registeredCity field", () => {
    expect(extractCity(null, JSON.stringify({ registeredCity: "Zurich" }))).toBe("Zurich");
  });

  it("extracts city from metadata JSON registeredAddress with postal code", () => {
    // Postal-code format triggers the European postal-code regex → "Paris"
    expect(extractCity(null, JSON.stringify({ registeredAddress: "1 Rue de Rivoli, 75001 Paris, France" }))).toBe("Paris");
  });

  it("returns null for empty inputs", () => {
    expect(extractCity(null, null)).toBeNull();
    expect(extractCity("", "")).toBeNull();
  });

  it("returns null for bare country name", () => {
    // 'France' alone should not be returned as the city
    expect(extractCity("France", null)).toBeNull();
  });

  it("extracts city from UK address without postcode in city position", () => {
    // "United Kingdom" is recognised as a country → beforeCountry is "London"
    const city = extractCity("123 Oxford Street, London, United Kingdom", null);
    expect(city).toBe("London");
  });
});

describe("looksLikePersonName", () => {
  it("rejects product and institution phrases from company snippets", () => {
    expect(looksLikePersonName("The Secure Endpoint")).toBe(false);
    expect(looksLikePersonName("Acrylic Powder")).toBe(false);
    expect(looksLikePersonName("Air Force")).toBe(false);
    expect(looksLikePersonName("United States")).toBe(false);
  });

  it("keeps a normal executive name eligible", () => {
    expect(looksLikePersonName("Samih Sawiris")).toBe(true);
  });
});
