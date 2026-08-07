import React from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Key,
  Radio,
  RefreshCw,
  Target,
  Users,
} from "lucide-react";
import { formatSchedulerCountdown, schedulerWaitRemaining } from "./scheduler-utils";

interface ResearchSession {
  id: number;
  targetEntityName: string | null;
  winningPath: string | null;
  bayesianScoreAtRuntime: number | null;
  pathScore: number | null;
  createdAt: string;
}

interface AtlasTelemetry {
  stage: string;
  status: "active" | "complete" | "blocked" | "review";
  targetName?: string;
  targetType?: string;
  toolIds?: string[];
  activeToolId?: string;
  prompt?: string;
  inputSummary?: string;
  resultSummary?: string;
  sources?: number;
  evidence?: number;
  contacts?: number;
  nextAction?: string;
  disposition?: "contact_route_found" | "needs_follow_up";
  personaNames?: string[];
}

interface AtlasLiveState {
  runStatus: "running" | "done" | "failed";
  phase: number;
  phaseLabel: string;
  phaseProgress: number;
  phaseTotal: number;
  sourceStep: number | null;
  sourceTotal: number | null;
  currentEntities: string[];
  entityProgress: number | null;
  entityTotal: number | null;
  detail: string;
  atlasTelemetry?: AtlasTelemetry;
  eventLog?: Array<{
    timestamp?: string;
    stage?: string;
    status?: string;
    targetName?: string;
    targetType?: string;
    activeToolId?: string;
    prompt?: string;
    inputSummary?: string;
    resultSummary?: string;
    sources?: number;
    evidence?: number;
    contacts?: number;
    raw?: string;
  }>;
  phaseJ?: {
    status?: string;
    progress?: number;
    total?: number;
    inserted?: number;
    errors?: number;
    message?: string;
  } | null;
}

interface AutoPipelineScheduler {
  enabled: boolean;
  active: boolean;
  nextTriggerAt?: string;
  lastStatus?: "triggered" | "completed" | "skipped_lock" | "no_targets" | "error";
  lastMessage?: string;
  cycles: number;
  skippedDueToLock: number;
  providerNoTarget: number;
}

interface MobileReactorFlowProps {
  sessions: ResearchSession[];
  totalEntities: number;
  hotCount: number;
  totalAssets: number;
  loading: boolean;
  onRefresh: () => void;
  syncing: boolean;
  liveNodes: Set<string>;
  liveLabel: string;
  livePhaseDetail: string;
  atlasState: AtlasLiveState | null;
  scheduler: AutoPipelineScheduler | null;
  schedulerNow: number;
  exhaustedKeys: string[];
}

const MOBILE_PHASES = [
  { id: "input", label: "TARGET ACQUISITION", detail: "Target becomes a research brief", nodeIds: ["target"] },
  { id: "registries", label: "PUBLIC REGISTRIES", detail: "Public records establish the evidence base", nodeIds: ["faa", "edgar", "hmlr", "ch", "hnwi", "occrp", "brreg", "whoxy"] },
  { id: "discovery", label: "BROAD DISCOVERY", detail: "Open sources expand identity and activity", nodeIds: ["inhouse", "webdisc", "deepweb", "opensky", "maigret"] },
  { id: "ai_layer", label: "AI EXTRACTION", detail: "Search, extraction, and adaptive follow-up", nodeIds: ["perp0", "exa", "tavily", "gemini", "groq", "perpfu"] },
  { id: "synthesis", label: "VECTOR SYNTHESIS", detail: "Evidence becomes vectors and priority", nodeIds: ["semantic", "bayesian"] },
  { id: "core", label: "REACTOR CORE", detail: "Relationships and paths are evaluated", nodeIds: ["graph", "mcts", "prac"] },
  { id: "output", label: "EVIDENCE REVIEW", detail: "A research path for analyst assessment", nodeIds: ["evidence"] },
];

function QuickStat({
  label,
  value,
  color,
}: {
  label: string;
  value: React.ReactNode;
  color: string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2 py-1.5">
      <div className="truncate text-[8px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-0.5 text-[14px] font-bold tabular-nums leading-none" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function formatTool(tool: string): string {
  const labels: Record<string, string> = {
    perp0: "Perplexity",
    perpfu: "Perplexity follow-up",
    exa: "Exa",
    tavily: "Tavily",
    gemini: "Gemini",
    groq: "Groq extraction",
    inhouse: "In-house OSINT",
    webdisc: "Web discovery",
    deepweb: "Deep web OSINT",
    maigret: "Maigret",
    holehe: "Holehe",
    occrp: "OCCRP Aleph",
    whoxy: "Whoxy / WHOIS",
    opensky: "OpenSky",
    graph: "Relationship graph",
    semantic: "Semantic vectors",
    bayesian: "Bayesian scoring",
    "domain-resolver": "Domain resolution",
    "digital-footprint": "Digital footprint",
    "contact-attribution": "Contact attribution",
    "source-cooldowns": "Source cooldowns",
    mcts: "MCTS / UCT",
    prac: "Path review",
    evidence: "Evidence review",
    "persona-review": "11-persona quality review",
  };
  return labels[tool] ?? tool;
}

const PERSONA_REVIEW_TOOL = "persona-review";

function isPersonaReviewTool(tool: string): boolean {
  return tool === PERSONA_REVIEW_TOOL;
}

function eventTime(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function progressPercent(value: number | null | undefined, total: number | null | undefined): number {
  if (value == null || total == null || total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800/90">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${value}%`, backgroundColor: color }}
      />
    </div>
  );
}

function LiveResearchConsole({
  atlasState,
  livePhaseDetail,
  isLive,
}: {
  atlasState: AtlasLiveState | null;
  livePhaseDetail: string;
  isLive: boolean;
}) {
  const telemetry = atlasState?.atlasTelemetry;
  const phaseJ = atlasState?.phaseJ;
  const targetName = telemetry?.targetName || atlasState?.currentEntities[0];
  const targetType = telemetry?.targetType;
  const isFailed = atlasState?.runStatus === "failed";
  const isDone = atlasState?.runStatus === "done";
  const operation = atlasState?.detail || livePhaseDetail;
  const phaseReported = atlasState != null && atlasState.phaseTotal > 0;
  const phasePercent = phaseReported ? progressPercent(atlasState.phase, atlasState.phaseTotal) : 0;
  const hasTargetQueue = atlasState?.entityProgress != null && atlasState.entityTotal != null;
  const hasSourceQueue = atlasState?.sourceStep != null && atlasState.sourceTotal != null;
  const queueValue = hasTargetQueue
    ? `${atlasState.entityProgress} / ${atlasState.entityTotal}`
    : hasSourceQueue
      ? `${atlasState.sourceStep} / ${atlasState.sourceTotal}`
      : "Not reported";
  const queuePercent = hasTargetQueue
    ? progressPercent(atlasState.entityProgress, atlasState.entityTotal)
    : progressPercent(atlasState?.sourceStep, atlasState?.sourceTotal);
  const queueLabel = hasTargetQueue ? "Target queue" : hasSourceQueue ? "Source queue" : "Queue";
  const latestEventResult = atlasState?.eventLog?.find((event) => event.resultSummary)?.resultSummary;
  const latestResult = telemetry?.resultSummary || latestEventResult;
  const researchTools = telemetry?.toolIds?.filter((tool) => !isPersonaReviewTool(tool)) ?? [];
  const hasPersonaReview = Boolean(
    telemetry?.toolIds?.some(isPersonaReviewTool) || telemetry?.personaNames?.length,
  );
  const statusLabel = isFailed
    ? "Run failed"
    : isDone
      ? "Run complete"
      : isLive
        ? "Research active"
        : "Research idle";
  const statusClass = isFailed
    ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
    : isDone
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : isLive
        ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
        : "border-white/10 bg-white/[0.03] text-slate-400";

  return (
    <section className="mb-5 rounded-2xl border border-cyan-400/20 bg-[#071525]/95 p-3.5 shadow-[0_0_30px_rgba(34,211,238,0.07)]">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">
            <Radio className="h-3.5 w-3.5 shrink-0" />
            Atlas run state
          </div>
          <div
            className="mt-1 truncate text-[10px] leading-4 text-slate-500"
            aria-live="polite"
            data-testid="status-atlas-operation"
          >
            {isLive
              ? livePhaseDetail || atlasState?.detail || "Atlas run is in progress"
              : isDone
                ? "Atlas has reported a completed run"
                : isFailed
                  ? "Atlas stopped with a reported failure"
                  : "Standby · Atlas is idle by design — no research run in progress"}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${statusClass}`}
          data-testid="status-atlas-run"
        >
          {statusLabel}
        </span>
      </div>

      <div className="mb-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5" data-testid="card-current-target">
        <div className="mb-1 text-[8px] uppercase tracking-[0.18em] text-slate-500">Current target</div>
        <div className="flex items-start gap-2">
          <Target className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
          <div className="min-w-0">
            <div className={`truncate text-[15px] font-semibold ${targetName ? "text-white" : "text-slate-500"}`}>
              {targetName || "No target reported"}
            </div>
            <div className="mt-0.5 truncate text-[9px] uppercase tracking-wider text-slate-500">
              {targetType || "Target type not reported"}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5" data-testid="card-atlas-phase-progress">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[8px] uppercase tracking-wider text-slate-500">Atlas phase</div>
            {atlasState?.sourceStep != null && atlasState.sourceTotal != null && (
              <div className="text-[8px] tabular-nums text-slate-600">
                source {atlasState.sourceStep}/{atlasState.sourceTotal}
              </div>
            )}
          </div>
          <div className="mt-1 text-[14px] font-bold text-cyan-300">
            {phaseReported ? `${atlasState.phase} / ${atlasState.phaseTotal}` : "Not reported"}
          </div>
          <div className="mt-0.5 truncate text-[9px] text-slate-400">{atlasState?.phaseLabel || "Phase not reported"}</div>
          <ProgressBar value={phasePercent} color="#22d3ee" />
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5" data-testid="card-queue-progress">
          <div className="text-[8px] uppercase tracking-wider text-slate-500">{queueLabel}</div>
          <div className={`mt-1 text-[14px] font-bold ${hasTargetQueue || hasSourceQueue ? "text-lime-300" : "text-slate-500"}`}>
            {queueValue}
          </div>
          <div className="mt-0.5 truncate text-[9px] text-slate-400">
            {hasTargetQueue ? "targets completed" : hasSourceQueue ? "sources completed" : "Atlas queue is not reported"}
          </div>
          <ProgressBar value={queuePercent} color="#a3e635" />
        </div>
      </div>

      <div className="mb-3 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-3" data-testid="card-current-operation">
        <div className="mb-1 text-[8px] uppercase tracking-[0.18em] text-cyan-400/70">Current operation</div>
        <div className="text-[11px] leading-relaxed text-slate-200">
          {operation || (isDone ? "Run complete; no active operation reported." : isFailed ? "Run failed; no active operation reported." : "No operation reported while Atlas is idle.")}
        </div>
      </div>

      {telemetry && (researchTools.length > 0 || hasPersonaReview) && (
        <div className="mb-3 rounded-xl border border-white/10 bg-black/20 p-3" data-testid="card-lane-explanation">
          <div className="mb-2 text-[8px] uppercase tracking-[0.18em] text-slate-500">How to read this lane</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] px-2 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-cyan-300">OSINT &amp; evidence</div>
              <div className="mt-1 text-[9px] leading-4 text-slate-400">Actual public-source research and attribution.</div>
            </div>
            <div className="rounded-lg border border-violet-400/20 bg-violet-400/[0.04] px-2 py-2">
              <div className="text-[9px] font-semibold uppercase tracking-wider text-violet-300">Persona review</div>
              <div className="mt-1 text-[9px] leading-4 text-slate-400">Checks saved results; does not search or add contacts.</div>
            </div>
          </div>
        </div>
      )}

      {latestResult && (
        <div className="mb-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] p-3" data-testid="card-latest-result">
          <div className="mb-1 flex items-center gap-2 text-[8px] uppercase tracking-[0.18em] text-emerald-300/80">
            <CheckCircle2 className="h-3 w-3" />
            Latest confirmed result
          </div>
          <div className="text-[11px] leading-relaxed text-slate-300">{latestResult}</div>
        </div>
      )}

      {telemetry && (
        <>
          <div className="mb-3 grid grid-cols-3 gap-1.5">
            <QuickStat label="Sources" value={telemetry.sources ?? "—"} color="#38bdf8" />
            <QuickStat label="Evidence" value={telemetry.evidence ?? "—"} color="#a3e635" />
            <QuickStat label="Contacts" value={telemetry.contacts ?? "—"} color="#fbbf24" />
          </div>

          {(telemetry.toolIds?.length || telemetry.personaNames?.length || telemetry.nextAction) && (
            <details className="mb-3 rounded-xl border border-white/10 bg-black/20">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[9px] uppercase tracking-[0.16em] text-slate-500 touch-manipulation">
                <span className="flex items-center gap-2">
                  <Cpu className="h-3 w-3 text-cyan-400/80" />
                  Research context
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-600 transition-transform" />
              </summary>
              <div className="space-y-3 border-t border-white/10 px-3 pb-3 pt-3">
                {telemetry.toolIds && telemetry.toolIds.length > 0 && (
                  <div className="space-y-3">
                    {telemetry.toolIds.some((tool) => !isPersonaReviewTool(tool)) && (
                      <div>
                        <div className="mb-1.5 text-[8px] uppercase tracking-[0.16em] text-cyan-300/70">
                          OSINT &amp; evidence tools
                        </div>
                        <div className="mb-1.5 text-[10px] leading-4 text-slate-400">
                          Search, resolve, extract, and attribute public evidence for this target.
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {telemetry.toolIds.filter((tool) => !isPersonaReviewTool(tool)).map((tool) => {
                            const active = tool === telemetry.activeToolId;
                            return (
                              <span
                                key={tool}
                                className={`rounded-md border px-2 py-1 text-[9px] ${active ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-200" : "border-white/10 bg-white/[0.03] text-slate-500"}`}
                              >
                                {active ? "Active · " : ""}
                                {formatTool(tool)}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {telemetry.toolIds.some(isPersonaReviewTool) && (
                      <div className="rounded-lg border border-violet-400/25 bg-violet-400/[0.06] px-2.5 py-2">
                        <div className="mb-1 flex items-center gap-1.5 text-[8px] uppercase tracking-[0.16em] text-violet-300">
                          <Users className="h-3 w-3" />
                          Post-research quality review
                        </div>
                        <div className="mb-2 text-[10px] leading-4 text-slate-300">
                          11 deterministic personas inspect the saved Phase J result. They do not search the web, add contacts, or perform OSINT.
                        </div>
                        <span className={`inline-flex rounded-md border px-2 py-1 text-[9px] ${telemetry.activeToolId === PERSONA_REVIEW_TOOL ? "border-violet-300/50 bg-violet-300/10 text-violet-200" : "border-violet-300/20 bg-violet-300/[0.04] text-violet-300/70"}`}>
                          {telemetry.activeToolId === PERSONA_REVIEW_TOOL ? "Active · " : ""}
                          {formatTool(PERSONA_REVIEW_TOOL)}
                        </span>
                      </div>
                    )}
                    {telemetry.toolIds.length === 0 && (
                      <div className="text-[10px] text-slate-500">No tool lanes reported for this checkpoint.</div>
                    )}
                  </div>
                )}
                {!telemetry.toolIds?.length && (telemetry.personaNames?.length ?? 0) > 0 && (
                  <div className="rounded-lg border border-violet-400/25 bg-violet-400/[0.06] px-2.5 py-2">
                    <div className="mb-1 flex items-center gap-1.5 text-[8px] uppercase tracking-[0.16em] text-violet-300">
                      <Users className="h-3 w-3" />
                      Post-research quality review
                    </div>
                    <div className="text-[10px] leading-4 text-slate-300">
                      11 deterministic personas inspect the saved Phase J result. They do not search the web, add contacts, or perform OSINT.
                    </div>
                  </div>
                )}
                {telemetry.nextAction && (
                  <div className="border-l border-amber-400/40 pl-2 text-[10px] leading-4 text-slate-300">
                    <span className="text-[8px] uppercase tracking-wider text-amber-300/70">Next decision · </span>
                    {telemetry.nextAction}
                  </div>
                )}
                {telemetry.personaNames && telemetry.personaNames.length > 0 && (
                  <div className="rounded-lg border border-violet-400/15 bg-violet-400/[0.03] px-2.5 py-2 text-[10px] leading-4 text-slate-300">
                    <span className="mr-1 inline-flex items-center gap-1 text-[8px] uppercase tracking-wider text-violet-300/80">
                      <Users className="h-3 w-3" />
                      Review roles
                    </span>
                    <span className="text-slate-400">{telemetry.personaNames.join(" · ")}</span>
                  </div>
                )}
              </div>
            </details>
          )}

          {(telemetry.inputSummary || telemetry.prompt) && (
            <details className="mb-3 rounded-xl border border-white/10 bg-black/20">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-slate-500 touch-manipulation">
                Show research input
                <ChevronDown className="h-3.5 w-3.5 text-slate-600" />
              </summary>
              <div className="max-h-36 overflow-y-auto border-t border-white/10 px-3 py-3 whitespace-pre-wrap text-[10px] leading-relaxed text-slate-400">
                {telemetry.inputSummary || telemetry.prompt}
              </div>
            </details>
          )}
        </>
      )}

      {atlasState?.eventLog && atlasState.eventLog.length > 0 && (
        <details className="rounded-xl border border-white/10 bg-black/20" data-testid="details-event-feed">
          <summary className="flex min-h-[46px] cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 touch-manipulation">
            <span className="flex min-w-0 items-center gap-2">
              <Activity className="h-3.5 w-3.5 shrink-0 text-cyan-400/80" />
              <span className="truncate text-[9px] uppercase tracking-[0.16em] text-slate-500">Confirmed event feed</span>
              <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[8px] tabular-nums text-slate-500">
                {atlasState.eventLog.length}
              </span>
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-600" />
          </summary>
          <div className="space-y-2 border-t border-white/10 px-3 pb-3 pt-3">
            {atlasState.eventLog.slice(0, 8).map((event, index) => {
              const status = event.status ?? "active";
              const statusColor =
                status === "complete"
                  ? "border-lime-400/20 bg-lime-400/[0.04] text-lime-300"
                  : status === "review" || status === "blocked"
                    ? "border-amber-400/20 bg-amber-400/[0.04] text-amber-300"
                    : "border-cyan-400/20 bg-cyan-400/[0.04] text-cyan-200";
              return (
                <details key={`${event.timestamp ?? "event"}-${index}`} className={`rounded-xl border p-2.5 ${statusColor}`}>
                  <summary className="min-h-[42px] cursor-pointer list-none touch-manipulation">
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-[10px] font-semibold leading-4">{event.stage ?? "Research event"}</span>
                          <span className="shrink-0 text-[8px] text-slate-500">{eventTime(event.timestamp)}</span>
                        </div>
                        <div className="mt-0.5 truncate text-[9px] text-slate-400">
                          {event.activeToolId ? formatTool(event.activeToolId) : "Atlas"}
                          {event.targetName ? ` · ${event.targetName}` : ""}
                        </div>
                        {event.resultSummary && (
                          <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-300">{event.resultSummary}</div>
                        )}
                      </div>
                    </div>
                  </summary>
                  <div className="mt-2 space-y-2 border-t border-white/10 pt-2 text-[10px] leading-4 text-slate-400">
                    {event.inputSummary && <div><span className="text-slate-600">INPUT · </span>{event.inputSummary}</div>}
                    {event.prompt && (
                      <details className="rounded-lg border border-white/10 bg-black/20 p-2">
                        <summary className="min-h-[36px] cursor-pointer list-none py-2 text-[9px] uppercase tracking-wider text-slate-500 touch-manipulation">
                          Prompt sent
                        </summary>
                        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[9px] leading-4 text-slate-400">{event.prompt}</div>
                      </details>
                    )}
                    {event.resultSummary && <div><span className="text-slate-600">RESULT · </span>{event.resultSummary}</div>}
                    {(event.sources !== undefined || event.evidence !== undefined || event.contacts !== undefined) && (
                      <div className="flex flex-wrap gap-2 pt-1 text-[9px] text-slate-500">
                        {event.sources !== undefined && <span>sources {event.sources}</span>}
                        {event.evidence !== undefined && <span>evidence {event.evidence}</span>}
                        {event.contacts !== undefined && <span>contacts {event.contacts}</span>}
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </details>
      )}

      {!telemetry && (
        <div className="mt-3 rounded-xl border border-amber-400/15 bg-amber-400/[0.04] p-3" data-testid="status-telemetry-unavailable">
          <div className="mb-1 flex items-center gap-2 text-[9px] uppercase tracking-[0.18em] text-amber-300/70">
            <AlertTriangle className="h-3 w-3" />
            Lane telemetry unavailable
          </div>
          <div className="text-[10px] leading-relaxed text-slate-300">
            Showing only confirmed Atlas job progress. No research tool or result is inferred from the parent status message.
          </div>
        </div>
      )}

      {phaseJ && telemetry?.sources == null && (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          <QuickStat label="J4–J9 pass" value={phaseJ.progress != null && phaseJ.total != null ? `${phaseJ.progress}/${phaseJ.total}` : "—"} color="#38bdf8" />
          <QuickStat label="Persisted" value={phaseJ.inserted ?? "—"} color="#a3e635" />
          <QuickStat label="Errors" value={phaseJ.errors ?? "—"} color={phaseJ.errors ? "#fb7185" : "#64748b"} />
        </div>
      )}
    </section>
  );
}

export function MobileReactorFlow(props: MobileReactorFlowProps) {
  const {
    totalEntities,
    hotCount,
    totalAssets,
    sessions,
    liveNodes,
    liveLabel,
    atlasState,
    scheduler,
    schedulerNow,
    exhaustedKeys,
    livePhaseDetail,
    onRefresh,
    syncing,
  } = props;

  // A failed or completed run is never presented as active. Without Atlas
  // state, liveNodes is the only explicit activity signal available.
  const isLive = atlasState
    ? atlasState.runStatus === "running"
    : liveNodes.size > 0;
  const schedulerCountdown = formatSchedulerCountdown(schedulerWaitRemaining(scheduler, schedulerNow));
  const waitingForNextCycle = Boolean(!isLive && schedulerCountdown);
  const statusLabel = atlasState?.runStatus === "failed"
    ? "Failed"
    : atlasState?.runStatus === "done"
      ? waitingForNextCycle ? "Next cycle queued" : "Complete"
      : isLive
        ? "Active"
        : waitingForNextCycle ? "Next cycle queued" : "Nominal";
  const statusClass = atlasState?.runStatus === "failed"
    ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
    : waitingForNextCycle
      ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
      : atlasState?.runStatus === "done"
        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
        : isLive
        ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
        : "border-lime-400/30 bg-lime-400/10 text-lime-300";

  let activePhaseIndex = -1;
  if (isLive) {
    for (let i = MOBILE_PHASES.length - 1; i >= 0; i -= 1) {
      if (MOBILE_PHASES[i].nodeIds.some((id) => liveNodes.has(id))) {
        activePhaseIndex = i;
        break;
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0b1120] font-sans text-slate-200">
      <header className="shrink-0 border-b border-white/10 bg-black/25 px-4 py-2.5 backdrop-blur-md">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">Reactor status</div>
            <div
              className={`mt-1 truncate text-[10px] font-mono tracking-wide ${isLive ? "text-cyan-400/80" : "text-slate-500"}`}
              role="status"
              aria-live="polite"
              data-testid="status-reactor-summary"
            >
              {isLive
                ? liveLabel || livePhaseDetail || "Live Atlas research in progress"
                : waitingForNextCycle
                  ? `Standby · next Atlas cycle in ${schedulerCountdown}`
                  : atlasState?.runStatus === "done"
                    ? "Standby · last Atlas run completed"
                    : atlasState?.runStatus === "failed"
                      ? "Standby · last Atlas run failed"
                      : "Standby · Atlas is idle by design — no research run in progress"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`flex items-center gap-1.5 rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${statusClass}`} data-testid="status-reactor">
              <span className={`h-1.5 w-1.5 rounded-full ${isLive ? "animate-pulse bg-cyan-400" : atlasState?.runStatus === "failed" ? "bg-rose-400" : waitingForNextCycle ? "bg-amber-300" : "bg-lime-400"}`} />
              {statusLabel}
            </span>
            <button
              type="button"
              onClick={onRefresh}
              disabled={syncing}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:border-cyan-400/30 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={syncing ? "Refreshing Atlas data" : "Refresh Atlas data"}
              data-testid="button-refresh-atlas"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <div className="mt-2 flex gap-1.5">
          <QuickStat label="Entities" value={totalEntities} color="#38bdf8" />
          <QuickStat label="Hot leads" value={hotCount} color="#a3e635" />
          <QuickStat label="Assets" value={totalAssets} color="#22d3ee" />
          <QuickStat label="Sessions" value={sessions.length} color="#a78bfa" />
        </div>
        <div
          className={`mt-2 rounded-lg border px-2.5 py-2 text-[9px] ${
            scheduler?.enabled
              ? "border-cyan-400/20 bg-cyan-400/[0.04] text-cyan-300/80"
              : "border-white/10 bg-white/[0.025] text-slate-500"
          }`}
          data-testid="status-continuous-scheduler"
        >
          <div className="flex items-center justify-between gap-2 uppercase tracking-[0.16em]">
            <span>{scheduler?.enabled ? "Continuous Atlas enabled" : "Continuous Atlas paused"}</span>
            <span className="text-[8px] text-slate-500">
              {scheduler?.cycles ?? 0} cycle{scheduler?.cycles === 1 ? "" : "s"}
            </span>
          </div>
          {scheduler?.enabled && (
            <div className="mt-1 truncate text-[8px] text-slate-500" data-testid="status-scheduler-countdown">
              {schedulerCountdown
                ? `Next cycle in ${schedulerCountdown} · ${scheduler.nextTriggerAt ? new Date(scheduler.nextTriggerAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`
                : scheduler.nextTriggerAt
                  ? `Next cycle ${new Date(scheduler.nextTriggerAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : scheduler.lastMessage || "Preparing next discovery cycle"}
              {scheduler.lastStatus === "skipped_lock" ? " · waiting for active Atlas lock" : ""}
            </div>
          )}
        </div>
      </header>

      <div className="atlas-grid atlas-grid-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" style={{ WebkitOverflowScrolling: "touch" }}>
        <div className="mx-auto max-w-md">
          <LiveResearchConsole atlasState={atlasState} livePhaseDetail={livePhaseDetail} isLive={isLive} />

          <section aria-labelledby="pipeline-map-title" data-testid="section-pipeline-map">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Activity className="h-3.5 w-3.5 shrink-0 text-cyan-400/70" />
                <h2 id="pipeline-map-title" className="truncate text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
                  Atlas pipeline map
                </h2>
              </div>
              <span className="shrink-0 text-[8px] text-slate-600">context</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {MOBILE_PHASES.map((phase, index) => {
                const isActive = isLive && index === activePhaseIndex;
                const isCompleted = atlasState?.runStatus === "done" || (isLive && activePhaseIndex >= 0 && index < activePhaseIndex);
                const nodeCount = phase.nodeIds.filter((id) => liveNodes.has(id)).length;
                return (
                  <div
                    key={phase.id}
                    className={`relative min-h-[62px] rounded-xl border p-2.5 transition-colors ${index === MOBILE_PHASES.length - 1 ? "col-span-2" : ""} ${
                      isActive
                        ? "border-cyan-400/40 bg-cyan-400/[0.08]"
                        : isCompleted
                          ? "border-emerald-400/25 bg-emerald-400/[0.045]"
                          : "border-white/[0.08] bg-white/[0.025]"
                    }`}
                    data-testid={`pipeline-stage-${phase.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[8px] font-bold ${
                        isActive ? "border-cyan-400 text-cyan-300" : isCompleted ? "border-emerald-400 text-emerald-300" : "border-slate-700 text-slate-600"
                      }`}>
                        {isCompleted ? <CheckCircle2 className="h-3 w-3" /> : String(index + 1).padStart(2, "0")}
                      </div>
                      <div className="min-w-0">
                        <div className={`truncate text-[9px] font-bold tracking-[0.12em] ${isActive ? "text-cyan-300" : isCompleted ? "text-emerald-300/80" : "text-slate-400"}`}>
                          {phase.label}
                        </div>
                        <div className="mt-1 line-clamp-2 text-[9px] leading-3.5 text-slate-600">{phase.detail}</div>
                      </div>
                    </div>
                    {isActive && nodeCount > 0 && (
                      <div className="absolute bottom-2 right-2 text-[8px] uppercase tracking-wider text-cyan-400/70">
                        {nodeCount} live lane{nodeCount === 1 ? "" : "s"}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {exhaustedKeys.length > 0 && (
        <div className="shrink-0 border-t border-amber-900/40 bg-amber-950/20 px-4 py-2.5" role="alert" data-testid="alert-provider-rate-limit">
          <div className="flex items-start gap-2 text-[9px] font-bold uppercase leading-4 tracking-wider text-amber-400">
            <Key className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Provider rate limit — configured keys rotating: {exhaustedKeys.join(", ")}</span>
          </div>
        </div>
      )}
    </div>
  );
}