"use client";

import React, { useMemo, useRef, useState } from "react";
import KeggPathwayViewer from "@/components/KeggPathwayViewer";
import PathwayNeighborGraph from "@/components/PathwayNeighborGraph";

export default function PathwaysPage() {
  const [pathway, setPathway] = useState("hsa04150");
  const [pathwayInput, setPathwayInput] = useState(pathway);
  const [showLabels, setShowLabels] = useState(true);
  const [proteinIds, setProteinIds] = useState<string[]>([]);
  const [proteinSymbols, setProteinSymbols] = useState<string[]>([]);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [selectedEdge, setSelectedEdge] = useState<{left: string[]; right: string[]} | undefined>(undefined);
  const [graphVersion, setGraphVersion] = useState(0);
  const lastDataHashRef = useRef<string>("");

  const sampleOverlay = useMemo<Record<string, number>>(() => ({
    "78|79": -0.8,
    "81|82": 0.9,
    "83|84": 0.5,
    "85|86": -0.3,
  }), []);

  // Immediately clear right-hand graph when pathway changes to avoid visual stacking/flash
  React.useEffect(() => {
    setProteinSymbols([]);
    setProteinIds([]);
    setSelectedSymbols([]);
    setSelectedEdge(undefined);
  }, [pathway]);

  return (
    <div className="w-full h-full overflow-auto p-6 space-y-6 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold mb-4">Pathway Controls</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">KEGG Pathway ID</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={pathwayInput}
                onChange={(e) => setPathwayInput(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                placeholder="e.g., hsa04150"
              />
              <button onClick={() => setPathway(pathwayInput)} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">Load</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Display Options</label>
            <label className="flex items-center">
              <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="mr-2" />
              <span className="text-sm">Show node labels</span>
            </label>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">Pathway is rendered from KGML data with exact positioning and colors</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Popular Pathways</label>
            <select value={pathway} onChange={(e) => setPathway(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
              <option value="hsa04150">mTOR signaling (hsa04150)</option>
              <option value="hsa04010">MAPK signaling (hsa04010)</option>
              <option value="hsa04110">Cell cycle (hsa04110)</option>
              <option value="hsa04210">Apoptosis (hsa04210)</option>
              <option value="hsa04151">PI3K-Akt signaling (hsa04151)</option>
              <option value="hsa04068">FoxO signaling (hsa04068)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Legend</label>
            <div className="text-xs space-y-1 text-gray-700 dark:text-gray-200">
              <div className="flex items-center gap-2"><div className="w-4 h-1 bg-red-500"></div><span>Inhibition (-1.0)</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-1 bg-gray-400"></div><span>No change (0.0)</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-1 bg-blue-500"></div><span>Activation (+1.0)</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-0">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
          <div className="border-r border-gray-200 dark:border-gray-700 p-6">
            <KeggPathwayViewer pathwayId={pathway} edgeOverlay={sampleOverlay} showNodeLabels={showLabels} onProteinSet={({geneIds, symbols}) => { 
              try { console.log('[PathwaysPage] onProteinSet', {pathway, geneIds: geneIds.length, symbols: symbols.length}); } catch {};
              const hash = `${pathway}|${symbols.length}|${symbols.slice().sort().join('|')}`;
              if (hash !== lastDataHashRef.current) {
                lastDataHashRef.current = hash;
                setProteinIds(geneIds);
                setProteinSymbols(symbols);
                setGraphVersion((v) => v + 1);
              } else {
                try { console.log('[PathwaysPage] onProteinSet ignored duplicate'); } catch {}
              }
            }} selectedSymbols={selectedSymbols} onSelectSymbols={(syms) => { setSelectedSymbols(syms); setSelectedEdge(undefined); }} selectedEdge={selectedEdge} onSelectEdge={(pair) => setSelectedEdge(pair)} />
          </div>
          <div className="p-6">
            <h3 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-200">Proteins + neighbors</h3>
            <div className="h-[720px] rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <PathwayNeighborGraph key={`${pathway}:${graphVersion}`} pathwayId={pathway} version={graphVersion} proteinSymbols={proteinSymbols} className="w-full h-full" selectedSymbols={selectedSymbols} onSelectSymbols={(syms) => { setSelectedSymbols(syms); setSelectedEdge(undefined); }} selectedEdge={selectedEdge} onSelectEdge={(pair) => setSelectedEdge(pair)} />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-3">About This Visualization</h3>
        <div className="prose prose-sm max-w-none text-gray-600 dark:text-gray-300">
          <p>
            This interactive pathway viewer renders KEGG pathways from KGML data with exact positioning,
            colors, and shapes as defined in the original pathway specification. Gene nodes appear in
            light green, compounds as white circles, and pathway maps as white rounded rectangles.
          </p>
          <p>
            <strong>API-Driven Gene Naming:</strong> The viewer fetches standardized gene names from the
            KEGG REST API in real-time, ensuring consistent and accurate gene symbols across all pathways.
            Initial rendering uses fallback names for speed, then updates with official KEGG gene symbols.
          </p>
          <p>
            Hover over nodes for details, click to open the side panel. Edge colors and widths can
            represent your experimental data values (red = inhibition, blue = activation). Arrows
            indicate activation, T-shaped ends show inhibition, and plain lines represent binding.
          </p>
          <p>
            The viewer fetches pathway data directly from KEGG REST API via a local proxy server
            to handle CORS restrictions.
          </p>
        </div>
      </div>
    </div>
  );
}


