// Lists names a file imports and never uses.
//
// tsconfig has noUnusedLocals off, so tsc says nothing about them, and moving code between
// modules leaves them behind by the dozen.
//
// Usage: node scripts/dead-imports.mjs <file>

import fs from 'node:fs';

const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');

// The import block ends at the first banner comment.
const i = src.indexOf('//===========================');
if (i < 0) throw new Error('no banner found in ' + file);
const head = src.slice(0, i);
const body = src.slice(i);

const names = new Set();
for (const m of head.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
  for (let n of m[1].split(',')) {
    n = n.trim().replace(/^type\s+/, '');
    if (!n) continue;
    names.add(n.split(/\s+as\s+/).pop().trim());
  }
}
for (const m of head.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/gm)) names.add(m[1]);

const dead = [];
for (const n of names) {
  // Not a property access (obj.name), but a spread (...name) still counts as a use.
  const re = new RegExp(
    String.raw`(?<![\w$])(?<!(?<!\.)\.)` + n.replace(/[$]/g, '\\$&') + String.raw`(?![\w$])`,
  );
  if (!re.test(body)) dead.push(n);
}
dead.sort();
console.log(dead.length ? dead.join('\n') : '(no dead imports)');
