import { useState, useRef, useEffect } from "react";
import {
  useListResearchSessions,
  useUpdateResearchStatus,
  useGeneratePitch,
} from "@workspace/api-client-react";
import { ScoreBadge } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  FileText, UserCircle, ChevronRight, Copy, AlertTriangle,
  MessageSquare, Clock, Users, Shield, Target,
  ChevronDown, Zap, Printer, CalendarDays, StickyNote, Check,
} from "lucide-react";
import { format } from "date-fns";

const CRM_COLUMNS = [
  "Lead Gen",
  "Identified",
  "Graph Mapped",
  "Research Path Found",
  "Pitch Generated",
  "Contacted",
  "Follow-Up",
  "Closed",
];

const STAGE_COLORS: Record<string, string> = {
  "Lead Gen": "#475569",
  "Identified": "#64748B",
  "Graph Mapped": "#3B82F6",
  "Research Path Found": "#A855F7",
  "Pitch Generated": "#F59E0B",
  "Contacted": "#10B981",
  "Follow-Up": "#F97316",
  "Closed": "#10B981",
};

// ── Pitch sequence display with tab switching ─────────────────────────────────

interface PitchSequence {
  initial: string;
  followUp: string;
  introScript: string;
}

function PitchSequenceDisplay({ pitch }: { pitch: string }) {
  const [activeTab, setActiveTab] = useState<keyof PitchSequence>("initial");

  let sequence: PitchSequence | null = null;
  try {
    sequence = JSON.parse(pitch) as PitchSequence;
    if (!sequence.initial) sequence = null;
  } catch {
    sequence = null;
  }

  if (!sequence) {
    return (
      <div className="relative group">
        <pre className="text-xs font-mono text-foreground bg-muted p-4 rounded border border-border whitespace-pre-wrap max-h-72 overflow-y-auto">
          {pitch}
        </pre>
        <button
          className="absolute top-2 right-2 p-1.5 bg-card border border-border rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"
          onClick={() => navigator.clipboard.writeText(pitch)}
        >
          <Copy className="w-3 h-3" />
        </button>
      </div>
    );
  }

  const tabs: { key: keyof PitchSequence; label: string; icon: React.ElementType; color: string }[] = [
    { key: "initial", label: "Initial", icon: MessageSquare, color: "text-primary" },
    { key: "followUp", label: "Follow-Up", icon: Clock, color: "text-amber-400" },
    { key: "introScript", label: "Intro Script", icon: Users, color: "text-secondary" },
  ];

  const activeContent = sequence[activeTab];

  return (
    <div className="space-y-2">
      <div className="flex space-x-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center space-x-1 px-2.5 py-1 rounded text-xs font-mono border transition-colors",
              activeTab === tab.key
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-border/60 hover:text-foreground"
            )}
          >
            <tab.icon className="w-3 h-3" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="relative group">
        <pre className="text-xs font-mono text-foreground bg-muted p-4 rounded border border-border whitespace-pre-wrap max-h-72 overflow-y-auto leading-relaxed">
          {activeContent}
        </pre>
        <button
          className="absolute top-2 right-2 p-1.5 bg-card border border-border rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"
          onClick={() => navigator.clipboard.writeText(activeContent ?? "")}
        >
          <Copy className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Approach vector (winning path) renderer ───────────────────────────────────

function WinningPathDisplay({ raw }: { raw: string }) {
  let path: any[] = [];
  try {
    path = JSON.parse(raw);
  } catch {
    return <div className="text-xs text-muted-foreground italic">Unable to parse path data.</div>;
  }

  if (!path.length) {
    return <div className="text-xs text-muted-foreground italic">No path recorded.</div>;
  }

  return (
    <div className="space-y-1.5">
      {path.map((node: any, i: number) => (
        <div
          key={i}
          className={cn(
            "flex items-start p-2.5 rounded border text-xs font-mono",
            node.role === "GATEKEEPER"
              ? "border-amber-500/30 bg-amber-500/5 text-amber-400"
              : node.role === "TARGET"
              ? "border-primary/30 bg-primary/5 text-primary"
              : node.role === "ASSET"
              ? "border-secondary/30 bg-secondary/5 text-secondary"
              : "border-border bg-muted/10 text-muted-foreground"
          )}
        >
          <div className="flex items-center mr-2 mt-0.5 flex-shrink-0">
            {node.role === "TARGET" ? (
              <Target className="w-3 h-3" />
            ) : node.role === "GATEKEEPER" ? (
              <Shield className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-[9px] uppercase tracking-widest opacity-50 mb-0.5">{node.role}</div>
            <div className="font-bold text-foreground leading-tight">{node.label}</div>
            {node.nodeType && <div className="text-xs opacity-50 mt-0.5">{node.nodeType}</div>}
            {node.actionRequired && (
              <div className="text-xs opacity-70 mt-1 leading-snug">{node.actionRequired}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Mobile session accordion card ─────────────────────────────────────────────

function MobileSessionCard({
  session,
  expanded,
  onToggle,
  onGeneratePitch,
  generatingId,
  moveCard,
}: {
  session: any;
  expanded: boolean;
  onToggle: () => void;
  onGeneratePitch: (id: number) => void;
  generatingId: number | null;
  moveCard: (id: number, status: string, dir: 1 | -1) => void;
}) {
  const stageColor = STAGE_COLORS[session.crmStatus] ?? "#64748B";

  return (
    <div className="border-b border-border last:border-0">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3"
      >
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-foreground truncate mb-1">
            {session.targetEntityName ?? "Unknown Target"}
          </div>
          <span
            className="text-xs font-mono font-bold px-1.5 py-0.5 rounded"
            style={{ color: stageColor, backgroundColor: stageColor + "18" }}
          >
            {session.crmStatus.toUpperCase()}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <ScoreBadge score={session.bayesianScoreAtRuntime} />
          {session.createdAt && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              {format(new Date(session.createdAt), "MM/dd")}
            </span>
          )}
        </div>
        <ChevronDown
          className="w-4 h-4 text-muted-foreground flex-shrink-0 transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : undefined }}
        />
      </button>

      {expanded && (
        <div className="mx-4 mb-3 rounded border border-border bg-muted/10 overflow-hidden">
          {/* Stage progress chips */}
          <div className="px-3 py-2.5 border-b border-border">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Pipeline</div>
            <div className="flex gap-1 flex-wrap">
              {CRM_COLUMNS.map((col) => {
                const idx = CRM_COLUMNS.indexOf(col);
                const cur = CRM_COLUMNS.indexOf(session.crmStatus);
                const isCurrent = idx === cur;
                const isPast = idx < cur;
                const c = isCurrent ? stageColor : isPast ? "#334155" : "#1E293B";
                return (
                  <span
                    key={col}
                    className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold"
                    style={{
                      color: isCurrent ? stageColor : isPast ? "#64748B" : "#334155",
                      backgroundColor: c + (isCurrent ? "22" : "33"),
                      border: `1px solid ${c}44`,
                    }}
                  >
                    {col.replace(" ", "\u00A0")}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Approach vector */}
          {session.winningPath && (
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Approach Vector</div>
              <WinningPathDisplay raw={session.winningPath} />
            </div>
          )}

          {/* Move stage */}
          <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Move Stage</span>
            <div className="flex gap-2">
              <button
                disabled={CRM_COLUMNS.indexOf(session.crmStatus) === 0}
                onClick={() => moveCard(session.id, session.crmStatus, -1)}
                className="w-7 h-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-primary disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>
              <button
                disabled={CRM_COLUMNS.indexOf(session.crmStatus) === CRM_COLUMNS.length - 1}
                onClick={() => moveCard(session.id, session.crmStatus, 1)}
                className="w-7 h-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-primary disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="px-3 py-2.5 flex gap-2">
            {!session.generatedPitch && (
              <button
                onClick={() => onGeneratePitch(session.id)}
                disabled={generatingId === session.id}
                className="flex-1 py-2 rounded text-[11px] font-mono font-bold flex items-center justify-center gap-1 border border-amber-500/30 bg-amber-500/8 text-amber-500 disabled:opacity-50 transition-colors"
              >
                <Zap className="w-3 h-3" />
                {generatingId === session.id ? "GENERATING..." : "GEN PITCH"}
              </button>
            )}
          </div>

          {/* Pitch display */}
          {session.generatedPitch && (
            <div className="px-3 pb-3">
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Outreach Sequence</div>
              <PitchSequenceDisplay pitch={session.generatedPitch} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main CRM component ────────────────────────────────────────────────────────

export default function PipelineCRM() {
  const { data: sessions, refetch } = useListResearchSessions();
  const updateStatus = useUpdateResearchStatus();
  const generatePitch = useGeneratePitch();

  const [selectedSession, setSelectedSession] = useState<any>(null);

  // Mobile state
  const [mobileExpandedId, setMobileExpandedId] = useState<number | null>(null);
  
  const activeStages = CRM_COLUMNS.filter((col) => sessions?.some((s) => s.crmStatus === col));
  const [selectedStage, setSelectedStage] = useState<string>(CRM_COLUMNS[0]);
  
  useEffect(() => {
    if (sessions && selectedStage === CRM_COLUMNS[0] && activeStages.length > 0 && !activeStages.includes(CRM_COLUMNS[0])) {
      setSelectedStage(activeStages[0]);
    }
  }, [sessions, selectedStage]);

  const [generatingId, setGeneratingId] = useState<number | null>(null);

  // Notes + follow-up date state
  const [notesValue, setNotesValue] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When selected session changes, pre-fill notes + followUpDate
  const selectSession = (s: any) => {
    setSelectedSession(s);
    setNotesValue(s?.notes ?? "");
    setFollowUpDate(s?.followUpDate ?? "");
    setNotesSaved(false);
  };

  const saveNotesAndDate = async (sessionId: number, notes: string, date: string) => {
    setNotesSaving(true);
    try {
      const base = (import.meta as any).env.BASE_URL.replace(/\/$/, "");
      await fetch(`${base}/api/research/sessions/${sessionId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crmStatus: selectedSession?.crmStatus ?? "Lead Gen", notes, followUpDate: date || null }),
      });
      setNotesSaved(true);
      if (notesTimer.current) clearTimeout(notesTimer.current);
      notesTimer.current = setTimeout(() => setNotesSaved(false), 2500);
      refetch();
    } finally {
      setNotesSaving(false);
    }
  };

  const moveCard = (sessionId: number, currentStatus: string, direction: 1 | -1) => {
    const currentIndex = CRM_COLUMNS.indexOf(currentStatus);
    const newIndex = currentIndex + direction;
    if (newIndex >= 0 && newIndex < CRM_COLUMNS.length) {
      updateStatus.mutate(
        { id: sessionId, data: { crmStatus: CRM_COLUMNS[newIndex] } },
        { onSuccess: () => refetch() }
      );
    }
  };

  const handleGeneratePitch = (id: number) => {
    setGeneratingId(id);
    generatePitch.mutate({ id }, {
      onSuccess: () => { refetch(); setGeneratingId(null); },
      onError: () => setGeneratingId(null),
    });
  };

  // Unique stages that have sessions
  const mobileSessions = sessions?.filter((s) => s.crmStatus === selectedStage) || [];

  // Auto-scroll desktop kanban to first populated column
  const kanbanRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sessions?.length || !kanbanRef.current) return;
    const firstPopulatedIdx = CRM_COLUMNS.findIndex((col) => sessions.some((s) => s.crmStatus === col));
    if (firstPopulatedIdx <= 0) return;
    // Each column is ~200px + gap 16px = 216px per column
    kanbanRef.current.scrollLeft = firstPopulatedIdx * 216;
  }, [sessions]);

  // Stage counts for summary strip
  const stageCounts = CRM_COLUMNS.map((col) => ({
    col,
    count: sessions?.filter((s) => s.crmStatus === col).length ?? 0,
  }));

  return (
    <div className="flex h-full flex-col overflow-hidden relative">
      <div className="px-4 md:px-6 py-3 border-b border-border bg-card flex-shrink-0 flex items-center justify-between">
        <h1 className="text-base md:text-xl font-bold font-mono tracking-widest text-foreground uppercase">
          Pipeline CRM
        </h1>
        <span className="text-xs font-mono text-muted-foreground">
          {sessions?.length ?? 0} sessions
        </span>
      </div>

      {/* ── Stage summary strip (desktop) ── */}
      <div className="relative hidden md:block border-b border-border bg-card/50 flex-shrink-0">
        <div className="flex px-4 py-2 gap-2 overflow-x-auto pb-px">
          {stageCounts.map(({ col, count }) => {
            const color = STAGE_COLORS[col] ?? "#64748B";
            const hasData = count > 0;
            return (
              <button
                key={col}
                onClick={() => {
                  const idx = CRM_COLUMNS.indexOf(col);
                  if (kanbanRef.current) kanbanRef.current.scrollLeft = idx * 336;
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-bold uppercase tracking-wide border transition-all flex-shrink-0"
                style={{
                  borderColor: hasData ? color : color + "30",
                  color: hasData ? color : color + "60",
                  backgroundColor: hasData ? color + "15" : "transparent",
                }}
              >
                {col}
                {hasData && (
                  <span
                    className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: color, color: "#000" }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none z-10" />
      </div>

      {/* ── Mobile: stage filter chips + accordion list ── */}
      <div className="flex flex-col flex-1 overflow-hidden md:hidden">
        {/* Stage filter chips */}
        <div className="relative border-b border-border flex-shrink-0">
          <div className="px-4 py-2.5 overflow-x-auto pb-px">
            <div className="flex gap-2 min-w-max">
              {CRM_COLUMNS.map((stage) => {
                const c = STAGE_COLORS[stage] ?? "#64748B";
                const isSelected = selectedStage === stage;
                return (
                  <button
                    key={stage}
                    onClick={() => setSelectedStage(stage)}
                    className="px-3 py-1.5 rounded-full text-xs font-mono font-bold uppercase tracking-wide whitespace-nowrap transition-all"
                    style={{
                      backgroundColor: isSelected ? c : c + "18",
                      color: isSelected ? "#000" : c,
                      border: `1px solid ${c}44`,
                    }}
                  >
                    {stage}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-background to-transparent pointer-events-none z-10" />
        </div>

        {/* Accordion session list */}
        <div className="flex-1 overflow-y-auto bg-background divide-y divide-border">
          {mobileSessions?.map((session) => (
            <MobileSessionCard
              key={session.id}
              session={session}
              expanded={mobileExpandedId === session.id}
              onToggle={() => setMobileExpandedId(mobileExpandedId === session.id ? null : session.id)}
              onGeneratePitch={handleGeneratePitch}
              generatingId={generatingId}
              moveCard={moveCard}
            />
          ))}
          {(!mobileSessions || mobileSessions.length === 0) && (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-6">
              <div className="text-muted-foreground text-sm font-mono">No sessions in this stage.</div>
              <a href="/research" className="text-[11px] font-mono text-primary border border-primary/30 px-3 py-1.5 rounded hover:bg-primary/10 transition-colors">
                → Run Intel Analysis
              </a>
            </div>
          )}
        </div>
      </div>

      {/* ── Desktop: Kanban Board ── */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        <div className="flex h-full p-4 gap-3 overflow-x-auto">
          {CRM_COLUMNS.map((column) => {
            const columnSessions = sessions?.filter((s) => s.crmStatus === column) ?? [];

            return (
              <div
                key={column}
                className="min-w-[240px] w-[240px] flex-shrink-0 flex flex-col h-full bg-muted/10 border border-border rounded-lg shadow-sm"
              >
                <div className="p-3 border-b border-border flex justify-between items-center bg-card rounded-t-lg flex-shrink-0">
                  <h3 className="font-mono text-[11px] font-bold text-foreground uppercase tracking-wider">
                    {column}
                  </h3>
                  <span className="text-[10px] bg-muted/50 border border-border/50 text-muted-foreground px-2 py-0.5 rounded font-mono">
                    {columnSessions.length}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {columnSessions.length === 0 && column === "Lead Gen" && (
                    <div className="flex flex-col items-center justify-center h-32 gap-2 text-center border border-dashed border-border/60 rounded bg-muted/5">
                      <p className="text-xs font-mono text-muted-foreground/50">No leads yet</p>
                      <a
                        href="/research"
                        className="text-xs font-mono text-primary border border-primary/20 px-2.5 py-1 rounded hover:bg-primary/10 transition-colors"
                      >
                        → Run Intel Analysis
                      </a>
                    </div>
                  )}
                  {columnSessions.length === 0 && column !== "Lead Gen" && (
                    <div className="flex flex-col items-center justify-center h-24 border border-dashed border-border/60 rounded bg-muted/5">
                      <span className="text-xs font-mono text-muted-foreground/50">No leads in this stage</span>
                    </div>
                  )}
                  {columnSessions.map((session) => (
                    <div
                      key={session.id}
                      data-testid={`crm-card-${session.id}`}
                      className="bg-card border border-border p-3 rounded-lg shadow-sm hover:border-primary/50 hover:shadow-md hover:shadow-primary/5 transition-all cursor-pointer group"
                      onClick={() => selectSession(session)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="font-bold text-[13px] text-foreground truncate mr-2 leading-tight">
                          {session.targetEntityName ?? "Unknown Target"}
                        </div>
                        <ScoreBadge score={session.bayesianScoreAtRuntime} />
                      </div>

                      <div className="text-[10px] font-mono text-muted-foreground mb-3 flex items-center">
                        <UserCircle className="w-3 h-3 mr-1" /> ID: #{session.targetEntityId}
                      </div>

                      <div className="flex justify-between items-center mt-3 border-t border-border/60 pt-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="p-1 hover:text-primary disabled:opacity-30 transition-colors"
                          disabled={CRM_COLUMNS.indexOf(column) === 0}
                          onClick={(e) => { e.stopPropagation(); moveCard(session.id, column, -1); }}
                          data-testid={`btn-move-left-${session.id}`}
                        >
                          <ChevronRight className="w-4 h-4 rotate-180" />
                        </button>
                        <span className="text-[9px] font-mono font-bold uppercase text-muted-foreground tracking-widest">Move Stage</span>
                        <button
                          className="p-1 hover:text-primary disabled:opacity-30 transition-colors"
                          disabled={CRM_COLUMNS.indexOf(column) === CRM_COLUMNS.length - 1}
                          onClick={(e) => { e.stopPropagation(); moveCard(session.id, column, 1); }}
                          data-testid={`btn-move-right-${session.id}`}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Session Detail Panel ── */}
      {selectedSession && (
        <div className="flex fixed md:absolute inset-0 md:inset-y-0 md:right-0 md:left-auto w-full md:w-[420px] lg:w-[480px] bg-card md:border-l border-border shadow-2xl z-50 md:z-30 flex-col animate-in slide-in-from-bottom md:slide-in-from-right duration-200">
          <div className="p-4 border-b border-border flex justify-between items-center bg-muted/20 flex-shrink-0">
            <h2 className="font-bold text-sm font-mono tracking-wider flex items-center text-foreground">
              <FileText className="w-4 h-4 mr-2 text-primary" />
              Target Intelligence
            </h2>
            <button
              onClick={() => setSelectedSession(null)}
              className="text-muted-foreground hover:text-foreground font-mono text-xs border border-border px-2 py-1 rounded transition-colors"
            >
              [CLOSE]
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <h3 className="text-2xl font-bold text-foreground mb-2">
                {selectedSession.targetEntityName}
              </h3>
              <div className="flex items-center space-x-3">
                <div className="inline-flex items-center px-2 py-1 bg-muted text-muted-foreground text-xs font-mono rounded border border-border">
                  STATUS: {selectedSession.crmStatus}
                </div>
                {selectedSession.pathScore != null && (
                  <div className={cn(
                    "text-xs font-mono px-2 py-1 rounded border",
                    selectedSession.pathScore >= 0.7
                      ? "text-primary border-primary/30 bg-primary/5"
                      : "text-amber-500 border-amber-500/30 bg-amber-500/5"
                  )}>
                    PATH: {(selectedSession.pathScore * 100).toFixed(0)}/100
                  </div>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3 border-b border-border pb-1">
                Approach Vector
              </h4>
              {selectedSession.winningPath ? (
                <WinningPathDisplay raw={selectedSession.winningPath} />
              ) : (
                <div className="text-sm text-muted-foreground italic">
                  No path generated. Run Hybrid Research first.
                </div>
              )}
            </div>

            <div>
              <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3 border-b border-border pb-1 flex justify-between items-center">
                <span>Outreach Template</span>
                {!selectedSession.generatedPitch && (
                  <button
                    onClick={() => handleGeneratePitch(selectedSession.id)}
                    disabled={generatePitch.isPending}
                    className="text-primary hover:bg-primary/10 px-2 py-0.5 rounded transition-colors text-xs border border-primary/30"
                  >
                    {generatePitch.isPending ? "GENERATING..." : "GENERATE"}
                  </button>
                )}
              </h4>

              {selectedSession.generatedPitch ? (
                <>
                  <div className="mb-2 px-3 py-2 rounded border border-amber-500/20 bg-amber-500/5 text-xs font-mono text-amber-400/80 leading-relaxed">
                    <><AlertTriangle className="mr-1 inline-block h-3 w-3 text-amber-400" />Structural template only — rewrite with your specific purpose, relationship angle, and tone before sending.</>
                  </div>
                  <PitchSequenceDisplay pitch={selectedSession.generatedPitch} />
                </>
              ) : (
                <div className="text-sm text-muted-foreground italic bg-muted/30 p-4 rounded border border-border border-dashed text-center text-xs font-mono">
                  Generate a structural outreach template — then customise with your specific purpose before use
                </div>
              )}
            </div>

            {/* Notes */}
            <div>
              <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2 border-b border-border pb-1 flex items-center gap-1.5">
                <StickyNote className="w-3 h-3" /> Notes
              </h4>
              <textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                rows={3}
                placeholder="Add context, intelligence notes, last conversation summary…"
                className="w-full px-3 py-2 bg-background border border-border rounded text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none resize-none"
              />
            </div>

            {/* Follow-up date */}
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <h4 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <CalendarDays className="w-3 h-3" /> Follow-up Date
                </h4>
                <input
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-xs font-mono text-foreground focus:border-primary/50 focus:outline-none"
                />
              </div>
              <button
                onClick={() => saveNotesAndDate(selectedSession.id, notesValue, followUpDate)}
                disabled={notesSaving}
                className="flex items-center gap-1.5 px-3 py-2 rounded border border-primary/40 bg-primary/10 text-primary font-mono text-xs uppercase tracking-wider hover:bg-primary/20 transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                {notesSaved ? <Check className="w-3 h-3" /> : null}
                {notesSaving ? "Saving…" : notesSaved ? "Saved" : "Save"}
              </button>
            </div>

            {/* Export PDF */}
            {selectedSession.generatedPitch && (
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    const seq = (() => { try { return JSON.parse(selectedSession.generatedPitch); } catch { return null; } })();
                    if (!seq) return;
                    const w = window.open("", "_blank")!;
                    w.document.write(`<!DOCTYPE html><html><head><title>Outreach — ${selectedSession.targetEntityName}</title><style>body{font-family:monospace;padding:40px;max-width:800px;margin:0 auto;color:#000;background:#fff}h1{font-size:18px;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:24px}h2{font-size:13px;text-transform:uppercase;letter-spacing:2px;margin-top:32px;margin-bottom:12px;color:#333}pre{white-space:pre-wrap;font-size:12px;line-height:1.7;border:1px solid #ddd;padding:16px;border-radius:4px;background:#f9f9f9}footer{margin-top:40px;font-size:10px;color:#999;border-top:1px solid #ddd;padding-top:12px}@media print{button{display:none}}</style></head><body>`);
                    w.document.write(`<h1>Outreach Sequence — ${selectedSession.targetEntityName ?? "Target"}</h1>`);
                    w.document.write(`<p style="font-size:11px;color:#666">Generated ${new Date().toLocaleDateString("en-GB", { day:"2-digit", month:"long", year:"numeric" })} · Path score: ${selectedSession.pathScore ? (selectedSession.pathScore * 100).toFixed(0) + "/100" : "—"}</p>`);
                    if (seq.initial) { w.document.write(`<h2>Initial Contact</h2><pre>${seq.initial}</pre>`); }
                    if (seq.followUp) { w.document.write(`<h2>Follow-Up</h2><pre>${seq.followUp}</pre>`); }
                    if (seq.introScript) { w.document.write(`<h2>Introduction Script</h2><pre>${seq.introScript}</pre>`); }
                    w.document.write(`<footer>[All intelligence sourced exclusively from public registries and OSINT. Confidential — for authorised use only.]</footer></body></html>`);
                    w.document.close();
                    w.print();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 font-mono text-xs uppercase tracking-wider transition-colors"
                >
                  <Printer className="w-3 h-3" /> Export PDF
                </button>
              </div>
            )}

            <div className="pt-2 border-t border-border flex justify-between items-center text-xs font-mono text-muted-foreground">
              <span>Created: {format(new Date(selectedSession.createdAt), "yyyy-MM-dd HH:mm")}</span>
              {selectedSession.lastContactDate && (
                <span>
                  Last Contact: {format(new Date(selectedSession.lastContactDate), "yyyy-MM-dd")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
