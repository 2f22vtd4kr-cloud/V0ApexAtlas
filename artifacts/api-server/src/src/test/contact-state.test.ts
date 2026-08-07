import { describe, expect, it } from "vitest";
import { computeContactState } from "../lib/contact-confidence";

describe("contact-state reconciliation", () => {
  it("keeps an organization route out of personal access", () => {
    const state = computeContactState({
      type: "Corporation",
      email: "founder@company.example",
      phone: "+14155552671",
      phoneSource: "CompaniesHouse-Phone",
    });
    expect(state.contactConfidence).toBe(0);
    expect(state.contactOutcome).toBe("organization_contact");
    expect(state.isHot).toBe(false);
  });

  it("keeps unknown-source corporate vectors out of personal access", () => {
    const state = computeContactState({
      type: "Corporation",
      email: "owner@company.example",
      phone: "+14155552671",
      validatedDirectContact: true,
    });
    expect(state.contactConfidence).toBe(0);
    expect(state.contactOutcome).toBe("organization_contact");
    expect(state.isHot).toBe(false);
  });

  it("does not mark a review-only candidate hot", () => {
    const state = computeContactState({
      type: "HNWI",
      email: "person@real-domain.co.uk",
    });
    expect(state.contactOutcome).toBe("direct_contact_candidate");
    expect(state.isHot).toBe(false);
  });

  it("requires explicit validation before a direct route becomes hot", () => {
    const state = computeContactState({
      type: "HNWI",
      email: "person@real-domain.co.uk",
      metadata: { validatedDirectContact: true },
      validatedDirectContact: true,
    });
    expect(state.contactOutcome).toBe("direct_contact_verified");
    expect(state.isHot).toBe(true);
  });
});