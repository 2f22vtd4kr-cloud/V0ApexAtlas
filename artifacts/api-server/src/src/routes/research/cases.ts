import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  entitiesTable,
  researchCaseEventsTable,
  researchCasesTable,
} from "@workspace/db";
import {
  AddResearchCaseDirectiveBody,
  AddResearchCaseDirectiveParams,
  AdvanceResearchCaseParams,
  GetResearchCaseParams,
  ListResearchCaseEventsParams,
  ListResearchCaseEventsQueryParams,
  OpenResearchCaseBody,
  GetBureauCaseParams,
  OpenBureauDiscoveryCaseBody,
  AdmitBureauCaseCandidateBody,
  PromoteBureauCaseTargetBody,
  PromoteBureauCaseTargetParams,
  RecordBureauInitialResearchBody,
  RecordBureauInitialResearchParams,
  RunBureauCaseDiscoveryParams,
  RunBureauCaseDiscoveryResponse,
  RunBureauCaseNextPassParams,
  RunBureauCaseBossReviewParams,
  RunBureauCaseNextPassResponse,
  RunBureauCaseBossReviewResponse,
} from "@workspace/api-zod";
import {
  advanceCaseFile,
  applyGeminiBossPlan,
  buildBossOpeningPrompt,
  buildDiscoveryCaseFile,
  appendDiscoveryReport,
  buildDiscoveryProgressSnapshot,
  buildInitialCaseFile,
  GEMINI_BOSS_MODEL_PENDING,
  parseDiscoveryCaseFile,
  parseCaseFile,
  recordRightHandAdvice,
  recordGeminiBossPlan,
  runGeminiBossDiscovery,
  resolveGeminiBossModel,
  DEFAULT_DISCOVERY_MOTIVATION,
  DEFAULT_DISCOVERY_OBJECTIVE,
  runMistralWebSearch,
  runNvidiaNimCaseReasoning,
  runNvidiaNimDiscoveryAdvice,
  runGeminiBossPlan,
} from "../../lib/case-bureau";
import { runBroadDiscovery } from "../../lib/enrichment/broad-discovery";
import { searchRegistry, type RegistryId } from "../../lib/registry-client";
import {
  appendJobLog,
  clearActiveJobIfOwned,
  createJob,
  getActiveJob,
  getJob,
  setActiveJob,
  updateJob,
} from "../../lib/job-queue";

const router = Router();

function serializeCase(
  row: typeof researchCasesTable.$inferSelect,
  entity: { name: string; type: string } | null,
) {
  return {
    ...row,
    targetEntityName: entity?.name ?? null,
    targetEntityType: entity?.type ?? null,
    lastDecisionAt: row.lastDecisionAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeBureauCase(
  row: typeof researchCasesTable.$inferSelect,
  entity: { name: string; type: string } | null,
) {
  return serializeCase(row, entity);
}

function candidateTypeToEntityType(type: string): "HNWI" | "Corporation" | "Trust" | "Gatekeeper" {
  const normalized = type.toLowerCase();
  if (normalized.includes("person") || normalized.includes("individual") || normalized.includes("investor")) return "HNWI";
  if (normalized.includes("intermediary") || normalized.includes("gatekeeper") || normalized.includes("advisor")) return "Gatekeeper";
  if (normalized.includes("trust") || normalized.includes("foundation")) return "Trust";
  return "Corporation";
}

function mergeContactEvidence(
  ...groups: Array<Array<{
    vectorType: string;
    value: string;
    scope: string;
    personName: string | null;
    role: string | null;
    sourceUrls: string[];
    note: string | null;
  }> | undefined>
) {
  return groups.flatMap((group) => group ?? [])
    .filter((item) => item.value.trim())
    .filter((item, index, all) => all.findIndex((other) =>
      other.vectorType === item.vectorType
      && other.value.toLowerCase() === item.value.toLowerCase()
      && (other.personName ?? "").toLowerCase() === (item.personName ?? "").toLowerCase(),
    ) === index)
    .slice(0, 20);
}

type DiscoveryCandidate = ReturnType<typeof parseDiscoveryCaseFile> extends infer T
  ? Exclude<T, null>["discoveredCandidates"][number]
  : never;

function mergeDiscoveryCandidates(
  existing: DiscoveryCandidate[],
  additions: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  const merged = new Map<string, DiscoveryCandidate>();
  for (const candidate of [...existing, ...additions]) {
    const key = candidate.name.trim().toLowerCase();
    if (!key) continue;
    const prior = merged.get(key);
    if (!prior) {
      merged.set(key, candidate);
      continue;
    }
    merged.set(key, {
      ...prior,
      type: prior.type || candidate.type,
      relevance: candidate.relevance || prior.relevance,
      reachability: candidate.reachability || prior.reachability,
      sourceUrls: [...new Set([...prior.sourceUrls, ...candidate.sourceUrls])].slice(0, 20),
      contactEvidence: mergeContactEvidence(prior.contactEvidence, candidate.contactEvidence),
      admittedEntityId: prior.admittedEntityId ?? candidate.admittedEntityId ?? null,
    });
  }
  return [...merged.values()].slice(0, 80);
}

async function persistDiscoveryCheckpoint(
  caseId: number,
  iteration: number,
  file: ReturnType<typeof parseDiscoveryCaseFile> extends infer T ? Exclude<T, null> : never,
  report: Parameters<typeof appendDiscoveryReport>[1],
  summary: string,
) {
  const updatedFile = appendDiscoveryReport(file, report);
  await db.update(researchCasesTable).set({
    caseFile: JSON.stringify(updatedFile),
    updatedAt: new Date(),
  }).where(eq(researchCasesTable.id, caseId));
  await db.insert(researchCaseEventsTable).values({
    caseId,
    iteration,
    actorRole: report.lane === "nvidia-right-hand" ? "right_hand_advisor" : report.lane === "gemini-boss" ? "head_investigator" : "specialist",
    eventType: "observation",
    summary,
    payload: JSON.stringify({
      provider: report.provider,
      lane: report.lane,
      status: report.status,
      reportId: updatedFile.investigatorReports.at(-1)?.id ?? null,
      candidateNames: report.candidateNames,
      sourceUrls: report.sourceUrls,
      nextQuestions: report.nextQuestions,
      contactEvidence: report.contactEvidence ?? [],
      error: report.error,
    }),
  });
  return updatedFile;
}

async function findCase(entityId: number) {
  const [row] = await db.select().from(researchCasesTable).where(eq(researchCasesTable.targetEntityId, entityId)).limit(1);
  return row ?? null;
}

router.post("/research/bureau/cases", async (req, res): Promise<void> => {
  const parsed = OpenBureauDiscoveryCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const objective = parsed.data.objective.trim() || DEFAULT_DISCOVERY_OBJECTIVE;
  const motivation = parsed.data.motivation.trim() || DEFAULT_DISCOVERY_MOTIVATION;
  const caseFile = buildDiscoveryCaseFile({
    objective,
    motivation,
    geography: parsed.data.geography,
    exclusions: parsed.data.exclusions,
  });
  const openingPrompt = buildBossOpeningPrompt({
    objective,
    motivation,
    geography: parsed.data.geography,
    exclusions: parsed.data.exclusions,
  });
  const bossModel = await resolveGeminiBossModel();
  const [created] = await db.insert(researchCasesTable).values({
    targetEntityId: null,
    caseType: "discovery",
    status: "ready",
    directorMode: "gemini_boss_pending",
    directorProvider: "gemini",
    directorModel: bossModel.model,
    objective,
    motivation,
    openingPrompt,
    caseFile: JSON.stringify(caseFile),
    currentAction: caseFile.initialAction.id,
    iteration: 0,
  }).returning();
  if (!created) {
    res.status(500).json({ error: "Unable to open discovery case" });
    return;
  }
  await db.insert(researchCaseEventsTable).values({
    caseId: created.id,
    actorRole: "head_investigator",
    eventType: "case_opened",
    summary: "Discovery case opened; Boss opening brief is ready for text-only Gemini review.",
    payload: JSON.stringify({
      caseType: "discovery",
      directorProvider: "gemini",
      directorModel: bossModel.model,
      modelSelectionStatus: bossModel.status,
      modelCandidateCount: bossModel.candidateCount,
      openingPromptReady: true,
    }),
  });
  res.status(201).json(serializeBureauCase(created, null));
});

router.get("/research/bureau/cases/latest", async (_req, res): Promise<void> => {
  const [row] = await db.select({
    case: researchCasesTable,
    entityName: entitiesTable.name,
    entityType: entitiesTable.type,
  }).from(researchCasesTable)
    .leftJoin(entitiesTable, eq(researchCasesTable.targetEntityId, entitiesTable.id))
    .where(eq(researchCasesTable.caseType, "discovery"))
    .orderBy(desc(researchCasesTable.updatedAt))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "No discovery case exists" });
    return;
  }
  res.json(serializeBureauCase(row.case, row.entityName ? { name: row.entityName, type: row.entityType ?? "Unknown" } : null));
});

router.get("/research/bureau/cases/:caseId", async (req, res): Promise<void> => {
  const params = GetBureauCaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select({
    case: researchCasesTable,
    entityName: entitiesTable.name,
    entityType: entitiesTable.type,
  }).from(researchCasesTable)
    .leftJoin(entitiesTable, eq(researchCasesTable.targetEntityId, entitiesTable.id))
    .where(eq(researchCasesTable.id, params.data.caseId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Bureau case not found" });
    return;
  }
  res.json(serializeBureauCase(row.case, row.entityName ? { name: row.entityName, type: row.entityType ?? "Unknown" } : null));
});

router.get("/research/bureau/cases/:caseId/events", async (req, res): Promise<void> => {
  const caseId = Number(req.params.caseId);
  const query = ListResearchCaseEventsQueryParams.safeParse(req.query);
  if (!Number.isInteger(caseId) || caseId <= 0) {
    res.status(400).json({ error: "Invalid bureau case ID" });
    return;
  }
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const [current] = await db.select({ id: researchCasesTable.id })
    .from(researchCasesTable)
    .where(eq(researchCasesTable.id, caseId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Bureau case not found" });
    return;
  }
  const rows = await db.select().from(researchCaseEventsTable)
    .where(eq(researchCaseEventsTable.caseId, current.id))
    .orderBy(desc(researchCaseEventsTable.createdAt))
    .limit(query.data.limit);
  res.json(rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  })));
});

/**
 * Run one bounded discovery-first investigation:
 * 1. GLM right-hand advice and Gemini Boss text planning open the case context.
 * 2. The existing mixed-source discovery/admission runner searches the public
 *    web without requiring an existing entity.
 * 3. A small registry mix adds independent review-only company anchors.
 *
 * This route intentionally does not run Atlas-wide ingestion or promote any
 * candidate into a target case.
 */
router.post("/research/bureau/cases/:caseId/run-discovery", async (req, res): Promise<void> => {
  const params = RunBureauCaseDiscoveryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const caseId = params.data.caseId;
  const [current] = await db.select().from(researchCasesTable)
    .where(eq(researchCasesTable.id, caseId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Bureau case not found" });
    return;
  }
  const file = parseDiscoveryCaseFile(current.caseFile);
  if (!file) {
    res.status(409).json({ error: "Only a discovery case can run the preliminary investigation" });
    return;
  }
  const existingJobId = await getActiveJob("case-bureau-discovery");
  if (existingJobId) {
    const existing = await getJob(existingJobId);
    if (existing?.status === "running" || existing?.status === "queued") {
      res.status(409).json({ error: "A bureau discovery investigation is already running.", jobId: existingJobId });
      return;
    }
  }

  const jobId = await createJob("case-bureau-discovery");
  await setActiveJob("case-bureau-discovery", jobId);
  await updateJob(jobId, {
    status: "running",
    progress: 0,
    total: 4,
    message: "Boss opening preliminary web request…",
  });
  await db.update(researchCasesTable).set({
    status: "active",
    currentAction: "boss-opening-web-research",
    updatedAt: new Date(),
  }).where(eq(researchCasesTable.id, caseId));
  await db.insert(researchCaseEventsTable).values({
    caseId,
    iteration: current.iteration,
    actorRole: "head_investigator",
    eventType: "assignment",
    summary: "Boss opening web request assigned before mixed-source discovery.",
    payload: JSON.stringify({ jobId, lanes: ["gemini-boss", "broad-web-discovery", "registry-mix"] }),
  });

  void (async () => {
    const now = () => new Date();
    try {
      await appendJobLog(jobId, "Boss opening web request started.");
      const westernTemplateSets = [1, 2, 3, 4, 5, 6, 7, 10];
      const discoveryTemplateSet = westernTemplateSets[Math.floor(Math.random() * westernTemplateSets.length)] ?? 1;
      let workingFile = file;
      const openingIteration = current.iteration + 1;
      const rightHand = await runNvidiaNimDiscoveryAdvice({
        file: workingFile,
        iteration: openingIteration,
      });
      workingFile = await persistDiscoveryCheckpoint(caseId, openingIteration, workingFile, {
        lane: "nvidia-right-hand",
        provider: `NVIDIA NIM ${rightHand.model}`,
        status: rightHand.status,
        iteration: openingIteration,
        summary: rightHand.decision ?? rightHand.error ?? "Right-hand discovery review unavailable.",
        findings: rightHand.reason ? [rightHand.reason] : [],
        candidateNames: [],
        sourceUrls: [],
        nextQuestions: rightHand.focusLanes,
        error: rightHand.error,
      }, `Right-hand discovery review ${rightHand.status}; shared case context checkpointed.`);
      await appendJobLog(jobId, `GLM right-hand discovery advice ${rightHand.status}; model=${rightHand.model}.`);

      const mistral = await runMistralWebSearch({
        objective: workingFile.humanBrief.objective,
        motivation: workingFile.humanBrief.motivation,
        geography: workingFile.humanBrief.geography,
        exclusions: workingFile.humanBrief.exclusions,
        caseContext: buildDiscoveryProgressSnapshot(workingFile),
        nextDirections: workingFile.currentProgress.openQuestions,
      });
      workingFile = await persistDiscoveryCheckpoint(caseId, openingIteration, workingFile, {
        lane: "mistral-web",
        provider: `Mistral ${mistral.model}`,
        status: mistral.status === "completed" ? "completed" : mistral.status,
        iteration: openingIteration,
        summary: mistral.report ?? mistral.error ?? "Mistral web-search report unavailable.",
        findings: mistral.nextDirections,
        candidateNames: mistral.candidates.map((candidate) => candidate.name),
        sourceUrls: mistral.citations,
        nextQuestions: [...mistral.nextDirections, ...mistral.uncertainties],
        contactEvidence: mistral.candidates.flatMap((candidate) => candidate.contactEvidence ?? []),
        error: mistral.error,
      }, `Mistral web-search ${mistral.status}; report checkpointed into shared case context.`);
      await appendJobLog(jobId, `Mistral web-search ${mistral.status}; model=${mistral.model}; citations=${mistral.citations.length}.`);

      const boss = await runGeminiBossDiscovery({
          file: workingFile,
          objective: file.humanBrief.objective,
          motivation: file.humanBrief.motivation,
          geography: file.humanBrief.geography,
          exclusions: file.humanBrief.exclusions,
           rightHandAdvice: rightHand,
           startingLane: `Randomized Western-aligned discovery lane ${discoveryTemplateSet}`,
       });
      workingFile = await persistDiscoveryCheckpoint(caseId, openingIteration, workingFile, {
        lane: "gemini-boss",
        provider: `Gemini ${boss.model}`,
        status: boss.status === "completed" ? "completed" : "unavailable",
        iteration: openingIteration,
        summary: boss.report ?? boss.error ?? "Gemini Boss opening unavailable.",
        findings: boss.nextDirections,
        candidateNames: boss.candidates.map((candidate) => candidate.name),
        sourceUrls: boss.citations,
        nextQuestions: [...boss.nextDirections, ...boss.uncertainties],
        contactEvidence: boss.candidates.flatMap((candidate) => candidate.contactEvidence ?? []),
        error: boss.error,
      }, `Gemini Boss opening ${boss.status}; report checkpointed after reading prior lane reports.`);
      await updateJob(jobId, {
        progress: 2,
        message: `Opening context reviewed; ${workingFile.investigatorReports.length} lane report(s) recorded. Mixed discovery starting…`,
      });
      await appendJobLog(jobId, `Gemini Boss opening ${boss.status}; model=${boss.model}; reports-read=${workingFile.investigatorReports.length}.`);

      const bossUnavailable = boss.status !== "completed" || !boss.report;
      if (bossUnavailable) {
        await appendJobLog(
          jobId,
          `Gemini Boss unavailable (${boss.error ?? boss.status}); preserving this provider gap and continuing with free discovery lanes.`,
        );
      }
      if (mistral.status !== "completed") {
        await appendJobLog(
          jobId,
          `Mistral web-search unavailable (${mistral.error ?? mistral.status}); preserving this provider gap and continuing with other discovery lanes.`,
        );
      }

      await updateJob(jobId, {
        progress: 2,
        message: "Mixed-source discovery: bounded public web search and registry anchors…",
      });
       await appendJobLog(jobId, `Mixed-source discovery started from randomized Western-aligned lane ${discoveryTemplateSet}: web admission plus registry review lanes.`);

      // maxEntities=0 is intentional: broad discovery still runs its AI
      // admission gate and returns candidates, but this bureau pass never
      // silently inserts a target before human review.
      const broad = await runBroadDiscovery({
         templateSet: discoveryTemplateSet,
        rotateTemplates: false,
        maxQueries: 3,
        maxEntities: 0,
      });
      const registryQuery = `${file.humanBrief.geography} investment family office`.slice(0, 120);
      const registryIds: RegistryId[] = [
        "gleif",
        "sec-edgar",
        ...(process.env.COMPANIES_HOUSE_API_KEY ? ["companies-house" as RegistryId] : []),
      ];
      const registryResults = await Promise.all(registryIds.map(async (registry) => {
        try {
          return { registry, results: await searchRegistry({ query: registryQuery, registry, limit: 3 }), error: null };
        } catch (error) {
          return { registry, results: [], error: error instanceof Error ? error.message : "registry request failed" };
        }
      }));
      const registryErrors = registryResults.filter((entry) => entry.error);
      const reviewCandidates = [
        ...boss.candidates.map((candidate) => ({
          name: candidate.name,
          type: candidate.type ?? "review_candidate",
          relevance: candidate.relevance ?? "Returned by the Boss opening request; exact attribution requires review.",
          reachability: candidate.reachability ?? "Unresolved until exact identity and route evidence are checked.",
          sourceUrls: [...new Set([...(candidate.sourceUrls ?? []), ...boss.citations])].slice(0, 8),
          contactEvidence: candidate.contactEvidence ?? [],
          state: "review_only" as const,
        })),
        ...mistral.candidates.map((candidate) => ({
          name: candidate.name,
          type: candidate.type ?? "review_candidate",
          relevance: candidate.relevance ?? "Returned by the Mistral web-search lane; exact attribution requires review.",
          reachability: candidate.reachability ?? "Unresolved until exact identity and route evidence are checked.",
          sourceUrls: [...new Set([...(candidate.sourceUrls ?? []), ...mistral.citations])].slice(0, 8),
          contactEvidence: candidate.contactEvidence ?? [],
          state: "review_only" as const,
        })),
        ...broad.newEntities.map((candidate) => ({
          name: candidate.name,
          type: "review_candidate",
          relevance: "Passed the existing broad-discovery admission gate; retained here without insertion.",
          reachability: "Unresolved; no access claim is made.",
          sourceUrls: [] as string[],
          contactEvidence: [],
          state: "review_only" as const,
        })),
        ...registryResults.flatMap(({ registry, results }) => results.map((result) => ({
          name: result.name,
          type: result.type,
          relevance: `Registry anchor from ${registry}; ownership, wealth, and mission relevance remain unconfirmed.`,
          reachability: "Registry record only; no access claim is made.",
          sourceUrls: [] as string[],
          contactEvidence: [],
          state: "review_only" as const,
        }))),
      ];
      const mergedReviewCandidates = mergeDiscoveryCandidates([], reviewCandidates);
      workingFile = {
        ...workingFile,
        discoveredCandidates: mergedReviewCandidates,
        initialResearch: {
          ...workingFile.initialResearch,
          status: "recorded",
          recordedAt: now().toISOString(),
        },
        lastUpdatedBy: "discovery-lanes",
      };
      workingFile = await persistDiscoveryCheckpoint(caseId, openingIteration, workingFile, {
        lane: "broad-web",
        provider: "Tavily/DDG + Groq admission gate",
        status: "completed",
        iteration: openingIteration,
        summary: `Broad discovery searched ${broad.queriesFired} queries and reviewed ${broad.resultsScraped} excerpts.`,
        findings: broad.newEntities.map((candidate) => `${candidate.name}: ${candidate.snippet}`).slice(0, 20),
        candidateNames: broad.newEntities.map((candidate) => candidate.name),
        sourceUrls: [],
        nextQuestions: [
          "Which broad-web candidates can be tied to an exact legal or professional identity?",
          "Which broad-web candidates have attributable wealth or investment evidence?",
        ],
        error: null,
      }, `Broad web discovery completed; ${broad.newEntities.length} admission-gated candidate(s) written to the shared case context.`);
      for (const entry of registryResults) {
        workingFile = await persistDiscoveryCheckpoint(caseId, openingIteration, workingFile, {
          lane: "registry",
          provider: entry.registry,
          status: entry.error ? "failed" : "completed",
          iteration: openingIteration,
          summary: `${entry.registry} returned ${entry.results.length} registry anchor(s).`,
          findings: entry.results.map((result) => `${result.name} (${result.type})`).slice(0, 20),
          candidateNames: entry.results.map((result) => result.name),
          sourceUrls: entry.results.flatMap((result) => {
            try {
              const metadata = result.metadata ? JSON.parse(result.metadata) as Record<string, unknown> : {};
              return typeof metadata.url === "string" ? [metadata.url] : [];
            } catch {
              return [];
            }
          }),
          nextQuestions: [
            `Can ${entry.registry} anchors be linked to a named decision-maker and the mission?`,
          ],
          error: entry.error,
        }, `${entry.registry} registry lane ${entry.error ? "failed" : "completed"}; result written to shared case context.`);
      }
      const finalRightHand = await runNvidiaNimDiscoveryAdvice({
        file: workingFile,
        iteration: openingIteration + 1,
      });
      workingFile = await persistDiscoveryCheckpoint(caseId, openingIteration + 1, workingFile, {
        lane: "nvidia-right-hand",
        provider: `NVIDIA NIM ${finalRightHand.model}`,
        status: finalRightHand.status,
        iteration: openingIteration + 1,
        summary: finalRightHand.decision ?? finalRightHand.error ?? "Right-hand post-research review unavailable.",
        findings: finalRightHand.reason ? [finalRightHand.reason] : [],
        candidateNames: [],
        sourceUrls: [],
        nextQuestions: finalRightHand.focusLanes,
        error: finalRightHand.error,
      }, `Right-hand post-research review ${finalRightHand.status}; refreshed shaft read completed.`);
      const finalBoss = await runGeminiBossDiscovery({
        file: workingFile,
        objective: workingFile.humanBrief.objective,
        motivation: workingFile.humanBrief.motivation,
        geography: workingFile.humanBrief.geography,
        exclusions: workingFile.humanBrief.exclusions,
        rightHandAdvice: finalRightHand,
        startingLane: `Post-research rabbit-hole review from randomized lane ${discoveryTemplateSet}`,
      });
      workingFile = await persistDiscoveryCheckpoint(caseId, openingIteration + 1, workingFile, {
        lane: "gemini-boss",
        provider: `Gemini ${finalBoss.model}`,
        status: finalBoss.status === "completed" ? "completed" : "unavailable",
        iteration: openingIteration + 1,
        summary: finalBoss.report ?? finalBoss.error ?? "Gemini post-research review unavailable.",
        findings: finalBoss.nextDirections,
        candidateNames: finalBoss.candidates.map((candidate) => candidate.name),
        sourceUrls: finalBoss.citations,
        nextQuestions: [...finalBoss.nextDirections, ...finalBoss.uncertainties],
        error: finalBoss.error,
      }, `Gemini Boss post-research review ${finalBoss.status}; next rabbit-hole directions recorded.`);
      workingFile = {
        ...workingFile,
        nextInvestigation: {
          rightHand: {
            status: finalRightHand.status,
            decision: finalRightHand.decision,
            reason: finalRightHand.reason,
            focusLanes: finalRightHand.focusLanes,
            confidence: finalRightHand.confidence,
            error: finalRightHand.error,
            reviewedAt: now().toISOString(),
          },
          boss: {
            status: finalBoss.status === "completed" ? "completed" : "unavailable",
            decision: finalBoss.report,
            candidateNames: finalBoss.candidates.map((candidate) => candidate.name),
            nextDirections: finalBoss.nextDirections,
            uncertainties: finalBoss.uncertainties,
            error: finalBoss.error,
            reviewedAt: now().toISOString(),
          },
        },
        currentProgress: {
          ...workingFile.currentProgress,
          lastReviewedBy: "gemini-boss",
          refreshedAt: now().toISOString(),
        },
        initialResearch: {
          ...workingFile.initialResearch,
          status: "reviewed",
          researchResponse: [
            finalBoss.report ? `Final Boss review:\n${finalBoss.report}` : `Final Boss gap: ${finalBoss.error ?? finalBoss.status}`,
            ...workingFile.investigatorReports.slice(-8).map((report) => `\n[${report.lane}] ${report.summary}`),
          ].join("\n"),
          bossCommentary: finalBoss.nextDirections.length
            ? `Next rabbit-hole directions: ${finalBoss.nextDirections.join("; ")}`
            : "No verified next direction was returned; human review remains required.",
          sourceUrls: [...new Set(workingFile.investigatorReports.flatMap((report) => report.sourceUrls))].slice(0, 80),
          recordedAt: now().toISOString(),
        },
        lastUpdatedBy: "gemini-boss-post-research-review",
      };
      const mixedReport = [
        bossUnavailable
          ? `Boss opening provider gap:\n${boss.error ?? `Gemini Boss returned ${boss.status}.`}`
          : `Boss opening report:\n${boss.report}`,
        mistral.status === "completed"
          ? `\nMistral web-search report:\n${mistral.report ?? "No report returned."}`
          : `\nMistral web-search provider gap:\n${mistral.error ?? `Mistral returned ${mistral.status}.`}`,
        `\nMixed-source discovery summary: ${broad.queriesFired} web queries, ${broad.resultsScraped} web result excerpts, ${broad.newEntities.length} admission-gated web candidate(s) retained without insertion.`,
        `Registry lanes: ${registryResults.map((entry) => `${entry.registry}=${entry.results.length}`).join(", ")}.`,
        registryErrors.length ? `Registry gaps: ${registryErrors.map((entry) => `${entry.registry}: ${entry.error}`).join("; ")}` : "Registry gaps: none reported.",
      ].join("\n");
      const commentary = [
        bossUnavailable
          ? "The Gemini Boss opening was unavailable, so its provider gap is preserved explicitly."
          : "The Boss opening completed and established the first durable case context.",
        "The remaining bounded public-web and registry lanes ran without treating the unavailable Boss as a fatal case error.",
         `Retain ${mergedReviewCandidates.length} candidate/anchor record(s) for human review only.`,
        "Next decision: review identity, mission relevance, provenance, and realistic reachability before promoting any candidate into target-scoped research.",
      ].join(" ");
      const updatedFile = {
        ...workingFile,
        initialResearch: {
          ...workingFile.initialResearch,
          status: "reviewed" as const,
          researchResponse: [
            workingFile.initialResearch.researchResponse ?? "",
            mixedReport,
          ].filter(Boolean).join("\n\n").slice(-40_000),
          bossCommentary: [
            workingFile.initialResearch.bossCommentary ?? "",
            commentary,
            finalBoss.nextDirections.length
              ? `Next rabbit-hole directions: ${finalBoss.nextDirections.join("; ")}`
              : "",
          ].filter(Boolean).join(" ").slice(-8_000),
          sourceUrls: [...new Set([...workingFile.initialResearch.sourceUrls, ...boss.citations, ...mistral.citations, ...registryResults.flatMap((entry) => entry.results.flatMap((result) => {
            try {
              const metadata = result.metadata ? JSON.parse(result.metadata) as Record<string, unknown> : {};
              return typeof metadata.url === "string" ? [metadata.url] : [];
            } catch {
              return [];
            }
          }))])].slice(0, 80),
          recordedAt: now().toISOString(),
        },
        rightHandAdvice: {
           provider: "nvidia-nim" as const,
           model: finalRightHand.model,
           status: finalRightHand.status,
           decision: finalRightHand.decision,
           reason: finalRightHand.reason,
           focusLanes: finalRightHand.focusLanes,
           confidence: finalRightHand.confidence,
           error: finalRightHand.error,
           createdAt: now().toISOString(),
         },
         discoveredCandidates: mergedReviewCandidates,
        decisionLog: [
          ...workingFile.decisionLog,
          {
            iteration: openingIteration + 1,
            decision: finalBoss.nextDirections.length
              ? `Boss reviewed the refreshed case shaft and queued the next rabbit-hole directions: ${finalBoss.nextDirections.join("; ")}`
              : "Boss reviewed the refreshed case shaft and left all candidates in human review.",
            reason: finalBoss.uncertainties.length
              ? `Open uncertainties: ${finalBoss.uncertainties.join("; ")}`
              : "Identity, attribution, provenance, wealth, and practical reachability still require human review.",
            createdAt: now().toISOString(),
          },
        ].slice(-50),
        lastUpdatedBy: "gemini-boss-post-research-review",
      };
      const [updated] = await db.update(researchCasesTable).set({
        caseFile: JSON.stringify(updatedFile),
        status: "review",
        currentAction: "human-review-discovery-candidates",
        iteration: current.iteration + 1,
        lastDecisionAt: now(),
        updatedAt: now(),
      }).where(eq(researchCasesTable.id, caseId)).returning();
      await db.insert(researchCaseEventsTable).values([
        {
          caseId,
          iteration: current.iteration + 1,
          actorRole: "specialist",
          eventType: "observation",
             summary: `Mixed-source discovery completed from randomized lane ${discoveryTemplateSet}: ${reviewCandidates.length} review-only candidate/anchor record(s).`,
          payload: JSON.stringify({
            jobId,
            bossModel: boss.model,
            bossCitations: boss.citations.length,
              rightHand: {
                status: rightHand.status,
                model: rightHand.model,
                focusLanes: rightHand.focusLanes,
              },
              discoveryTemplateSet,
            broad: {
              queriesFired: broad.queriesFired,
              resultsScraped: broad.resultsScraped,
              candidates: broad.newEntities.length,
              inserted: broad.entitiesDiscovered,
            },
            registries: registryResults.map((entry) => ({
              registry: entry.registry,
              results: entry.results.length,
              error: entry.error,
            })),
          }),
        },
        {
          caseId,
          iteration: current.iteration + 1,
          actorRole: "head_investigator",
          eventType: "decision",
          summary: commentary,
          payload: JSON.stringify({ nextAction: "human-review-discovery-candidates", candidateCount: reviewCandidates.length }),
        },
      ]);
       await appendJobLog(jobId, `Discovery complete; randomized lane=${discoveryTemplateSet}; review-only candidates=${reviewCandidates.length}; no entity insertion.`);
      await updateJob(jobId, {
        status: "done",
        progress: 4,
        total: 4,
        inserted: 0,
        skipped: 0,
        errors: registryErrors.length,
        message: `Discovery complete: ${reviewCandidates.length} review-only candidate/anchor record(s); no target promoted.`,
        result: JSON.stringify({
          caseId,
          bossModel: boss.model,
          bossCitations: boss.citations.length,
          webQueries: broad.queriesFired,
          webResults: broad.resultsScraped,
          reviewCandidates: reviewCandidates.length,
          registryErrors: registryErrors.map((entry) => entry.registry),
          caseStatus: updated?.status ?? "review",
        }),
        finishedAt: now().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bureau discovery failed";
      await appendJobLog(jobId, `Discovery failed: ${message}`);
      await db.update(researchCasesTable).set({
        status: "review",
        currentAction: "discovery-run-failed",
        updatedAt: now(),
      }).where(eq(researchCasesTable.id, caseId));
      await db.insert(researchCaseEventsTable).values({
        caseId,
        iteration: current.iteration,
        actorRole: "head_investigator",
        eventType: "status",
        summary: `Discovery run failed safely: ${message}`,
        payload: JSON.stringify({ jobId }),
      });
      await updateJob(jobId, {
        status: "failed",
        errors: 1,
        message,
        finishedAt: now().toISOString(),
      });
    } finally {
      await clearActiveJobIfOwned("case-bureau-discovery", jobId);
    }
  })();

  const response = {
    caseId,
    jobId,
    pollUrl: `/api/ingest/job/${jobId}`,
    caseUrl: `/api/research/bureau/cases/${caseId}`,
    message: "Boss opening request and bounded mixed-source discovery started; candidates remain review-only.",
  };
  res.status(202).json(RunBureauCaseDiscoveryResponse.parse(response));
});

/**
 * Continue a completed discovery case through the Boss-selected verification
 * directions. This is deliberately a separate bounded pass: the first pass
 * discovers routes, this pass verifies identity/attribution and named access
 * paths. Results remain review-only and are appended to the same case shaft.
 */
router.post("/research/bureau/cases/:caseId/run-next-pass", async (req, res): Promise<void> => {
  const params = RunBureauCaseNextPassParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const caseId = params.data.caseId;
  const [current] = await db.select().from(researchCasesTable)
    .where(eq(researchCasesTable.id, caseId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Bureau case not found" });
    return;
  }
  const file = parseDiscoveryCaseFile(current.caseFile);
  if (!file) {
    res.status(409).json({ error: "Only a discovery case can run the verification pass" });
    return;
  }
  const existingJobId = await getActiveJob("case-bureau-discovery");
  if (existingJobId) {
    const existing = await getJob(existingJobId);
    if (existing?.status === "running" || existing?.status === "queued") {
      res.status(409).json({ error: "A bureau discovery investigation is already running.", jobId: existingJobId });
      return;
    }
  }

  const directions = [
    "For every persisted candidate, perform a dedicated public-contact audit: identify named investment decision-makers, official professional profiles, public personal or organization email/phone routes, and warm-introduction paths. Return an explicit contactEvidence array or explicitly state that no structured route was found.",
    ...(file.nextInvestigation?.boss?.nextDirections ?? []),
    ...(file.currentProgress.openQuestions ?? []),
  ].filter((direction, index, all) => direction.trim() && all.indexOf(direction) === index).slice(0, 8);
  if (directions.length === 0) {
    res.status(409).json({ error: "The Boss has not returned bounded next directions for this case." });
    return;
  }

  const jobId = await createJob("case-bureau-discovery");
  await setActiveJob("case-bureau-discovery", jobId);
  const iteration = current.iteration + 1;
  await updateJob(jobId, {
    status: "running",
    progress: 0,
    total: 4,
    message: "Boss-directed verification pass starting…",
  });
  await db.update(researchCasesTable).set({
    status: "active",
    currentAction: "boss-directed-verification",
    updatedAt: new Date(),
  }).where(eq(researchCasesTable.id, caseId));
  await db.insert(researchCaseEventsTable).values({
    caseId,
    iteration,
    actorRole: "head_investigator",
    eventType: "assignment",
    summary: "Boss-directed verification pass assigned from the persisted next directions.",
    payload: JSON.stringify({ jobId, directions }),
  });

  void (async () => {
    const now = () => new Date();
    let workingFile = file;
    try {
      await appendJobLog(jobId, `Boss-directed verification pass started; directions=${directions.length}.`);

      const mistral = await runMistralWebSearch({
        objective: workingFile.humanBrief.objective,
        motivation: workingFile.humanBrief.motivation,
        geography: workingFile.humanBrief.geography,
        exclusions: workingFile.humanBrief.exclusions,
        caseContext: buildDiscoveryProgressSnapshot(workingFile),
        nextDirections: directions,
      });
      workingFile = await persistDiscoveryCheckpoint(caseId, iteration, workingFile, {
        lane: "mistral-web",
        provider: `Mistral ${mistral.model}`,
        status: mistral.status === "completed" ? "completed" : mistral.status,
        iteration,
        summary: mistral.report ?? mistral.error ?? "Mistral verification report unavailable.",
        findings: mistral.nextDirections,
        candidateNames: mistral.candidates.map((candidate) => candidate.name),
        sourceUrls: mistral.citations,
        nextQuestions: [...mistral.nextDirections, ...mistral.uncertainties],
        contactEvidence: mistral.candidates.flatMap((candidate) => candidate.contactEvidence ?? []),
        error: mistral.error,
      }, `Mistral verification search ${mistral.status}; report appended to the shared case context.`);
      await updateJob(jobId, {
        progress: 1,
        total: 4,
        message: "Named-candidate and decision-maker verification recorded…",
      });

      // Registry searches are intentionally limited to the existing corporate
      // anchors. They provide official cross-references and officer/filing
      // signals without inserting records or claiming beneficial ownership.
      const registryAnchors = workingFile.discoveredCandidates
        .filter((candidate) => candidate.type.toLowerCase().includes("corpor") || candidate.type.toLowerCase() === "hnwi")
        .slice(0, 10);
      const registryIds: RegistryId[] = [
        "gleif",
        "sec-edgar",
        ...(process.env.COMPANIES_HOUSE_API_KEY ? ["companies-house" as RegistryId] : []),
      ];
      for (const registry of registryIds) {
        const registryResults = (await Promise.all(registryAnchors.map(async (anchor) => {
          try {
            return {
              anchor: anchor.name,
              results: await searchRegistry({ query: anchor.name, registry, limit: 3 }),
              error: null,
            };
          } catch (error) {
            return {
              anchor: anchor.name,
              results: [],
              error: error instanceof Error ? error.message : "registry request failed",
            };
          }
        }))).flatMap((entry) => entry.results.map((result) => ({ ...result, anchor: entry.anchor })));
        const registryErrors = registryAnchors.length > 0
          ? registryAnchors.filter((anchor) => !registryResults.some((result) => result.anchor === anchor.name)).length
          : 0;
        const sourceUrls = registryResults.flatMap((result) => {
          try {
            const metadata = result.metadata ? JSON.parse(result.metadata) as Record<string, unknown> : {};
            return Object.values(metadata).filter((value): value is string => typeof value === "string" && /^https?:\/\//.test(value)).slice(0, 2);
          } catch {
            return [];
          }
        });
        workingFile = await persistDiscoveryCheckpoint(caseId, iteration, workingFile, {
          lane: "registry",
          provider: registry,
          status: "completed",
          iteration,
          summary: `${registry} verification searched ${registryAnchors.length} existing corporate anchor(s) and returned ${registryResults.length} result(s).`,
          findings: registryResults.map((result) => `${result.anchor} → ${result.name}${result.notes ? ` (${result.notes})` : ""}`).slice(0, 30),
          candidateNames: registryResults.map((result) => result.name).slice(0, 30),
          sourceUrls: [...new Set(sourceUrls)].slice(0, 40),
          nextQuestions: [
            "Which returned officer, filing, or legal-entity result has an attributable connection to a named investment decision-maker?",
            ...(registryErrors > 0 ? [`${registryErrors} anchor search(es) returned no result in ${registry}.`] : []),
          ],
          error: null,
        }, `${registry} verification lane completed; official anchor cross-references appended.`);
      }
      await updateJob(jobId, {
        progress: 2,
        total: 4,
        message: "Reviewing refreshed case context with the right hand and Boss…",
      });

      const rightHand = await runNvidiaNimDiscoveryAdvice({
        file: workingFile,
        iteration,
      });
      workingFile = await persistDiscoveryCheckpoint(caseId, iteration, workingFile, {
        lane: "nvidia-right-hand",
        provider: `NVIDIA NIM ${rightHand.model}`,
        status: rightHand.status,
        iteration,
        summary: rightHand.decision ?? rightHand.error ?? "Right-hand verification review unavailable.",
        findings: rightHand.reason ? [rightHand.reason] : [],
        candidateNames: [],
        sourceUrls: [],
        nextQuestions: rightHand.focusLanes,
        error: rightHand.error,
      }, `Right-hand verification review ${rightHand.status}; refreshed shaft checkpointed.`);

      const boss = await runGeminiBossDiscovery({
        file: workingFile,
        objective: workingFile.humanBrief.objective,
        motivation: workingFile.humanBrief.motivation,
        geography: workingFile.humanBrief.geography,
        exclusions: workingFile.humanBrief.exclusions,
        rightHandAdvice: rightHand,
        startingLane: "Boss-directed verification of the previous pass",
      });
      workingFile = await persistDiscoveryCheckpoint(caseId, iteration, workingFile, {
        lane: "gemini-boss",
        provider: `Gemini ${boss.model}`,
        status: boss.status === "completed" ? "completed" : "unavailable",
        iteration,
        summary: boss.report ?? boss.error ?? "Gemini verification review unavailable.",
        findings: boss.nextDirections,
        candidateNames: boss.candidates.map((candidate) => candidate.name),
        sourceUrls: boss.citations,
        nextQuestions: [...boss.nextDirections, ...boss.uncertainties],
        contactEvidence: boss.candidates.flatMap((candidate) => candidate.contactEvidence ?? []),
        error: boss.error,
      }, `Gemini Boss verification review ${boss.status}; next directions refreshed.`);

      const newCandidates = [
        ...mistral.candidates.map((candidate) => ({
          name: candidate.name,
          type: candidate.type ?? "review_candidate",
          relevance: candidate.relevance ?? "Returned by the verification lane; exact attribution requires review.",
          reachability: candidate.reachability ?? "Unresolved until exact identity and route evidence are checked.",
          sourceUrls: [...new Set([...(candidate.sourceUrls ?? []), ...mistral.citations])].slice(0, 8),
          contactEvidence: candidate.contactEvidence ?? [],
          state: "review_only" as const,
        })),
        ...boss.candidates.map((candidate) => ({
          name: candidate.name,
          type: candidate.type ?? "review_candidate",
          relevance: candidate.relevance ?? "Returned by the Boss verification review; exact attribution requires review.",
          reachability: candidate.reachability ?? "Unresolved until exact identity and route evidence are checked.",
          sourceUrls: [...new Set(candidate.sourceUrls ?? [])].slice(0, 8),
          contactEvidence: candidate.contactEvidence ?? [],
          state: "review_only" as const,
        })),
      ];
      const mergedCandidates = mergeDiscoveryCandidates(workingFile.discoveredCandidates, newCandidates);
      const finalFile = {
        ...workingFile,
        discoveredCandidates: mergedCandidates,
        nextInvestigation: {
          rightHand: {
            status: rightHand.status,
            decision: rightHand.decision,
            reason: rightHand.reason,
            focusLanes: rightHand.focusLanes,
            confidence: rightHand.confidence,
            error: rightHand.error,
            reviewedAt: now().toISOString(),
          },
          boss: {
            status: boss.status === "completed" ? "completed" : "unavailable",
            decision: boss.report,
            candidateNames: boss.candidates.map((candidate) => candidate.name),
            nextDirections: boss.nextDirections,
            uncertainties: boss.uncertainties,
            error: boss.error,
            reviewedAt: now().toISOString(),
          },
        },
        currentProgress: {
          ...workingFile.currentProgress,
          lastReviewedBy: "gemini-boss",
          refreshedAt: now().toISOString(),
        },
        initialResearch: {
          ...workingFile.initialResearch,
          status: "reviewed" as const,
          bossCommentary: [
            workingFile.initialResearch.bossCommentary ?? "",
            "Verification pass completed; all results remain review-only.",
            boss.nextDirections.length ? `Next rabbit-hole directions: ${boss.nextDirections.join("; ")}` : "",
          ].filter(Boolean).join(" ").slice(-8_000),
          sourceUrls: [...new Set([
            ...workingFile.initialResearch.sourceUrls,
            ...mistral.citations,
            ...workingFile.investigatorReports.flatMap((report) => report.sourceUrls),
          ])].slice(0, 100),
          recordedAt: now().toISOString(),
        },
        decisionLog: [
          ...workingFile.decisionLog,
          {
            iteration,
            decision: boss.nextDirections.length
              ? `Boss completed the verification pass and queued: ${boss.nextDirections.join("; ")}`
              : "Boss completed the verification pass; human review remains required.",
            reason: boss.uncertainties.length
              ? `Open uncertainties: ${boss.uncertainties.join("; ")}`
              : "Identity, attribution, provenance, wealth, and practical reachability remain review gates.",
            createdAt: now().toISOString(),
          },
        ].slice(-50),
        lastUpdatedBy: "gemini-boss-verification-review",
      };
      const [updated] = await db.update(researchCasesTable).set({
        caseFile: JSON.stringify(finalFile),
        status: "review",
        currentAction: "human-review-discovery-candidates",
        iteration,
        lastDecisionAt: now(),
        updatedAt: now(),
      }).where(eq(researchCasesTable.id, caseId)).returning();
      await db.insert(researchCaseEventsTable).values({
        caseId,
        iteration,
        actorRole: "head_investigator",
        eventType: "decision",
        summary: `Boss-directed verification pass completed with ${mergedCandidates.length} review-only candidate/anchor record(s); no target promoted.`,
        payload: JSON.stringify({
          jobId,
          mistral: { status: mistral.status, citations: mistral.citations.length, candidates: mistral.candidates.length },
          rightHand: { status: rightHand.status, model: rightHand.model },
          boss: { status: boss.status, candidates: boss.candidates.length, nextDirections: boss.nextDirections },
          candidateCount: mergedCandidates.length,
          inserted: 0,
          promoted: 0,
        }),
      });
      await appendJobLog(jobId, `Verification complete; candidates=${mergedCandidates.length}; no entity insertion or target promotion.`);
      await updateJob(jobId, {
        status: "done",
        progress: 4,
        total: 4,
        inserted: 0,
        skipped: 0,
        errors: 0,
        message: `Verification complete: ${mergedCandidates.length} review-only candidate/anchor record(s); no target promoted.`,
        result: JSON.stringify({ caseId, reviewCandidates: mergedCandidates.length, caseStatus: updated?.status ?? "review" }),
        finishedAt: now().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bureau verification pass failed";
      await appendJobLog(jobId, `Verification failed safely: ${message}`);
      await db.update(researchCasesTable).set({
        status: "review",
        currentAction: "verification-pass-failed",
        updatedAt: now(),
      }).where(eq(researchCasesTable.id, caseId));
      await db.insert(researchCaseEventsTable).values({
        caseId,
        iteration,
        actorRole: "head_investigator",
        eventType: "status",
        summary: `Verification pass failed safely: ${message}`,
        payload: JSON.stringify({ jobId }),
      });
      await updateJob(jobId, {
        status: "failed",
        errors: 1,
        message,
        finishedAt: now().toISOString(),
      });
    } finally {
      await clearActiveJobIfOwned("case-bureau-discovery", jobId);
    }
  })();

  const response = {
    caseId,
    jobId,
    pollUrl: `/api/ingest/job/${jobId}`,
    caseUrl: `/api/research/bureau/cases/${caseId}`,
    message: "Boss-directed verification pass started; candidates remain review-only.",
  };
  res.status(202).json(RunBureauCaseNextPassResponse.parse(response));
});

/**
 * Retry only the advisory/Boss closure review over the current durable shaft.
 * This is used when the evidence lanes completed but Gemini was temporarily
 * unavailable; it must not repeat web or registry work.
 */
router.post("/research/bureau/cases/:caseId/run-boss-review", async (req, res): Promise<void> => {
  const params = RunBureauCaseBossReviewParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const caseId = params.data.caseId;
  const [current] = await db.select().from(researchCasesTable)
    .where(eq(researchCasesTable.id, caseId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Bureau case not found" });
    return;
  }
  const file = parseDiscoveryCaseFile(current.caseFile);
  if (!file) {
    res.status(409).json({ error: "Only a discovery case can retry the Boss review" });
    return;
  }
  const existingJobId = await getActiveJob("case-bureau-discovery");
  if (existingJobId) {
    const existing = await getJob(existingJobId);
    if (existing?.status === "running" || existing?.status === "queued") {
      res.status(409).json({ error: "A bureau discovery investigation is already running.", jobId: existingJobId });
      return;
    }
  }

  const jobId = await createJob("case-bureau-discovery");
  await setActiveJob("case-bureau-discovery", jobId);
  const iteration = current.iteration + 1;
  await updateJob(jobId, {
    status: "running",
    progress: 0,
    total: 2,
    message: "Retrying Boss closure review over the existing case shaft…",
  });
  await db.update(researchCasesTable).set({
    status: "active",
    currentAction: "boss-closure-review",
    updatedAt: new Date(),
  }).where(eq(researchCasesTable.id, caseId));
  await db.insert(researchCaseEventsTable).values({
    caseId,
    iteration,
    actorRole: "head_investigator",
    eventType: "assignment",
    summary: "Boss closure review retry assigned without repeating evidence lanes.",
    payload: JSON.stringify({ jobId, reportCount: file.investigatorReports.length }),
  });

  void (async () => {
    const now = () => new Date();
    try {
      let workingFile = file;
      const rightHand = await runNvidiaNimDiscoveryAdvice({ file: workingFile, iteration });
      workingFile = await persistDiscoveryCheckpoint(caseId, iteration, workingFile, {
        lane: "nvidia-right-hand",
        provider: `NVIDIA NIM ${rightHand.model}`,
        status: rightHand.status,
        iteration,
        summary: rightHand.decision ?? rightHand.error ?? "Right-hand closure review unavailable.",
        findings: rightHand.reason ? [rightHand.reason] : [],
        candidateNames: [],
        sourceUrls: [],
        nextQuestions: rightHand.focusLanes,
        error: rightHand.error,
      }, `Right-hand closure review ${rightHand.status}; existing evidence shaft preserved.`);
      await updateJob(jobId, {
        progress: 1,
        total: 2,
        message: "Boss reviewing the existing evidence shaft…",
      });

      const boss = await runGeminiBossDiscovery({
        file: workingFile,
        objective: workingFile.humanBrief.objective,
        motivation: workingFile.humanBrief.motivation,
        geography: workingFile.humanBrief.geography,
        exclusions: workingFile.humanBrief.exclusions,
        rightHandAdvice: rightHand,
        startingLane: "Closure review retry after the prior Gemini provider gap",
      });
      workingFile = await persistDiscoveryCheckpoint(caseId, iteration, workingFile, {
        lane: "gemini-boss",
        provider: `Gemini ${boss.model}`,
        status: boss.status === "completed" ? "completed" : "unavailable",
        iteration,
        summary: boss.report ?? boss.error ?? "Gemini Boss closure review unavailable.",
        findings: boss.nextDirections,
        candidateNames: boss.candidates.map((candidate) => candidate.name),
        sourceUrls: boss.citations,
        nextQuestions: [...boss.nextDirections, ...boss.uncertainties],
        error: boss.error,
      }, `Gemini Boss closure review ${boss.status}; existing evidence lanes were not repeated.`);

      const previousBoss = file.nextInvestigation?.boss;
      const bossDirections = boss.status === "completed"
        ? boss.nextDirections
        : previousBoss?.nextDirections ?? [];
      const bossUncertainties = boss.status === "completed"
        ? boss.uncertainties
        : [...(previousBoss?.uncertainties ?? []), boss.error ?? "Gemini Boss closure review unavailable."];
      const finalFile = {
        ...workingFile,
        nextInvestigation: {
          rightHand: {
            status: rightHand.status,
            decision: rightHand.decision,
            reason: rightHand.reason,
            focusLanes: rightHand.focusLanes,
            confidence: rightHand.confidence,
            error: rightHand.error,
            reviewedAt: now().toISOString(),
          },
          boss: {
            status: boss.status === "completed" ? "completed" : "unavailable",
            decision: boss.report ?? previousBoss?.decision ?? null,
            candidateNames: boss.status === "completed"
              ? boss.candidates.map((candidate) => candidate.name)
              : previousBoss?.candidateNames ?? [],
            nextDirections: bossDirections,
            uncertainties: bossUncertainties,
            error: boss.error,
            reviewedAt: now().toISOString(),
          },
        },
        currentProgress: {
          ...workingFile.currentProgress,
          lastReviewedBy: "gemini-boss",
          refreshedAt: now().toISOString(),
        },
        initialResearch: {
          ...workingFile.initialResearch,
          status: "reviewed" as const,
          bossCommentary: [
            workingFile.initialResearch.bossCommentary ?? "",
            boss.status === "completed"
              ? "Boss closure review completed over the existing evidence shaft; all results remain review-only."
              : `Boss closure review remains unavailable: ${boss.error ?? "provider gap"}`,
          ].join(" ").slice(-8_000),
          recordedAt: now().toISOString(),
        },
        decisionLog: [
          ...workingFile.decisionLog,
          {
            iteration,
            decision: boss.status === "completed"
              ? bossDirections.length
                ? `Boss closure review completed and queued: ${bossDirections.join("; ")}`
                : "Boss closure review completed; remaining findings are ready for human review."
              : "Boss closure review could not complete because the Gemini provider remained unavailable.",
            reason: bossUncertainties.join("; ") || "No additional uncertainty returned.",
            createdAt: now().toISOString(),
          },
        ].slice(-50),
        lastUpdatedBy: "gemini-boss-closure-review",
      };
      const [updated] = await db.update(researchCasesTable).set({
        caseFile: JSON.stringify(finalFile),
        status: "review",
        currentAction: boss.status === "completed"
          ? "human-review-discovery-candidates"
          : "boss-closure-review-provider-gap",
        iteration,
        lastDecisionAt: now(),
        updatedAt: now(),
      }).where(eq(researchCasesTable.id, caseId)).returning();
      await db.insert(researchCaseEventsTable).values({
        caseId,
        iteration,
        actorRole: "head_investigator",
        eventType: boss.status === "completed" ? "decision" : "status",
        summary: boss.status === "completed"
          ? `Boss closure review completed over ${workingFile.investigatorReports.length} reports; no target promoted.`
          : `Boss closure review remains blocked by a provider gap; no target promoted.`,
        payload: JSON.stringify({
          jobId,
          status: boss.status,
          error: boss.error,
          reportCount: workingFile.investigatorReports.length,
          inserted: 0,
          promoted: 0,
        }),
      });
      await appendJobLog(jobId, `Boss closure review ${boss.status}; evidence lanes not repeated; no target promotion.`);
      await updateJob(jobId, {
        status: "done",
        progress: 2,
        total: 2,
        inserted: 0,
        skipped: 0,
        errors: boss.status === "completed" ? 0 : 1,
        message: boss.status === "completed"
          ? "Boss closure review complete; candidates remain review-only."
          : `Boss closure review provider gap: ${boss.error ?? "Gemini unavailable"}`,
        result: JSON.stringify({
          caseId,
          caseStatus: updated?.status ?? "review",
          bossStatus: boss.status,
          reports: workingFile.investigatorReports.length,
          promoted: 0,
        }),
        finishedAt: now().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Boss closure review failed";
      await appendJobLog(jobId, `Boss closure review failed safely: ${message}`);
      await db.update(researchCasesTable).set({
        status: "review",
        currentAction: "boss-closure-review-failed",
        updatedAt: now(),
      }).where(eq(researchCasesTable.id, caseId));
      await db.insert(researchCaseEventsTable).values({
        caseId,
        iteration,
        actorRole: "head_investigator",
        eventType: "status",
        summary: `Boss closure review failed safely: ${message}`,
        payload: JSON.stringify({ jobId }),
      });
      await updateJob(jobId, {
        status: "failed",
        errors: 1,
        message,
        finishedAt: now().toISOString(),
      });
    } finally {
      await clearActiveJobIfOwned("case-bureau-discovery", jobId);
    }
  })();

  const response = {
    caseId,
    jobId,
    pollUrl: `/api/ingest/job/${jobId}`,
    caseUrl: `/api/research/bureau/cases/${caseId}`,
    message: "Boss closure review retry started; evidence lanes will not be repeated.",
  };
  res.status(202).json(RunBureauCaseBossReviewResponse.parse(response));
});

router.post("/research/bureau/cases/:caseId/initial-research", async (req, res): Promise<void> => {
  const params = RecordBureauInitialResearchParams.safeParse(req.params);
  const body = RecordBureauInitialResearchBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [current] = await db.select().from(researchCasesTable)
    .where(eq(researchCasesTable.id, params.data.caseId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Bureau case not found" });
    return;
  }
  const file = parseDiscoveryCaseFile(current.caseFile);
  if (!file) {
    res.status(409).json({ error: "Initial research can only be recorded on a discovery case" });
    return;
  }
  const now = new Date();
  const updatedFile = {
    ...file,
    initialResearch: {
      status: "recorded" as const,
      researchResponse: body.data.researchResponse.trim(),
      bossCommentary: body.data.bossCommentary?.trim() || null,
      sourceUrls: body.data.sourceUrls ?? [],
      recordedAt: now.toISOString(),
    },
    lastUpdatedBy: "gemini-boss-review",
  };
  const [updated] = await db.update(researchCasesTable).set({
    caseFile: JSON.stringify(updatedFile),
    currentAction: "boss-review-initial-research",
    status: "active",
    iteration: current.iteration + 1,
    lastDecisionAt: now,
    updatedAt: now,
  }).where(eq(researchCasesTable.id, current.id)).returning();
  await db.insert(researchCaseEventsTable).values({
    caseId: current.id,
    iteration: current.iteration + 1,
    actorRole: "head_investigator",
    eventType: "observation",
    summary: "Broad initial research response recorded for Boss review and candidate extraction.",
    payload: JSON.stringify({
      researchResponse: body.data.researchResponse,
      bossCommentary: body.data.bossCommentary ?? null,
      sourceUrls: body.data.sourceUrls ?? [],
    }),
  });
  res.json(serializeBureauCase(updated!, null));
});

router.post("/research/bureau/cases/:caseId/admit-candidate", async (req, res): Promise<void> => {
  const params = GetBureauCaseParams.safeParse(req.params);
  const body = AdmitBureauCaseCandidateBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: !params.success ? params.error.message : body.error.message });
    return;
  }
  const [current] = await db.select().from(researchCasesTable)
    .where(eq(researchCasesTable.id, params.data.caseId))
    .limit(1);
  if (!current) {
    res.status(404).json({ error: "Bureau case not found" });
    return;
  }
  const discoveryFile = parseDiscoveryCaseFile(current.caseFile);
  if (!discoveryFile) {
    res.status(409).json({ error: "Only a discovery case can admit a candidate" });
    return;
  }
  const candidate = discoveryFile.discoveredCandidates.find(
    (item) => item.name.trim().toLowerCase() === body.data.candidateName.trim().toLowerCase(),
  );
  if (!candidate) {
    res.status(409).json({ error: "Candidate is not present in this persisted case file" });
    return;
  }
  if (candidate.admittedEntityId) {
    res.status(409).json({ error: `Candidate has already been admitted as review entity ${candidate.admittedEntityId}` });
    return;
  }

  const entityType = candidateTypeToEntityType(candidate.type);
  const now = new Date();
  const [entity] = await db.insert(entitiesTable).values({
    name: candidate.name,
    type: entityType,
    bayesianScore: 0.05,
    contactConfidence: 0,
    contactOutcome: "evidence_only",
    isHot: false,
    isStarred: false,
    isHidden: false,
    sourceRegistries: JSON.stringify(["Case Bureau discovery"]),
    notes: "Admitted manually from a persisted Case Bureau discovery candidate. Identity, attribution, provenance, contactability, and target promotion remain under human review.",
    metadata: JSON.stringify({
      reviewOnly: true,
      admission: "case-bureau-candidate",
      caseId: current.id,
      admittedAt: now.toISOString(),
      candidate: {
        name: candidate.name,
        type: candidate.type,
        relevance: candidate.relevance,
        reachability: candidate.reachability,
        sourceUrls: candidate.sourceUrls,
        contactEvidence: candidate.contactEvidence ?? [],
      },
    }),
  }).returning();
  if (!entity) {
    res.status(500).json({ error: "Unable to admit candidate" });
    return;
  }

  const updatedCandidates = discoveryFile.discoveredCandidates.map((item) =>
    item.name.trim().toLowerCase() === candidate.name.trim().toLowerCase()
      ? { ...item, admittedEntityId: entity.id }
      : item,
  );
  const updatedFile = {
    ...discoveryFile,
    discoveredCandidates: updatedCandidates,
    decisionLog: [
      ...discoveryFile.decisionLog,
      {
        iteration: current.iteration + 1,
        decision: `Human admitted ${candidate.name} as review-only entity ${entity.id}.`,
        reason: "Candidate provenance and any contact evidence were copied into review metadata; no target or contact promotion occurred.",
        createdAt: now.toISOString(),
      },
    ].slice(-50),
    lastUpdatedBy: "human-candidate-admission",
  };
  const [updated] = await db.update(researchCasesTable).set({
    caseFile: JSON.stringify(updatedFile),
    status: "review",
    currentAction: "human-review-discovery-candidates",
    iteration: current.iteration + 1,
    lastDecisionAt: now,
    updatedAt: now,
  }).where(eq(researchCasesTable.id, current.id)).returning();
  await db.insert(researchCaseEventsTable).values({
    caseId: current.id,
    iteration: current.iteration + 1,
    actorRole: "human",
    eventType: "decision",
    summary: `Candidate admitted as review-only entity: ${candidate.name}.`,
    payload: JSON.stringify({
      entityId: entity.id,
      entityType,
      candidateName: candidate.name,
      sourceUrls: candidate.sourceUrls,
      contactEvidenceCount: candidate.contactEvidence?.length ?? 0,
      targetPromoted: false,
      contactPromoted: false,
    }),
  });
  res.json(serializeBureauCase(updated!, null));
});

router.post("/research/bureau/cases/:caseId/promote-target", async (req, res): Promise<void> => {
  const params = PromoteBureauCaseTargetParams.safeParse(req.params);
  const body = PromoteBureauCaseTargetBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [current] = await db.select().from(researchCasesTable)
    .where(eq(researchCasesTable.id, params.data.caseId))
    .limit(1);
  const [entity] = await db.select().from(entitiesTable).where(eq(entitiesTable.id, body.data.entityId)).limit(1);
  if (!current || !entity) {
    res.status(404).json({ error: !current ? "Bureau case not found" : "Entity not found" });
    return;
  }
  const discoveryFile = parseDiscoveryCaseFile(current.caseFile);
  if (!discoveryFile) {
    res.status(409).json({ error: "Only a discovery case can be promoted to a target" });
    return;
  }
  const targetFile = buildInitialCaseFile(entity);
  const now = new Date();
  const promotedFile = {
    ...targetFile,
    discoveryContext: {
      caseId: current.id,
      humanBrief: discoveryFile.humanBrief,
      bossPremise: discoveryFile.bossPremise,
      initialResearch: discoveryFile.initialResearch,
    },
    lastUpdatedBy: "boss-target-promotion",
  };
  const [updated] = await db.update(researchCasesTable).set({
    targetEntityId: entity.id,
    caseType: "target",
    status: "ready",
    caseFile: JSON.stringify(promotedFile),
    currentAction: promotedFile.nextBestAction?.id ?? null,
    iteration: current.iteration + 1,
    lastDecisionAt: now,
    updatedAt: now,
  }).where(eq(researchCasesTable.id, current.id)).returning();
  await db.insert(researchCaseEventsTable).values({
    caseId: current.id,
    iteration: current.iteration + 1,
    actorRole: "head_investigator",
    eventType: "status",
    summary: `Discovery candidate promoted to target case: ${entity.name}.`,
    payload: JSON.stringify({ entityId: entity.id, entityName: entity.name }),
  });
  res.json(serializeBureauCase(updated!, entity));
});

router.post("/research/cases", async (req, res): Promise<void> => {
  const parsed = OpenResearchCaseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { entityId, objective, motivation } = parsed.data;
  const [entity] = await db.select().from(entitiesTable).where(eq(entitiesTable.id, entityId));
  if (!entity) {
    res.status(404).json({ error: "Entity not found" });
    return;
  }
  const existing = await findCase(entityId);
  if (existing) {
    res.status(200).json(serializeCase(existing, entity));
    return;
  }
  const caseFile = buildInitialCaseFile(entity);
  const bossModel = await resolveGeminiBossModel();
  const [created] = await db.insert(researchCasesTable).values({
    targetEntityId: entityId,
    caseType: "target",
    directorMode: bossModel.status === "resolved" ? "gemini_boss" : "gemini_boss_pending",
    directorProvider: "gemini",
    objective: objective?.trim() || "Find the strongest practical public route to the target and map the surrounding ownership and relationship context.",
    motivation: motivation?.trim() || "Search broadly across public life, organizations, people, venues, digital traces, and relationship paths; return an organized case for human judgment.",
    directorModel: bossModel.model,
    caseFile: JSON.stringify(caseFile),
    currentAction: caseFile.nextBestAction?.id ?? null,
    iteration: 0,
    status: "ready",
  }).returning();
  if (!created) {
    res.status(500).json({ error: "Unable to open research case" });
    return;
  }
  await db.insert(researchCaseEventsTable).values({
    caseId: created.id,
    actorRole: "boss",
    eventType: "case_opened",
    summary: "Case opened with a target-scoped bureau roster and initial action queue.",
    payload: JSON.stringify({ actionCount: caseFile.actionQueue.length, specialistCount: caseFile.specialistRoster.length }),
  });
  res.status(201).json(serializeCase(created, entity));
});

router.get("/research/cases/:entityId", async (req, res): Promise<void> => {
  const params = GetResearchCaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select({
    case: researchCasesTable,
    entityName: entitiesTable.name,
    entityType: entitiesTable.type,
  }).from(researchCasesTable)
    .leftJoin(entitiesTable, eq(researchCasesTable.targetEntityId, entitiesTable.id))
    .where(eq(researchCasesTable.targetEntityId, params.data.entityId))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Research case not found" });
    return;
  }
  res.json(serializeCase(row.case, row.entityName ? { name: row.entityName, type: row.entityType ?? "Unknown" } : null));
});

router.post("/research/cases/:entityId/advance", async (req, res): Promise<void> => {
  const params = AdvanceResearchCaseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const current = await findCase(params.data.entityId);
  if (!current) {
    res.status(404).json({ error: "Research case not found" });
    return;
  }
  const file = parseCaseFile(current.caseFile);
  if (!file) {
    res.status(500).json({ error: "Research case file is invalid" });
    return;
  }
  const nextIteration = current.iteration + 1;
  const reasoning = await runNvidiaNimCaseReasoning({
    file,
    iteration: nextIteration,
  });
  // Boss remains the Head Investigator and owns the final queue decision.
  // GLM is a right-hand advisor: preserve its recommendation in case context,
  // but never let it directly select or activate the Boss's action.
  const advisedFile = recordRightHandAdvice(file, {
    model: reasoning.model,
    status: reasoning.status,
    actionId: reasoning.actionId,
    decision: reasoning.decision,
    reason: reasoning.reason,
    confidence: reasoning.confidence,
    error: reasoning.error,
  });
  const bossPlan = await runGeminiBossPlan({
    file: advisedFile,
    rightHandAdvice: advisedFile.rightHandAdvice,
    iteration: nextIteration,
  });
  const bossDecisionFile = bossPlan.status === "completed"
    && bossPlan.actionId
    && bossPlan.decision
    && bossPlan.reason
    ? applyGeminiBossPlan(advisedFile, {
        actionId: bossPlan.actionId,
        decision: bossPlan.decision,
        reason: bossPlan.reason,
        iteration: nextIteration,
      }) ?? advanceCaseFile(advisedFile, nextIteration)
    : advanceCaseFile(advisedFile, nextIteration);
  const updatedFile = recordGeminiBossPlan(bossDecisionFile, bossPlan);
  const now = new Date();
  const [updated] = await db.update(researchCasesTable).set({
    caseFile: JSON.stringify(updatedFile),
    currentAction: updatedFile.nextBestAction?.id ?? null,
    iteration: nextIteration,
    status: updatedFile.nextBestAction ? "active" : "review",
    lastDecisionAt: now,
    updatedAt: now,
  }).where(eq(researchCasesTable.id, current.id)).returning();
  const action = updatedFile.nextBestAction;
  await db.insert(researchCaseEventsTable).values({
    caseId: current.id,
    iteration: nextIteration,
    actorRole: "right_hand_advisor",
    eventType: "decision",
    summary: reasoning.status === "completed"
      ? `GLM right-hand advisory recommendation: ${reasoning.actionId ?? "none"}. Boss decision remains authoritative.`
      : "GLM right-hand advisor unavailable; Boss used the local planning fallback.",
    payload: JSON.stringify({
      advisor: updatedFile.rightHandAdvice,
    }),
  });
  await db.insert(researchCaseEventsTable).values({
    caseId: current.id,
    iteration: nextIteration,
    actorRole: "boss",
    eventType: "decision",
    summary: action
      ? `Boss assigned ${action.title} to ${action.specialistId}.`
      : "Boss left no queued action; case is ready for review.",
    payload: JSON.stringify({
      action,
      decision: updatedFile.decisionLog.at(-1),
      bossPlan: updatedFile.bossPlan,
      advisorConsulted: reasoning.status === "completed",
    }),
  });
  const [entity] = await db.select({ name: entitiesTable.name, type: entitiesTable.type }).from(entitiesTable).where(eq(entitiesTable.id, params.data.entityId));
  res.json(serializeCase(updated!, entity ?? null));
});

router.post("/research/cases/:entityId/directive", async (req, res): Promise<void> => {
  const params = AddResearchCaseDirectiveParams.safeParse(req.params);
  const body = AddResearchCaseDirectiveBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const current = await findCase(params.data.entityId);
  if (!current) {
    res.status(404).json({ error: "Research case not found" });
    return;
  }
  const file = parseCaseFile(current.caseFile);
  if (!file) {
    res.status(500).json({ error: "Research case file is invalid" });
    return;
  }
  const directive = body.data.directive.trim();
  const updatedFile = {
    ...file,
    humanDirectives: [...file.humanDirectives, directive].slice(-30),
    lastUpdatedBy: "human-operator",
  };
  const now = new Date();
  const [updated] = await db.update(researchCasesTable).set({
    caseFile: JSON.stringify(updatedFile),
    updatedAt: now,
  }).where(eq(researchCasesTable.id, current.id)).returning();
  await db.insert(researchCaseEventsTable).values({
    caseId: current.id,
    iteration: current.iteration,
    actorRole: "human_operator",
    eventType: "directive",
    summary: directive,
    payload: JSON.stringify({ directive }),
  });
  const [entity] = await db.select({ name: entitiesTable.name, type: entitiesTable.type }).from(entitiesTable).where(eq(entitiesTable.id, params.data.entityId));
  res.json(serializeCase(updated!, entity ?? null));
});

router.get("/research/cases/:entityId/events", async (req, res): Promise<void> => {
  const params = ListResearchCaseEventsParams.safeParse(req.params);
  const query = ListResearchCaseEventsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const current = await findCase(params.data.entityId);
  if (!current) {
    res.status(404).json({ error: "Research case not found" });
    return;
  }
  const rows = await db.select().from(researchCaseEventsTable)
    .where(eq(researchCaseEventsTable.caseId, current.id))
    .orderBy(desc(researchCaseEventsTable.createdAt))
    .limit(query.data.limit);
  res.json(rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  })));
});

export default router;