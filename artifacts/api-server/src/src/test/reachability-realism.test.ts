import { describe, expect, it } from "vitest";
import { assessTargetReachability } from "../lib/reachability-realism";

describe("target reachability realism", () => {
  it("bounds a Buffett-like prominent isolated target before expensive research", () => {
    const result = assessTargetReachability({
      type: "HNWI",
      estimatedNetWorth: 130_000_000_000,
      contactOutcome: "social_only",
      contactConfidence: 18,
      metadata: JSON.stringify({ publicProminence: true }),
      networkDegree: 0,
      gatekeeperConnections: 0,
      intermediaryConnections: 0,
    });

    expect(result.status).toBe("research_only");
    expect(result.mode).toBe("research_only");
    expect(result.score).toBeLessThan(20);
  });

  it("keeps a validated direct vector on the normal research path", () => {
    const result = assessTargetReachability({
      type: "HNWI",
      estimatedNetWorth: 2_000_000_000,
      email: "principal@familyoffice.example",
      phone: "+14155552671",
      contactOutcome: "direct_contact_verified",
      metadata: JSON.stringify({ publicProminence: true }),
      networkDegree: 0,
    });

    expect(result.status).toBe("direct");
    expect(result.mode).toBe("full");
    expect(result.hasDirectContact).toBe(true);
  });

  it("uses a corroborated intermediary path without claiming direct access", () => {
    const result = assessTargetReachability({
      type: "HNWI",
      estimatedNetWorth: 800_000_000,
      contactOutcome: "none",
      metadata: JSON.stringify({ publicProminence: true }),
      networkDegree: 1,
      gatekeeperConnections: 1,
      intermediaryConnections: 1,
    });

    expect(result.status).toBe("intermediary");
    expect(result.mode).toBe("full");
    expect(result.hasDirectContact).toBe(false);
    expect(result.hasIntermediaryPath).toBe(true);
  });

  it("does not treat a social-only celebrity as reachable", () => {
    const result = assessTargetReachability({
      type: "HNWI",
      estimatedNetWorth: 400_000_000,
      contactOutcome: "social_only",
      instagramHandle: "publicprofile",
      metadata: JSON.stringify({ prominence: "high" }),
      networkDegree: 0,
    });

    expect(result.hasDirectContact).toBe(false);
    expect(result.hasIntermediaryPath).toBe(false);
    expect(result.status).toBe("research_only");
  });

  it("never creates access from fame or wealth alone", () => {
    const result = assessTargetReachability({
      type: "HNWI",
      estimatedNetWorth: 10_000_000_000,
      metadata: JSON.stringify({ publicProminence: true }),
      networkDegree: 0,
    });

    expect(result.hasDirectContact).toBe(false);
    expect(result.hasIntermediaryPath).toBe(false);
    expect(result.status).toBe("research_only");
  });

  it("does not treat a registry phone as validated personal access", () => {
    const result = assessTargetReachability({
      type: "HNWI",
      phone: "+15166087000",
      phoneSource: "EDGAR-Phone",
      contactOutcome: "organization_contact",
      knownResidences: "Port Washington, NY",
      metadata: JSON.stringify({ publicProminence: true }),
    });

    expect(result.hasDirectContact).toBe(false);
    expect(result.status).toBe("bounded");
    expect(result.reasons).not.toContain("validated person-level direct contact is present");
    expect(result.blockers).toContain("organization contact is not personal access to the individual");
  });
});