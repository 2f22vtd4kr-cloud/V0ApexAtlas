import React from "react";
import { RefreshCw, Target, Cpu, Eye, Radio, GitMerge, Search, Globe, Users, Brain, MapPin, Building2, Server, Key, ChevronDown } from "lucide-react";
import LiquidGlass from "liquid-glass-react";

interface ResearchSession {
  id: number;
  targetEntityName: string | null;
  winningPath: string | null;
  generatedPitch: string | null;
  crmStatus: string;
  bayesianScoreAtRuntime: number | null;
  pathScore: number | null;
  createdAt: string;
}

interface AtlasTelemetry {
  stage: string;
  status: "active" | "complete" | "blocked" | "review";
  targetName?: string;
  targetType?: string;
  toolIds: string[];
  activeToolId?: string;
  prompt?: string;
  inputSummary?: string;
  resultSummary?: string;
  sources?: number;
  evidence?: number;
  contacts?: number;
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
  exhaustedKeys: string[];
}

const MOBILE_PHASES = [
  { id: "input", label: "TARGET ACQUISITION", detail: "Target becomes a research brief", nodeIds: ["target"] },
  { id: "registries", label: "PUBLIC REGISTRIES", detail: "Public records establish the evidence base", nodeIds: ["faa", "edgar", "hmlr", "ch", "hnwi", "occrp", "brreg", "whoxy"] },
  { id: "discovery", label: "BROAD DISCOVERY", detail: "Open sources expand identity and activity", nodeIds: ["inhouse", "webdisc", "deepweb", "opensky", "maigret"] },
  { id: "ai_layer", label: "AI EXTRACTION", detail: "Search, extraction, and adaptive follow-up", nodeIds: ["perp0", "exa", "tavily", "gemini", "groq", "perpfu"] },
  { id: "synthesis", label: "VECTOR SYNTHESIS", detail: "Evidence becomes vectors and priority", nodeIds: ["semantic", "bayesian"] },
  { id: "core", label: "REACTOR CORE", detail: "Relationships and paths are evaluated", nodeIds: ["graph", "mcts", "prac"] },
  { id: "output", label: "OUTPUT GENERATION", detail: "A research-ready outreach sequence", nodeIds: ["pitch"] },
];

function QuickStat({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="flex flex-col gap-1 p-2 rounded bg-white/[0.02] border border-white/5 flex-1 min-w-0">
      <span className="text-[9px] uppercase tracking-widest text-slate-500 truncate">{label}</span>
      <span className="text-base font-bold tabular-nums" style={{ color }}>{value}</span>
    </div>
  );
}

function StatBadge({ label, value }: { label: string; value?: number }) {
  if (value === undefined) return null;
  return (
    <div className="flex flex-col">
      <span className="text-[9px] uppercase tracking-widest text-slate-500 mb-0.5">{label}</span>
      <span className="text-sm font-bold text-white tabular-nums">{value}</span>
    </div>
  );
}

function LiquidGlassInspector({ telemetry }: { telemetry: AtlasTelemetry }) {
  const inspector = (
    <div className="mt-4 p-5 rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl relative overflow-hidden transition-all duration-500">
      {/* Glossy top edge highlight */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-50" />
      
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 bg-cyan-400 rounded-full animate-ping opacity-30" />
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_12px_theme(colors.cyan.400)] relative z-10" />
        </div>
        <span className="text-cyan-400 text-[11px] uppercase tracking-[0.2em] font-bold font-mono">
          {telemetry.stage}
          {telemetry.status && <span className="text-cyan-400/60 ml-2">· {telemetry.status}</span>}
        </span>
      </div>

      {telemetry.targetName && (
        <div className="mb-5">
          <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-1.5">Target Identity</div>
          <div className="text-slate-200 text-[15px] font-semibold tracking-wide flex items-center gap-2">
            <Target className="w-4 h-4 text-cyan-500/70" />
            {telemetry.targetName}
          </div>
          {telemetry.targetType && (
            <div className="text-slate-500 text-xs mt-1 pl-6">{telemetry.targetType}</div>
          )}
        </div>
      )}

      {telemetry.toolIds && telemetry.toolIds.length > 0 && (
        <div className="mb-5">
          <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-2.5">Tool Matrix</div>
          <div className="flex flex-wrap gap-2">
            {telemetry.toolIds.map((tool) => {
              const isActive = tool === telemetry.activeToolId;
              return (
                <div
                  key={tool}
                  className={`px-2.5 py-1.5 rounded-md border text-[11px] font-mono tracking-wide transition-all duration-300 flex items-center gap-1.5
                    ${isActive 
                      ? 'border-cyan-400/40 bg-cyan-950/40 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.15)] ring-1 ring-cyan-400/20' 
                      : 'border-white/5 bg-white/[0.02] text-slate-400 opacity-70'}`}
                >
                  <Cpu className="w-3 h-3" />
                  {tool}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(telemetry.prompt || telemetry.inputSummary) && (
        <div className="mb-5">
          <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-2">Context Payload</div>
          <div className="text-[11px] leading-relaxed text-slate-300 font-mono bg-black/60 p-3 rounded-lg border border-white/[0.04] max-h-32 overflow-y-auto">
            {telemetry.prompt || telemetry.inputSummary}
          </div>
        </div>
      )}
      
      {telemetry.resultSummary && (
        <div className="mb-5">
          <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-2">Result Vector</div>
          <div className="text-[12px] leading-relaxed text-slate-300 border-l-2 border-emerald-500/50 pl-3">
            {telemetry.resultSummary}
          </div>
        </div>
      )}

      {(telemetry.sources !== undefined || telemetry.evidence !== undefined || telemetry.contacts !== undefined) && (
        <div className="flex gap-6 border-t border-white/5 pt-4 mt-2">
          <StatBadge label="Sources" value={telemetry.sources} />
          <StatBadge label="Evidence" value={telemetry.evidence} />
          <StatBadge label="Contacts" value={telemetry.contacts} />
        </div>
      )}
    </div>
  );
  return (
    <LiquidGlass
      mode="shader"
      blurAmount={0.12}
      saturation={1.15}
      aberrationIntensity={1.5}
      elasticity={0.15}
      cornerRadius={14}
      padding="0px"
      style={{ display: "block", width: "100%" }}
    >
      {inspector}
    </LiquidGlass>
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
    exhaustedKeys,
    livePhaseDetail,
  } = props;

  const isLive = liveNodes.size > 0 || Boolean(atlasState && atlasState.runStatus !== "done");

  // Determine active phase based on liveNodes. Scan backwards to find the deepest active phase.
  let activePhaseIndex = -1;
  if (isLive) {
    for (let i = MOBILE_PHASES.length - 1; i >= 0; i--) {
      if (MOBILE_PHASES[i].nodeIds.some(id => liveNodes.has(id))) {
        activePhaseIndex = i;
        break;
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b1120] text-slate-200 overflow-hidden font-sans">
      {/* The global mobile shell already identifies this page. Keep only the
          reactor status and stats here so the title/logo are not repeated. */}
      <header className="px-5 py-3 border-b border-white/10 bg-black/20 backdrop-blur-md shrink-0 z-10">
        <div className="flex items-center justify-end mb-3">
          <div className={`px-2.5 py-1 rounded text-[9px] font-bold tracking-widest uppercase border flex items-center gap-1.5
            ${isLive ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-400' : 'border-lime-400/30 bg-lime-400/10 text-lime-400'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-cyan-400 animate-ping' : 'bg-lime-400'}`} />
            {isLive ? 'Active' : 'Nominal'}
          </div>
        </div>
        <div
          className={`mb-3 text-right text-[10px] font-mono tracking-wide ${isLive ? "text-cyan-400/80" : "text-slate-500"}`}
          role="status"
        >
          {isLive
            ? (liveLabel || livePhaseDetail || "Live Atlas research in progress")
            : "Standby · Atlas is idle by design — no research run in progress"}
        </div>
        {/* Quick Stats Grid */}
        <div className="flex gap-2">
          <QuickStat label="Entities" value={totalEntities} color="#38bdf8" />
          <QuickStat label="Hot Leads" value={hotCount} color="#a3e635" />
          <QuickStat label="Assets" value={totalAssets} color="#22d3ee" />
          <QuickStat label="Sessions" value={sessions.length} color="#a78bfa" />
        </div>
      </header>

      {/* Main Flow Area */}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-8 relative atlas-grid"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="max-w-md mx-auto relative">
          
          {/* Vertical line connecting phases */}
          <div className="absolute left-[15px] top-4 bottom-8 w-px bg-gradient-to-b from-cyan-500/50 via-white/10 to-transparent" />
          
          {MOBILE_PHASES.map((phase, i) => {
            const isActive = isLive && i === activePhaseIndex;
            const isCompleted = isLive && i < activePhaseIndex;
            const isUpcoming = !isLive || i > activePhaseIndex;

            return (
              <div key={phase.id} className="relative pl-12 mb-10 last:mb-0">
                {/* Dot */}
                <div className={`absolute left-0 top-1 w-[31px] h-[31px] rounded-full border-2 flex items-center justify-center bg-[#0b1120] transition-colors duration-500 z-10
                  ${isActive ? 'border-cyan-400 text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.4)]' : 
                    isCompleted ? 'border-emerald-500 text-emerald-500' : 'border-slate-800 text-slate-700'}`}>
                  {isActive ? (
                    <div className="w-2.5 h-2.5 bg-cyan-400 rounded-full animate-pulse" />
                  ) : isCompleted ? (
                    <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                  ) : (
                    <div className="w-1.5 h-1.5 bg-slate-800 rounded-full" />
                  )}
                </div>

                {/* Directional arrow below the dot (except for the last phase) */}
                {i < MOBILE_PHASES.length - 1 && (
                  <div className="absolute left-[9.5px] top-[38px] text-white/20 z-10">
                    <ChevronDown className="w-3 h-3" />
                  </div>
                )}

                {/* Phase Info */}
                <div className="pt-1">
                  <div className={`text-[11px] font-bold tracking-[0.15em] mb-1 transition-colors duration-500
                    ${isActive ? 'text-cyan-400' : isCompleted ? 'text-emerald-500/80' : 'text-slate-300/80'}`}>
                    {phase.label}
                  </div>
                   <div className={`text-xs transition-colors duration-500 ${isActive ? 'text-slate-300' : 'text-slate-400'}`}>
                    {phase.detail}
                  </div>

                  {/* Render Liquid Glass Inspector if this is the active phase */}
                  {isActive && (
                    <div className="mt-2 animate-in slide-in-from-top-4 fade-in duration-500">
                      {atlasState?.atlasTelemetry ? (
                        <LiquidGlassInspector telemetry={atlasState.atlasTelemetry} />
                      ) : (
                        <div className="mt-4 p-4 rounded-lg border border-white/5 bg-white/[0.02] text-xs text-slate-400 font-mono italic">
                          <span className="text-cyan-500/50 mr-2">▶</span>
                          {livePhaseDetail || "Awaiting target telemetry payload..."}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Footer Alerts */}
      {exhaustedKeys.length > 0 && (
        <div className="shrink-0 bg-rose-950/30 border-t border-rose-900/50 px-5 py-3">
          <div className="flex items-center gap-2 text-rose-400 text-[10px] font-bold tracking-wider uppercase">
            <Key className="w-3.5 h-3.5" />
            Exhausted API Keys: {exhaustedKeys.join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}
