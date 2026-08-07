/**
 * OSINT Tools Directory — Phase G5
 *
 * Browse 12,500+ categorised OSINT tools from the tomvaillant/osint-tool-database
 * HuggingFace dataset. Backed by GET /api/osint-tools (Redis-cached 24h).
 */

import { useState, useEffect, useCallback } from "react";
import { BookOpen, Search, ExternalLink, Filter, RefreshCw, Globe, Tag, X } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface OsintTool {
  tool_name: string;
  tool_url: string;
  category: string;
  short_description: string;
}

interface CategoryCount {
  name: string;
  count: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  public_records:             "Public Records",
  search:                     "Search Engines",
  companies:                  "Companies",
  social_media:               "Social Media",
  monitoring:                 "Monitoring",
  domains_websites:           "Domains & Websites",
  image_video_analysis:       "Image & Video Analysis",
  geolocation_mapping:        "Geolocation & Mapping",
  data_analysis_visualization:"Data & Visualisation",
  people:                     "People",
  documents_code:             "Documents & Code",
  dark_web_data_breaches:     "Dark Web & Breaches",
  transport:                  "Transport",
  ai:                         "AI",
  ip_address_network:         "IP & Network",
  cryptocurrency:             "Cryptocurrency",
  uncategorized:              "Uncategorized",
  web_archiving:              "Web Archiving",
  emails:                     "Email Tools",
  usernames_accounts:         "Usernames & Accounts",
  phone_numbers:              "Phone Numbers",
};

// Category colours (priority mapping for HNWI research)
const CATEGORY_COLOR: Record<string, string> = {
  public_records:   "text-emerald-400 border-emerald-400/30 bg-emerald-400/5",
  companies:        "text-blue-400 border-blue-400/30 bg-blue-400/5",
  people:           "text-cyan-400 border-cyan-400/30 bg-cyan-400/5",
  transport:        "text-amber-400 border-amber-400/30 bg-amber-400/5",
  geolocation_mapping: "text-orange-400 border-orange-400/30 bg-orange-400/5",
  dark_web_data_breaches: "text-red-400 border-red-400/30 bg-red-400/5",
  social_media:     "text-pink-400 border-pink-400/30 bg-pink-400/5",
  search:           "text-violet-400 border-violet-400/30 bg-violet-400/5",
};

function categoryColor(cat: string) {
  return CATEGORY_COLOR[cat] ?? "text-muted-foreground border-border bg-muted/10";
}

function categoryLabel(cat: string) {
  return CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default function OsintToolsDirectory() {
  const [query, setQuery]             = useState("");
  const [category, setCategory]       = useState("");
  const [page, setPage]               = useState(1);
  const [pageSize]                    = useState(24);
  const [tools, setTools]             = useState<OsintTool[]>([]);
  const [totalTools, setTotalTools]   = useState(0);
  const [categories, setCategories]   = useState<CategoryCount[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");

  // Load category list once
  useEffect(() => {
    fetch(`${BASE}/api/osint-tools/categories`)
      .then(r => r.json())
      .then((d: { categories: CategoryCount[]; total: number }) => {
        setCategories(d.categories ?? []);
      })
      .catch(() => {});
  }, []);

  const fetchTools = useCallback(async (q: string, cat: string, pg: number) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        pageSize: String(pageSize),
        page: String(pg),
      });
      if (q.trim())  params.set("q", q.trim());
      if (cat)       params.set("category", cat);
      const res = await fetch(`${BASE}/api/osint-tools?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { tools: OsintTool[]; total: number; cached: boolean };
      setTools(d.tools ?? []);
      setTotalTools(d.total ?? 0);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load tools");
      setTools([]);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  // Fetch on query/category/page change (debounced for text)
  useEffect(() => {
    const t = setTimeout(() => {
      fetchTools(query, category, page);
      if (page > 1) window.scrollTo({ top: 0, behavior: "smooth" });
    }, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [query, category, page, fetchTools]);

  // Reset to page 1 when filter changes
  function handleQuery(q: string) { setQuery(q); setPage(1); }
  function handleCategory(c: string) { setCategory(c); setPage(1); }

  const totalPages = Math.ceil(totalTools / pageSize);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-4 md:px-6 py-4 border-b border-border flex items-center gap-3">
        <BookOpen className="h-5 w-5 text-cyan-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold tracking-widest uppercase font-mono text-cyan-400">
            OSINT Tools Directory
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalTools > 0 ? `${totalTools.toLocaleString()} tools` : "Loading…"} · tomvaillant/osint-tool-database · HuggingFace
          </p>
        </div>
        <a
          href="https://huggingface.co/datasets/tomvaillant/osint-tool-database"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-cyan-400 transition-colors flex-shrink-0"
        >
          <ExternalLink className="w-3 h-3" />
          HuggingFace
        </a>
      </div>

      {/* Filters */}
      <div className="flex-shrink-0 px-4 md:px-6 py-3 border-b border-border flex flex-wrap gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={query}
            onChange={e => handleQuery(e.target.value)}
            placeholder="Search tools…"
            className="w-full pl-8 pr-3 py-1.5 text-xs font-mono bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-cyan-400/50"
          />
        </div>

        {/* Category filter */}
        <div className="relative">
          <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <select
            value={category}
            onChange={e => handleCategory(e.target.value)}
            className="pl-8 pr-6 py-1.5 text-xs font-mono bg-card border border-border rounded-lg text-foreground focus:outline-none focus:border-cyan-400/50 appearance-none cursor-pointer"
          >
            <option value="">All categories</option>
            {categories.map(c => (
              <option key={c.name} value={c.name}>
                {categoryLabel(c.name)} ({c.count})
              </option>
            ))}
          </select>
        </div>

        {/* Category chips (top 7 by count) */}
        <div className="flex gap-1.5 items-center overflow-x-auto pb-1 scrollbar-none flex-nowrap sm:flex-wrap">
          {categories.slice(0, 7).map(c => (
            <button
              key={c.name}
              onClick={() => handleCategory(category === c.name ? "" : c.name)}
              className={cn(
                "text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 rounded border transition-colors",
                category === c.name
                  ? categoryColor(c.name)
                  : "text-muted-foreground border-border hover:border-cyan-400/30 hover:text-cyan-400"
              )}
            >
              {categoryLabel(c.name)}
            </button>
          ))}
          {category && (
            <button
              onClick={() => handleCategory("")}
              className="text-[9px] font-mono text-red-400 hover:text-red-300 transition-colors px-1"
            >
              <><X className="h-3 w-3" /> clear</>
            </button>
          )}
        </div>
      </div>

      {/* Tool grid */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm font-mono text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && tools.length === 0 && (
          <div className="text-center py-16 text-muted-foreground font-mono text-sm">
            No tools found{query ? ` for "${query}"` : ""}{category ? ` in ${categoryLabel(category)}` : ""}.
          </div>
        )}

        {!loading && tools.length > 0 && (
          <>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 mb-6">
              {tools.map((tool, i) => (
                <ToolCard key={`${tool.tool_name}-${i}`} tool={tool} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border pt-4 gap-2">
                <span className="text-xs font-mono text-muted-foreground hidden sm:block shrink-0">
                  Page {page} of {totalPages} · {totalTools.toLocaleString()} tools
                </span>
                <span className="text-xs font-mono text-muted-foreground sm:hidden shrink-0">
                  {page}/{totalPages}
                </span>
                <div className="flex gap-1.5 flex-wrap justify-end">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="text-[10px] font-mono px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-cyan-400 hover:border-cyan-400/30 disabled:opacity-40 transition-colors"
                  >
                    ← Prev
                  </button>
                  {/* Page numbers — 3 visible (fits any screen) */}
                  {Array.from({ length: Math.min(3, totalPages) }, (_, i) => {
                    const start = Math.max(1, Math.min(page - 1, totalPages - 2));
                    const p = start + i;
                    return (
                      <button
                        key={p}
                        onClick={() => setPage(p)}
                        className={cn(
                          "text-[10px] font-mono px-2 py-1 rounded border transition-colors",
                          p === page
                            ? "border-cyan-400/40 text-cyan-400 bg-cyan-400/5"
                            : "border-border text-muted-foreground hover:text-cyan-400 hover:border-cyan-400/30"
                        )}
                      >
                        {p}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="text-[10px] font-mono px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-cyan-400 hover:border-cyan-400/30 disabled:opacity-40 transition-colors"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: OsintTool }) {
  const hostname = (() => {
    try { return new URL(tool.tool_url).hostname.replace("www.", ""); }
    catch { return tool.tool_url.slice(0, 40); }
  })();

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 flex flex-col gap-2 hover:border-cyan-400/30 transition-colors group">
      {/* Category badge */}
      <div className="flex items-center justify-between gap-2">
        <span className={cn(
          "text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded border",
          categoryColor(tool.category)
        )}>
          {categoryLabel(tool.category)}
        </span>
        <Tag className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
      </div>

      {/* Tool name */}
      <div className="font-semibold text-sm text-foreground font-mono leading-tight">
        {tool.tool_name}
      </div>

      {/* Description */}
      <p className="text-xs text-muted-foreground leading-relaxed flex-1 line-clamp-3">
        {tool.short_description || "No description available."}
      </p>

      {/* URL + open link */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40 mt-auto">
        <div className="flex items-center gap-1 min-w-0">
          <Globe className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
          <span className="text-[10px] font-mono text-muted-foreground/60 truncate">{hostname}</span>
        </div>
        <a
          href={tool.tool_url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[10px] font-mono text-cyan-400/60 hover:text-cyan-400 transition-colors flex-shrink-0"
        >
          Open <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}
