"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import popper from "cytoscape-popper";

// The cytoscape-popper types are slightly mismatched with Cytoscape's Ext signature
// in our environment; cast to any to safely register the extension.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
cytoscape.use((popper as unknown) as any);

const API_BASE = '';
const KEGG_KGML = (id: string) => `/api/kegg/${id}/kgml`;
const KEGG_BULK_GENES = (geneIdList: string[]) => `/api/kegg/genes/${geneIdList.join(',')}`;

type GeneData = {
  symbol: string;
  synonyms: string[];
  fullName: string;
  uniprotId: string;
  ncbiGeneId: string;
  omimId: string;
  hgncId: string;
  ensemblId: string;
  orthology: string;
  ecNumber: string;
  pathways: string[];
  diseases: string[];
  drugs: string[];
  chromosomePosition: string;
};

const geneNameCache = new Map<string, GeneData>();

function parseKeggGeneEntry(geneEntry: string, geneId: string, fallbackName: string): GeneData {
  const data: GeneData = {
    symbol: fallbackName,
    synonyms: [],
    fullName: '',
    uniprotId: '',
    ncbiGeneId: '',
    omimId: '',
    hgncId: '',
    ensemblId: '',
    orthology: '',
    ecNumber: '',
    pathways: [],
    diseases: [],
    drugs: [],
    chromosomePosition: ''
  };

  const symbolMatch = geneEntry.match(/^SYMBOL\s+(.+)$/m);
  if (symbolMatch) {
    const symbols = symbolMatch[1].split(/[,;]/).map(s => s.trim());
    if (symbols.length > 0) {
      data.symbol = symbols[0];
      data.synonyms = symbols;
    }
  }

  const nameMatch = geneEntry.match(/^NAME\s+(.+)$/m);
  if (nameMatch) data.fullName = nameMatch[1].replace(/^\(RefSeq\)\s*/, '').trim();

  const orthologyMatch = geneEntry.match(/^ORTHOLOGY\s+(.+)$/m);
  if (orthologyMatch) {
    data.orthology = orthologyMatch[1];
    const ecMatch = orthologyMatch[1].match(/\[EC:([\d\.]+)\]/);
    if (ecMatch) data.ecNumber = ecMatch[1];
  }

  const dblinksSectionMatch = geneEntry.match(/^DBLINKS\s+([\s\S]*?)^[A-Z]/m);
  if (dblinksSectionMatch) {
    const dblinks = dblinksSectionMatch[1];
    const uniprotMatch = dblinks.match(/UniProt:\s+([A-Z0-9]+)/);
    if (uniprotMatch) data.uniprotId = uniprotMatch[1];
    const ncbiMatch = dblinks.match(/NCBI-GeneID:\s+(\d+)/);
    if (ncbiMatch) data.ncbiGeneId = ncbiMatch[1];
    const omimMatch = dblinks.match(/OMIM:\s+(\d+)/);
    if (omimMatch) data.omimId = omimMatch[1];
    const hgncMatch = dblinks.match(/HGNC:\s+(\d+)/);
    if (hgncMatch) data.hgncId = hgncMatch[1];
    const ensemblMatch = dblinks.match(/Ensembl:\s+([A-Z0-9]+)/);
    if (ensemblMatch) data.ensemblId = ensemblMatch[1];
  }

  const pathwayMatches = geneEntry.match(/^\s+hsa\d+\s+(.+)$/gm);
  if (pathwayMatches) {
    data.pathways = pathwayMatches.map(match => match.trim().replace(/^hsa\d+\s+/, '')).slice(0, 10);
  }

  const diseaseSectionMatch = geneEntry.match(/^DISEASE\s+([\s\S]*?)^[A-Z]/m);
  if (diseaseSectionMatch) {
    const diseaseMatches = diseaseSectionMatch[1].match(/H\d+\s+(.+)/g);
    if (diseaseMatches) data.diseases = diseaseMatches.map(match => match.replace(/H\d+\s+/, '').trim());
  }

  const drugSectionMatch = geneEntry.match(/^DRUG_TARGET\s+([\s\S]*?)^[A-Z]/m);
  if (drugSectionMatch) {
    const drugMatches = drugSectionMatch[1].match(/([^:]+):/g);
    if (drugMatches) data.drugs = drugMatches.map(match => match.replace(':', '').trim());
  }

  const positionMatch = geneEntry.match(/^POSITION\s+(.+)$/m);
  if (positionMatch) data.chromosomePosition = positionMatch[1];

  return data;
}

async function getBulkStandardizedGeneNames(geneNodes: cytoscape.CollectionReturnValue, entries: Record<string, any>) {
  const uniqueGeneIds = new Set<string>();
  const geneIdToNodeMap = new Map<string, {node: cytoscape.NodeSingular; fallbackName: string}>();

  geneNodes.forEach(node => {
    const keggId: string | undefined = node.data('keggId');
    if (!keggId) return;
    const geneIds = keggId.split(/\s+/).filter(id => id.includes(':') && id.startsWith('hsa:') && id.match(/^hsa:\d+$/));
    if (geneIds.length === 0) return;
    geneIds.forEach(geneId => {
      if (geneNameCache.has(geneId)) return;
      uniqueGeneIds.add(geneId);
      geneIdToNodeMap.set(geneId, {node, fallbackName: node.data('label')});
    });
  });

  if (uniqueGeneIds.size === 0) return;
  const geneIdList = Array.from(uniqueGeneIds);

  try {
    const apiUrl = KEGG_BULK_GENES(geneIdList);
    const response = await fetch(apiUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bulkData = await response.text();
    if (bulkData.length === 0 || !bulkData.includes('ENTRY')) return;
    const geneEntries = bulkData.split(/\n\/\/\/\n|\n\/\/\/$/);
    let updatedCount = 0;
    geneEntries.forEach((geneEntry) => {
      if (!geneEntry.trim()) return;
      const entryMatch = geneEntry.match(/^ENTRY\s+(\d+)/m);
      if (!entryMatch) return;
      const geneNumber = entryMatch[1];
      const fullGeneId = `hsa:${geneNumber}`;
      const nodeInfo = geneIdToNodeMap.get(fullGeneId);
      if (!nodeInfo) {
        const geneData = parseKeggGeneEntry(geneEntry, fullGeneId, fullGeneId);
        geneNameCache.set(fullGeneId, geneData);
        return;
      }
      const geneData = parseKeggGeneEntry(geneEntry, fullGeneId, nodeInfo.fallbackName);
      geneNameCache.set(fullGeneId, geneData);
      const nodeKeggId = nodeInfo.node.data('keggId') as string | undefined;
      const primaryGeneId = nodeKeggId ? nodeKeggId.split(/\s+/)[0] : '';
      const isPrimaryGene = fullGeneId === primaryGeneId;
      if (isPrimaryGene) {
        nodeInfo.node.data('geneData', geneData);
        entries[nodeInfo.node.id()].geneData = geneData;
        if (geneData.symbol !== nodeInfo.fallbackName) {
          nodeInfo.node.data('label', geneData.symbol);
          nodeInfo.node.data('name', geneData.symbol);
          entries[nodeInfo.node.id()].name = geneData.symbol;
          updatedCount++;
        }
      }
    });
  } catch (error) {
    geneIdList.forEach(geneId => {
      const nodeInfo = geneIdToNodeMap.get(geneId);
      if (nodeInfo) geneNameCache.set(geneId, parseKeggGeneEntry('', geneId, nodeInfo.fallbackName));
    });
  }
}

function extractFallbackGeneName(graphicsName: string | null, entryType: string): string {
  if (!graphicsName) return "";
  if (entryType === "map") return graphicsName.replace(/^TITLE:\s*/, "").replace(/\s+pathway$/, "");
  if (entryType === "compound") return graphicsName;
  if (entryType === "gene" || entryType === "ortholog") {
    const cleanName = graphicsName.replace(/^TITLE:/, "").replace(/\.\.\.$/, "").trim();
    const parts = cleanName.split(/[,;]/).map(p => p.trim());
    const shortNames = parts.filter(part => part.length >= 3 && part.length <= 8 && /^[A-Za-z][\w]*$/.test(part));
    return shortNames.length > 0 ? shortNames[0] : parts[0] || cleanName;
  }
  return graphicsName;
}

function getGroupLabel(groupId: string, componentIds: string[]) {
  return componentIds.length > 1 ? "Complex" : "Group";
}

function parseKgmlToCyElements(xmlStr: string) {
  const doc = new DOMParser().parseFromString(xmlStr, "text/xml");
  const mapW = parseInt(doc.documentElement.getAttribute("width") || "1200", 10);
  const mapH = parseInt(doc.documentElement.getAttribute("height") || "800", 10);

  const entries: Record<string, any> = {};
  const nodes: any[] = [];
  const groups = new Map<string, string[]>();

  doc.querySelectorAll("entry").forEach((e) => {
    const id = e.getAttribute("id") || '';
    const type = e.getAttribute("type") || "";
    const name = e.getAttribute("name") || "";
    const g = e.querySelector("graphics");
    let x = 0, y = 0, w = 60, h = 20, rawLabel = name, displayLabel = name;
    let bgcolor = "#FFFFFF", fgcolor = "#000000", shape = "rectangle";
    if (g) {
      x = Math.round(parseFloat(g.getAttribute("x") || "0"));
      y = Math.round(parseFloat(g.getAttribute("y") || "0"));
      w = Math.round(parseFloat(g.getAttribute("width") || "60"));
      h = Math.round(parseFloat(g.getAttribute("height") || "20"));
      rawLabel = g.getAttribute("name") || name;
      bgcolor = g.getAttribute("bgcolor") || bgcolor;
      fgcolor = g.getAttribute("fgcolor") || fgcolor;
      shape = g.getAttribute("type") || shape;
    }
    if (type === "group") {
      const components = Array.from(e.querySelectorAll("component")).map(c => c.getAttribute("id") || '');
      groups.set(id, components);
      displayLabel = getGroupLabel(id, components);
      bgcolor = "#E0E0E0";
      entries[id] = { x, y, w, h, type, name: displayLabel, rawName: rawLabel, keggId: name, bgcolor, fgcolor, shape, components };
      nodes.push({ data: { id, label: displayLabel, rawLabel: rawLabel, keggId: name, type, name: displayLabel, bgcolor, fgcolor, shape, components }, position: { x, y }, classes: `${type} compound` });
    } else {
      displayLabel = extractFallbackGeneName(rawLabel, type);
      entries[id] = { x, y, w, h, type, name: displayLabel, rawName: rawLabel, keggId: name, bgcolor, fgcolor, shape };
      nodes.push({ data: { id, label: displayLabel, rawLabel: rawLabel, keggId: name, type, name: displayLabel, bgcolor, fgcolor, shape }, position: { x, y }, classes: type });
    }
  });

  const edges: any[] = [];
  doc.querySelectorAll("relation").forEach((r, i) => {
    const source = r.getAttribute("entry1") || '';
    const target = r.getAttribute("entry2") || '';
    const relType = r.getAttribute("type") || "PPrel";
    let subtype = "interaction";
    let arrowStyle = "triangle";
    let isInhibition = false;
    let edgeLabel = "";
    let lineStyle = "solid";
    const modifications: string[] = [];
    const subtypes = r.querySelectorAll("subtype");
    subtypes.forEach(st => {
      const name = st.getAttribute("name") || "";
      if (name.includes("inhibition")) { isInhibition = true; arrowStyle = "tee"; }
      else if (name.includes("activation")) { arrowStyle = "triangle"; }
      else if (name.includes("binding")) { arrowStyle = "none"; lineStyle = "dashed"; }
      else if (name.includes("indirect")) { lineStyle = "dotted"; }
      else if (name.includes("phosphorylation")) { modifications.push("+p"); }
      else if (name.includes("ubiquitination")) { modifications.push("+u"); }
      else if (name.includes("methylation")) { modifications.push("+m"); }
      else if (name.includes("glycosylation")) { modifications.push("+g"); }
      else if (name.includes("dephosphorylation")) { modifications.push("-p"); }
      if (!subtype || subtype === "interaction") subtype = name;
    });
    if (modifications.length > 0) edgeLabel = modifications.join(" ");
    const id = r.getAttribute("id") || `${source}_${target}_${i}`;
    edges.push({ data: { id, source, target, subtype, relType, arrowStyle, isInhibition, edgeLabel, lineStyle, modifications } });
  });

  return { nodes, edges, mapW, mapH, entries };
}

function divergingColor(v: number) {
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
  const t = clamp((v + 1) / 2, 0, 1);
  const r = Math.round(127 + (255 - 127) * (1 - t));
  const g = Math.round(127 + (127 - 127) * (1 - Math.abs(v)));
  const b = Math.round(127 + (255 - 127) * t);
  return `rgb(${r},${g},${b})`;
}

export default function KeggPathwayViewer({ pathwayId = "hsa04150", edgeOverlay = {}, showNodeLabels = true, onProteinSet, selectedSymbols, onSelectSymbols, selectedEdge, onSelectEdge }: {pathwayId?: string; edgeOverlay?: Record<string, number>; showNodeLabels?: boolean; onProteinSet?: (payload: {geneIds: string[]; symbols: string[]}) => void; selectedSymbols?: string[]; onSelectSymbols?: (symbols: string[]) => void; selectedEdge?: {left: string[]; right: string[]}; onSelectEdge?: (pair: {left: string[]; right: string[]}) => void}) {
  const cyRef = useRef<cytoscape.Core | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState("Loading KGML…");
  const [sideInfo, setSideInfo] = useState<any>(null);
  const [mapDims, setMapDims] = useState({ w: 1200, h: 1200 });
  const tooltipLayerRef = useRef<HTMLDivElement | null>(null);
  const selectedLowerRef = useRef<Set<string>>(new Set());
  const [toast, setToast] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setStatus("Fetching KGML…");
        const res = await fetch(KEGG_KGML(pathwayId));
        const xml = await res.text();
        const { nodes, edges, mapW, mapH, entries } = parseKgmlToCyElements(xml);
        if (cancelled) return;
        setMapDims({ w: mapW, h: mapH });
        const prefersDark = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const labelTextColor = prefersDark ? '#e5e7eb' : '#333';
        const labelBgColor = prefersDark ? '#111827' : '#FFFFFF';
        const labelBorderColor = prefersDark ? '#374151' : '#CCC';
        const cy = cytoscape({
          container: containerRef.current as any,
          elements: [...nodes, ...edges],
          wheelSensitivity: 0.2,
          motionBlur: false,
          textureOnViewport: true,
          boxSelectionEnabled: true,
          // The Cytoscape style definition allows numeric mapper functions at runtime,
          // but the TS types are conservative (string). Cast to any to avoid noise.
          style: ([
            { selector: "node", style: {
              shape: (ele: any) => { const shape = entries[ele.id()]?.shape || "rectangle"; if (shape === "roundrectangle") return "round-rectangle"; if (shape === "circle") return "ellipse"; return "rectangle"; },
              width: (ele: any) => entries[ele.id()]?.w || 60,
              height: (ele: any) => entries[ele.id()]?.h || 20,
              "background-color": (ele: any) => entries[ele.id()]?.bgcolor || "#FFFFFF",
              "background-opacity": 1,
              "border-width": 1,
              "border-color": (ele: any) => entries[ele.id()]?.fgcolor || "#000000",
              label: showNodeLabels ? "data(label)" : "",
              "font-size": 10,
              "text-wrap": "wrap",
              "text-max-width": (ele: any) => (entries[ele.id()]?.w || 60) - 4,
              "text-valign": "center",
              "text-halign": "center",
              color: (ele: any) => entries[ele.id()]?.fgcolor || "#000000",
              "font-weight": "normal"
            }},
            { selector: "node[type='gene']", style: { "background-color": "#BFFFBF", "font-size": 9 } },
            { selector: "node[type='compound']", style: { "background-color": "#FFFFFF", shape: "ellipse" } },
            // cross-highlight style
            { selector: "node.xhl", style: { "border-width": 3, "border-color": "#f59e0b", "background-color": "#fde68a" } },
            { selector: "node[type='map']", style: { "background-color": "#FFFFFF", "border-color": "#666", "border-width": 1, shape: "round-rectangle", "font-size": 9, "font-weight": "bold", "text-valign": "center", "text-halign": "center", "text-wrap": "wrap", "text-max-width": (ele: any) => (entries[ele.id()]?.w || 90) - 6, color: labelTextColor } },
            { selector: "node[name='path:hsa04150']", style: { "background-color": "#F0F8FF", "border-color": "#4682B4", "border-width": 2, "font-size": 12, "font-weight": "bold", color: "#000080" } },
            { selector: "node[type='group']", style: { "background-color": "#E0E0E0", "border-color": "#888", "border-width": 2, shape: "round-rectangle", "font-size": 10, "font-weight": "bold", "text-valign": "center", "text-halign": "center" } },
            { selector: "edge", style: {
              "curve-style": "straight",
              width: (ele: any) => { const k = `${ele.data("source")}|${ele.data("target")}`; const v = (edgeOverlay as any)[k]; const base = 2; if (v === undefined || v === null) return base; return base + 3 * Math.min(1, Math.abs(v)); },
              "line-color": (ele: any) => { const k = `${ele.data("source")}|${ele.data("target")}`; const v = (edgeOverlay as any)[k]; return v === undefined ? "#666" : divergingColor(v); },
              "line-style": (ele: any) => ele.data("lineStyle") || "solid",
              "target-arrow-shape": (ele: any) => ele.data("arrowStyle") || "triangle",
              "target-arrow-color": (ele: any) => { const k = `${ele.data("source")}|${ele.data("target")}`; const v = (edgeOverlay as any)[k]; return v === undefined ? "#666" : divergingColor(v); },
              "source-arrow-shape": "none",
              label: (ele: any) => ele.data("edgeLabel") || "",
              "font-size": "10px",
              "text-background-color": labelBgColor,
              "text-background-opacity": 0.8,
              "text-background-padding": "2px",
              "text-border-width": 1,
              "text-border-color": labelBorderColor,
              "text-border-opacity": 0.8,
            color: labelTextColor,
            "transition-property": "line-color, width",
            "transition-duration": 160
            }},
          { selector: "edge.xhl", style: { "line-color": "#f59e0b", width: 4 } },
            { selector: "edge[isInhibition='true']", style: { "line-color": "#cc0000", "target-arrow-color": "#cc0000", "target-arrow-shape": "tee" } },
            { selector: "edge[subtype*='activation']", style: { "line-color": "#0066cc", "target-arrow-color": "#0066cc", "target-arrow-shape": "triangle" } },
            { selector: "edge[subtype*='binding']", style: { "line-color": "#999", "line-style": "dashed", "target-arrow-shape": "none" } },
            { selector: "edge[lineStyle='dotted']", style: { "line-style": "dotted", "line-color": "#888" } },
            { selector: "edge[lineStyle='dashed']", style: { "line-style": "dashed", "line-color": "#777" } },
            { selector: "node:selected, edge:selected", style: { "border-color": "#ff6600", "border-width": 3, "line-color": "#ff6600", "target-arrow-color": "#ff6600", "z-index": 999 } }
          ] as any),
          layout: { name: "preset", fit: false }
        });
        cy.nodes().positions((n) => { const e = (entries as any)[n.id()]; return { x: e.x, y: e.y }; });
        if (containerRef.current) {
          containerRef.current.style.backgroundImage = "none";
          const prefersDarkNow = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
          containerRef.current.style.backgroundColor = prefersDarkNow ? '#0b1220' : '#ffffff';
          containerRef.current.style.border = prefersDarkNow ? '2px solid #374151' : '2px solid #ddd';
          containerRef.current.style.boxShadow = prefersDarkNow ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.1)';
        }
        const ensureTooltipLayer = () => {
          const container = containerRef.current!;
          let layer = tooltipLayerRef.current;
          if (!layer) {
            layer = document.createElement('div');
            layer.style.position = 'absolute';
            layer.style.left = '0';
            layer.style.top = '0';
            layer.style.right = '0';
            layer.style.bottom = '0';
            layer.style.pointerEvents = 'none';
            container.appendChild(layer);
            tooltipLayerRef.current = layer;
          }
          return layer;
        };
        const makeTooltip = (ele: any) => {
          const layer = ensureTooltipLayer();
          const prefersDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
          const t = document.createElement("div");
          t.className = "tooltip bubble";
          const data = (entries as any)[ele.id()];
          const rawLabel = ele.data("rawLabel");
          const nodeType = ele.data("type");
          const components = ele.data("components");
          const geneData: GeneData | undefined = ele.data("geneData");
          let tooltipContent = `\n            <div style="font-weight:600;margin-bottom:6px;color:#2563eb">${data?.name || ele.id()}</div>\n          `;
          if (nodeType === "gene" && geneData) {
            if (geneData.fullName) tooltipContent += `<div style="font-size:11px;color:${prefersDark ? '#d1d5db' : '#374151'};margin-bottom:3px;font-style:italic">${geneData.fullName}</div>`;
            if (geneData.synonyms && geneData.synonyms.length > 1) tooltipContent += `<div style="font-size:10px;color:${prefersDark ? '#9ca3af' : '#6b7280'};margin-bottom:2px"><strong>Synonyms:</strong> ${geneData.synonyms.slice(1, 4).join(', ')}${geneData.synonyms.length > 4 ? '...' : ''}</div>`;
            if (geneData.uniprotId) tooltipContent += `<div style="font-size:10px;color:#059669;margin-bottom:2px"><strong>UniProt:</strong> <a href="https://www.uniprot.org/uniprot/${geneData.uniprotId}" target="_blank" style="color:#059669;">${geneData.uniprotId}</a></div>`;
            if (geneData.chromosomePosition) tooltipContent += `<div style="font-size:10px;color:#7c3aed;margin-bottom:2px"><strong>Location:</strong> ${geneData.chromosomePosition.replace(/complement\(|[()]/g, '')}</div>`;
            if (geneData.drugs && geneData.drugs.length > 0) tooltipContent += `<div style="font-size:10px;color:#dc2626;margin-bottom:2px"><strong>Drugs:</strong> ${geneData.drugs.slice(0, 2).join(', ')}${geneData.drugs.length > 2 ? '...' : ''}</div>`;
          } else if (nodeType === "group" && components && components.length > 0) {
            tooltipContent += `<div style=\"font-size:11px;color:${prefersDark ? '#9ca3af' : '#666'};margin-bottom:2px\">Complex with ${components.length} components</div>`;
          } else if (rawLabel && rawLabel !== data?.name) {
            tooltipContent += `<div style=\"font-size:11px;color:${prefersDark ? '#9ca3af' : '#666'};margin-bottom:2px\">${rawLabel}</div>`;
          }
          tooltipContent += `<div style="font-size:10px;color:${prefersDark ? '#9ca3af' : '#6b7280'};margin-top:4px">Click for details</div>`;
          t.innerHTML = tooltipContent;
          t.style.cssText = `position:absolute; background:${prefersDark ? '#111827' : 'white'}; border: 1px solid ${prefersDark ? '#374151' : '#e5e7eb'}; border-radius: 8px; padding: 8px 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); font-family: system-ui, -apple-system, sans-serif; max-width: 300px; font-size: 12px; line-height: 1.4; z-index: 1000; pointer-events: none;`;
          layer.appendChild(t);
          const place = () => {
            try {
              const rp = ele.renderedPosition();
              t.style.left = `${Math.round(rp.x)}px`;
              t.style.top = `${Math.round(rp.y - 12)}px`;
              t.style.transform = 'translate(-50%, -100%)';
            } catch {}
          };
          place();
          const onMove = () => place();
          ele.on('position', onMove);
          cy.on('pan zoom', onMove);
          ele.on("mouseout", () => {
            try { ele.removeListener('position', onMove); cy.removeListener('pan zoom', onMove); } catch {}
            if (t && t.parentElement) t.parentElement.removeChild(t);
          });
        };
        cy.on("mouseover", "node", (evt) => makeTooltip(evt.target));
        cy.on("tap", "node", (evt) => {
          const n = evt.target as any;
          const e = (entries as any)[n.id()];
          const nodeType = n.data("type");
          let multipleGenes: Array<{keggId: string; geneData: GeneData | null}> = [];
          if (nodeType === "gene" && n.data("keggId")) {
            const geneIds = (n.data("keggId") as string).split(/\s+/).filter(id => id.startsWith('hsa:'));
            if (geneIds.length > 1) {
              multipleGenes = geneIds.map(geneId => ({ keggId: geneId, geneData: geneNameCache.get(geneId) || null }));
            }
          }
          const sideInfoData = { id: n.id(), label: e?.name || n.data("label"), rawLabel: n.data("rawLabel"), keggId: n.data("keggId"), type: nodeType || "", components: n.data("components"), geneData: n.data("geneData"), multipleGenes, x: e?.x, y: e?.y, w: e?.w, h: e?.h };
          setSideInfo(sideInfoData);
          try {
            if (nodeType === 'gene') {
              const syms = (n.data('symbols') as string[] | undefined) || ([(n.data('label') as string) || ''].filter(Boolean));
              if (onSelectSymbols && syms && syms.length) onSelectSymbols(syms);
              // Clear any previous edge toast
              setToast('');
            }
          } catch {}
        });
        cy.on("tap", "edge", (evt) => {
          try {
            const e = evt.target as any;
            const src = e.data('source');
            const tgt = e.data('target');
            const s = cy.getElementById(src);
            const t = cy.getElementById(tgt);
            const symsS: string[] = (s?.data('symbols') as string[] | undefined) || ([(s?.data('label') as string) || ''].filter(Boolean));
            const symsT: string[] = (t?.data('symbols') as string[] | undefined) || ([(t?.data('label') as string) || ''].filter(Boolean));
            if (onSelectEdge) onSelectEdge({left: symsS, right: symsT});
            setToast('');
          } catch {}
        });
        cy.resize();
        const bb = cy.nodes().boundingBox();
        const containerHeight = containerRef.current?.clientHeight || mapH;
        const containerWidth = containerRef.current?.clientWidth || mapW;
        const paddingTop = 10, paddingHorizontal = 20, paddingBottom = 30;
        const zoomForWidth = (containerWidth - 2 * paddingHorizontal) / bb.w;
        const zoomForHeight = (containerHeight - paddingTop - paddingBottom) / bb.h;
        const optimalZoom = Math.min(zoomForWidth, zoomForHeight, 1.0);
        cy.zoom(optimalZoom);
        const renderedBB = cy.nodes().renderedBoundingBox();
        const targetTopY = paddingTop;
        const currentTopY = renderedBB.y1;
        const panAdjustmentY = targetTopY - currentTopY;
        const containerCenterX = (containerWidth) / 2;
        const renderedCenterX = renderedBB.x1 + (renderedBB.w / 2);
        const panAdjustmentX = containerCenterX - renderedCenterX;
        const currentPan = cy.pan();
        cy.pan({ x: currentPan.x + panAdjustmentX, y: currentPan.y + panAdjustmentY });
        cyRef.current = cy;
        setStatus("");
        setTimeout(async () => {
          if (cancelled) return;
          setStatus("Fetching gene names...");
          const geneNodes = cy.nodes().filter(node => node.data('type') === 'gene');
          if (geneNodes.length === 0) { setStatus(""); return; }
          try {
            await getBulkStandardizedGeneNames(geneNodes, entries);
            if (!cancelled) setStatus("");
          } catch {
            if (!cancelled) setStatus("");
          } finally {
            try {
              // Build full gene and name list: include all gene IDs present on nodes
              // and expand names to include primary symbols, synonyms, and fallback labels
              const allGeneIds: string[] = [];
              const allNames: Set<string> = new Set();
              const addName = (nm: string | undefined | null) => {
                const t = (nm || '').trim();
                if (!t) return;
                allNames.add(t);
              };
              geneNodes.forEach((n) => {
                const keggId: string | undefined = n.data('keggId');
                if (!keggId) return;
                const ids = keggId.split(/\s+/).filter(id => id.startsWith('hsa:'));
                for (const id of ids) allGeneIds.push(id);
                const nodeNames: Set<string> = new Set();
                ids.forEach((gid) => {
                  const gd = geneNameCache.get(gid);
                  if (gd) {
                    addName(gd.symbol);
                    nodeNames.add(gd.symbol);
                    if (gd.synonyms && gd.synonyms.length) {
                      gd.synonyms.forEach((s) => { addName(s); nodeNames.add(s); });
                    }
                  }
                });
                // Fallback: include displayed label and rawLabel tokens
                const lbl = (n.data('label') as string) || '';
                if (lbl) { addName(lbl); nodeNames.add(lbl); }
                const raw = (n.data('rawLabel') as string) || '';
                if (raw) {
                  raw.split(/[;,]/).map(s => s.trim()).forEach(tok => { if (tok) { addName(tok); nodeNames.add(tok); } });
                }
                n.data('symbols', Array.from(nodeNames));
              });
              const uniqIds = Array.from(new Set(allGeneIds));
              const uniqNames = Array.from(allNames);
              if (!cancelled) { onProteinSet && onProteinSet({geneIds: uniqIds, symbols: uniqNames}); }
            } catch {}
          }
        }, 100);
      } catch (err) {
        setStatus("Failed to load KGML. (CORS? Try the proxy below.)");
        console.error(err);
      }
    }
    run();
    return () => { cancelled = true; cyRef.current?.destroy(); };
  }, [pathwayId, showNodeLabels, edgeOverlay]);

  // Cross-highlight when selectedSymbols from parent change
  React.useEffect(() => {
    const cy = cyRef.current as any;
    if (!cy) return;
    try {
      cy.nodes().removeClass('xhl');
      const list = (selectedSymbols || []).map((s) => (s || '').toLowerCase());
      if (!list.length) return;
      cy.nodes().forEach((n: any) => {
        if (n.data('type') !== 'gene') return;
        const syms = (n.data('symbols') as string[] | undefined) || [];
        const hit = syms.some((s) => list.includes((s || '').toLowerCase()));
        if (hit) n.addClass('xhl');
      });
      // Show toast if nothing matched
      const anyMatch = cy.nodes('.xhl').length > 0;
      setToast(anyMatch ? '' : 'Not found in pathway drawing');
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
      cy.edges().forEach((e: any) => {
        const s = cy.getElementById(e.data('source'));
        const t = cy.getElementById(e.data('target'));
        const sNames: string[] = [
          ...(((s?.data('symbols') as string[]) || []).map((x) => (x || '').toLowerCase())),
          (((s?.data('label') as string) || '').toLowerCase()),
        ].filter(Boolean);
        const tNames: string[] = [
          ...(((t?.data('symbols') as string[]) || []).map((x) => (x || '').toLowerCase())),
          (((t?.data('label') as string) || '').toLowerCase()),
        ].filter(Boolean);
        let match = false;
        for (const a of sNames) {
          if (L.has(a)) {
            for (const b of tNames) { if (R.has(b)) { match = true; break; } }
          }
          if (match) break;
        }
        if (!match) {
          for (const a of sNames) {
            if (R.has(a)) {
              for (const b of tNames) { if (L.has(b)) { match = true; break; } }
            }
            if (match) break;
          }
        }
        if (match) e.addClass('xhl');
      });
      const anyMatch = cy.edges('.xhl').length > 0;
      setToast(anyMatch ? '' : 'Edge not found in pathway drawing');
    } catch {}
  }, [selectedEdge ? `${(selectedEdge.left||[]).join(',')}|${(selectedEdge.right||[]).join(',')}` : '']);

  return (
    <div className="w-full">
      <div className="flex gap-3 items-center mb-4">
        <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">Pathway: {pathwayId}</div>
        {status && <div className="text-sm text-amber-700 font-medium">{status}</div>}
      </div>
      <div className="flex justify-center overflow-auto relative">
        <div ref={containerRef} className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow" style={{ width: mapDims.w, height: mapDims.h }} />
        {toast ? (
          <div className="absolute right-3 top-3 z-10 bg-white/95 dark:bg-gray-900/95 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2 text-xs text-gray-800 dark:text-gray-100 shadow">
            {toast}
          </div>
        ) : null}
      </div>
      {sideInfo && (
        <div className="fixed left-6 bottom-6 w-[720px] max-w-[92vw] bg-white/95 dark:bg-gray-900/95 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-xl z-50 overflow-y-auto text-gray-900 dark:text-gray-100">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-semibold">{sideInfo.label}</h3>
            <button onClick={() => setSideInfo(null)} className="text-gray-400 hover:text-gray-200 text-xl leading-none">×</button>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="font-medium">Type:</span>
              <span className="ml-2 px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded text-xs">{sideInfo.type || "-"}</span>
            </div>
            {(() => {
              if (sideInfo.type === "gene" && (sideInfo.multipleGenes?.length > 0 || sideInfo.geneData)) {
                if (sideInfo.multipleGenes && sideInfo.multipleGenes.length > 1) {
                  return (
                    <div>
                      <div className="mb-3 p-2 bg-blue-50 rounded-lg border border-blue-200">
                        <span className="font-medium text-blue-800">Multiple Genes ({sideInfo.multipleGenes.length})</span>
                        <div className="text-xs text-blue-600 mt-1">This complex contains {sideInfo.multipleGenes.length} different genes</div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {sideInfo.multipleGenes.map((gene: any, index: number) => (
                          <div key={gene.keggId} className="border border-gray-200 dark:border-gray-700 rounded-md p-3 bg-gray-50 dark:bg-gray-800">
                            <div className="flex items-center justify-between mb-1.5">
                              <h4 className="font-medium">Gene {index + 1}</h4>
                              <a href={`https://www.kegg.jp/entry/${gene.keggId}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-blue-600 hover:underline bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 rounded">{gene.keggId}</a>
                            </div>
                            {gene.geneData ? (
                              <div className="space-y-1.5">
                                {gene.geneData.fullName && (
                                  <div className="text-xs text-gray-600 dark:text-gray-300 italic">{gene.geneData.fullName}</div>
                                )}
                                {gene.geneData.synonyms && gene.geneData.synonyms.length > 1 && (
                                  <div className="flex flex-wrap gap-1">
                                    {gene.geneData.synonyms.slice(0, 3).map((syn: string, i: number) => (
                                      <span key={i} className={`${i === 0 ? 'bg-blue-100 text-blue-800 font-medium dark:bg-blue-900/30 dark:text-blue-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'} inline-block px-1 py-0.5 rounded text-[10px]`}>{syn}</span>
                                    ))}
                                    {gene.geneData.synonyms.length > 3 && (
                                      <span className="text-[10px] text-gray-500 dark:text-gray-400">+{gene.geneData.synonyms.length - 3}</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-xs text-gray-500 dark:text-gray-400 italic">Gene data not available</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                if (sideInfo.geneData) {
                  return (
                    <div className="space-y-3">
                      {sideInfo.geneData.fullName && (
                        <div className="text-xs text-gray-600 dark:text-gray-300 break-words italic">{sideInfo.geneData.fullName}</div>
                      )}
                      {sideInfo.geneData.synonyms && sideInfo.geneData.synonyms.length > 1 && (
                        <div className="flex flex-wrap gap-1">
                          {sideInfo.geneData.synonyms.map((synonym: string, i: number) => (
                            <span key={i} className={`${i === 0 ? 'bg-blue-100 text-blue-800 font-medium dark:bg-blue-900/30 dark:text-blue-200' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'} inline-block px-2 py-1 rounded text-xs`}>{synonym}</span>
                          ))}
                        </div>
                      )}
                      {(sideInfo.geneData.uniprotId || sideInfo.geneData.ensemblId || sideInfo.geneData.omimId || sideInfo.geneData.ncbiGeneId) && (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {sideInfo.geneData.uniprotId && (
                            <div className="flex items-center justify-between"><span className="text-gray-600 dark:text-gray-300">UniProt:</span><a href={`https://www.uniprot.org/uniprot/${sideInfo.geneData.uniprotId}`} target="_blank" rel="noopener noreferrer" className="font-mono text-green-600 hover:underline bg-green-50 dark:bg-green-900/30 px-2 py-1 rounded">{sideInfo.geneData.uniprotId}</a></div>
                          )}
                          {sideInfo.geneData.ensemblId && (
                            <div className="flex items-center justify-between"><span className="text-gray-600 dark:text-gray-300">Ensembl:</span><a href={`https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=${sideInfo.geneData.ensemblId}`} target="_blank" rel="noopener noreferrer" className="font-mono text-blue-600 hover:underline bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded">{sideInfo.geneData.ensemblId}</a></div>
                          )}
                          {sideInfo.geneData.omimId && (
                            <div className="flex items-center justify-between"><span className="text-gray-600 dark:text-gray-300">OMIM:</span><a href={`https://omim.org/entry/${sideInfo.geneData.omimId}`} target="_blank" rel="noopener noreferrer" className="font-mono text-purple-600 hover:underline bg-purple-50 dark:bg-purple-900/30 px-2 py-1 rounded">{sideInfo.geneData.omimId}</a></div>
                          )}
                          {sideInfo.geneData.ncbiGeneId && (
                            <div className="flex items-center justify-between"><span className="text-gray-600 dark:text-gray-300">NCBI Gene:</span><a href={`https://www.ncbi.nlm.nih.gov/gene/${sideInfo.geneData.ncbiGeneId}`} target="_blank" rel="noopener noreferrer" className="font-mono text-orange-600 hover:underline bg-orange-50 dark:bg-orange-900/30 px-2 py-1 rounded">{sideInfo.geneData.ncbiGeneId}</a></div>
                          )}
                        </div>
                      )}
                      <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                        <span className="font-medium">Graphics:</span>
                        <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 grid grid-cols-3 gap-2">
                          <div>Position: ({sideInfo.x}, {sideInfo.y})</div>
                          <div>Size: {sideInfo.w} × {sideInfo.h} px</div>
                          <div>Entry ID: {sideInfo.id}</div>
                        </div>
                      </div>
                    </div>
                  );
                }
              }
              if (sideInfo.type === "group" && sideInfo.components) {
                return (
                  <div className="grid grid-cols-2 gap-2">
                    <span className="font-medium">Components:</span>
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">{sideInfo.components.length} member(s): {sideInfo.components.join(", ")}</div>
                  </div>
                );
              }
              if (sideInfo.rawLabel && sideInfo.rawLabel !== sideInfo.label) {
                return (
                  <div className="text-xs">
                    <span className="font-medium">Full name:</span>
                    <div className="mt-1 text-xs text-gray-600 dark:text-gray-300 break-words">{sideInfo.rawLabel}</div>
                  </div>
                );
              }
              return null;
            })()}
          </div>
        </div>
      )}
    </div>
  );
}


