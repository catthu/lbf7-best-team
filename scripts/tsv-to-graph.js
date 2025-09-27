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
  const locality1Col = String(args.locality1 || 'locality1');
  const locality2Col = String(args.locality2 || 'locality2');
  const outputLocalityPath = path.resolve(String(args.localityOutput || path.join(path.dirname(outputPath), path.basename(outputPath).replace(/\.json$/, '_locality.json'))));
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
  let sIdx = -1, tIdx = -1, wIdx = -1, n1Idx = -1, n2Idx = -1, adbIdx = -1, apIdx = -1, loc1Idx = -1, loc2Idx = -1;
  const nodeSet = new Set();
  const edgesRaw = [];
  const edgesRawLoc = [];
  const idToLabel = Object.create(null);
  const nodeIdToAllDBs = Object.create(null); // id -> Set<string>
  const nodeHasNone = Object.create(null);    // id -> boolean
  const proteinToLocs = Object.create(null);  // id -> Set<string>

  let row = 0;
  const norm = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const wantS = norm(sourceCol);
  const wantT = norm(targetCol);
  const wantW = weightCol ? norm(weightCol) : null;
  const wantN1 = name1Col ? norm(name1Col) : null;
  const wantN2 = name2Col ? norm(name2Col) : null;
  const wantADB = allDBsCol ? norm(allDBsCol) : null;
  const wantAP = afmprobCol ? norm(afmprobCol) : null;
  const wantLoc1 = locality1Col ? norm(locality1Col) : null;
  const wantLoc2 = locality2Col ? norm(locality2Col) : null;

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
      loc1Idx = wantLoc1 ? colsNorm.findIndex(h => h === wantLoc1 || h.includes(wantLoc1)) : -1;
      loc2Idx = wantLoc2 ? colsNorm.findIndex(h => h === wantLoc2 || h.includes(wantLoc2)) : -1;
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
    const rawLoc1 = loc1Idx >= 0 ? String((parts[loc1Idx] || '').trim()) : '';
    const rawLoc2 = loc2Idx >= 0 ? String((parts[loc2Idx] || '').trim()) : '';
    const splitLocs = (s) => String(s || '').split(/[,;|]/g).map(x => x.trim()).filter(Boolean);
    const locs1 = splitLocs(rawLoc1);
    const locs2 = splitLocs(rawLoc2);
    if (Number.isNaN(w)) {
      edgesRaw.push([a, b, 1, adb, ap]);
    } else {
      edgesRaw.push([a, b, w, adb, ap]);
    }
    edgesRawLoc.push([a, b, w, adb, ap, locs1, locs2]);
    // accumulate per-node allDBs metadata
    const addADB = (id, v) => {
      if (!v) return;
      if (!nodeIdToAllDBs[id]) nodeIdToAllDBs[id] = new Set();
      nodeIdToAllDBs[id].add(v);
      if ((v || '').trim().toLowerCase() === 'none') nodeHasNone[id] = true;
    };
    addADB(a, adb);
    addADB(b, adb);
    // accumulate per-protein localities
    const addLocs = (id, arr) => {
      if (!arr || !arr.length) return;
      if (!proteinToLocs[id]) proteinToLocs[id] = new Set();
      for (const L of arr) proteinToLocs[id].add(L);
    };
    addLocs(a, locs1);
    addLocs(b, locs2);
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

  // ----- Build locality view -----
  // Build node instances per locality
  const locNamesAll = Array.from(new Set(
    Object.values(proteinToLocs).flatMap((s) => Array.from(s))
  ));
  // Count how many proteins have each locality to size spacing
  const locCounts = Object.create(null);
  for (const id of Object.keys(proteinToLocs)) {
    for (const L of proteinToLocs[id]) locCounts[L] = (locCounts[L] || 0) + 1;
  }
  // Group similar localities by explicit ontology from user
  const groupDefs = [
    {key: 'NUCLEUS', members: [
      'Nucleus','Chromosome','Spliceosome','Centromere','Kinetochore','Nucleosome core','Telomere','Nuclear pore complex','DNA-directed RNA polymerase','Primosome'
    ]},
    {key: 'CYTOPLASM', members: [
      'Cytoplasm','Cytoskeleton','Endoplasmic reticulum','Golgi apparatus','Cytoplasmic vesicle','Endosome','Lysosome','Microtubule','Mitochondrion outer membrane','Microsome','Intermediate filament','Peroxisome','Proteasome','Proteaosome','Lipid droplet','Sarcoplasmic reticulum','Signalosome','Inflammasome','Signal recognition particle','Thick filament','Vacuole','Viral envelope protein','Target membrane','Membrane'
    ]},
    {key: 'MITOCHONDRIA', members: [
      'Mitochondrion','Mitochondrion inner membrane','Mitochondrion nuclei','Mitochondrion nucleoid'
    ]},
    {key: 'EXTRACELLULAR', members: [
      'Cell membrane','Cell projection','Synapse','Cell junction','Cilium','Extracellular matrix','Immunoglobulin','Postsynaptic cell membrane','Flagellum','T cell receptor','Keratin','Tight junction','Synaptosome','Coated pit','Basement membrane','Dynein','MHC II','Gap junction','HDL','Exosome','MHC I','LDL','VLDL','Membrane attack complex','Surface film','Chylomicron','Virion','Target cell membrane'
    ]},
    {key: 'OTHER', members: []},
  ];
  const memberToGroup = Object.create(null);
  for (let gi = 0; gi < groupDefs.length; gi++) {
    for (const m of groupDefs[gi].members) memberToGroup[m.toLowerCase()] = gi;
  }
  function groupIndexOf(loc) {
    const k = String(loc || '').toLowerCase();
    return (k in memberToGroup) ? memberToGroup[k] : (groupDefs.length - 1);
  }
  const locNamesSorted = locNamesAll.slice().sort((a, b) => {
    const ga = groupIndexOf(a);
    const gb = groupIndexOf(b);
    if (ga !== gb) return ga - gb;
    return (a.toLowerCase() < b.toLowerCase()) ? -1 : 1;
  });
  // Place groups in a 2x2 layout: NUCLEUS (TL), CYTOPLASM (TR), EXTRACELLULAR (BL), MITOCHONDRIA (BR)
  const locCenter = new Map();
  const quadOffset = {
    0: {x: -450, y: -300}, // NUCLEUS top-left
    1: {x:  450, y: -300}, // CYTOPLASM top-right
    3: {x:  450, y:  320}, // EXTRACELLULAR bottom-right (we'll swap below)
    2: {x: -450, y:  320}, // MITOCHONDRIA bottom-left
    4: {x:    0, y:    0}, // OTHER center
  };
  let start = 0;
  while (start < locNamesSorted.length) {
    const gIdx = groupIndexOf(locNamesSorted[start]);
    const current = [];
    while (start < locNamesSorted.length && groupIndexOf(locNamesSorted[start]) === gIdx) {
      current.push(locNamesSorted[start]);
      start++;
    }
    const count = current.length;
    const colsInGroup = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rowsInGroup = Math.ceil(count / colsInGroup);
    const baseSpacing = 300; // larger spacing between clusters
    const base = quadOffset[gIdx] || {x: 0, y: 0};
    for (let idx = 0; idx < count; idx++) {
      const loc = current[idx];
      const gx = idx % colsInGroup;
      const gy = Math.floor(idx / colsInGroup);
      const sizeBoost = 1.0 + Math.min(2.0, Math.sqrt(Math.max(1, (locCounts[loc] || 1))) * 0.05);
      locCenter.set(loc, {x: base.x + gx * baseSpacing * sizeBoost, y: base.y + gy * baseSpacing * sizeBoost});
    }
  }
  const nodeKey = (id, loc) => `${id}@${loc || 'unknown'}`;
  const nodesOutL = [];
  const edgesOutL = [];
  const adjacencyL = Object.create(null);
  const nodeSeenL = new Set();
  // Create node instances
  // helper to sample inside a disk for more organic shapes
  function sampleInDisc(R) {
    const t = Math.random();
    const r = R * Math.sqrt(t);
    const a = Math.random() * Math.PI * 2;
    return {dx: r * Math.cos(a), dy: r * Math.sin(a)};
  }
  const locPlaced = Object.create(null);
  for (const id of nodeSet) {
    const locs = proteinToLocs[id] ? Array.from(proteinToLocs[id]) : ['unknown'];
    for (const loc of locs) {
      const key = nodeKey(id, loc);
      if (nodeSeenL.has(key)) continue;
      nodeSeenL.add(key);
      const c = locCenter.get(loc) || {x: 0, y: 0};
      const baseR = 3.8; // tune density
      const R = baseR * Math.sqrt(Math.max(1, locCounts[loc] || 1));
      const {dx, dy} = sampleInDisc(R);
      nodesOutL.push({
        id: key,
        label: idToLabel[id] ? `${idToLabel[id]} (${loc})` : `${id} (${loc})`,
        x: c.x + dx,
        y: c.y + dy,
        size: 1,
        degree: 0,
        community: null,
        baseId: id,
        locality: loc,
      });
      adjacencyL[key] = [];
    }
  }
  // Helper maps
  const nodeIndexL = Object.create(null);
  nodesOutL.forEach((n, i) => nodeIndexL[n.id] = i);
  const hasNodeL = (id) => nodeIndexL[id] !== undefined;
  // Add edges: prefer same-location; otherwise connect to first available location instance of each protein
  const seenEdgesL = new Set();
  for (const [a, b, w, adb, ap, locs1, locs2] of edgesRawLoc) {
    const aLocs = (locs1 && locs1.length) ? locs1 : (proteinToLocs[a] ? Array.from(proteinToLocs[a]) : ['unknown']);
    const bLocs = (locs2 && locs2.length) ? locs2 : (proteinToLocs[b] ? Array.from(proteinToLocs[b]) : ['unknown']);
    // find intersection
    const setB = new Set(bLocs);
    let usedALoc = aLocs[0] || 'unknown';
    let usedBLoc = bLocs[0] || 'unknown';
    for (const la of aLocs) {
      if (setB.has(la)) { usedALoc = la; usedBLoc = la; break; }
    }
    const aKey = nodeKey(a, usedALoc);
    const bKey = nodeKey(b, usedBLoc);
    if (!hasNodeL(aKey) || !hasNodeL(bKey)) continue;
    const edgeId = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    if (seenEdgesL.has(edgeId)) continue;
    seenEdgesL.add(edgeId);
    edgesOutL.push({
      id: edgeId,
      source: aKey,
      target: bKey,
      weight: w || 1,
      allDBs: adb || '',
      afmprob: typeof ap === 'number' && !Number.isNaN(ap) ? ap : undefined,
    });
    adjacencyL[aKey].push(bKey);
    adjacencyL[bKey].push(aKey);
    // increment degree
    nodesOutL[nodeIndexL[aKey]].degree += 1;
    nodesOutL[nodeIndexL[bKey]].degree += 1;
  }
  // Build locality clusters
  const clustersL = locNamesSorted.map((loc, idx) => {
    const members = nodesOutL.filter(n => n.locality === loc);
    if (!members.length) return null;
    let sx = 0, sy = 0;
    for (const n of members) { sx += n.x; sy += n.y; }
    return {
      id: `loc:${idx}`,
      label: loc,
      x: sx / members.length,
      y: sy / members.length,
      size: Math.max(2, Math.sqrt(members.length) * 1.4),
      community: idx,
      count: members.length,
    };
  }).filter(Boolean);
  const outLoc = {
    meta: {generatedAt: new Date().toISOString(), order: nodesOutL.length, size: edgesOutL.length, view: 'locality'},
    nodes: nodesOutL,
    edges: edgesOutL,
    clusters: clustersL,
    adjacency: adjacencyL,
  };
  ensureDirSync(path.dirname(outputLocalityPath));
  fs.writeFileSync(outputLocalityPath, JSON.stringify(outLoc));
  console.log(`Wrote ${outputLocalityPath} with ${nodesOutL.length} nodes and ${edgesOutL.length} edges (locality view)`);
}

run().catch((err) => { console.error(err); process.exit(1); });


