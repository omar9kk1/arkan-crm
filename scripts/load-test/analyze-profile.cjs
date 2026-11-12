const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const file =
  process.argv[2] || path.join(os.tmpdir(), 'arkan-backend-profile.cpuprofile');
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = new Map();
let total = 0;
for (const n of p.nodes) {
  const h = n.hitCount || 0;
  total += h;
  if (!h) continue;
  const c = n.callFrame || {};
  const url = String(c.url || '').replace(/^file:\/\//, '');
  const key = `${c.functionName || '(anonymous)'} @ ${url}:${c.lineNumber ?? ''}`;
  rows.set(key, (rows.get(key) || 0) + h);
}
const arr = [...rows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
console.log(`TOTAL_SAMPLES=${total}`);
for (const [key, value] of arr) {
  console.log(`${value}\t${((100 * value) / total).toFixed(2)}%\t${key}`);
}
