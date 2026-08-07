import { describe, expect, it } from "vitest";
import { classifyTemporalState, computeFreshnessScore, isValidAt } from "../lib/temporal-evidence";

describe("temporal evidence", () => {
  const now = new Date("2026-08-01T00:00:00.000Z");

  it("decays old observations without making future observations stronger than current ones", () => {
    expect(computeFreshnessScore("2026-08-01", now)).toBe(1);
    expect(computeFreshnessScore("2026-02-01", now)).toBeGreaterThan(0.4);
    expect(computeFreshnessScore("2022-01-01", now)).toBeLessThan(0.1);
    expect(computeFreshnessScore("2027-01-01", now)).toBe(1);
  });

  it("classifies claims for review", () => {
    expect(classifyTemporalState("2026-08-01", now)).toBe("current");
    expect(classifyTemporalState("2026-02-01", now)).toBe("aging");
    expect(classifyTemporalState(null, now)).toBe("unknown");
  });

  it("honours explicit validity windows", () => {
    expect(isValidAt("2026-01-01", "2026-12-31", now)).toBe(true);
    expect(isValidAt("2027-01-01", null, now)).toBe(false);
    expect(isValidAt(null, "2025-12-31", now)).toBe(false);
  });
});