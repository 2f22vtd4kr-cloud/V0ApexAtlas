import { describe, expect, it } from "vitest";
import { averageSourceReliability, getSourceReliability } from "../lib/source-reliability";
import { isAcceptedIcijMatch } from "../lib/icij-enricher";

describe("source reliability registry", () => {
  it("ranks official registries above derived discovery sources", () => {
    expect(getSourceReliability("SEC EDGAR").reliability).toBeGreaterThan(
      getSourceReliability("AI OSINT (Groq extraction)").reliability,
    );
    expect(getSourceReliability("SEC EDGAR").ownership).toBeGreaterThan(0.8);
  });

  it("keeps unknown source families conservative", () => {
    const result = getSourceReliability("Unlisted blog");
    expect(result.reliability).toBeLessThan(0.5);
    expect(result.rationale).toMatch(/review/i);
  });

  it("deduplicates source labels when calculating an average", () => {
    expect(averageSourceReliability(["SEC EDGAR", "SEC EDGAR"])).toBe(0.94);
  });

  it("recognizes free live ADS-B fallback sources", () => {
    const adsb = getSourceReliability("adsb.lol");
    expect(adsb.reliability).toBeGreaterThan(0.7);
    expect(adsb.contact).toBeLessThan(0.1);
    expect(adsb.rationale).toMatch(/aircraft|access/i);
  });

  it("keeps sanctions evidence separate from personal access", () => {
    const ofac = getSourceReliability("OFAC SDN");
    expect(ofac.reliability).toBeGreaterThan(0.9);
    expect(ofac.contact).toBeLessThan(0.1);
    expect(ofac.ownership).toBeLessThan(0.5);
  });

  it("rejects ICIJ fuzzy suggestions as evidence", () => {
    expect(isAcceptedIcijMatch({
      id: "suggestion",
      name: "Similar Name",
      score: 99,
      match: false,
      type: [],
    })).toBe(false);
    expect(isAcceptedIcijMatch({
      id: "confirmed",
      name: "Exact Name",
      score: 100,
      match: true,
      type: [],
    })).toBe(true);
  });
});