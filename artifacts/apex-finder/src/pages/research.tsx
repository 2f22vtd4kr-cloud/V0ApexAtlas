import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  getBureauCase,
  getListResearchEvidenceQueryKey,
  runBureauCaseBossReview,
  runBureauCaseNextPass,
  useListEntities,
  useRunResearch,
  useListResearchEvidence,
} from "@workspace/api-client-react";
import { Terminal, Play, Cpu, ChevronRight, Hash, CheckCircle2, GitBranch, Target, Shield, ChevronDown, Search, X, Mail, Phone, Copy, CheckCheck, Layers, ExternalLink, FileCheck2, CircleAlert } from "lucide-react";
import { cn, formatEntityName } from "@/lib/utils";
import { ScoreBadge } from "@/lib/utils";

// ── Correct types matching the API ──────────────────────────────────────────
type MctsStep = {
  step: number;
  action: string;
  registry: string;
  target: string;
  targetType: string;
  uctScore: number;
  warmthScore: number;
  reasoning: string;
};

type PathStep = {
  vertexId: string;
  label: string;
  nodeType: string;
  role: "TARGET" | "GATEKEEPER" | "INTERMEDIARY" | "ASSET";
  contactMethod?: string;
  registry?: string;
  actionRequired?: string;
  contactConfidence?: number | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
};

type ResearchEvidence = {
  id: number;
  claimType: string;
  claim: string;
  value?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  status: string;
  confidence: number;
  rejectionReason?: string | null;
  observedAt: string;
  freshnessScore: number;
  publishedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
};

type ResearchScorecard = {
  identity: number;
  ownership: number;
  contact: number;
  access: number;
  wealth: number;
  freshness: number;
  sourceQuality: number;
  overall: number;
};

type ContactCandidate = {
  key: string;
  vectorType: string;
  value: string;
  providers: string[];
  sourceDomains: string[];
  sourceUrls: string[];
  scopes: string[];
  personNames: string[];
  state: string;
  conflictCount: number;
  rejectionReason?: string | null;
  exactClaimObserved?: boolean;
};

type CandidateFunnel = {
  totalCandidates: number;
  discovered: number;
  sourceLinked: number;
  attributionReview: number;
  independentlyCorroborated: number;
  verifiedDirectRoute: number;
  rejected: number;
  organizationOnly: number;
  conflicted: number;
  independentSourceDomains: number;
  candidates: ContactCandidate[];
};

type RankedResearchRoute = {
  rank: number;
  tier: string;
  tierLabel: string;
  vectorType: string;
  value: string;
  personName: string | null;
  role: string | null;
  relationship: string | null;
  state: string;
  score: number;
  scope: string;
  sourceUrls: string[];
  sourceDomains: string[];
  note: string;
};

type IntroPathCandidate = {
  status: "review_required";
  routeKind: "intermediary_candidate" | "organization_route";
  target: { id: number; name: string; type: string };
  route: {
    label: string;
    value: string;
    vectorType: "email" | "phone";
    personName: string | null;
    role: string | null;
  };
  evidence: Array<{ source: string; sourceUrl: string; exactClaim: boolean; scope: string }>;
  corroboration: { sourceDomains: string[]; independentDomains: number };
  whyItMayHelp: string;
  nextManualAction: string;
  warnings: string[];
};

type BureauSpecialist = {
  id: string;
  title: string;
  mission: string;
  tools: string[];
  status: "ready" | "waiting_for_key";
};

type BureauAction = {
  id: string;
  title: string;
  purpose: string;
  specialistId: string;
  tools: string[];
  priority: number;
  status: "queued" | "active" | "complete" | "review";
  rationale: string;
};

type BureauContactRoute = {
  rank: number;
  tier: string;
  tierLabel: string;
  value: string;
  vectorType: string;
  personName: string | null;
  role: string | null;
  relationship: string | null;
  score: number;
  state: string;
  sourceUrls: string[];
  sourceDomains: string[];
  rationale: string;
  humanReview: "use_judgment";
};

type BureauCaseFile = {
  specialistRoster: BureauSpecialist[];
  actionQueue: BureauAction[];
  contactRoutes: BureauContactRoute[];
  humanDirectives: string[];
  decisionLog: Array<{ iteration: number; decision: string; reason: string; createdAt: string }>;
  rightHandAdvice?: {
    model: string;
    status: "completed" | "unavailable";
    actionId: string | null;
    decision: string | null;
    reason: string | null;
    confidence: number | null;
    error: string | null;
    createdAt: string;
  };
  bossPlan?: {
    model: string;
    status: "completed" | "unavailable";
    actionId: string | null;
    decision: string | null;
    reason: string | null;
    investigatorPrompt: string | null;
    restrictions: string[];
    tools: string[];
    evidenceRequirements: string[];
    confidence: number | null;
    error: string | null;
    createdAt: string;
  };
  nextBestAction: BureauAction | null;
  evidenceSummary: {
    sourceRegistries: string[];
    discoveredPeople: string[];
    relatedOrganizations: string[];
    evidenceCount: number;
    searchGaps: string[];
    negativeFindings: string[];
  };
};

type BureauCase = {
  id: number;
  targetEntityId: number | null;
  caseType?: string;
  targetEntityName: string | null;
  targetEntityType: string | null;
  status: string;
  directorMode: string;
  directorProvider?: string;
  directorModel: string;
  objective: string;
  motivation: string;
  openingPrompt?: string;
  caseFile: string;
  currentAction: string | null;
  iteration: number;
  lastDecisionAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type DiscoveryCaseFile = {
  caseType: "discovery";
  humanBrief: {
    geography: string;
    exclusions: string[];
  };
  bossPremise: string;
  initialAction: {
    title: string;
    purpose: string;
    status: string;
  };
  initialResearch: {
    status: string;
    researchResponse: string | null;
    bossCommentary: string | null;
    sourceUrls: string[];
    recordedAt: string | null;
  };
  discoveredCandidates?: Array<{
    name: string;
    type: string;
    relevance: string;
    reachability: string;
    sourceUrls: string[];
    state: string;
    admittedEntityId?: number | null;
    contactEvidence?: Array<{
      vectorType: string;
      value: string;
      scope: string;
      personName: string | null;
      role: string | null;
      sourceUrls: string[];
      note: string | null;
    }>;
  }>;
  investigatorReports?: Array<{
    id: string;
    lane: string;
    provider: string;
    status: string;
    iteration: number;
    summary: string;
    findings: string[];
    candidateNames: string[];
    sourceUrls: string[];
    nextQuestions: string[];
    contactEvidence?: Array<{
      vectorType: string;
      value: string;
      scope: string;
      personName: string | null;
      role: string | null;
      sourceUrls: string[];
      note: string | null;
    }>;
    error: string | null;
    createdAt: string;
  }>;
  currentProgress?: {
    reportCount: number;
    completedLanes: string[];
    openQuestions: string[];
    lastReviewedBy: string | null;
    refreshedAt: string | null;
  };
  nextInvestigation?: {
    rightHand: {
      status: string;
      decision: string | null;
      reason: string | null;
      focusLanes: string[];
      confidence: number | null;
      error: string | null;
      reviewedAt: string;
    } | null;
    boss: {
      status: string;
      decision: string | null;
      candidateNames: string[];
      nextDirections: string[];
      uncertainties: string[];
      error: string | null;
      reviewedAt: string;
    } | null;
  };
};

const HYBRID_PIPELINE = "L1: BM25+Semantic+Graph · L2: Planner→Retriever→Analyst→Critic · L3: QueryExpansion · L4: UCT(120 rollouts) · L5: Bayesian-UCB";

function roleIcon(role: string) {
  if (role === "TARGET") return <Target className="w-3 h-3 text-primary" />;
  if (role === "GATEKEEPER") return <Shield className="w-3 h-3 text-amber-500" />;
  if (role === "ASSET") return <GitBranch className="w-3 h-3 text-secondary" />;
  return <ChevronRight className="w-3 h-3 text-muted-foreground" />;
}

function roleColor(role: string) {
  if (role === "TARGET") return "border-primary/40 bg-primary/5 text-primary";
  if (role === "GATEKEEPER") return "border-amber-500/40 bg-amber-500/5 text-amber-400";
  if (role === "ASSET") return "border-secondary/30 bg-secondary/5 text-secondary";
  return "border-border bg-muted/10 text-muted-foreground";
}

function getWarmthColor(score: number) {
  if (score >= 0.75) return "text-primary font-bold";
  if (score >= 0.5) return "text-amber-400";
  return "text-muted-foreground";
}

function getActionColor(action: string) {
  if (action === "GATEKEEPER LOCKED") return "text-primary font-bold";
  if (action === "TARGET IDENTIFIED") return "text-amber-500";
  return "text-secondary";
}

function parseBureauCaseFile(value: string | null | undefined): BureauCaseFile | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as BureauCaseFile;
    return parsed && Array.isArray(parsed.actionQueue) ? parsed : null;
  } catch {
    return null;
  }
}

function parseDiscoveryCaseFile(value: string | null | undefined): DiscoveryCaseFile | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as DiscoveryCaseFile;
    return parsed?.caseType === "discovery" ? parsed : null;
  } catch {
    return null;
  }
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

function BureauCasePanel({
  entityId,
  bureauCase,
  onCaseChange,
}: {
  entityId: number | null;
  bureauCase: BureauCase | null;
  onCaseChange: (next: BureauCase | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [directive, setDirective] = useState("");
  const [error, setError] = useState<string | null>(null);
  const file = parseBureauCaseFile(bureauCase?.caseFile);

  useEffect(() => {
    if (!entityId) {
      onCaseChange(null);
      return;
    }
    let active = true;
    setError(null);
    fetch(`/api/research/cases/${entityId}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Unable to load the bureau case");
        return response.json() as Promise<BureauCase>;
      })
      .then((next) => {
        if (active) onCaseChange(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load the bureau case");
      });
    return () => {
      active = false;
    };
  }, [entityId, onCaseChange]);

  const request = async (url: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Bureau request failed");
      onCaseChange(payload as BureauCase);
      return true;
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Bureau request failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!entityId) return null;
  if (!bureauCase) {
    return (
      <div className="border-t border-border/50 bg-[#080C14] px-4 md:px-5 py-4 flex-shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-mono text-primary uppercase tracking-widest">Boss Case Bureau</h3>
            <p className="text-[11px] text-muted-foreground mt-1">The Boss leads the case; GLM serves as a bounded right-hand advisor.</p>
          </div>
          <button
            disabled={busy}
            onClick={() => void request("/api/research/cases", { entityId })}
            className="inline-flex items-center justify-center gap-2 rounded border border-primary/50 bg-primary/15 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-primary hover:bg-primary/25 disabled:opacity-50"
          >
            <Play className="w-3 h-3" /> {busy ? "Opening…" : "Open bureau case"}
          </button>
        </div>
        {error && <div className="mt-2 text-[10px] text-rose-300">{error}</div>}
      </div>
    );
  }

  const nextAction = file?.nextBestAction;
  const roster = file?.specialistRoster ?? [];
  const routes = file?.contactRoutes ?? [];
  const activeSpecialist = roster.find((specialist) => specialist.id === nextAction?.specialistId);

  return (
    <div className="border-t border-border/50 bg-[#080C14] px-4 md:px-5 py-4 flex-shrink-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-mono text-primary uppercase tracking-widest flex items-center gap-2">
            <Cpu className="w-3.5 h-3.5" /> Boss Case Bureau
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-3xl">{bureauCase.objective}</p>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
          iteration {bureauCase.iteration} · {bureauCase.status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-3">
        <div className="rounded border border-primary/25 bg-primary/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider font-mono text-primary">Next best investigation action</span>
            <button
              disabled={busy}
              onClick={() => void request(`/api/research/cases/${entityId}/advance`)}
              className="inline-flex items-center gap-1 rounded border border-primary/40 px-2 py-1 text-[10px] font-mono text-primary hover:bg-primary/15 disabled:opacity-50"
            >
              <ChevronRight className="w-3 h-3" /> {busy ? "Boss reviewing…" : "Ask Boss to advance"}
            </button>
          </div>
          {nextAction ? (
            <>
              <div className="text-sm font-semibold text-foreground mt-2">{nextAction.title}</div>
              <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{nextAction.purpose}</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <span className="rounded border border-border/60 px-1.5 py-0.5 text-[9px] font-mono text-amber-300">
                  {activeSpecialist?.title ?? nextAction.specialistId}
                </span>
                {nextAction.tools.slice(0, 5).map((tool) => (
                  <span key={tool} className="rounded border border-border/60 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">{tool}</span>
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground/80 mt-2">Why now: {nextAction.rationale}</div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground mt-2">No queued action. Add a directive or ask the Boss for a new plan.</div>
          )}
        </div>

        <div className="rounded border border-amber-400/20 bg-amber-400/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider font-mono text-amber-300">Boss's right-hand advisor</span>
            <span className="text-[9px] font-mono text-muted-foreground">advisory only</span>
          </div>
          {file?.rightHandAdvice?.status === "completed" ? (
            <>
              <div className="text-[10px] text-foreground mt-2">{file.rightHandAdvice.model} recommends <span className="text-amber-300">{file.rightHandAdvice.actionId}</span></div>
              <div className="text-[10px] text-muted-foreground mt-1">{file.rightHandAdvice.reason}</div>
              <div className="text-[9px] text-muted-foreground/70 mt-2">Boss remains authoritative and may choose a different action.</div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground mt-2">No GLM recommendation recorded yet. The Boss can proceed with the local planning fallback.</div>
          )}
        </div>

        <div className="rounded border border-primary/20 bg-primary/5 p-3 lg:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider font-mono text-primary">Gemini Boss plan</span>
            <span className="text-[9px] font-mono text-muted-foreground">text-only · no web grounding</span>
          </div>
          {file?.bossPlan?.status === "completed" ? (
            <>
              <div className="text-[10px] text-foreground mt-2">
                {file.bossPlan.model} assigned <span className="text-primary">{file.bossPlan.actionId}</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">{file.bossPlan.reason}</div>
              {file.bossPlan.investigatorPrompt && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[9px] font-mono uppercase tracking-wider text-primary">Show investigator prompt</summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border/50 bg-background/40 p-2 text-[9px] leading-relaxed text-muted-foreground">{file.bossPlan.investigatorPrompt}</pre>
                </details>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {file.bossPlan.tools.map((tool) => (
                  <span key={tool} className="rounded border border-primary/25 px-1.5 py-0.5 text-[9px] font-mono text-primary">{tool}</span>
                ))}
              </div>
              <div className="mt-2 text-[9px] text-muted-foreground">
                Restrictions: {file.bossPlan.restrictions.join(" · ")}
              </div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground mt-2">
              Gemini Boss has not produced a plan yet. The local Boss planner remains the safe fallback.
            </div>
          )}
        </div>

        <div className="rounded border border-border/60 bg-background/30 p-3">
          <div className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Bureau roster</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-2">
            {roster.map((specialist) => (
              <div key={specialist.id} className="rounded border border-border/50 bg-card/30 px-2 py-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", specialist.status === "ready" ? "bg-emerald-400" : "bg-amber-400")} />
                  <span className="text-[10px] font-mono text-foreground">{specialist.title}</span>
                </div>
                <div className="text-[9px] text-muted-foreground mt-1 leading-snug">{specialist.mission}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded border border-border/60 bg-background/25 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider font-mono text-amber-300">Human operator directive</span>
          <span className="text-[9px] font-mono text-muted-foreground">stored in case context</span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <input
            value={directive}
            onChange={(event) => setDirective(event.target.value)}
            placeholder="e.g. prioritise the target's hotel, gym, yacht club, and named associates"
            className="flex-1 rounded border border-border bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:border-primary/60"
          />
          <button
            disabled={busy || !directive.trim()}
            onClick={async () => {
              const sent = await request(`/api/research/cases/${entityId}/directive`, { directive: directive.trim() });
              if (sent) setDirective("");
            }}
            className="inline-flex items-center justify-center gap-1 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-amber-300 hover:bg-amber-400/20 disabled:opacity-50"
          >
            <CheckCircle2 className="w-3 h-3" /> Add directive
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3 text-[10px] font-mono text-muted-foreground">
        <span className="rounded border border-border/60 px-2 py-1">people: {file?.evidenceSummary.discoveredPeople.length ?? 0}</span>
        <span className="rounded border border-border/60 px-2 py-1">organizations: {file?.evidenceSummary.relatedOrganizations.length ?? 0}</span>
        <span className="rounded border border-border/60 px-2 py-1">contact routes: {routes.length}</span>
        <span className="rounded border border-border/60 px-2 py-1">evidence signals: {file?.evidenceSummary.evidenceCount ?? 0}</span>
      </div>
      {routes.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider font-mono text-primary mb-2">Contact hierarchy from the case file</div>
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {routes.slice(0, 12).map((route) => (
              <div key={`${route.rank}-${route.value}`} className="rounded border border-border/50 bg-background/30 px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-mono text-amber-300">#{route.rank}</span>
                  <span className="text-[10px] uppercase tracking-wider text-primary">{route.tierLabel}</span>
                  <span className="text-xs text-foreground break-all">{route.value}</span>
                  <span className="text-[10px] font-mono text-muted-foreground ml-auto">{route.score}/100 · human review</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {route.personName ?? "No named person"}{route.role ? ` · ${route.role}` : ""} · {route.rationale}
                </div>
                {route.sourceUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {route.sourceUrls.slice(0, 2).map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="text-[9px] text-primary hover:underline">{sourceDomain(url)}</a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <div className="mt-2 text-[10px] text-rose-300">{error}</div>}
    </div>
  );
}

function DiscoveryBureauPanel({
  discoveryCase,
  entities,
  onCaseChange,
  onPromote,
}: {
  discoveryCase: BureauCase | null;
  entities: Array<{ id: number; name: string; type?: string }> | undefined;
  onCaseChange: (next: BureauCase | null) => void;
  onPromote: (entityId: number) => void;
}) {
  const [objective, setObjective] = useState("");
  const [motivation, setMotivation] = useState("");
  const [geography, setGeography] = useState("Western countries, prioritizing realistic regional and professional access over fame.");
  const [researchResponse, setResearchResponse] = useState("");
  const [bossCommentary, setBossCommentary] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [promotionEntityId, setPromotionEntityId] = useState("");
  const [admissionCandidate, setAdmissionCandidate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = parseDiscoveryCaseFile(discoveryCase?.caseFile);
  const investigatorReports = file?.investigatorReports ?? [];

  const request = async (url: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Discovery bureau request failed");
      onCaseChange(payload as BureauCase);
      return true;
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Discovery bureau request failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const continueInvestigation = async (retryBossReview: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (retryBossReview) {
        await runBureauCaseBossReview(discoveryCase!.id);
      } else {
        await runBureauCaseNextPass(discoveryCase!.id);
      }
      const refreshed = await getBureauCase(discoveryCase!.id, { cache: "no-store" });
      onCaseChange({
        ...refreshed,
        targetEntityName: refreshed.targetEntityName ?? null,
        targetEntityType: refreshed.targetEntityType ?? null,
        directorModel: refreshed.directorModel ?? "",
        currentAction: refreshed.currentAction ?? null,
        lastDecisionAt: refreshed.lastDecisionAt ?? null,
      });
      return true;
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Discovery bureau request failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!discoveryCase) {
    return (
      <div className="border-b border-primary/20 bg-[#080C14] p-4 md:p-5 flex-shrink-0">
        <div className="flex items-start gap-3">
          <div className="rounded border border-primary/30 bg-primary/10 p-2">
            <Cpu className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-[10px] font-mono text-primary uppercase tracking-[0.18em]">Discovery-first Investigation Bureau</div>
            <h2 className="text-base md:text-lg font-semibold text-foreground mt-1">Start with the mission, not a preselected target</h2>
            <p className="text-[11px] text-muted-foreground mt-1 max-w-3xl leading-relaxed">
              The Boss will turn your broad objective into the opening public-web research brief. When Gemini keys are available, the server inspects that key's model catalog and selects the lowest-cost suitable model; until then the choice remains automatic and pending.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Human mission
            <textarea
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="Find realistic potential investors for my startup in the Western world..."
              className="mt-1 w-full min-h-24 rounded border border-border bg-background px-3 py-2 text-xs normal-case tracking-normal text-foreground outline-none focus:border-primary/60"
            />
          </label>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
            Why this matters
            <textarea
              value={motivation}
              onChange={(event) => setMotivation(event.target.value)}
              placeholder="I invested my time and money and need practical routes to real investor conversations..."
              className="mt-1 w-full min-h-24 rounded border border-border bg-background px-3 py-2 text-xs normal-case tracking-normal text-foreground outline-none focus:border-primary/60"
            />
          </label>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <input
            value={geography}
            onChange={(event) => setGeography(event.target.value)}
            className="flex-1 rounded border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary/60"
            placeholder="Geography and access preference"
          />
          <button
            disabled={busy || !objective.trim() || !motivation.trim()}
            onClick={() => void request("/api/research/bureau/cases", { objective, motivation, geography })}
            className="inline-flex items-center justify-center gap-2 rounded border border-primary/50 bg-primary/15 px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-primary hover:bg-primary/25 disabled:opacity-50"
          >
            <Play className="w-3 h-3" /> {busy ? "Writing brief…" : "Open Boss case"}
          </button>
        </div>
        {error && <div className="mt-2 text-[10px] text-rose-300">{error}</div>}
      </div>
    );
  }

  return (
    <div className="border-b border-primary/20 bg-[#080C14] p-4 md:p-5 flex-shrink-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-mono text-primary uppercase tracking-[0.18em]">Boss discovery case #{discoveryCase.id}</div>
          <h2 className="text-base font-semibold text-foreground mt-1">
            {file?.nextInvestigation?.boss?.status === "completed"
              ? "Case review complete — human gates remain"
              : "Gemini Boss opening brief"}
          </h2>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-3xl">{file?.bossPremise}</p>
        </div>
        <div className="text-right text-[10px] font-mono text-muted-foreground">
          <div className="text-amber-300">{discoveryCase.directorModel === "auto-low-cost-pending" ? "AUTO · LOWEST AVAILABLE" : discoveryCase.directorModel}</div>
          <div>
            {file?.nextInvestigation?.boss?.status === "completed"
              ? "gemini boss reviewed"
              : discoveryCase.directorMode.replaceAll("_", " ")}
            {" · "}
            {file?.initialResearch.status ?? "not started"}
          </div>
        </div>
      </div>
      <details className="mt-3 rounded border border-border/60 bg-background/25">
        <summary className="cursor-pointer px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-primary">View Boss opening prompt</summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-border/50 px-3 py-3 text-[10px] leading-relaxed text-muted-foreground">{discoveryCase.openingPrompt}</pre>
      </details>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
        <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Broad web research response
          <textarea
            value={researchResponse}
            onChange={(event) => setResearchResponse(event.target.value)}
            placeholder="Paste or receive the first Gemini / Google-style discovery response here..."
            className="mt-1 w-full min-h-28 rounded border border-border bg-background px-3 py-2 text-xs normal-case tracking-normal text-foreground outline-none focus:border-primary/60"
          />
        </label>
        <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
          Boss review and next direction
          <textarea
            value={bossCommentary}
            onChange={(event) => setBossCommentary(event.target.value)}
            placeholder="What did the Boss accept, reject, or prioritize from the initial response?"
            className="mt-1 w-full min-h-28 rounded border border-border bg-background px-3 py-2 text-xs normal-case tracking-normal text-foreground outline-none focus:border-primary/60"
          />
        </label>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        <input
          value={sourceUrls}
          onChange={(event) => setSourceUrls(event.target.value)}
          placeholder="Source URLs, separated by commas"
          className="flex-1 rounded border border-border bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-primary/60"
        />
        <button
          disabled={busy || !researchResponse.trim()}
          onClick={async () => {
            const saved = await request(`/api/research/bureau/cases/${discoveryCase.id}/initial-research`, {
              researchResponse,
              bossCommentary,
              sourceUrls: sourceUrls.split(",").map((url) => url.trim()).filter(Boolean),
            });
            if (saved) {
              setResearchResponse("");
              setBossCommentary("");
              setSourceUrls("");
            }
          }}
          className="inline-flex items-center justify-center gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-amber-300 hover:bg-amber-400/20 disabled:opacity-50"
        >
          <CheckCircle2 className="w-3 h-3" /> {busy ? "Recording…" : "Write into case context"}
        </button>
      </div>
      {file && investigatorReports.length > 0 && (
        <div className="mt-3 rounded border border-cyan-400/20 bg-cyan-400/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-mono text-cyan-300">Shared case-context shaft</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Each lane reads the latest snapshot, writes a report, and hands the refreshed context to the next reviewer.
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[9px] font-mono">
              <span className="rounded border border-cyan-400/25 px-1.5 py-0.5 text-cyan-300">{file.currentProgress?.reportCount ?? investigatorReports.length} reports</span>
              <span className="rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground">{file.currentProgress?.completedLanes?.length ?? 0} lanes complete</span>
              <span className="rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground">reviewed by {file.currentProgress?.lastReviewedBy ?? "pending"}</span>
            </div>
          </div>
          <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto pr-1">
            {investigatorReports.slice().reverse().map((report) => (
              <details key={report.id} className="rounded border border-border/50 bg-background/40 px-2.5 py-2">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      report.status === "completed" ? "bg-emerald-400" : report.status === "failed" ? "bg-rose-400" : "bg-amber-400",
                    )} />
                    <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-200">{report.lane}</span>
                    <span className="text-[9px] text-muted-foreground">{report.provider}</span>
                    <span className="ml-auto text-[9px] font-mono text-muted-foreground">iteration {report.iteration}</span>
                  </div>
                  <div className="mt-1 text-[10px] leading-relaxed text-foreground/85">{report.summary}</div>
                </summary>
                <div className="mt-2 border-t border-border/40 pt-2 space-y-2">
                  {report.findings.length > 0 && (
                    <div>
                      <div className="text-[9px] uppercase tracking-wider font-mono text-muted-foreground">Findings</div>
                      <ul className="mt-1 space-y-1 text-[10px] text-muted-foreground">
                        {report.findings.slice(0, 8).map((finding, index) => <li key={`${report.id}-finding-${index}`}>• {finding}</li>)}
                      </ul>
                    </div>
                  )}
                  {report.candidateNames.length > 0 && <div className="text-[10px] text-amber-200">Candidates: {report.candidateNames.join(" · ")}</div>}
                  {report.nextQuestions.length > 0 && <div className="text-[10px] text-cyan-200/80">Next questions: {report.nextQuestions.join(" · ")}</div>}
                  {report.sourceUrls.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {report.sourceUrls.slice(0, 6).map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" className="text-[9px] text-primary hover:underline">{sourceDomain(url)}</a>)}
                    </div>
                  )}
                  {report.error && <div className="text-[10px] text-rose-300">Provider gap: {report.error}</div>}
                </div>
              </details>
            ))}
          </div>
          {file.currentProgress?.openQuestions && file.currentProgress.openQuestions.length > 0 && (
            <div className="mt-3 border-t border-border/40 pt-2">
              <div className="text-[9px] uppercase tracking-wider font-mono text-muted-foreground">Open questions carried forward</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {file.currentProgress.openQuestions.slice(-8).map((question) => (
                  <span key={question} className="rounded border border-cyan-400/20 px-1.5 py-1 text-[9px] text-cyan-200/80">{question}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {file?.discoveredCandidates?.length ? (
        <div className="mt-3 rounded border border-amber-400/20 bg-amber-400/5 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider font-mono text-amber-300">Candidate and contact review ledger</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Contact routes are shown only when an investigator returned an exact value with source evidence. Empty means no structured contact evidence was captured—not that the person is unreachable.
              </div>
            </div>
            <span className="text-[9px] font-mono text-muted-foreground">{file.discoveredCandidates.length} review candidates</span>
          </div>
          <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-2 max-h-[34rem] overflow-y-auto pr-1">
            {file.discoveredCandidates.map((candidate) => {
              const contacts = candidate.contactEvidence ?? [];
              return (
                <div key={candidate.name} className="rounded border border-border/60 bg-background/40 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">{candidate.name}</span>
                        <span className="rounded border border-border/60 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">{candidate.type}</span>
                        {candidate.admittedEntityId ? (
                          <span className="rounded border border-emerald-400/30 px-1.5 py-0.5 text-[9px] font-mono text-emerald-300">admitted · entity {candidate.admittedEntityId}</span>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{candidate.relevance}</div>
                    </div>
                    {!candidate.admittedEntityId ? (
                      <button
                        disabled={busy || admissionCandidate === candidate.name}
                        onClick={async () => {
                          setAdmissionCandidate(candidate.name);
                          const admitted = await request(`/api/research/bureau/cases/${discoveryCase.id}/admit-candidate`, {
                            candidateName: candidate.name,
                          });
                          if (admitted) setAdmissionCandidate(null);
                          else setAdmissionCandidate(null);
                        }}
                        className="shrink-0 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[9px] font-mono uppercase tracking-wider text-amber-300 hover:bg-amber-400/20 disabled:opacity-50"
                      >
                        {admissionCandidate === candidate.name ? "Admitting…" : "Admit for review"}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    <span className="text-foreground/80">Reachability:</span> {candidate.reachability}
                  </div>
                  <div className="mt-2 rounded border border-border/50 bg-background/50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[9px] uppercase tracking-wider font-mono text-cyan-300">Contact evidence</span>
                      <span className={cn("text-[9px] font-mono", contacts.length ? "text-emerald-300" : "text-muted-foreground")}>
                        {contacts.length ? `${contacts.length} route${contacts.length === 1 ? "" : "s"}` : "none structured"}
                      </span>
                    </div>
                    {contacts.length ? (
                      <div className="mt-1.5 space-y-1.5">
                        {contacts.map((contact, index) => (
                          <div key={`${candidate.name}-${contact.vectorType}-${contact.value}-${index}`} className="text-[10px]">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-primary uppercase font-mono">{contact.vectorType}</span>
                              <span className="break-all text-foreground">{contact.value}</span>
                              <span className="text-muted-foreground">· {contact.scope}</span>
                              {contact.personName ? <span className="text-amber-200">· {contact.personName}</span> : null}
                            </div>
                            {contact.role || contact.note ? <div className="text-muted-foreground mt-0.5">{[contact.role, contact.note].filter(Boolean).join(" · ")}</div> : null}
                            {contact.sourceUrls.length ? (
                              <div className="flex flex-wrap gap-2 mt-1">
                                {contact.sourceUrls.slice(0, 3).map((url) => (
                                  <a key={url} href={url} target="_blank" rel="noreferrer" className="text-[9px] text-primary hover:underline">{sourceDomain(url)}</a>
                                ))}
                              </div>
                            ) : <div className="text-[9px] text-rose-300">No source URL captured for this route</div>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] text-muted-foreground">No structured email, phone, social, website, or organization contact was persisted for this candidate in the completed passes.</div>
                    )}
                  </div>
                  {candidate.sourceUrls.length ? (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {candidate.sourceUrls.slice(0, 4).map((url) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[9px] text-primary hover:underline">
                          <ExternalLink className="w-2.5 h-2.5" /> {sourceDomain(url)}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {file?.nextInvestigation && (
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded border border-amber-400/20 bg-amber-400/5 p-3">
            <div className="text-[10px] uppercase tracking-wider font-mono text-amber-300">Right-hand review</div>
            <div className="text-[10px] text-foreground mt-2">{file.nextInvestigation.rightHand?.decision ?? "No advisory decision returned."}</div>
            {file.nextInvestigation.rightHand?.focusLanes?.length ? <div className="text-[9px] text-muted-foreground mt-1">Focus: {file.nextInvestigation.rightHand.focusLanes.join(" · ")}</div> : null}
            {file.nextInvestigation.rightHand?.reason && <div className="text-[9px] text-muted-foreground mt-1">{file.nextInvestigation.rightHand.reason}</div>}
          </div>
          <div className="rounded border border-primary/20 bg-primary/5 p-3">
            <div className="text-[10px] uppercase tracking-wider font-mono text-primary">Boss next rabbit hole</div>
            <div className="text-[10px] text-foreground mt-2">{file.nextInvestigation.boss?.decision ?? "No final Boss review returned."}</div>
            {file.nextInvestigation.boss?.nextDirections?.length ? <div className="text-[9px] text-primary/80 mt-1">Next: {file.nextInvestigation.boss.nextDirections.join(" · ")}</div> : null}
            {file.nextInvestigation.boss?.uncertainties?.length ? <div className="text-[9px] text-muted-foreground mt-1">Uncertainties: {file.nextInvestigation.boss.uncertainties.join(" · ")}</div> : null}
          </div>
        </div>
      )}
      {file?.nextInvestigation?.boss?.nextDirections?.length ? (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3 rounded border border-primary/25 bg-primary/5 p-3">
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider font-mono text-primary">Continue the Bureau investigation</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {file.nextInvestigation.boss?.status === "unavailable"
                ? "The evidence lanes are complete, but the Boss closure review hit a provider gap. Retry only the Boss review without repeating searches."
                : "The opening discovery pass is complete. Run the Boss-selected verification directions against the shared case context; results remain review-only."}
            </div>
          </div>
          <button
            disabled={busy || discoveryCase.status === "active"}
            onClick={() => void continueInvestigation(file.nextInvestigation?.boss?.status === "unavailable")}
            className="inline-flex items-center justify-center gap-2 rounded border border-primary/50 bg-primary/15 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-primary hover:bg-primary/25 disabled:opacity-50"
          >
            <Play className="w-3 h-3" /> {busy || discoveryCase.status === "active"
              ? "Review running…"
              : file.nextInvestigation.boss?.status === "unavailable"
                ? "Retry Boss closure review"
                : "Run next verification pass"}
          </button>
        </div>
      ) : null}
      <div className="mt-3 rounded border border-emerald-400/20 bg-emerald-400/5 p-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2">
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider font-mono text-emerald-300">Reviewed candidate handoff</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Only promote an existing entity after the broad response has passed identity, attribution, provenance, and practical-reachability review.
            </div>
          </div>
          <select
            value={promotionEntityId}
            onChange={(event) => setPromotionEntityId(event.target.value)}
            className="min-w-0 lg:w-72 rounded border border-border bg-background px-2.5 py-2 text-xs text-foreground outline-none focus:border-emerald-400/60"
          >
            <option value="">Select reviewed entity…</option>
            {(entities ?? []).map((entity) => (
              <option key={entity.id} value={entity.id}>{entity.name} · {entity.type ?? "Unknown"}</option>
            ))}
          </select>
          <button
            disabled={busy || !promotionEntityId}
            onClick={async () => {
              const promoted = await request(`/api/research/bureau/cases/${discoveryCase.id}/promote-target`, {
                entityId: Number(promotionEntityId),
              });
              if (promoted) {
                onPromote(Number(promotionEntityId));
                setPromotionEntityId("");
              }
            }}
            className="inline-flex items-center justify-center gap-2 rounded border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-50"
          >
            <ChevronRight className="w-3 h-3" /> Promote to target case
          </button>
        </div>
      </div>
      {error && <div className="mt-2 text-[10px] text-rose-300">{error}</div>}
    </div>
  );
}

function EvidenceLedger({ sessionId }: { sessionId: number | null }) {
  const { data, isLoading } = useListResearchEvidence(sessionId ?? 0, {
    query: { enabled: sessionId != null, queryKey: getListResearchEvidenceQueryKey(sessionId ?? 0) },
  });
  const evidence = (data ?? []) as ResearchEvidence[];
  if (!sessionId) return null;
  return (
    <div className="border-t border-border/50 bg-card/30 p-4 md:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-mono text-primary uppercase tracking-widest flex items-center gap-2">
            <FileCheck2 className="w-4 h-4" /> Claim Evidence Ledger
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">Every research assertion is shown with its current support level and source basis.</p>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">{isLoading ? "loading…" : `${evidence.length} claims`}</span>
      </div>
      {evidence.length === 0 && !isLoading ? (
        <div className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground font-mono">No claim-level evidence was recorded for this run.</div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
          {evidence.map((item) => {
            const supported = item.status === "supported";
            const disputed = item.status === "disputed";
            const rejected = item.status === "rejected";
            const statusColor = supported
              ? "text-emerald-400"
              : disputed
                ? "text-rose-400"
                : rejected
                  ? "text-slate-400"
                  : "text-amber-400";
            return (
              <div key={item.id} className="rounded border border-border/70 bg-background/50 p-3">
                <div className="flex items-start gap-2">
                  {supported ? <FileCheck2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> : <CircleAlert className={cn("w-3.5 h-3.5 mt-0.5 shrink-0", disputed ? "text-rose-400" : rejected ? "text-slate-400" : "text-amber-400")} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">{item.claimType}</span>
                      <span className={cn("text-[10px] uppercase tracking-wider font-mono", statusColor)}>{item.status}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{Math.round(item.confidence * 100)}% confidence</span>
                    </div>
                    <p className="text-xs text-foreground/90 mt-1 leading-relaxed">{item.claim}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[10px] font-mono text-muted-foreground">
                      <span>{item.sourceName ?? "Unattributed source"}</span>
                      <span>·</span>
                      <span>{new Date(item.observedAt).toLocaleDateString()}</span>
                      <span>·</span>
                      <span className={item.freshnessScore >= 0.7 ? "text-emerald-400" : item.freshnessScore >= 0.35 ? "text-amber-400" : "text-rose-400"}>
                        {item.freshnessScore >= 0.7 ? "current" : item.freshnessScore >= 0.35 ? "aging" : "stale"} evidence
                      </span>
                      {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline"><ExternalLink className="w-3 h-3" /> source</a>}
                    </div>
                    {item.rejectionReason && <p className={cn("text-[10px] mt-1", disputed ? "text-rose-400/80" : "text-muted-foreground")}>{disputed ? "Dispute: " : rejected ? "Rejected: " : "Review note: "}{item.rejectionReason}</p>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Scorecard({ score }: { score: ResearchScorecard | null }) {
  if (!score) return null;
  const items: Array<[string, number, string]> = [
    ["Identity", score.identity, "same-person confidence"],
    ["Ownership", score.ownership, "asset/relationship basis"],
    ["Contact", score.contact, "validated public vectors"],
    ["Access", score.access, "practical reachability"],
    ["Wealth", score.wealth, "wealth signal only"],
    ["Freshness", score.freshness, "recency of evidence"],
    ["Sources", score.sourceQuality, "source diversity/quality"],
  ];
  return (
    <div className="border-t border-border/50 bg-background/30 px-4 md:px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-xs font-mono text-primary uppercase tracking-widest">Independent Research Scorecard</h3>
          <p className="text-[11px] text-muted-foreground mt-1">Scores answer different questions; wealth is never used as an access proxy.</p>
        </div>
        <span className="text-xs font-mono text-foreground">{Math.round(score.overall * 100)}/100 overall</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {items.map(([label, value, hint]) => (
          <div key={label} className="rounded border border-border/70 bg-card/50 p-2" title={hint}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">{label}</div>
            <div className={cn("text-lg font-mono mt-1", value >= 0.7 ? "text-emerald-400" : value >= 0.4 ? "text-amber-400" : "text-muted-foreground")}>{Math.round(value * 100)}</div>
            <div className="h-1 rounded bg-muted mt-1 overflow-hidden"><div className="h-full bg-current rounded" style={{ width: `${Math.round(value * 100)}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CandidateFunnelPanel({ funnel }: { funnel: CandidateFunnel | null }) {
  if (!funnel) return null;
  const states: Array<[string, number, string]> = [
    ["Discovered", funnel.discovered, "text-muted-foreground"],
    ["Source-linked", funnel.sourceLinked, "text-sky-300"],
    ["Attribution review", funnel.attributionReview, "text-amber-300"],
    ["Corroborated", funnel.independentlyCorroborated, "text-cyan-300"],
    ["Verified direct", funnel.verifiedDirectRoute, "text-emerald-300"],
    ["Rejected", funnel.rejected, "text-rose-300"],
  ];
  const stateLabel = (state: string) => state.replaceAll("_", " ");
  return (
    <div className="border-t border-border/50 bg-[#080C14] px-4 md:px-5 py-4 flex-shrink-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-mono text-primary uppercase tracking-widest flex items-center gap-2">
            <CircleAlert className="w-3.5 h-3.5" /> Contact Candidate Funnel
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            Provider repetition is not corroboration. Personal routes require target attribution and independent source domains.
          </p>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">
          {funnel.totalCandidates} candidates · {funnel.independentSourceDomains} domains
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-3">
        {states.map(([label, value, color]) => (
          <div key={label} className="rounded border border-border/60 bg-card/40 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono">{label}</div>
            <div className={cn("text-lg font-mono mt-0.5", color)}>{value}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] font-mono text-muted-foreground mb-2">
        <span className="rounded border border-border/60 px-2 py-1">Organization-only: {funnel.organizationOnly}</span>
        <span className={cn("rounded border px-2 py-1", funnel.conflicted ? "border-rose-400/30 text-rose-300" : "border-border/60")}>
          Conflicts: {funnel.conflicted}
        </span>
      </div>
      {funnel.candidates.length > 0 && (
        <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
          {funnel.candidates.map((candidate) => (
            <div key={candidate.key} className="rounded border border-border/50 bg-background/40 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] text-primary uppercase">{candidate.vectorType}</span>
                <span className="text-xs text-foreground break-all">{candidate.value}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">{stateLabel(candidate.state)}</span>
                {candidate.conflictCount > 0 && <span className="text-[10px] text-rose-300">conflict</span>}
                {candidate.exactClaimObserved && <span className="text-[10px] text-emerald-300">exact claim</span>}
              </div>
              <div className="text-[10px] font-mono text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                <span>{candidate.scopes.join(", ") || "unscoped"}</span>
                <span>·</span>
                <span>{candidate.sourceDomains.length} source domain{candidate.sourceDomains.length === 1 ? "" : "s"}</span>
                <span>·</span>
                <span>{candidate.providers.join(", ")}</span>
              </div>
              {candidate.rejectionReason && (
                <div className="text-[10px] text-rose-300/90 mt-1">
                  Rejected: {candidate.rejectionReason}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RouteHierarchyPanel({ routes }: { routes: RankedResearchRoute[] | null }) {
  if (!routes || routes.length === 0) return null;
  return (
    <div className="border-t border-border/50 bg-[#0A0E17] px-4 md:px-5 py-4 flex-shrink-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-mono text-amber-300 uppercase tracking-widest flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5" /> Investigator Route Hierarchy
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            Direct named-person routes lead the list. Operator, executive, intermediary, and organization routes remain available as manual paths.
          </p>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap">{routes.length} ranked routes</span>
      </div>
      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {routes.slice(0, 12).map((route) => (
          <div key={`${route.rank}-${route.vectorType}-${route.value}`} className="rounded border border-border/50 bg-background/40 px-2.5 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-mono text-amber-300 w-5">#{route.rank}</span>
              <span className="text-[10px] uppercase tracking-wider text-primary">{route.tierLabel}</span>
              <span className="text-[10px] font-mono text-muted-foreground">{route.state.replaceAll("_", " ")}</span>
              <span className="text-[10px] font-mono text-muted-foreground ml-auto">score {route.score}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              {route.vectorType === "email" ? <Mail className="w-3 h-3 text-primary" /> : route.vectorType === "phone" ? <Phone className="w-3 h-3 text-primary" /> : <ExternalLink className="w-3 h-3 text-primary" />}
              <span className="text-xs text-foreground break-all">{route.value}</span>
              {route.personName && <span className="text-xs text-amber-200">· {route.personName}</span>}
              {route.role && <span className="text-[10px] text-muted-foreground">· {route.role.replaceAll("_", " ")}</span>}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {route.relationship?.replaceAll("-", " ") ?? route.scope} · {route.note}
            </div>
            {route.sourceUrls.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1.5">
                {route.sourceUrls.slice(0, 3).map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline">
                    <ExternalLink className="w-2.5 h-2.5" /> {new URL(url).hostname.replace(/^www\./, "")}
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function IntroPathPanel({ candidate }: { candidate: IntroPathCandidate | null }) {
  return (
    <div className="border-t border-border/50 bg-[#0B0F19] px-4 md:px-5 py-4 flex-shrink-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-mono text-amber-300 uppercase tracking-widest flex items-center gap-2">
            <Shield className="w-3.5 h-3.5" /> Intro Path Candidate
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1">
            One bounded, review-only route from durable evidence. This is not verified contact or authorization.
          </p>
        </div>
        <span className="text-[10px] font-mono text-amber-300/80 whitespace-nowrap">manual review</span>
      </div>
      {!candidate ? (
        <div className="rounded border border-dashed border-border p-3 text-xs text-muted-foreground font-mono">
          No evidence-backed introduction route was found.
        </div>
      ) : (
        <div className="rounded border border-amber-400/30 bg-amber-400/5 p-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider font-mono text-amber-300">{candidate.routeKind.replaceAll("_", " ")}</span>
            <span className="text-xs font-semibold text-foreground">{candidate.route.label}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            {candidate.route.vectorType === "email" ? <Mail className="w-3 h-3 text-amber-300" /> : <Phone className="w-3 h-3 text-amber-300" />}
            <span className="break-all text-foreground">{candidate.route.value}</span>
            {candidate.route.personName && <span className="text-muted-foreground">· {candidate.route.personName}</span>}
            {candidate.route.role && <span className="text-muted-foreground">· {candidate.route.role}</span>}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{candidate.whyItMayHelp}</p>
          <div className="text-[11px] leading-relaxed text-amber-200/80">
            <strong>Next manual action:</strong> {candidate.nextManualAction}
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] font-mono text-muted-foreground">
            <span>{candidate.corroboration.independentDomains} source domain{candidate.corroboration.independentDomains === 1 ? "" : "s"}</span>
            {candidate.evidence.map((item) => (
              <a key={item.sourceUrl} href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                <ExternalLink className="w-3 h-3" /> {item.source}
              </a>
            ))}
          </div>
          <ul className="space-y-1 text-[10px] text-rose-300/80">
            {candidate.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Path node contact bar ──────────────────────────────────────────────────────
function PathNodeContact({ node }: { node: PathStep }) {
  if (!node.contactConfidence && !node.contactEmail && !node.contactPhone) return null;
  return (
    <div className="mt-2 pt-2 border-t border-current/20 flex flex-col gap-1">
      {node.contactConfidence != null && node.contactConfidence > 0 && (
        <div className="flex items-center gap-2">
          <div className="h-1 flex-1 rounded-full bg-current/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-current/60"
              style={{ width: `${node.contactConfidence}%` }}
            />
          </div>
          <span className="text-[10px] font-mono opacity-70">{node.contactConfidence}%</span>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        {node.contactEmail && (
          <a
            href={`mailto:${node.contactEmail}`}
            className="flex items-center gap-1 text-xs font-mono opacity-80 hover:opacity-100 transition-opacity"
            title={node.contactEmail}
            onClick={(e) => e.stopPropagation()}
          >
            <Mail className="w-2.5 h-2.5 flex-shrink-0" />
            <span className="truncate max-w-[140px]">{node.contactEmail}</span>
          </a>
        )}
        {node.contactPhone && (
          <a
            href={`tel:${node.contactPhone}`}
            className="flex items-center gap-1 text-xs font-mono opacity-80 hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <Phone className="w-2.5 h-2.5 flex-shrink-0" />
            <span>{node.contactPhone}</span>
          </a>
        )}
      </div>
    </div>
  );
}

export default function IntelTerminal() {
  // wouter's useLocation only returns pathname; read query string from window
  useLocation(); // subscribe to route changes
  const urlEntityId = (() => {
    const params = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : ""
    );
    const v = params.get("entity");
    return v ? parseInt(v, 10) : null;
  })();

  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(urlEntityId);
  const [entitySearch, setEntitySearch] = useState("");
  const { data: allEntities } = useListEntities({ limit: 500 });
  const entities = allEntities?.filter((e) =>
    !entitySearch || e.name.toLowerCase().includes(entitySearch.toLowerCase())
  );
  const runResearch = useRunResearch();

  const [terminalLog, setTerminalLog] = useState<MctsStep[]>([]);
  const [isComputing, setIsComputing] = useState(false);
  const [winningPath, setWinningPath] = useState<PathStep[]>([]);
  const [pathScore, setPathScore] = useState<number>(0);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [algorithmPipeline, setAlgorithmPipeline] = useState<Array<{ algo: string; contribution: string; status: string }> | null>(null);
  const [scorecard, setScorecard] = useState<ResearchScorecard | null>(null);
  const [candidateFunnel, setCandidateFunnel] = useState<CandidateFunnel | null>(null);
  const [routeHierarchy, setRouteHierarchy] = useState<RankedResearchRoute[] | null>(null);
  const [introPathCandidate, setIntroPathCandidate] = useState<IntroPathCandidate | null>(null);
  const [bureauCase, setBureauCase] = useState<BureauCase | null>(null);
  const [discoveryCase, setDiscoveryCase] = useState<BureauCase | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Mobile entity picker state
  const [mobilePickerOpen, setMobilePickerOpen] = useState(false);
  const selectedEntity = entities?.find((e) => e.id === selectedEntityId);

  useEffect(() => {
    if (!selectedEntityId) {
      setIntroPathCandidate(null);
      setCandidateFunnel(null);
      setRouteHierarchy(null);
      setBureauCase(null);
      return;
    }
    let active = true;
    fetch(`/api/entities/${selectedEntityId}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((entity) => {
        if (!active) return;
        try {
          const metadata = JSON.parse(entity?.metadata ?? "{}") as Record<string, unknown>;
          setCandidateFunnel((metadata.deepWebCandidateFunnel as CandidateFunnel | null) ?? null);
          setRouteHierarchy(Array.isArray(metadata.routeHierarchy)
            ? metadata.routeHierarchy as RankedResearchRoute[]
            : null);
        } catch {
          setCandidateFunnel(null);
          setRouteHierarchy(null);
        }
      })
      .catch(() => {
        if (active) {
          setCandidateFunnel(null);
          setRouteHierarchy(null);
        }
      });
    fetch(`/api/research/intro-path/${selectedEntityId}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (active) setIntroPathCandidate(payload?.candidate ?? null);
      })
      .catch(() => {
        if (active) setIntroPathCandidate(null);
      });
    return () => {
      active = false;
    };
  }, [selectedEntityId]);

  useEffect(() => {
    let active = true;
    fetch("/api/research/bureau/cases/latest", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error("Unable to load the discovery bureau");
        return response.json() as Promise<BureauCase>;
      })
      .then((next) => {
        if (active && next) setDiscoveryCase(next);
      })
      .catch(() => {
        // An empty discovery desk is a valid first-run state.
      });
    return () => {
      active = false;
    };
  }, []);

  const startAnalysis = () => {
    if (!selectedEntityId) return;

    setTerminalLog([]);
    setWinningPath([]);
    setPathScore(0);
    setAlgorithmPipeline(null);
    setScorecard(null);
    setCandidateFunnel(null);
    setRouteHierarchy(null);
    setIntroPathCandidate(null);
    setIsComputing(true);
    setMobilePickerOpen(false);

    runResearch.mutate(
      { data: { entityId: selectedEntityId, depth: 4 } },
      {
        onSuccess: (data) => {
          setSessionId(data.id);

          let steps: MctsStep[] = [];
          let path: PathStep[] = [];

          try { steps = data.mctsSteps ? JSON.parse(data.mctsSteps) : []; } catch { steps = []; }
          try { path = data.winningPath ? JSON.parse(data.winningPath) : []; } catch { path = []; }

          setPathScore(data.pathScore ?? 0);
          try { setScorecard(data.scoreBreakdown ? JSON.parse(data.scoreBreakdown) : null); } catch { setScorecard(null); }
          setCandidateFunnel((data as any).candidateFunnel ?? null);
          setRouteHierarchy((data as any).routeHierarchy ?? null);
          if ((data as any).algorithmPipeline) setAlgorithmPipeline((data as any).algorithmPipeline);

          let i = 0;
          const interval = setInterval(() => {
            if (i < steps.length) {
              setTerminalLog((prev) => [...prev, steps[i]!]);
              i++;
            } else {
              clearInterval(interval);
              setIsComputing(false);
              setWinningPath(path);
            }
          }, 260);
        },
        onError: () => {
          setIsComputing(false);
          setTerminalLog([{
            step: 0,
            action: "CRITICAL FAILURE",
            registry: "SYS",
            target: "ERR",
            targetType: "System",
            uctScore: 0,
            warmthScore: 0,
            reasoning: "Intel pipeline returned an error. Check API server logs.",
          }]);
        },
      }
    );
  };

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalLog]);

  return (
    <div className="flex h-full w-full bg-background overflow-hidden flex-col md:flex-row">

      {/* ── Mobile header: compact entity picker + run button ── */}
      <div className="md:hidden flex-shrink-0 border-b border-border bg-card/80 backdrop-blur p-3 space-y-2 z-20">
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="w-3.5 h-3.5 text-primary" />
          <span className="text-[10px] font-mono text-primary uppercase tracking-widest">Target Selection</span>
          {pathScore > 0 && (
            <span className={cn(
              "ml-auto text-[10px] font-mono px-2 py-0.5 rounded border",
              pathScore >= 0.7 ? "text-primary border-primary/40 bg-primary/5" : "text-amber-500 border-amber-500/30 bg-amber-500/5"
            )}>
              PATH: {(pathScore * 100).toFixed(0)}/100
            </span>
          )}
        </div>

        {/* Entity dropdown trigger */}
        <button
          onClick={() => setMobilePickerOpen((o) => !o)}
          disabled={isComputing}
          className="w-full flex items-center justify-between px-3 py-2.5 rounded border border-border bg-background text-sm font-mono text-foreground disabled:opacity-50"
        >
          <span className={selectedEntityId ? "text-foreground" : "text-muted-foreground"}>
            {selectedEntity?.name ?? "Select an entity..."}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
            {selectedEntity && <ScoreBadge score={selectedEntity.bayesianScore} />}
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", mobilePickerOpen && "rotate-180")} />
          </div>
        </button>

        {/* Mobile dropdown list */}
        {mobilePickerOpen && (
          <div className="border border-border rounded bg-card overflow-hidden max-h-48 overflow-y-auto">
            {entities?.map((ent) => (
              <button
                key={ent.id}
                onClick={() => { setSelectedEntityId(ent.id); setMobilePickerOpen(false); }}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2.5 text-sm font-mono border-b border-border last:border-0 hover:bg-muted/50 transition-colors text-left",
                  selectedEntityId === ent.id && "bg-primary/10 text-primary"
                )}
              >
                <span className="truncate pr-2">{formatEntityName(ent.name)}</span>
                <ScoreBadge score={ent.bayesianScore} />
              </button>
            ))}
          </div>
        )}

        {/* Hybrid pipeline */}
        <div className="bg-background/60 border border-border/60 rounded px-3 py-2">
          <div className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest mb-1">Pipeline Architecture</div>
          <div className="text-[11px] font-mono text-primary/80 leading-relaxed">{HYBRID_PIPELINE}</div>
        </div>

        {/* Run button */}
        <button
          disabled={!selectedEntityId || isComputing}
          onClick={startAnalysis}
          className="w-full py-2.5 bg-primary/20 hover:bg-primary/30 disabled:bg-muted disabled:text-muted-foreground text-primary border border-primary/50 disabled:border-border font-mono text-sm uppercase tracking-widest transition-all flex items-center justify-center rounded"
        >
          {isComputing ? (
            <span className="animate-pulse flex items-center">
              <Hash className="w-4 h-4 mr-2 animate-spin" /> Running Pipeline...
            </span>
          ) : (
            <span className="flex items-center">
              <Play className="w-4 h-4 mr-2" /> Run Analysis
            </span>
          )}
        </button>

        {sessionId && !isComputing && (
          <div className="text-[10px] font-mono text-sky-300 border border-sky-400/30 bg-sky-400/5 rounded px-2 py-1.5 text-center">
            <Shield className="w-3 h-3 inline mr-1.5 align-[-2px]" />
            Evidence collected — identity, attribution, and access remain in research review
          </div>
        )}
      </div>

      {/* ── Desktop Left Panel: Entity Selector ── */}
      <div className="hidden md:flex w-80 border-r border-border bg-card flex-col flex-shrink-0 z-10 shadow-xl">
        <div className="p-4 border-b border-border space-y-2">
          <h2 className="text-sm font-bold font-mono tracking-wider flex items-center uppercase text-foreground">
            <Cpu className="w-4 h-4 mr-2 text-primary" /> Target Selection
          </h2>
          <div className="bg-background/60 border border-border/60 rounded px-3 py-2">
            <div className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest mb-1">5-Algorithm Pipeline</div>
            <div className="text-[11px] font-mono text-primary/80 leading-relaxed">{HYBRID_PIPELINE}</div>
          </div>
        </div>

        {/* Search input */}
        <div className="px-3 pb-2 flex-shrink-0">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-background border border-border">
            <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" />
            <input
              type="text"
              value={entitySearch}
              onChange={(e) => setEntitySearch(e.target.value)}
              placeholder="Filter targets…"
              className="flex-1 bg-transparent text-xs font-mono text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            {entitySearch && (
              <button onClick={() => setEntitySearch("")}>
                <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {entities?.map((ent) => (
            <div
              key={ent.id}
              onClick={() => !isComputing && setSelectedEntityId(ent.id)}
              className={cn(
                "p-3 rounded border text-sm font-mono cursor-pointer transition-colors flex justify-between items-center",
                selectedEntityId === ent.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                isComputing && selectedEntityId !== ent.id && "opacity-30 cursor-not-allowed"
              )}
            >
              <div className="truncate pr-2">{formatEntityName(ent.name)}</div>
              <ScoreBadge score={ent.bayesianScore} />
            </div>
          ))}
          {entities?.length === 0 && (
            <div className="text-[10px] font-mono text-muted-foreground/50 text-center py-4">No matches</div>
          )}
        </div>

        <div className="p-3 border-t border-border bg-muted/20 space-y-2">
          <button
            disabled={!selectedEntityId || isComputing}
            onClick={startAnalysis}
            className="w-full py-2 bg-primary/20 hover:bg-primary/30 disabled:bg-muted disabled:text-muted-foreground text-primary border border-primary/50 disabled:border-border font-mono text-sm uppercase tracking-widest transition-all flex items-center justify-center"
          >
            {isComputing ? (
              <span className="animate-pulse flex items-center">
                <Hash className="w-4 h-4 mr-2 animate-spin" /> Running Pipeline...
              </span>
            ) : (
              <span className="flex items-center">
                <Play className="w-4 h-4 mr-2" /> Run Analysis
              </span>
            )}
          </button>
          {sessionId && !isComputing && (
            <div className="text-[10px] font-mono text-muted-foreground text-center">
              Session #{sessionId} saved → OSINT research review
            </div>
          )}
        </div>
      </div>

      {/* ── Right Panel: Intel Terminal ── */}
      <div className="flex-1 flex flex-col bg-[#050810] relative min-w-0 overflow-hidden">
        <div className="p-3 border-b border-border/50 bg-[#0B0F19] flex items-center justify-between text-xs font-mono text-muted-foreground flex-shrink-0">
          <div className="flex items-center space-x-2 min-w-0">
            <Terminal className="w-4 h-4 flex-shrink-0" />
            <span className="truncate hidden sm:block">
              root@apexfinder:~# /opt/intel/pipeline --target={selectedEntityId ?? "NULL"} --algos=5 --sims=120
            </span>
            <span className="sm:hidden text-[10px]">INTEL --target={selectedEntityId ?? "NULL"}</span>
          </div>
          {pathScore > 0 && (
            <div
              className={cn(
                "px-2 py-0.5 rounded border text-[10px] font-mono flex-shrink-0 ml-2",
                pathScore >= 0.7
                  ? "text-primary border-primary/40 bg-primary/5"
                  : "text-amber-500 border-amber-500/30 bg-amber-500/5"
              )}
            >
              {(pathScore * 100).toFixed(0)}/100
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 font-mono text-sm space-y-2 min-h-0">
          {terminalLog.length === 0 && !isComputing && (
            <div className="text-muted-foreground/50 h-full flex flex-col items-center justify-center space-y-3 select-none">
              <Terminal className="w-8 h-8 opacity-20" />
              <span className="italic text-sm">Awaiting target selection...</span>
              <div className="text-[11px] text-center opacity-60 max-w-sm leading-relaxed">
                5-layer hybrid architecture: L1 Hybrid Retrieval (BM25+Semantic+Graph) surfaces candidates · L2 Multi-Agent Reasoning (Planner→Retriever→Analyst→Critic) coordinates · L3 Query Expansion enriches the search · L4 UCT Deep Path Exploration (120 rollouts) finds the optimal warm-introduction route · L5 Bayesian-UCB tunes scoring and direction.
              </div>
            </div>
          )}

          {terminalLog.map((log, i) => (
            <div key={i} className="animate-in fade-in slide-in-from-bottom-1 duration-150">
              <div className="flex items-start gap-x-2 overflow-x-auto pb-0.5 scrollbar-none">
                <span className="text-blue-400 whitespace-nowrap flex-shrink-0">[{log.step.toString().padStart(4, "0")}]</span>
                <span className={cn(getActionColor(log.action), "whitespace-nowrap flex-shrink-0")}>[{log.action}]</span>
                <span className="text-purple-400 whitespace-nowrap flex-shrink-0">[{log.registry}]</span>
                <span className="text-foreground whitespace-nowrap flex-shrink-0">{log.target}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">({log.targetType})</span>
                <span className="text-amber-500 whitespace-nowrap flex-shrink-0">UCT={log.uctScore.toFixed(3)}</span>
                <span className={cn(getWarmthColor(log.warmthScore), "whitespace-nowrap flex-shrink-0")}>
                  W={Math.round(log.warmthScore * 100)}%
                </span>
              </div>
              <div className="text-muted-foreground text-xs pl-8 border-l border-muted-foreground/20 mt-0.5 mb-2 leading-relaxed break-words">
                {">"} {log.reasoning}
              </div>
            </div>
          ))}

          {isComputing && (
            <div className="text-primary animate-pulse font-mono text-sm">
              {">"} Traversing graph... {terminalLog.length} nodes explored
            </div>
          )}

          <div ref={(el) => { logEndRef.current = el; }} />
        </div>

        <DiscoveryBureauPanel
          discoveryCase={discoveryCase}
          entities={entities}
          onCaseChange={setDiscoveryCase}
          onPromote={(entityId) => {
            setDiscoveryCase(null);
            setSelectedEntityId(entityId);
          }}
        />

        {/* ── Algorithm Pipeline Summary ── */}
        {algorithmPipeline && !isComputing && (
          <div className="border-t border-border/50 bg-[#080C14] px-4 md:px-5 py-3 flex-shrink-0 animate-in slide-in-from-bottom-4">
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-3.5 h-3.5 text-primary/70" />
              <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-widest">Algorithm Pipeline</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-1.5 sm:gap-2 flex-wrap">
              {algorithmPipeline.map((stage, i) => (
                <div key={i} className="flex items-start gap-1.5 bg-muted/10 border border-border/40 rounded px-2 py-1.5 min-w-0 flex-1 sm:min-w-[140px]">
                  <span className="text-[10px] font-mono text-muted-foreground/40 mt-0.5 flex-shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0">
                    <div className="text-[10px] font-mono font-bold text-primary/80 truncate">{stage.algo}</div>
                    <div className="text-[10px] font-mono text-muted-foreground/60 leading-snug mt-0.5">{stage.contribution}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!isComputing && (
          <BureauCasePanel
            entityId={selectedEntityId}
            bureauCase={bureauCase}
            onCaseChange={setBureauCase}
          />
        )}
        {!isComputing && <Scorecard score={scorecard} />}
        {!isComputing && <CandidateFunnelPanel funnel={candidateFunnel} />}
        {!isComputing && <RouteHierarchyPanel routes={routeHierarchy} />}
        {!isComputing && <IntroPathPanel candidate={introPathCandidate} />}

        {/* ── Winning Path Visualization ── */}
        {winningPath.length > 0 && !isComputing && (
          <div className="border-t border-border/50 bg-[#0B0F19] p-4 md:p-5 animate-in slide-in-from-bottom-10 flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-mono text-primary uppercase tracking-widest flex items-center">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Evidence Path — {winningPath.length} nodes
              </h3>
            </div>

            {/* Mobile: vertical stack */}
            <div className="flex md:hidden flex-col space-y-2">
              {winningPath.map((node, i) => (
                <div key={i}>
                  <div className={cn("flex flex-col border p-3 rounded", roleColor(node.role))}>
                    <div className="flex items-center mb-1.5 space-x-1">
                      {roleIcon(node.role)}
                      <span className="text-[10px] font-mono uppercase tracking-widest opacity-60">{node.role}</span>
                    </div>
                    <div className="font-bold text-foreground text-sm leading-tight mb-1">{node.label}</div>
                    <div className="text-xs opacity-50">{node.nodeType}</div>
                    <PathNodeContact node={node} />
                    {node.actionRequired && (
                      <div className="mt-2 text-xs leading-snug opacity-75 border-t border-current/20 pt-1.5">{node.actionRequired}</div>
                    )}
                  </div>
                  {i < winningPath.length - 1 && (
                    <div className="flex justify-center py-1">
                      <ChevronRight className="w-4 h-4 text-muted-foreground rotate-90" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop: horizontal */}
            <div className="hidden md:block relative">
              <div className="flex items-start overflow-x-auto pb-3 space-x-3 scrollbar-none">
                {winningPath.map((node, i) => (
                  <div key={i} className="flex items-center flex-shrink-0">
                    <div className={cn("flex flex-col border p-3 rounded min-w-[180px] max-w-[240px]", roleColor(node.role))}>
                      <div className="flex items-center mb-1.5 space-x-1">
                        {roleIcon(node.role)}
                        <span className="text-[10px] font-mono uppercase tracking-widest opacity-60">{node.role}</span>
                      </div>
                      <div className="font-bold text-foreground text-sm leading-tight mb-1">{node.label}</div>
                      <div className="text-xs opacity-50">{node.nodeType}</div>
                      <PathNodeContact node={node} />
                      {node.actionRequired && (
                        <div className="mt-2 text-xs leading-snug opacity-75 border-t border-current/20 pt-1.5">{node.actionRequired}</div>
                      )}
                    </div>
                    {i < winningPath.length - 1 && (
                      <div className="flex items-center mx-2 flex-shrink-0">
                        <div className="w-4 h-px bg-border/60" />
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="absolute right-0 top-0 bottom-3 w-16 bg-gradient-to-l from-[#0B0F19] to-transparent pointer-events-none" />
            </div>
          </div>
        )}
        {!isComputing && <EvidenceLedger sessionId={sessionId} />}
      </div>
    </div>
  );
}
