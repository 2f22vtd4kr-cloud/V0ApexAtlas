import { useGetDashboardStats, useGetHotLeads } from "@workspace/api-client-react";
import {
  ArrowUpRight,
  ChevronRight,
  CircleAlert,
  Database,
  FileSearch,
  Mail,
  Network,
  Phone,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { Link } from "wouter";
import { entityEvidenceLabel, entityFindingsSummary, entityWorkSummary } from "@/lib/utils";
import { entityMeta, EntityTypeMark, entityMetric } from "@/lib/entity-taxonomy";

function scorePercent(score?: number | null) {
  if (score == null || Number.isNaN(score)) return "—";
  return `${Math.round(score * 100)}%`;
}

function compactMoney(value?: number | null) {
  if (value == null || Number.isNaN(value)) return "Wealth signal pending";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B estimated`;
  if (value >= 1_000_000) return `$${Math.round(value / 1_000_000)}M estimated`;
  return `$${Math.round(value / 1_000)}K estimated`;
}

function dateLabel(value?: string | null) {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function initials(name?: string | null) {
  return (name ?? "Unknown")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?";
}

function scoreTone(score?: number | null) {
  if ((score ?? 0) >= 0.8) return "text-primary";
  if ((score ?? 0) >= 0.6) return "text-accent";
  return "text-secondary";
}

function StatTile({
  label,
  value,
  detail,
  icon: Icon,
  testId,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: typeof Users;
  testId: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-4 transition-colors hover:bg-card/60" data-testid={testId}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground/50" />
      </div>
      <div className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function LeadSkeleton() {
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-5">
      <div className="flex animate-pulse gap-3">
        <div className="h-10 w-10 rounded-lg bg-muted" />
        <div className="flex-1 space-y-2"><div className="h-3 w-2/3 rounded bg-muted" /><div className="h-2 w-1/3 rounded bg-muted" /></div>
      </div>
      <div className="mt-6 h-2 w-full rounded bg-muted" />
      <div className="mt-4 h-10 w-full rounded bg-muted" />
    </div>
  );
}

function LeadCard({ lead, index }: { lead: any; index: number }) {
  const access = lead.accessScore ?? 0;
  const confidence = (lead.contactConfidence ?? 0) / 100;
  const contactReady = access >= 0.55;
  const workSummary = entityWorkSummary(lead);
  const findingsSummary = entityFindingsSummary(lead);
  return (
    <Link
      href={`/profile/${lead.entityId}`}
      data-testid={`card-entity-${lead.entityId}`}
      className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card/50 p-5 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:bg-card hover:shadow-lg hover:shadow-primary/5 focus-visible:border-primary"
    >
      <div className="absolute right-0 top-0 h-24 w-24 rounded-bl-[100px] bg-primary/[0.03] transition-colors group-hover:bg-primary/[0.08]" />
      <div className="relative flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-primary/20 bg-primary/10 font-mono text-xs font-bold text-primary">
          {initials(lead.entityName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[15px] font-semibold text-foreground" data-testid={`text-lead-name-${lead.entityId}`}>
            {lead.entityName || "Unnamed entity"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
            <EntityTypeMark type={lead.entityType} compact />
            {lead.nationality && <><span className="text-border">·</span><span>{lead.nationality}</span></>}
          </div>
        </div>
        {index < 3 && (
          <span className={`relative rounded-full border px-2 py-1 font-mono text-[8px] uppercase tracking-[0.13em] ${
            contactReady
              ? "border-accent/30 bg-accent/10 text-accent"
              : "border-border bg-muted/60 text-muted-foreground"
          }`}>
            {contactReady ? "Priority" : "Review"}
          </span>
        )}
      </div>

      <div className="relative mt-4 space-y-2.5">
        <div className="rounded-lg border border-primary/15 bg-primary/[0.035] px-3 py-2.5">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-primary/75">What they do</div>
          <p className="mt-1 text-[11px] leading-5 text-foreground/80">
            {workSummary ?? "No documented role or activity is recorded yet."}
          </p>
        </div>
        <div className="flex items-start gap-2 text-[10px] leading-4 text-muted-foreground">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" />
          <span><span className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground/65">What we found · </span>{findingsSummary}</span>
        </div>
      </div>

      <div className="relative mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border/70 bg-background/45 px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Confidence</div>
          <div className={`mt-1 font-mono text-lg font-bold ${scoreTone(confidence)}`} data-testid={`text-confidence-${lead.entityId}`}>{scorePercent(confidence)}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">contact data trust</div>
        </div>
        <div className="rounded-lg border border-border/70 bg-background/45 px-3 py-2.5 transition-colors group-hover:border-primary/20">
          <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Access</div>
          <div className={`mt-1 font-mono text-lg font-bold ${scoreTone(access)}`} data-testid={`text-access-${lead.entityId}`}>{scorePercent(access)}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">public reachability</div>
        </div>
      </div>

      <div className="relative mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-[11px] font-mono">
        <span className="text-muted-foreground">{compactMoney(lead.estimatedNetWorth)}</span>
        <span className="text-muted-foreground">{lead.assetCount ?? 0} public assets</span>
      </div>
      <div className="relative mt-3 flex items-center gap-2 text-[10px]">
        <span className={`grid h-5 w-5 place-items-center rounded-full ${contactReady ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {contactReady ? <ShieldCheck className="h-3 w-3" /> : <FileSearch className="h-3 w-3" />}
        </span>
        <span className={contactReady ? "text-primary/90" : "text-muted-foreground"}>
          {contactReady ? "Public contact path indicated" : "Contact evidence needs review"}
        </span>
        <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
      <div className="relative mt-3 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/70">
        <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
        {entityEvidenceLabel(lead)} · {dateLabel(lead.signalDate)}
      </div>
    </Link>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-14 text-center">
      <CircleAlert className="h-7 w-7 text-destructive" />
      <h2 className="mt-4 font-display text-lg font-semibold">The desk could not load</h2>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">Your entities and evidence are still safe. Try the workspace again.</p>
      <button onClick={onRetry} data-testid="button-retry-dashboard" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-xs font-semibold text-foreground hover:border-primary/60">
        <RefreshCw className="h-3.5 w-3.5" /> Retry
      </button>
    </div>
  );
}

function EmptyLeads() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-primary/25 bg-primary/10 text-primary"><Radar className="h-5 w-5" /></div>
      <h2 className="mt-5 font-display text-lg font-semibold">Your priority desk is clear</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Search public registries for people, companies, trusts, and access contacts with evidence worth reviewing.</p>
      <Link href="/search" data-testid="link-empty-discover" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground hover:bg-primary/90">
        <Search className="h-3.5 w-3.5" /> Discover entities <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

export default function Dashboard() {
  const statsQuery = useGetDashboardStats();
  const leadsQuery = useGetHotLeads({ limit: 8 });
  const stats = statsQuery.data;
  const leads = leadsQuery.data ?? [];
  const isLoading = statsQuery.isLoading || leadsQuery.isLoading;
  const hasError = statsQuery.isError || leadsQuery.isError;

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 pb-12 sm:px-6 lg:px-10">
      <section className="atlas-enter relative flex flex-col gap-8 border-b border-border/70 py-8 md:flex-row md:items-end md:justify-between md:py-12">
        <div className="max-w-2xl">
          <div className="mb-4 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.22em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" /> Research desk
          </div>
          <h1 className="font-display text-[clamp(2.15rem,5vw,4.5rem)] font-semibold leading-[0.95] tracking-[-0.055em] text-foreground">
            People worth<br className="hidden sm:block" /> knowing.
          </h1>
          <p className="mt-5 max-w-lg text-sm leading-6 text-muted-foreground md:text-[15px]">
            A clear view of people, companies, trusts, and access contacts found in public records, with the evidence and routes that make a closer look worthwhile.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto">
          <Link href="/search" data-testid="link-dashboard-search" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90">
            <Search className="h-4 w-4" /> Find an entity
          </Link>
          <Link href="/profiles" data-testid="link-dashboard-profiles" className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card/60 px-5 text-xs font-semibold text-foreground transition-all hover:border-primary/60 hover:bg-card">
            Browse entity ledger <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      <section className="atlas-enter grid grid-cols-2 gap-3 py-6 md:grid-cols-4" style={{ animationDelay: "70ms" }}>
        <StatTile label="Entities in view" value={stats?.totalEntities ?? "—"} detail="people, companies, trusts, access" icon={Users} testId="stat-total-entities" />
        <StatTile label="Priority routes" value={stats?.hotLeadsCount ?? "—"} detail="most reachable records" icon={Sparkles} testId="stat-hot-leads" />
        <StatTile label="Public assets" value={stats?.totalAssets ?? "—"} detail="linked evidence objects" icon={Database} testId="stat-total-assets" />
        <StatTile label="Relationships" value={stats?.totalRelationships ?? "—"} detail="known public connections" icon={Network} testId="stat-total-relationships" />
      </section>

      <section className="atlas-enter pt-3" style={{ animationDelay: "140ms" }}>
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-primary"><Sparkles className="h-3 w-3" /> Priority entities</div>
            <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-foreground md:text-2xl">Most useful records first</h2>
          </div>
          <Link href="/profiles" data-testid="link-view-all-leads" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-primary">View full ledger <ChevronRight className="h-3.5 w-3.5" /></Link>
        </div>
        {hasError ? <ErrorState onRetry={() => { void statsQuery.refetch(); void leadsQuery.refetch(); }} /> :
          isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <LeadSkeleton key={item} />)}</div> :
          leads.length === 0 ? <EmptyLeads /> :
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{leads.map((lead: any, index: number) => <LeadCard key={lead.entityId} lead={lead} index={index} />)}</div>}
      </section>

      <section className="atlas-enter mt-10 grid gap-4 border-t border-border/70 pt-7 md:grid-cols-[1fr_auto]" style={{ animationDelay: "210ms" }}>
        <div>
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground"><ShieldCheck className="h-3 w-3 text-primary" /> Evidence, not guesses</div>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Open any profile to inspect source registries, ownership, linked assets, and public contact channels before deciding what deserves your attention.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground md:justify-end">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card"><Mail className="h-3.5 w-3.5" /></span>
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card"><Phone className="h-3.5 w-3.5" /></span>
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card"><FileSearch className="h-3.5 w-3.5" /></span>
        </div>
      </section>
    </div>
  );
}