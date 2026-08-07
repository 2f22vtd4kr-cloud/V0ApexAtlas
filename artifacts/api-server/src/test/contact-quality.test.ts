import { describe, expect, it } from "vitest";
import {
  isValidPublicEmail,
  sanitizePublicEmail,
  sanitizePublicSocialHandle,
  sanitizePublicSocialUrl,
} from "../lib/contact-validation";
import {
  computeContactConfidence,
  hasMeaningfulDirectContact,
  isPersonalContactOutcome,
} from "../lib/contact-confidence";

describe("public contact quality guardrails", () => {
  it("rejects constructed and infrastructure emails", () => {
    expect(isValidPublicEmail("first.last@example.com")).toBe(false);
    expect(sanitizePublicEmail("owner@cloudflare.com")).toBeNull();
    expect(sanitizePublicEmail("first.last@domain.com")).toBeNull();
  });

  it("accepts only real social profile handles", () => {
    expect(sanitizePublicSocialHandle("https://instagram.com/alice", "instagram")).toBe("alice");
    expect(sanitizePublicSocialHandle("@alice_x", "twitter")).toBe("alice_x");
    expect(sanitizePublicSocialHandle("https://twitter.com/search", "twitter")).toBeNull();
    expect(sanitizePublicSocialUrl("https://linkedin.com/company/acme", "linkedin", "person")).toBeNull();
  });

  it("does not let invalid or organisational contacts inflate personal access", () => {
    expect(computeContactConfidence({
      email: "info@person.example",
      twitterHandle: "search",
      instagramHandle: "p",
    })).toBe(0);
    expect(computeContactConfidence({
      type: "Corporation",
      email: "founder@company.example",
      phone: "+14155552671",
    })).toBe(0);
  });

  it("requires a meaningful personal email or phone for hot status", () => {
    expect(hasMeaningfulDirectContact({ email: "info@venue.example" })).toBe(false);
    expect(hasMeaningfulDirectContact({ phone: "415-555-2671" })).toBe(true);
    expect(hasMeaningfulDirectContact({ type: "Trust", phone: "+14155552671" })).toBe(false);
  });

  it("keeps organization evidence out of personal Phase J metrics", () => {
    expect(isPersonalContactOutcome("organization_contact")).toBe(false);
    expect(isPersonalContactOutcome("direct_contact_candidate")).toBe(true);
    expect(isPersonalContactOutcome("direct_contact_verified")).toBe(true);
  });
});