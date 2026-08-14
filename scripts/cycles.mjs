// Reports import cycles between the modules under electron/.
//
// The split of main.ts left a rule behind: a dependency that points up the stack is wired
// as a hook in main.ts, never imported. esbuild bundles a cycle without complaining, so
// nothing fails when that rule is broken -- it just becomes true that two modules cannot be
// read apart. This is how that stays visible.
//
// Usage: node scripts/cycles.mjs

import fs from 'node:fs';
import path from 'node:path';

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.ts')) files.push(f);
  }
})('electron');

const graph = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const deps = new Set();
  for (const m of src.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+['"](\.[^'"]+)['"]/gm)) {
    let t = path.normalize(path.join(path.dirname(f), m[1]));
    if (!t.endsWith('.ts')) t += '.ts';
    if (fs.existsSync(t)) deps.add(t);
  }
  graph.set(f, [...deps]);
}

const state = new Map();
const cycles = [];
function dfs(n, stack) {
  if (state.get(n) === 'done') return;
  if (state.get(n) === 'open') {
    cycles.push([...stack.slice(stack.indexOf(n)), n]);
    return;
  }
  state.set(n, 'open');
  stack.push(n);
  for (const d of graph.get(n) || []) dfs(d, stack);
  stack.pop();
  state.set(n, 'done');
}
for (const f of graph.keys()) dfs(f, []);

const norm = (p) => p.split(path.sep).join('/');
if (cycles.length === 0) console.log('no import cycles');
else for (const c of cycles) console.log('CYCLE: ' + c.map(norm).join(' -> '));
