import { describe, expect, it } from "vitest";
import { runSherlock } from "../lib/python-tools";

describe("optional username discovery contract", () => {
  it("rejects invalid usernames without starting a subprocess", async () => {
    const result = await runSherlock("###");
    expect(result.available).toBe(false);
    expect(result.reviewOnly).toBe(true);
    expect(result.found).toEqual([]);
    expect(result.error).toBe("Invalid username");
  });
});