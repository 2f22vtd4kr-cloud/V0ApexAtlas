import { describe, expect, it } from "vitest";
import {
  hasAttributableWealthEvidence,
  hasQualifyingWealthEvidence,
  isRoleOnlyCandidateName,
} from "../lib/enrichment/broad-discovery";
import {
  classifyEntityType,
  isPlaceholderRegistryName,
} from "../lib/western-hnwi-ingestion";

describe("broad discovery evidence gate", () => {
  it("rejects an employee or management-directory mention", () => {
    expect(hasQualifyingWealthEvidence(
      "The Casino management team includes Morgane Iapella, an Event Project Manager.",
      '"casino" owner director Monte Carlo',
    )).toBe(false);
  });

  it("accepts a person explicitly tied to ownership", () => {
    expect(hasQualifyingWealthEvidence(
      "Samih Sawiris is the owner and investor behind the resort group.",
      '"ski resort" owner investor Alps',
    )).toBe(true);
  });

  it("accepts a principal role with wealth context", () => {
    expect(hasQualifyingWealthEvidence(
      "The family office was founded by Ingrid Magnusson, its principal and investor.",
      '"family office" principal Switzerland',
    )).toBe(true);
  });

  it("requires the candidate name to be tied to the qualifying claim", () => {
    expect(hasAttributableWealthEvidence(
      "Armelle Falcy",
      "By Per-Henrik Mansson. The owner of the estate is another family.",
    )).toBe(false);
    expect(hasAttributableWealthEvidence(
      "Albada Jelgersma",
      "Albada Jelgersma is the owner of Château Giscours and acquired a Tuscan estate.",
    )).toBe(true);
  });

  it("rejects service-page names even when the page contains ownership language", () => {
    expect(hasAttributableWealthEvidence(
      "Victoria Meeke",
      "Victoria Meeke is our French Villa Specialist. We help owners manage luxury villas.",
    )).toBe(false);
  });

  it("rejects fictional cultural references from venue copy", () => {
    expect(hasAttributableWealthEvidence(
      "James Bond",
      "The image of James Bond has become inseparable from the Casino de Monte-Carlo, founded by François Blanc.",
    )).toBe(false);
  });

  it("rejects excluded names even when nearby text contains ownership language", () => {
    expect(hasAttributableWealthEvidence(
      "Sherlock Holmes",
      "Sherlock Holmes is the fictional owner of a private estate and investor in the resort.",
    )).toBe(false);
  });

  it("rejects a role fragment that looks like a person name", () => {
    expect(isRoleOnlyCandidateName("Rocco Forte Deputy")).toBe(true);
    expect(isRoleOnlyCandidateName("Samih Sawiris")).toBe(false);
  });

  it("classifies organization-shaped industry names as corporations", () => {
    expect(classifyEntityType("Viken Shipping")).toBe("Corporation");
    expect(classifyEntityType("KH Group Oyj")).toBe("Corporation");
  });

  it("does not classify role-shaped snippets as HNWI", () => {
    expect(classifyEntityType("Rocco Forte Deputy")).not.toBe("HNWI");
  });

  it("rejects registry placeholder names before insertion", () => {
    expect(isPlaceholderRegistryName("Unknown")).toBe(true);
    expect(isPlaceholderRegistryName(" Unknown Company ")).toBe(true);
    expect(isPlaceholderRegistryName("Entity 42")).toBe(true);
    expect(isPlaceholderRegistryName("Patrick Remme")).toBe(false);
  });

  it("exposes a single-admission discovery adapter for sequential Atlas cooking", async () => {
    const { discoverSingleTemplate } = await import("../lib/enrichment/broad-discovery");
    expect(discoverSingleTemplate).toBeTypeOf("function");
  });

  it("keeps placeholder names out of target admission", async () => {
    const source = await import("../lib/atlas-orchestrator");
    expect(source.isPlaceholderEntityName("Unknown")).toBe(true);
    expect(source.isPlaceholderEntityName("Entity 42")).toBe(true);
    expect(source.isPlaceholderEntityName("Samih Sawiris")).toBe(false);
  });
});