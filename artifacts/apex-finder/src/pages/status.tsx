/**
 * System Status — AI key pools, databases, Upstash slots.
 * Auto-refreshes every 15 seconds.
 */
import { useEffect, useState, useCallback } from "react";
import {
  Activity, AlertCircle, CheckCircle2, Clock, Database,
  Layers, RefreshCw, Server, Wifi, WifiOff, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────

interface AIKeySlot {
  index: number;
  state: "active" | "rate_limited" | "missing";
  expiresAt: string | null;
}

interface AIKeyStatus {
  groq:       AIKeySlot[];
  perplexity: AIKeySlot[];
  gemini:     AIKeySlot[];
  tavily:     AIKeySlot[];
  exa:        AIKeySlot[];
}

interface OpenResearchStatus {
  state: "ready" | "incomplete" | "unavailable";
  huggingFace: { configured: boolean };
  serper: { configured: boolean };
  adapter: { available: boolean; model: string };
  mistral: { configured: boolean; model: string; rateLimit: string };
}

interface BureauReasoningStatus {
  configured: boolean;
  model: string;
  endpoint: string;
  role: "right_hand_advisor";
  capability: "case_file_reasoning_only";
}

interface GeminiBossStatus {
  configured: boolean;
  model: string;
  role: "head_investigator";
  capability: "text_generation_and_case_planning";
  webSearchGrounding: false;
}

interface UpstashSlot {
  slot: number;
  status: string;
  quotaExhausted: boolean;
  latencyMs?: number | null;
}

interface SystemStatus {
  ai: AIKeyStatus;
  openResearch?: OpenResearchStatus;
  bureauReasoning?: BureauReasoningStatus;
  geminiBoss?: GeminiBossStatus;
  databases: {
    postgres:   { status: "ok" | "error"; latencyMs: number | null };
    localRedis: { status: string;         latencyMs: number | null };
    upstash:    UpstashSlot[];
  };
  generatedAt: string;
  cached:      boolean;
  cachedAgoMs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<keyof AIKeyStatus, string> = {
  groq:       "Groq LLaMA",
  perplexity: "Perplexity",
  gemini:     "Gemini",
  tavily:     "Tavily",
  exa:        "Exa",
};

const OPEN_RESEARCH_LABELS = {
  ready: "ready",
  incomplete: "incomplete",
  unavailable: "unavailable",
} as const;

const PROVIDER_COLORS: Record<string, string> = {
  groq:       "from-orange-500/20 border-orange-500/30",
  perplexity: "from-blue-500/20 border-blue-500/30",
  gemini:     "from-purple-500/20 border-purple-500/30",
  tavily:     "from-cyan-500/20 border-cyan-500/30",
  exa:        "from-emerald-500/20 border-emerald-500/30",
};

function SlotDot({ slot }: { slot: AIKeySlot }) {
  return (
    <div className="group relative">
      <div className={cn(
        "h-4 w-4 rounded-full border transition-colors",
        slot.state === "active"    && "bg-primary border-primary shadow-[0_0_6px_rgba(132,204,22,0.5)]",
        slot.state === "rate_limited" && "bg-amber-500/80 border-amber-400 animate-pulse",
        slot.state === "missing"   && "bg-muted/30 border-muted/50",
      )} />
      {/* Tooltip */}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-[10px] font-mono text-muted-foreground opacity-0 shadow-lg group-hover:opacity-100 transition-opacity">
        Slot {slot.index + 1} — {slot.state}
        {slot.expiresAt && ` (resets ${new Date(slot.expiresAt).toLocaleTimeString()})`}
      </div>
    </div>
  );
}

function ProviderCard({ name, slots }: { name: keyof AIKeyStatus; slots: AIKeySlot[] }) {
  const active    = slots.filter(s => s.state === "active").length;
  const rateLimited = slots.filter(s => s.state === "rate_limited").length;
  const missing   = slots.filter(s => s.state === "missing").length;
  const configured = slots.filter(s => s.state !== "missing").length;

  return (
    <div className={cn(
      "rounded-xl border bg-gradient-to-br from-transparent to-transparent p-4 transition-colors",
      PROVIDER_COLORS[name] ?? "border-border",
      configured === 0 && "opacity-50",
    )}>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-foreground">
          {PROVIDER_LABELS[name]}
        </span>
        <span className={cn(
          "rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
          active > 0    ? "bg-primary/20 text-primary"       :
          rateLimited > 0 ? "bg-amber-500/20 text-amber-400"  :
                          "bg-muted/30 text-muted-foreground",
        )}>
          {active > 0 ? `${active} active` : rateLimited > 0 ? "cooling down" : "not configured"}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {slots.map(slot => <SlotDot key={slot.index} slot={slot} />)}
      </div>

      <div className="mt-2.5 flex gap-3 font-mono text-[10px] text-muted-foreground">
        <span className="text-primary">{active} active</span>
        {rateLimited > 0 && <span className="text-amber-400">{rateLimited} temporary cooldown</span>}
        {missing   > 0 && <span className="text-muted-foreground/60">{missing} unconfigured</span>}
      </div>
    </div>
  );
}

function DbRow({
  label, status, latency, icon: Icon,
}: {
  label: string;
  status: "ok" | "error" | "ready" | "connecting" | string;
  latency: number | null;
  icon: React.ElementType;
}) {
  const ok = status === "ok" || status === "ready";
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className={cn("h-4 w-4", ok ? "text-primary" : "text-destructive")} />
        <span className="font-mono text-[12px] text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        {latency !== null && (
          <span className="font-mono text-[11px] text-muted-foreground">{latency}ms</span>
        )}
        <span className={cn(
          "flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
          ok ? "bg-primary/15 text-primary" : "bg-destructive/15 text-destructive",
        )}>
          {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
          {ok ? "connected" : status}
        </span>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SystemStatusPage() {
  const [status,    setStatus]    = useState<SystemStatus | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/system/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStatus(data);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Fetch error");
    } finally {
      setLoading(false);
      setLastFetch(new Date());
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const aiProviders = status?.ai
    ? (Object.keys(status.ai) as Array<keyof AIKeyStatus>)
    : (["groq", "perplexity", "gemini", "tavily", "exa"] as Array<keyof AIKeyStatus>);

  const totalActive = status?.ai
    ? aiProviders.reduce((sum, k) => sum + (status.ai[k]?.filter(s => s.state === "active").length ?? 0), 0)
    : 0;

  const upstashSlots = status?.databases.upstash ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground/60">
            Infrastructure
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            System Status
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {lastFetch && (
            <span className="font-mono text-[10px] text-muted-foreground/60">
              Updated {lastFetch.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchStatus}
            className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Quick-glance banner */}
      {status && (
        <div className={cn(
          "flex items-center justify-between rounded-xl border px-5 py-3",
          totalActive > 0
            ? "border-primary/30 bg-primary/5"
            : "border-destructive/30 bg-destructive/5",
        )}>
          <div className="flex items-center gap-3">
            <div className={cn(
              "h-2.5 w-2.5 rounded-full",
              totalActive > 0 ? "bg-primary animate-pulse" : "bg-destructive",
            )} />
            <span className="font-mono text-[12px] font-semibold text-foreground">
              {totalActive > 0
                ? `${totalActive} AI key slots operational`
                : "No AI keys active"}
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            {status.cached ? `Cached (${Math.round(status.cachedAgoMs / 1000)}s ago)` : "Live"}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <span className="font-mono text-[12px] text-destructive">{error}</span>
        </div>
      )}

      {/* AI Key Pools */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">
            AI Engine Key Pools
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {aiProviders.map(key => (
            <ProviderCard
              key={key}
              name={key}
              slots={status?.ai[key] ?? []}
            />
          ))}
        </div>
        <p className="mt-2.5 font-mono text-[10px] text-muted-foreground/50">
          Hover a dot to see slot details. Temporary 429 cooldowns auto-recover after the provider's rate-limit window; configured keys are not account-credit claims.
        </p>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <Wifi className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">
            Open Research Lane
          </h2>
          <span className={cn(
            "ml-auto rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
            status?.openResearch?.state === "ready"
              ? "bg-primary/15 text-primary"
              : status?.openResearch?.state === "incomplete"
                ? "bg-amber-500/15 text-amber-400"
                : "bg-muted/30 text-muted-foreground",
          )}>
            {OPEN_RESEARCH_LABELS[status?.openResearch?.state ?? "unavailable"]}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { label: "Hugging Face model", configured: status?.openResearch?.huggingFace.configured ?? false },
            { label: "Serper live search", configured: status?.openResearch?.serper.configured ?? false },
            { label: "Mistral web search", configured: status?.openResearch?.mistral.configured ?? false },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between rounded-xl border border-border/60 bg-gradient-to-br from-primary/5 to-transparent px-4 py-3">
              <span className="font-mono text-[11px] text-foreground">{item.label}</span>
              <span className={cn("font-mono text-[10px] font-bold uppercase tracking-wider", item.configured ? "text-primary" : "text-muted-foreground")}>
                {item.configured ? "configured" : "missing"}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 rounded-lg border border-border/50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
            <span className="text-muted-foreground">Bounded smolagents adapter</span>
            <span className={status?.openResearch?.adapter.available ? "text-primary" : "text-muted-foreground"}>
              {status?.openResearch?.adapter.available ? "installed" : "unavailable"}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground/55">
            {status?.openResearch?.adapter.model ?? "Qwen/Qwen2.5-7B-Instruct"} · review-only, no direct promotion
          </div>
          <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground/55">
            {status?.openResearch?.mistral.configured
              ? `Mistral ${status.openResearch.mistral.model} · ${status.openResearch.mistral.rateLimit}`
              : "Mistral web search not configured"}
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-border/50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
            <span className="text-muted-foreground">Gemini Boss</span>
            <span className={status?.geminiBoss?.configured ? "text-primary" : "text-muted-foreground"}>
              {status?.geminiBoss?.configured ? "configured" : "missing"}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground/55">
            {status?.geminiBoss?.configured
              ? `${status.geminiBoss.model} · head investigator · text only · no web grounding`
              : "Gemini Boss text-planning model not configured"}
          </div>
        </div>
        <div className="mt-3 rounded-lg border border-border/50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
            <span className="text-muted-foreground">Boss's right-hand advisor</span>
            <span className={status?.bureauReasoning?.configured ? "text-primary" : "text-muted-foreground"}>
              {status?.bureauReasoning?.configured ? "configured" : "missing"}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground/55">
            {status?.bureauReasoning?.configured
              ? `${status.bureauReasoning.model} · advisory only · no web search`
              : "NVIDIA NIM right-hand advisor not configured"}
          </div>
        </div>
      </section>

      {/* Databases */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">
            Databases
          </h2>
        </div>
        <div className="space-y-2">
          <DbRow
            label="PostgreSQL"
            status={status?.databases.postgres.status ?? "—"}
            latency={status?.databases.postgres.latencyMs ?? null}
            icon={Server}
          />
          <DbRow
            label="Local Redis (cache)"
            status={status?.databases.localRedis.status ?? "—"}
            latency={status?.databases.localRedis.latencyMs ?? null}
            icon={Layers}
          />
        </div>
      </section>

      {/* Upstash Slots */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Wifi className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">
            Upstash Permanent Cache Slots
          </h2>
        </div>
        {upstashSlots.length === 0 ? (
          <p className="font-mono text-[12px] text-muted-foreground">No Upstash slots configured.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {upstashSlots.map((slot) => (
              <div
                key={slot.slot}
                className={cn(
                  "rounded-lg border px-3 py-3 text-center",
                  slot.quotaExhausted
                    ? "border-amber-500/30 bg-amber-500/5"
                    : slot.status === "ready"
                    ? "border-primary/30 bg-primary/5"
                    : "border-border bg-muted/10",
                )}
              >
                <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
                  Slot {slot.slot}
                </div>
                <div className="flex items-center justify-center gap-1.5">
                  {slot.quotaExhausted
                    ? <WifiOff className="h-3.5 w-3.5 text-amber-400" />
                    : slot.status === "ready"
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                    : <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  }
                  <span className={cn(
                    "font-mono text-[10px] font-bold uppercase",
                    slot.quotaExhausted ? "text-amber-400" :
                    slot.status === "ready" ? "text-primary" : "text-muted-foreground",
                  )}>
                    {slot.quotaExhausted ? "quota" : slot.status}
                  </span>
                </div>
                {typeof slot.latencyMs === "number" && slot.latencyMs !== null && (
                  <div className="mt-1 font-mono text-[9px] text-muted-foreground/50">{slot.latencyMs}ms</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 border-t border-border/40 pt-5 font-mono text-[10px] text-muted-foreground/60">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full bg-primary" /> Active — key operational
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full bg-amber-500" /> Temporary cooldown — provider returned 429 (auto-recovers)
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full border border-muted/50 bg-muted/20" /> Missing — secret not configured
        </div>
      </div>
    </div>
  );
}
