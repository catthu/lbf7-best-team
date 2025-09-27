#!/usr/bin/env node
/*
Convert a TSV file to graph.json for the viewer.

Usage examples:
  node scripts/tsv-to-graph.js --input /path/final_predictions_80.tsv \
    --source protein1 --target protein2 --output public/graph.json

Options:
  --input    Absolute path to TSV (required)
  --output   Output JSON path (default: public/graph.json)
  --source   Source column name (default: protein1)
  --target   Target column name (default: protein2)
  --weight   Optional weight column name (numeric)
  --directed Treat as directed (default: false)
  --limit    Process at most N rows (for testing)
*/

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {UndirectedGraph, DirectedGraph} = require('graphology');
const fa2 = require('graphology-layout-forceatlas2');
const louvain = require('graphology-communities-louvain');

function parseArgs(argv) {
  const args = {};
  const parts = argv.slice(2);
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i];
    if (!tok.startsWith('--')) continue;
    const raw = tok.replace(/^--/, '');
    if (raw.includes('=')) {
      const [k, v] = raw.split('=');
      args[k] = v;
    } else {
      const k = raw;
      const next = parts[i + 1];
      if (next && !next.startsWith('-')) { args[k] = next; i++; }
      else args[k] = true;
    }
  }
  return args;
}

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

async function run() {
  const args = parseArgs(process.argv);
  const input = args.input || args.i;
  if (!input) {
    console.error('Missing --input /absolute/path/to/file.tsv');
    process.exit(1);
  }
  const inputPath = path.resolve(String(input));
  if (!fs.existsSync(inputPath)) {
    console.error('Input not found:', inputPath);
    process.exit(1);
  }
  const outputPath = path.resolve(String(args.output || 'public/graph.json'));
  const sourceCol = String(args.source || 'protein1');
  const targetCol = String(args.target || 'protein2');
  // Optional display name columns corresponding to source/target. Defaults try common names.
  const name1Col = String(args.name1 || 'name1');
  const name2Col = String(args.name2 || 'name2');
  const weightCol = args.weight ? String(args.weight) : null;
  // Optional provenance column name; defaults to 'allDBs'
  const allDBsCol = String(args.allDBs || 'allDBs');
  const directed = !!args.directed;
  // Default AFM probability column to 'AFMprob' if not provided
  const afmprobCol = String(args.afmprob || 'AFMprob');
  const limit = args.limit ? Number(args.limit) : Infinity;

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath),
    crlfDelay: Infinity,
  });

  let header = null;
  let sIdx = -1, tIdx = -1, wIdx = -1, n1Idx = -1, n2Idx = -1, adbIdx = -1, apIdx = -1;
  const nodeSet = new Set();
  const edgesRaw = [];
  const idToLabel = Object.create(null);
  const nodeIdToAllDBs = Object.create(null); // id -> Set<string>
  const nodeHasNone = Object.create(null);    // id -> boolean

  let row = 0;
  const norm = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const wantS = norm(sourceCol);
  const wantT = norm(targetCol);
  const wantW = weightCol ? norm(weightCol) : null;
  const wantN1 = name1Col ? norm(name1Col) : null;
  const wantN2 = name2Col ? norm(name2Col) : null;
  const wantADB = allDBsCol ? norm(allDBsCol) : null;
  const wantAP = afmprobCol ? norm(afmprobCol) : null;

  for await (const line of rl) {
    if (!line) continue;
    if (line.startsWith('#')) continue; // skip comment/metadata lines
    if (header === null) {
      const cols = line.split('\t');
      const colsNorm = cols.map(norm);
      sIdx = colsNorm.findIndex(h => h === wantS || h.includes(wantS));
      tIdx = colsNorm.findIndex(h => h === wantT || h.includes(wantT));
      wIdx = wantW ? colsNorm.findIndex(h => h === wantW || h.includes(wantW)) : -1;
      n1Idx = wantN1 ? colsNorm.findIndex(h => h === wantN1 || h.includes(wantN1)) : -1;
      n2Idx = wantN2 ? colsNorm.findIndex(h => h === wantN2 || h.includes(wantN2)) : -1;
      adbIdx = wantADB ? colsNorm.findIndex(h => h === wantADB || h.includes(wantADB)) : -1;
      apIdx = wantAP ? colsNorm.findIndex(h => h === wantAP || h.includes(wantAP)) : -1;
      if (sIdx !== -1 && tIdx !== -1) {
        header = cols;
        continue;
      }
      // Not the header row; keep scanning
      continue;
    }
    if (++row > limit) break;
    const parts = line.split('\t');
    if (header === null) continue; // still searching for header
    const a = (parts[sIdx] || '').trim();
    const b = (parts[tIdx] || '').trim();
    if (!a || !b) continue;
    // Capture display names if provided
    if (n1Idx >= 0) {
      const d1 = (parts[n1Idx] || '').trim();
      if (d1 && !idToLabel[a]) idToLabel[a] = d1;
    }
    if (n2Idx >= 0) {
      const d2 = (parts[n2Idx] || '').trim();
      if (d2 && !idToLabel[b]) idToLabel[b] = d2;
    }
    nodeSet.add(a); nodeSet.add(b);
    const w = wIdx >= 0 ? Number((parts[wIdx] || '').trim() || '0') : 1;
    const adb = adbIdx >= 0 ? String((parts[adbIdx] || '').trim()) : '';
    const ap = apIdx >= 0 ? Number((parts[apIdx] || '').trim() || '0') : undefined;
    if (Number.isNaN(w)) {
      edgesRaw.push([a, b, 1, adb, ap]);
    } else {
      edgesRaw.push([a, b, w, adb, ap]);
    }
    // accumulate per-node allDBs metadata
    const addADB = (id, v) => {
      if (!v) return;
      if (!nodeIdToAllDBs[id]) nodeIdToAllDBs[id] = new Set();
      nodeIdToAllDBs[id].add(v);
      if ((v || '').trim().toLowerCase() === 'none') nodeHasNone[id] = true;
    };
    addADB(a, adb);
    addADB(b, adb);
  }

  // Build graphology graph
  const GraphCtor = directed ? DirectedGraph : UndirectedGraph;
  const graph = new GraphCtor();
  for (const id of nodeSet) {
    graph.addNode(id, {x: Math.random(), y: Math.random()});
  }

  const seen = new Set();
  for (const [a, b, w, adb, ap] of edgesRaw) {
    if (!graph.hasNode(a) || !graph.hasNode(b)) continue;
    const key = directed ? `${a}->${b}` : a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const edgeId = key;
    graph.addEdgeWithKey(edgeId, a, b, {weight: w, allDBs: adb, afmprob: typeof ap === 'number' && !Number.isNaN(ap) ? ap : undefined});
  }

  // Compute layout and communities
  const n = graph.order;
  const iterations = n >= 20000 ? 250 : n >= 10000 ? 350 : n >= 5000 ? 450 : 800;
  fa2.assign(graph, {
    iterations,
    settings: {
      gravity: 1.2,
      scalingRatio: 2.0,
      slowDown: 10,
      barnesHutOptimize: n > 2000,
      adjustSizes: true,
    },
  });

  louvain.assign(graph, {resolution: 1});

  // Export
  const nodesOut = [];
  const edgesOut = [];
  const adjacency = Object.create(null);

  graph.forEachNode((id, attrs) => {
    const degree = graph.degree(id);
    const size = Math.max(1, Math.sqrt(degree) * 1.2);
    const adbSet = nodeIdToAllDBs[id] || new Set();
    nodesOut.push({
      id: String(id),
      label: idToLabel[id] ? String(idToLabel[id]) : String(id),
      x: attrs.x,
      y: attrs.y,
      size,
      degree,
      community: attrs.community ?? null,
      allDBs: Array.from(adbSet),
      hasAllDBsNone: !!nodeHasNone[id],
    });
    adjacency[id] = [];
  });

  graph.forEachEdge((e, attrs, src, tgt) => {
    edgesOut.push({id: String(e), source: String(src), target: String(tgt), weight: attrs.weight ?? 1, allDBs: attrs.allDBs || '', afmprob: attrs.afmprob});
    adjacency[src].push(String(tgt));
    adjacency[tgt].push(String(src));
  });

  const communityToNodes = new Map();
  for (const node of nodesOut) {
    const c = node.community ?? -1;
    if (!communityToNodes.has(c)) communityToNodes.set(c, []);
    communityToNodes.get(c).push(node);
  }
  const clusters = [];
  for (const [community, arr] of communityToNodes) {
    if (!arr.length) continue;
    let sx = 0, sy = 0;
    for (const n of arr) { sx += n.x; sy += n.y; }
    clusters.push({
      id: `c${community}`,
      label: `Cluster ${community}`,
      x: sx / arr.length,
      y: sy / arr.length,
      size: Math.max(2, Math.sqrt(arr.length) * 1.8),
      community,
      count: arr.length,
    });
  }

  const out = {
    meta: {generatedAt: new Date().toISOString(), order: nodesOut.length, size: edgesOut.length},
    nodes: nodesOut,
    edges: edgesOut,
    clusters,
    adjacency,
  };

  ensureDirSync(path.dirname(outputPath));
  fs.writeFileSync(outputPath, JSON.stringify(out));
  console.log(`Wrote ${outputPath} with ${nodesOut.length} nodes and ${edgesOut.length} edges`);
}

run().catch((err) => { console.error(err); process.exit(1); });


