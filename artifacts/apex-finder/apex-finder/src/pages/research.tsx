import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { getListResearchEvidenceQueryKey, useListEntities, useRunResearch, useListResearchEvidence } from "@workspace/api-client-react";
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

// ── Copy path as outreach brief button ────────────────────────────────────────
function CopyBriefButton({ winningPath, pathScore }: { winningPath: PathStep[]; pathScore: number }) {
  const [copied, setCopied] = useState(false);

  const buildBrief = () => {
    const lines: string[] = [
      `APEX OUTREACH BRIEF`,
      `Generated: ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`,
      `Path Score: ${(pathScore * 100).toFixed(0)}/100`,
      ``,
      `APPROACH PATH`,
      `${"─".repeat(40)}`,
    ];
    winningPath.forEach((node, i) => {
      lines.push(`${i + 1}. [${node.role}] ${node.label} (${node.nodeType})`);
      if (node.registry) lines.push(`   Registry:  ${node.registry}`);
      if (node.contactEmail) lines.push(`   Email:     ${node.contactEmail}`);
      if (node.contactPhone) lines.push(`   Phone:     ${node.contactPhone}`);
      if (node.contactConfidence) lines.push(`   Confidence: ${node.contactConfidence}%`);
      if (node.actionRequired) lines.push(`   Action:    ${node.actionRequired}`);
      if (i < winningPath.length - 1) lines.push(`   ↓`);
    });
    lines.push(``, `${"─".repeat(40)}`);
    lines.push(`[All data sourced from public registries and OSINT only.]`);
    return lines.join("\n");
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(buildBrief());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 font-mono text-[10px] uppercase tracking-wider transition-colors"
    >
      {copied ? <CheckCheck className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : "Copy Brief"}
    </button>
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
  const [safeUseStatus, setSafeUseStatus] = useState("manual_review");
  const [algorithmPipeline, setAlgorithmPipeline] = useState<Array<{ algo: string; contribution: string; status: string }> | null>(null);
  const [scorecard, setScorecard] = useState<ResearchScorecard | null>(null);
  const [candidateFunnel, setCandidateFunnel] = useState<CandidateFunnel | null>(null);
  const [introPathCandidate, setIntroPathCandidate] = useState<IntroPathCandidate | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Mobile entity picker state
  const [mobilePickerOpen, setMobilePickerOpen] = useState(false);
  const selectedEntity = entities?.find((e) => e.id === selectedEntityId);

  useEffect(() => {
    if (!selectedEntityId) {
      setIntroPathCandidate(null);
      return;
    }
    let active = true;
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

  const startAnalysis = () => {
    if (!selectedEntityId) return;

    setTerminalLog([]);
    setWinningPath([]);
    setPathScore(0);
    setSafeUseStatus("manual_review");
    setAlgorithmPipeline(null);
    setScorecard(null);
    setCandidateFunnel(null);
    setIntroPathCandidate(null);
    setIsComputing(true);
    setMobilePickerOpen(false);

    runResearch.mutate(
      { data: { entityId: selectedEntityId, depth: 4 } },
      {
        onSuccess: (data) => {
          setSessionId(data.id);
          setSafeUseStatus((data as any).safeUseStatus ?? "manual_review");

          let steps: MctsStep[] = [];
          let path: PathStep[] = [];

          try { steps = data.mctsSteps ? JSON.parse(data.mctsSteps) : []; } catch { steps = []; }
          try { path = data.winningPath ? JSON.parse(data.winningPath) : []; } catch { path = []; }

          setPathScore(data.pathScore ?? 0);
          try { setScorecard(data.scoreBreakdown ? JSON.parse(data.scoreBreakdown) : null); } catch { setScorecard(null); }
          setCandidateFunnel((data as any).candidateFunnel ?? null);
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
          <div className="text-[10px] font-mono text-muted-foreground text-center">
            Session #{sessionId} saved → Pipeline CRM
          </div>
        )}
        {sessionId && !isComputing && (
          <div className={cn(
            "text-[10px] font-mono text-center border rounded px-2 py-1.5",
            safeUseStatus === "blocked"
              ? "text-rose-300 border-rose-400/30 bg-rose-400/5"
              : safeUseStatus === "approved_for_manual_outreach"
                ? "text-amber-300 border-amber-400/30 bg-amber-400/5"
                : "text-sky-300 border-sky-400/30 bg-sky-400/5",
          )}>
            <Shield className="w-3 h-3 inline mr-1.5 align-[-2px]" />
            {safeUseStatus === "blocked"
              ? "Outreach blocked — research review only"
              : safeUseStatus === "approved_for_manual_outreach"
                ? "Manual outreach approval recorded — Apex Atlas never sends messages"
                : "Draft only — manual review required; Apex Atlas never sends messages"}
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
              Session #{sessionId} saved → Pipeline CRM
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
        {!isComputing && <Scorecard score={scorecard} />}
        {!isComputing && <CandidateFunnelPanel funnel={candidateFunnel} />}
        {!isComputing && <IntroPathPanel candidate={introPathCandidate} />}

        {/* ── Winning Path Visualization ── */}
        {winningPath.length > 0 && !isComputing && (
          <div className="border-t border-border/50 bg-[#0B0F19] p-4 md:p-5 animate-in slide-in-from-bottom-10 flex-shrink-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-mono text-primary uppercase tracking-widest flex items-center">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Optimal Approach Vector — {winningPath.length} nodes
              </h3>
              <CopyBriefButton winningPath={winningPath} pathScore={pathScore} />
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
