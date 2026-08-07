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
  guessRelatedOrganizationDomains,
  extractCity,
  extractRelatedOrganizationNames,
  buildRouteHierarchy,
  looksLikePersonName,
  hasTargetLinkedPersonEvidence,
  extractOfficialRoleLinkedPersonNames,
  extractReviewPersonCandidates,
  classifyScrapedPageCoverage,
} from "../lib/web-enricher";
import { buildInvestigatorResearchPlan } from "../lib/research-plan";

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

describe("related organization domain expansion", () => {
  it("tries the shortened operator brand domain before generic guesses", () => {
    expect(guessRelatedOrganizationDomains("Amaron Real Estate AB", "SE", "Malmö")[0])
      .toBe("amaron.se");
    expect(guessRelatedOrganizationDomains("Amaron Real Estate AB", "SE", "Malmö"))
      .toContain("amaron.com");
  });
});

describe("official team-page person extraction", () => {
  it("extracts names placed immediately before concrete roles", () => {
    const text = [
      "Our Team | Meet Our Experts",
      "Kjell Rudsby Risk Manager, Compliance Officer, Partner",
      "Stefan Wilhelmson Managing Director, Board Director, Partner, Investment Team Member",
      "Martin Mildner Portfolio Manager, Board Director, Partner, Head of Investment Team",
    ].join(" ");

    expect(extractOfficialRoleLinkedPersonNames(text)).toEqual([
      "Kjell Rudsby",
      "Stefan Wilhelmson",
      "Martin Mildner",
    ]);
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

describe("investigator research planning", () => {
  it("promotes a C/O operator into an explicit related-organization target", () => {
    expect(extractRelatedOrganizationNames(
      "C/O Amaron Real Estate AB, Södergatan 28, Malmö, 211 34, SE",
      null,
      null,
    )).toContain("Amaron Real Estate AB");
  });

  it("plans structure and people before route ranking", () => {
    const plan = buildInvestigatorResearchPlan({
      legalName: "Amaron Helsingborg Topasen 7 AB",
      tradingName: "Amaron Helsingborg Topasen 7",
      city: "Helsingborg",
      country: "SE",
      entityType: "Corporation",
      relatedOrganizations: ["Amaron Real Estate AB"],
    });
    expect(plan.method).toBe("investigator_v1");
    expect(plan.stages.map((stage) => stage.id)).toEqual([
      "identity", "structure", "people", "official_routes", "person_followups", "route_ranking",
    ]);
    expect(plan.stages[1]?.targetNames).toContain("Amaron Real Estate AB");
  });

  it("retains target subject metadata and explicit coverage gaps", () => {
    const plan = buildInvestigatorResearchPlan({
      legalName: "Orient Express",
      tradingName: "Orient Express",
      city: null,
      country: "FR",
      entityType: "Corporation",
      subjectKind: "brand",
      anchors: ["Accor", "LVMH"],
      disambiguationNotes: ["Belmond and Arsenale are related but separate subjects"],
      coverage: {
        lanes: {
          official_records: "review",
          people_press: "complete",
          contact_routes: "blocked",
          semantic_discovery: "unavailable",
        },
        negativeFindings: ["No person-attributed direct route found"],
        searchGaps: ["Arsenale page blocked by anti-bot challenge"],
      },
    });
    expect(plan.target.subjectKind).toBe("brand");
    expect(plan.target.anchors).toEqual(["Accor", "LVMH"]);
    expect(plan.coverage?.lanes.contact_routes).toBe("blocked");
    expect(plan.coverage?.searchGaps[0]).toContain("blocked");
  });

  it("ranks a named direct route above executive, operator, and organization routes", () => {
    const evidence = [
      {
        vectorType: "email" as const,
        value: "target@example.com",
        source: "official",
        sourceUrl: "https://target.example/contact",
        extractionMethod: "page",
        confidence: 90,
        details: { scope: "target_person", relationship: "target-person-extraction" },
      },
      {
        vectorType: "email" as const,
        value: "executive@amaron.se",
        source: "official",
        sourceUrl: "https://amaron.se/team",
        extractionMethod: "page",
        confidence: 88,
        details: {
          scope: "person_candidate",
          personName: "Martin Mildner",
          role: "operator",
          relationship: "named-executive-official-page",
        },
      },
      {
        vectorType: "phone" as const,
        value: "+46 40 000 000",
        source: "official",
        sourceUrl: "https://amaron.se/contact",
        extractionMethod: "page",
        confidence: 80,
        details: { scope: "organization", relationship: "operator-parent-route" },
      },
    ];
    const funnel = {
      totalCandidates: 3,
      discovered: 0,
      sourceLinked: 2,
      attributionReview: 1,
      independentlyCorroborated: 0,
      verifiedDirectRoute: 1,
      rejected: 0,
      organizationOnly: 1,
      conflicted: 0,
      independentSourceDomains: 3,
      candidates: [
        {
          key: "email|target@example.com",
          vectorType: "email" as const,
          value: "target@example.com",
          providers: ["official"],
          sourceDomains: ["target.example"],
          sourceUrls: ["https://target.example/contact"],
          scopes: ["target_person" as const],
          personNames: [],
          state: "verified_direct_route" as const,
          conflictCount: 0,
          exactClaimObserved: true,
          blockedSourceUrls: [],
        },
        {
          key: "email|executive@amaron.se",
          vectorType: "email" as const,
          value: "executive@amaron.se",
          providers: ["official"],
          sourceDomains: ["amaron.se"],
          sourceUrls: ["https://amaron.se/team"],
          scopes: ["person_candidate" as const],
          personNames: ["Martin Mildner"],
          state: "source_linked" as const,
          conflictCount: 0,
          exactClaimObserved: true,
          blockedSourceUrls: [],
        },
        {
          key: "phone|4640000000",
          vectorType: "phone" as const,
          value: "+46 40 000 000",
          providers: ["official"],
          sourceDomains: ["amaron.se"],
          sourceUrls: ["https://amaron.se/contact"],
          scopes: ["organization" as const],
          personNames: [],
          state: "source_linked" as const,
          conflictCount: 0,
          exactClaimObserved: true,
          blockedSourceUrls: [],
        },
      ],
    };
    const routes = buildRouteHierarchy(evidence, funnel);
    expect(routes.map((route) => route.tier)).toEqual([
      "direct_person", "executive", "operator_parent",
    ]);
    expect(routes[1]?.personName).toBe("Martin Mildner");
    expect(routes[2]?.note).toMatch(/operator|parent/i);
  });
});

describe("scraped page coverage", () => {
  it("distinguishes usable, bot-blocked, and unavailable pages", () => {
    expect(classifyScrapedPageCoverage({ unavailableReason: null, botBlocked: false }))
      .toBe("usable");
    expect(classifyScrapedPageCoverage({ unavailableReason: null, botBlocked: true }))
      .toBe("blocked");
    expect(classifyScrapedPageCoverage({ unavailableReason: "http_403", botBlocked: false }))
      .toBe("unavailable");
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

  it("rejects German editorial and search UI fragments", () => {
    expect(looksLikePersonName("Der Fußballklub")).toBe(false);
    expect(looksLikePersonName("Fußballvereine Kölner")).toBe(false);
    expect(looksLikePersonName("Accessibility Feedback Deutsch")).toBe(false);
  });
});

describe("broad search-card person discovery", () => {
  it("retains a professional-card name without treating it as verified identity", () => {
    const candidates = extractReviewPersonCandidates(
      "Lev van der Eng — Managing Director at CarCollect. LinkedIn profile and company context.",
    );
    expect(candidates).toContain("Lev van der Eng");
  });

  it("does not admit generic company text as a person lead", () => {
    expect(extractReviewPersonCandidates(
      "CarCollect is a vehicle marketplace. Contact the executive team for details.",
    )).toEqual([]);
  });
});

describe("hasTargetLinkedPersonEvidence", () => {
  it("accepts an explicitly attributed person near the corporation anchor", () => {
    expect(hasTargetLinkedPersonEvidence(
      "KH Group Oyj was founded by Jane Doe and operates in Finland.",
      "Jane Doe",
      ["KH Group Oyj", "Finland"],
    )).toBe(true);
  });

  it("rejects unrelated proper nouns from provider fan-out", () => {
    expect(hasTargetLinkedPersonEvidence(
      "KH Group Oyj is a Finnish public company. Khan Academy offers free online courses. Launch Day is a product event.",
      "Khan Academy",
      ["KH Group Oyj", "Finland"],
    )).toBe(false);
  });

  it("rejects a person name without an explicit role or ownership claim", () => {
    expect(hasTargetLinkedPersonEvidence(
      "KH Group Oyj lists Jane Doe in a general article and has offices in Helsinki.",
      "Jane Doe",
      ["KH Group Oyj", "Helsinki"],
    )).toBe(false);
  });
});
