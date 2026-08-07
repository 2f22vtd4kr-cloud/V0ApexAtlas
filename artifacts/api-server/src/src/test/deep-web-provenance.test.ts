import { describe, expect, it } from "vitest";
import { scoreByCorroboration } from "../lib/deep-web-osint";

describe("deep-web provenance scoring", () => {
  it("does not treat repeated provider labels as independent evidence", () => {
    const score = scoreByCorroboration(4, [
      { value: "jane@example.org", sourceUrl: "https://publisher.example/profile" },
      { value: "jane@example.org", sourceUrl: "https://publisher.example/profile?utm_source=search" },
    ], "jane@example.org");
    expect(score).toBeLessThan(60);
  });

  it("uses canonical publisher domains when citations are independent", () => {
    const score = scoreByCorroboration(2, [
      { value: "jane@example.org", sourceUrl: "https://publisher.example/profile" },
      { value: "jane@example.org", sourceUrl: "https://conference.example/speaker#bio" },
    ], "jane@example.org");
    expect(score).toBeGreaterThan(scoreByCorroboration(2, [
      { value: "jane@example.org", sourceUrl: "https://publisher.example/profile" },
    ], "jane@example.org"));
  });
});