import { describe, expect, it } from "vitest";
import { averageSourceReliability, getSourceReliability } from "../lib/source-reliability";

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
});