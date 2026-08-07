import { getGetEntityGraphQueryKey, useGetEntityGraph, useListEntities, useCreateRelationship } from "@workspace/api-client-react";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useSearch, useLocation, Link } from "wouter";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import { Network, ZoomIn, ZoomOut, Maximize, X, Search, ChevronDown, Filter, Shield, Plus, Link2, Loader2, ArrowLeft } from "lucide-react";
import { cn, formatCurrency, formatEntityName, ScoreBadge } from "@/lib/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from "@/components/ui/dialog";

function useWindowSize() {
  const [size, setSize] = useState([0, 0]);
  useEffect(() => {
    function updateSize() {
      const container = document.getElementById("graph-container");
      if (container) setSize([container.clientWidth, container.clientHeight]);
    }
    window.addEventListener("resize", updateSize);
    updateSize();
    return () => window.removeEventListener("resize", updateSize);
  }, []);
  return size;
}

export default function GraphViewer() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const entityIdFromUrl = params.get("entity");

  const [targetId, setTargetId] = useState<number>(
    entityIdFromUrl ? parseInt(entityIdFromUrl, 10) : 0
  );

  // On initial load with no ?entity= param, pick the most-connected entity instead of #1
  useEffect(() => {
    if (!entityIdFromUrl && targetId === 0) {
      fetch(`${import.meta.env.BASE_URL}api/graph/hub-entity`)
        .then(r => r.json())
        .then((d: { entityId: number }) => setTargetId(d.entityId ?? 1))
        .catch(() => setTargetId(1));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (entityIdFromUrl) {
      const parsed = parseInt(entityIdFromUrl, 10);
      if (!isNaN(parsed) && parsed !== targetId) setTargetId(parsed);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityIdFromUrl]);

  const { data: graphData, isLoading, isError } = useGetEntityGraph(targetId, undefined, {
    query: { enabled: targetId > 0, queryKey: getGetEntityGraphQueryKey(targetId) },
  });
  const { data: allEntities } = useListEntities({ limit: 200 });
  const [width, height] = useWindowSize();
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorQuery, setSelectorQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [assetTypeFilter, setAssetTypeFilter] = useState<string | null>(null);

  // ── Relationship modal state ────────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string; nodeName: string } | null>(null);
  const [addRelOpen, setAddRelOpen] = useState(false);
  const [relSourceId, setRelSourceId] = useState<number | null>(null);
  const [relSourceName, setRelSourceName] = useState("");
  const [relTargetId, setRelTargetId] = useState<number | null>(null);
  const [relTargetName, setRelTargetName] = useState("");
  const [relType, setRelType] = useState("KNOWS");
  const [relStrength, setRelStrength] = useState(0.5);
  const [relNotes, setRelNotes] = useState("");
  const [relSaving, setRelSaving] = useState(false);
  const [relError, setRelError] = useState<string | null>(null);
  const [relSearchQ, setRelSearchQ] = useState("");
  const [relSearchResults, setRelSearchResults] = useState<{ id: number; name: string }[]>([]);

  const createRelationship = useCreateRelationship();

  const currentEntity = allEntities?.find((e) => e.id === targetId);

  // Resolve the display name: prefer allEntities list, fall back to the target node label
  // (graph data already contains the entity name in the target node).
  const displayEntityName = useMemo(() => {
    if (currentEntity?.name) return currentEntity.name;
    if (graphData?.nodes) {
      const target = (graphData.nodes as any[]).find((n: any) => n.isTarget);
      if (target?.label) return target.label;
    }
    return targetId > 0 ? `Entity #${targetId}` : null;
  }, [currentEntity, graphData, targetId]);

  const filteredEntities = useMemo(() => {
    if (!allEntities) return [];
    const q = selectorQuery.toLowerCase();
    return allEntities.filter(
      (e) => !q || e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q)
    );
  }, [allEntities, selectorQuery]);

  function selectEntity(id: number) {
    setTargetId(id);
    setSelectedNode(null);
    setSelectorOpen(false);
    setSelectorQuery("");
    setLocation(`/graph?entity=${id}`);
  }

  // ── Relationship handlers ────────────────────────────────────────────────
  const openRelModal = useCallback((nodeId: string, nodeName: string) => {
    const numId = nodeId.startsWith("e:") ? parseInt(nodeId.slice(2), 10) : null;
    if (!numId) return; // only entity nodes can be sources
    setRelSourceId(numId);
    setRelSourceName(nodeName);
    setRelTargetId(null); setRelTargetName(""); setRelType("KNOWS");
    setRelStrength(0.5); setRelNotes(""); setRelSearchQ(""); setRelSearchResults([]);
    setRelError(null);
    setCtxMenu(null);
    setAddRelOpen(true);
  }, []);

  const handleRelSearch = async (q: string) => {
    setRelSearchQ(q);
    if (!q.trim()) { setRelSearchResults([]); return; }
    try {
      const base = (import.meta as any).env.BASE_URL.replace(/\/$/, "");
      const r = await fetch(`${base}/api/entities?search=${encodeURIComponent(q)}&limit=20`);
      const d = await r.json();
      const list: any[] = Array.isArray(d) ? d : (d.entities ?? []);
      setRelSearchResults(list.map((e: any) => ({ id: e.id, name: e.name })));
    } catch { setRelSearchResults([]); }
  };

  const handleSaveRel = () => {
    if (!relSourceId || !relTargetId) { setRelError("Select a target entity"); return; }
    setRelSaving(true); setRelError(null);
    createRelationship.mutate(
      { data: { sourceEntityId: relSourceId, targetId: relTargetId, targetType: "Entity", relationshipType: relType, strength: relStrength, notes: relNotes || undefined } },
      {
        onSuccess: () => { setRelSaving(false); setAddRelOpen(false); },
        onError: (err: any) => { setRelSaving(false); setRelError(err?.message ?? "Failed to save"); },
      }
    );
  };

  const gData = useMemo(() => {
    // Guard against undefined AND against error-response objects like { error: "Entity not found" }
    if (!graphData || !Array.isArray((graphData as any)?.nodes)) return { nodes: [], links: [] };
    const ASSET_TYPES = new Set(["RealEstate", "Aviation", "Marine", "PrivateClub"]);
    const filteredNodes = (graphData as any).nodes.filter((n: any) => {
      if (n.isTarget) return true;
      if (minScore > 0 && !ASSET_TYPES.has(n.nodeType) && n.bayesianScore != null && n.bayesianScore * 100 < minScore) return false;
      if (assetTypeFilter && ASSET_TYPES.has(n.nodeType) && n.nodeType !== assetTypeFilter) return false;
      return true;
    });
    const filteredIds = new Set(filteredNodes.map((n: any) => n.id));
    return {
      nodes: filteredNodes.map((n: any) => ({ ...n, val: n.isTarget ? 3 : n.isCentral ? 2 : 1 })),
      links: ((graphData as any).edges ?? [])
        .filter((e: any) => filteredIds.has(e.source) && filteredIds.has(e.target))
        .map((e: any) => ({ source: e.source, target: e.target, label: e.label, strength: e.strength })),
    };
  }, [graphData, minScore, assetTypeFilter]);

  useEffect(() => {
    if (gData.nodes.length && fgRef.current) {
      setTimeout(() => fgRef.current?.zoomToFit(400, 50), 500);
    }
  }, [gData]);

  function nodeColor(node: any): string {
    if (node.isTarget) return "hsl(160, 84%, 39%)";
    const t: string = node.nodeType ?? "";
    if (t === "HNWI") return "hsl(160, 55%, 24%)";
    if (t === "Corporation" || t === "Corp") return "hsl(217, 80%, 52%)";
    if (t === "Trust") return "hsl(270, 65%, 45%)";
    if (t === "Gatekeeper") return "hsl(38, 90%, 45%)";
    if (["RealEstate", "Aviation", "Marine", "PrivateClub"].includes(t))
      return "hsl(215, 16%, 38%)";
    return "hsl(215, 14%, 50%)";
  }

  /** Draw the entity name label below each node */
  function drawNodeLabel(node: any, ctx: CanvasRenderingContext2D, globalScale: number) {
    if (!node.label) return;
    if (globalScale < 1.2) return; // only render labels when zoomed in enough

    const maxLen = 18;
    const label = node.label.length > maxLen ? node.label.slice(0, maxLen - 1) + "…" : node.label;

    const fontSize = 3.2 / globalScale;

    // Text color by node type
    const _nt: string = node.nodeType ?? "";
    const color = node.isTarget                              ? "#34d399"
      : _nt === "HNWI"                                      ? "#6ee7b7"
      : (_nt === "Corporation" || _nt === "Corp")           ? "#93c5fd"
      : _nt === "Trust"                                     ? "#c4b5fd"
      : _nt === "Gatekeeper"                                ? "#fcd34d"
      : ["RealEstate","Aviation","Marine","PrivateClub"].includes(_nt) ? "#94a3b8"
      : "#94a3b8";

    ctx.save();
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    // Position below the node circle (in graph units, no globalScale division on the radius)
    const baseR = node.isTarget ? 3 : node.isCentral ? 2 : 1;
    const nodeRadius = Math.sqrt(baseR) * 6; // graph units (zoom-invariant)
    const offsetY = nodeRadius + 1.5 / globalScale;

    // Soft shadow for legibility — keep blur small to avoid bleed into the circle
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 2 / globalScale;
    ctx.fillStyle = color;
    ctx.fillText(label, node.x, node.y + offsetY);
    ctx.restore();
  }

  /** Draw a contact-confidence ring around HNWI / Gatekeeper nodes */
  function drawContactRing(node: any, ctx: CanvasRenderingContext2D, globalScale: number) {
    const ENTITY_TYPES = new Set(["HNWI", "Corporation", "Corp", "Trust", "Gatekeeper"]);
    if (!ENTITY_TYPES.has(node.nodeType) && !node.isTarget) return;
    const conf: number = node.contactConfidence ?? 0;
    if (conf <= 0) return;

    const baseR = node.isTarget ? 3 : node.isCentral ? 2 : 1;
    const r = (baseR * 6) / globalScale + 2.5 / globalScale;

    const color = conf >= 70 ? "rgba(16,185,129,0.85)"  // green — high confidence
                : conf >= 30 ? "rgba(245,158,11,0.70)"  // amber — partial
                :              "rgba(100,116,139,0.45)"; // grey — low

    ctx.save();
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4 / globalScale;
    ctx.stroke();

    // Tiny contact-confidence label at high zoom
    if (globalScale > 2.5) {
      ctx.font = `${3 / globalScale}px monospace`;
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(`C${conf}`, node.x, node.y - r - 0.5 / globalScale);
    }
    ctx.restore();
  }

  return (
    <div className="flex h-full w-full bg-background relative overflow-hidden flex-col md:block" id="graph-container"
      onContextMenu={(e) => e.preventDefault()}
    >

      {/* ── Mobile top bar (entity selector + controls) ── */}
      <div className="flex md:hidden items-center gap-2 px-3 py-2.5 border-b border-border bg-card/90 backdrop-blur z-30 flex-shrink-0">
        {entityIdFromUrl && (
          <Link
            href={`/profile/${entityIdFromUrl}`}
            className="w-9 h-9 flex items-center justify-center rounded bg-muted border border-border text-muted-foreground hover:text-foreground flex-shrink-0"
            title="Back to profile"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
        )}
        <button
          onClick={() => setSelectorOpen((o) => !o)}
          className="flex-1 flex items-center justify-between px-3 py-2 rounded bg-background border border-border text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Target</div>
            <div className="text-sm font-mono text-foreground truncate font-semibold">
              {displayEntityName ?? `Entity #${targetId}`}
            </div>
          </div>
          <ChevronDown className={cn("w-4 h-4 text-muted-foreground ml-2 flex-shrink-0 transition-transform", selectorOpen && "rotate-180")} />
        </button>
        <button
          onClick={() => fgRef.current?.zoomToFit(400, 50)}
          className="w-9 h-9 flex items-center justify-center rounded bg-muted border border-border text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          <Maximize className="w-4 h-4" />
        </button>
      </div>

      {/* ── Desktop floating toolbar ── */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 hidden md:flex items-center space-x-2 max-w-[90vw]">
        {/* Back to profile */}
        {entityIdFromUrl && (
          <Link
            href={`/profile/${entityIdFromUrl}`}
            className="flex items-center space-x-1.5 bg-card/90 backdrop-blur border border-border px-3 py-2 rounded text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            title="Back to profile"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Profile</span>
          </Link>
        )}
        {/* Entity selector */}
        <div className="relative">
          <button
            onClick={() => setSelectorOpen((o) => !o)}
            className="flex items-center space-x-2 bg-card/90 backdrop-blur border border-border px-3 py-2 rounded text-sm font-mono text-foreground hover:border-primary/50 transition-colors min-w-[220px]"
          >
            <Network className="w-3.5 h-3.5 text-primary flex-shrink-0" />
            <span className="truncate flex-1 text-left">
              {displayEntityName ?? `Entity #${targetId}`}
            </span>
            <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", selectorOpen && "rotate-180")} />
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex space-x-1 bg-card/90 backdrop-blur border border-border p-1 rounded">
          <button
            onClick={() => fgRef.current?.zoom((fgRef.current.zoom() ?? 1) * 1.25)}
            className="p-1.5 text-muted-foreground hover:text-foreground"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => fgRef.current?.zoom((fgRef.current.zoom() ?? 1) * 0.8)}
            className="p-1.5 text-muted-foreground hover:text-foreground"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={() => fgRef.current?.zoomToFit(400, 50)}
            className="p-1.5 text-muted-foreground hover:text-foreground"
            title="Fit view"
          >
            <Maximize className="w-4 h-4" />
          </button>
        </div>

        {/* Filter panel */}
        <div className="relative">
          <button
            onClick={() => setFilterOpen((o) => !o)}
            className={cn(
              "flex items-center space-x-1.5 bg-card/90 backdrop-blur border px-3 py-2 rounded text-xs font-mono transition-colors",
              filterOpen || minScore > 0 || assetTypeFilter
                ? "border-primary/60 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filter</span>
            {(minScore > 0 || assetTypeFilter) && (
              <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            )}
          </button>

          {filterOpen && (
            <div className="absolute top-full mt-2 right-0 w-64 bg-card border border-border rounded shadow-2xl z-50 p-4 space-y-4">
              <div>
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2 block">
                  Min Signal Score: {minScore}%
                </label>
                <input
                  type="range" min={0} max={90} step={5}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                  <span>0%</span><span>90%</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2 block">
                  Asset Type
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {["Aviation", "Marine", "RealEstate", "PrivateClub"].map((type) => (
                    <button
                      key={type}
                      onClick={() => setAssetTypeFilter((f) => (f === type ? null : type))}
                      className={cn(
                        "text-[10px] font-mono px-2 py-1 rounded border transition-colors",
                        assetTypeFilter === type
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      )}
                    >
                      {type === "RealEstate" ? "Real Estate" : type}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => { setMinScore(0); setAssetTypeFilter(null); setFilterOpen(false); }}
                className="w-full text-[10px] font-mono text-muted-foreground hover:text-foreground border border-border rounded py-1 transition-colors"
              >
                Clear Filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Entity selector dropdown (shared mobile + desktop) ── */}
      {selectorOpen && (
        <div className={cn(
          "bg-card border border-border shadow-2xl z-50 flex flex-col",
          // Mobile: full-width below top bar
          "md:absolute md:top-auto md:left-auto md:w-80 md:max-h-72",
          // Positioned differently per context
          "absolute left-3 right-3 top-[57px] md:top-16 md:left-4 max-h-64 rounded"
        )}>
          <div className="p-2 border-b border-border flex items-center space-x-2">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={selectorQuery}
              onChange={(e) => setSelectorQuery(e.target.value)}
              placeholder="Search entity…"
              className="flex-1 bg-transparent text-sm font-mono text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {filteredEntities.map((e) => (
              <button
                key={e.id}
                onClick={() => selectEntity(e.id)}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 transition-colors text-left",
                  e.id === targetId && "bg-primary/10 text-primary"
                )}
              >
                <div>
                  <div className="font-medium font-mono text-foreground">{e.name}</div>
                  <div className="text-xs text-muted-foreground">{e.type}</div>
                </div>
                <ScoreBadge score={e.bayesianScore} />
              </button>
            ))}
            {filteredEntities.length === 0 && (
              <div className="p-4 text-xs text-muted-foreground text-center">No results</div>
            )}
          </div>
        </div>
      )}

      {/* ── Legend ── */}
      <div className={cn(
        "absolute bottom-4 left-4 z-10 flex-col space-y-1 bg-card/80 backdrop-blur border border-border p-2 md:p-3 rounded text-[10px] md:text-xs font-mono",
        // Hide on mobile when node detail bottom sheet is open (it sits at bottom-0 and would overlap)
        selectedNode ? "hidden md:flex" : "flex"
      )}>
        <div className="flex items-center"><div className="w-2.5 h-2.5 rounded-full bg-primary mr-1.5 md:mr-2" /> HNWI</div>
        <div className="flex items-center"><div className="w-2.5 h-2.5 rounded-full bg-blue-500 mr-1.5 md:mr-2" /> Corp</div>
        <div className="flex items-center"><div className="w-2.5 h-2.5 rounded-full bg-purple-500 mr-1.5 md:mr-2" /> Trust</div>
        <div className="flex items-center"><div className="w-2.5 h-2.5 rounded-full bg-amber-500 mr-1.5 md:mr-2" /> Gatekeeper</div>
        <div className="flex items-center"><div className="w-2.5 h-2.5 rounded-full bg-muted-foreground mr-1.5 md:mr-2" /> Asset</div>
      </div>

      {/* ── Error state — entity not found or graph API error ── */}
      {isError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-muted-foreground font-mono space-y-3">
          <Network className="w-12 h-12 opacity-20" />
          <span className="text-sm tracking-widest uppercase">Graph unavailable</span>
          <span className="text-xs opacity-60 text-center max-w-xs">
            Entity not found or graph data could not be loaded. Select a different entity from the dropdown.
          </span>
        </div>
      )}

      {/* ── No entities at all (DB empty) ── */}
      {!isError && allEntities !== undefined && allEntities.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-muted-foreground font-mono space-y-3">
          <Network className="w-12 h-12 opacity-20" />
          <span className="text-sm tracking-widest uppercase">No entities yet</span>
          <span className="text-xs opacity-60">Run ingestion from Data Sources to populate the graph</span>
        </div>
      )}

      {/* ── Loading ── */}
      {isLoading && allEntities !== undefined && allEntities.length > 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-0 text-primary font-mono text-sm tracking-widest uppercase animate-pulse">
          Mapping Graph...
        </div>
      )}

      {/* ── Empty state — entity exists but has no graph connections ── */}
      {!isLoading && allEntities !== undefined && allEntities.length > 0 && gData.nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-0 text-muted-foreground font-mono text-sm space-y-2">
          <Network className="w-10 h-10 opacity-20" />
          <span>No graph data for this entity.</span>
        </div>
      )}

      {/* ── Single-node state — target loaded but no edges/neighbours yet ── */}
      {!isLoading && gData.nodes.length === 1 && gData.links.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
          <div className="bg-card/90 border border-border rounded-lg px-6 py-5 flex flex-col items-center gap-3 max-w-xs text-center shadow-xl">
            <Network className="w-8 h-8 text-muted-foreground opacity-40" />
            <p className="text-sm font-mono text-foreground">No connections mapped yet</p>
            <p className="text-xs font-mono text-muted-foreground/70 leading-relaxed">
              Run the relationship auto-detect or CH enricher to build edges for this entity.
            </p>
          </div>
        </div>
      )}

      {/* ── Force Graph ── */}
      {width > 0 && gData.nodes.length > 0 && (
        <ForceGraph2D
          ref={fgRef}
          width={width}
          height={height}
          graphData={gData}
          nodeLabel={() => ""}
          nodeColor={nodeColor}
          nodeRelSize={6}
          linkColor={() => "rgba(255, 255, 255, 0.18)"}
          linkWidth={1.2}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          onNodeClick={(node) => { setSelectedNode(node); setCtxMenu(null); }}
          onNodeRightClick={(node, event) => {
            event.preventDefault();
            const n = node as any;
            if (!n.id?.startsWith("e:")) return; // only entity nodes
            setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: n.id, nodeName: n.label ?? n.id });
          }}
          backgroundColor="transparent"
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const n = node as any;
            // Draw the filled node circle ourselves (prevents library from rendering any default text inside)
            const baseR = n.isTarget ? 3 : n.isCentral ? 2 : 1;
            const r = Math.sqrt(baseR) * 6;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = nodeColor(n);
            ctx.fill();
            drawContactRing(n, ctx, globalScale);
            drawNodeLabel(n, ctx, globalScale);
          }}
          linkCanvasObjectMode={() => "after"}
          linkCanvasObject={(link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
            if (!link.label || globalScale < 4.0) return;
            const start = link.source;
            const end = link.target;
            if (!start || !end || typeof start !== "object" || typeof end !== "object") return;
            const midX = ((start as any).x + (end as any).x) / 2;
            const midY = ((start as any).y + (end as any).y) / 2;
            const fontSize = Math.min(3.5, 14 / globalScale);
            ctx.save();
            ctx.font = `${fontSize}px monospace`;
            ctx.fillStyle = "rgba(148,163,184,0.65)";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText((link.label as string).replace(/_/g, " "), midX, midY);
            ctx.restore();
          }}
        />
      )}

      {/* ── Node detail panel — right sidebar on desktop, bottom sheet on mobile ── */}
      {selectedNode && (
        <div className={cn(
          "absolute bg-card/95 backdrop-blur-md border-border z-20 flex flex-col animate-in",
          // Mobile: bottom sheet
          "bottom-0 left-0 right-0 border-t max-h-[60vh] slide-in-from-bottom",
          // Desktop: right sidebar
          "md:top-0 md:right-0 md:bottom-0 md:left-auto md:w-96 md:border-t-0 md:border-l md:max-h-none md:slide-in-from-right"
        )}>
          <div className="p-4 border-b border-border flex justify-between items-center bg-muted/20">
            <h2 className="font-bold text-sm font-mono tracking-wider flex items-center">
              <Network className="w-4 h-4 mr-2 text-secondary" /> Node Intelligence
            </h2>
            <button onClick={() => setSelectedNode(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 md:p-6 flex-1 overflow-y-auto space-y-4">
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 font-mono">
                {selectedNode.nodeType}
              </div>
              <h3 className="text-lg md:text-xl font-bold text-foreground">{selectedNode.label}</h3>
              {selectedNode.nationality && (
                <div className="text-sm text-muted-foreground mt-1">{selectedNode.nationality}</div>
              )}
            </div>

            <div className="space-y-2 font-mono text-sm">
              {selectedNode.bayesianScore != null && (
                <div className="flex justify-between items-center p-3 border border-border bg-muted/10 rounded">
                  <span className="text-muted-foreground">Signal Score</span>
                  <ScoreBadge score={selectedNode.bayesianScore} />
                </div>
              )}
              {selectedNode.estimatedValue != null && (
                <div className="flex justify-between items-center p-3 border border-border bg-muted/10 rounded">
                  <span className="text-muted-foreground">Est. Value</span>
                  <span className="text-foreground">{formatCurrency(selectedNode.estimatedValue)}</span>
                </div>
              )}
              {selectedNode.isTarget && (
                <div className="flex justify-between items-center p-3 border border-primary/30 bg-primary/5 rounded">
                  <span className="text-primary/70">Role</span>
                  <span className="text-primary font-bold">PRIMARY TARGET</span>
                </div>
              )}
              {selectedNode.isCentral && !selectedNode.isTarget && (
                <div className="flex justify-between items-center p-3 border border-amber-500/30 bg-amber-500/5 rounded">
                  <span className="text-amber-500/70">Role</span>
                  <span className="text-amber-500 font-bold">CENTRAL NODE</span>
                </div>
              )}
            </div>

            {selectedNode.nodeType === "Gatekeeper" && (() => {
              let approachVector = "Professional introduction via shared network";
              try {
                const m = JSON.parse(selectedNode.metadata ?? "{}");
                if (m.approachVector) approachVector = m.approachVector;
              } catch { /* noop */ }
              return (
                <div className="border-t border-border pt-4">
                  <div className="text-xs text-muted-foreground mb-2 font-mono uppercase tracking-wider flex items-center">
                    <Shield className="w-3 h-3 mr-1.5 text-amber-500" /> How to Approach
                  </div>
                  <div className="text-xs font-mono text-amber-400 bg-amber-500/5 border border-amber-500/20 p-3 rounded leading-relaxed">
                    {approachVector}
                  </div>
                </div>
              );
            })()}

            {selectedNode.metadata && selectedNode.nodeType !== "Gatekeeper" && (
              <div className="border-t border-border pt-4">
                <div className="text-xs text-muted-foreground mb-2 font-mono uppercase tracking-wider">
                  Raw Intel
                </div>
                <pre className="text-xs text-primary whitespace-pre-wrap bg-background p-3 rounded border border-border overflow-x-auto">
                  {selectedNode.metadata}
                </pre>
              </div>
            )}

            <div className="space-y-2 pt-2">
              <button
                onClick={() => selectEntity(
                  selectedNode.id.startsWith("e:")
                    ? parseInt(selectedNode.id.slice(2), 10)
                    : targetId
                )}
                disabled={!selectedNode.id?.startsWith("e:") || selectedNode.isTarget}
                className="w-full py-2 bg-primary/20 hover:bg-primary/30 text-primary border border-primary/50 text-xs font-mono uppercase tracking-wider transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Set as Target
              </button>
              <button
                onClick={() => openRelModal(selectedNode.id, selectedNode.label)}
                disabled={!selectedNode.id?.startsWith("e:")}
                className="w-full py-2 flex items-center justify-center gap-1.5 bg-muted/20 hover:bg-muted/40 text-muted-foreground hover:text-foreground border border-border text-xs font-mono uppercase tracking-wider transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Link2 className="w-3 h-3" /> Add Relationship From Here
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Right-click context menu ── */}
      {ctxMenu && (
        <div
          className="fixed z-50 bg-card border border-border rounded shadow-2xl py-1 min-w-[180px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseLeave={() => setCtxMenu(null)}
        >
          <div className="px-3 py-1.5 border-b border-border/50">
            <div className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">Node</div>
            <div className="text-xs font-mono text-foreground font-semibold truncate max-w-[160px]">{ctxMenu.nodeName}</div>
          </div>
          <button
            onClick={() => openRelModal(ctxMenu.nodeId, ctxMenu.nodeName)}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono text-foreground hover:bg-muted/50 transition-colors"
          >
            <Link2 className="w-3.5 h-3.5 text-primary" /> Add Relationship From Here
          </button>
          <button
            onClick={() => { selectEntity(parseInt(ctxMenu.nodeId.slice(2), 10)); setCtxMenu(null); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono text-foreground hover:bg-muted/50 transition-colors"
          >
            <Network className="w-3.5 h-3.5 text-secondary" /> Set as Graph Target
          </button>
        </div>
      )}

      {/* ── Dismiss context menu on outside click ── */}
      {ctxMenu && <div className="fixed inset-0 z-40" onClick={() => setCtxMenu(null)} />}

      {/* ── Add Relationship Modal ── */}
      <Dialog open={addRelOpen} onOpenChange={(o) => { setAddRelOpen(o); if (!o) { setRelError(null); setRelSearchResults([]); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-sm tracking-widest uppercase flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" /> Add Relationship
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Source (pre-filled, read-only) */}
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5 block">From (Source)</label>
              <div className="px-3 py-2 bg-muted/20 border border-border rounded text-sm font-mono text-foreground/70">
                {relSourceName}
              </div>
            </div>

            {/* Target entity search */}
            <div className="relative">
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5 block">To (Target Entity)</label>
              <input
                value={relTargetId ? relTargetName : relSearchQ}
                onChange={(e) => { setRelTargetId(null); setRelTargetName(""); handleRelSearch(e.target.value); }}
                placeholder="Search entities…"
                className="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none"
              />
              {relSearchResults.length > 0 && !relTargetId && (
                <div className="absolute left-0 right-0 top-full mt-1 bg-card border border-border rounded shadow-xl z-50 max-h-48 overflow-y-auto">
                  {relSearchResults.map((r) => (
                    <button key={r.id} onClick={() => { setRelTargetId(r.id); setRelTargetName(r.name); setRelSearchResults([]); }}
                      className="w-full text-left px-3 py-2 text-sm font-mono text-foreground hover:bg-muted/50 transition-colors border-b border-border/30 last:border-0">
                      {formatEntityName(r.name)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Relationship type */}
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5 block">Relationship Type</label>
              <select value={relType} onChange={(e) => setRelType(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono text-foreground focus:border-primary/50 focus:outline-none">
                {["KNOWS","OWNS","CONTROLS","ASSOCIATES_WITH","EMPLOYED_BY","DIRECTS","FAMILY_OF"].map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>

            {/* Strength */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Strength</label>
                <span className="text-[10px] font-mono text-foreground font-bold">{(relStrength * 100).toFixed(0)}%</span>
              </div>
              <input type="range" min={0.1} max={1.0} step={0.05} value={relStrength}
                onChange={(e) => setRelStrength(Number(e.target.value))} className="w-full accent-primary" />
              <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5"><span>Weak</span><span>Strong</span></div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1.5 block">Notes (optional)</label>
              <textarea value={relNotes} onChange={(e) => setRelNotes(e.target.value)} rows={2}
                placeholder="Source or evidence for this link…"
                className="w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none resize-none" />
            </div>

            {relError && <p className="text-xs font-mono text-red-400">{relError}</p>}
          </div>

          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <button className="px-4 py-2 rounded border border-border text-muted-foreground font-mono text-xs uppercase tracking-wider hover:text-foreground transition-colors">Cancel</button>
            </DialogClose>
            <button onClick={handleSaveRel} disabled={relSaving || !relTargetId}
              className="flex items-center gap-2 px-4 py-2 rounded bg-primary/20 border border-primary/40 text-primary font-mono text-xs uppercase tracking-wider hover:bg-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {relSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {relSaving ? "Saving…" : "Save"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
