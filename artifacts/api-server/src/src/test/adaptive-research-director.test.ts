import { describe, expect, it } from "vitest";
import {
  createAdaptiveResearchState,
  selectNextAdaptiveAction,
  type AdaptiveResearchState,
} from "../lib/adaptive-research-director";

function state(overrides: Partial<AdaptiveResearchState> = {}): AdaptiveResearchState {
  return {
    ...createAdaptiveResearchState({
      targetName: "Campione S.p.A.",
      targetType: "Corporation",
      country: "IT",
      context: {
        relatedOrganizations: [],
        candidateDomains: [],
      },
    }),
    ...overrides,
  };
}

describe("adaptive research director action selection", () => {
  it("starts with identity resolution instead of a generic contact lane", () => {
    const action = selectNextAdaptiveAction(state());
    expect(action.kind).toBe("resolve_identity");
    expect(action.lane).toBe("official_records");
  });

  it("follows a newly discovered person before spending another generic provider pass", () => {
    const action = selectNextAdaptiveAction(state({
      identityAssessment: "confirmed",
      completedActions: ["resolve_identity"],
      completedLanes: ["official_records"],
      discoveredPeople: ["Stefano Silvestri"],
      candidateDomains: ["campioneditalia.com"],
    }));
    expect(action.kind).toBe("official_routes");
    const followUp = selectNextAdaptiveAction(state({
      identityAssessment: "confirmed",
      completedActions: ["resolve_identity", "official_routes"],
      completedLanes: ["official_records"],
      discoveredPeople: ["Stefano Silvestri"],
      candidateDomains: ["campioneditalia.com"],
    }));
    expect(followUp.kind).toBe("follow_person");
    expect(followUp.subject).toBe("Stefano Silvestri");
  });

  it("stops after a bounded no-progress budget and never repeats a lane", () => {
    const action = selectNextAdaptiveAction(state({
      identityAssessment: "confirmed",
      completedActions: ["resolve_identity", "resolve_structure", "official_routes", "complementary_lane"],
      completedLanes: ["official_records", "semantic_discovery", "people_press", "contact_routes"],
      noProgressPasses: 2,
    }));
    expect(action.kind).toBe("stop_review");
  });
});