"use client";

import React from "react";
import cytoscape from "cytoscape";

type GraphJson = {
  nodes: Array<{id: string; label?: string}>;
  edges: Array<{id: string; source: string; target: string}>;
};

export default function PathwayNeighborGraph({ proteinSymbols, className, selectedSymbols, onSelectSymbols }: { proteinSymbols: string[]; className?: string; selectedSymbols?: string[]; onSelectSymbols?: (symbols: string[]) => void }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const cyRef = React.useRef<cytoscape.Core | null>(null);
  const labelToIdRef = React.useRef<Map<string, string>>(new Map());

  React.useEffect(() => {
    let disposed = false;
    async function run() {
      try {
        const res = await fetch("/graph.json", { cache: "no-store" });
        const data: GraphJson = await res.json();
        if (disposed) return;

        // Map symbols -> node ids by matching label (case-insensitive). Fallback to id match.
        const labelToId = new Map<string, string>();
        for (const n of data.nodes) {
          if (n.label) labelToId.set((n.label + '').toLowerCase(), n.id);
        }
        labelToIdRef.current = labelToId;
        const proteinNodeIds: string[] = [];
        for (const s of proteinSymbols) {
          const id = labelToId.get((s || '').toLowerCase()) || data.nodes.find(n => n.id.toLowerCase?.() === (s || '').toLowerCase())?.id;
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
        const edges = data.edges
          .filter(e => proteinSet.has(e.source) || proteinSet.has(e.target))
          .map(e => ({ data: { id: e.id || `${e.source}-${e.target}`, source: e.source, target: e.target, isProteinEdge: (proteinSet.has(e.source) || proteinSet.has(e.target)) ? 1 : 0 } }));

        if (cyRef.current) { try { cyRef.current.destroy(); } catch {} cyRef.current = null; }
        const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const textColor = prefersDark ? '#e5e7eb' : '#111827';
        const bg = prefersDark ? '#0b1220' : '#ffffff';
        const edgeColor = prefersDark ? '#6b7280' : '#9ca3af';
        const protColor = '#60a5fa';

        const cy = cytoscape({
          container: containerRef.current as any,
          elements: [...nodes, ...edges],
          layout: { name: "cose", animate: false, nodeRepulsion: 50000 },
          wheelSensitivity: 0.2,
          style: [
            { selector: 'node', style: { 'background-color': '#9ca3af', label: 'data(label)', 'font-size': 10, color: textColor } },
            { selector: 'node[isProtein = 1]', style: { 'background-color': protColor, 'border-width': 2, 'border-color': '#2563eb', 'font-weight': '600' } },
            { selector: 'node.xhl', style: { 'border-width': 4, 'border-color': '#f59e0b', 'background-color': '#fde68a' } },
            { selector: 'edge', style: { width: 1.5, 'line-color': edgeColor, 'curve-style': 'straight' } },
          ] as any,
        });
        cyRef.current = cy;
        if (containerRef.current) {
          containerRef.current.style.backgroundColor = bg;
        }
        cy.on('tap', 'node', (evt) => {
          try {
            const nm = (evt.target.data('label') as string) || '';
            if (!nm) return;
            onSelectSymbols && onSelectSymbols([nm]);
          } catch {}
        });
      } catch (e) {}
    }
    run();
    return () => { disposed = true; try { cyRef.current?.destroy(); } catch {} };
  }, [proteinSymbols.join(',')]);

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
    } catch {}
  }, [selectedSymbols?.join(',')]);

  return <div ref={containerRef} className={className} />;
}


