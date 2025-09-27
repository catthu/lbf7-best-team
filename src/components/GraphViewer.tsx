"use client";

import React from "react";
import Graph from "graphology";

type GraphData = {
  nodes: Array<{id: string; label?: string; x: number; y: number; size?: number; degree?: number; community?: number | null; allDBs?: string[]; hasAllDBsNone?: boolean}>;
  edges: Array<{id: string; source: string; target: string; weight?: number; allDBs?: string; afmprob?: number}>;
  adjacency: Record<string, string[]>;
  clusters: Array<{id: string; label?: string; x: number; y: number; size?: number; community: number; count: number}>;
  meta?: {order: number; size: number};
};

function throttle<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let last = 0;
  return (...args: T) => {
    const now = performance.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

export default function GraphViewer({ initialViewMode }: { initialViewMode?: 'default' | 'locality' }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const sigmaRef = React.useRef<any>(null);
  const graphRef = React.useRef<Graph | null>(null);
  const adjacencyRef = React.useRef<GraphData["adjacency"]>({});
  const fallbackCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const fallbackCtxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const fallbackNodesRef = React.useRef<Array<{id: string; x: number; y: number; size: number; degree: number; name: string}>>([]);
  const idToIndexRef = React.useRef<Record<string, number>>({});
  const viewRef = React.useRef({scale: 1, tx: 0, ty: 0});
  const focusedNodeRef = React.useRef<string | null>(null);
  const prevCamStateRef = React.useRef<any>(null);
  const defocusTimerRef = React.useRef<number | null>(null);
  const isAnimatingRef = React.useRef<boolean>(false);
  const isClampingRef = React.useRef<boolean>(false);
  const setHoveredRef = React.useRef<((node?: string) => void) | undefined>(undefined);
  const nameIndexRef = React.useRef<Array<{id: string; name: string; nameLower: string}>>([]);
  const nodesBlueSetRef = React.useRef<Set<string>>(new Set());
  const edgeAllDBsRef = React.useRef<Record<string, string>>({});
  const suppressCamAnimRef = React.useRef<boolean>(false);
  const blueAdjacencyRef = React.useRef<Record<string, string[]>>({});
  const nodesBlueCountsRef = React.useRef<Record<string, number>>({});
  const maxBlueCountRef = React.useRef<number>(0);
  const [totals, setTotals] = React.useState<{nodes: number; edges: number; blueEdges: number}>({nodes: 0, edges: 0, blueEdges: 0});
  const [focusedInfo, setFocusedInfo] = React.useState<{id: string; name: string; degree: number; blue: number} | null>(null);

  function getHeatColorForCount(count: number, alpha = 1): string {
    // Blue-only gradient from light blue (low) to deep blue (high)
    const maxC = Math.max(1, maxBlueCountRef.current);
    const tBase = Math.max(0, Math.min(1, count / maxC));
    const t = Math.max(0.12, tBase); // ensure visibility for low non-zero counts
    const r = Math.round(147 + (29 - 147) * t);   // 147 -> 29
    const g = Math.round(197 + (78 - 197) * t);   // 197 -> 78
    const b = Math.round(253 + (216 - 253) * t);  // 253 -> 216
    if (alpha >= 1) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  }

  const [degreeThreshold, setDegreeThreshold] = React.useState(0);
  const [showEdges, setShowEdges] = React.useState(true);
  const clusterModeRef = React.useRef(false);
  const showEdgesRef = React.useRef(showEdges);
  const degreeThresholdRef = React.useRef(degreeThreshold);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [searchMatches, setSearchMatches] = React.useState<Array<{id: string; name: string}>>([]);
  const [showOnlyNew, setShowOnlyNew] = React.useState(false);
  const showOnlyNewRef = React.useRef(showOnlyNew);
  const [confidence, setConfidence] = React.useState(0);
  const confidenceRef = React.useRef(confidence);
  const [minConfidence, setMinConfidence] = React.useState(0);
  const [showAllEdges, setShowAllEdges] = React.useState(false);
  const showAllEdgesRef = React.useRef(showAllEdges);
  const [geneInfo, setGeneInfo] = React.useState<{symbol?: string; name?: string; summary?: string} | null>(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [viewMode, setViewMode] = React.useState<'default' | 'locality'>(initialViewMode === 'locality' ? 'locality' : 'default');
  const geneAbortRef = React.useRef<AbortController | null>(null);
  const geneTimerRef = React.useRef<number | null>(null);
  const geneCacheRef = React.useRef<Record<string, {symbol?: string; name?: string; summary?: string; t: number}>>({});
  const GENE_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
  const clusterLabelsRef = React.useRef<HTMLDivElement | null>(null);
  const clusterLabelElsRef = React.useRef<Record<string, HTMLDivElement>>({});
  const groupOutlineLayerRef = React.useRef<HTMLDivElement | null>(null);
  const groupOutlineElsRef = React.useRef<Record<string, HTMLDivElement>>({});

  function normalizeGeneKey(q: string) {
    return (q || '').trim().toLowerCase();
  }

  function getGeneFromCache(q: string) {
    const key = normalizeGeneKey(q);
    const now = Date.now();
    const mem = geneCacheRef.current[key];
    if (mem && now - mem.t < GENE_CACHE_TTL_MS) return {symbol: mem.symbol, name: mem.name, summary: mem.summary};
    try {
      const raw = localStorage.getItem(`__geneinfo:${key}`);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj.t === 'number' && now - obj.t < GENE_CACHE_TTL_MS) {
          geneCacheRef.current[key] = obj;
          return {symbol: obj.symbol, name: obj.name, summary: obj.summary};
        }
      }
    } catch {}
    return null;
  }

  function saveGeneToCache(q: string, data: {symbol?: string; name?: string; summary?: string}) {
    const key = normalizeGeneKey(q);
    const obj = {symbol: data.symbol, name: data.name, summary: data.summary, t: Date.now()};
    geneCacheRef.current[key] = obj;
    try { localStorage.setItem(`__geneinfo:${key}`, JSON.stringify(obj)); } catch {}
  }

  async function fetchGeneSummary(query: string) {
    try {
      if (geneAbortRef.current) geneAbortRef.current.abort();
      const ac = new AbortController();
      geneAbortRef.current = ac;
      const q = encodeURIComponent(query);
      const cached = getGeneFromCache(query);
      if (cached) { setGeneInfo(cached); return; }
      // Try MyGene.info first (human)
      const url = `https://mygene.info/v3/query?q=${q}&species=human&fields=symbol,name,summary&size=5`;
      const res = await fetch(url, {signal: ac.signal});
      if (!res.ok) throw new Error(`mygene ${res.status}`);
      const data = await res.json();
      const hits = (data && data.hits) || [];
      let best = null as any;
      const qLower = query.toLowerCase();
      for (const h of hits) {
        const sym = (h.symbol || '').toLowerCase();
        const nm = (h.name || '').toLowerCase();
        if (sym === qLower || nm === qLower) { best = h; break; }
      }
      if (!best && hits.length) best = hits[0];
      if (best) {
        const info = {symbol: best.symbol as string | undefined, name: best.name as string | undefined, summary: best.summary as string | undefined};
        setGeneInfo(info);
        saveGeneToCache(query, info);
        return;
      }
      // Fallback: Uniprot function comment (simple)
      const url2 = `https://rest.uniprot.org/uniprotkb/search?query=gene:${q}+AND+organism_id:9606&fields=comment(FUNCTION),genes,organism_name&format=json&size=1`;
      const r2 = await fetch(url2, {signal: ac.signal});
      if (r2.ok) {
        const j = await r2.json();
        const item = (j && j.results && j.results[0]) || null;
        let summary = '';
        if (item && item.comments) {
          const funcs = item.comments.filter((c: any) => (c && c.type) ? c.type === 'FUNCTION' : false);
          if (funcs && funcs[0] && funcs[0].texts && funcs[0].texts[0]) summary = funcs[0].texts[0].value || '';
        }
        const info = {symbol: query, name: query, summary: summary || undefined};
        setGeneInfo(info);
        saveGeneToCache(query, info);
      }
    } catch (_e) {
      // ignore aborts
    }
  }

  function recomputeFocusedInfoImmediate(nodeId: string) {
    const g = graphRef.current;
    if (!g) return;
    const thr = degreeThresholdRef.current;
    const onlyNew = showOnlyNewRef.current;
    const conf = confidence;
    let degF = 0, blueF = 0;
    g.forEachEdge((e, attrs, sId, tId) => {
      if (sId !== nodeId && tId !== nodeId) return;
      const other = sId === nodeId ? tId : sId;
      const otherDeg = (g.getNodeAttribute(other, 'degree') as number) || 0;
      const hideByDeg = thr > 0 && otherDeg < thr;
      const hideByNewNode = onlyNew && !nodesBlueSetRef.current.has(other);
      if (hideByDeg || hideByNewNode) return;
      const ap = (attrs as any)?.afmprob;
      if (typeof ap === 'number' && ap < conf) return;
      const adb = (attrs as any)?.allDBs || '';
      const isNone = String(adb).trim().toLowerCase() === 'none';
      if (onlyNew && !isNone) return;
      degF++;
      if (isNone) blueF++;
    });
    let nm = (g.getNodeAttribute(nodeId, 'name') as string) || nodeId;
    if (!nm || !nm.trim()) {
      const found = nameIndexRef.current.find((e) => e.id === nodeId);
      nm = (found && found.name) || (g.getNodeAttribute(nodeId, 'label') as string) || nodeId;
    }
    setFocusedInfo({id: nodeId, name: nm, degree: degF, blue: blueF});
  }

  function recomputeTotalsImmediate() {
    const g = graphRef.current;
    if (!g) return;
    const thr = degreeThresholdRef.current;
    const onlyNew = showOnlyNewRef.current;
    const conf = confidence;
    const visibleNodes = new Set<string>();
    let nodesCount = 0;
    g.forEachNode((n, attrs) => {
      if ((attrs as any)?.isCluster) return;
      const deg = (attrs as any)?.degree || 0;
      const hideByDeg = thr > 0 && deg < thr;
      const hideByNew = onlyNew && !nodesBlueSetRef.current.has(n);
      if (!(hideByDeg || hideByNew)) { nodesCount++; visibleNodes.add(n); }
    });
    let edgesCount = 0, blueCount = 0;
    g.forEachEdge((e, attrs, sId, tId) => {
      if (!visibleNodes.has(sId) || !visibleNodes.has(tId)) return;
      const ap = (attrs as any)?.afmprob;
      if (typeof ap === 'number' && ap < conf) return;
      const adb = (attrs as any)?.allDBs || '';
      const isNone = String(adb).trim().toLowerCase() === 'none';
      if (onlyNew && !isNone) return;
      edgesCount++;
      if (isNone) blueCount++;
    });
    setTotals({nodes: nodesCount, edges: edgesCount, blueEdges: blueCount});
  }

  React.useEffect(() => {
    showEdgesRef.current = showEdges;
  }, [showEdges]);
  React.useEffect(() => { showAllEdgesRef.current = showAllEdges; }, [showAllEdges]);
  // When toggling Show all edges in non-focused view, update edge hidden flags immediately
  React.useEffect(() => {
    const g = graphRef.current;
    const s = sigmaRef.current as any;
    if (!g || !s) return;
    const focused = focusedNodeRef.current;
    if (focused) return; // only applies in non-focused view
    const onlyNew = showOnlyNewRef.current;
    const conf = confidence;
    g.forEachEdge((e, attrs) => {
      const adb = (attrs as any)?.allDBs || '';
      const isNone = String(adb).trim().toLowerCase() === 'none';
      const ap = (attrs as any)?.afmprob;
      const hideByNew = onlyNew && !isNone;
      const hideByConf = typeof ap === 'number' ? ap < conf : false;
      const shouldShow = showAllEdges && !(hideByNew || hideByConf);
      g.setEdgeAttribute(e, 'hidden', !shouldShow);
      if (shouldShow && isNone) g.setEdgeAttribute(e, 'color', '#3b82f6');
      else if (!shouldShow) g.setEdgeAttribute(e, 'color', undefined);
    });
    try { (s as any).setSetting('renderEdges', showAllEdges || (showEdgesRef.current && (s.getCamera().getState().ratio < 1.5))); } catch {}
    s.refresh();
  }, [showAllEdges, confidence, showOnlyNew]);
  React.useEffect(() => {
    degreeThresholdRef.current = degreeThreshold;
    // Recompute totals and refresh based on new degree filter
    const g = graphRef.current;
    if (g) {
      // apply node visibility per degree (existing behavior)
      g.forEachNode((n) => {
        const deg = (g.getNodeAttribute(n, 'degree') as number) || 0;
        const hideByDeg = degreeThresholdRef.current > 0 && deg < degreeThresholdRef.current;
        const hideByNew = showOnlyNewRef.current && !nodesBlueSetRef.current.has(n);
        g.setNodeAttribute(n, 'hidden', hideByDeg || hideByNew);
      });
      // recompute totals
      const thr = degreeThresholdRef.current;
      const onlyNew = showOnlyNewRef.current;
      const visibleNodes = new Set<string>();
      let nodesCount = 0;
      g.forEachNode((n, attrs) => {
        if ((attrs as any)?.isCluster) return;
        const deg = (attrs as any)?.degree || 0;
        const hideByDeg = thr > 0 && deg < thr;
        const hideByNew = onlyNew && !nodesBlueSetRef.current.has(n);
        if (!(hideByDeg || hideByNew)) { nodesCount++; visibleNodes.add(n); }
      });
      let edgesCount = 0, blueCount = 0;
      g.forEachEdge((e, attrs, sId, tId) => {
        if (!visibleNodes.has(sId) || !visibleNodes.has(tId)) return;
        const adb = (attrs as any)?.allDBs || '';
        const isNone = String(adb).trim().toLowerCase() === 'none';
        if (onlyNew && !isNone) return;
        edgesCount++;
        if (isNone) blueCount++;
      });
      setTotals({nodes: nodesCount, edges: edgesCount, blueEdges: blueCount});
      sigmaRef.current?.refresh();
      // update focused info if present
      if (focusedNodeRef.current) {
        const node = focusedNodeRef.current;
        let degF = 0, blueF = 0;
        g.forEachEdge((e, attrs, sId, tId) => {
          if (sId !== node && tId !== node) return;
          const other = sId === node ? tId : sId;
          if (!visibleNodes.has(other)) return;
          const adb = (attrs as any)?.allDBs || '';
          const isNone = String(adb).trim().toLowerCase() === 'none';
          if (onlyNew && !isNone) return;
          degF++;
          if (isNone) blueF++;
        });
        setFocusedInfo((prev) => prev ? {...prev, degree: degF, blue: blueF} : prev);
      }
    }
  }, [degreeThreshold]);
  React.useEffect(() => {
    const g = graphRef.current;
    const s = sigmaRef.current as any;
    if (!g || !s) return;
    const thr = degreeThresholdRef.current;
    const onlyNew = showOnlyNewRef.current;
    const conf = confidence;
    const visibleNodes = new Set<string>();
    g.forEachNode((n, attrs) => {
      if ((attrs as any)?.isCluster) return;
      const deg = (attrs as any)?.degree || 0;
      const hideByDeg = thr > 0 && deg < thr;
      const hideByNew = onlyNew && !nodesBlueSetRef.current.has(n);
      if (!(hideByDeg || hideByNew)) visibleNodes.add(n);
    });
    // If focused, rebuild neighbor set with filters, update edges/nodes; suppress camera anim
    const focused = focusedNodeRef.current;
    if (focused) {
      const neighbors = new Set<string>();
      neighbors.add(focused);
      g.forEachEdge((e, attrs, sId, tId) => {
        const isEnd = sId === focused || tId === focused;
        if (!isEnd) return;
        const other = sId === focused ? tId : sId;
        if (!visibleNodes.has(other)) return;
        const adb = (attrs as any)?.allDBs || '';
        const isNone = String(adb).trim().toLowerCase() === 'none';
        if (onlyNew && !isNone) return;
        const ap = (attrs as any)?.afmprob;
        if (typeof ap === 'number' && ap < conf) return;
        neighbors.add(sId); neighbors.add(tId);
      });
      // update node hidden flags and edge visibility
      g.forEachNode((n, attrs) => {
        if ((attrs as any)?.isCluster) return;
        const isNeighbor = neighbors.has(n);
        const hideByDeg = thr > 0 && ((attrs as any)?.degree || 0) < thr;
        const hideByNew = onlyNew && !nodesBlueSetRef.current.has(n);
        const hidden = !isNeighbor || hideByDeg || hideByNew;
        g.setNodeAttribute(n, 'hidden', hidden);
      });
      g.forEachEdge((e, attrs, sId, tId) => {
        const vis = neighbors.has(sId) && neighbors.has(tId);
        const ap = (attrs as any)?.afmprob;
        const adb = (attrs as any)?.allDBs || '';
        const isNone = String(adb).trim().toLowerCase() === 'none';
        const hideByNewEdge = onlyNew && !isNone;
        const hideByConf = typeof ap === 'number' && ap < conf;
        g.setEdgeAttribute(e, 'hidden', !vis || hideByNewEdge || hideByConf);
      });
      // No camera movement; we've already updated visibility
    }
    // Update totals and focused stats (already handled by existing effect)
    s.refresh();
  }, [confidence]);

  React.useEffect(() => {
    showOnlyNewRef.current = showOnlyNew;
    // Re-apply base visibility when toggled
    const g = graphRef.current;
    if (!g) return;
    g.forEachNode((n, attrs) => {
      if (attrs.isCluster) return;
      const deg = attrs.degree || 0;
      const hideByDeg = degreeThresholdRef.current > 0 && deg < degreeThresholdRef.current;
      const hideByNew = showOnlyNewRef.current && !nodesBlueSetRef.current.has(n);
      g.setNodeAttribute(n, 'hidden', hideByDeg || hideByNew);
    });
    // recompute totals like in degree/confidence effects
    const thr = degreeThresholdRef.current;
    const onlyNew = showOnlyNewRef.current;
    const conf = confidenceRef.current;
    const visibleNodes = new Set<string>();
    let nodesCount = 0;
    g.forEachNode((n, attrs) => {
      if ((attrs as any)?.isCluster) return;
      const deg = (attrs as any)?.degree || 0;
      const hideByDeg = thr > 0 && deg < thr;
      const hideByNew = onlyNew && !nodesBlueSetRef.current.has(n);
      if (!(hideByDeg || hideByNew)) { nodesCount++; visibleNodes.add(n); }
    });
    let edgesCount = 0, blueCount = 0;
    g.forEachEdge((e, attrs, sId, tId) => {
      if (!visibleNodes.has(sId) || !visibleNodes.has(tId)) return;
      const ap = (attrs as any)?.afmprob;
      if (typeof ap === 'number' && ap < conf) return;
      const adb = (attrs as any)?.allDBs || '';
      const isNone = String(adb).trim().toLowerCase() === 'none';
      if (onlyNew && !isNone) return;
      edgesCount++;
      if (isNone) blueCount++;
    });
    setTotals({nodes: nodesCount, edges: edgesCount, blueEdges: blueCount});
    // If focused, recompute focused info numbers to ensure info box updates
    if (focusedNodeRef.current) {
      const node = focusedNodeRef.current;
      let degF = 0, blueF = 0;
      g.forEachEdge((e, attrs, sId, tId) => {
        if (sId !== node && tId !== node) return;
        const other = sId === node ? tId : sId;
        if (!visibleNodes.has(other)) return;
        const ap = (attrs as any)?.afmprob;
        if (typeof ap === 'number' && ap < conf) return;
        const adb = (attrs as any)?.allDBs || '';
        const isNone = String(adb).trim().toLowerCase() === 'none';
        if (onlyNew && !isNone) return;
        degF++;
        if (isNone) blueF++;
      });
      setFocusedInfo((prev) => prev ? {...prev, degree: degF, blue: blueF} : prev);
    }
    sigmaRef.current?.refresh();
  }, [showOnlyNew]);

  React.useEffect(() => {
    let disposed = false;
    function isWebGLAvailable(): boolean {
      try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl2") || c.getContext("webgl") || c.getContext("experimental-webgl" as any));
      } catch {
        return false;
      }
    }

    function startCanvasFallback(data: GraphData) {
      try {
        const container = containerRef.current!;
        const canvas = fallbackCanvasRef.current!;
        container.style.display = "none";
        canvas.style.display = "block";

        function resizeCanvas() {
          const rect = canvas.parentElement!.getBoundingClientRect();
          const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
          canvas.width = Math.floor(rect.width * dpr);
          canvas.height = Math.floor(rect.height * dpr);
          canvas.style.width = `${Math.floor(rect.width)}px`;
          canvas.style.height = `${Math.floor(rect.height)}px`;
          const ctx = canvas.getContext("2d");
          fallbackCtxRef.current = ctx;
          if (!ctx) return;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        resizeCanvas();
        const ctx = (fallbackCtxRef.current = canvas.getContext("2d"));
        if (!ctx) return;

        const nodes = data.nodes.map((n) => ({
          id: n.id,
          x: n.x,
          y: n.y,
          size: Math.max(1, n.size || 1),
          degree: n.degree || 0,
          name: n.label || n.id,
        }));
        fallbackNodesRef.current = nodes;
        const idToIndex: Record<string, number> = {};
        nodes.forEach((n, i) => (idToIndex[n.id] = i));
        idToIndexRef.current = idToIndex;

        function worldToScreen(p: {x: number; y: number}) {
          const {scale, tx, ty} = viewRef.current;
          return {x: p.x * scale + tx, y: p.y * scale + ty};
        }
        function screenToWorld(p: {x: number; y: number}) {
          const {scale, tx, ty} = viewRef.current;
          return {x: (p.x - tx) / scale, y: (p.y - ty) / scale};
        }

        function computeFit() {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          for (const n of nodes) {
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x > maxX) maxX = n.x;
            if (n.y > maxY) maxY = n.y;
          }
          const rect = canvas.getBoundingClientRect();
          const width = rect.width;
          const height = rect.height;
          const dx = maxX - minX || 1;
          const dy = maxY - minY || 1;
          const padding = 20;
          const sx = (width - 2 * padding) / dx;
          const sy = (height - 2 * padding) / dy;
          const scale = Math.min(sx, sy);
          const tx = padding - minX * scale + (width - (dx * scale + 2 * padding)) / 2;
          const ty = padding - minY * scale + (height - (dy * scale + 2 * padding)) / 2;
          viewRef.current = {scale, tx, ty};
        }

        computeFit();

        // Once the user interacts (zoom/pan/hover-zoom), stop auto-fitting on resize
        let hasInteracted = false;

        let hovered: string | null = null;
        let isPanning = false;
        let panStart: {x: number; y: number} | null = null;
        let viewStart = {scale: 1, tx: 0, ty: 0};

        const draw = () => {
          const ctx2 = fallbackCtxRef.current!;
          const rect = canvas.getBoundingClientRect();
          ctx2.clearRect(0, 0, rect.width, rect.height);
          if (hovered && showEdgesRef.current) {
            const src = nodes[idToIndexRef.current[hovered]];
            if (src) {
              ctx2.strokeStyle = "rgba(150,150,150,0.6)";
              ctx2.lineWidth = 1;
              const srcS = worldToScreen(src);
              for (const nb of adjacencyRef.current[hovered] || []) {
                const t = nodes[idToIndexRef.current[nb]];
                if (!t) continue;
                const thr = degreeThresholdRef.current;
                if (thr > 0 && t.degree < thr) continue;
                const tS = worldToScreen(t);
                ctx2.beginPath();
                ctx2.moveTo(srcS.x, srcS.y);
                ctx2.lineTo(tS.x, tS.y);
                ctx2.stroke();
              }
            }
          }
          for (const n of nodes) {
            const thr = degreeThresholdRef.current;
            if (thr > 0 && n.degree < thr) continue;
            const {x, y} = worldToScreen(n);
            const r = Math.max(1, Math.sqrt(Math.max(1, n.degree)));
            const isNeighbor = hovered ? (n.id === hovered || (adjacencyRef.current[hovered] || []).includes(n.id)) : true;
            ctx2.fillStyle = isNeighbor ? "#9aa" : "#bbb";
            ctx2.beginPath();
            ctx2.arc(x, y, r, 0, Math.PI * 2);
            ctx2.fill();
          }
          if (hovered) {
            const h = nodes[idToIndexRef.current[hovered]];
            if (h) {
              const p = worldToScreen(h);
              ctx2.fillStyle = "#eee";
              ctx2.font = "12px system-ui, -apple-system, sans-serif";
              ctx2.fillText(h.name, p.x + 8, p.y - 8);
            }
          }
        };

        const onMove = throttle((ev: MouseEvent) => {
          const rect = canvas.getBoundingClientRect();
          const x = ev.clientX - rect.left;
          const y = ev.clientY - rect.top;
          if (isPanning && panStart) {
            const dx = x - panStart.x;
            const dy = y - panStart.y;
            viewRef.current.tx = viewStart.tx + dx;
            viewRef.current.ty = viewStart.ty + dy;
            draw();
            return;
          }
          const world = screenToWorld({x, y});
          let best: {id: string; d2: number} | null = null;
          for (const n of nodes) {
            const dx = n.x - world.x;
            const dy = n.y - world.y;
            const d2 = dx * dx + dy * dy;
            if (!best || d2 < best.d2) best = {id: n.id, d2};
          }
          const picked = best && best.d2 < 25 / (viewRef.current.scale * viewRef.current.scale) ? best.id : null;
          if (picked !== hovered) {
            hovered = picked;
            draw();
          }
        }, 24);

        const onLeave = () => { hovered = null; draw(); };

        const onWheel = (ev: WheelEvent) => {
          ev.preventDefault();
          const rect = canvas.getBoundingClientRect();
          const x = ev.clientX - rect.left;
          const y = ev.clientY - rect.top;
          const worldBefore = screenToWorld({x, y});
          const factor = Math.exp(-ev.deltaY * 0.001);
          const newScale = Math.min(4, Math.max(0.1, viewRef.current.scale * factor));
          viewRef.current.scale = newScale;
          const screenAfter = {x: worldBefore.x * newScale + viewRef.current.tx, y: worldBefore.y * newScale + viewRef.current.ty};
          viewRef.current.tx += x - screenAfter.x;
          viewRef.current.ty += y - screenAfter.y;
          hasInteracted = true;
          draw();
        };

        const onDown = (ev: MouseEvent) => {
          const rect = canvas.getBoundingClientRect();
          panStart = {x: ev.clientX - rect.left, y: ev.clientY - rect.top};
          viewStart = {...viewRef.current};
          isPanning = true;
          hasInteracted = true;
        };
        const onUp = () => { isPanning = false; };

        canvas.addEventListener("mousemove", onMove);
        canvas.addEventListener("mouseleave", onLeave);
        canvas.addEventListener("wheel", onWheel, {passive: false});
        canvas.addEventListener("mousedown", onDown);
        window.addEventListener("mouseup", onUp);
        const ro = new ResizeObserver(() => {
          resizeCanvas();
          if (!hasInteracted) computeFit();
          draw();
        });
        ro.observe(canvas.parentElement!);
        draw();
        (canvas as any)._cleanup = () => {
          canvas.removeEventListener("mousemove", onMove);
          canvas.removeEventListener("mouseleave", onLeave);
          canvas.removeEventListener("wheel", onWheel as any);
          canvas.removeEventListener("mousedown", onDown);
          window.removeEventListener("mouseup", onUp);
          ro.disconnect();
        };
      } catch (e) {
        console.warn("Canvas fallback failed", e);
      }
    }
    async function waitForNonZeroSize(maxFrames = 180) {
      let frames = 0;
      while (!disposed && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width >= 10 && rect.height >= 10) break;
        if (frames++ >= maxFrames) break;
        await new Promise((r) => requestAnimationFrame(r));
      }
    }

    async function init() {
      // Ensure the element has been committed and has a non-zero size
      await new Promise((r) => requestAnimationFrame(r));
      await waitForNonZeroSize();
      // Give the layout one more tick to settle before reading sizes
      await new Promise((r) => setTimeout(r, 32));
      if (disposed) return;
      if (!containerRef.current) return;
      const res = await fetch(viewMode === 'locality' ? "/graph_locality.json" : "/graph.json", {cache: "no-store"});
      const data: GraphData = await res.json();
      if (disposed) return;

      adjacencyRef.current = data.adjacency;
      // Compute totals for info box
      const blueEdgesCount = (data.edges || []).reduce((acc, e) => acc + ((e.allDBs || '').trim().toLowerCase() === 'none' ? 1 : 0), 0);
      setTotals({nodes: (data.nodes || []).length, edges: (data.edges || []).length, blueEdges: blueEdgesCount});

      // Compute min confidence (AFMprob) from dataset and initialize slider/state
      let minProb = Infinity;
      for (const e of data.edges || []) {
        const ap = typeof e.afmprob === 'number' ? e.afmprob : undefined;
        if (typeof ap === 'number' && !Number.isNaN(ap)) {
          if (ap < minProb) minProb = ap;
        }
      }
      if (!Number.isFinite(minProb)) minProb = 0;
      setMinConfidence(minProb);
      // Do not force slider value here if user reloads; initialize only if still default 0
      if (confidenceRef.current === 0) {
        setConfidence(minProb);
        confidenceRef.current = minProb;
      }

      const g = new Graph();
      // Add nodes
      for (const n of data.nodes) {
        g.addNode(n.id, {
          // Store original label as name; keep label empty by default for LOD
          name: n.label || n.id,
          label: "",
          x: n.x,
          y: n.y,
          size: n.size ?? 1,
          baseSize: n.size ?? 1,
          community: n.community ?? -1,
          degree: n.degree ?? 0,
        });
      }
      // Build simple name index for search
      nameIndexRef.current = data.nodes.map((n) => {
        const nm = (n.label || n.id) + "";
        return {id: n.id, name: nm, nameLower: nm.toLowerCase()};
      });
      // Add cluster meta-nodes (hidden by default)
      for (const c of data.clusters) {
        const id = `cluster:${c.id}`;
        if (!g.hasNode(id)) {
          g.addNode(id, {
            name: c.label || id,
            label: "",
            x: c.x,
            y: c.y,
            size: c.size ?? Math.max(2, Math.sqrt(c.count)),
            isCluster: 1,
            community: c.community,
            hidden: true,
            count: typeof c.count === 'number' ? c.count : undefined,
          });
        }
      }
      // Add edges (we will toggle their rendering later)
      for (const e of data.edges) {
        const id = e.id || `${e.source}-${e.target}`;
        if (!g.hasEdge(id)) g.addEdgeWithKey(id, e.source, e.target, {weight: e.weight ?? 1, allDBs: e.allDBs || '', afmprob: e.afmprob});
        edgeAllDBsRef.current[id] = e.allDBs || '';
      }
      // Hide all edges by default; they'll appear on hover
      g.forEachEdge((edge, attrs) => {
        const adb = (attrs as any).allDBs || '';
        const isNone = String(adb).trim().toLowerCase() === 'none';
        const hideByNew = showOnlyNewRef.current && !isNone;
        const ap = (attrs as any).afmprob;
        const hideByConf = typeof ap === 'number' ? ap < confidenceRef.current : false;
        g.setEdgeAttribute(edge, "hidden", true || hideByNew);
        if (hideByConf) g.setEdgeAttribute(edge, 'hidden', true);
      });
      // Precompute nodes involved in 'none' edges and counts for heatmap
      const nodesBlue = new Set<string>();
      const counts: Record<string, number> = {};
      g.forEachEdge((e, attrs, sId, tId) => {
        const adb = (attrs as any).allDBs || '';
        if (String(adb).trim().toLowerCase() === 'none') {
          nodesBlue.add(sId); nodesBlue.add(tId);
          counts[sId] = (counts[sId] || 0) + 1;
          counts[tId] = (counts[tId] || 0) + 1;
        }
      });
      nodesBlueSetRef.current = nodesBlue;
      nodesBlueCountsRef.current = counts;
      maxBlueCountRef.current = Object.values(counts).reduce((m, v) => Math.max(m, v), 0);
      // Set initial node colors according to heat map
      g.forEachNode((n) => {
        if (nodesBlue.has(n)) {
          const c = counts[n] || 0;
          g.setNodeAttribute(n, 'color', getHeatColorForCount(c));
        }
        // Apply initial visibility if only-new filter is active
        const attrs = g.getNodeAttributes(n) as any;
        if (!attrs?.isCluster) {
          const deg = attrs?.degree || 0;
          const hideByDeg = degreeThresholdRef.current > 0 && deg < degreeThresholdRef.current;
          const hideByNew = showOnlyNewRef.current && !nodesBlueSetRef.current.has(n);
          g.setNodeAttribute(n, 'hidden', hideByDeg || hideByNew);
        }
      });

      graphRef.current = g;

      if (containerRef.current) {
        // If WebGL is unavailable, go straight to Canvas fallback and avoid logging errors
        if (!isWebGLAvailable()) {
          console.warn("WebGL unavailable – using Canvas fallback");
          startCanvasFallback(data);
          return;
        }
        try {
          // Patch getContext to gracefully fallback from webgl2 -> webgl on Chrome
          const originalGetContext = HTMLCanvasElement.prototype.getContext;
          if (!(originalGetContext as any)._patchedForSigma) {
            const patched = function(this: HTMLCanvasElement, type: string, attrs?: any) {
              let ctx: any = originalGetContext.call(this, type as any, attrs);
              if (!ctx && type === "webgl2") ctx = originalGetContext.call(this, "webgl" as any, attrs);
              return ctx;
            } as typeof originalGetContext;
            (patched as any)._patchedForSigma = true;
            HTMLCanvasElement.prototype.getContext = patched;
          }

          const {default: Sigma} = await import("sigma");
          const container = containerRef.current;
          const rect = container.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            container.style.width = `${Math.floor(rect.width)}px`;
            container.style.height = `${Math.floor(rect.height)}px`;
          }
          container.style.overflow = "hidden";
          container.style.position = container.style.position || "absolute";
          const s = new Sigma(g, container, {
            renderLabels: true,
            labelRenderedSizeThreshold: 999999,
            minCameraRatio: 0.01,
            maxCameraRatio: 10,
          });

          // Debug logging toggle (default on). To disable: set window.__graphDebug = false in console.
          const isDebug = () => (window as any).__graphDebug !== false;
          const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
          const getGraphBounds = () => {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            g.forEachNode((n, attrs) => {
              if (attrs == null) return;
              // Ignore hidden clusters for bounds stability
              if (attrs.isCluster) return;
              const x = typeof attrs.x === "number" ? attrs.x : 0;
              const y = typeof attrs.y === "number" ? attrs.y : 0;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            });
            if (minX === Infinity) return {minX: 0, minY: 0, maxX: 0, maxY: 0};
            return {minX, minY, maxX, maxY};
          };

          // Resize observer to keep canvas in sync with container size
          const ro = new ResizeObserver(() => {
            const rect = container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) s.refresh();
          });
          ro.observe(container);
          (s as any)._ro = ro;

        // Level of Detail: control node sizes, cluster toggle, and edge visibility by zoom
        let lastLOD = 0;
        const updateLOD = () => {
          if ((window as any).__suspendLOD) return;
          const ratio = s.getCamera().getState().ratio;
          const drawEdges = showAllEdgesRef.current || (showEdgesRef.current && ratio < 1.5);
          try {
            // Sigma v3 uses boolean setting key 'renderEdges'; TS types may not include it in our env
            (s as any).setSetting("renderEdges", drawEdges);
          } catch {}

          // Toggle cluster mode when zoomed out a lot
          const clusterMode = ratio > 1.2; // higher ratio => more zoomed out
          if (clusterMode !== clusterModeRef.current) {
            clusterModeRef.current = clusterMode;
            g.forEachNode((n, attrs) => {
              const isCluster = !!attrs.isCluster;
              if (clusterMode) {
                // Show clusters, hide regular nodes
                g.setNodeAttribute(n, "hidden", !isCluster);
              } else {
                // Hide clusters, show regular nodes (respect degree filter separately)
                if (isCluster) g.setNodeAttribute(n, "hidden", true);
                else {
                  const deg = attrs.degree || 0;
                  g.setNodeAttribute(n, "hidden", deg < degreeThresholdRef.current);
                }
              }
            });
          }

          // Throttle size recomputation
          if (Math.abs(ratio - lastLOD) > 0.08) {
            lastLOD = ratio;
            const baseSize = ratio > 1 ? 1 : Math.max(0.4, ratio);
            g.forEachNode((n, attrs) => {
              if (attrs.isCluster) return;
              const deg = attrs.degree || 0;
              const size = Math.max(0.5, Math.sqrt(Math.max(1, deg)) * baseSize);
              g.setNodeAttribute(n, "size", size);
              g.setNodeAttribute(n, "baseSize", size);
            });
          }
        };

        const clampCameraToGraph = () => {
          if (isClampingRef.current) return;
          try {
            const cam = s.getCamera();
            const st = cam.getState();
            // In Sigma's normalized camera space, x and y are ~[0,1] and ratio indicates the visible span.
            // So clamp to [ratio/2, 1 - ratio/2] without mixing pixels.
            const mx = st.ratio / 2;
            const my = st.ratio / 2;
            let cx = st.x;
            let cy = st.y;
            const nx = clamp(st.x, mx, 1 - mx);
            const ny = clamp(st.y, my, 1 - my);
            if (Math.abs(nx - st.x) > 1e-3 || Math.abs(ny - st.y) > 1e-3) {
              if (isDebug()) console.log("[Graph] cam clamp", {from: st, to: {x: nx, y: ny}, margins: {mx, my}});
              cx = nx; cy = ny;
              isClampingRef.current = true;
              cam.setState({x: cx, y: cy, ratio: st.ratio, angle: st.angle});
              isClampingRef.current = false;
            }
          } catch {}
        };

        const onCamUpdate = () => {
          // lightweight throttling
          if ((onCamUpdate as any)._t && performance.now() - (onCamUpdate as any)._t < 120) return;
          (onCamUpdate as any)._t = performance.now();
          updateLOD();
          clampCameraToGraph();
          // Render cluster labels in cluster mode (and for locality view always)
          try {
            if (clusterModeRef.current || viewMode === 'locality') {
              let layer = clusterLabelsRef.current;
              if (!layer) {
                layer = document.createElement('div');
                layer.style.position = 'absolute';
                layer.style.left = '0';
                layer.style.top = '0';
                layer.style.right = '0';
                layer.style.bottom = '0';
                layer.style.pointerEvents = 'none';
                container.appendChild(layer);
                clusterLabelsRef.current = layer;
              }
              const used = {} as Record<string, true>;
              g.forEachNode((n, attrs) => {
                if (!attrs?.isCluster) return;
                if (clusterModeRef.current && g.getNodeAttribute(n, 'hidden')) return;
                const name = (attrs.name as string) || '';
                const cnt = (attrs as any)?.count;
                const pos = (s as any).graphToViewport?.({x: attrs.x, y: attrs.y});
                if (!pos) return;
                let el = clusterLabelElsRef.current[n];
                if (!el) {
                  el = document.createElement('div');
                  el.style.position = 'absolute';
                  el.style.color = '#e5e7eb';
                  el.style.fontSize = '12px';
                  el.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
                  el.style.pointerEvents = 'none';
                  el.style.textShadow = '0 1px 2px rgba(0,0,0,0.6)';
                  clusterLabelElsRef.current[n] = el;
                  layer.appendChild(el);
                }
                el.textContent = cnt ? `${name} (${cnt})` : name;
                el.style.left = `${Math.round(pos.x)}px`;
                el.style.top = `${Math.round(pos.y - 16)}px`;
                el.style.transform = 'translate(-50%, -100%)';
                used[n] = true;
              });
              for (const key of Object.keys(clusterLabelElsRef.current)) {
                if (!used[key]) {
                  const el = clusterLabelElsRef.current[key];
                  if (el && el.parentElement) el.parentElement.removeChild(el);
                  delete clusterLabelElsRef.current[key];
                }
              }
            } else if (clusterLabelsRef.current) {
              clusterLabelsRef.current.innerHTML = '';
            }
          } catch {}
          // Draw group outlines + labels for locality view
          try {
            if (viewMode === 'locality') {
              let layer = groupOutlineLayerRef.current;
              const container = containerRef.current!;
              if (!layer) {
                layer = document.createElement('div');
                layer.style.position = 'absolute';
                layer.style.left = '0';
                layer.style.top = '0';
                layer.style.right = '0';
                layer.style.bottom = '0';
                layer.style.pointerEvents = 'none';
                container.appendChild(layer);
                groupOutlineLayerRef.current = layer;
              }
              const used: Record<string, true> = {};
              const groupDefs = [
                {key: 'NUCLEUS', members: ['nucleus','chromosome','spliceosome','centromere','kinetochore','nucleosome core','telomere','nuclear pore complex','dna-directed rna polymerase','primosome']},
                {key: 'CYTOPLASM', members: ['cytoplasm','cytoskeleton','endoplasmic reticulum','golgi apparatus','cytoplasmic vesicle','endosome','lysosome','microtubule','mitochondrion outer membrane','microsome','intermediate filament','peroxisome','proteasome','proteaosome','lipid droplet','sarcoplasmic reticulum','signalosome','inflammasome','signal recognition particle','thick filament','vacuole','viral envelope protein','target membrane','membrane']},
                {key: 'MITOCHONDRIA', members: ['mitochondrion','mitochondrion inner membrane','mitochondrion nuclei','mitochondrion nucleoid']},
                {key: 'EXTRACELLULAR', members: ['cell membrane','cell projection','synapse','cell junction','cilium','extracellular matrix','immunoglobulin','postsynaptic cell membrane','flagellum','t cell receptor','keratin','tight junction','synaptosome','coated pit','basement membrane','dynein','mhc ii','gap junction','hdl','exosome','mhc i','ldl','vldl','membrane attack complex','surface film','chylomicron','virion','target cell membrane']},
                {key: 'OTHER', members: []},
              ];
              const toGroup = (loc: string) => {
                const k = (loc || '').toLowerCase();
                for (let gi = 0; gi < groupDefs.length - 1; gi++) if (groupDefs[gi].members.includes(k)) return groupDefs[gi].key;
                return 'OTHER';
              };
              const groupPts: Record<string, Array<{x:number;y:number;w:number}>> = {};
              g.forEachNode((n, attrs) => {
                if (!attrs?.isCluster) return;
                const nm = (attrs.name as string) || '';
                const group = toGroup(nm);
                // Offset group centroid downward slightly to avoid label overlap with dense clusters
                const pos = (s as any).graphToViewport?.({x: attrs.x, y: attrs.y + 10});
                if (!pos) return;
                if (!groupPts[group]) groupPts[group] = [];
                const w = Math.max(1, Number((attrs as any)?.count) || 1);
                groupPts[group].push({x: pos.x, y: pos.y, w});
              });
              for (const def of groupDefs) {
                const pts = groupPts[def.key];
                if (!pts || !pts.length) continue;
                // centroid and radius
                let sx=0, sy=0, sw=0; for (const p of pts){sx+=p.x*p.w; sy+=p.y*p.w; sw+=p.w;}
                const cx = sx/Math.max(1,sw), cy = sy/Math.max(1,sw);
                let r = 60; for (const p of pts){const dx=p.x-cx,dy=p.y-cy; const d=Math.sqrt(dx*dx+dy*dy)+Math.sqrt(p.w)*0.6+30; if(d>r) r=d;}
                let el = groupOutlineElsRef.current[def.key];
                if (!el) {
                  el = document.createElement('div');
                  el.style.position = 'absolute';
                  el.style.border = '1px solid rgba(148,163,184,0.9)';
                  el.style.borderRadius = '9999px';
                  el.style.background = 'rgba(148,163,184,0.06)';
                  el.style.pointerEvents = 'none';
                  const label = document.createElement('div');
                  label.style.position = 'absolute';
                  label.style.color = '#e5e7eb';
                  label.style.fontSize = '14px';
                  label.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
                  label.style.transform = 'translate(-50%, -100%)';
                  el.appendChild(label);
                  layer.appendChild(el);
                  groupOutlineElsRef.current[def.key] = el;
                }
                const label = el.lastChild as HTMLDivElement;
                // Position outline div centered at (cx, cy)
                el.style.left = `${Math.round(cx - r)}px`;
                el.style.top = `${Math.round(cy - r)}px`;
                el.style.width = `${Math.round(r * 2)}px`;
                el.style.height = `${Math.round(r * 2)}px`;
                // Place label relative to the circle's own box, at top-center just outside
                label.textContent = def.key;
                label.style.left = `${Math.round(r)}px`;
                label.style.top = `0px`;
                label.style.transform = 'translate(-50%, -110%)';
                used[def.key] = true;
              }
              for (const key of Object.keys(groupOutlineElsRef.current)) {
                if (!used[key]) {
                  const el = groupOutlineElsRef.current[key];
                  if (el && el.parentElement) el.parentElement.removeChild(el);
                  delete groupOutlineElsRef.current[key];
                }
              }
            } else if (groupOutlineLayerRef.current) {
              groupOutlineLayerRef.current.innerHTML = '';
            }
          } catch {}

          // Debug camera state occasionally
          if (isDebug()) {
            if (!(onCamUpdate as any)._lt || performance.now() - (onCamUpdate as any)._lt > 320) {
              (onCamUpdate as any)._lt = performance.now();
              try { console.log("[Graph] cam", s.getCamera().getState()); } catch {}
            }
          }
        };
        s.getCamera().on("updated", onCamUpdate);
        updateLOD();
        // Force an initial label render (especially when switching to locality view)
        try { onCamUpdate(); } catch {}

        // Hover focus: zoom to node, show only neighbors, show neighbor edges
        const setHovered = throttle((node?: string) => {
          const neighbors = new Set<string>();
          if (node) {
            neighbors.add(node);
            const onlyNew = showOnlyNewRef.current;
            const conf = confidenceRef.current;
            // Build neighbors based on filters (only-new and confidence)
            g.forEachEdge((e, attrs, sId, tId) => {
              const isEnd = sId === node || tId === node;
              if (!isEnd) return;
              const adb = (attrs as any).allDBs || '';
              const isNone = String(adb).trim().toLowerCase() === 'none';
              if (onlyNew && !isNone) return;
              const ap = (attrs as any).afmprob;
              if (typeof ap === 'number' && ap < conf) return;
              neighbors.add(sId);
              neighbors.add(tId);
            });
          }

          g.forEachNode((n) => {
            const isCluster = !!g.getNodeAttribute(n, "isCluster");
            if (isCluster) return; // ignore clusters in hover focus
            const isNeighbor = node ? neighbors.has(n) : true;
            const shouldHighlight = node ? isNeighbor : false;
            g.setNodeAttribute(n, "highlighted", shouldHighlight ? 1 : 0);
            // Always keep blue nodes visible with heatmap intensity; dim non-neighbors
            const isBlueNode = nodesBlueSetRef.current.has(n);
            if (isBlueNode) {
              const c = nodesBlueCountsRef.current[n] || 0;
              const col = getHeatColorForCount(c, isNeighbor ? 1 : 0.6);
              g.setNodeAttribute(n, "color", col);
            } else {
            g.setNodeAttribute(n, "color", isNeighbor ? undefined : "#bbb");
            }
            // Only show hovered node and neighbors; hide others
            const hideByDeg = degreeThresholdRef.current > 0 && (g.getNodeAttribute(n, "degree") || 0) < degreeThresholdRef.current;
            const hideByNew = showOnlyNewRef.current && !nodesBlueSetRef.current.has(n);
            const hidden = node ? !isNeighbor || hideByNew : (hideByDeg || hideByNew);
            g.setNodeAttribute(n, "hidden", clusterModeRef.current ? true : hidden);
            // Show label only for hovered node and its actual neighbors
            const name = g.getNodeAttribute(n, "name") || "";
            const isHovered = node && n === node;
            g.setNodeAttribute(n, "label", (isHovered || (node && isNeighbor)) ? name : "");
            // Enlarge hovered node only for readability
            const baseSize = g.getNodeAttribute(n, "baseSize") || g.getNodeAttribute(n, "size") || 1;
            const factor = isHovered ? 2.8 : 1;
            g.setNodeAttribute(n, "size", baseSize * factor);
          });

          // Render locality labels even in non-cluster mode if locality view
          try {
            if (viewMode === 'locality') {
              let layer = clusterLabelsRef.current;
              const container = containerRef.current!;
              if (!layer) {
                layer = document.createElement('div');
                layer.style.position = 'absolute';
                layer.style.left = '0';
                layer.style.top = '0';
                layer.style.right = '0';
                layer.style.bottom = '0';
                layer.style.pointerEvents = 'none';
                container.appendChild(layer);
                clusterLabelsRef.current = layer;
              }
              const used = {} as Record<string, true>;
              g.forEachNode((nid, attrs) => {
                if (!attrs?.isCluster) return;
                // Always show cluster labels in locality view
                const name = (attrs.name as string) || '';
                const cnt = (attrs as any)?.count;
                const pos = (sigmaRef.current as any).graphToViewport?.({x: attrs.x, y: attrs.y});
                if (!pos) return;
                let el = clusterLabelElsRef.current[nid];
                if (!el) {
                  el = document.createElement('div');
                  el.style.position = 'absolute';
                  el.style.color = '#e5e7eb';
                  el.style.fontSize = '12px';
                  el.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
                  el.style.pointerEvents = 'none';
                  el.style.textShadow = '0 1px 2px rgba(0,0,0,0.6)';
                  clusterLabelElsRef.current[nid] = el;
                  layer.appendChild(el);
                }
                el.textContent = cnt ? `${name} (${cnt})` : name;
                el.style.left = `${Math.round(pos.x)}px`;
                el.style.top = `${Math.round(pos.y - 16)}px`;
                el.style.transform = 'translate(-50%, -100%)';
                used[nid] = true;
              });
              for (const key of Object.keys(clusterLabelElsRef.current)) {
                if (!used[key]) {
                  const el = clusterLabelElsRef.current[key];
                  if (el && el.parentElement) el.parentElement.removeChild(el);
                  delete clusterLabelElsRef.current[key];
                }
              }
            }
          } catch {}

          // Draw only edges connected to hovered node when showEdges is on
          if (showEdgesRef.current && !showAllEdgesRef.current) {
            g.forEachEdge((e, _attr, sId, tId) => {
              let visible = node ? neighbors.has(sId) && neighbors.has(tId) : false;
              const adb = (g.getEdgeAttribute(e, 'allDBs') || '').toString().trim().toLowerCase();
              const isNone = adb === 'none';
              const hideByNew = showOnlyNewRef.current && !isNone;
              const ap = g.getEdgeAttribute(e, 'afmprob') as number | undefined;
              const hideByConf = typeof ap === 'number' ? ap < confidenceRef.current : false;
              g.setEdgeAttribute(e, "hidden", !visible || hideByNew || hideByConf);
              if (visible) g.setEdgeAttribute(e, 'color', isNone ? '#3b82f6' : undefined);
              else g.setEdgeAttribute(e, 'color', undefined);
            });
          } else {
            g.forEachEdge((e) => {
              const adb = (g.getEdgeAttribute(e, 'allDBs') || '').toString().trim().toLowerCase();
              const isNone = adb === 'none';
              const hideByNew = showOnlyNewRef.current && !isNone;
              const ap = g.getEdgeAttribute(e, 'afmprob') as number | undefined;
              const hideByConf = typeof ap === 'number' ? ap < confidenceRef.current : false;
              // If showAllEdges is on and not focused, show all (filtered) edges; otherwise hide by default
              const notFocused = !focusedNodeRef.current;
              const defaultHidden = showAllEdgesRef.current && notFocused ? false : true;
              g.setEdgeAttribute(e, "hidden", defaultHidden || hideByNew || hideByConf);
            });
          }

          // Camera focus
          if (node) {
          // Ensure gene info fetch on focus as well (not only on hover)
          try {
            const nmNow = (g.getNodeAttribute(node, 'name') as string) || node;
            if (geneTimerRef.current) { window.clearTimeout(geneTimerRef.current); geneTimerRef.current = null; }
            geneTimerRef.current = window.setTimeout(() => fetchGeneSummary(nmNow), 50);
          } catch {}
            const cam = s.getCamera();
            // Save previous cam state only if we are focusing a new node
            if (focusedNodeRef.current !== node) {
            if (!focusedNodeRef.current) prevCamStateRef.current = cam.getState();
            }
            focusedNodeRef.current = node;
            // Update focused info (degree and blue-degree) respecting filters
            try {
              const thr = degreeThresholdRef.current;
              const onlyNew = showOnlyNewRef.current;
              const conf = confidenceRef.current;
              let degF = 0, blueF = 0;
              g.forEachEdge((e, attrs, sId, tId) => {
                if (sId !== node && tId !== node) return;
                const other = sId === node ? tId : sId;
                const otherDeg = (g.getNodeAttribute(other, 'degree') as number) || 0;
                const hideByDeg = thr > 0 && otherDeg < thr;
                const hideByNewNode = onlyNew && !nodesBlueSetRef.current.has(other);
                if (hideByDeg || hideByNewNode) return;
                const ap = (attrs as any)?.afmprob;
                if (typeof ap === 'number' && ap < conf) return;
                const adb = (attrs as any)?.allDBs || '';
                const isNone = String(adb).trim().toLowerCase() === 'none';
                if (onlyNew && !isNone) return;
                degF++;
                if (isNone) blueF++;
              });
              let nm = g.getNodeAttribute(node, 'name') as string | undefined;
              if (!nm || !nm.trim()) {
                const found = nameIndexRef.current.find((e) => e.id === node);
                nm = (found && found.name) || (g.getNodeAttribute(node, 'label') as string) || node;
              }
              setFocusedInfo({id: node, name: nm, degree: degF, blue: blueF});
            } catch {}
            const x = g.getNodeAttribute(node, "x");
            const y = g.getNodeAttribute(node, "y");
            // Compute a relative zoom-in in normalized camera space and clamp within [ratio/2, 1-ratio/2]
            const current = cam.getState();
            const targetRatio = Math.max(0.25, Math.min(1, current.ratio * 0.65));
            const {minX, minY, maxX, maxY} = getGraphBounds();
            const nx = (x - minX) / Math.max(1e-9, (maxX - minX));
            const ny = (y - minY) / Math.max(1e-9, (maxY - minY));
            const mx = targetRatio / 2;
            const my = targetRatio / 2;
            const tx = clamp(nx, mx, 1 - mx);
            const ty = clamp(ny, my, 1 - my);
            const target = {x: tx, y: ty, ratio: targetRatio};
            if (isDebug()) {
              console.log("[Graph] focus", {node, nodePos: {x, y}, current, targetBefore: {x: nx, y: ny, ratio: targetRatio},
                margins: {mx, my}, clamped: {x: tx, y: ty}});
            }
            // Avoid restarting the same animation while one is in progress
            if (!suppressCamAnimRef.current) {
              if (!isAnimatingRef.current && focusedNodeRef.current === node) {
            try { 
              (window as any).__suspendLOD = true;
                  isAnimatingRef.current = true;
                  (cam as any).animate(target, {duration: 500, easing: 'quadraticInOut'} as any);
                  window.setTimeout(() => { (window as any).__suspendLOD = false; isAnimatingRef.current = false; }, 520);
                } catch {
                  cam.setState(target);
                  (window as any).__suspendLOD = false;
                  isAnimatingRef.current = false;
                }
              }
            }
          } else if (focusedNodeRef.current) {
            // Defer defocus slightly to avoid flicker when camera moves node under cursor
            if (defocusTimerRef.current) window.clearTimeout(defocusTimerRef.current);
            defocusTimerRef.current = window.setTimeout(() => {
              const cam = s.getCamera();
              const st = prevCamStateRef.current || {ratio: 1};
              try {
                isAnimatingRef.current = true;
                (cam as any).animate(st, {duration: 500, easing: 'quadraticInOut'} as any);
                window.setTimeout(() => { isAnimatingRef.current = false; }, 520);
              } catch { cam.setState(st); isAnimatingRef.current = false; }
              focusedNodeRef.current = null;
              setFocusedInfo(null);
              // Restore nodes (respect degree filter) and keep only-new filter
              g.forEachNode((n, attrs) => {
                if (attrs.isCluster) return;
                const deg = attrs.degree || 0;
                const hideByDeg = degreeThresholdRef.current > 0 && deg < degreeThresholdRef.current;
                const hideByNew = showOnlyNewRef.current && !nodesBlueSetRef.current.has(n);
                g.setNodeAttribute(n, "hidden", hideByDeg || hideByNew);
                g.setNodeAttribute(n, "label", "");
                // Preserve heatmap blue after defocus
                if (nodesBlueSetRef.current.has(n)) {
                  const c = nodesBlueCountsRef.current[n] || 0;
                  g.setNodeAttribute(n, "color", getHeatColorForCount(c));
                } else {
                g.setNodeAttribute(n, "color", undefined);
                }
                g.setNodeAttribute(n, "highlighted", 0);
                // restore size
                const baseSize = g.getNodeAttribute(n, "baseSize") || g.getNodeAttribute(n, "size") || 1;
                g.setNodeAttribute(n, "size", baseSize);
              });
              // Hide non-new edges when only-new is active
              g.forEachEdge((e, attrs) => {
                const adb = (attrs as any).allDBs || '';
                const isNone = String(adb).trim().toLowerCase() === 'none';
                const ap = (attrs as any).afmprob;
                const hideByConf = typeof ap === 'number' ? ap < confidenceRef.current : false;
                if ((showOnlyNewRef.current && !isNone) || hideByConf) g.setEdgeAttribute(e, 'hidden', true);
              });
              s.refresh();
            }, 180);
            return;
          }

          s.refresh();
        }, 24);
        setHoveredRef.current = (nodeId?: string) => setHovered(nodeId);

        // Lightweight hover preview: show edges + label only, no zoom/pan/size changes
        const previewHover = throttle((node?: string) => {
          if (focusedNodeRef.current) return; // ignore hover when focused via click
          // clear all labels first
          g.forEachNode((n) => g.setNodeAttribute(n, "label", ""));
          if (node) {
            const name = g.getNodeAttribute(node, "name") || "";
            g.setNodeAttribute(node, "label", name);
          }
          if (showEdgesRef.current) {
            const nbSet = new Set<string>();
            if (node) {
              nbSet.add(node);
              for (const nb of adjacencyRef.current[node] || []) nbSet.add(nb);
            }
            g.forEachEdge((e, _attr, sId, tId) => {
              const vis = node ? nbSet.has(sId) && nbSet.has(tId) : false;
              const adb = (g.getEdgeAttribute(e, 'allDBs') || '').toString().trim().toLowerCase();
              const isNone = adb === 'none';
              g.setEdgeAttribute(e, 'hidden', !vis);
              if (vis) g.setEdgeAttribute(e, 'color', isNone ? '#3b82f6' : undefined);
              else g.setEdgeAttribute(e, 'color', undefined);
            });
          } else {
            g.forEachEdge((e) => g.setEdgeAttribute(e, 'hidden', true));
          }
          s.refresh();
        }, 24);

        // Click to focus node
        s.on("clickNode", ({node}) => {
          if (defocusTimerRef.current) { window.clearTimeout(defocusTimerRef.current); defocusTimerRef.current = null; }
          setHovered(node);
          const nm = (g.getNodeAttribute(node, 'name') as string) || node;
          if (geneTimerRef.current) { window.clearTimeout(geneTimerRef.current); geneTimerRef.current = null; }
          geneTimerRef.current = window.setTimeout(() => fetchGeneSummary(nm), 150);
        });
        // Click empty stage: if clicking on a visible label badge, treat as clicking that node; otherwise defocus
        s.on("clickStage", (evt: any) => {
          let handled = false;
          try {
            // Compute viewport pixel coords from clientX/Y when available
            const rect = container.getBoundingClientRect();
            const ex = (evt && (evt.event?.original?.clientX ?? evt.event?.clientX ?? evt.event?.x ?? evt.x)) ?? 0;
            const ey = (evt && (evt.event?.original?.clientY ?? evt.event?.clientY ?? evt.event?.y ?? evt.y)) ?? 0;
            const px = ex - rect.left;
            const py = ey - rect.top;
            const nodesWithLabel: string[] = [];
            g.forEachNode((n) => {
              const lbl = (g.getNodeAttribute(n, 'label') as string) || '';
              const hidden = !!g.getNodeAttribute(n, 'hidden');
              if (!hidden && lbl) nodesWithLabel.push(n);
            });
            for (const n of nodesWithLabel) {
              const label = (g.getNodeAttribute(n, 'label') as string) || '';
              const xg = g.getNodeAttribute(n, 'x');
              const yg = g.getNodeAttribute(n, 'y');
              if (typeof xg !== 'number' || typeof yg !== 'number' || !label) continue;
              const vp = (s as any).graphToViewport?.({x: xg, y: yg}) || {x: 0, y: 0};
              const sizePx = ((s as any).getNodeDisplayData?.(n)?.size) || 4;
              const startX = vp.x + sizePx + 6;
              const width = Math.max(24, Math.min(260, label.length * 6.5));
              const endX = startX + width;
              const startY = vp.y - 10;
              const endY = vp.y + 6;
              if (px >= startX && px <= endX && py >= startY && py <= endY) {
                handled = true;
                setHovered(n);
                break;
              }
            }
          } catch {}
          if (handled) return;
          // clear any labels and edges when defocusing via empty click
          g.forEachNode((n) => g.setNodeAttribute(n, 'label', ''));
          g.forEachEdge((e, attrs) => {
            const adb = (attrs as any)?.allDBs || '';
            const isNone = String(adb).trim().toLowerCase() === 'none';
            const ap = (attrs as any)?.afmprob;
            const hideByNew = showOnlyNewRef.current && !isNone;
            const hideByConf = typeof ap === 'number' ? ap < confidenceRef.current : false;
            const notFocused = true;
            const defaultHidden = showAllEdgesRef.current && notFocused ? false : true;
            g.setEdgeAttribute(e, 'hidden', defaultHidden || hideByNew || hideByConf);
          });
          setHovered(undefined);
        });
        // Hover preview handlers (no camera movement)
        s.on("enterNode", ({node}) => {
          previewHover(node);
          if (!focusedNodeRef.current) {
            const nm = (g.getNodeAttribute(node, 'name') as string) || node;
            if (geneTimerRef.current) { window.clearTimeout(geneTimerRef.current); geneTimerRef.current = null; }
            geneTimerRef.current = window.setTimeout(() => fetchGeneSummary(nm), 250);
          }
        });
        s.on("leaveNode", () => { previewHover(undefined); if (!focusedNodeRef.current) setGeneInfo(null); });

          sigmaRef.current = s;
        } catch (err) {
          console.warn("Sigma WebGL init failed – using Canvas fallback", err);
          // Fallback to simple Canvas2D renderer when WebGL is unavailable
          try {
            const container = containerRef.current!;
            const canvas = fallbackCanvasRef.current!;
            container.style.display = "none";
            canvas.style.display = "block";

            function resizeCanvas() {
              const rect = canvas.parentElement!.getBoundingClientRect();
              const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
              canvas.width = Math.floor(rect.width * dpr);
              canvas.height = Math.floor(rect.height * dpr);
              canvas.style.width = `${Math.floor(rect.width)}px`;
              canvas.style.height = `${Math.floor(rect.height)}px`;
              const ctx = canvas.getContext("2d");
              fallbackCtxRef.current = ctx;
              if (!ctx) return;
              ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }

            resizeCanvas();
            const ctx = (fallbackCtxRef.current = canvas.getContext("2d"));
            if (!ctx) return;

            // Prepare node arrays
            const nodes = data.nodes.map((n) => ({
              id: n.id,
              x: n.x,
              y: n.y,
              size: Math.max(1, n.size || 1),
              degree: n.degree || 0,
              name: n.label || n.id,
            }));
            fallbackNodesRef.current = nodes;
            const idToIndex: Record<string, number> = {};
            nodes.forEach((n, i) => (idToIndex[n.id] = i));
            idToIndexRef.current = idToIndex;

            function computeFit() {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const n of nodes) {
                if (n.x < minX) minX = n.x;
                if (n.y < minY) minY = n.y;
                if (n.x > maxX) maxX = n.x;
                if (n.y > maxY) maxY = n.y;
              }
              const rect = canvas.getBoundingClientRect();
              const width = rect.width;
              const height = rect.height;
              const dx = maxX - minX || 1;
              const dy = maxY - minY || 1;
              const padding = 20;
              const sx = (width - 2 * padding) / dx;
              const sy = (height - 2 * padding) / dy;
              const scale = Math.min(sx, sy);
              const tx = padding - minX * scale + (width - (dx * scale + 2 * padding)) / 2;
              const ty = padding - minY * scale + (height - (dy * scale + 2 * padding)) / 2;
              viewRef.current = {scale, tx, ty};
            }

            computeFit();

            // Once the user interacts (zoom/pan/hover-zoom), stop auto-fitting on resize
            let hasInteracted = false;

            let hovered: string | null = null;
            let isPanning = false;
            let panStart: {x: number; y: number} | null = null;
            let viewStart = {scale: 1, tx: 0, ty: 0};

            function worldToScreen(p: {x: number; y: number}) {
              const {scale, tx, ty} = viewRef.current;
              return {x: p.x * scale + tx, y: p.y * scale + ty};
            }
            function screenToWorld(p: {x: number; y: number}) {
              const {scale, tx, ty} = viewRef.current;
              return {x: (p.x - tx) / scale, y: (p.y - ty) / scale};
            }

            function draw() {
              const ctx = fallbackCtxRef.current!;
              const rect = canvas.getBoundingClientRect();
              ctx.clearRect(0, 0, rect.width, rect.height);
              // edges on focus
              if (hovered && showEdgesRef.current) {
                const src = nodes[idToIndexRef.current[hovered]];
                if (src) {
                  ctx.strokeStyle = "rgba(150,150,150,0.6)";
                  ctx.lineWidth = 1;
                  const srcS = worldToScreen(src);
                  for (const nb of adjacencyRef.current[hovered] || []) {
                    const t = nodes[idToIndexRef.current[nb]];
                    if (!t) continue;
                    const thr = degreeThresholdRef.current;
                    if (thr > 0 && t.degree < thr) continue;
                    const tS = worldToScreen(t);
                    ctx.beginPath();
                    ctx.moveTo(srcS.x, srcS.y);
                    ctx.lineTo(tS.x, tS.y);
                    ctx.stroke();
                  }
                }
              }
            // nodes
            const neighborSet = hovered ? new Set<string>([hovered, ...(adjacencyRef.current[hovered] || [])]) : null;
            for (const n of nodes) {
                const thr = degreeThresholdRef.current;
              if (neighborSet) {
                if (!neighborSet.has(n.id)) continue;
              } else if (thr > 0 && n.degree < thr) continue;
                const {x, y} = worldToScreen(n);
              const r = Math.max(1, Math.sqrt(Math.max(1, n.degree)) * (hovered ? 1.6 : 1));
                const isNeighbor = hovered ? (n.id === hovered || (adjacencyRef.current[hovered] || []).includes(n.id)) : true;
                ctx.fillStyle = isNeighbor ? "#9aa" : "#bbb";
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.fill();
              }
              // label for focused
              if (hovered) {
                const h = nodes[idToIndexRef.current[hovered]];
                if (h) {
                  const p = worldToScreen(h);
                  ctx.fillStyle = "#222";
                  ctx.font = "12px system-ui, -apple-system, sans-serif";
                  ctx.fillText(h.name, p.x + 8, p.y - 8);
                }
              }
            }

            let isAnimating = false;
            let animToken = 0;
            const animateTo = (targetCenter: {x: number; y: number}, targetScale: number) => {
              // ~0.5s animation at 60fps -> ~30 steps
              const steps = 30;
              const start = {...viewRef.current};
              let i = 0;
              isAnimating = true;
              const myToken = ++animToken;
              const tick = () => {
                if (myToken !== animToken) { isAnimating = false; return; }
                i += 1;
                const t = i / steps;
                const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // quadraticInOut
                viewRef.current.scale = start.scale + (targetScale - start.scale) * ease;
                // set tx, ty so that targetCenter maps to canvas center
                const rect = canvas.getBoundingClientRect();
                const cx = rect.width / 2;
                const cy = rect.height / 2;
                viewRef.current.tx = cx - targetCenter.x * viewRef.current.scale;
                viewRef.current.ty = cy - targetCenter.y * viewRef.current.scale;
                draw();
                if (i < steps) requestAnimationFrame(tick);
                else { isAnimating = false; }
              };
              requestAnimationFrame(tick);
            };

            const onMove = throttle((ev: MouseEvent) => {
              const rect = canvas.getBoundingClientRect();
              const x = ev.clientX - rect.left;
              const y = ev.clientY - rect.top;
              if (isPanning && panStart) {
                const dx = x - panStart.x;
                const dy = y - panStart.y;
                viewRef.current.tx = viewStart.tx + dx;
                viewRef.current.ty = viewStart.ty + dy;
                draw();
                return;
              }
              if (isAnimating) return; // avoid hover picking during camera animation
            }, 24);

            const onClick = (ev: MouseEvent) => {
              const rect = canvas.getBoundingClientRect();
              const x = ev.clientX - rect.left;
              const y = ev.clientY - rect.top;
              const world = screenToWorld({x, y});
              let best: {id: string; d2: number} | null = null;
              for (const n of nodes) {
                const dx = n.x - world.x;
                const dy = n.y - world.y;
                const d2 = dx * dx + dy * dy;
                if (!best || d2 < best.d2) best = {id: n.id, d2};
              }
              const picked = best && best.d2 < 49 / (viewRef.current.scale * viewRef.current.scale) ? best.id : null;
                if (picked) {
                hovered = picked;
                  const center = nodes[idToIndexRef.current[picked]];
                if (center) {
                  const rect2 = canvas.getBoundingClientRect();
                  const targetScale = Math.min(3.0, Math.max(0.4, viewRef.current.scale * 1.4));
                  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                  for (const nd of nodes) { if (nd.x < minX) minX = nd.x; if (nd.y < minY) minY = nd.y; if (nd.x > maxX) maxX = nd.x; if (nd.y > maxY) maxY = nd.y; }
                  const mx = (rect2.width / targetScale) / 2;
                  const my = (rect2.height / targetScale) / 2;
                  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
                  const halfW = (maxX - minX) / 2;
                  const halfH = (maxY - minY) / 2;
                  const cx = (halfW <= 0 || halfH <= 0 || mx >= halfW || my >= halfH) ? center.x : clamp(center.x, minX + mx, maxX - mx);
                  const cy = (halfW <= 0 || halfH <= 0 || mx >= halfH || my >= halfH) ? center.y : clamp(center.y, minY + my, maxY - my);
                  animateTo({x: cx, y: cy}, targetScale);
                  hasInteracted = true;
                }
                draw();
              } else {
                // click empty space to defocus
              hovered = null;
              draw();
              }
            };

            const onWheel = (ev: WheelEvent) => {
              ev.preventDefault();
              const rect = canvas.getBoundingClientRect();
              const x = ev.clientX - rect.left;
              const y = ev.clientY - rect.top;
              const worldBefore = screenToWorld({x, y});
              // Cancel any running hover animation on wheel
              animToken += 1; isAnimating = false;
              const factor = Math.exp(-ev.deltaY * 0.001);
              const newScale = Math.min(4, Math.max(0.1, viewRef.current.scale * factor));
              viewRef.current.scale = newScale;
              const worldAfter = worldBefore;
              const screenAfter = {x: worldAfter.x * newScale + viewRef.current.tx, y: worldAfter.y * newScale + viewRef.current.ty};
              viewRef.current.tx += x - screenAfter.x;
              viewRef.current.ty += y - screenAfter.y;
              hasInteracted = true;
              draw();
            };

            const onDown = (ev: MouseEvent) => {
              const rect = canvas.getBoundingClientRect();
              panStart = {x: ev.clientX - rect.left, y: ev.clientY - rect.top};
              // Cancel any running hover animation on pan start
              animToken += 1; isAnimating = false;
              viewStart = {...viewRef.current};
              isPanning = true;
              hasInteracted = true;
            };
            const onUp = () => { isPanning = false; };

            canvas.addEventListener("mousemove", onMove);
            canvas.addEventListener("click", onClick);
            canvas.addEventListener("wheel", onWheel, {passive: false});
            canvas.addEventListener("mousedown", onDown);
            window.addEventListener("mouseup", onUp);
            const ro = new ResizeObserver(() => {
              resizeCanvas();
              // Only auto-fit if the user hasn't interacted yet
              if (!hasInteracted) computeFit();
              draw();
            });
            ro.observe(canvas.parentElement!);

            draw();

            (canvas as any)._cleanup = () => {
              canvas.removeEventListener("mousemove", onMove);
              canvas.removeEventListener("click", onClick);
              canvas.removeEventListener("wheel", onWheel as any);
              canvas.removeEventListener("mousedown", onDown);
              window.removeEventListener("mouseup", onUp);
              ro.disconnect();
            };
          } catch (e) {
            console.warn("Canvas fallback failed", e);
          }
        }
      }
    }
    init();
    return () => {
      disposed = true;
      const s: any = sigmaRef.current;
      if (s?._ro) try { s._ro.disconnect(); } catch {}
      sigmaRef.current?.kill();
      sigmaRef.current = null;
      graphRef.current = null;
      // Clean up cluster label overlay
      try {
        if (clusterLabelsRef.current && clusterLabelsRef.current.parentElement) {
          clusterLabelsRef.current.parentElement.removeChild(clusterLabelsRef.current);
        }
        clusterLabelsRef.current = null;
        clusterLabelElsRef.current = {} as any;
      } catch {}
    };
  }, [viewMode]);

  // Apply degree filter
  React.useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    g.forEachNode((n) => {
      const deg = g.getNodeAttribute(n, "degree") || 0;
      g.setNodeAttribute(n, "hidden", deg < degreeThreshold);
    });
    sigmaRef.current?.refresh();
  }, [degreeThreshold]);

  // Search suggestions
  React.useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) { setSearchMatches([]); return; }
    const idx = nameIndexRef.current;
    const starts: Array<{id: string; name: string}> = [];
    const contains: Array<{id: string; name: string}> = [];
    for (const e of idx) {
      const pos = e.nameLower.indexOf(q);
      if (pos === 0) starts.push({id: e.id, name: e.name});
      else if (pos > 0) contains.push({id: e.id, name: e.name});
      if (starts.length >= 8) break;
    }
    const combined = starts.length >= 8 ? starts : [...starts, ...contains].slice(0, 8);
    setSearchMatches(combined);
  }, [searchQuery]);

  function focusById(nodeId: string) {
    if (setHoveredRef.current) setHoveredRef.current(nodeId);
  }

  return (
    <div className="w-full h-full flex flex-col relative">
      <div className="absolute top-2 left-2 z-10 bg-gray-800/90 text-white backdrop-blur rounded-md border border-gray-700 px-4 py-3 shadow text-sm max-w-xs">
        {focusedInfo ? (
          <div>
            <div><span className="font-medium">Protein:</span> {focusedInfo.name}</div>
            <div><span className="font-medium">Interactions:</span> {focusedInfo.degree}</div>
            <div><span className="font-medium">New interactions:</span> {focusedInfo.blue}</div>
          </div>
        ) : (
          <div>
            <div><span className="font-medium">Proteins:</span> {totals.nodes}</div>
            <div><span className="font-medium">Interactions:</span> {totals.edges}</div>
            <div><span className="font-medium">New interactions:</span> {totals.blueEdges}</div>
          </div>
        )}
      </div>
      {/* Sidebar controls box under info box (collapsible) */}
      <div className="absolute top-28 left-2 z-10">
        {sidebarOpen ? (
          <div className="relative w-80 bg-gray-800/90 text-white backdrop-blur rounded-md border border-gray-700 px-4 py-3 shadow text-sm flex flex-col gap-3">
            <button
              aria-label="Collapse sidebar"
              onClick={() => setSidebarOpen(false)}
              className="absolute -right-3 top-3 h-6 w-6 rounded-full border border-gray-700 bg-gray-800/90 text-white flex items-center justify-center shadow"
            >
              ‹
            </button>
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Show only new</span>
              <input type="checkbox" checked={showOnlyNew} onChange={(e) => setShowOnlyNew(e.target.checked)} />
            </label>
            {/* locality toggle moved to top bar */}
            <label className="flex items-center justify-between gap-2 text-sm opacity-100">
              <span>Show all edges</span>
          <input
                type="checkbox"
                checked={showAllEdges}
                onChange={(e) => setShowAllEdges(e.target.checked)}
                disabled={!!focusedNodeRef.current}
              />
            </label>
            <div className="flex items-center justify-between">
              <span className="whitespace-nowrap">Confidence level</span>
              <span className="tabular-nums">{confidence.toFixed(2)}</span>
            </div>
            <input
              className="w-full"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={confidence}
              onChange={(e) => {
                const v = Number(e.target.value);
                setConfidence(v);
                confidenceRef.current = v;
                recomputeTotalsImmediate();
                if (focusedNodeRef.current) recomputeFocusedInfoImmediate(focusedNodeRef.current);
              }}
            />
            <div className="flex items-center justify-between">
              <span className="whitespace-nowrap">Degree ≥</span>
              <span className="tabular-nums">{degreeThreshold}</span>
            </div>
            <input
              className="w-full"
            type="range"
            min={0}
            max={50}
            step={1}
            value={degreeThreshold}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDegreeThreshold(v);
                recomputeTotalsImmediate();
                if (focusedNodeRef.current) recomputeFocusedInfoImmediate(focusedNodeRef.current);
              }}
            />
            {geneInfo && (
              <div className="mt-1 rounded-md border border-gray-700 bg-gray-900/70 p-2">
                <div className="text-xs text-gray-300">
                  <span className="font-semibold">{geneInfo.symbol || geneInfo.name}</span>
                  {geneInfo.name && geneInfo.symbol && <span className="ml-1">— {geneInfo.name}</span>}
                </div>
                {geneInfo.summary && (
                  <div className="mt-1 text-xs text-gray-200 leading-snug line-clamp-4">{geneInfo.summary}</div>
                )}
              </div>
            )}
          </div>
        ) : (
          <button
            aria-label="Expand sidebar"
            onClick={() => setSidebarOpen(true)}
            className="bg-gray-800/90 text-white border border-gray-700 rounded-md px-2 py-2 shadow"
          >
            ›
          </button>
        )}
      </div>
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 bg-gray-800/90 text-white backdrop-blur rounded-md border border-gray-700 px-3 py-2 flex items-center gap-4 shadow">
        <div className="relative">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchMatches[0]) {
                focusById(searchMatches[0].id);
              }
            }}
            placeholder="Search node…"
            className="border rounded px-2 py-1 text-sm w-56 bg-white text-gray-900 placeholder-gray-400"
          />
          {searchQuery && searchMatches.length > 0 && (
            <div className="absolute mt-1 w-56 max-h-56 overflow-auto bg-white border border-gray-300 rounded shadow z-10">
              {searchMatches.map((m) => (
                <button
                  key={m.id}
                  className="block w-full text-left px-2 py-1 hover:bg-gray-200 text-sm text-gray-900"
                  onClick={() => focusById(m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div ref={containerRef} className="absolute inset-0" />
      <canvas ref={fallbackCanvasRef} className="absolute inset-0" style={{display: "none"}} />
    </div>
  );
}

// ----- Canvas2D Fallback (no WebGL) -----
function fitToCanvas(nodes: Array<{x: number; y: number}>, width: number, height: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x > maxX) maxX = n.x;
    if (n.y > maxY) maxY = n.y;
  }
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const padding = 20;
  const sx = (width - 2 * padding) / dx;
  const sy = (height - 2 * padding) / dy;
  const scale = Math.min(sx, sy);
  const tx = padding - minX * scale + (width - (dx * scale + 2 * padding)) / 2;
  const ty = padding - minY * scale + (height - (dy * scale + 2 * padding)) / 2;
  return {scale, tx, ty};
}

function initCanvasFallback(data: GraphData): boolean {
  const canvas = (document.querySelector("canvas.sigma-edges") as HTMLCanvasElement | null) ? null : null; // just to silence unused warnings
  // this function body will be replaced via closure in component
  return true;
}


