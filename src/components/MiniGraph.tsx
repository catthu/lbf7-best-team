"use client";

import React from "react";

type Node = { id: string; x: number; y: number; label?: string };
type Edge = { id: string; source: string; target: string; isNew?: boolean };

const NODES: Node[] = [
  { id: "c", x: 210, y: 120, label: "Center" },
  { id: "a", x: 120, y: 42, label: "Protein A" },
  { id: "b", x: 350, y: 92, label: "Protein B" },
  { id: "d", x: 85, y: 194, label: "Protein D" },
  { id: "e", x: 308, y: 212, label: "Protein E" },
];

const EDGES: Edge[] = [
  { id: "c-a", source: "c", target: "a", isNew: false },
  { id: "c-b", source: "c", target: "b", isNew: true },
  { id: "c-d", source: "c", target: "d", isNew: true },
  { id: "c-e", source: "c", target: "e", isNew: false },
  // neighbor-to-neighbor interconnections (mix of new and existing)
  { id: "a-b", source: "a", target: "b", isNew: false },
  { id: "b-d", source: "b", target: "d", isNew: true },
];

function getNeighbors(nodeId: string): Set<string> {
  const s = new Set<string>();
  for (const e of EDGES) {
    if (e.source === nodeId) s.add(e.target);
    else if (e.target === nodeId) s.add(e.source);
  }
  return s;
}

export default function MiniGraph({ width = 420, height = 240 }: { width?: number; height?: number }) {
  const [selected, setSelected] = React.useState<string | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);

  const neighborSet = React.useMemo(() => (selected ? getNeighbors(selected) : new Set<string>()), [selected]);
  const hoverNeighborSet = React.useMemo(() => (hovered ? getNeighbors(hovered) : new Set<string>()), [hovered]);

  // Map degrees for node sizing
  const degreeMap = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of NODES) m[n.id] = 0;
    for (const e of EDGES) {
      m[e.source] = (m[e.source] || 0) + 1;
      m[e.target] = (m[e.target] || 0) + 1;
    }
    return m;
  }, []);

  // Nodes are blue if they participate in any 'new' edge
  const nodeHasNew: Record<string, boolean> = React.useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const n of NODES) m[n.id] = false;
    for (const e of EDGES) {
      if (e.isNew) { m[e.source] = true; m[e.target] = true; }
    }
    return m;
  }, []);

  function nodeColor(id: string): string {
    return nodeHasNew[id] ? "#3b82f6" : "#bbb";
  }

  function nodeRadius(id: string): number {
    const deg = degreeMap[id] || 0;
    const minR = 12, maxR = 22;
    const maxDeg = Math.max(...Object.values(degreeMap));
    if (maxDeg === 0) return minR;
    const t = deg / maxDeg;
    return Math.round(minR + (maxR - minR) * t);
  }

  function shouldRenderEdge(e: Edge): boolean {
    if (selected) {
      const involvesSelected = e.source === selected || e.target === selected;
      const bothNeighbors = neighborSet.has(e.source) && neighborSet.has(e.target);
      return involvesSelected || bothNeighbors;
    }
    if (hovered) {
      const involvesHovered = e.source === hovered || e.target === hovered;
      const bothNeighborsHover = hoverNeighborSet.has(e.source) && hoverNeighborSet.has(e.target);
      return involvesHovered || bothNeighborsHover; // hover: incident plus interconnections
    }
    return false; // default: no edges
  }

  function handleClick(id?: string) {
    setSelected((prev) => (prev === id ? null : id || null));
  }

  return (
    <div className="not-prose mx-auto w-full max-w-[520px]">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block mx-auto">
        {/* background to allow deselection */}
        <rect x={0} y={0} width={width} height={height} fill="transparent" onClick={() => handleClick(undefined)} />

        {/* Edges (on hover: only incident; on click: incident + interconnections) */}
        {EDGES.filter(shouldRenderEdge).map((e) => {
          const s = NODES.find((n) => n.id === e.source)!;
          const t = NODES.find((n) => n.id === e.target)!;
          return (
            <line
              key={e.id}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={e.isNew ? "#3b82f6" : "rgba(150,150,150,0.9)"}
              strokeWidth={2}
            />
          );
        })}

        {/* Nodes */}
        {NODES.map((n) => (
          <g
            key={n.id}
            style={{ cursor: "pointer" }}
            onClick={() => handleClick(n.id)}
            onMouseEnter={() => setHovered(n.id)}
            onMouseLeave={() => setHovered((prev) => (prev === n.id ? null : prev))}
          >
            <circle cx={n.x} cy={n.y} r={nodeRadius(n.id)} fill={nodeColor(n.id)} />
          </g>
        ))}

        {/* Selected node label */}
        {selected ? (() => {
          const n = NODES.find(nn => nn.id === selected)!;
          const label = n.label || n.id;
          const tx = Math.min(width - 8, Math.max(8, n.x + 18));
          const ty = Math.max(16, n.y - 18);
          return (
            <text x={tx} y={ty} fontSize={12} fontWeight={600} fill="#e5e7eb" textAnchor="start">
              {label}
            </text>
          );
        })() : null}
      </svg>

      <div className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
Click around!      </div>
    </div>
  );
}


