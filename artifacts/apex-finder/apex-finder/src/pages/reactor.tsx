import { useState, useEffect, useRef, useCallback } from "react";
import {
  Plane, Building2, Globe, Search, Brain, Zap, Network,
  Target, Cpu, Radio, Activity, BarChart2, Shield,
  TrendingUp, Eye, RefreshCw, GitMerge, Layers, Crosshair, MapPin,
  Sparkles, Compass, Rss, Users,
} from "lucide-react";
import { MobileReactorFlow } from "../components/mobile-reactor-flow";

// ── Types ──────────────────────────────────────────────────────────────────────
interface NodeDef {
  id: string; label: string; sub: string;
  cx: number; cy: number; w: number; h: number;
  type: "input"|"registry"|"discovery"|"ai-cyan"|"ai-lime"|"analysis"|"core"|"reactor"|"output";
  Icon: React.ElementType; color: string;
}
interface EdgeDef { id: string; from: string; to: string; adaptive?: boolean }
interface Wave   { nodes: string[]; edges: string[]; label: string; adaptive?: boolean }

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
  atlasTelemetry?: any;
}

function parseAtlasTelemetry(raw: unknown) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type RodStatus = "idle" | "completed" | "active" | "queued" | "skipped" | "failed";

function rodStatusColor(status: RodStatus, fallback: string): string {
  switch (status) {
    case "completed": return "#a3e635";
    case "active": return "#22d3ee";
    case "queued": return "#526b86";
    case "skipped": return "#f59e0b";
    case "failed": return "#fb7185";
    default: return fallback;
  }
}

const ATLAS_PHASES = [
  { n: 0, label: "CROSS-REF", detail: "Existing records and registry anchors" },
  { n: 1, label: "DISCOVERY", detail: "21-source discovery plus full-circle entity cooking" },
  { n: 2, label: "IDENTITY", detail: "Contacts, ownership, and foundation evidence" },
  { n: 3, label: "METADATA", detail: "Notes, assets, and source markers" },
  { n: 4, label: "IN-HOUSE", detail: "Wikidata, GitHub, RDAP, DNS, and filings" },
  { n: 5, label: "SOCIAL", detail: "Public social and messenger discovery" },
  { n: 6, label: "AI OSINT", detail: "Search, extraction, and platform expansion" },
  { n: 7, label: "FORENSICS", detail: "Leaks, WHOIS, vessels, and flight history" },
  { n: 8, label: "ATTRIBUTION", detail: "Domain, footprint, and graph-assisted attribution" },
  { n: 9, label: "SEMANTIC", detail: "Embeddings, wealth, confidence, and outcomes" },
  { n: 10, label: "UCT RESEARCH", detail: "Adaptive paths and outreach sequences" },
];

function atlasPhaseFromMessage(message: string, progress = 0): number {
  const explicit = message.match(/Phase\s+(\d+)(?:\/10)?/i);
  if (explicit) return Math.min(10, Math.max(0, Number(explicit[1])));
  if (/\bMCTS\b|research batch/i.test(message)) return 10;
  if (/\bPhase J\b|attribution|digital footprint|domain resolution/i.test(message)) return 8;
  if (/embedding|semantic|net worth|confidence recompute|contact outcome/i.test(message)) return 9;
  if (/forensic|ICIJ|Whoxy|WHOIS|Equasis|ADSB|flight history/i.test(message)) return 7;
  if (/AI OSINT|Maigret|Holehe|Perplexity|Gemini|Tavily|Exa|Groq/i.test(message)) return 6;
  if (/social|messenger|Telegram|LinkedIn|Instagram|Twitter/i.test(message)) return 5;
  if (/in.house|Wikidata|GitHub|RDAP|ProPublica|DNS/i.test(message)) return 4;
  if (/metadata|notes|EDGAR assets|source markers/i.test(message)) return 3;
  if (/identity|ownership|Foundation|OpenOwnership|Companies House contact/i.test(message)) return 2;
  if (/\[\d+\/\d+\]|discovery|registry|cooked|enrich/i.test(message)) return 1;
  return Math.min(10, Math.max(0, progress));
}

function parseAtlasLiveState(message: string, progress = 0, total = 10, runStatus: AtlasLiveState["runStatus"] = "running"): AtlasLiveState {
  const phase = atlasPhaseFromMessage(message, progress);
  const source = message.match(/\[(\d+)\/(\d+)\]/);
  // Remove emojis from the raw message before matching entity names
  const cleanMessage = message.replace(/[\u{1F300}-\u{1F9FF}]/gu, "").replace(/🍳/g, "");
  const entityBatch = cleanMessage.match(/:\s*([^…]+?)(?:…|$)/);
  const names = entityBatch?.[1]
    ?.split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 3) ?? [];
  const phaseMeta = ATLAS_PHASES[phase] ?? ATLAS_PHASES[1];
  return {
    runStatus,
    phase,
    phaseLabel: phaseMeta.label,
    phaseProgress: progress,
    phaseTotal: total,
    sourceStep: source ? Number(source[1]) : null,
    sourceTotal: source ? Number(source[2]) : null,
    currentEntities: names,
    entityProgress: null,
    entityTotal: null,
    detail: cleanMessage.replace(/…$/, "").trim(),
  };
}

function parseEntityNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((name): name is string => typeof name === "string").slice(0, 3);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === "string").slice(0, 3)
      : [];
  } catch {
    return value.split(",").map(name => name.trim()).filter(Boolean).slice(0, 3);
  }
}

// ── Node layout (desktop coords) ─────────────────────────────────────────────
const NODES: NodeDef[] = [
  { id:"target",  label:"TARGET INPUT",    sub:"Entity · Query",             cx:800,  cy:68,  w:200, h:52,  type:"input",    Icon:Crosshair, color:"#e8e0cc" },
  { id:"faa",     label:"FAA REGISTRY",    sub:"Aircraft Owners",            cx:100,  cy:178, w:140, h:60,  type:"registry", Icon:Plane,      color:"#38bdf8" },
  { id:"edgar",   label:"EDGAR / SEC",     sub:"Corporate Filings",          cx:280,  cy:178, w:140, h:60,  type:"registry", Icon:BarChart2,  color:"#38bdf8" },
  { id:"hmlr",    label:"UK LAND REG",     sub:"Property Records",           cx:460,  cy:178, w:140, h:60,  type:"registry", Icon:MapPin,     color:"#38bdf8" },
  { id:"ch",      label:"COMP HOUSE",      sub:"UK Officers",                cx:640,  cy:178, w:140, h:60,  type:"registry", Icon:Building2,  color:"#38bdf8" },
  { id:"hnwi",    label:"HNWI SCAN",       sub:"Wealth Profiles",            cx:820,  cy:178, w:140, h:60,  type:"registry", Icon:TrendingUp, color:"#38bdf8" },
  { id:"occrp",   label:"OCCRP ALEPH",     sub:"Sanctions · Crime",          cx:1000, cy:178, w:140, h:60,  type:"registry", Icon:Shield,     color:"#38bdf8" },
  { id:"brreg",   label:"EU REGISTRIES",   sub:"BRREG · ARES · BODACC",      cx:1180, cy:178, w:140, h:60,  type:"registry", Icon:Globe,      color:"#38bdf8" },
  { id:"whoxy",   label:"WHOXY / RDAP",    sub:"Domain · DNS Intel",         cx:1360, cy:178, w:140, h:60,  type:"registry", Icon:Rss,        color:"#38bdf8" },
  { id:"inhouse", label:"IN-HOUSE",        sub:"Wikidata · GitHub · RDAP",   cx:160,  cy:298, w:168, h:60,  type:"discovery",Icon:Search,     color:"#fb923c" },
  { id:"webdisc", label:"WEB DISC.",       sub:"15 Categories · Tavily · AI",cx:530,  cy:298, w:168, h:60,  type:"discovery",Icon:Compass,    color:"#fb923c" },
  { id:"deepweb", label:"DEEP WEB",        sub:"Multi-source OSINT",         cx:900,  cy:298, w:168, h:60,  type:"discovery",Icon:Eye,        color:"#fb923c" },
  { id:"opensky", label:"LIVE FLIGHT",     sub:"OpenSky Network",            cx:1270, cy:298, w:148, h:60,  type:"discovery",Icon:Radio,      color:"#fb923c" },
  { id:"maigret", label:"MAIGRET",         sub:"Holehe · 3,000+ Platforms",  cx:1460, cy:298, w:168, h:60,  type:"discovery",Icon:Users,      color:"#fb923c" },
  { id:"perp0",   label:"PERPLEXITY",      sub:"Phase 0 · Live Research",    cx:140,  cy:420, w:160, h:62,  type:"ai-cyan",  Icon:Zap,        color:"#22d3ee" },
  { id:"exa",     label:"EXA NEURAL",      sub:"Semantic People Search",     cx:345,  cy:420, w:148, h:62,  type:"ai-cyan",  Icon:Compass,    color:"#22d3ee" },
  { id:"tavily",  label:"TAVILY AI",       sub:"AI-native Web Search",       cx:545,  cy:420, w:148, h:62,  type:"ai-cyan",  Icon:Rss,        color:"#22d3ee" },
  { id:"groq",    label:"GROQ LLM",        sub:"Llama 3.3 · Extraction",     cx:800,  cy:420, w:160, h:62,  type:"ai-lime",  Icon:Brain,      color:"#a3e635" },
  { id:"gemini",  label:"GEMINI",          sub:"Google · Grounded Search",   cx:1040, cy:420, w:148, h:62,  type:"ai-cyan",  Icon:Sparkles,   color:"#22d3ee" },
  { id:"perpfu",  label:"PERPLEXITY+",     sub:"Adaptive Follow-up",         cx:1250, cy:420, w:160, h:62,  type:"ai-cyan",  Icon:RefreshCw,  color:"#22d3ee" },
  { id:"semantic",label:"SEMANTIC ENGINE", sub:"MiniLM · Embeddings",        cx:460,  cy:540, w:192, h:62,  type:"analysis", Icon:GitMerge,   color:"#a78bfa" },
  { id:"bayesian",label:"BAYESIAN SCORE",  sub:"Dynamic Priority",           cx:1020, cy:540, w:192, h:62,  type:"analysis", Icon:Layers,     color:"#a78bfa" },
  { id:"graph",   label:"GRAPH ENGINE",    sub:"Relationship Synthesis",     cx:260,  cy:652, w:178, h:62,  type:"core",     Icon:Network,    color:"#a78bfa" },
  { id:"mcts",    label:"UCT CORE",        sub:"Adaptive Pathfinding",       cx:800,  cy:657, w:228, h:78,  type:"reactor",  Icon:Cpu,        color:"#a3e635" },
  { id:"prac",    label:"PRAC ENGINE",     sub:"Planner · Analyst · Critic", cx:1340, cy:652, w:178, h:62,  type:"core",     Icon:Activity,   color:"#a78bfa" },
  { id:"pitch",   label:"PITCH GENERATOR", sub:"Custom Outreach Sequence",   cx:800,  cy:768, w:244, h:54,  type:"output",   Icon:Target,     color:"#fbbf24" },
];

const NM = Object.fromEntries(NODES.map(n => [n.id, n]));

const EDGES: EdgeDef[] = [
  {id:"t-faa",    from:"target", to:"faa"    },
  {id:"t-edgar",  from:"target", to:"edgar"  },
  {id:"t-hmlr",   from:"target", to:"hmlr"   },
  {id:"t-ch",     from:"target", to:"ch"     },
  {id:"t-hnwi",   from:"target", to:"hnwi"   },
  {id:"t-occrp",  from:"target", to:"occrp"  },
  {id:"t-brreg",  from:"target", to:"brreg"  },
  {id:"t-whoxy",  from:"target", to:"whoxy"  },
  {id:"faa-inh",  from:"faa",    to:"inhouse"},
  {id:"edgar-web",from:"edgar",  to:"webdisc"},
  {id:"hmlr-web", from:"hmlr",   to:"webdisc"},
  {id:"ch-inh",   from:"ch",     to:"inhouse"},
  {id:"hnwi-dw",  from:"hnwi",   to:"deepweb"},
  {id:"occrp-sky",from:"occrp",  to:"opensky"},
  {id:"brreg-inh",from:"brreg",  to:"inhouse"},
  {id:"whoxy-inh",from:"whoxy",  to:"inhouse"},
  {id:"inh-p0",   from:"inhouse",to:"perp0"  },
  {id:"inh-exa",  from:"inhouse",to:"exa"    },
  {id:"web-p0",   from:"webdisc",to:"perp0"  },
  {id:"web-exa",  from:"webdisc",to:"exa"    },
  {id:"web-tav",  from:"webdisc",to:"tavily" },
  {id:"web-groq", from:"webdisc",to:"groq"   },
  {id:"dw-groq",  from:"deepweb",to:"groq"   },
  {id:"dw-gem",   from:"deepweb",to:"gemini" },
  {id:"dw-fu",    from:"deepweb",to:"perpfu" },
  {id:"sky-fu",   from:"opensky",to:"perpfu" },
  {id:"sky-mai",  from:"opensky",to:"maigret"},
  {id:"web-mai",  from:"webdisc",to:"maigret"},
  {id:"mai-groq", from:"maigret",to:"groq"   },
  {id:"mai-bay",  from:"maigret",to:"bayesian"},
  {id:"web-gem",  from:"webdisc",to:"gemini" },
  {id:"p0-groq",  from:"perp0",  to:"groq"   },
  {id:"exa-groq", from:"exa",    to:"groq"   },
  {id:"tav-groq", from:"tavily", to:"groq"   },
  {id:"groq-fu",  from:"groq",   to:"perpfu" },
  {id:"gem-fu",   from:"gemini", to:"perpfu" },
  {id:"p0-sem",   from:"perp0",  to:"semantic"},
  {id:"gem-sem",  from:"gemini", to:"semantic"},
  {id:"groq-sem", from:"groq",   to:"semantic"},
  {id:"groq-bay", from:"groq",   to:"bayesian"},
  {id:"fu-bay",   from:"perpfu", to:"bayesian"},
  {id:"sem-gr",   from:"semantic",to:"graph" },
  {id:"sem-mc",   from:"semantic",to:"mcts"  },
  {id:"bay-mc",   from:"bayesian",to:"mcts"  },
  {id:"bay-pr",   from:"bayesian",to:"prac"  },
  {id:"gr-mc",    from:"graph",  to:"mcts"   },
  {id:"mc-pr",    from:"mcts",   to:"prac"   },
  {id:"mc-pit",   from:"mcts",   to:"pitch"  },
  {id:"pr-pit",   from:"prac",   to:"pitch"  },
  {id:"mc-groq-a",from:"mcts",   to:"groq",  adaptive:true},
  {id:"mc-fu-a",  from:"mcts",   to:"perpfu",adaptive:true},
  {id:"pr-fu-a",  from:"prac",   to:"perpfu",adaptive:true},
];

const WAVES: Wave[] = [
  { nodes:["target"],                               edges:["t-faa","t-edgar","t-hmlr","t-ch","t-hnwi","t-occrp","t-brreg","t-whoxy"],            label:"TARGETING  —  parsing entity query" },
  { nodes:["faa","edgar","hmlr","ch","hnwi","occrp","brreg","whoxy"],edges:["faa-inh","edgar-web","hmlr-web","ch-inh","hnwi-dw","occrp-sky","brreg-inh","whoxy-inh"],label:"REGISTRY STACK  —  scanning eight public registries in parallel" },
  { nodes:["inhouse","webdisc","deepweb","opensky","maigret"], edges:["inh-p0","inh-exa","web-p0","web-exa","web-tav","web-groq","web-gem","web-mai","dw-groq","dw-gem","dw-fu","sky-fu","sky-mai"], label:"DISCOVERY LAYER  —  web sources + Maigret cross-platform expansion" },
  { nodes:["perp0","exa","tavily","gemini"],          edges:["p0-groq","exa-groq","tav-groq","p0-sem","gem-sem","gem-fu"],    label:"AI PHASE 0  —  Perplexity · Gemini · Tavily · Exa in parallel" },
  { nodes:["groq"],                                  edges:["groq-fu","groq-sem","groq-bay"],                                label:"GROQ LLM  —  structured extraction from Exa · Tavily · web text" },
  { nodes:["perpfu"],                                edges:["fu-bay","mai-groq","mai-bay"],                                  label:"PERPLEXITY+  —  iterative follow-up" },
  { nodes:["semantic","bayesian"],                   edges:["sem-gr","sem-mc","bay-mc","bay-pr"],                            label:"SYNTHESIS  —  embedding profiles, scoring priorities" },
  { nodes:["graph"],                                 edges:["gr-mc"],                                                        label:"GRAPH ENGINE  —  relationship network" },
  { nodes:["mcts"],                                  edges:["mc-pr","mc-groq-a","mc-fu-a"],                                 label:"UCT CORE  —  adaptive pathfinding", adaptive:true },
  { nodes:["groq","perpfu"],                         edges:["groq-fu","fu-bay","pr-fu-a"],                                  label:"ADAPTIVE LOOP  —  re-querying with new graph evidence", adaptive:true },
  { nodes:["prac"],                                  edges:["pr-pit","mc-pit"],                                             label:"PRAC ENGINE  —  planner · retriever · analyst · critic" },
  { nodes:["pitch"],                                 edges:[],                                                               label:"OUTPUT  —  generating custom outreach sequence" },
  { nodes:[],                                        edges:[],                                                               label:"REACTOR COOLING  —  cycle complete" },
];

// ── Mobile phase groups ───────────────────────────────────────────────────────
const MOBILE_PHASES = [
  { label:"INPUT",      detail:"Target becomes a research brief", nodeIds:["target"]                                              },
  { label:"REGISTRIES", detail:"Public records establish the evidence base", nodeIds:["faa","edgar","hmlr","ch","hnwi","occrp","brreg","whoxy"] },
  { label:"DISCOVERY",  detail:"Open sources expand identity and activity", nodeIds:["inhouse","webdisc","deepweb","opensky","maigret"]     },
  { label:"AI LAYER",   detail:"Search, extraction, and adaptive follow-up", nodeIds:["perp0","exa","tavily","gemini","groq","perpfu"]       },
  { label:"SYNTHESIS",  detail:"Evidence becomes vectors and priority", nodeIds:["semantic","bayesian"]                                 },
  { label:"CORE",       detail:"Relationships and paths are evaluated", nodeIds:["graph","mcts","prac"]                                 },
  { label:"OUTPUT",     detail:"A research-ready outreach sequence", nodeIds:["pitch"]                                               },
];

const REGISTRY_NODE_IDS = ["faa","edgar","hmlr","ch","hnwi","occrp","brreg","whoxy"];

// A compact 360 × 740 coordinate system keeps the same complete network visible
// on narrow screens. SVG carries the routes; the HTML cards remain readable.
const MOBILE_NODE_POS: Record<string, { x:number; y:number }> = {
  target: { x:180, y:28 },
  faa: { x:42, y:112 }, edgar: { x:126, y:112 }, hmlr: { x:210, y:112 }, ch: { x:294, y:112 },
  hnwi: { x:42, y:162 }, occrp: { x:126, y:162 }, brreg: { x:210, y:162 }, whoxy: { x:294, y:162 },
  inhouse: { x:42, y:246 }, webdisc: { x:126, y:246 }, deepweb: { x:210, y:246 }, opensky: { x:294, y:246 },
  maigret: { x:180, y:296 },
  perp0: { x:42, y:378 }, exa: { x:126, y:378 }, tavily: { x:210, y:378 }, groq: { x:294, y:378 },
  gemini: { x:84, y:428 }, perpfu: { x:168, y:428 },
  semantic: { x:84, y:512 }, bayesian: { x:276, y:512 },
  graph: { x:54, y:594 }, mcts: { x:180, y:594 }, prac: { x:306, y:594 },
  pitch: { x:180, y:690 },
};

// ── Job → node mapping for live reactor state ────────────────────────────────
// 21-source interleaved atlas pipeline: 15 broad-web + 6 registry batches.
// Registry batches sit at 1-indexed positions 2,5,8,11,14,18 in DISCOVERY_SOURCES.
const ATLAS_REGISTRY_STEPS = new Set([2, 5, 8, 11, 14, 18]);

/** Map an Atlas [N/21] step + message to reactor node IDs. */
function atlasStepToNodes(stepN: number, msg: string): string[] {
  // Entity cooking -> full enrichment stack including deep-web + maigret
  if (msg.includes("cooked") || msg.includes("enrich")) {
    return ["inhouse","perp0","exa","tavily","gemini","groq","deepweb","maigret","semantic","bayesian"];
  }
  // Registry batch → ingestion nodes
  if (ATLAS_REGISTRY_STEPS.has(stepN)) {
    return ["target", ...REGISTRY_NODE_IDS];
  }
  // Broad discovery category → web + AI extraction
  return ["target","webdisc","groq"];
}

// Legacy phase map kept for non-atlas jobs / fallback
const ATLAS_PHASE_NODES: Record<number, string[]> = {
  0:  ["target","occrp","opensky","ch","brreg","edgar"],   // pre-run: OCCRP+OpenSky+CH Officers
  1:  ["target","occrp","opensky","ch"],
  2:  ["ch","inhouse","hnwi"],
  3:  ["hnwi","target","edgar"],
  4:  ["inhouse","target"],
  5:  ["webdisc","inhouse","maigret"],
  6:  ["perp0","exa","tavily","gemini","groq","maigret","webdisc","deepweb"],
  7:  ["whoxy","occrp","deepweb","opensky"],
  8:  ["semantic","bayesian","graph"],
  9:  ["semantic","bayesian","inhouse"],
  10: ["mcts","prac","graph","pitch","target"],             // MCTS generates outreach pitch
};

function rodStatus(id: string, atlasState: AtlasLiveState | null | undefined, liveNodes?: Set<string>): RodStatus {
  if (!atlasState) return liveNodes?.has(id) ? "active" : "idle";
  if (atlasState.runStatus === "failed") {
    if (liveNodes?.has(id)) return "failed";
    const wasReached = Object.entries(ATLAS_PHASE_NODES).some(([phase, ids]) => Number(phase) <= atlasState.phase && ids.includes(id));
    return wasReached ? "completed" : "skipped";
  }
  if (atlasState.runStatus === "done") return "completed";
  if (liveNodes?.has(id)) return "active";
  const wasReached = Object.entries(ATLAS_PHASE_NODES).some(([phase, ids]) => Number(phase) < atlasState.phase && ids.includes(id));
  if (wasReached) return "completed";
  const isQueued = Object.entries(ATLAS_PHASE_NODES).some(([phase, ids]) => Number(phase) >= atlasState.phase && ids.includes(id));
  return isQueued ? "queued" : "idle";
}

const JOB_NODE_MAP: Record<string, string[]> = {
  // ── Discovery / Ingestion ────────────────────────────────────────────────────
  "faa":                  ["target","faa","inhouse"],
  "land-registry":        ["target","hmlr","webdisc"],
  "western-hnwi":         ["target","hnwi","inhouse"],
  "broad-discovery":      ["target","webdisc","hnwi"],
  // Atlas orchestrator — lights up the whole input layer while running
  "atlas-run":            ["target","faa","hnwi","webdisc","ch","occrp","opensky"],
  // ── Enrichment ───────────────────────────────────────────────────────────────
  "in-house-enrich":      ["inhouse","perp0","exa"],
  "web-osint-enrich":     ["webdisc","perp0","exa","tavily","gemini","groq","maigret"],
  "deep-web-osint":       ["deepweb","gemini","perpfu"],
  "social-discovery":     ["webdisc","inhouse"],
  // ── Registry cross-reference ─────────────────────────────────────────────────
  "occrp":                ["occrp"],
  "opensky":              ["opensky","perpfu"],
  "ch-company-officers":  ["ch","inhouse"],
  "ch-officers":          ["ch","inhouse"],
  "companies-house-enrich":["ch","inhouse"],
  // ── Phase J (domain resolution + graph attribution + bayesian scoring) ───────
  "phase-j-pass":         ["semantic","bayesian","graph"],
  // ── Analysis ─────────────────────────────────────────────────────────────────
  "compute-embeddings":   ["semantic"],
  "semantic-dedup":       ["semantic","bayesian"],
  "bulk-hybrid-research": ["mcts","prac","bayesian","graph","pitch"],
  "auto-detect":          ["graph","bayesian"],
  "auto-detect-clusters": ["graph","semantic"],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fwdPath(a: NodeDef, b: NodeDef) {
  const sx = a.cx, sy = a.cy + a.h / 2;
  const tx = b.cx, ty = b.cy - b.h / 2;
  const cp = Math.min(Math.abs(ty - sy) * 0.55, 70);
  return `M ${sx} ${sy} C ${sx} ${sy + cp} ${tx} ${ty - cp} ${tx} ${ty}`;
}
function adaptPath(a: NodeDef, b: NodeDef) {
  const RAIL = 1572;
  const sx = a.cx + a.w / 2, sy = a.cy;
  const tx = b.cx + b.w / 2, ty = b.cy;
  return `M ${sx} ${sy} C ${RAIL} ${sy} ${RAIL} ${ty} ${tx} ${ty}`;
}

// ── Shared animation styles ───────────────────────────────────────────────────
const KEYFRAMES = `
  @keyframes blink     { 0%,100%{opacity:1}  50%{opacity:0.35} }
  @keyframes breathe   { 0%,100%{opacity:0.8} 50%{opacity:1}   }
  @keyframes pulseGlow { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.7;transform:scale(0.95)} }
  @keyframes scanline  { 0%{top:-2px} 100%{top:960px} }
  @keyframes dashFwd   { 0%{stroke-dashoffset:24} 100%{stroke-dashoffset:0}  }
  @keyframes dashBack  { 0%{stroke-dashoffset:0}  100%{stroke-dashoffset:22} }
  @keyframes flowDown  { 0%{stroke-dashoffset:0} 100%{stroke-dashoffset:-24} }
`;

// ── Meter (shared) ────────────────────────────────────────────────────────────
function Meter({ label, value, max, color }: { label:string; value:number; max:number; color:string }) {
  return (
    <div style={{ flex:1, padding:"0 16px", display:"flex", flexDirection:"column", gap:4 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
        <span style={{ fontSize:8, letterSpacing:"0.18em", color:"#3a5070" }}>{label}</span>
        <span style={{ fontSize:15, fontWeight:700, color, lineHeight:1 }}>{value}</span>
      </div>
      <div style={{ height:3, background:"#192840", borderRadius:2 }}>
        <div style={{
          height:"100%", width:`${Math.min((value/Math.max(max,1))*100,100)}%`,
          background:color, borderRadius:2,
          boxShadow:`0 0 8px ${color}80`, transition:"width 0.6s ease",
        }} />
      </div>
    </div>
  );
}

function QuickStat({ label, value, color, compact = false }: {
  label: string;
  value: number | string;
  color: string;
  compact?: boolean;
}) {
  return (
    <div style={{
      minWidth:0,
      padding:compact ? "4px 6px" : "5px 9px",
      border:`1px solid ${color}28`,
      borderRadius:4,
      background:`${color}08`,
      display:"flex", flexDirection:"column", gap:2,
    }}>
      <span style={{
        fontSize:compact ? 5.5 : 6.5, letterSpacing:"0.14em",
        color:"#526b86", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
      }}>
        {label}
      </span>
      <span style={{
        fontSize:compact ? 11 : 13, fontWeight:700, lineHeight:1,
        color, fontVariantNumeric:"tabular-nums",
      }}>
        {value}
      </span>
    </div>
  );
}

function QuickStats({ totalEntities, hotCount, totalAssets, sessionCount, pitchCount, compact = false }: {
  totalEntities: number;
  hotCount: number;
  totalAssets: number;
  sessionCount: number;
  pitchCount: number;
  compact?: boolean;
}) {
  return (
    <div style={{
      display:"grid",
      gridTemplateColumns:compact ? "repeat(4, minmax(0, 1fr))" : "repeat(5, minmax(72px, 1fr))",
      gap:compact ? 4 : 6,
      minWidth:0,
      flex:compact ? undefined : 1,
    }}>
      <QuickStat label="ENTITIES" value={totalEntities} color="#38bdf8" compact={compact} />
      <QuickStat label="HOT LEADS" value={hotCount} color="#a3e635" compact={compact} />
      <QuickStat label="ASSETS" value={totalAssets} color="#22d3ee" compact={compact} />
      <QuickStat label="RESEARCH" value={sessionCount} color="#a78bfa" compact={compact} />
      {!compact && <QuickStat label="OUTREACH" value={pitchCount} color="#fbbf24" />}
    </div>
  );
}

function LiveHeaderDetail({ isLive, atlasState, liveLabel, livePhaseDetail, compact = false }: {
  isLive: boolean;
  atlasState?: AtlasLiveState | null;
  liveLabel?: string;
  livePhaseDetail?: string;
  compact?: boolean;
}) {
  if (!isLive && !atlasState) return null;
  const detail = atlasState?.detail || livePhaseDetail || liveLabel || "Processing live research";
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:6, minWidth:0,
      padding:compact ? "4px 6px" : "4px 8px",
      border:`1px solid #22d3ee30`, borderRadius:4, background:"#22d3ee08",
    }}>
      <span style={{
        width:5, height:5, borderRadius:"50%", flexShrink:0,
        background:"#22d3ee", boxShadow:"0 0 7px #22d3ee",
        animation:"blink .8s ease-in-out infinite",
      }} />
      <span style={{
        fontSize:compact ? 6 : 7, letterSpacing:"0.08em", color:"#22d3ee",
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
      }}>
        {detail}
      </span>
    </div>
  );
}

// ── Mobile single node card ───────────────────────────────────────────────────
function MobileNodeCard({ n, on, dim, status = "idle", compact = false }: { n: NodeDef; on: boolean; dim?: boolean; status?: RodStatus; compact?: boolean }) {
  const isReactor = n.type === "reactor";
  const c = n.color;
  const statusColor = rodStatusColor(status, c);
  const powered = status === "active" || status === "completed";
  const muted = status === "queued" || status === "skipped";
  // dim = in-pipeline but not current active step (faint glow)
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:8,
      padding:compact ? "4px 5px" : "9px 10px",
      border:`${on?(isReactor?2:1.5):dim?1:1}px solid ${on?statusColor:dim?(statusColor+"55"):"#192840"}`,
      borderRadius: isReactor ? 10 : 6,
      background: on ? (isReactor?`${statusColor}14`:`${statusColor}0d`) : dim ? `${statusColor}0b` : "#0d1525",
      transition:"all 0.4s ease",
      boxShadow: on ? `0 0 ${isReactor?20:10}px ${statusColor}${isReactor?"44":"22"}` : dim ? `0 0 4px ${statusColor}15` : "none",
      minWidth:0, overflow:"hidden", width:"100%", height:compact ? 40 : undefined,
    }}>
      <div style={{
         width:compact ? 18 : 26, height:compact ? 18 : 26, flexShrink:0, borderRadius:5,
        border:`1px solid ${on?statusColor+"70":dim?(statusColor+"35"):"#192840"}`,
        background: on ? statusColor+"16" : dim ? statusColor+"0a" : "transparent",
        display:"flex", alignItems:"center", justifyContent:"center",
        color: on ? statusColor : dim ? statusColor+"88" : "#253850",
        transition:"all 0.4s",
      }}>
         <n.Icon style={{ width:compact ? 9 : 12, height:compact ? 9 : 12 }} />
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{
           fontSize:compact ? 6.7 : 9, fontWeight:700, letterSpacing:compact ? "0.04em" : "0.1em",
           color: on ? statusColor : dim ? statusColor+"88" : "#253850",
          transition:"color 0.4s",
           overflow:"hidden", textOverflow:"ellipsis", whiteSpace:compact ? "normal" : "nowrap",
        }}>
          {n.label}
        </div>
        <div style={{
           fontSize:compact ? 5.4 : 8, color: on ? statusColor+"99" : dim ? statusColor+"60" : "#1a2d42",
           marginTop:compact ? 0 : 1, letterSpacing:compact ? "0.02em" : "0.06em",
           overflow:"hidden", textOverflow:"ellipsis", whiteSpace:compact ? "nowrap" : "nowrap",
          transition:"color 0.4s",
        }}>
          {n.sub}
        </div>
      </div>
      <div style={{
         width:compact ? 4 : 5, height:compact ? 4 : 5, borderRadius:"50%", flexShrink:0,
         background: on ? statusColor : dim ? statusColor+"70" : "#192840",
         boxShadow: on ? `0 0 6px ${statusColor}` : dim ? `0 0 3px ${statusColor}50` : "none",
         animation: on ? "blink 1.1s ease-in-out infinite" : dim && !muted ? "breathe 2s ease-in-out infinite" : "none",
        transition:"all 0.4s",
      }} />
    </div>
  );
}

// ── CRM status colour ─────────────────────────────────────────────────────────
function crmColor(status: string) {
  switch (status) {
    case "contacted": return "#a3e635";
    case "replied":   return "#22d3ee";
    case "converted": return "#fbbf24";
    default:          return "#3a5070";
  }
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"2-digit" });
  } catch { return iso.slice(0, 10); }
}

function AtlasPhaseStrip({ state, compact = false }: { state?: AtlasLiveState | null; compact?: boolean }) {
  const activePhase = state?.phase ?? -1;
  const running = Boolean(state);
  return (
    <div style={{
      display:"flex", flexDirection:"column", gap:compact ? 5 : 7,
      minWidth:0, width:"100%",
    }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 }}>
        <span style={{ fontSize:compact ? 7 : 8, letterSpacing:"0.16em", color:"#526b86" }}>
          {running ? `ENTITY JOURNEY · PHASE ${activePhase}/10` : "ENTITY JOURNEY · 11 CHECKPOINTS · 10 PHASES"}
        </span>
        <span style={{ fontSize:compact ? 6.5 : 7, letterSpacing:"0.12em", color:running ? "#22d3ee" : "#3a5070" }}>
          {running ? (state?.sourceStep != null ? `SOURCE ${state.sourceStep}/${state.sourceTotal}` : "PROCESSING") : "STANDBY"}
        </span>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:compact ? 2 : 3 }}>
        {ATLAS_PHASES.map((phase) => {
          const complete = running && phase.n < activePhase;
          const active = running && phase.n === activePhase;
          const color = active ? "#22d3ee" : complete ? "#a3e635" : "#263d59";
          return (
            <div key={phase.n} title={`${phase.n} · ${phase.label} — ${phase.detail}`} style={{
              flex:1, minWidth:compact ? 18 : 24,
              display:"flex", flexDirection:"column", gap:3,
            }}>
              <div style={{
                height:compact ? 4 : 5, borderRadius:3,
                background:active ? `linear-gradient(90deg,#22d3ee,#a3e635)` : color,
                opacity:active || complete ? 1 : 0.55,
                boxShadow:active ? "0 0 8px #22d3ee88" : "none",
                transition:"all .35s ease",
              }} />
              <span style={{
                fontSize:compact ? 5.5 : 6.5, textAlign:"center",
                letterSpacing:"0.06em", color,
                whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
              }}>
                {phase.n}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EntityWorkbench({ state, liveNodes, compact = false }: {
  state?: AtlasLiveState | null;
  liveNodes?: Set<string>;
  compact?: boolean;
}) {
  if (!state) return null;
  const active = [...(liveNodes ?? new Set<string>())];
  const current = state.currentEntities.length > 0 ? state.currentEntities.join(" · ") : "Batch activity detected";
  const batchStart = state.entityProgress != null && state.entityTotal != null
    ? Math.min(state.entityProgress + 1, state.entityTotal)
    : null;
  const batchEnd = batchStart != null && state.entityTotal != null
    ? Math.min(batchStart + Math.max(state.currentEntities.length, 1) - 1, state.entityTotal)
    : null;
  return (
    <div style={{
      border:"1px solid #22d3ee35", borderRadius:compact ? 5 : 7,
      background:"#22d3ee08", padding:compact ? "6px 8px" : "9px 11px",
      display:"flex", flexDirection:"column", gap:compact ? 5 : 7,
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:7, minWidth:0 }}>
        <div style={{
          width:compact ? 5 : 6, height:compact ? 5 : 6, borderRadius:"50%",
          flexShrink:0, background:"#22d3ee", boxShadow:"0 0 8px #22d3ee",
          animation:"blink .8s ease-in-out infinite",
        }} />
        <span style={{ fontSize:compact ? 6.5 : 7.5, letterSpacing:"0.14em", color:"#22d3ee" }}>
          CURRENT ENTITY WORKBENCH
        </span>
        <span style={{ marginLeft:"auto", fontSize:compact ? 6 : 7, color:"#526b86", letterSpacing:"0.08em" }}>
          {state.phaseLabel}
        </span>
      </div>
      <div style={{
        fontSize:compact ? 8 : 10, fontWeight:700, color:"#e8e0cc",
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
      }}>
        {current}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
        <span style={{
          fontSize:compact ? 6 : 7, color:"#a3e635", letterSpacing:"0.09em",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1,
        }}>
          {state.detail || "Collecting evidence and passing it to the next rod"}
        </span>
        <span style={{ fontSize:compact ? 6 : 7, color:"#526b86", whiteSpace:"nowrap", textAlign:"right" }}>
          {batchStart != null ? `ENTITIES ${batchStart}–${batchEnd}/${state.entityTotal}` : `${active.length} RODS ACTIVE`}
        </span>
      </div>
    </div>
  );
}

// ── Mobile layout ─────────────────────────────────────────────────────────────
function MobileReactor({ sessions, totalEntities, hotCount, totalAssets, loading, onRefresh, syncing, liveNodes, liveLabel, livePhaseDetail, atlasState, exhaustedKeys = [] }: {
  sessions: ResearchSession[];
  totalEntities: number;
  hotCount: number;
  totalAssets: number;
  loading: boolean;
  onRefresh: () => void;
  syncing: boolean;
  liveNodes?: Set<string>;
  liveLabel?: string;
  livePhaseDetail?: string;
  atlasState?: AtlasLiveState | null;
  exhaustedKeys?: string[];
}) {
  const hasSessions = sessions.length > 0;
  const pitchCount = sessions.filter(s => s.generatedPitch).length;
  const isLive = (liveNodes?.size ?? 0) > 0 || Boolean(atlasState);

  // ── Animated dot-pulse ticker (used for banner dots only, NOT node selection) ─
  const [liveStep, setLiveStep] = useState(0);
  useEffect(() => {
    if (!isLive) { setLiveStep(0); return; }
    // Slow tick — 2.5s per step so dots pulse gently, not frantically
    const id = setInterval(() => setLiveStep(s => s + 1), 2500);
    return () => clearInterval(id);
  }, [isLive]);

  // When live: ALL liveNodes are lit simultaneously (they run in parallel, e.g. Perplexity
  // + Tavily + Exa + Maigret all fire at once during Phase 6 — show them all active)
  const liveNodesArr = isLive ? [...(liveNodes ?? new Set())] : [];

  // Historical sessions are shown below as records, not as live reactor
  // activity. A dormant pipeline keeps every rod visibly unpowered.
  const staticNodes: Set<string> = new Set();

  // activeNodes = all live nodes on simultaneously; dimNodes = nothing (all are active)
  const activeNodes: Set<string> = isLive ? (liveNodes ?? new Set()) : staticNodes;
  const dimNodes: Set<string> = new Set();

  return (
    <div style={{
      display:"flex", flexDirection:"column", width:"100%", height:"100%",
      background:"#0b1120",
      fontFamily:"'Space Mono','DM Mono','Courier New',monospace",
      overflow:"hidden",
    }}>
      <style>{KEYFRAMES}</style>

      {/* ── Header ── */}
      <header style={{
        padding:"10px 12px", borderBottom:"1px solid #192840", flexShrink:0,
        display:"flex", flexDirection:"column", alignItems:"stretch", gap:8,
        background:"rgba(11,17,32,0.95)",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
          {/* Nuclear icon */}
          <span style={{
            fontSize:32, lineHeight:1, flexShrink:0,
            color: hasSessions ? "#a3e635" : "#253850",
            textShadow: hasSessions ? "0 0 12px #a3e63544" : "none",
            animation: hasSessions ? "breathe 3s ease-in-out infinite" : "none",
            transition:"all 0.4s",
          }}>☢</span>

          <div style={{ flex:1, minWidth:0 }}>
            <div style={{
              fontSize:10, fontWeight:700, letterSpacing:"0.18em", color:"#e8e0cc",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
            }}>
              INTELLIGENCE REACTOR
            </div>
            <div style={{ fontSize:8, letterSpacing:"0.12em", color:"#3a5070", marginTop:1 }}>
              APEX ATLAS  ·  UCT RESEARCH ENGINE
            </div>
          </div>

          <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
            <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:3 }}>
              <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                <div style={{
                  width:6, height:6, borderRadius:"50%",
                  background: isLive ? "#22d3ee" : (hasSessions ? "#a3e635" : "#253850"),
                  boxShadow: isLive ? "0 0 8px #22d3ee" : (hasSessions ? "0 0 6px #a3e635" : "none"),
                  animation: (isLive || hasSessions) ? "blink 1.1s ease-in-out infinite" : "none",
                }} />
                <span style={{ fontSize:8, letterSpacing:"0.14em", color: isLive ? "#22d3ee" : (hasSessions ? "#a3e635" : "#3a5070") }}>
                  {isLive ? "LIVE" : (hasSessions ? "OPERATIONAL" : "STANDBY")}
                </span>
              </div>
              <span style={{ fontSize:7, letterSpacing:"0.1em", color:"#526b86" }}>
                {atlasState ? `PHASE ${atlasState.phase}/10` : "READY"}
              </span>
            </div>
            <button
              onClick={onRefresh}
              title="Sync"
              style={{
                width:22, height:22, borderRadius:4, border:"1px solid #253850",
                background:"transparent", cursor:"pointer",
                display:"flex", alignItems:"center", justifyContent:"center",
                color: syncing ? "#a3e635" : "#3a5070",
                transition:"all 0.25s",
                padding:0, flexShrink:0,
              }}
            >
              <RefreshCw style={{
                width:10, height:10,
                animation: syncing ? "blink 0.6s linear infinite" : "none",
              }} />
            </button>
          </div>
        </div>

        <AtlasPhaseStrip state={atlasState} compact />
        <QuickStats
          totalEntities={totalEntities}
          hotCount={hotCount}
          totalAssets={totalAssets}
          sessionCount={sessions.length}
          pitchCount={pitchCount}
          compact
        />
        <EntityWorkbench state={atlasState} liveNodes={liveNodes} compact />
        {!atlasState && (
          <LiveHeaderDetail
            isLive={isLive}
            liveLabel={liveLabel}
            livePhaseDetail={livePhaseDetail}
            compact
          />
        )}
      </header>

      {/* ── Scrollable body ── */}
      <div style={{
        flex:1, overflowY:"auto", overflowX:"hidden",
        display:"flex", flexDirection:"column",
      }}>
        {loading ? (
          // Loading state
          <div style={{
            flex:1, display:"flex", alignItems:"center", justifyContent:"center",
            flexDirection:"column", gap:10, padding:24,
          }}>
            <div style={{
              width:28, height:28, borderRadius:"50%",
              border:"2px solid #192840", borderTopColor:"#a3e635",
              animation:"blink 0.7s linear infinite",
            }} />
            <span style={{ fontSize:9, letterSpacing:"0.18em", color:"#3a5070" }}>
              LOADING SESSIONS…
            </span>
          </div>
        ) : (
          <>
             {/* ── Complete rod wall: the same route map remains visible on mobile ── */}
            <div style={{ padding:"12px 10px 0", flexShrink:0 }}>
              <div style={{
                display:"flex", alignItems:"center", justifyContent:"space-between",
                marginBottom:7, padding:"0 2px",
              }}>
                <div>
                  <div style={{ fontSize:8, letterSpacing:"0.2em", color:"#e8e0cc", fontWeight:700 }}>
                    ACTIVE ROD WALL
                  </div>
                  <div style={{ fontSize:7, letterSpacing:"0.08em", color:"#3a5070", marginTop:3 }}>
                    {isLive ? "LIVE ROUTES · PARALLEL WORKERS LIT" : "FULL PIPELINE · TAP-THROUGH DATA ROUTES"}
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:7, fontSize:6.5, letterSpacing:"0.1em", color:"#3a5070" }}>
                  <span style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
                    <i style={{ width:6, height:2, background:"#a3e635", display:"inline-block" }} /> FORWARD
                  </span>
                  <span style={{ display:"inline-flex", alignItems:"center", gap:3 }}>
                    <i style={{ width:6, height:2, background:"#22d3ee", display:"inline-block" }} /> FEEDBACK
                  </span>
                </div>
              </div>
              <div style={{
                position:"relative", width:"100%", maxWidth:360, height:738, margin:"0 auto",
                border:"1px solid #192840", borderRadius:8, overflow:"hidden",
                background:"linear-gradient(180deg,#0c1525 0%,#0a1120 100%)",
                boxShadow:"inset 0 0 40px #07101d",
              }}>
                <div style={{
                  position:"absolute", inset:0, pointerEvents:"none", opacity:0.45,
                  backgroundImage:"linear-gradient(rgba(163,230,53,0.035) 1px,transparent 1px),linear-gradient(90deg,rgba(163,230,53,0.035) 1px,transparent 1px)",
                  backgroundSize:"24px 24px",
                }} />
                <svg viewBox="0 0 360 738" preserveAspectRatio="none" style={{
                  position:"absolute", inset:0, width:"100%", height:"100%", zIndex:1, overflow:"hidden",
                }}>
                  <defs>
                    <marker id="mobileLime" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                      <path d="M0,0 L5,2.5 L0,5 z" fill="#a3e635" />
                    </marker>
                    <marker id="mobileCyan" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                      <path d="M0,0 L5,2.5 L0,5 z" fill="#22d3ee" />
                    </marker>
                  </defs>
                  {EDGES.map(e => {
                    const a = MOBILE_NODE_POS[e.from], b = MOBILE_NODE_POS[e.to];
                    if (!a || !b) return null;
                    const fromStatus = rodStatus(e.from, atlasState, liveNodes);
                    const toStatus = rodStatus(e.to, atlasState, liveNodes);
                    const active = fromStatus === "active" || toStatus === "active";
                    const completed = fromStatus === "completed" && toStatus === "completed";
                    const failed = fromStatus === "failed" || toStatus === "failed";
                    const queued = fromStatus === "queued" || toStatus === "queued";
                    const on = active || completed;
                    const col = failed ? "#fb7185" : queued ? "#526b86" : e.adaptive ? "#22d3ee" : "#a3e635";
                    const d = `M ${a.x} ${a.y + 18} C ${a.x} ${(a.y + b.y) / 2} ${b.x} ${(a.y + b.y) / 2} ${b.x} ${b.y - 18}`;
                    return (
                      <path key={e.id} d={d} fill="none" stroke={on ? col : "#20344d"}
                        strokeWidth={active ? 1.5 : on ? 1 : 0.75} opacity={active ? 0.9 : on ? 0.55 : queued || failed ? 0.5 : 0.42}
                        strokeDasharray={active ? (e.adaptive ? "5 3" : "1 0") : completed ? "1 0" : "3 5"}
                        markerEnd={active ? `url(#${e.adaptive ? "mobileCyan" : "mobileLime"})` : undefined}
                        style={active ? { animation:`${e.adaptive ? "dashBack" : "dashFwd"} 1.2s linear infinite` } : {}}
                      />
                    );
                  })}
                  {isLive && (
                    <text x="350" y="622" fill="#22d3ee88" fontSize="6" textAnchor="end"
                      fontFamily="'Space Mono',monospace" letterSpacing="0.12em"
                      transform="rotate(-90 350 622)">ADAPTIVE FEEDBACK</text>
                  )}
                </svg>
                {NODES.map(n => {
                  const pos = MOBILE_NODE_POS[n.id];
                  if (!pos) return null;
                  const isTarget = n.id === "target";
                  const isOutput = n.id === "pitch";
                  return (
                      <div key={n.id} style={{
                      position:"absolute", zIndex:2,
                      left:`${pos.x - (isTarget || isOutput ? 70 : 34)}px`,
                      top:`${pos.y - 18}px`,
                      width:isTarget || isOutput ? 140 : 68,
                    }}>
                       <MobileNodeCard
                         n={n}
                         on={rodStatus(n.id, atlasState, liveNodes) === "active"}
                         status={rodStatus(n.id, atlasState, liveNodes)}
                         dim={rodStatus(n.id, atlasState, liveNodes) !== "idle"}
                         compact={!isTarget && !isOutput}
                       />
                    </div>
                  );
                })}
                {MOBILE_PHASES.map((phase, pi) => {
                  const y = [76, 210, 342, 476, 558, 658, 724][pi];
                  return <div key={`rail-${phase.label}`} style={{
                    position:"absolute", left:20, right:10, top:y, height:1,
                    background:`linear-gradient(90deg,${phase.nodeIds.some(id => activeNodes.has(id)) ? "#a3e63530" : "#192840"},transparent)`,
                    zIndex:1,
                  }} />;
                })}
              </div>
              <div style={{
                display:"grid", gridTemplateColumns:"repeat(2, minmax(0,1fr))",
                gap:5, marginTop:8,
              }}>
                {MOBILE_PHASES.map((phase, pi) => {
                   const phaseStatuses = phase.nodeIds.map(id => rodStatus(id, atlasState, liveNodes));
                   const active = phaseStatuses.includes("active");
                   const completed = !active && phaseStatuses.some(status => status === "completed");
                   const skipped = !active && !completed && phaseStatuses.some(status => status === "skipped");
                  return <div key={`phase-note-${phase.label}`} style={{
                     border:`1px solid ${active ? "#22d3ee55" : completed ? "#a3e63545" : skipped ? "#f59e0b40" : "#192840"}`,
                     borderRadius:5, padding:"6px 7px", background:active ? "#22d3ee0b" : completed ? "#a3e6350b" : "#0c1422",
                  }}>
                     <div style={{ fontSize:6.5, letterSpacing:"0.12em", color:active ? "#22d3ee" : completed ? "#a3e635" : skipped ? "#f59e0b" : "#526b86" }}>
                      {String(pi + 1).padStart(2,"0")} · {phase.label}
                    </div>
                    <div style={{ fontSize:6.5, lineHeight:1.35, color:"#3a5070", marginTop:3 }}>
                      {phase.detail}
                    </div>
                  </div>;
                })}
              </div>
            </div>

            {/* ── Live job banner ── */}
            {isLive && (
              <div style={{
                margin:"0 12px 8px",
                padding:"7px 10px",
                border:"1px solid #22d3ee30",
                borderRadius:6,
                background:"#22d3ee0a",
                display:"flex", flexDirection:"column", gap:4,
                flexShrink:0,
              }}>
                {/* Job running label */}
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{
                    width:5, height:5, borderRadius:"50%",
                    background:"#22d3ee", boxShadow:"0 0 6px #22d3ee",
                    animation:"blink 0.6s ease-in-out infinite", flexShrink:0,
                  }} />
                  <span style={{
                    fontSize:8, letterSpacing:"0.12em", color:"#22d3ee",
                    flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                  }}>
                    {liveLabel || "JOB RUNNING"}
                  </span>
                </div>
                {/* Current pipeline step — real detail from the running job */}
                <div style={{ display:"flex", alignItems:"center", gap:6, paddingLeft:13 }}>
                  <span style={{ fontSize:7.5, letterSpacing:"0.14em", color:"#a3e63599",
                    flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    ▸ {livePhaseDetail || "processing…"}
                  </span>
                  {/* Pulse dots — one per live node */}
                  <div style={{ display:"flex", gap:2, flexShrink:0 }}>
                    {liveNodesArr.slice(0, 8).map((_, i) => (
                      <div key={i} style={{
                        width:3, height:3, borderRadius:"50%",
                        background: i === (liveStep % Math.max(liveNodesArr.length, 1)) ? "#a3e635" : "#192840",
                        boxShadow: i === (liveStep % Math.max(liveNodesArr.length, 1)) ? "0 0 4px #a3e635" : "none",
                        transition:"all 0.3s",
                      }} />
                    ))}
                  </div>
                </div>
                {/* ── Key exhaustion warning ── */}
                {exhaustedKeys.length > 0 && (
                  <div style={{
                    display:"flex", alignItems:"center", gap:6, paddingLeft:13, marginTop:2,
                  }}>
                    <span style={{
                      fontSize:7, letterSpacing:"0.12em",
                      color:"#f59e0b", opacity:0.9,
                      flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                    }}>
                      RATE LIMITED: {exhaustedKeys.join(" · ")}
                    </span>
                  </div>
                )}
              </div>
            )}
            {/* Key exhaustion warning when idle (no live job) */}
            {!isLive && exhaustedKeys.length > 0 && (
              <div style={{
                margin:"0 12px 8px", padding:"5px 10px",
                border:"1px solid #f59e0b30", borderRadius:6, background:"#f59e0b08",
                display:"flex", alignItems:"center", gap:6, flexShrink:0,
              }}>
                <span style={{ fontSize:7, letterSpacing:"0.12em", color:"#f59e0b" }}>
                  RATE LIMITED: {exhaustedKeys.join(" · ")}
                </span>
              </div>
            )}

            {/* ── Sessions section ── */}
            <div style={{ padding:"8px 12px 12px", flexShrink:0 }}>
              {/* Section header */}
              <div style={{
                display:"flex", alignItems:"center", justifyContent:"space-between",
                marginBottom:8, marginTop:4,
              }}>
                <div style={{
                  fontSize:8, letterSpacing:"0.22em", color:"#3a5070",
                  display:"flex", alignItems:"center", gap:6,
                }}>
                  <div style={{ width:1, flex:1, height:1, background:"#192840" }} />
                  RESEARCH SESSIONS
                  <div style={{ width:1, flex:1, height:1, background:"#192840" }} />
                </div>
              </div>

              {!hasSessions ? (
                // Standby state
                <div style={{
                  padding:"18px 14px",
                  border:"1px solid #192840",
                  borderRadius:8,
                  background:"#0c1320",
                  display:"flex", flexDirection:"column", alignItems:"center",
                  gap:10, textAlign:"center",
                }}>
                  <Cpu style={{ width:22, height:22, color:"#253850" }} />
                  <div>
                    <div style={{ fontSize:9, fontWeight:700, letterSpacing:"0.16em", color:"#253850", marginBottom:4 }}>
                      NO SESSIONS YET
                    </div>
                    <div style={{ fontSize:8, color:"#1e3050", letterSpacing:"0.08em", lineHeight:1.6 }}>
                      Run Hybrid Research from a profile{"\n"}to see real UCT work here.
                    </div>
                  </div>
                </div>
              ) : (
                // Real session list
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {sessions.slice(0, 12).map(s => (
                    <div key={s.id} style={{
                      padding:"10px 12px",
                      border:"1px solid #192840",
                      borderRadius:7,
                      background:"#0d1525",
                      display:"flex", flexDirection:"column", gap:6,
                    }}>
                      {/* Row 1: name + status */}
                      <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
                        <Cpu style={{ width:11, height:11, color:"#a78bfa", flexShrink:0 }} />
                        <div style={{
                          flex:1, minWidth:0,
                          fontSize:10, fontWeight:700, letterSpacing:"0.1em",
                          color:"#c4b8a0",
                          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                        }}>
                          {s.targetEntityName ?? `Session #${s.id}`}
                        </div>
                        <div style={{
                          fontSize:8, letterSpacing:"0.12em", flexShrink:0,
                          color: crmColor(s.crmStatus),
                          padding:"2px 6px", border:`1px solid ${crmColor(s.crmStatus)}40`,
                          borderRadius:3, background:`${crmColor(s.crmStatus)}10`,
                        }}>
                          {s.crmStatus.toUpperCase()}
                        </div>
                      </div>

                      {/* Row 2: metrics */}
                      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                        {s.pathScore != null && (
                          <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                            <span style={{ fontSize:7, letterSpacing:"0.14em", color:"#3a5070" }}>PATH SCORE</span>
                            <span style={{ fontSize:12, fontWeight:700, color:"#a3e635", lineHeight:1 }}>
                              {s.pathScore.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {s.bayesianScoreAtRuntime != null && (
                          <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                            <span style={{ fontSize:7, letterSpacing:"0.14em", color:"#3a5070" }}>SIGNAL</span>
                            <span style={{ fontSize:12, fontWeight:700, color:"#38bdf8", lineHeight:1 }}>
                              {s.bayesianScoreAtRuntime.toFixed(1)}
                            </span>
                          </div>
                        )}
                        {s.generatedPitch && (
                          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                            <Target style={{ width:9, height:9, color:"#fbbf24" }} />
                            <span style={{ fontSize:8, letterSpacing:"0.1em", color:"#fbbf24" }}>PITCH READY</span>
                          </div>
                        )}
                        <div style={{ marginLeft:"auto", fontSize:8, color:"#253850", letterSpacing:"0.08em" }}>
                          {formatDate(s.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))}

                  {sessions.length > 12 && (
                    <div style={{
                      textAlign:"center", fontSize:8, letterSpacing:"0.14em",
                      color:"#253850", padding:"6px 0",
                    }}>
                      +{sessions.length - 12} MORE SESSIONS
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

    </div>
  );
}

// ── Desktop layout ────────────────────────────────────────────────────────────
function DesktopReactor({ liveNodes, liveLabel, livePhaseDetail, atlasState, isLive, totalEntities, hotCount, totalAssets, sessionCount, pitchCount, latestStatus }: {
  liveNodes?: Set<string>; liveLabel?: string; isLive?: boolean;
  livePhaseDetail?: string;
  atlasState?: AtlasLiveState | null;
  totalEntities?: number; hotCount?: number; totalAssets?: number;
  sessionCount?: number; pitchCount?: number;
  latestStatus?: string;
}) {
  // Only live job state lights rods. Standby never simulates an entity moving
  // through the reactor.
  const AN = (isLive && liveNodes && liveNodes.size > 0) ? liveNodes : new Set<string>();
  // Live routes are derived from the active rods so the lines never imply work
  // that is not currently represented by the job state.
  const AE = isLive && liveNodes && liveNodes.size > 0
    ? new Set(EDGES.filter(e => liveNodes.has(e.from) || liveNodes.has(e.to)).map(e => e.id))
    : new Set<string>();
  const adaptive = Boolean(isLive && liveNodes && liveNodes.size > 0);

  return (
    <div style={{
      width:"100%", height:"100%", minWidth:1600, minHeight:960,
      background:"#0b1120",
      fontFamily:"'Space Mono','DM Mono','Courier New',monospace",
      display:"flex", flexDirection:"column",
      overflow:"hidden", position:"relative",
    }}>
      {/* Grid overlay */}
      <div style={{
        position:"absolute", inset:0, pointerEvents:"none", zIndex:0,
        backgroundImage:"linear-gradient(rgba(163,230,53,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(163,230,53,0.025) 1px,transparent 1px)",
        backgroundSize:"42px 42px",
      }} />
      {/* Scan-line */}
      <div style={{
        position:"absolute", left:0, right:0, height:2, pointerEvents:"none", zIndex:1,
        background:"linear-gradient(transparent,rgba(163,230,53,0.07) 50%,transparent)",
        animation:"scanline 8s linear infinite",
      }} />

      {/* Header: all quick progress stays above the reactor canvas. */}
      <header style={{
        height:112, borderBottom:"1px solid #192840", zIndex:20, flexShrink:0,
        display:"flex", flexDirection:"column", alignItems:"stretch",
        justifyContent:"center", padding:"8px 24px", gap:7,
        background:"rgba(11,17,32,0.92)", backdropFilter:"blur(8px)",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:16, minWidth:0 }}>
          <div style={{
            width:34, height:34, borderRadius:"50%", flexShrink:0,
            border:`2px solid ${adaptive ? "#22d3ee" : "#a3e635"}`,
            display:"flex", alignItems:"center", justifyContent:"center",
            lineHeight:1, color: adaptive ? "#22d3ee" : "#a3e635", fontSize:18,
            boxShadow:`0 0 14px ${adaptive ? "#22d3ee55" : "#a3e63555"}`,
            animation: adaptive ? "pulseGlow 0.7s ease-in-out infinite" : "breathe 3s ease-in-out infinite",
          }}>
            <span style={{ lineHeight:1, display:"block", marginTop:1 }}>☢</span>
          </div>
          <div style={{ minWidth:230, flexShrink:0 }}>
            <div style={{ fontSize:12, fontWeight:700, letterSpacing:"0.2em", color:"#e8e0cc" }}>
              APEX ATLAS  —  INTELLIGENCE REACTOR
            </div>
            <div style={{ fontSize:8, letterSpacing:"0.16em", color:"#3a5070", marginTop:2 }}>
              ADAPTIVE RESEARCH ENGINE  ·  TARGET-AWARE MODE
            </div>
          </div>
          <div style={{ flex:1, minWidth:260 }}>
            <AtlasPhaseStrip state={atlasState} compact />
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:16, flexShrink:0 }}>
            <div style={{
              padding:"4px 10px", borderRadius:4,
              border:`1px solid ${isLive ? "#22d3ee40" : "#a3e63530"}`,
              background: isLive ? "#22d3ee0e" : "#a3e6350a",
              display:"flex", alignItems:"center", gap:6,
            }}>
              <div style={{
                width:7, height:7, borderRadius:"50%",
                background: isLive ? "#22d3ee" : "#a3e635",
                boxShadow:`0 0 8px ${isLive ? "#22d3ee" : "#a3e635"}`,
                animation:"blink 1.1s ease-in-out infinite",
              }} />
              <span style={{ fontSize:8, letterSpacing:"0.18em", color: isLive ? "#22d3ee" : "#a3e635" }}>
                {isLive ? "ATLAS LIVE" : "NOMINAL"}
              </span>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:7, letterSpacing:"0.16em", color:"#3a5070" }}>ENTITY FLOW</div>
              <div style={{ fontSize:11, fontWeight:700, color:isLive ? "#22d3ee" : "#3a5070", lineHeight:1, marginTop:3, letterSpacing:"0.12em" }}>
                {atlasState ? `${atlasState.phase}/10` : "IDLE"}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
          <div style={{ flex:1, minWidth:0 }}>
            <QuickStats
              totalEntities={totalEntities ?? 0}
              hotCount={hotCount ?? 0}
              totalAssets={totalAssets ?? 0}
              sessionCount={sessionCount ?? 0}
              pitchCount={pitchCount ?? 0}
            />
          </div>
          <EntityWorkbench state={atlasState} liveNodes={liveNodes} compact />
          {!atlasState && (
            <LiveHeaderDetail
              isLive={Boolean(isLive)}
              liveLabel={liveLabel}
              livePhaseDetail={livePhaseDetail}
              compact
            />
          )}
        </div>
      </header>

      {/* Main panel */}
      <div style={{ flex:1, position:"relative", zIndex:5, overflow:"hidden" }}>
        {/* SVG connections */}
        <svg width={1600} height={842} style={{ position:"absolute", inset:0, zIndex:1 }}>
          <defs>
            <marker id="mLime2" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
              <path d="M0,0.5 L0,6.5 L7,3.5 z" fill="#a3e635cc" />
            </marker>
            <marker id="mCyan2" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
              <path d="M0,0.5 L0,6.5 L7,3.5 z" fill="#22d3eecc" />
            </marker>
            <marker id="mDim2" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
              <path d="M0,0.5 L0,6.5 L7,3.5 z" fill="#192840bb" />
            </marker>
          </defs>
          {EDGES.map(e => {
            const A = NM[e.from], B = NM[e.to];
            if (!A || !B) return null;
            const fromStatus = rodStatus(e.from, atlasState, liveNodes);
            const toStatus = rodStatus(e.to, atlasState, liveNodes);
            const active = fromStatus === "active" || toStatus === "active";
            const complete = fromStatus === "completed" && toStatus === "completed";
            const failed = fromStatus === "failed" || toStatus === "failed";
            const queued = fromStatus === "queued" || toStatus === "queued";
            const on = AE.has(e.id) || complete;
            const d   = e.adaptive ? adaptPath(A, B) : fwdPath(A, B);
            const col = failed ? "#fb7185" : queued ? "#526b86" : e.adaptive ? "#22d3ee" : "#a3e635";
            const mk  = on ? (e.adaptive ? "url(#mCyan2)" : "url(#mLime2)") : "url(#mDim2)";
            return (
              <path key={e.id} d={d} fill="none"
                stroke={col}
                strokeWidth={active ? (e.adaptive ? 2 : 1.5) : on ? 1 : 1}
                strokeDasharray={active ? (e.adaptive ? "7 4" : "0") : complete ? "0" : "4 5"}
                opacity={active ? 0.92 : on ? 0.5 : queued || failed ? 0.45 : 0.22}
                markerEnd={mk}
                style={active ? {
                  filter:`drop-shadow(0 0 ${e.adaptive?5:3}px ${col})`,
                  animation: e.adaptive ? "dashBack 1s linear infinite" : "dashFwd 1.2s linear infinite",
                } : {}}
              />
            );
          })}
          {adaptive && (
            <text x={1580} y={600} fill="#22d3ee88" fontSize={8.5}
              fontFamily="'Space Mono',monospace" letterSpacing="0.15em"
              transform="rotate(90,1580,600)">
              ADAPTIVE FEEDBACK RAIL
            </text>
          )}
        </svg>

        {/* Nodes */}
        {NODES.map(n => {
          const status = rodStatus(n.id, atlasState, liveNodes);
          const on = status === "active";
          const isReactor = n.type === "reactor";
          const c = n.color;
          const statusColor = rodStatusColor(status, c);
          const visible = status !== "idle";
          return (
            <div key={n.id} style={{
              position:"absolute",
              left: n.cx - n.w / 2, top: n.cy - n.h / 2,
              width: n.w, height: n.h, zIndex:2,
              border:`${on?(isReactor?2:1.5):1}px solid ${visible?statusColor:"#192840"}`,
              borderRadius: isReactor ? 12 : 6,
              background: on ? (isReactor?`${statusColor}14`:`${statusColor}0d`) : visible ? `${statusColor}08` : (isReactor?"#0c1830":"#0d1525"),
              padding:"0 10px",
              display:"flex", alignItems:"center", gap:9,
              transition:"all 0.35s ease",
              boxShadow: on
                ? `0 0 ${isReactor?28:14}px ${statusColor}${isReactor?"55":"30"},inset 0 0 ${isReactor?20:10}px ${statusColor}12`
                : "none",
            }}>
              <div style={{
                width:30, height:30, flexShrink:0, borderRadius:5,
                border:`1px solid ${visible?statusColor+"50":"#192840"}`,
                background: visible ? statusColor+"12" : "transparent",
                display:"flex", alignItems:"center", justifyContent:"center",
                color: visible ? statusColor : "#253850", transition:"all 0.35s",
              }}>
                <n.Icon style={{ width:14, height:14 }} />
              </div>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{
                  fontSize: isReactor ? 11 : 9.5, fontWeight:700,
                  letterSpacing: isReactor?"0.14em":"0.12em",
                  color: visible ? statusColor : "#253850", lineHeight:1.2,
                  transition:"color 0.35s", whiteSpace:"nowrap",
                }}>
                  {isReactor && on ? "◉  " : ""}{n.label}
                </div>
                <div style={{
                  fontSize:7.5, letterSpacing:"0.1em",
                  color: visible ? statusColor+"99" : "#1a2d42",
                  marginTop:3, lineHeight:1.2,
                  transition:"color 0.35s", whiteSpace:"nowrap",
                }}>
                  {n.sub}
                </div>
              </div>
              <div style={{
                width:6, height:6, borderRadius:"50%", flexShrink:0,
                background: on ? c : "#192840",
                boxShadow: on ? `0 0 8px ${c}` : "none",
                animation: on ? "blink 1.1s ease-in-out infinite" : "none",
                transition:"all 0.35s",
              }} />
            </div>
          );
        })}

        {/* Section labels */}
        {[
          {y:178,label:"REGISTRIES"},{y:298,label:"DISCOVERY"},
          {y:420,label:"AI  ANALYSIS"},{y:540,label:"SYNTHESIS"},
          {y:652,label:"CORE"},{y:768,label:"OUTPUT"},
        ].map(({y,label}) => (
          <div key={label} style={{
            position:"absolute", left:8, top:y-6,
            fontSize:7, letterSpacing:"0.22em", color:"#1e3050",
            writingMode:"vertical-rl", transform:"rotate(180deg)",
            zIndex:3, height:12, lineHeight:1,
          }}>{label}</div>
        ))}

        {/* Horizontal dividers */}
        {[236,356,478,600,716].map(y => (
          <div key={y} style={{
            position:"absolute", left:28, right:28, top:y, height:1,
            background:"linear-gradient(90deg,transparent,#192840 20%,#192840 80%,transparent)",
            zIndex:2, opacity:0.6,
          }} />
        ))}

      </div>

      <style>{KEYFRAMES}</style>
    </div>
  );
}

// ── Shared breakpoint hook ────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

// ── Page wrapper ──────────────────────────────────────────────────────────────
export default function IntelligenceReactorPage() {
  const isMobile = useIsMobile();

  // ── Real data for mobile ──────────────────────────────────────────────────
  const [sessions,      setSessions]      = useState<ResearchSession[]>([]);
  const [totalEntities, setTotalEntities] = useState(0);
  const [loadingData,   setLoadingData]   = useState(true);
  const [syncing,       setSyncing]       = useState(false);
  const [liveNodes,        setLiveNodes]        = useState<Set<string>>(new Set());
  const [liveLabel,        setLiveLabel]        = useState<string>("");
  const [livePhaseDetail,  setLivePhaseDetail]  = useState<string>("");
  const [atlasState,       setAtlasState]       = useState<AtlasLiveState | null>(null);
  const [exhaustedKeys,    setExhaustedKeys]    = useState<string[]>([]);

  const pollJobs = useCallback(async () => {
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
    try {
      // Poll jobs, atlas status, AND key health in parallel
      const [jobsData, atlasData, sysData] = await Promise.all([
        fetch(`${BASE}/api/ingest/jobs`, { cache: "no-store" })
          .then(r => r.ok ? r.json() : { jobs: [] })
          .catch(() => ({ jobs: [] })),
        fetch(`${BASE}/api/ingest/atlas-status`, { cache: "no-store" })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null),
        fetch(`${BASE}/api/system/status`, { cache: "no-store" })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null),
      ]);

      // ── Key exhaustion ────────────────────────────────────────────────────────
      if (sysData?.ai) {
        const LABELS: Record<string, string> = { groq: "Groq", perplexity: "Perplexity", gemini: "Gemini", tavily: "Tavily", exa: "Exa" };
        const down = (Object.entries(sysData.ai) as [string, any[]][])
          .filter(([, slots]) => slots.length > 0 && slots.every((s: any) => s.state === "exhausted" || s.state === "missing"))
          .map(([k]) => LABELS[k] ?? k);
        const partial = (Object.entries(sysData.ai) as [string, any[]][])
          .filter(([, slots]) => slots.some((s: any) => s.state === "exhausted") && slots.some((s: any) => s.state === "active"))
          .map(([k]) => `${LABELS[k] ?? k}↓`);
        setExhaustedKeys([...down, ...partial]);
      }

      const nodes = new Set<string>();
      const labels: string[] = [];
      let nextAtlasState: AtlasLiveState | null = null;

      // ── Atlas job (step + content-aware for 21-source pipeline) ─────────────
      if (atlasData?.status === "running" && atlasData?.jobId) {
        const msg: string = atlasData.message ?? "";
        const structured = parseAtlasLiveState(
          msg,
          Number(atlasData.atlasPhase ?? atlasData.progress ?? 0),
          Number(atlasData.atlasPhaseTotal ?? 10),
        );
        const structuredNames = parseEntityNames(atlasData.entityNames);
        nextAtlasState = {
          ...structured,
          entityProgress: atlasData.entityProgress != null ? Number(atlasData.entityProgress) : null,
          entityTotal: atlasData.entityTotal != null ? Number(atlasData.entityTotal) : null,
          currentEntities: structuredNames.length > 0 ? structuredNames : structured.currentEntities,
          atlasTelemetry: parseAtlasTelemetry(atlasData.atlasTelemetry),
        };
        // New format: [N/21] label… or [N/21] 🍳 EntityName (x/y)…
        const stepMatch = msg.match(/\[(\d+)\/(\d+)\]/);
        if (stepMatch) {
          const stepN  = parseInt(stepMatch[1], 10);
          const total  = parseInt(stepMatch[2], 10);
          atlasStepToNodes(stepN, msg).forEach((n: string) => nodes.add(n));
          const detail = msg.slice(stepMatch[0].length).trim().replace(/…$/, "");
          labels.push(`▶ [${stepN}/${total}] ${detail.slice(0, 65)}`);
          setLivePhaseDetail(`Step ${stepN}/${total} — ${detail.slice(0, 80)}`);
        } else {
          // Entity-level enrichment messages (inner loop overwrites outer [N/21])
          // Detect enrichment phase from message keywords / emojis.
          // Rules are additive — multiple can match so all relevant nodes light.
          const enrichNodes: string[] = [];
          // ── Full-circle enrichment phases ────────────────────────────────────
          // Maigret/Holehe = Phase D; Phases A–C already ran for this entity,
          // so light the whole stack — this is accurate and avoids a dark reactor.
          if (/Maigret|Holehe|🕵/.test(msg))
            enrichNodes.push("maigret","inhouse","deepweb","perp0","exa","tavily","gemini","groq");
          if (/AI OSINT|web.enrich|web.osint/i.test(msg))
            enrichNodes.push("perp0","exa","tavily","gemini","groq","inhouse","deepweb");
          if (/🍳/.test(msg))
            enrichNodes.push("inhouse","perp0","exa","tavily","gemini","groq","deepweb","maigret","semantic","bayesian");
          // ── Individual AI providers ───────────────────────────────────────────
          if (/Perplexity|Sonar/i.test(msg))              enrichNodes.push("perp0","perpfu");
          if (/Gemini/i.test(msg))                        enrichNodes.push("gemini");
          if (/Tavily/i.test(msg))                        enrichNodes.push("tavily");
          if (/\bExa\b/i.test(msg))                       enrichNodes.push("exa");
          if (/Groq|Llama/i.test(msg))                    enrichNodes.push("groq");
          // ── Tool-specific phases ──────────────────────────────────────────────
          if (/In-house|Wikidata|GitHub|RDAP/i.test(msg)) enrichNodes.push("inhouse");
          if (/deep.web|multi.source/i.test(msg))         enrichNodes.push("deepweb","gemini","perpfu");
          if (/OCCRP|Aleph|sanction/i.test(msg))          enrichNodes.push("occrp");
          if (/OpenSky|flight|aircraft/i.test(msg))       enrichNodes.push("opensky");
          if (/Whoxy|WHOIS|forensic/i.test(msg))          enrichNodes.push("whoxy","deepweb","occrp");
          if (/ICIJ|offshore|leak/i.test(msg))            enrichNodes.push("occrp","deepweb");
          // ── Analysis + synthesis phases ───────────────────────────────────────
          if (/Phase J|footprint|attrib/i.test(msg))      enrichNodes.push("semantic","bayesian","graph");
          if (/domain.resol|digital.foot/i.test(msg))     enrichNodes.push("semantic","bayesian","graph");
          if (/confidence|cookedAt|scoring|embed/i.test(msg)) enrichNodes.push("semantic","bayesian");
          if (/MCTS|UCT|research.*target|hot.lead/i.test(msg)) enrichNodes.push("mcts","prac","graph","pitch");
          if (/graph|cluster|relation/i.test(msg))        enrichNodes.push("graph","semantic");
          // ── Fallback: legacy Phase X/10 format ───────────────────────────────
          if (enrichNodes.length === 0) {
            const phaseMatch = msg.match(/Phase\s+(\d+)/i);
            const phase = phaseMatch ? parseInt(phaseMatch[1], 10) : 0;
            (ATLAS_PHASE_NODES[phase] ?? ATLAS_PHASE_NODES[0]).forEach((n: string) => enrichNodes.push(n));
          }
          enrichNodes.forEach((n: string) => nodes.add(n));
          labels.push(`▶ Atlas — ${msg.replace(/^Phase \d+\/[^:]+:\s*/i, "").slice(0, 70)}`);
          setLivePhaseDetail(msg.slice(0, 90));
        }
      }

      // ── Regular jobs ─────────────────────────────────────────────────────────
      const running = (jobsData.jobs ?? []).filter((j: any) =>
        j.status === "running" || j.status === "active"
      );
      for (const job of running) {
        (JOB_NODE_MAP[job.id] ?? []).forEach((n: string) => nodes.add(n));
        if (job.label) labels.push(job.label);
      }

      if (nodes.size > 0) {
        setLiveNodes(nodes);
        setLiveLabel(labels.join(" · "));
      } else {
        setLiveNodes(new Set());
        setLiveLabel("");
        setLivePhaseDetail("");
      }
      setAtlasState(nextAtlasState);
    } catch { /* non-fatal */ }
  }, []);

  // Poll live jobs every 3 s so nodes light up as research runs
  useEffect(() => {
    pollJobs();
    const id = setInterval(pollJobs, 3_000);
    return () => clearInterval(id);
  }, [pollJobs]);

  const fetchData = useCallback(async (isBackground = false) => {
    if (isBackground) {
      setSyncing(true);
    }
    const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
    try {
      const [sess, stats] = await Promise.all([
        fetch(`${BASE}/api/research/sessions?limit=20`, { cache: "no-store" }).then(r => r.ok ? r.json() : []).catch(() => []),
        fetch(`${BASE}/api/dashboard/stats`, { cache: "no-store" }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
      ]);
      setSessions(Array.isArray(sess) ? sess : []);
      const s = stats as { totalEntities?: number; hotLeadsCount?: number; totalAssets?: number };
      setTotalEntities(s?.totalEntities ?? 0);
      setHotCount(s?.hotLeadsCount ?? 0);
      setTotalAssets(s?.totalAssets ?? 0);
    } finally {
      setLoadingData(false);
      setSyncing(false);
    }
  }, []);

  // Initial load
  useEffect(() => { fetchData(false); }, [fetchData]);

  // Auto-poll every 10 s so the reactor stays live after research completes
  useEffect(() => {
    const id = setInterval(() => fetchData(true), 10_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // ── Desktop canvas sizing ─────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale,    setScale]    = useState(1);
  const [signals] = useState(0);
  const [contacts] = useState(0);
  const [loops] = useState(0);
  const [hotCount,    setHotCount]    = useState(0);
  const [totalAssets, setTotalAssets] = useState(0);

  useEffect(() => {
    if (isMobile) return;
    const measure = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      setScale(Math.min(width / 1600, height / 960));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [isMobile]);

  // ── Mobile ────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display:"flex", flexDirection:"column", height:"100%", minHeight:0, overflow:"hidden", width:"100%" }}>
        <MobileReactorFlow
          sessions={sessions}
          totalEntities={totalEntities}
          hotCount={hotCount}
          totalAssets={totalAssets}
          loading={loadingData}
          onRefresh={() => fetchData(true)}
          syncing={syncing}
          liveNodes={liveNodes}
          liveLabel={liveLabel}
          livePhaseDetail={livePhaseDetail}
          atlasState={atlasState}
          exhaustedKeys={exhaustedKeys}
        />
      </div>
    );
  }

  // ── Desktop ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{ position:"absolute", inset:0, overflow:"hidden", background:"#0b1120", isolation:"isolate" }}
    >
      <div style={{ position:"relative", overflow:"hidden", width:"100%", height:"100%" }}>
        <div style={{ transformOrigin:"top left", transform:`scale(${scale})`, width:1600, height:960 }}>
        <DesktopReactor
          liveNodes={liveNodes} liveLabel={liveLabel} livePhaseDetail={livePhaseDetail} atlasState={atlasState}
          isLive={liveNodes.size > 0 || Boolean(atlasState)}
          totalEntities={totalEntities} hotCount={hotCount} totalAssets={totalAssets}
          sessionCount={sessions.length}
          pitchCount={sessions.filter(s => Boolean(s.generatedPitch)).length}
        />
        </div>
      </div>
    </div>
  );
}
