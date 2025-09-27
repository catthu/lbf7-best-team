#!/usr/bin/env node
/*
Usage:
  node scripts/filter-alldbs-none.js --input /absolute/path/to/file.tsv [--select COLUMN_NAME] [--output /path/out.txt] [--unique]

Behavior:
- Streams a TSV with a header row
- Filters rows where the `allDBs` column equals "none" (case-insensitive, trimmed)
- If --select is provided, prints only that column values (optionally unique with --unique)
- Otherwise, prints full filtered rows including header
*/

const fs = require('fs');
const path = require('path');
const readline = require('readline');

function parseArgs(argv) {
  const args = {};
  const parts = argv.slice(2);
  for (let i = 0; i < parts.length; i++) {
    const token = parts[i];
    if (!token.startsWith('--')) continue;
    const raw = token.replace(/^--/, '');
    if (raw.includes('=')) {
      const idx = raw.indexOf('=');
      const k = raw.slice(0, idx);
      const v = raw.slice(idx + 1);
      args[k] = v;
    } else {
      const k = raw;
      const next = parts[i + 1];
      if (next && !next.startsWith('-')) {
        args[k] = next;
        i += 1;
      } else {
        args[k] = true;
      }
    }
  }
  return args;
}

async function run() {
  const args = parseArgs(process.argv);
  const input = args.input || args.i;
  if (!input) {
    console.error('Missing --input /path/to/file.tsv');
    process.exit(1);
  }
  const inputPath = path.resolve(String(input));
  if (!fs.existsSync(inputPath)) {
    console.error(`Input not found: ${inputPath}`);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath),
    crlfDelay: Infinity,
  });

  let header = null;
  let colIndex = -1; // allDBs
  let selectIndex = -1;
  const outLines = [];
  const select = args.select || args.s;
  const wantUnique = !!args.unique;
  const seen = new Set();

  for await (const line of rl) {
    if (header === null) {
      header = line.split('\t');
      colIndex = header.findIndex((h) => h.trim().toLowerCase() === 'alldbs');
      if (colIndex === -1) {
        console.error('Could not find `allDBs` column in header. Columns are:', header.join(', '));
        process.exit(1);
      }
      if (select) {
        selectIndex = header.findIndex((h) => h.trim() === select);
        if (selectIndex === -1) {
          console.error(`--select column not found: ${select}. Columns are:`, header.join(', '));
          process.exit(1);
        }
      }
      if (!select) outLines.push(line); // keep header for full-row output
      continue;
    }

    if (!line) continue;
    const parts = line.split('\t');
    const v = (parts[colIndex] || '').trim().toLowerCase();
    if (v === 'none') {
      if (select) {
        const val = parts[selectIndex] ?? '';
        if (wantUnique) {
          if (!seen.has(val)) { seen.add(val); outLines.push(val); }
        } else {
          outLines.push(val);
        }
      } else {
        outLines.push(line);
      }
    }
  }

  const output = args.output || args.o;
  const content = outLines.join('\n');
  if (output) {
    const outPath = path.resolve(String(output));
    fs.writeFileSync(outPath, content);
    console.log(`Wrote ${outLines.length} line(s) to ${outPath}`);
  } else {
    process.stdout.write(content + (content.endsWith('\n') ? '' : '\n'));
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});


