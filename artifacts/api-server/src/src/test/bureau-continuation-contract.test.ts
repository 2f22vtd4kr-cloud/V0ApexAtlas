import { describe, expect, it } from "vitest";
import {
  RunBureauCaseBossReviewParams,
  RunBureauCaseBossReviewResponse,
  RunBureauCaseDiscoveryParams,
  RunBureauCaseDiscoveryResponse,
  RunBureauCaseNextPassParams,
  RunBureauCaseNextPassResponse,
} from "@workspace/api-zod";

const jobResponse = {
  caseId: 7,
  jobId: "job-123",
  pollUrl: "/api/ingest/job/job-123",
  caseUrl: "/api/research/bureau/cases/7",
  message: "started",
};

describe("Bureau continuation API contract", () => {
  it("accepts numeric-string case IDs from Express params", () => {
    expect(RunBureauCaseDiscoveryParams.parse({ caseId: "7" }).caseId).toBe(7);
    expect(RunBureauCaseNextPassParams.parse({ caseId: "7" }).caseId).toBe(7);
    expect(RunBureauCaseBossReviewParams.parse({ caseId: "7" }).caseId).toBe(7);
  });

  it("rejects missing, non-numeric, and non-positive IDs", () => {
    for (const params of [{}, { caseId: "abc" }, { caseId: 0 }, { caseId: -1 }]) {
      expect(() => RunBureauCaseNextPassParams.parse(params)).toThrow();
    }
  });

  it("keeps all three 202 operations on the shared job envelope", () => {
    expect(RunBureauCaseDiscoveryResponse.parse(jobResponse)).toEqual(jobResponse);
    expect(RunBureauCaseNextPassResponse.parse(jobResponse)).toEqual(jobResponse);
    expect(RunBureauCaseBossReviewResponse.parse(jobResponse)).toEqual(jobResponse);
    expect(() => RunBureauCaseNextPassResponse.parse({ caseId: 7 })).toThrow();
  });
});