#!/usr/bin/env node

// Server-side graph generator that:
// - Creates a synthetic graph (default: Erdos-Renyi) of configurable size
// - Computes Louvain communities
// - Runs ForceAtlas2 layout to compute x,y positions (precomputed off the UI thread)
// - Exports nodes, edges, clusters (meta-nodes), and an adjacency map to public/graph.json

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const {UndirectedGraph} = require('graphology');
const random = require('graphology-generators/random');
const fa2 = require('graphology-layout-forceatlas2');
const louvain = require('graphology-communities-louvain');

function parseArgs(argv) {
  const args = {};
  for (const part of argv.slice(2)) {
    const [key, val] = part.split('=');
    if (!key) continue;
    const k = key.replace(/^--/, '');
    args[k] = val === undefined ? true : val;
  }
  return args;
}

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

function generateGraph({nodes, avgDegree, seed}) {
  const probability = Math.min(0.999, Math.max(0, (avgDegree || 8) / Math.max(1, nodes - 1)));

  const graph = random.erdosRenyi(UndirectedGraph, {
    order: nodes,
    probability,
    rng: seed ? require('seedrandom')(String(seed)) : Math.random,
  });

  // Initialize random positions to help FA2 converge
  graph.forEachNode((n) => {
    graph.setNodeAttribute(n, 'x', Math.random());
    graph.setNodeAttribute(n, 'y', Math.random());
  });

  // Compute ForceAtlas2 layout server-side
  const iterations = nodes >= 15000 ? 250 : nodes >= 5000 ? 400 : 800;
  fa2.assign(graph, {
    iterations,
    settings: {
      gravity: 1.2,
      scalingRatio: 2.0,
      slowDown: 10,
      barnesHutOptimize: nodes > 2000,
      adjustSizes: true,
    },
  });

  // Compute Louvain communities
  louvain.assign(graph, {resolution: 1});

  // Compute degrees and sizes
  const nodesOut = [];
  const edgesOut = [];
  const adjacency = Object.create(null);

  graph.forEachNode((n, attrs) => {
    const degree = graph.degree(n);
    const size = Math.max(1, Math.sqrt(degree) * 1.2);
    nodesOut.push({
      id: String(n),
      label: `n${n}`,
      x: attrs.x,
      y: attrs.y,
      size,
      degree,
      community: attrs.community ?? null,
    });
    adjacency[n] = [];
  });

  graph.forEachEdge((e, attrs, src, tgt) => {
    edgesOut.push({
      id: String(e),
      source: String(src),
      target: String(tgt),
      weight: attrs.weight ?? 1,
    });
    adjacency[src].push(String(tgt));
    adjacency[tgt].push(String(src));
  });

  // Build cluster meta-nodes from Louvain communities
  const communityToNodes = new Map();
  for (const node of nodesOut) {
    const c = node.community ?? -1;
    if (!communityToNodes.has(c)) communityToNodes.set(c, []);
    communityToNodes.get(c).push(node);
  }

  const clusters = [];
  for (const [community, arr] of communityToNodes) {
    if (!arr.length) continue;
    let sx = 0;
    let sy = 0;
    let totalSize = 0;
    for (const n of arr) {
      sx += n.x;
      sy += n.y;
      totalSize += n.size;
    }
    const cx = sx / arr.length;
    const cy = sy / arr.length;
    clusters.push({
      id: `c${community}`,
      label: `Cluster ${community}`,
      x: cx,
      y: cy,
      size: Math.max(2, Math.sqrt(arr.length) * 1.8),
      community,
      count: arr.length,
    });
  }

  return {graph, nodesOut, edgesOut, adjacency, clusters};
}

function main() {
  const args = parseArgs(process.argv);
  const nodes = Number(args.nodes || args.n || 2000);
  const avgDegree = Number(args.avgDegree || args.d || 8);
  const seed = args.seed || undefined;

  console.log(`Generating graph: nodes=${nodes}, avgDegree=${avgDegree}${seed ? `, seed=${seed}` : ''}`);
  const t0 = Date.now();
  const {nodesOut, edgesOut, adjacency, clusters} = generateGraph({nodes, avgDegree, seed});

  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      order: nodesOut.length,
      size: edgesOut.length,
    },
    nodes: nodesOut,
    edges: edgesOut,
    clusters,
    adjacency,
  };

  const outDir = path.join(process.cwd(), 'public');
  ensureDirSync(outDir);
  const outPath = path.join(outDir, 'graph.json');
  fs.writeFileSync(outPath, JSON.stringify(out));
  const ms = Date.now() - t0;
  console.log(`Wrote ${outPath} in ${ms}ms`);
}

if (require.main === module) main();



