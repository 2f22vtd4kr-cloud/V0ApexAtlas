import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getScoreColor(score: number) {
  if (score >= 0.8) return "text-primary border-primary bg-primary/10";
  if (score >= 0.5) return "text-amber-500 border-amber-500/50 bg-amber-500/10";
  return "text-muted-foreground border-border bg-muted";
}

export function getScoreBarColor(score: number) {
  if (score >= 0.8) return "bg-primary";
  if (score >= 0.5) return "bg-amber-500";
  return "bg-muted-foreground";
}

export function formatCurrency(value: number | null | undefined) {
  if (value == null) return "Unknown";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString()}`;
}

export function ScoreBadge({ score }: { score: number | null | undefined }) {
  // Registry confidence score — how many independent public registries confirm this person
  if (score == null) return null;
  const colorClasses = getScoreColor(score);
  const pct = Math.round(score * 100);
  const label = pct >= 70 ? "Multi-registry" : pct >= 40 ? "Single-registry" : "Unverified";
  return (
    <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono border ${colorClasses}`}
         title={`Registry confidence ${pct}/100 — strength of public registry verification. Higher means more independent sources confirm this person's wealth profile.`}>
      <span className="font-bold tabular-nums">{pct}</span>
      <span className="opacity-50 text-[9px] uppercase tracking-wide leading-none">{label}</span>
    </div>
  );
}

export function AccessScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null || typeof score !== "number" || isNaN(score)) return null;
  const pct = Math.round(score * 100);
  
  // Derive label + color from score bands
  let label: string;
  let colorClass: string;
  
  if (pct === 0) {
    label = "No vector";
    colorClass = "text-muted-foreground border-border bg-muted/30";
  } else if (pct < 30) {
    label = "Weak";
    colorClass = "text-orange-400 border-orange-400/20 bg-orange-400/8";
  } else if (pct < 60) {
    label = "Reachable";
    colorClass = "text-amber-400 border-amber-400/30 bg-amber-400/8";
  } else if (pct < 85) {
    label = "Strong";
    colorClass = "text-primary border-primary/30 bg-primary/8";
  } else {
    label = "Direct";
    colorClass = "text-primary border-primary bg-primary/15";
  }
  
  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono border ${colorClass}`}
      title={`Access score ${pct}/100 — how realistically this person can be reached through public contact evidence`}
      data-testid="badge-access-score"
    >
      <span className="font-bold tabular-nums text-[11px]">{pct}</span>
      <span className="opacity-60 text-[9px] uppercase tracking-wide leading-none">{label}</span>
    </div>
  );
}

export function ConfidenceBadge({ score }: { score: number | null | undefined }) {
  // Contact confidence — how trustworthy the extracted contact data itself is
  // (email/phone/social evidence quality), distinct from Access (reachability)
  // and Signal (wealth/registry evidence). This is the primary surfaced metric
  // for prioritizing outreach — see reachability-rank.ts on the API side.
  if (score == null || typeof score !== "number" || isNaN(score)) return null;
  const pct = Math.round(score);

  let label: string;
  let colorClass: string;
  if (pct === 0) {
    label = "None";
    colorClass = "text-muted-foreground border-border bg-muted/30";
  } else if (pct < 30) {
    label = "Low";
    colorClass = "text-orange-400 border-orange-400/20 bg-orange-400/8";
  } else if (pct < 60) {
    label = "Moderate";
    colorClass = "text-amber-400 border-amber-400/30 bg-amber-400/8";
  } else if (pct < 85) {
    label = "High";
    colorClass = "text-primary border-primary/30 bg-primary/8";
  } else {
    label = "Verified";
    colorClass = "text-primary border-primary bg-primary/15";
  }

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono border ${colorClass}`}
      title={`Contact confidence ${pct}/100 — how trustworthy the discovered contact data is`}
      data-testid="badge-confidence-score"
    >
      <span className="font-bold tabular-nums text-[11px]">{pct}</span>
      <span className="opacity-60 text-[9px] uppercase tracking-wide leading-none">{label}</span>
    </div>
  );
}

export function formatRegistry(source: string | null | undefined) {
  if (!source) return "Unknown";
  return source.split(',').map(s => s.trim()).join(' / ');
}

/**
 * Display-formats entity names stored as ALL CAPS (FAA/EDGAR style).
 * "THIEL PETER" → "Thiel Peter"  |  "Chadwick John Huston" → unchanged
 */
export function formatEntityName(name: string | null | undefined): string {
  if (!name) return "Unknown";
  // Already mixed-case → leave as-is
  if (/[a-z]/.test(name)) return name;
  // ALL CAPS → title-case each word
  return name
    .toLowerCase()
    .replace(/\b([a-z])/g, c => c.toUpperCase());
}

/**
 * Cleans up verbose raw signal text from SEC EDGAR / FAA ingestors.
 * "Source: SEC EDGAR — SC 13G. Filing type: SC 13G." → "SEC EDGAR — SC 13G filing"
 * "Aviation: Jet — N112AE · FAA Releasable Aircraft Database" → unchanged
 */
export function formatSignal(signal: string | null | undefined): string {
  if (!signal) return "No signal";
  return signal
    .replace(/^Source:\s*/i, "")                          // strip "Source: " prefix
    .replace(/\.\s*Filing type:\s*[\w\s\d]+\./gi, " filing") // collapse duplicate filing type
    .replace(/\.$/, "")                                   // trailing period
    .trim();
}

type EntityNarrative = {
  type?: string | null;
  nationality?: string | null;
  knownResidences?: string | null;
  notes?: string | null;
  linkedinHeadline?: string | null;
  twitterBio?: string | null;
  telegramBio?: string | null;
  personalWebsite?: string | null;
  foundationName?: string | null;
  sourceRegistries?: string | string[] | null;
  signal?: string | null;
  assetCount?: number | null;
  assetCategories?: string[] | null;
  relationshipCount?: number | null;
};

function narrativeText(value: unknown, max = 220): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").replace(/^[-–—|:]\s*/, "").trim();
  if (!text || text.length < 4) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function noteField(notes: string | null | undefined, field: string): string | null {
  if (!notes) return null;
  const match = notes.match(new RegExp(`${field}:\\s*(.*?)(?=\\s+(?:Source|Filing|Company|Nationality|Location|Entity type):|$)`, "i"));
  return narrativeText(match?.[1], 180);
}

function filingLabel(notes: string | null | undefined): string | null {
  const filing = noteField(notes, "Filing");
  return filing ? filing.replace(/\s*\([^)]*\)\s*$/, "").trim() : null;
}

function companyFromNotes(notes: string | null | undefined): string | null {
  return noteField(notes, "Company");
}

function cleanCategory(category: string): string {
  return category
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

export function parseEntityRegistries(value: EntityNarrative["sourceRegistries"]): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function entityWorkSummary(entity: EntityNarrative): string | null {
  const publicRole = narrativeText(entity.twitterBio)
    ?? narrativeText(entity.telegramBio)
    ?? narrativeText(entity.linkedinHeadline)
  if (publicRole) return `Public role or activity: ${publicRole}`;

  const filing = filingLabel(entity.notes);
  const company = companyFromNotes(entity.notes);
  if (filing && company) return `Public filing activity: ${filing} connected to ${company}.`;
  if (company) return `Public company record connected to ${company}.`;
  if (filing) return `Public filing activity recorded: ${filing}.`;

  const categories = Array.from(new Set((entity.assetCategories ?? []).filter(Boolean).map(cleanCategory)));
  if (categories.length > 0) return `Recorded activity includes ${categories.slice(0, 3).join(", ")}.`;

  const foundation = narrativeText(entity.foundationName, 150);
  if (foundation) return `Documented foundation activity: ${foundation}.`;

  const registry = parseEntityRegistries(entity.sourceRegistries);
  const labels = Array.from(new Set(
    registry.flatMap((source) => INVOLVEMENT_LABELS.filter(([pattern]) => pattern.test(source)).map(([, label]) => label)),
  ));
  if (labels.length > 0) return `Public records indicate ${labels.slice(0, 2).join(" and ")}.`;
  return null;
}

/** Backward-compatible alias for card consumers that still use the old name. */
export function entityBio(entity: EntityNarrative): string | null {
  return entityWorkSummary(entity);
}

export function entityFindingsSummary(entity: EntityNarrative): string {
  const findings: string[] = [];
  const source = parseEntityRegistries(entity.sourceRegistries)
    .filter((item) => !/^(manual|user|seed|imported)$/i.test(item.trim()))[0];
  const filing = filingLabel(entity.notes);
  const company = companyFromNotes(entity.notes);
  const noteNationality = noteField(entity.notes, "Nationality");
  const noteLocation = noteField(entity.notes, "Location");

  if (source) findings.push(`Source: ${source}`);
  if (filing && company) findings.push(`${filing} connected to ${company}`);
  else if (filing) findings.push(filing);
  if (noteNationality || entity.nationality) findings.push(`nationality recorded as ${noteNationality ?? entity.nationality}`);
  if (noteLocation || entity.knownResidences) findings.push(`location recorded as ${noteLocation ?? entity.knownResidences}`);
  if ((entity.assetCount ?? 0) > 0) {
    const categories = Array.from(new Set((entity.assetCategories ?? []).filter(Boolean).map(cleanCategory)));
    findings.push(`${entity.assetCount} linked public asset${entity.assetCount === 1 ? "" : "s"}${categories.length ? ` (${categories.slice(0, 2).join(", ")})` : ""}`);
  }
  if (entity.personalWebsite) findings.push("personal website recorded");
  if (entity.linkedinHeadline || entity.twitterBio || entity.telegramBio) findings.push("public social/profile text recorded");
  if (findings.length === 0) return "No personal finding has been recorded beyond the entity record; further evidence review is pending.";
  return `${findings.join(" · ")}.`;
}

const INVOLVEMENT_LABELS: Array<[RegExp, string]> = [
  [/edgar|sec/i, "public-company ownership or governance"],
  [/faa|aviation|aircraft/i, "private aviation"],
  [/land.?reg|hmlr|property|real.?estate/i, "high-value property"],
  [/companies.?house|house.?uk/i, "UK company directorships"],
  [/brreg|norway/i, "Norwegian company directorships"],
  [/bodacc|france/i, "French corporate filings"],
  [/ares|czech/i, "Czech corporate filings"],
  [/foundation|charity/i, "philanthropic or foundation activity"],
  [/opensky|flight/i, "live aviation activity"],
];

export function entityInvolvement(entity: EntityNarrative): string | null {
  const signal = narrativeText(entity.signal, 180);
  if (signal) return signal;
  const foundation = narrativeText(entity.foundationName, 150);
  if (foundation) return `Foundation activity: ${foundation}`;
  const categories = (entity.assetCategories ?? []).filter(Boolean);
  if (categories.length > 0) {
    const labels = Array.from(new Set(categories)).slice(0, 3).map((category) => category.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase());
    return `${labels.join(", ")} record${labels.length === 1 ? "" : "s"} linked to this profile`;
  }
  const registry = parseEntityRegistries(entity.sourceRegistries);
  const labels = Array.from(new Set(
    registry.flatMap((source) => INVOLVEMENT_LABELS.filter(([pattern]) => pattern.test(source)).map(([, label]) => label)),
  ));
  if (labels.length > 0) return labels.slice(0, 2).join(" · ");
  if ((entity.assetCount ?? 0) > 0) return `${entity.assetCount} public asset${entity.assetCount === 1 ? "" : "s"} linked to this profile`;
  return null;
}

export function entityEvidenceLabel(entity: EntityNarrative): string {
  const registries = parseEntityRegistries(entity.sourceRegistries)
    .filter((source) => !/^(manual|user|seed|imported)$/i.test(source.trim()));
  if (registries.length > 0) return `${registries.length} public source${registries.length === 1 ? "" : "s"}`;
  if (entity.relationshipCount) return `${entity.relationshipCount} public connection${entity.relationshipCount === 1 ? "" : "s"}`;
  return "Evidence detail pending";
}
