import { useState } from "react";
import { cn, AccessScoreBadge, ScoreBadge } from "@/lib/utils";
import { Link } from "wouter";
import { BookOpen, Shield, ShieldAlert, Database, ChevronRight, Activity, ChevronDown, ChevronUp, Flame } from "lucide-react";

// --- Mini UI Components for the Demo ---

function ScoreDemoGrid() {
  const examples = [
    {
      name: "THIEL PETER",
      access: 0.87,
      signal: 0.95,
      channels: "Email · Phone · LinkedIn",
    },
    {
      name: "BEZOS JEFFREY",
      access: 0.42,
      signal: 0.98,
      channels: "LinkedIn only",
    },
    {
      name: "SMITH JOHN",
      access: 0,
      signal: 0.45,
      channels: "Registry only",
    },
    {
      name: "GATES WILLIAM",
      access: 0.99,
      signal: 1.0,
      channels: "All channels",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-6">
      {examples.map((ex, i) => (
        <div key={i} className="bg-card border border-border rounded-lg p-4">
          <div className="text-sm font-bold text-foreground mb-2 flex items-center justify-between">
            {ex.name}
            <span className="text-[10px] text-muted-foreground font-mono">{ex.channels}</span>
          </div>
          <div className="flex gap-2">
            <AccessScoreBadge score={ex.access} />
            <ScoreBadge score={ex.signal} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Callout({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="border-l-2 border-primary bg-primary/5 p-4 rounded-r-lg my-6">
      {title && <div className="font-mono text-xs font-bold text-primary mb-1 uppercase tracking-wider">{title}</div>}
      <div className="text-sm text-foreground/80 leading-relaxed">{children}</div>
    </div>
  );
}

// --- Sections ---

const SECTIONS = [
  {
    id: "overview",
    title: "1. Overview",
    content: (
      <>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          ApexFinder Pro is an OSINT platform designed for researching high-net-worth individuals at scale using public registries. It is built on a simple premise: <strong className="text-foreground">Zero Synthetic Data</strong>.
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          Every piece of intelligence you see — every asset, every proximity connection, every contact vector — is traceable back to a public registry (FAA aircraft databases, UK Land Registry, SEC EDGAR filings, OpenCorporates). The platform never hallucinates contact information.
        </p>
        <Callout title="The Intelligence Loop">
          Apex runs 24/7 in the background. You do not add records manually. You filter, investigate, and review the public evidence attached to the entities the system automatically discovers.
        </Callout>
      </>
    )
  },
  {
    id: "score-system",
    title: "2. The Score System",
    content: (
      <>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          Not all high-net-worth individuals are reachable. We separate an entity's wealth footprint from their contactability using two distinct scores:
        </p>
        <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground mb-6 pl-2">
          <li><strong className="text-foreground">Signal Score (0-100):</strong> The strength of the registry evidence for their net worth. High signal means massive public asset footprint.</li>
          <li><strong className="text-foreground">Access Score (0-100):</strong> How realistically this person can be reached through public contact evidence (email, phone, LinkedIn).</li>
        </ul>
        <ScoreDemoGrid />
        <p className="text-sm text-muted-foreground leading-relaxed">
          A high Signal Score does <strong className="text-foreground">not</strong> prove identity or personal access. Many high-net-worth individuals have massive registry footprints but limited attributable public contact evidence. Treat the Access Score as an evidence-backed assessment, not a communication recommendation.
        </p>
      </>
    )
  },
  {
    id: "working-at-scale",
    title: "3. Working at Scale",
    content: (
      <>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          The Entity Ledger is your primary workspace. Instead of viewing entities one by one, you manipulate the entire database using the filter bar.
        </p>
        <div className="bg-muted/30 border border-border p-4 rounded-lg my-4 flex items-center justify-between">
          <span className="text-xs font-mono text-muted-foreground">Example Pipeline:</span>
          <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded">HNWI</span>
          <span className="text-xs font-mono text-muted-foreground">→</span>
          <span className="inline-flex items-center gap-1 text-xs font-mono text-amber-400 bg-amber-500/10 px-2 py-1 rounded"><Flame className="h-3 w-3" />Hot</span>
          <span className="text-xs font-mono text-muted-foreground">→</span>
          <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">Contactable</span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          When you identify a cohort, use the <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">Bulk Actions</code> bar to inspect records, compare evidence, or run deep-dive Hybrid Research in parallel.
        </p>
      </>
    )
  },
  {
    id: "research",
    title: "4. Research & Investigation",
    content: (
      <>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          When an entity requires deeper analysis, launch a <strong className="text-foreground">Hybrid Research Session</strong>. The system branches out across multiple search vectors (BM25 + Semantic + Graph + Bayesian, with L4 UCT path exploration), dynamically evaluating approach angles based on public footprints.
        </p>
        <Callout title="Approach Vectors">
          The research session outputs an evidence path with source context, relationship steps, attribution findings, and an access assessment. It does not recommend communication routes.
        </Callout>
      </>
    )
  },
  {
    id: "advanced",
    title: "5. Advanced Tools",
    content: (
      <>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          Apex includes tools for maintaining database hygiene and refining research quality:
        </p>
        <ul className="space-y-4 text-sm text-muted-foreground">
          <li className="flex gap-3">
            <Activity className="w-5 h-5 text-primary shrink-0" />
            <div>
              <strong className="text-foreground block mb-1">Persona Loop</strong>
              Iteratively refine deterministic research personas based on evidence coverage, source quality, attribution, and review outcomes.
            </div>
          </li>
          <li className="flex gap-3">
            <Database className="w-5 h-5 text-blue-400 shrink-0" />
            <div>
              <strong className="text-foreground block mb-1">Data Sources</strong>
              Monitor the real-time status of your ingestion pipelines (SEC, FAA, etc.).
            </div>
          </li>
        </ul>
      </>
    )
  }
];

export default function FieldManual() {
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const [expandedMobile, setExpandedMobile] = useState<string>(SECTIONS[0].id);

  return (
    <div className="flex h-full overflow-hidden bg-background">
      
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-[240px] flex-col border-r border-border bg-card shrink-0">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h1 className="text-xs font-mono font-bold uppercase tracking-widest text-foreground">
            Field Manual
          </h1>
        </div>
        <nav className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-2">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setActiveSection(s.id);
                    document.getElementById(`desktop-${s.id}`)?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs font-mono uppercase tracking-wider rounded transition-colors",
                    activeSection === s.id
                      ? "bg-primary/10 text-primary font-bold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Desktop Content */}
      <div className="hidden md:flex flex-1 overflow-y-auto">
        <div className="max-w-[720px] w-full mx-auto p-8 lg:p-12">
          
          <div className="mb-12 border-b border-border pb-8">
            <h1 className="text-3xl font-bold text-foreground mb-4">ApexFinder Pro</h1>
            <p className="text-lg text-muted-foreground">Operator Field Manual & Reference</p>
            
            <div className="mt-6 flex items-center gap-3 bg-card border border-border p-4 rounded-lg">
              <div className="w-16 h-12 flex gap-1 items-end shrink-0">
                <div className="w-4 bg-muted-foreground/30 h-full rounded-sm" />
                <div className="w-4 bg-primary/60 h-2/3 rounded-sm" />
                <div className="w-4 bg-muted-foreground/30 h-1/2 rounded-sm" />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Screenshots in this manual adapt to your current viewport. On mobile, the app uses a bottom navigation bar and stacked card layouts. On desktop, it uses a full sidebar with a multi-column layout.
              </p>
            </div>
          </div>

          <div className="space-y-16 pb-24">
            {SECTIONS.map((s) => (
              <section key={s.id} id={`desktop-${s.id}`} className="scroll-mt-8">
                <h2 className="text-sm font-mono uppercase tracking-widest text-primary mb-6">{s.title}</h2>
                {s.content}
              </section>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile Accordion View */}
      <div className="flex md:hidden flex-col flex-1 overflow-y-auto">
        <div className="p-4 border-b border-border bg-card shrink-0">
          <h1 className="text-sm font-mono font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-primary" />
            Field Manual
          </h1>
          <p className="text-[10px] text-muted-foreground mt-1">Operator Reference</p>
        </div>
        
        <div className="flex-1 p-4 space-y-3">
          {SECTIONS.map((s) => (
            <div key={s.id} className="bg-card border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedMobile(expandedMobile === s.id ? "" : s.id)}
                className="w-full flex items-center justify-between p-4"
              >
                <span className="text-xs font-mono uppercase tracking-widest text-foreground font-bold">
                  {s.title}
                </span>
                {expandedMobile === s.id ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
              
              <div 
                className={cn(
                  "overflow-hidden transition-all duration-300",
                  expandedMobile === s.id ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0"
                )}
              >
                <div className="p-4 pt-0 border-t border-border/50">
                  {s.content}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
    </div>
  );
}
