import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  MessageSquare, Search, ChevronRight, Loader2, Copy, Check,
  User, Sparkles, ArrowRight, Target, Route, Mail, Phone,
  Linkedin, FileText, X, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────
interface EntitySummary { id: number; name: string; entityType: string; bayesianScore: number; contactEmail?: string; contactPhone?: string; }
interface ResearchSession { id: number; entityId: number; winningPath?: any; generatedPitch?: string; critiqueNote?: string; status?: string; }
interface PitchMessage { channel?: string; subject?: string; body?: string; message?: string; }

// ─── Copy button ──────────────────────────────────────────────────────────────
function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border bg-card/50 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

// ─── Entity search ────────────────────────────────────────────────────────────
function EntityPicker({ onSelect }: { onSelect: (e: EntitySummary) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<EntitySummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${BASE}/api/search/intelligent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, limit: 8 }),
        });
        const data = await res.json();
        setResults((data.results ?? data).slice(0, 8));
      } catch { setResults([]); }
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 border border-border rounded-lg bg-background px-3">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search profiles by name, company, N-number…"
          className="flex-1 py-2.5 text-sm font-mono bg-transparent text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
        />
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
      </div>
      {results.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-2xl z-50 max-h-64 overflow-y-auto">
          {results.map((e: any) => (
            <button
              key={e.entityId ?? e.id}
              onClick={() => { onSelect({ id: e.entityId ?? e.id, name: e.name, entityType: e.entityType, bayesianScore: e.bayesianScore, contactEmail: e.contactEmail, contactPhone: e.contactPhone }); setQ(""); setResults([]); }}
              className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-mono font-medium text-foreground truncate">{e.name}</div>
                <div className="text-[10px] font-mono text-muted-foreground uppercase">{e.entityType}</div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Context briefing ─────────────────────────────────────────────────────────
function ContextBriefing({ entity, session }: { entity: EntitySummary; session: ResearchSession | null }) {
  const winningPath: any[] = session?.winningPath ?? [];
  return (
    <div className="space-y-3">
      <div className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest mb-2">Intelligence Briefing</div>

      {/* Identity */}
      <div className="p-3 rounded-lg border border-border bg-card/30 space-y-1">
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-1.5">
          <User className="w-3.5 h-3.5 shrink-0" /> Identity
        </div>
        <div className="text-sm font-bold text-foreground">{entity.name}</div>
        <div className="text-xs font-mono text-muted-foreground uppercase">{entity.entityType}</div>
        <div className="text-[10px] font-mono text-primary">Signal score: {((entity.bayesianScore ?? 0) * 100).toFixed(0)}</div>
      </div>

      {/* Contact vectors */}
      {(entity.contactEmail || entity.contactPhone) && (
        <div className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 space-y-1.5">
          <div className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest mb-1">Direct Contact Vectors</div>
          {entity.contactEmail && (
            <a href={`mailto:${entity.contactEmail}`} className="flex items-center gap-2 text-xs font-mono text-emerald-300 hover:underline">
              <Mail className="w-3.5 h-3.5 shrink-0" /> {entity.contactEmail}
            </a>
          )}
          {entity.contactPhone && (
            <a href={`tel:${entity.contactPhone}`} className="flex items-center gap-2 text-xs font-mono text-emerald-300 hover:underline">
              <Phone className="w-3.5 h-3.5 shrink-0" /> {entity.contactPhone}
            </a>
          )}
        </div>
      )}

      {/* Hybrid Research winning path */}
      {winningPath.length > 0 && (
        <div className="p-3 rounded-lg border border-border bg-card/30">
          <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground uppercase tracking-widest mb-2">
            <Route className="w-3.5 h-3.5 shrink-0" /> Optimal Approach Path ({winningPath.length} steps)
          </div>
          <div className="space-y-1">
            {winningPath.slice(0, 5).map((step: any, i: number) => (
              <div key={i} className="flex items-start gap-2 text-xs font-mono">
                <span className="text-primary shrink-0 w-4">{i + 1}.</span>
                <span className="text-foreground/80 truncate">{step.label ?? step.vertexId}</span>
                {step.role && <span className="text-muted-foreground/50 shrink-0 text-[9px] uppercase">{step.role}</span>}
              </div>
            ))}
            {winningPath.length > 5 && (
              <div className="text-[10px] font-mono text-muted-foreground">+{winningPath.length - 5} more steps</div>
            )}
          </div>
        </div>
      )}

      {/* Critique note */}
      {session?.critiqueNote && (
        <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <div className="text-[10px] font-mono text-amber-400 uppercase tracking-widest mb-1.5">Research Analysis</div>
          <p className="text-xs font-mono text-foreground/80 leading-relaxed line-clamp-4">{session.critiqueNote}</p>
        </div>
      )}
    </div>
  );
}

// ─── Pitch drafts ─────────────────────────────────────────────────────────────
function PitchDrafts({ pitch, session, entity }: { pitch: string | null; session: ResearchSession | null; entity: EntitySummary }) {
  const [expanded, setExpanded] = useState<number | null>(0);

  if (!pitch) return null;

  let messages: PitchMessage[] = [];
  try {
    const parsed = JSON.parse(pitch);
    messages = Array.isArray(parsed) ? parsed : parsed.messages ?? parsed.sequence ?? [{ body: pitch }];
  } catch {
    messages = [{ body: pitch }];
  }

  const channelIcon = (ch?: string) => {
    if (!ch) return <FileText className="w-3.5 h-3.5" />;
    const c = ch.toLowerCase();
    if (c.includes("email")) return <Mail className="w-3.5 h-3.5" />;
    if (c.includes("linkedin") || c.includes("li")) return <Linkedin className="w-3.5 h-3.5" />;
    if (c.includes("phone") || c.includes("call")) return <Phone className="w-3.5 h-3.5" />;
    return <MessageSquare className="w-3.5 h-3.5" />;
  };

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-widest">
        {messages.length} draft{messages.length !== 1 ? "s" : ""} generated · edit before use
      </div>
      {messages.map((msg, i) => (
        <div key={i} className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setExpanded(expanded === i ? null : i)}
            className="w-full flex items-center justify-between px-3 py-2.5 bg-card/30 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs font-mono text-foreground">
              <span className="text-muted-foreground">{channelIcon(msg.channel)}</span>
              <span className="font-bold uppercase tracking-wider">{msg.channel ?? `Step ${i + 1}`}</span>
              {msg.subject && <span className="text-muted-foreground truncate hidden sm:block">— {msg.subject}</span>}
            </div>
            <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform shrink-0", expanded === i && "rotate-90")} />
          </button>
          {expanded === i && (
            <div className="px-3 py-3 bg-background/50 border-t border-border">
              {msg.subject && (
                <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Subject</div>
              )}
              {msg.subject && (
                <div className="text-xs font-mono text-foreground font-medium mb-3 flex items-center justify-between gap-2">
                  <span>{msg.subject}</span>
                  <CopyBtn text={msg.subject} label="Subject" />
                </div>
              )}
              <div className="text-[10px] font-mono text-muted-foreground uppercase mb-1">Message</div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <pre className="text-xs font-mono text-foreground/80 leading-relaxed whitespace-pre-wrap flex-1 min-w-0">
                  {msg.body ?? msg.message ?? JSON.stringify(msg)}
                </pre>
              </div>
              <CopyBtn text={msg.body ?? msg.message ?? JSON.stringify(msg)} label="Copy message" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function OutreachAssistant() {
  const [selectedEntity, setSelectedEntity] = useState<EntitySummary | null>(null);
  const [session, setSession] = useState<ResearchSession | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pitch, setPitch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markedSent, setMarkedSent] = useState(false);

  // Load Hybrid Research session when entity is selected
  useEffect(() => {
    if (!selectedEntity) { setSession(null); setPitch(null); return; }
    setLoadingSession(true);
    setSession(null);
    setPitch(null);
    setError(null);
    fetch(`${BASE}/api/research/sessions?entityId=${selectedEntity.id}`)
      .then(r => r.ok ? r.json() : [])
      .then((sessions: any[]) => {
        const s = sessions[0] ?? null;
        setSession(s);
        if (s?.generatedPitch) setPitch(s.generatedPitch);
        setLoadingSession(false);
      })
      .catch(() => setLoadingSession(false));
  }, [selectedEntity]);

  const handleGenerate = useCallback(async () => {
    if (!selectedEntity) return;
    setGenerating(true);
    setError(null);
    try {
      // If no session exists, run research first
      let activeSession = session;
      if (!activeSession) {
        const res = await fetch(`${BASE}/api/research/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entityId: selectedEntity.id }),
        });
        if (!res.ok) throw new Error("Research failed");
        activeSession = await res.json();
        setSession(activeSession);
      }

      // Generate pitch
      const res = await fetch(`${BASE}/api/research/sessions/${activeSession!.id}/pitch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        // Fallback: try the generate-pitch endpoint
        const res2 = await fetch(`${BASE}/api/research/generate-pitch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: activeSession!.id, entityId: selectedEntity.id }),
        });
        if (!res2.ok) throw new Error("Pitch generation failed");
        const d2 = await res2.json();
        setPitch(d2.pitch ?? d2.generatedPitch ?? JSON.stringify(d2));
      } else {
        const data = await res.json();
        setPitch(data.pitch ?? data.generatedPitch ?? data.sequence ?? JSON.stringify(data));
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to generate outreach drafts");
    }
    setGenerating(false);
  }, [selectedEntity, session]);

  const handleMarkSent = async () => {
    if (!session) return;
    try {
      await fetch(`${BASE}/api/research/sessions/${session.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "contacted" }),
      });
      setMarkedSent(true);
    } catch { /* non-fatal */ }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="border-b border-border bg-card/30 px-4 md:px-6 py-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-primary shrink-0" />
          <div>
            <h1 className="text-sm font-bold font-mono uppercase tracking-widest text-foreground">
              Outreach Assistant
            </h1>
            <p className="text-xs font-mono text-muted-foreground mt-0.5">
              Select a profile → review briefing → generate drafts → copy to your client
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6">

          {/* Step 1: Select profile */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-5 h-5 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">1</div>
              <span className="text-xs font-mono font-bold uppercase tracking-widest text-foreground">Select Profile</span>
              {selectedEntity && (
                <button onClick={() => { setSelectedEntity(null); setPitch(null); setMarkedSent(false); }} className="ml-auto text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {!selectedEntity ? (
              <EntityPicker onSelect={setSelectedEntity} />
            ) : (
              <div className="flex items-center gap-3 p-3 border border-primary/30 bg-primary/5 rounded-lg">
                <Target className="w-4 h-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold font-mono text-foreground truncate">{selectedEntity.name}</div>
                  <div className="text-[10px] font-mono text-muted-foreground uppercase">{selectedEntity.entityType}</div>
                </div>
                <Link href={`/profile/${selectedEntity.id}`} className="text-[10px] font-mono text-primary/60 hover:text-primary whitespace-nowrap flex items-center gap-0.5">
                  Profile <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            )}
          </section>

          {/* Step 2: Context briefing */}
          {selectedEntity && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">2</div>
                <span className="text-xs font-mono font-bold uppercase tracking-widest text-foreground">Intelligence Briefing</span>
              </div>
              {loadingSession ? (
                <div className="flex items-center gap-2 text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs font-mono">Loading research data…</span>
                </div>
              ) : (
                <ContextBriefing entity={selectedEntity} session={session} />
              )}
            </section>
          )}

          {/* Step 3: Generate drafts */}
          {selectedEntity && !loadingSession && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">3</div>
                <span className="text-xs font-mono font-bold uppercase tracking-widest text-foreground">Draft Outreach</span>
              </div>

              {!pitch && (
                <div className="space-y-3">
                  <p className="text-xs font-mono text-muted-foreground leading-relaxed">
                    {session
                      ? "Hybrid Research session found. Generate a personalized multi-step outreach sequence from the winning approach path."
                      : "No research session yet. Generating will first run a Hybrid Research investigation, then produce the outreach sequence."}
                  </p>
                  {error && (
                    <div className="flex items-start gap-2 p-3 rounded-lg border border-red-500/20 bg-red-500/5 text-xs font-mono text-red-400">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
                    </div>
                  )}
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary/10 border border-primary/30 text-primary font-mono text-xs uppercase tracking-widest hover:bg-primary/20 transition-colors disabled:opacity-50"
                  >
                    {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {generating ? (session ? "Generating…" : "Running research then generating…") : "Draft Outreach Sequence"}
                  </button>
                </div>
              )}

              {pitch && <PitchDrafts pitch={pitch} session={session} entity={selectedEntity} />}
            </section>
          )}

          {/* Step 4: Track externally */}
          {pitch && selectedEntity && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">4</div>
                <span className="text-xs font-mono font-bold uppercase tracking-widest text-foreground">Track Status</span>
              </div>
              <div className="p-3 border border-border rounded-lg bg-card/30 flex items-center justify-between gap-3">
                <p className="text-xs font-mono text-muted-foreground">
                  Paste into your email/LinkedIn/Telegram client, then mark as sent to move this entity in the Pipeline.
                </p>
                {markedSent ? (
                  <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-mono whitespace-nowrap">
                    <Check className="w-3.5 h-3.5" /> Marked sent
                  </span>
                ) : (
                  <button
                    onClick={handleMarkSent}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border text-xs font-mono text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors whitespace-nowrap"
                  >
                    <ArrowRight className="w-3 h-3" /> Mark as Sent
                  </button>
                )}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground/40 mt-2">
                No messages are sent from within Apex Atlas. All communication is handled by you in your own client.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
