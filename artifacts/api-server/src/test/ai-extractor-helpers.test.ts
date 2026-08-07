import { describe, expect, it } from "vitest";
import { buildPerplexityPrompt, extractJsonObject } from "../lib/ai-extractor";

describe("AI response safety helpers", () => {
  it("extracts the first balanced JSON object instead of greedily merging objects", () => {
    const raw = '```json\n{"email":"first@example.org","nested":{"ok":true}}\n```\n{"ignored":true}';
    expect(extractJsonObject(raw)).toBe('{"email":"first@example.org","nested":{"ok":true}}');
  });

  it("handles braces inside quoted strings", () => {
    expect(extractJsonObject('prefix {"basis":"text with } brace","email":null} suffix'))
      .toBe('{"basis":"text with } brace","email":null}');
  });

  it("unwraps provider JSON strings and decodes HTML-escaped punctuation", () => {
    const raw = JSON.stringify('{ "ownershipSummary": "Michael &amp; Co.", "email": null }');
    expect(extractJsonObject(raw)).toBe('{ "ownershipSummary": "Michael & Co.", "email": null }');
  });

  it("rejects incomplete or non-object responses", () => {
    expect(extractJsonObject("not json")).toBeNull();
    expect(extractJsonObject('{"email":"broken"')).toBeNull();
  });

  it("requires identity anchors and claim-level evidence before promoting findings", () => {
    const prompt = buildPerplexityPrompt("Example Holdings", "Corporation", "US", { city: "New York" });
    expect(prompt).toContain("target fingerprint first");
    expect(prompt).toContain("at least two independent anchors");
    expect(prompt).toContain("claim-level provenance");
    expect(prompt).toContain("Reject entity drift");
    expect(prompt).toContain("A username match, email-platform presence");
    expect(prompt).toContain('"identityAssessment": "confirmed | probable | ambiguous | not_established"');
    expect(prompt).toContain('"negativeFindings"');
    expect(prompt).toContain('"searchGaps"');
  });
});