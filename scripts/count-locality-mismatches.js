#!/usr/bin/env node
/*
Scan a TSV for interactions whose locality sets do not overlap.

Usage:
  node scripts/count-locality-mismatches.js \
    --input /absolute/path/to/file.tsv \
    --protein1 protein1 --protein2 protein2 \
    --locality1 locality1 --locality2 locality2 \
    --output ./scripts/reports/no_overlap.tsv

Notes:
  - Column names are matched loosely: case-insensitive, non-alphanumerics removed.
  - Locality fields are split on commas/semicolons/pipes.
  - Reports multiple counts:
      * noOverlap_any: no shared locality (regardless of set sizes)
      * noOverlap_bothMulti: both sides have ≥2 localities and no overlap
      * noOverlap_oneMulti: exactly one side has ≥2 localities and no overlap
      * noOverlap_bothSingle: both singletons and different
*/

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function parseArgs(argv) {
  const args = {};
  const parts = argv.slice(2);
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i];
    if (!tok.startsWith('--')) continue;
    const raw = tok.slice(2);
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

function normalizeHeader(s) {
  return String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitLocs(s) {
  if (s == null) return [];
  return String(s)
    .split(/[,;|]/g)
    .map(x => x.trim())
    .filter(Boolean);
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
  const protein1Col = String(args.protein1 || 'protein1');
  const protein2Col = String(args.protein2 || 'protein2');
  const locality1Col = String(args.locality1 || 'locality1');
  const locality2Col = String(args.locality2 || 'locality2');
  const outputPath = path.resolve(String(args.output || path.join(process.cwd(), 'scripts', 'reports', 'no_overlap.tsv')));

  ensureDirSync(path.dirname(outputPath));

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath),
    crlfDelay: Infinity,
  });

  let header = null;
  let idxP1 = -1, idxP2 = -1, idxL1 = -1, idxL2 = -1;
  let totalRows = 0;
  let noOverlap_any = 0;
  let noOverlap_bothMulti = 0;
  let noOverlap_oneMulti = 0;
  let noOverlap_bothSingle = 0;

  const out = fs.createWriteStream(outputPath);
  out.write(['protein1','protein2','locs1','locs2','sizes','category'].join('\t') + '\n');

  const wantP1 = normalizeHeader(protein1Col);
  const wantP2 = normalizeHeader(protein2Col);
  const wantL1 = normalizeHeader(locality1Col);
  const wantL2 = normalizeHeader(locality2Col);

  for await (const line of rl) {
    if (line == null || line === '') continue;
    if (line.startsWith('#')) continue;
    if (header === null) {
      header = line.split('\t');
      const norm = header.map(normalizeHeader);
      idxP1 = norm.findIndex(h => h === wantP1 || h.includes(wantP1));
      idxP2 = norm.findIndex(h => h === wantP2 || h.includes(wantP2));
      idxL1 = norm.findIndex(h => h === wantL1 || h.includes(wantL1));
      idxL2 = norm.findIndex(h => h === wantL2 || h.includes(wantL2));
      const missing = [];
      if (idxP1 < 0) missing.push(protein1Col);
      if (idxP2 < 0) missing.push(protein2Col);
      if (idxL1 < 0) missing.push(locality1Col);
      if (idxL2 < 0) missing.push(locality2Col);
      if (missing.length) {
        console.error('Could not find required columns:', missing.join(', '));
        process.exit(1);
      }
      continue;
    }

    const parts = line.split('\t');
    const p1 = (parts[idxP1] || '').trim();
    const p2 = (parts[idxP2] || '').trim();
    if (!p1 || !p2) continue;
    totalRows++;
    const l1 = splitLocs(parts[idxL1] || '');
    const l2 = splitLocs(parts[idxL2] || '');
    if (!l1.length && !l2.length) continue;
    const set2 = new Set(l2.map(x => x.toLowerCase()));
    let hasOverlap = false;
    for (const x of l1) { if (set2.has(x.toLowerCase())) { hasOverlap = true; break; } }
    if (hasOverlap) continue;

    // No overlap
    noOverlap_any++;
    const s1 = l1.length;
    const s2 = l2.length;
    let category = '';
    if (s1 >= 2 && s2 >= 2) { noOverlap_bothMulti++; category = 'bothMulti'; }
    else if ((s1 >= 2) !== (s2 >= 2)) { noOverlap_oneMulti++; category = 'oneMulti'; }
    else { noOverlap_bothSingle++; category = 'bothSingle'; }
    out.write([p1, p2, l1.join(','), l2.join(','), `${s1}|${s2}`, category].join('\t') + '\n');
  }

  out.end();
  await new Promise(r => out.on('close', r));

  const summary = {
    input: inputPath,
    output: outputPath,
    totalRows,
    noOverlap_any,
    noOverlap_bothMulti,
    noOverlap_oneMulti,
    noOverlap_bothSingle,
  };
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((err) => { console.error(err); process.exit(1); });




