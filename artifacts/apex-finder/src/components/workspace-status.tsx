import { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, ChevronDown, ExternalLink, Loader2, Radio, ShieldCheck, XCircle } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { fetchSystemStatus, summarizeApiKeys, type SystemStatus } from "@/lib/system-status";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const POLL_INTERVAL_MS = 10_000;

type AtlasStatus = {
  status?: string;
  active?: boolean;
  message?: string;
  jobId?: string;
  atlasPhase?: number;
  atlasPhaseTotal?: number;
  progress?: number;
  scheduler?: {
    enabled?: boolean;
    active?: boolean;
    nextTriggerAt?: string;
    lastStatus?: string;
    lastMessage?: string;
    cycles?: number;
  } | null;
  phaseJ?: { status?: string; progress?: number; total?: number; message?: string } | null;
};

type WorkspaceState = "loading" | "researching" | "researching-degraded" | "queued" | "ready" | "degraded" | "offline";

const STATE_COPY: Record<WorkspaceState, {
  label: string;
  detail: string;
  className: string;
  dotClassName: string;
}> = {
  loading: {
    label: "CHECKING WORKSPACE",
    detail: "Reading Atlas and service telemetry…",
    className: "text-muted-foreground",
    dotClassName: "bg-muted-foreground/60",
  },
  researching: {
    label: "ATLAS RESEARCHING",
    detail: "Discovery and enrichment are active.",
    className: "text-cyan-300",
    dotClassName: "bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.7)]",
  },
  "researching-degraded": {
    label: "ATLAS ACTIVE",
    detail: "Discovery and enrichment are active; some provider slots are temporarily limited.",
    className: "text-amber-300",
    dotClassName: "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.55)]",
  },
  queued: {
    label: "ATLAS STANDBY",
    detail: "The next continuous research cycle is queued.",
    className: "text-amber-300",
    dotClassName: "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.55)]",
  },
  ready: {
    label: "WORKSPACE READY",
    detail: "Services are healthy and Atlas is ready for research.",
    className: "text-primary",
    dotClassName: "bg-primary shadow-[0_0_8px_rgba(96,165,250,0.65)]",
  },
  degraded: {
    label: "WORKSPACE DEGRADED",
    detail: "The app is reachable, but one or more research services need attention.",
    className: "text-amber-300",
    dotClassName: "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.55)]",
  },
  offline: {
    label: "WORKSPACE OFFLINE",
    detail: "The API telemetry endpoint could not be reached.",
    className: "text-destructive",
    dotClassName: "bg-destructive shadow-[0_0_8px_rgba(248,113,113,0.55)]",
  },
};

function formatNextCycle(timestamp?: string): string | null {
  if (!timestamp) return null;
  const remaining = Date.parse(timestamp) - Date.now();
  if (remaining <= 0) return "starting soon";
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  if (minutes < 1) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function phaseLabel(atlas: AtlasStatus | null): string {
  if (!atlas?.active) return "No active target";
  const phase = Number(atlas.atlasPhase ?? atlas.progress ?? 0);
  const total = Number(atlas.atlasPhaseTotal ?? 10);
  return `Phase ${phase}/${total}`;
}

export function WorkspaceStatus() {
  const [atlas, setAtlas] = useState<AtlasStatus | null>(null);
  const [system, setSystem] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    const refresh = async () => {
      const [atlasResult, systemResult] = await Promise.allSettled([
        fetch(`${BASE}/api/ingest/atlas-status`, { cache: "no-store", signal: controller.signal }),
        fetchSystemStatus(BASE, controller.signal),
      ]);
      if (!mounted) return;
      let nextError = true;
      if (atlasResult.status === "fulfilled" && atlasResult.value.ok) {
        setAtlas(await atlasResult.value.json() as AtlasStatus);
        nextError = false;
      }
      if (systemResult.status === "fulfilled") {
        setSystem(systemResult.value);
        nextError = false;
      }
      setError(nextError);
      setLoading(false);
    };
    refresh();
    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const summary = summarizeApiKeys(system);
  const upstashHealthy = Boolean(
    system?.databases.upstash.length &&
    system.databases.upstash.every((slot) => slot.status === "ready" || slot.status === "ok"),
  );
  const servicesHealthy = Boolean(
    system?.databases.postgres.status === "ok" &&
    (system?.databases.localRedis.status === "ready" || system?.databases.localRedis.status === "ok") &&
    upstashHealthy,
  );
  const active = Boolean(atlas?.active);
  const schedulerEnabled = Boolean(atlas?.scheduler?.enabled);
  const schedulerActive = Boolean(atlas?.scheduler?.active);
  const noAiCapacity = Boolean(system && summary.configured > 0 && summary.active === 0);
  const providerDegraded = summary.rateLimited > 0;
  const state: WorkspaceState = loading && !atlas && !system
    ? "loading"
    : error && !atlas && !system
      ? "offline"
      : active
        ? noAiCapacity || !servicesHealthy ? "degraded" : providerDegraded ? "researching-degraded" : "researching"
        : schedulerEnabled && schedulerActive
          ? "queued"
          : noAiCapacity || !servicesHealthy || providerDegraded
            ? "degraded"
            : "ready";
  const copy = STATE_COPY[state];
  const Icon = state === "researching" || state === "researching-degraded"
    ? Radio
    : state === "degraded"
      ? AlertTriangle
      : state === "offline"
        ? XCircle
        : state === "loading"
          ? Loader2
          : state === "queued"
            ? Activity
            : ShieldCheck;
  const nextCycle = formatNextCycle(atlas?.scheduler?.nextTriggerAt);
  const refreshedNow = now;
  const persistentRedisTotal = system?.databases.upstash.length ?? 0;
  const persistentRedisHealthy = system?.databases.upstash.filter(
    (slot) => slot.status === "ready" || slot.status === "ok",
  ).length ?? 0;
  const databaseState = !system
    ? "DB —"
    : persistentRedisTotal > 0
      ? `DB ${persistentRedisHealthy}/${persistentRedisTotal}`
      : servicesHealthy
        ? "DB OK"
        : "DB !";
  const databaseDetail = !system
    ? "Database status is still loading."
    : `PostgreSQL and local Redis are ${servicesHealthy ? "healthy" : "available"}; persistent Redis capacity is ${persistentRedisHealthy}/${persistentRedisTotal || "—"} slots healthy.`;
  const openResearchReady = system?.openResearch?.state === "ready";
  const openResearchState = system?.openResearch?.state === "incomplete" ? "INCOMPLETE" : openResearchReady ? "READY" : "UNAVAILABLE";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="workspace-status-panel"
        aria-label={`${copy.label}. Open whole workspace status.`}
        data-testid="button-workspace-status"
        className={cn(
          "group flex h-9 max-w-[230px] items-center gap-2 rounded-lg border px-2.5 transition-colors sm:px-3",
          "border-border/70 bg-background/70 hover:border-primary/40 hover:bg-muted/50",
          (state === "degraded" || state === "researching-degraded" || state === "offline") && "border-amber-500/30",
        )}
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", copy.dotClassName, state === "researching" && "animate-pulse")} />
        <Icon className={cn("h-3.5 w-3.5 shrink-0", copy.className, state === "loading" && "animate-spin")} />
        <span className={cn("hidden truncate font-mono text-[10px] font-bold tracking-[0.1em] sm:inline", copy.className)}>
          {copy.label}
        </span>
        <span className={cn("font-mono text-[10px] font-bold sm:hidden", servicesHealthy ? "text-primary" : copy.className)}>
          {databaseState}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          id="workspace-status-panel"
          role="dialog"
          aria-label="Whole workspace status"
          className="fixed left-2 right-2 top-[4.5rem] z-50 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-xl border border-border bg-popover p-4 shadow-2xl shadow-black/50 backdrop-blur-xl sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+0.5rem)] sm:max-h-none sm:w-[min(390px,calc(100vw-2rem))]"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border/60 pb-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <div className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted/70", copy.className)}>
                <Icon className={cn("h-3.5 w-3.5", state === "loading" && "animate-spin")} />
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">Whole workspace</div>
                <div className={cn("mt-1 font-mono text-[12px] font-bold tracking-wide", copy.className)}>{copy.label}</div>
                <p className="mt-1 max-w-[260px] text-[11px] leading-4 text-muted-foreground">{copy.detail}</p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className={cn("font-mono text-xl font-bold", copy.className)}>
                {active ? phaseLabel(atlas) : schedulerEnabled ? "AUTO" : "—"}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
                {active ? "current operation" : schedulerEnabled ? "continuous cycle" : "atlas state"}
              </div>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">Research engine</span>
                  <span className={cn("font-mono text-[10px] font-bold", active ? (providerDegraded ? "text-amber-300" : "text-cyan-300") : schedulerEnabled ? "text-amber-300" : "text-muted-foreground")}>
                  {active ? (providerDegraded ? "ACTIVE · PARTIAL COVERAGE" : "DISCOVERING + ENRICHING") : schedulerEnabled ? "QUEUED" : "READY"}
                </span>
              </div>
              <div className="mt-1 truncate text-[11px] text-foreground/80">
                {active ? atlas?.message || atlas?.phaseJ?.message || "Processing the current target…" : nextCycle ? `Next cycle in ${nextCycle}` : atlas?.message || "No active Atlas target"}
              </div>
              {active && atlas?.jobId && <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground/50">run {atlas.jobId}</div>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border/60 px-3 py-2">
                <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/55">Services</div>
                <div className={cn("mt-1 font-mono text-[11px] font-bold", servicesHealthy ? "text-primary" : "text-amber-300")}>
                  {servicesHealthy ? "API · DB · REDIS OK" : "ATTENTION NEEDED"}
                </div>
              </div>
              <div className="rounded-lg border border-border/60 px-3 py-2">
                <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/55">AI capacity</div>
                <div className={cn("mt-1 font-mono text-[11px] font-bold", summary.active > 0 ? "text-primary" : "text-amber-300")}>
                  WEB {summary.active}/{summary.configured || "—"}
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">Database / persistence</span>
                <span className={cn("font-mono text-[10px] font-bold", servicesHealthy ? "text-primary" : "text-amber-300")}>
                  {databaseState}
                </span>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-foreground/80">{databaseDetail}</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">Open Research</span>
                <span className={cn(
                  "font-mono text-[10px] font-bold",
                  openResearchReady ? "text-primary" : system?.openResearch?.state === "incomplete" ? "text-amber-300" : "text-muted-foreground",
                )}>
                  {openResearchState}
                </span>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-foreground/80">
                Hugging Face model + Serper search · review-only
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/55">
              {atlas?.scheduler?.cycles ? `${atlas.scheduler.cycles} cycles · live poll` : `Updated ${new Date(refreshedNow).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
            </div>
            <div className="flex items-center gap-1">
              <Link href="/reactor" onClick={() => setOpen(false)} data-testid="link-workspace-reactor" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary hover:bg-primary/10">
                Reactor <ExternalLink className="h-3 w-3" />
              </Link>
              <Link href="/status" onClick={() => setOpen(false)} data-testid="link-workspace-status" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted">
                Details
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}