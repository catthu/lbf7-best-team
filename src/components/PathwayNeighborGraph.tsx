"use client";

import React from "react";
import cytoscape from "cytoscape";

type GraphJson = {
  nodes: Array<{id: string; label?: string}>;
  edges: Array<{id: string; source: string; target: string; allDBs?: string}>;
};

export default function PathwayNeighborGraph({ proteinSymbols, className, selectedSymbols, onSelectSymbols, selectedEdge, onSelectEdge, version, pathwayId }: { proteinSymbols: string[]; className?: string; selectedSymbols?: string[]; onSelectSymbols?: (symbols: string[]) => void; selectedEdge?: {left: string[]; right: string[]}; onSelectEdge?: (pair: {left: string[]; right: string[]}) => void; version?: number; pathwayId?: string }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const cyRef = React.useRef<cytoscape.Core | null>(null);
  const labelToIdRef = React.useRef<Map<string, string>>(new Map());
  const buildIdRef = React.useRef<number>(0);
  const fetchAbortRef = React.useRef<AbortController | null>(null);
  const builtKeyRef = React.useRef<string>("");
  const isBuildingRef = React.useRef<boolean>(false);
  const instanceIdRef = React.useRef<string>(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const disabledRef = React.useRef<boolean>(false);
  const lastZoomKeyRef = React.useRef<string>("");
  const lastZoomEdgeKeyRef = React.useRef<string>("");
  const [toast, setToast] = React.useState<string>("");
  const log = (...args: any[]) => {
    try { console.log('[NeighborGraph]', ...args); } catch {}
  };

  // Ensure HMR disposes any live instance and DOM root
  try {
    const hot = (globalThis as any).module?.hot;
    if (hot && !(globalThis as any).__neighborHmrRegistered) {
      hot.dispose(() => {
        try { (window as any).__neighborCy?.destroy?.(); } catch {}
        try { const r = (window as any).__neighborRoot as HTMLElement | undefined; if (r && r.parentElement) r.parentElement.removeChild(r); } catch {}
        try { (window as any).__neighborCy = null; (window as any).__neighborRoot = null; } catch {}
      });
      (globalThis as any).__neighborHmrRegistered = true;
    }
  } catch {}

  // Acquire singleton ownership before any build effects run
  React.useLayoutEffect(() => {
    try {
      const g: any = window as any;
      if (!g.__neighborOwnerInstance) {
        g.__neighborOwnerInstance = instanceIdRef.current;
        disabledRef.current = false;
        log('singleton acquired');
      } else if (g.__neighborOwnerInstance !== instanceIdRef.current) {
        disabledRef.current = true;
        log('second-instance-skip (render disabled)');
      }
      return () => {
        try {
          if ((window as any).__neighborOwnerInstance === instanceIdRef.current) {
            (window as any).__neighborOwnerInstance = undefined;
          }
        } catch {}
      };
    } catch { disabledRef.current = false; }
  }, []);

  React.useEffect(() => {
    let disposed = false;
    const myBuildId = ++buildIdRef.current;
    const key = `${pathwayId || ''}:${version}`;
    log('effect start', {build: myBuildId, proteins: proteinSymbols?.length});

    if (disabledRef.current) {
      log('build-skip (component disabled)');
      return () => {};
    }

    // Cooldown: avoid duplicate rebuilds for the same dataset key within a short window (e.g., HMR)
    try {
      const g: any = window as any;
      g.__neighborCooldown = g.__neighborCooldown || new Map<string, number>();
      const last = g.__neighborCooldown.get(key) || 0;
      const now = Date.now();
      if (now - last < 800) {
        log('cooldown-skip', { key });
        return () => {};
      }
      g.__neighborCooldown.set(key, now);
    } catch {}

    // If a matching global active instance is already present, skip entirely
    try {
      const g: any = window as any;
      if (g.__neighborActiveKey === key && g.__neighborCy && !g.__neighborCy.destroyed?.()) {
        log('global-active-skip', { key });
        return () => {};
      }
    } catch {}

    // Global lock across HMR/duplicate instances
    let globalObj: any = undefined;
    try { globalObj = window as any; } catch {}
    const lockObj = globalObj ? (globalObj.__neighborBuildLock || (globalObj.__neighborBuildLock = { busy: false, key: '', inst: '' })) : { busy: false, key: '', inst: '' };
    if (lockObj.busy) {
      log('global-lock skip (busy)', {currentKey: lockObj.key});
      return () => {};
    }
    lockObj.busy = true;
    lockObj.key = key;
    lockObj.inst = instanceIdRef.current;

    // If we already built this exact dataset and instance still exists, skip
    if (builtKeyRef.current === key && (cyRef.current && !(cyRef.current as any).destroyed?.())) {
      log('skip rebuild (same key and live instance)', {build: myBuildId, key});
      if (globalObj) { try { globalObj.__neighborBuildLock.busy = false; } catch {} }
      return () => {};
    }

    isBuildingRef.current = true;

    async function run() {
      // Immediately nuke any existing instance to avoid visible stacking during async work
      try { (globalObj as any)?.__neighborCy?.destroy?.(); } catch {}
      try { cyRef.current?.destroy(); log('destroy old cytoscape', {build: myBuildId}); } catch {}
      cyRef.current = null;
      try {
        // remove any stale global roots left in DOM
        if (typeof document !== 'undefined') {
          document.querySelectorAll('[data-neighbor-root="1"]').forEach((el) => {
            try { el.parentElement?.removeChild(el); } catch {}
          });
        }
      } catch {}
      try { if (containerRef.current) { (containerRef.current as HTMLDivElement).innerHTML = ""; log('cleared container', {build: myBuildId}); } } catch {}
      // If no proteins, clear any previous render and exit
      if (!proteinSymbols || proteinSymbols.length === 0) {
        // already cleared above
        log('no proteins, abort build', {build: myBuildId});
        builtKeyRef.current = "";
        isBuildingRef.current = false;
        if (globalObj) { try { globalObj.__neighborBuildLock.busy = false; } catch {} }
        return;
      }
      // If a newer build started, abort this one
      if (myBuildId !== buildIdRef.current) { log('stale build guard before fetch', {build: myBuildId}); isBuildingRef.current = false; if (globalObj) { try { globalObj.__neighborBuildLock.busy = false; } catch {} } return; }
      try {
        // Cancel any previous in-flight fetch
        try { fetchAbortRef.current?.abort(); log('aborted previous fetch'); } catch {}
        const ac = new AbortController();
        fetchAbortRef.current = ac;
        log('fetch start', {build: myBuildId});
        const res = await fetch("/graph.json", { cache: "no-store", signal: ac.signal });
        const data: GraphJson = await res.json();
        if (disposed || myBuildId !== buildIdRef.current) { log('stale after fetch', {build: myBuildId}); isBuildingRef.current = false; if (globalObj) { try { globalObj.__neighborBuildLock.busy = false; } catch {} } return; }
        log('fetch done', {build: myBuildId, nodes: data.nodes?.length, edges: data.edges?.length});

        // Map symbols -> node ids by matching label (case-insensitive). Fallback to id match.
        const labelToId = new Map<string, string>();
        for (const n of data.nodes) {
          if (n.label) labelToId.set((n.label + '').toLowerCase(), n.id);
        }
        labelToIdRef.current = labelToId;
        const proteinNodeIds: string[] = [];
        for (const s of proteinSymbols) {
          const id = labelToId.get((s || '').toLowerCase()) || data.nodes.find(n => (n.id as any).toLowerCase?.() === (s || '').toLowerCase())?.id;
          if (id) proteinNodeIds.push(id);
        }
        const proteinSet = new Set(proteinNodeIds);
        const neighborSet = new Set<string>();
        const nodeSet = new Set<string>();

        // include proteins
        for (const id of proteinNodeIds) nodeSet.add(id);
        // include neighbors from edges touching proteins
        for (const e of data.edges) {
          if (proteinSet.has(e.source)) { neighborSet.add(e.target); nodeSet.add(e.target); }
          if (proteinSet.has(e.target)) { neighborSet.add(e.source); nodeSet.add(e.source); }
        }
        // Build elements: nodes for nodeSet; edges only when at least one end is in proteinSet
            const nodes = data.nodes
              .filter(n => nodeSet.has(n.id))
              .map(n => ({ data: { id: n.id, label: n.label || n.id, isProtein: proteinSet.has(n.id) ? 1 : 0 } }));
            const edgesRaw = data.edges.filter(e => proteinSet.has(e.source) || proteinSet.has(e.target));
            const edges = edgesRaw.map(e => {
              const neighborEdge = (proteinSet.has(e.source) && !proteinSet.has(e.target)) || (!proteinSet.has(e.source) && proteinSet.has(e.target)) ? 1 : 0;
              return { data: { id: e.id || `${e.source}-${e.target}`, source: e.source, target: e.target, allDBs: e.allDBs || '', isNeighborEdge: neighborEdge } };
            });
        const newNodeSet = new Set<string>();
        for (const e of edgesRaw) {
          const adb = (e.allDBs || '').toString().trim().toLowerCase();
          if (adb === 'none') { newNodeSet.add(e.source); newNodeSet.add(e.target); }
        }

        // Tear down any previous instance and clear container to avoid stacked canvases
        if (cyRef.current) { try { (cyRef.current as any).destroy?.(); log('destroy old before mount', {build: myBuildId}); } catch {} cyRef.current = null; }
        try { if (containerRef.current) { (containerRef.current as HTMLDivElement).innerHTML = ""; log('cleared container before mount', {build: myBuildId}); } } catch {}
        const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            const textColor = prefersDark ? '#e5e7eb' : '#111827';
            const edgeColor = prefersDark ? '#6b7280' : '#9ca3af';

        // Create a fresh mount element every time to guarantee no stacking
        const wrapper = containerRef.current as HTMLDivElement;
        while (wrapper.firstChild) wrapper.removeChild(wrapper.firstChild);
        const mountEl = document.createElement('div');
        mountEl.style.width = '100%';
        mountEl.style.height = '100%';
        try { (mountEl as any).dataset.neighborRoot = '1'; } catch {}
        // Remove any previously registered global root (from racing effects / fast refresh)
        try {
          const prevRoot = (window as any).__neighborRoot as HTMLElement | undefined;
          if (prevRoot && prevRoot.parentElement && prevRoot !== mountEl) {
            prevRoot.parentElement.removeChild(prevRoot);
          }
        } catch {}
        // Replace any children with our mount element to guarantee single root
        try { (wrapper as any).replaceChildren(mountEl); } catch { wrapper.appendChild(mountEl); }
        try { (window as any).__neighborRoot = mountEl; } catch {}

        // Global guard: if any previous instance exists (e.g., from fast-refresh), kill it
        try { (window as any).__neighborCy?.destroy?.(); (window as any).__neighborCy = null; } catch {}

        const cy = cytoscape({
          container: mountEl as any,
          elements: [],
          layout: { name: "preset" },
          style: [
                { selector: 'node', style: { 
                  'background-color': '#9ca3af',
              label: 'data(label)',
              'font-size': 10,
              color: textColor,
              width: 18,
              height: 18,
              'transition-property': 'width, height, border-width, border-color',
              'transition-duration': '200ms',
              'transition-timing-function': 'ease-in-out'
            } },
                { selector: 'node[isProtein = 0]', style: { 'opacity': 0.25, 'text-opacity': 0.4 } },
                { selector: 'node.new', style: { 'background-color': '#3b82f6' } },
            { selector: 'node.xhl', style: { 
              'border-width': 5,
              'border-color': '#f59e0b',
              'border-opacity': 1,
              width: 30,
              height: 30
            } },
                { selector: 'edge', style: { width: 1.5, 'line-color': edgeColor, 'curve-style': 'straight', 'transition-property': 'width, line-color', 'transition-duration': '160ms' } },
            { selector: 'edge.xhl', style: { width: 4, 'line-color': '#f59e0b' } },
                { selector: 'edge[allDBs = "none"]', style: { 'line-color': '#3b82f6', width: 2 } },
                { selector: 'edge[isNeighborEdge = 1]', style: { 'opacity': 0.25 } },
          ] as any,
        });
        if (disposed || myBuildId !== buildIdRef.current) { try { cy.destroy(); } catch {}; log('stale after create, destroyed', {build: myBuildId}); isBuildingRef.current = false; if (globalObj) { try { globalObj.__neighborBuildLock.busy = false; } catch {} } return; }
        cyRef.current = cy;
        try { (window as any).__neighborCy = cy; } catch {}
        log('cytoscape created', {build: myBuildId, nodes: cy.nodes().length, edges: cy.edges().length});
        try { cy.elements().remove(); } catch {}
        cy.add([...nodes, ...edges]);
        log('graph populated', {build: myBuildId, nodes: nodes.length, edges: edges.length});
        try {
          cy.layout({ name: 'cose', animate: false, nodeRepulsion: 50000 }).run();
        } catch {}
        builtKeyRef.current = key;
        try { (window as any).__neighborActiveKey = key; (window as any).__neighborOwner = instanceIdRef.current; } catch {}
        isBuildingRef.current = false;
        if (globalObj) { try { globalObj.__neighborBuildLock.busy = false; } catch {} }

        // mark nodes involved in new edges
        try {
          newNodeSet.forEach((nid) => {
            const n = cy.getElementById(nid);
            if (n && n.nonempty()) n.addClass('new');
          });
        } catch {}
        cy.on('tap', 'node', (evt) => {
          try {
            const nm = (evt.target.data('label') as string) || '';
            if (!nm) return;
            onSelectSymbols && onSelectSymbols([nm]);
          } catch {}
        });
        cy.on('tap', 'edge', (evt) => {
          try {
            const e = evt.target;
            const s = cy.getElementById(e.data('source'));
            const t = cy.getElementById(e.data('target'));
            const namesS: string[] = [
              ...(((s?.data('label') as string) ? [s.data('label')] : [])),
            ];
            const namesT: string[] = [
              ...(((t?.data('label') as string) ? [t.data('label')] : [])),
            ];
            if (onSelectEdge) onSelectEdge({left: namesS, right: namesT});
          } catch {}
        });
      } catch (e) {
        isBuildingRef.current = false;
        if (globalObj) { try { globalObj.__neighborBuildLock.busy = false; } catch {} }
      }
    }
    run();
    return () => { 
      disposed = true; 
      try { if ((window as any).__neighborCy === cyRef.current) { (window as any).__neighborCy = null; } } catch {}
      try { cyRef.current?.destroy(); } catch {}
      builtKeyRef.current = "";
      try { if ((window as any).__neighborOwner === instanceIdRef.current) { (window as any).__neighborActiveKey = undefined; (window as any).__neighborOwner = undefined; } } catch {}
      isBuildingRef.current = false;
      try { if ((window as any).__neighborBuildLock?.inst === instanceIdRef.current) { (window as any).__neighborBuildLock.busy = false; } } catch {}
    };
  }, [pathwayId, version]);

  // Apply cross-highlight from parent selection
  React.useEffect(() => {
    const cy = cyRef.current as any;
    if (!cy) return;
    try {
      cy.nodes().removeClass('xhl');
      const set = new Set((selectedSymbols || []).map((s) => (s || '').toLowerCase()));
      cy.nodes().forEach((n: any) => {
        const lab = ((n.data('label') as string) || '').toLowerCase();
        if (set.has(lab)) n.addClass('xhl');
      });
      // Toast if nothing matched from pathway selection
      if (set.size) {
        const anyMatch = cy.nodes('.xhl').length > 0;
        setToast(anyMatch ? '' : 'Not found in right graph');
      } else {
        setToast('');
      }
      // Zoom to selection if available
      if (set.size) {
        const zoomKey = Array.from(set).sort().join('|');
        if (zoomKey !== lastZoomKeyRef.current) {
          lastZoomKeyRef.current = zoomKey;
          const targets = cy.nodes().filter((n: any) => set.has(((n.data('label') as string) || '').toLowerCase()));
          if (targets && targets.nonempty && targets.nonempty()) {
            try {
              const bb = targets.boundingBox();
              const vw = Math.max(1, cy.width());
              const vh = Math.max(1, cy.height());
              const selCount = (typeof targets.length === 'number' ? targets.length : (targets.size?.() || 1)) as number;
              // Single selection: larger padding and gentler scale. Multi: smaller padding and closer scale.
              const dynamicPad = selCount <= 1
                ? Math.min(300, Math.max(150, Math.min(vw, vh) * 0.14))
                : Math.min(220, Math.max(80, Math.min(vw, vh) * 0.08));
              const wr = (vw - 2 * dynamicPad) / Math.max(1, bb.w);
              const hr = (vh - 2 * dynamicPad) / Math.max(1, bb.h);
              const fitZoom = Math.max(0.0001, Math.min(wr, hr));
              const scale = selCount <= 1 ? 0.10 : 0.18;
              const targetZoom = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), fitZoom * scale));
              cy.animate({ center: { eles: targets }, zoom: targetZoom }, { duration: 280, easing: 'ease-in-out' });
            } catch {}
          }
        }
      }
    } catch {}
  }, [selectedSymbols?.join(',')]);

  // Edge cross-highlight from parent
  React.useEffect(() => {
    const cy = cyRef.current as any;
    if (!cy) return;
    try {
      cy.edges().removeClass('xhl');
      const L = new Set((selectedEdge?.left || []).map((s) => (s || '').toLowerCase()));
      const R = new Set((selectedEdge?.right || []).map((s) => (s || '').toLowerCase()));
      if (!L.size || !R.size) return;
      const matchedEdges: any[] = [];
      const endpointNodeIds = new Set<string>();
      cy.edges().forEach((e: any) => {
        const s = cy.getElementById(e.data('source'));
        const t = cy.getElementById(e.data('target'));
        const a = ((s.data('label') as string) || '').toLowerCase();
        const b = ((t.data('label') as string) || '').toLowerCase();
        const match = (L.has(a) && R.has(b)) || (L.has(b) && R.has(a));
        if (match) {
          e.addClass('xhl');
          matchedEdges.push(e);
          try { endpointNodeIds.add(s.id()); endpointNodeIds.add(t.id()); } catch {}
        }
      });
      setToast(matchedEdges.length ? '' : 'Edge not found in right graph');
      // Zoom to matched edge(s) and endpoints, scaled down for comfortable view
      if (matchedEdges.length) {
        try {
          const endpointNodes = cy.collection(
            Array.from(endpointNodeIds)
              .map((id) => cy.getElementById(id))
              .filter((el) => el && el.nonempty && el.nonempty())
          );
          const targets = endpointNodes.union(cy.collection(matchedEdges));
          const bb = targets.boundingBox();
          const vw = Math.max(1, cy.width());
          const vh = Math.max(1, cy.height());
          const dynamicPad = Math.min(260, Math.max(120, Math.min(vw, vh) * 0.10));
          const wr = (vw - 2 * dynamicPad) / Math.max(1, bb.w);
          const hr = (vh - 2 * dynamicPad) / Math.max(1, bb.h);
          const fitZoom = Math.max(0.0001, Math.min(wr, hr));
          const scale = 0.14;
          const targetZoom = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), fitZoom * scale));
          cy.animate({ center: { eles: targets }, zoom: targetZoom }, { duration: 300, easing: 'ease-in-out' });
        } catch {}
      }
    } catch {}
  }, [selectedEdge ? `${(selectedEdge.left||[]).join(',')}|${(selectedEdge.right||[]).join(',')}` : '']);

  return (
    <div className={className} style={{ position: 'relative' }}>
      <div ref={containerRef} className="absolute inset-0" />
      {toast ? (
        <div className="absolute right-3 top-3 z-10 bg-white/95 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-xs text-gray-800 dark:text-gray-100 shadow">
          {toast}
        </div>
      ) : null}
    </div>
  );
}


