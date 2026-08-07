import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  Bot, Database, TrendingUp, Network, Briefcase,
  Palette, Layers, Play, CheckCircle2, XCircle, Clock,
  AlertTriangle, ChevronDown, ChevronUp, RefreshCw, Filter,
  User, Zap, ShieldCheck, GitBranch, Code2, SearchCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type PersonaId =
  | "data_engineer" | "data_analyst" | "intel_systems_analyst"
  | "business_engineer" | "ux_designer" | "architect"
   | "data_integrity_auditor" | "hybrid_architecture_auditor"
   | "user_operator" | "development_team" | "osint_specialists_team";

type Priority = "high" | "medium" | "low";
type LogStatus = "pending" | "applied" | "dismissed";

interface ImprovementLog {
  id: number;
  entityId: number;
  entityName?: string | null;
  entityType?: string | null;
  persona: PersonaId;
  category: string;
  priority: Priority;
  title: string;
  description: string;
  actionTaken?: string | null;
  status: LogStatus;
  createdAt: string;
}

interface PersonaStat {
  persona: PersonaId;
  status: LogStatus;
  count: number;
}

interface Stats {
  total: number;
  byPersona: PersonaStat[];
  byPriority: { priority: Priority; count: number }[];
}

interface JobState {
  jobId: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  inserted: number;
  errors: number;
  message: string;
  finishedAt?: string;
}

type RemediationState = "idle" | "starting" | "running" | "done" | "failed";
type CleanupState = "idle" | "starting" | "running" | "done" | "failed";

// ─── Persona config ───────────────────────────────────────────────────────────

const PERSONA_META: Record<PersonaId, { label: string; Icon: React.FC<any>; color: string; bg: string }> = {
  data_engineer:               { label: "Data Engineer",               Icon: Database,    color: "#3B82F6", bg: "rgba(59,130,246,0.1)"   },
  data_analyst:                { label: "Data Analyst",                Icon: TrendingUp,  color: "#10B981", bg: "rgba(16,185,129,0.1)"   },
  intel_systems_analyst:       { label: "Intel Systems Analyst",       Icon: Network,     color: "#A855F7", bg: "rgba(168,85,247,0.1)"   },
  business_engineer:           { label: "Business Engineer",           Icon: Briefcase,   color: "#F59E0B", bg: "rgba(245,158,11,0.1)"   },
  ux_designer:                 { label: "UX Designer",                 Icon: Palette,     color: "#EC4899", bg: "rgba(236,72,153,0.1)"   },
  architect:                   { label: "Architect",                   Icon: Layers,      color: "#06B6D4", bg: "rgba(6,182,212,0.1)"    },
  data_integrity_auditor:      { label: "Data Integrity Auditor",      Icon: ShieldCheck, color: "#EF4444", bg: "rgba(239,68,68,0.1)"    },
  hybrid_architecture_auditor: { label: "Hybrid Architecture Auditor", Icon: GitBranch,   color: "#F97316", bg: "rgba(249,115,22,0.1)"   },
  user_operator:               { label: "User / Principal Operator",   Icon: User,         color: "#F43F5E", bg: "rgba(244,63,94,0.1)"    },
  development_team:            { label: "Development Team",            Icon: Code2,        color: "#14B8A6", bg: "rgba(20,184,166,0.1)"   },
  osint_specialists_team:      { label: "OSINT Specialists Team",      Icon: SearchCheck,  color: "#EAB308", bg: "rgba(234,179,8,0.1)"    },
};

const ALL_PERSONAS = Object.keys(PERSONA_META) as PersonaId[];

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string }> = {
  high:   { label: "HIGH",   color: "#EF4444", bg: "rgba(239,68,68,0.15)"  },
  medium: { label: "MED",    color: "#F59E0B", bg: "rgba(245,158,11,0.15)" },
  low:    { label: "LOW",    color: "#6B7280", bg: "rgba(107,114,128,0.15)" },
};

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiPost(path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

async function apiGet(path: string) {
  const res = await fetch(`${BASE}/api${path}`);
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

async function apiPatch(path: string, body: unknown) {
  const res = await fetch(`${BASE}/api${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.json();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PersonaCard({ personaId, stats, activeFilter, onClick }: {
  personaId: PersonaId;
  stats: PersonaStat[];
  activeFilter: PersonaId | null;
  onClick: () => void;
}) {
  const meta = PERSONA_META[personaId];
  const personaStats = stats.filter(s => s.persona === personaId);
  const pending  = personaStats.find(s => s.status === "pending")?.count ?? 0;
  const applied  = personaStats.find(s => s.status === "applied")?.count ?? 0;
  const total    = personaStats.reduce((a, s) => a + s.count, 0);
  const isActive = activeFilter === personaId;

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 p-4 rounded-lg border text-left transition-all",
        isActive
          ? "border-current ring-1 ring-current"
          : "border-border hover:border-muted-foreground/40"
      )}
      style={isActive ? { borderColor: meta.color, background: meta.bg } : {}}
    >
      <div className="flex items-center gap-2">
        <meta.Icon className="h-4 w-4 flex-shrink-0" style={{ color: meta.color }} />
        <span className="text-xs font-semibold text-foreground">{meta.label}</span>
      </div>
      <div className="flex items-end gap-3">
        <span className="text-2xl font-bold font-mono" style={{ color: meta.color }}>{total}</span>
        <div className="flex flex-col gap-0.5 pb-0.5">
          {pending > 0 && (
            <span className="text-[10px] text-muted-foreground font-mono">{pending} pending</span>
          )}
          {applied > 0 && (
            <span className="text-[10px] text-emerald-500 font-mono">{applied} applied</span>
          )}
        </div>
      </div>
    </button>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span
      className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded"
      style={{ color: cfg.color, background: cfg.bg }}
    >
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: LogStatus }) {
  if (status === "applied")   return <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Applied</span>;
  if (status === "dismissed") return <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1"><XCircle className="h-3 w-3" />Dismissed</span>;
  return <span className="text-[10px] font-mono text-amber-400 flex items-center gap-1"><Clock className="h-3 w-3" />Pending</span>;
}

function LogCard({ log, onStatusChange }: {
  log: ImprovementLog;
  onStatusChange: (id: number, status: LogStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = PERSONA_META[log.persona];
  const isPending = log.status === "pending";

  return (
    <div className={cn(
      "border rounded-lg transition-all",
      log.status === "dismissed" ? "opacity-40 border-border" : "border-border hover:border-muted-foreground/30",
      log.priority === "high" && log.status === "pending" ? "border-l-2" : ""
    )}
      style={log.priority === "high" && log.status === "pending"
        ? { borderLeftColor: "#EF4444" }
        : {}
      }
    >
      <div
        className="flex items-start gap-3 p-4 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        {/* Persona icon */}
        <div className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center mt-0.5" style={{ background: meta.bg }}>
          <meta.Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <PriorityBadge priority={log.priority} />
            <span className="text-[10px] font-mono text-muted-foreground" style={{ color: meta.color }}>
              {meta.label}
            </span>
            {log.entityName && (
              <span className="text-[10px] font-mono text-muted-foreground/60 flex items-center gap-1">
                <User className="h-2.5 w-2.5" />{log.entityName}
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-foreground leading-snug">{log.title}</p>
          <StatusBadge status={log.status} />
        </div>

        <div className="flex-shrink-0 flex items-center gap-2">
          {isPending && (
            <>
              <button
                onClick={e => { e.stopPropagation(); onStatusChange(log.id, "applied"); }}
                className="text-emerald-500 hover:text-emerald-400 transition-colors p-1"
                title="Mark applied"
              >
                <CheckCircle2 className="h-4 w-4" />
              </button>
              <button
                onClick={e => { e.stopPropagation(); onStatusChange(log.id, "dismissed"); }}
                className="text-muted-foreground hover:text-red-400 transition-colors p-1"
                title="Dismiss"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </>
          )}
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          }
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">{log.description}</p>
          {log.actionTaken && (
            <div className="flex items-start gap-2 rounded bg-primary/5 border border-primary/10 p-3">
              <Zap className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs font-mono text-primary/80">{log.actionTaken}</p>
            </div>
          )}
          <div className="text-[10px] text-muted-foreground/50 font-mono">
            {new Date(log.createdAt).toLocaleString()} · category: {log.category}
          </div>
        </div>
      )}
    </div>
  );
}

function JobProgressBar({ job }: { job: JobState }) {
  const isRunning = job.status === "running" || job.status === "queued";
  const isDone    = job.status === "done";
  const isFailed  = job.status === "failed";

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRunning && <RefreshCw className="h-4 w-4 text-primary animate-spin" />}
          {isDone    && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          {isFailed  && <AlertTriangle className="h-4 w-4 text-red-500" />}
          <span className="text-sm font-medium">
            {isRunning ? "Running persona loop…" : isDone ? "Loop complete" : "Loop failed"}
          </span>
        </div>
        <span className="text-xs font-mono text-muted-foreground">{job.progress}%</span>
      </div>

      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500",
            isDone ? "bg-emerald-500" : isFailed ? "bg-red-500" : "bg-primary")}
          style={{ width: `${job.progress}%` }}
        />
      </div>

      <p className="text-xs text-muted-foreground font-mono">{job.message}</p>

      {isDone && (
        <p className="text-xs text-emerald-400 font-mono">
          <><CheckCircle2 className="mr-1 inline-block h-3 w-3" />{job.inserted} suggestions generated</>
          {job.errors > 0 && ` · ${job.errors} errors`}
        </p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ImprovementsPage() {
  const [, navigate] = useLocation();

  const [logs, setLogs]         = useState<ImprovementLog[]>([]);
  const [stats, setStats]       = useState<Stats | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const [activePersona, setActivePersona] = useState<PersonaId | null>(null);
  const [activeStatus, setActiveStatus]   = useState<LogStatus | "all">("all");
  const [activePriority, setActivePriority] = useState<Priority | "all">("all");

  const [runState, setRunState] = useState<"idle" | "starting" | "running" | "done">("idle");
  const [currentJob, setCurrentJob] = useState<JobState | null>(null);
  const [remediationState, setRemediationState] = useState<RemediationState>("idle");
  const [remediationJob, setRemediationJob] = useState<JobState | null>(null);
  const [cleanupState, setCleanupState] = useState<CleanupState>("idle");
  const [cleanupJob, setCleanupJob] = useState<JobState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch logs + stats
  const fetchData = async () => {
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (activePersona)               params.set("persona", activePersona);
      if (activeStatus !== "all")      params.set("status", activeStatus);
      if (activePriority !== "all")    params.set("priority", activePriority);

      const [logsData, statsData] = await Promise.all([
        apiGet(`/improve/logs?${params}`),
        apiGet("/improve/stats"),
      ]);

      setLogs(logsData.logs ?? []);
      setStats(statsData);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [activePersona, activeStatus, activePriority]);

  // Poll job status
  const startPolling = (jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const job = await apiGet(`/improve/jobs/${jobId}`);
        setCurrentJob(job);
        if (job.status === "done" || job.status === "failed") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setRunState("done");
          fetchData();
        }
      } catch { /* ignore poll errors */ }
    }, 1500);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Run improvement loop
  const handleRun = async () => {
    setRunState("starting");
    setCurrentJob(null);
    try {
      const result = await apiPost("/improve/run", { limit: 100 });
      setRunState("running");
      setCurrentJob({ jobId: result.jobId, status: "queued", progress: 0, inserted: 0, errors: 0, message: "Queued…" });
      startPolling(result.jobId);
    } catch (e: any) {
      // If already running, try polling the active job
      if (e.message?.includes("already running")) {
        setError("A loop is already running — check progress below.");
      } else {
        setError(e.message);
      }
      setRunState("idle");
    }
  };

  const handleStatusChange = async (logId: number, newStatus: LogStatus) => {
    try {
      await apiPatch(`/improve/logs/${logId}`, { status: newStatus });
      setLogs(prev => prev.map(l => l.id === logId ? { ...l, status: newStatus } : l));
      // Refresh stats
      const statsData = await apiGet("/improve/stats");
      setStats(statsData);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleApplySafe = async () => {
    setRemediationState("starting");
    setRemediationJob(null);
    try {
      const result = await apiPost("/improve/apply-safe");
      setRemediationState("running");
      setRemediationJob({
        jobId: result.jobId,
        status: "queued",
        progress: 0,
        inserted: 0,
        errors: 0,
        message: "Queued…",
      });
      const timer = window.setInterval(async () => {
        try {
          const job = await apiGet(`/improve/jobs/${result.jobId}`);
          setRemediationJob(job);
          if (job.status === "done" || job.status === "failed") {
            window.clearInterval(timer);
            setRemediationState(job.status === "done" ? "done" : "failed");
            fetchData();
          }
        } catch {
          // Keep the remediation state visible; the next refresh can recover.
        }
      }, 1500);
    } catch (e: any) {
      setError(e.message);
      setRemediationState("failed");
    }
  };

  const handleDeduplicate = async () => {
    setCleanupState("starting");
    setCleanupJob(null);
    try {
      const result = await apiPost("/improve/deduplicate");
      setCleanupState("running");
      setCleanupJob({
        jobId: result.jobId,
        status: "queued",
        progress: 0,
        inserted: 0,
        errors: 0,
        message: "Queued…",
      });
      const timer = window.setInterval(async () => {
        try {
          const job = await apiGet(`/improve/jobs/${result.jobId}`);
          setCleanupJob(job);
          if (job.status === "done" || job.status === "failed") {
            window.clearInterval(timer);
            setCleanupState(job.status === "done" ? "done" : "failed");
            fetchData();
          }
        } catch {
          // Keep the cleanup state visible while the server continues.
        }
      }, 1500);
    } catch (e: any) {
      setError(e.message);
      setCleanupState("failed");
    }
  };

  const pendingCount  = stats?.byPriority ? stats.byPersona.filter(s => s.status === "pending").reduce((a, s) => a + s.count, 0) : 0;
  const highCount     = stats?.byPriority?.find(p => p.priority === "high")?.count ?? 0;
  const isRunning     = runState === "running" || runState === "starting";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="flex-shrink-0 border-b border-border px-4 md:px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Bot className="h-5 w-5 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-bold tracking-widest uppercase font-mono text-primary leading-tight">
              Persona Loop
            </h1>
            <p className="text-xs text-muted-foreground hidden md:block">
              11 deterministic personas analyse every entity and surface concrete improvements
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {stats && stats.total > 0 && (
            <div className="hidden md:flex items-center gap-3 text-xs font-mono text-muted-foreground mr-2">
              {highCount > 0 && (
                <span className="text-red-400 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />{highCount} high
                </span>
              )}
              <span>{pendingCount} pending</span>
              <span>{stats.total} total</span>
            </div>
          )}
          <button
            onClick={handleRun}
            disabled={isRunning}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-xs font-semibold font-mono rounded-md transition-colors",
              isRunning
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {isRunning
              ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Running…</>
              : <><Play className="h-3.5 w-3.5" />Run Loop</>
            }
          </button>
          <button
            onClick={handleApplySafe}
            disabled={remediationState === "starting" || remediationState === "running"}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-xs font-semibold font-mono rounded-md transition-colors border",
              remediationState === "starting" || remediationState === "running"
                ? "border-border text-muted-foreground cursor-not-allowed"
                : "border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
            )}
            title="Apply only deterministic state fixes supported by stored evidence"
          >
            {remediationState === "starting" || remediationState === "running"
              ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Applying…</>
              : <><CheckCircle2 className="h-3.5 w-3.5" />Apply safe fixes</>
            }
          </button>
          <button
            onClick={handleDeduplicate}
            disabled={cleanupState === "starting" || cleanupState === "running"}
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-xs font-semibold font-mono rounded-md transition-colors border",
              cleanupState === "starting" || cleanupState === "running"
                ? "border-border text-muted-foreground cursor-not-allowed"
                : "border-sky-500/40 text-sky-400 hover:bg-sky-500/10"
            )}
            title="Dismiss repeated findings while retaining the newest copy"
          >
            {cleanupState === "starting" || cleanupState === "running"
              ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Cleaning…</>
              : <><Filter className="h-3.5 w-3.5" />Clean duplicates</>
            }
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-6">

        {/* ── Job progress ── */}
        {currentJob && (
          <JobProgressBar job={currentJob} />
        )}
        {remediationJob && (
          <JobProgressBar job={remediationJob} />
        )}
        {cleanupJob && (
          <JobProgressBar job={cleanupJob} />
        )}

        {/* ── Error ── */}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/20 border border-red-800/30 rounded-lg px-4 py-3">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* ── Empty state (no data ingested yet) ── */}
        {!loading && stats?.total === 0 && runState === "idle" && (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
            <Bot className="h-12 w-12 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No improvement logs yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Run the Persona Loop to analyse all entities and surface enrichment opportunities.
              </p>
            </div>
            <button
              onClick={handleRun}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              <Play className="h-4 w-4" />
              Run First Loop
            </button>
          </div>
        )}

        {/* ── Persona cards ── */}
        {stats && stats.total > 0 && (
          <>
            <div>
              <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">Personas</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {ALL_PERSONAS.map(pid => (
                  <PersonaCard
                    key={pid}
                    personaId={pid}
                    stats={stats.byPersona}
                    activeFilter={activePersona}
                    onClick={() => setActivePersona(prev => prev === pid ? null : pid)}
                  />
                ))}
              </div>
            </div>

            {/* ── Filters row ── */}
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />

              {/* Status filter */}
              <div className="flex gap-1">
                {(["all", "pending", "applied", "dismissed"] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setActiveStatus(s)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-mono rounded transition-colors",
                      activeStatus === s
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    {s === "all" ? "All status" : s}
                  </button>
                ))}
              </div>

              <div className="w-px h-4 bg-border" />

              {/* Priority filter */}
              <div className="flex gap-1">
                {(["all", "high", "medium", "low"] as const).map(p => (
                  <button
                    key={p}
                    onClick={() => setActivePriority(p)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-mono rounded transition-colors",
                      activePriority === p
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    {p === "all" ? "All priority" : p}
                  </button>
                ))}
              </div>

              {(activePersona || activeStatus !== "all" || activePriority !== "all") && (
                <button
                  onClick={() => { setActivePersona(null); setActiveStatus("all"); setActivePriority("all"); }}
                  className="text-[11px] font-mono text-muted-foreground hover:text-red-400 transition-colors ml-1"
                >
                  <><XCircle className="mr-1 inline-block h-3 w-3" />Clear filters</>
                </button>
              )}

              <span className="ml-auto text-xs font-mono text-muted-foreground">
                {logs.length} result{logs.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* ── Log list ── */}
            {loading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-muted/30 animate-pulse" />
                ))}
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No logs match the current filters.
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map(log => (
                  <LogCard key={log.id} log={log} onStatusChange={handleStatusChange} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
