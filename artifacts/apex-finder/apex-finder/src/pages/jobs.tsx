import { useState, useEffect, useRef, useCallback } from "react";
import {
  Activity, Radio, Bot, Copy, RefreshCw, Play, Loader2,
  CheckCircle2, XCircle, ChevronDown, ChevronRight, Clock,
  Plane, Building2, FileText, Globe, Zap, Search, Network,
  Cpu, AlertTriangle, Brain, Shield, ShieldAlert, GitMerge, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────
interface Job {
  id: string; label: string; description: string; phase: number; category: string;
  endpoint?: string; body?: Record<string, unknown>;
  status: "idle" | "queued" | "running" | "done" | "failed";
  jobId?: string; progress: number; inserted: number; skipped: number;
  errors: number; message: string; startedAt?: string; finishedAt?: string;
}

// ─── Known job definitions ────────────────────────────────────────────────────
const JOB_DEFS: Array<Omit<Job, "status"|"jobId"|"progress"|"inserted"|"skipped"|"errors"|"message"|"startedAt"|"finishedAt">> = [
  // Phase 1 — Registries
  { id: "faa", label: "Aircraft Owners Search", description: "Discover US private aircraft owners (turbine/multi-engine only)", phase: 1, category: "Discovery", endpoint: "/api/ingest/faa", body: { maxRecords: 30000 } },
  { id: "land-registry", label: "UK Property Owners", description: "Discover UK property transactions over £1M", phase: 1, category: "Discovery", endpoint: "/api/ingest/land-registry" },
  { id: "western-hnwi", label: "Wealth Profile Search", description: "Scan SEC filings and corporate registries for wealth profiles", phase: 1, category: "Discovery", endpoint: "/api/ingest/western-hnwi", body: { targetCount: 500 } },
  // Phase 4 — Enrichment
  { id: "in-house-enrich", label: "Profile Data Enrichment", description: "Gather missing emails, public links, and background info", phase: 4, category: "Enrichment", endpoint: "/api/ingest/in-house-enrich", body: { batchSize: 500 } },
  { id: "deep-web-osint", label: "Deep Web Contact Search", description: "Cross-validate contact information across search engines", phase: 4, category: "Enrichment", endpoint: "/api/ingest/deep-web-osint", body: { batchSize: 500, hotOnly: true } },
  { id: "occrp", label: "Sanctions & Crime Check", description: "Cross-reference profiles against global watchlists", phase: 3, category: "Compliance", endpoint: "/api/ingest/occrp", body: { batchSize: 300 } },
  { id: "opensky", label: "Live Flight Tracking", description: "Update recent locations for registered aircraft owners", phase: 4, category: "Enrichment", endpoint: "/api/ingest/opensky" },
  { id: "ch-company-officers", label: "Corporate Network Expansion", description: "Discover co-directors and related corporate officers", phase: 3, category: "Discovery", endpoint: "/api/ingest/ch-company-officers", body: { batchSize: 200 } },
  // Phase 2 — Analysis
  { id: "compute-embeddings", label: "AI Profile Matching", description: "Update AI models to enable smart profile searching", phase: 2, category: "Analysis", endpoint: "/api/ingest/compute-embeddings", body: { batchSize: 50000 } },
  { id: "semantic-dedup", label: "Find Duplicate Profiles", description: "Detect likely duplicate profiles across different data sources", phase: 2, category: "Analysis", endpoint: "/api/relationships/semantic-dedup" },
  { id: "auto-detect-clusters", label: "Detect Corporate Networks", description: "Identify corporate family structures and series LLCs", phase: 2, category: "Analysis", endpoint: "/api/relationships/auto-detect-clusters" },
  { id: "bulk-hybrid-research", label: "Generate Outreach Paths", description: "Use the Hybrid Engine to find the best introduction paths for hot leads", phase: 2, category: "Analysis", endpoint: "/api/research/bulk-run", body: { batchSize: 200 } },
  // Maintenance
  { id: "sync-hot-flags", label: "Update Hot Leads", description: "Re-evaluate profile scores to identify new hot leads", phase: 5, category: "Maintenance", endpoint: "/api/ingest/sync-hot-flags" },
  { id: "populate-notes", label: "Auto-Generate Summaries", description: "Create readable profile summaries from raw asset data", phase: 5, category: "Maintenance", endpoint: "/api/ingest/populate-notes" },
  { id: "backfill-net-worth", label: "Estimate Net Worth", description: "Calculate estimated wealth based on known assets", phase: 5, category: "Maintenance", endpoint: "/api/ingest/backfill-net-worth" },
  { id: "wikidata-associates", label: "Find Known Associates", description: "Discover family members and known business partners", phase: 5, category: "Discovery", endpoint: "/api/relationships/seed-wikidata-associates" },
];

// ─── Utility ──────────────────────────────────────────────────────────────────
function statusIcon(status: Job["status"]) {
  if (status === "running" || status === "queued") return <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />;
  if (status === "done") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
  if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-red-400" />;
  return <div className="w-3.5 h-3.5 rounded-full border border-border bg-muted/30" />;
}

function statusColor(status: Job["status"]) {
  if (status === "running" || status === "queued") return "text-primary";
  if (status === "done") return "text-emerald-400";
  if (status === "failed") return "text-red-400";
  return "text-muted-foreground/40";
}

function categoryIcon(cat: string) {
  if (cat === "Discovery") return <Globe className="w-3.5 h-3.5 text-blue-400" />;
  if (cat === "Enrichment") return <Search className="w-3.5 h-3.5 text-amber-400" />;
  if (cat === "Analysis") return <Brain className="w-3.5 h-3.5 text-violet-400" />;
  if (cat === "Compliance") return <ShieldAlert className="w-3.5 h-3.5 text-red-400" />;
  return <Zap className="w-3.5 h-3.5 text-muted-foreground" />;
}

function elapsed(iso?: string) {
  if (!iso) return null;
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// ─── Ingestor Card ────────────────────────────────────────────────────────────
function IngestorCard({ job, onTrigger }: { job: Job; onTrigger: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const isActive = job.status === "running" || job.status === "queued";

  return (
    <div className={cn("border border-border rounded-lg overflow-hidden transition-colors", isActive && "border-primary/30")} data-testid={`card-job-${job.id}`}>
      <button
        onClick={() => setOpen(o => !o)}
        data-testid={`button-toggle-job-${job.id}`}
        className="w-full flex items-center gap-3 px-4 py-3 bg-card/30 hover:bg-muted/20 transition-colors text-left"
      >
        <div className="shrink-0">{categoryIcon(job.category)}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono font-bold text-foreground truncate">{job.label}</span>
            <span className="text-[9px] font-mono uppercase text-muted-foreground/40 border border-border px-1 py-0.5 rounded hidden sm:block whitespace-nowrap">{job.category}</span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground truncate mt-0.5">{job.description}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {statusIcon(job.status)}
          {job.status === "done" && job.inserted > 0 && (
            <span className="text-[10px] font-mono text-emerald-400 hidden sm:block">+{job.inserted.toLocaleString()}</span>
          )}
          {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-border/50 px-4 py-3 bg-background/30 space-y-3">
          {/* Metrics */}
          {job.status !== "idle" && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono">
              <span className={statusColor(job.status)}>
                {job.status.toUpperCase()}
                {job.status === "done" ? " · 100%" : isActive && job.progress > 0 ? ` · ${Math.min(100, job.progress)}%` : ""}
              </span>
              {job.inserted > 0 && <span className="text-emerald-400">+{job.inserted.toLocaleString()} inserted</span>}
              {job.skipped > 0 && <span className="text-muted-foreground">{job.skipped.toLocaleString()} deduped</span>}
              {job.errors > 0 && <span className="text-red-400">{job.errors} errors</span>}
              {job.startedAt && <span className="text-muted-foreground/40">{elapsed(job.startedAt)}</span>}
            </div>
          )}
          {(isActive || job.status === "done") && (
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              {job.status === "queued" ? (
                <div className="h-full rounded-full bg-primary/60 animate-pulse" style={{ width: "30%" }} />
              ) : job.status === "done" ? (
                <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: "100%" }} />
              ) : (
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${Math.min(100, job.progress || 5)}%` }} />
              )}
            </div>
          )}
          {job.message && (
            <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">{job.message}</p>
          )}
          {/* Trigger */}
          {job.endpoint && (
            <button
              onClick={() => onTrigger(job.id)}
              disabled={isActive}
              data-testid={`button-trigger-job-${job.id}`}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono text-[11px] uppercase tracking-wider transition-colors",
                isActive
                  ? "border-border text-muted-foreground opacity-50 cursor-not-allowed"
                  : "border-primary/40 text-primary bg-primary/5 hover:bg-primary/15"
              )}
            >
              {isActive ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {isActive ? "Running…" : "Trigger Task"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Persona Loop tab ─────────────────────────────────────────────────────────
function PersonaLoopTab() {
  const [stats, setStats] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`${BASE}/api/improve/stats`).then(r => r.ok ? r.json() : null).then(d => d && setStats(d)).catch(() => {});
    fetch(`${BASE}/api/improve/logs?limit=50`).then(r => r.ok ? r.json() : []).then(d => setLogs(Array.isArray(d) ? d : d.logs ?? [])).catch(() => {});
  }, []);

  const pollJob = useCallback(async (id: string) => {
    try {
      const r = await fetch(`${BASE}/api/improve/jobs/${id}`);
      if (!r.ok) return;
      const d = await r.json();
      if (d.status === "done" || d.status === "failed") {
        setRunning(false);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        // Refresh
        fetch(`${BASE}/api/improve/stats`).then(r => r.ok ? r.json() : null).then(d => d && setStats(d)).catch(() => {});
        fetch(`${BASE}/api/improve/logs?limit=50`).then(r => r.ok ? r.json() : []).then(d => setLogs(Array.isArray(d) ? d : d.logs ?? [])).catch(() => {});
      }
    } catch { /* */ }
  }, []);

  const handleRun = async () => {
    setRunning(true);
    try {
      const r = await fetch(`${BASE}/api/improve/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchSize: 50 }) });
      const d = await r.json();
      const id = d.jobId;
      if (id) {
        setJobId(id);
        pollRef.current = setInterval(() => pollJob(id), 2000);
      } else {
        setRunning(false);
      }
    } catch { setRunning(false); }
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const personas = ["data_engineer","data_analyst","intel_systems_analyst","business_engineer","ux_designer","architect","data_integrity_auditor","hybrid_architecture_auditor"];
  const personaLabel = (id: string) => id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const filteredLogs = filter === "all" ? logs : logs.filter((l: any) => l.persona === filter);

  return (
    <div className="space-y-4">
      {/* Header + trigger */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold font-mono text-foreground uppercase tracking-widest">AI Analyst Suggestions</div>
          <div className="text-[10px] font-mono text-muted-foreground mt-0.5">AI models analyze profiles continuously to suggest data corrections and improvements.</div>
        </div>
        <button onClick={handleRun} disabled={running} data-testid="button-run-ai-analysts" className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded border font-mono text-[11px] uppercase tracking-wider transition-colors", running ? "border-border text-muted-foreground opacity-50 cursor-not-allowed" : "border-primary/40 text-primary bg-primary/5 hover:bg-primary/15")}>
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {running ? "Analyzing…" : "Run Analysts Now"}
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "Total Suggestions", val: stats.totalLogs ?? 0, color: "text-foreground" },
            { label: "Pending", val: stats.pending ?? 0, color: "text-amber-400" },
            { label: "Applied", val: stats.applied ?? 0, color: "text-emerald-400" },
            { label: "Dismissed", val: stats.dismissed ?? 0, color: "text-muted-foreground" },
          ].map(({ label, val, color }) => (
            <div key={label} className="p-3 rounded-lg border border-border bg-card/30 text-center">
              <div className={cn("text-xl font-bold font-mono", color)}>{val.toLocaleString()}</div>
              <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Persona filter */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setFilter("all")} className={cn("px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider border transition-colors", filter === "all" ? "border-primary/40 text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground")}>All Analysts</button>
        {personas.map(p => (
          <button key={p} onClick={() => setFilter(p)} className={cn("px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider border transition-colors", filter === p ? "border-primary/40 text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground")}>
            {personaLabel(p).split(" ")[0]}
          </button>
        ))}
      </div>

      {/* Logs */}
      <div className="space-y-2">
        {filteredLogs.length === 0 && (
          <div className="text-center py-8 text-xs font-mono text-muted-foreground">No suggestions yet. Run the AI Analysts to generate improvement suggestions.</div>
        )}
        {filteredLogs.map((log: any) => (
          <div key={log.id} className="p-3 rounded-lg border border-border bg-card/30" data-testid={`card-suggestion-${log.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="text-[9px] font-mono uppercase tracking-widest text-primary border border-primary/30 bg-primary/5 px-1.5 py-0.5 rounded">{personaLabel(log.persona)}</span>
                <span className={cn("text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border", log.priority === "HIGH" ? "text-red-400 border-red-400/20 bg-red-400/5" : log.priority === "MEDIUM" ? "text-amber-400 border-amber-400/20 bg-amber-400/5" : "text-muted-foreground border-border")}>{log.priority}</span>
                {log.entityName && <span className="text-[10px] font-mono text-muted-foreground truncate">{log.entityName}</span>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => fetch(`${BASE}/api/improve/logs/${log.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "applied" }) }).then(() => setLogs(prev => prev.map(l => l.id === log.id ? { ...l, status: "applied" } : l)))}
                  data-testid={`button-apply-suggestion-${log.id}`}
                  className="text-[9px] font-mono text-emerald-400/60 hover:text-emerald-400 border border-emerald-400/20 px-1.5 py-0.5 rounded transition-colors">Apply</button>
                <button onClick={() => fetch(`${BASE}/api/improve/logs/${log.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "dismissed" }) }).then(() => setLogs(prev => prev.filter(l => l.id !== log.id)))}
                  data-testid={`button-dismiss-suggestion-${log.id}`}
                  className="text-[9px] font-mono text-muted-foreground/40 hover:text-muted-foreground border border-border/50 px-1.5 py-0.5 rounded transition-colors">Dismiss</button>
              </div>
            </div>
            <p className="text-[11px] font-mono text-foreground/80 mt-1.5 leading-relaxed">{log.suggestion}</p>
            {log.actionTaken && <p className="text-[10px] font-mono text-emerald-400/60 mt-1 bg-emerald-400/5 border border-emerald-400/10 rounded px-2 py-1">{log.actionTaken}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Duplicates tab ───────────────────────────────────────────────────────────
function DuplicatesTab() {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [swapped, setSwapped] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${BASE}/api/entities/duplicate-candidates`)
      .then(r => r.ok ? r.json() : [])
      .then(d => { setCandidates(Array.isArray(d) ? d : d.candidates ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const merge = async (pair: any) => {
    const key = `${pair.entity1.id}-${pair.entity2.id}`;
    const isSwapped = swapped.has(key);
    const keepId = isSwapped ? pair.entity2.id : pair.entity1.id;
    const deleteId = isSwapped ? pair.entity1.id : pair.entity2.id;
    setMerging(key);
    try {
      const r = await fetch(`${BASE}/api/entities/${keepId}/merge/${deleteId}`, { method: "POST" });
      if (r.ok) setCandidates(prev => prev.filter(p => `${p.entity1.id}-${p.entity2.id}` !== key));
    } catch { /* */ }
    setMerging(null);
  };

  const dismiss = (pair: any) => {
    const key = `${pair.entity1.id}-${pair.entity2.id}`;
    setDismissed(prev => new Set([...prev, key]));
  };

  const visible = candidates.filter(p => !dismissed.has(`${p.entity1.id}-${p.entity2.id}`));

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" /><span className="text-xs font-mono">Loading duplicate candidates…</span>
    </div>
  );

  if (visible.length === 0) return (
    <div className="flex flex-col items-center justify-center py-16 text-center" data-testid="empty-state-duplicates">
      <CheckCircle2 className="w-8 h-8 text-emerald-400 mb-3" />
      <p className="text-sm font-mono text-foreground">No duplicate candidates</p>
      <p className="text-xs font-mono text-muted-foreground mt-1">All pairs reviewed or none detected</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-mono text-muted-foreground">{visible.length} candidate pairs · AI name matching</div>
      {visible.map((pair: any) => {
        const key = `${pair.entity1.id}-${pair.entity2.id}`;
        const isSwapped = swapped.has(key);
        const primary = isSwapped ? pair.entity2 : pair.entity1;
        const secondary = isSwapped ? pair.entity1 : pair.entity2;
        const isMerging = merging === key;
        return (
          <div key={key} className="border border-border rounded-lg overflow-hidden" data-testid={`card-duplicate-${key}`}>
            <button onClick={() => setExpanded(expanded === key ? null : key)} data-testid={`button-toggle-duplicate-${key}`} className="w-full flex items-center gap-3 px-4 py-3 bg-card/30 hover:bg-muted/20 transition-colors text-left">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-medium text-foreground truncate">{pair.entity1.name}</span>
                  <span className="text-muted-foreground/40 text-[10px] font-mono shrink-0">≈</span>
                  <span className="text-xs font-mono font-medium text-foreground truncate">{pair.entity2.name}</span>
                </div>
                {pair.sharedTokens && (
                  <div className="text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                    Shared: {pair.sharedTokens.join(", ")}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[9px] font-mono text-primary border border-primary/30 px-1.5 py-0.5 rounded">{Math.round((pair.similarity ?? 0) * 100)}%</span>
                {expanded === key ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
              </div>
            </button>
            {expanded === key && (
              <div className="border-t border-border/50 p-3 bg-background/30 space-y-3">
                <div className="grid sm:grid-cols-2 gap-2">
                  {[{ entity: primary, label: "KEEP" }, { entity: secondary, label: "MERGE INTO (PRIMARY)" }].map(({ entity, label }) => (
                    <div key={entity.id} className={cn("p-3 rounded border text-xs font-mono space-y-1", label === "KEEP" ? "border-primary/30 bg-primary/5" : "border-border bg-card/30")}>
                      <div className="text-[9px] uppercase tracking-widest text-muted-foreground/50">{label}</div>
                      <div className="font-bold text-foreground">{entity.name}</div>
                      <div className="text-muted-foreground uppercase text-[9px]">{entity.entityType}</div>
                      {entity.bayesianScore != null && <div className="text-primary">Signal: {((entity.bayesianScore ?? 0) * 100).toFixed(0)}</div>}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => setSwapped(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; })} data-testid={`button-swap-duplicate-${key}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-muted-foreground text-[10px] font-mono uppercase hover:text-foreground hover:border-primary/40 transition-colors">
                    <GitMerge className="w-3 h-3" /> Swap Direction
                  </button>
                  <button onClick={() => merge(pair)} disabled={isMerging} data-testid={`button-merge-duplicate-${key}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/40 text-primary text-[10px] font-mono uppercase bg-primary/5 hover:bg-primary/15 transition-colors disabled:opacity-50">
                    {isMerging ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitMerge className="w-3 h-3" />}
                    {isMerging ? "Merging…" : "Merge"}
                  </button>
                  <button onClick={() => dismiss(pair)} data-testid={`button-dismiss-duplicate-${key}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-muted-foreground text-[10px] font-mono uppercase hover:text-foreground transition-colors">
                    <Trash2 className="w-3 h-3" /> Not a Match
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Live Activity tab ────────────────────────────────────────────────────────
function LiveActivityTab({ jobs }: { jobs: Job[] }) {
  const active = jobs.filter(j => j.status === "running" || j.status === "queued");
  const recent = jobs.filter(j => j.status === "done" || j.status === "failed").slice(0, 10);
  const idle = jobs.filter(j => j.status === "idle");

  return (
    <div className="space-y-4">
      {active.length > 0 && (
        <div>
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2" data-testid="text-active-tasks-count">Active ({active.length})</div>
          <div className="space-y-2">
            {active.map(job => (
              <div key={job.id} className="p-3 rounded-lg border border-primary/30 bg-primary/5 flex items-center gap-3" data-testid={`card-active-job-${job.id}`}>
                <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono font-bold text-primary truncate">{job.label}</div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate">{job.message || `${job.status}…`}</div>
                  {(job.progress > 0 || job.status === "queued") && (
                    <div className="h-1 rounded-full bg-primary/20 overflow-hidden mt-1.5">
                      {job.status === "queued" ? (
                        <div className="h-full rounded-full bg-primary/60 animate-pulse" style={{ width: "20%" }} />
                      ) : (
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, job.progress)}%` }} />
                      )}
                    </div>
                  )}
                </div>
                {job.inserted > 0 && <span className="text-[10px] font-mono text-emerald-400 shrink-0">+{job.inserted.toLocaleString()}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {active.length === 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/20">
          <div className="w-2 h-2 rounded-full bg-muted-foreground/30 shrink-0" />
          <span className="text-xs font-mono text-muted-foreground" data-testid="text-no-running-tasks">No tasks currently running</span>
          <Link href="/jobs#sources" className="text-[10px] font-mono text-primary/60 hover:text-primary ml-auto whitespace-nowrap" data-testid="link-trigger-task">Trigger a task →</Link>
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2">Recent completions</div>
          <div className="space-y-1">
            {recent.map(job => (
              <div key={job.id} className="flex items-center gap-3 px-3 py-2 rounded border border-border/50 bg-card/10">
                {statusIcon(job.status)}
                <span className="text-xs font-mono text-foreground/80 truncate flex-1">{job.label}</span>
                {job.inserted > 0 && <span className="text-[10px] font-mono text-emerald-400">+{job.inserted.toLocaleString()}</span>}
                {job.startedAt && <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0 hidden sm:block">{elapsed(job.startedAt)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {idle.length > 0 && (
        <div>
          <div className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-widest mb-2">Idle ({idle.length} tasks)</div>
          <div className="flex flex-wrap gap-1.5">
            {idle.map(job => (
              <span key={job.id} className="text-[9px] font-mono text-muted-foreground/30 border border-border/30 px-2 py-0.5 rounded">{job.label}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type TabId = "live" | "sources" | "personas" | "duplicates";

const TABS: Array<{ id: TabId; label: string; icon: typeof Activity }> = [
  { id: "live",       label: "Running Tasks",  icon: Activity },
  { id: "sources",    label: "Available Tasks", icon: Radio },
  { id: "personas",   label: "AI Suggestions", icon: Bot },
  { id: "duplicates", label: "Duplicates",      icon: Copy },
];

const CATEGORY_ORDER = ["Discovery", "Enrichment", "Analysis", "Compliance", "Maintenance"];

export default function BackgroundJobs() {
  const [activeTab, setActiveTab] = useState<TabId>("live");
  const [jobs, setJobs] = useState<Job[]>(() =>
    JOB_DEFS.map(d => ({ ...d, status: "idle", progress: 0, inserted: 0, skipped: 0, errors: 0, message: "" }))
  );
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/ingest/jobs`);
      if (!r.ok) return;
      const data = await r.json();
      const serverJobs: Record<string, any> = {};
      (data.jobs ?? []).forEach((j: any) => { serverJobs[j.id] = j; });
      setJobs(prev => prev.map(j => {
        const s = serverJobs[j.id];
        if (!s) return j;
        return { ...j, status: s.status ?? j.status, jobId: s.jobId, progress: s.progress ?? 0, inserted: s.inserted ?? 0, skipped: s.skipped ?? 0, errors: s.errors ?? 0, message: s.message ?? "", startedAt: s.startedAt, finishedAt: s.finishedAt };
      }));
      setLastRefresh(new Date());
    } catch { /* graceful — endpoint may not exist yet */ }
  }, []);

  useEffect(() => {
    fetchJobs();
    pollRef.current = setInterval(fetchJobs, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchJobs]);

  const triggerJob = async (id: string) => {
    const def = JOB_DEFS.find(d => d.id === id);
    if (!def?.endpoint) return;
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: "queued", message: "Starting…", progress: 0 } : j));
    try {
      const r = await fetch(`${BASE}${def.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: def.body ? JSON.stringify(def.body) : undefined,
      });
      const d = await r.json();
      const jobId = d.jobId;
      if (jobId) {
        setJobs(prev => prev.map(j => j.id === id ? { ...j, jobId, status: "running" } : j));
        // Poll this specific job
        const pollThis = setInterval(async () => {
          try {
            const r2 = await fetch(`${BASE}/api/ingest/job/${jobId}`);
            if (!r2.ok) return;
            const d2 = await r2.json();
            setJobs(prev => prev.map(j => j.id === id ? {
              ...j, status: d2.status ?? j.status, progress: d2.progress ?? 0,
              inserted: d2.inserted ?? 0, skipped: d2.skipped ?? 0, errors: d2.errors ?? 0, message: d2.message ?? "",
            } : j));
            if (d2.status === "done" || d2.status === "failed") clearInterval(pollThis);
          } catch { clearInterval(pollThis); }
        }, 1500);
      } else {
        setJobs(prev => prev.map(j => j.id === id ? { ...j, status: "failed", message: d.error ?? "No jobId returned" } : j));
      }
    } catch (e: any) {
      setJobs(prev => prev.map(j => j.id === id ? { ...j, status: "failed", message: e.message } : j));
    }
  };

  const grouped = CATEGORY_ORDER.map(cat => ({
    cat,
    items: jobs.filter(j => j.category === cat),
  })).filter(g => g.items.length > 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="border-b border-border bg-card/30 px-4 md:px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Radio className="w-5 h-5 text-primary shrink-0" />
            <div>
              <h1 className="text-sm font-bold font-mono uppercase tracking-widest text-foreground">Background Jobs</h1>
              <p className="text-[10px] font-mono text-muted-foreground mt-0.5">Pipeline orchestration · ingestor control · persona loop · duplicate review</p>
            </div>
          </div>
          <button onClick={fetchJobs} className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <RefreshCw className="w-3.5 h-3.5" />
            {lastRefresh ? <span className="hidden sm:block">{elapsed(lastRefresh.toISOString())}</span> : null}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border bg-card/20 flex-shrink-0">
        <div className="flex overflow-x-auto scrollbar-none px-4">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-3 text-xs font-mono uppercase tracking-wider border-b-2 whitespace-nowrap transition-colors",
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <tab.icon className="w-3.5 h-3.5 shrink-0" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6">
        {activeTab === "live" && <LiveActivityTab jobs={jobs} />}

        {activeTab === "sources" && (
          <div className="space-y-6">
            {grouped.map(({ cat, items }) => (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-3">
                  {categoryIcon(cat)}
                  <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">{cat}</span>
                  <div className="flex-1 h-px bg-border/50" />
                </div>
                <div className="space-y-2">
                  {items.map(job => (
                    <IngestorCard key={job.id} job={job} onTrigger={triggerJob} />
                  ))}
                </div>
              </div>
            ))}
            {/* OSINT Tools link */}
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/20">
              <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-foreground">OSINT Tools Directory</div>
                <div className="text-[10px] font-mono text-muted-foreground">4,400+ categorized open-source intelligence tools</div>
              </div>
              <Link href="/_osint-tools" className="text-[10px] font-mono text-primary/60 hover:text-primary whitespace-nowrap flex items-center gap-0.5">
                Browse <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        )}

        {activeTab === "personas" && <PersonaLoopTab />}
        {activeTab === "duplicates" && <DuplicatesTab />}
      </div>
    </div>
  );
}
