import { useState, useEffect, useCallback } from "react";
import { Copy, Merge, AlertTriangle, CheckCircle2, XCircle, RefreshCw, ChevronRight, ArrowRight, Layers3 } from "lucide-react";
import { cn, formatEntityName } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EntityStub {
  id: number;
  name: string;
  type: string;
  bayesianScore: number;
}

interface DuplicateCandidate {
  entityA: EntityStub;
  entityB: EntityStub;
  sharedTokens: number;
}

interface SameSourceCluster {
  name: string;
  registry: string;
  count: number;
  entities: EntityStub[];
}

interface DedupReview {
  entityAId: number;
  entityBId: number;
  decision: "dismissed" | "merged";
  keepEntityId: number | null;
}

type MergeState = "idle" | "confirming" | "merging" | "done" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function scoreColor(score: number) {
  if (score >= 0.8) return "text-emerald-400";
  if (score >= 0.6) return "text-amber-400";
  return "text-muted-foreground";
}

function typeColor(type: string) {
  switch (type) {
    case "HNWI": return "bg-blue-500/20 text-blue-300";
    case "Corporation": return "bg-purple-500/20 text-purple-300";
    case "Trust": return "bg-amber-500/20 text-amber-300";
    case "Gatekeeper": return "bg-emerald-500/20 text-emerald-300";
    default: return "bg-muted text-muted-foreground";
  }
}

function confidenceLabel(tokens: number): { label: string; color: string } {
  if (tokens >= 4) return { label: "High confidence", color: "text-red-400" };
  if (tokens >= 3) return { label: "Medium confidence", color: "text-amber-400" };
  return { label: "Low confidence", color: "text-muted-foreground" };
}

// ─── EntityCard ───────────────────────────────────────────────────────────────

function EntityCard({ entity, role }: { entity: EntityStub; role: "primary" | "target" }) {
  return (
    <div className={cn(
      "flex-1 rounded-lg border p-3 min-w-0",
      role === "primary"
        ? "border-primary/30 bg-primary/5"
        : "border-destructive/30 bg-destructive/5"
    )}>
      <div className="flex items-start gap-2 mb-2">
        <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-widest flex-shrink-0", typeColor(entity.type))}>
          {entity.type}
        </span>
        <span className={cn("text-xs font-mono flex-shrink-0 ml-auto", scoreColor(entity.bayesianScore))}>
          {(entity.bayesianScore * 100).toFixed(0)}%
        </span>
      </div>
      <p className="text-sm font-medium leading-tight break-words">{entity.name}</p>
      <p className="text-xs text-muted-foreground mt-1 font-mono">ID #{entity.id}</p>
      {role === "primary" && (
        <span className="text-[10px] text-primary/60 font-mono mt-1 block">KEEP THIS</span>
      )}
      {role === "target" && (
        <span className="text-[10px] text-destructive/60 font-mono mt-1 block">WILL BE DELETED</span>
      )}
    </div>
  );
}

// ─── CandidateRow ─────────────────────────────────────────────────────────────

function CandidateRow({
  candidate,
  dismissed,
  onDismiss,
  onMerge,
}: {
  candidate: DuplicateCandidate;
  dismissed: boolean;
  onDismiss: () => void;
  onMerge: (keepId: number, deleteId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [keepA, setKeepA] = useState(true); // true = keep A, false = keep B
  const { label, color } = confidenceLabel(candidate.sharedTokens);

  if (dismissed) return null;

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Summary row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <Copy className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {formatEntityName(candidate.entityA.name)}
            <span className="text-muted-foreground mx-1.5">×</span>
            {formatEntityName(candidate.entityB.name)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className={cn("font-mono", color)}>{label}</span>
            <span className="mx-1.5">·</span>
            {candidate.sharedTokens} shared name token{candidate.sharedTokens !== 1 ? "s" : ""}
          </p>
        </div>
        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform flex-shrink-0", expanded && "rotate-90")} />
      </button>

      {/* Expanded review panel */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border pt-4 space-y-4">
          {/* Entity comparison */}
          <div className="flex flex-col md:flex-row items-stretch gap-2">
            <EntityCard entity={keepA ? candidate.entityA : candidate.entityB} role="primary" />
            <div className="flex md:flex-col items-center justify-center px-1">
              <ArrowRight className="h-4 w-4 text-muted-foreground md:rotate-0 rotate-90" />
            </div>
            <EntityCard entity={keepA ? candidate.entityB : candidate.entityA} role="target" />
          </div>

          {/* Swap direction */}
          <button
            onClick={() => setKeepA(k => !k)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 font-mono"
          >
            <RefreshCw className="h-3 w-3" /> Swap direction (keep the other one)
          </button>

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => onMerge(
                keepA ? candidate.entityA.id : candidate.entityB.id,
                keepA ? candidate.entityB.id : candidate.entityA.id,
              )}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary/10 hover:bg-primary/20 text-primary text-sm font-medium transition-colors"
            >
              <Merge className="h-3.5 w-3.5" /> Merge
            </button>
            <button
              onClick={onDismiss}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground text-sm transition-colors"
            >
              <XCircle className="h-3.5 w-3.5" /> Not a duplicate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MergeToast ───────────────────────────────────────────────────────────────

function MergeToast({ state, message }: { state: MergeState; message: string }) {
  if (state === "idle") return null;
  return (
    <div className={cn(
      "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border text-sm font-mono",
      state === "merging" && "bg-card border-border text-muted-foreground",
      state === "done" && "bg-emerald-950/80 border-emerald-600/40 text-emerald-300",
      state === "error" && "bg-red-950/80 border-red-600/40 text-red-300",
    )}>
      {state === "merging" && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
      {state === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
      {state === "error" && <AlertTriangle className="h-3.5 w-3.5" />}
      {message}
    </div>
  );
}

function SameSourceClusterRow({ cluster }: { cluster: SameSourceCluster }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(value => !value)}
      >
        <Layers3 className="h-3.5 w-3.5 text-sky-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{formatEntityName(cluster.name)}</p>
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            <span className="text-sky-300">{cluster.registry}</span>
            <span className="mx-1.5">·</span>
            {cluster.count} same-source record{cluster.count !== 1 ? "s" : ""}
          </p>
        </div>
        <ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform flex-shrink-0", expanded && "rotate-90")} />
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          <p className="text-[11px] text-muted-foreground font-mono">
            Same-source records are shown for review only. They are not automatically treated as the same person.
          </p>
          {cluster.entities.map(entity => (
            <div key={entity.id} className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
              <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-widest flex-shrink-0", typeColor(entity.type))}>
                {entity.type}
              </span>
              <span className="text-sm truncate flex-1">{formatEntityName(entity.name)}</span>
              <span className={cn("text-xs font-mono flex-shrink-0", scoreColor(entity.bayesianScore))}>
                {(entity.bayesianScore * 100).toFixed(0)}%
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">#{entity.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DuplicatesPage() {
  const [activeTab, setActiveTab] = useState<"cross-registry" | "same-source">("cross-registry");
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [sameSourceClusters, setSameSourceClusters] = useState<SameSourceCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [sameSourceLoading, setSameSourceLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sameSourceError, setSameSourceError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [merged, setMerged] = useState<Set<string>>(new Set());
  const [mergeState, setMergeState] = useState<MergeState>("idle");
  const [mergeMsg, setMergeMsg] = useState("");

  const pairKey = (a: number, b: number) => `${Math.min(a, b)}_${Math.max(a, b)}`;

  const load = useCallback(async () => {
    setLoading(true);
    setSameSourceLoading(true);
    setError(null);
    setSameSourceError(null);
    try {
      const data = await apiFetch<{ candidates: DuplicateCandidate[] }>("/api/entities/duplicate-candidates");
      setCandidates(data.candidates ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
    try {
      const data = await apiFetch<{ clusters: SameSourceCluster[] }>("/api/entities/same-source-name-clusters");
      setSameSourceClusters(data.clusters ?? []);
    } catch (e: any) {
      setSameSourceError(e?.message ?? "Failed to load same-source clusters");
    } finally {
      setSameSourceLoading(false);
    }
    try {
      const data = await apiFetch<{ reviews: DedupReview[] }>("/api/entities/dedup-reviews");
      const nextDismissed = new Set<string>();
      const nextMerged = new Set<string>();
      for (const review of data.reviews ?? []) {
        const key = pairKey(review.entityAId, review.entityBId);
        if (review.decision === "dismissed") nextDismissed.add(key);
        if (review.decision === "merged") nextMerged.add(key);
      }
      setDismissed(nextDismissed);
      setMerged(nextMerged);
    } catch {
      // Candidate review remains usable if the persistence endpoint is unavailable.
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-hide toast after 3 s
  useEffect(() => {
    if (mergeState === "done" || mergeState === "error") {
      const t = setTimeout(() => setMergeState("idle"), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [mergeState]);

  const handleMerge = async (keepId: number, deleteId: number) => {
    const key = pairKey(keepId, deleteId);
    setMergeState("merging");
    setMergeMsg("Merging entities…");
    try {
      await apiFetch(`/api/entities/${keepId}/merge/${deleteId}`, { method: "POST" });
      await apiFetch("/api/entities/dedup-reviews", {
        method: "POST",
        body: JSON.stringify({
          entityAId: keepId,
          entityBId: deleteId,
          decision: "merged",
          keepEntityId: keepId,
        }),
      });
      setMerged(s => new Set([...s, key]));
      setMergeState("done");
      setMergeMsg("Merge complete — entity deleted, assets reassigned");
    } catch (e: any) {
      setMergeState("error");
      setMergeMsg(e?.message ?? "Merge failed");
    }
  };

  const handleDismiss = async (candidate: DuplicateCandidate) => {
    const key = pairKey(candidate.entityA.id, candidate.entityB.id);
    try {
      await apiFetch("/api/entities/dedup-reviews", {
        method: "POST",
        body: JSON.stringify({
          entityAId: candidate.entityA.id,
          entityBId: candidate.entityB.id,
          decision: "dismissed",
        }),
      });
      setDismissed(s => new Set([...s, key]));
    } catch (e: any) {
      setMergeState("error");
      setMergeMsg(e?.message ?? "Could not save review");
    }
  };

  const visible = candidates.filter(c => {
    const key = pairKey(c.entityA.id, c.entityB.id);
    return !dismissed.has(key) && !merged.has(key);
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-4 md:px-6 py-4 border-b border-border bg-card/50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base md:text-lg font-bold tracking-tight flex items-center gap-2">
              <Copy className="h-4 w-4 text-amber-400" />
              Duplicate Entity Review
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">
               {activeTab === "cross-registry"
                 ? `Name-token similarity · ${visible.length} candidate pair${visible.length !== 1 ? "s" : ""} remaining`
                 : `Exact names within one registry · ${sameSourceClusters.length} cluster${sameSourceClusters.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted hover:bg-muted/80 text-muted-foreground text-xs font-mono transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-shrink-0 flex items-center gap-1 px-4 md:px-6 pt-3 border-b border-border bg-card/30">
        <button
          onClick={() => setActiveTab("cross-registry")}
          className={cn(
            "px-3 py-2 text-xs font-mono border-b-2 transition-colors",
            activeTab === "cross-registry" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Cross-registry candidates
        </button>
        <button
          onClick={() => setActiveTab("same-source")}
          className={cn(
            "px-3 py-2 text-xs font-mono border-b-2 transition-colors",
            activeTab === "same-source" ? "border-sky-400 text-sky-300" : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Same-source clusters
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3">
        {activeTab === "cross-registry" && loading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            <span className="font-mono text-sm">Scanning name tokens across all entities…</span>
          </div>
        )}

        {activeTab === "cross-registry" && error && !loading && (
          <div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {activeTab === "cross-registry" && !loading && !error && candidates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-3" />
            <p className="text-sm font-medium text-foreground">No duplicate candidates found</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono">All entity names have distinct token signatures</p>
          </div>
        )}

        {activeTab === "cross-registry" && !loading && !error && candidates.length > 0 && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-3" />
            <p className="text-sm font-medium text-foreground">All {candidates.length} pairs reviewed</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {merged.size} merged · {dismissed.size} dismissed
            </p>
            <button onClick={load} className="mt-4 text-xs text-primary font-mono hover:underline">
              Refresh for new candidates
            </button>
          </div>
        )}

        {activeTab === "cross-registry" && !loading && !error && visible.length > 0 && (
          <>
            {/* Stats strip */}
            <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground pb-2 border-b border-border/50">
              <span>{candidates.length} total candidates</span>
              <span>·</span>
              <span className="text-emerald-400">{merged.size} merged this session</span>
              <span>·</span>
              <span>{dismissed.size} dismissed</span>
            </div>

            {visible.map(c => {
              const key = pairKey(c.entityA.id, c.entityB.id);
              return (
                <CandidateRow
                  key={key}
                  candidate={c}
                  dismissed={dismissed.has(key)}
                  onDismiss={() => handleDismiss(c)}
                  onMerge={handleMerge}
                />
              );
            })}
          </>
        )}

        {activeTab === "same-source" && sameSourceLoading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />
            <span className="font-mono text-sm">Scanning exact names within each registry…</span>
          </div>
        )}

        {activeTab === "same-source" && sameSourceError && !sameSourceLoading && (
          <div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {sameSourceError}
          </div>
        )}

        {activeTab === "same-source" && !sameSourceLoading && !sameSourceError && sameSourceClusters.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400 mb-3" />
            <p className="text-sm font-medium text-foreground">No same-source name clusters found</p>
            <p className="text-xs text-muted-foreground mt-1 font-mono">Exact names are unique within each registry</p>
          </div>
        )}

        {activeTab === "same-source" && !sameSourceLoading && !sameSourceError && sameSourceClusters.length > 0 && (
          <>
            <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground pb-2 border-b border-border/50">
              <span>{sameSourceClusters.length} clusters</span>
              <span>·</span>
              <span className="text-sky-300">Review before merging</span>
            </div>
            {sameSourceClusters.map(cluster => (
              <SameSourceClusterRow key={`${cluster.registry}:${cluster.name}`} cluster={cluster} />
            ))}
          </>
        )}
      </div>

      <MergeToast state={mergeState} message={mergeMsg} />
    </div>
  );
}
