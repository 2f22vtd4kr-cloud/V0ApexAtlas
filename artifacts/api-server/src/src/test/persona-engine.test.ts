import { describe, expect, it } from "vitest";
import { ALL_PERSONAS, PERSONA_META, shouldRequestContactFollowUp } from "../lib/persona-engine";

describe("persona roster", () => {
  it("contains the eight core specialists plus the three requested project personas", () => {
    expect(ALL_PERSONAS).toHaveLength(11);
    expect(ALL_PERSONAS).toEqual(expect.arrayContaining([
      "user_operator",
      "development_team",
      "osint_specialists_team",
    ]));
    expect(PERSONA_META.user_operator.label).toBe("User / Principal Operator");
    expect(PERSONA_META.development_team.label).toBe("Development Team");
    expect(PERSONA_META.osint_specialists_team.label).toBe("OSINT Specialists Team");
  });
});

describe("persona contact follow-up rule", () => {
  it("requires another pass after a zero-yield HNWI review", () => {
    expect(shouldRequestContactFollowUp({
      entityType: "HNWI",
      approvedContactValues: [],
      contactOutcome: "organization_contact",
    })).toBe(true);
  });

  it("does not follow up when a personal route is already present", () => {
    expect(shouldRequestContactFollowUp({
      entityType: "HNWI",
      approvedContactValues: [],
      contactOutcome: "direct_contact_candidate",
    })).toBe(false);
  });

  it("does not apply the direct-target rule to property vehicles", () => {
    expect(shouldRequestContactFollowUp({
      entityType: "Corporation",
      approvedContactValues: [],
      contactOutcome: "organization_contact",
    })).toBe(false);
  });
});