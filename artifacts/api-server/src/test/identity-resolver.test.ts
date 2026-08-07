import {
  buildIdentityBundle,
  normalizeIdentityName,
  scoreIdentityMatch,
} from "../lib/identity-resolver";
import { evaluateIdentityGate } from "../lib/identity-gate";
import { describe, expect, it } from "vitest";

describe("Phase J3 identity resolver", () => {
  it("normalizes diacritics and generates order/initial variants", () => {
    expect(normalizeIdentityName("Élodie de Saint-Pierre")).toBe("elodie de saint pierre");

    const bundle = buildIdentityBundle({
      id: 1,
      name: "Élodie de Saint-Pierre",
      type: "HNWI",
      sourceRegistries: JSON.stringify(["SEC EDGAR"]),
    });

    expect(bundle.variants).toEqual(expect.arrayContaining([
      "elodie de saint pierre",
      "elodie edsp",
    ]));
  });

  it("rejects a same-name match without contextual evidence", () => {
    const left = buildIdentityBundle({
      id: 1,
      name: "Alex Morgan",
      type: "HNWI",
      sourceRegistries: JSON.stringify(["SEC EDGAR"]),
    });
    const right = buildIdentityBundle({
      id: 2,
      name: "Morgan Alex",
      type: "HNWI",
      sourceRegistries: JSON.stringify(["Companies House UK"]),
    });

    expect(scoreIdentityMatch(left, right)).toBeNull();
  });

  it("scores a cross-registry match only when affiliation/location context corroborates it", () => {
    const left = buildIdentityBundle({
      id: 1,
      name: "Alex Morgan",
      type: "HNWI",
      nationality: "GB",
      sourceRegistries: JSON.stringify(["SEC EDGAR"]),
      metadata: JSON.stringify({ companyName: "Northstar Holdings" }),
    });
    const right = buildIdentityBundle({
      id: 2,
      name: "Morgan Alex",
      type: "HNWI",
      nationality: "GB",
      sourceRegistries: JSON.stringify(["Companies House UK"]),
      metadata: JSON.stringify({ companyName: "Northstar Holdings" }),
    });

    const match = scoreIdentityMatch(left, right);
    expect(match).not.toBeNull();
    expect(match?.score).toBeGreaterThanOrEqual(0.62);
    expect(match?.signals).toEqual(expect.arrayContaining([
      "shared_affiliation",
      "shared_location",
      "cross_registry",
    ]));
  });

  it("preserves registry identifiers as corroborating identity evidence", () => {
    const left = buildIdentityBundle({
      id: 1,
      name: "Northstar Holdings LLC",
      type: "Corporation",
      sourceRegistries: JSON.stringify(["FAA"]),
      metadata: JSON.stringify({ companyNumber: "C123456" }),
      notes: "Company #C123456",
    });
    const right = buildIdentityBundle({
      id: 2,
      name: "Northstar Holdings",
      type: "Corporation",
      sourceRegistries: JSON.stringify(["Companies House UK"]),
      metadata: JSON.stringify({ companyNumber: "C123456" }),
    });

    const match = scoreIdentityMatch(left, right);
    expect(match?.signals).toContain("shared_registry_identifier");
  });

  it("keeps same-name candidates out of the graph until independent evidence clears the gate", () => {
    const review = evaluateIdentityGate({
      score: 0.74,
      signals: ["shared_affiliation", "cross_registry"],
      leftSources: ["SEC EDGAR"],
      rightSources: ["Companies House UK"],
    });
    expect(review.decision).toBe("review");

    const accepted = evaluateIdentityGate({
      score: 0.9,
      signals: ["shared_registry_identifier", "cross_registry"],
      leftSources: ["SEC EDGAR"],
      rightSources: ["Companies House UK"],
    });
    expect(accepted.decision).toBe("accepted");
  });
});