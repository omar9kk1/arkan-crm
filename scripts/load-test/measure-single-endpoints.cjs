const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadApiBaseUrl, loadTestPassword } = require('./config.cjs');
const BASE = loadApiBaseUrl();
const PASSWORD = loadTestPassword();
const state = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'arkan-crm-load-state.json'), 'utf8'));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Number(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(1)); };
async function req(token, pathname) { const t = performance.now(); const r = await fetch(`${BASE}${pathname}`, { headers: { Authorization: `Bearer ${token}` } }); const text = await r.text(); return { status: r.status, ms: performance.now() - t, bytes: Buffer.byteLength(text) }; }
async function login(email) { const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }); const b = await r.json(); return b.data.accessToken; }
(async () => {
  const owner = await login(state.credentials.owner);
  const manager = await login(state.credentials.managerA);
  const list = [
    ['dashboard.owner.month', owner, '/dashboard/manager?period=month'],
    ['dashboard.manager.month', manager, '/dashboard/manager?period=month'],
    ['dashboard.owner.all', owner, '/dashboard/manager?period=all'],
    ['followups.manager', manager, '/follow-ups?limit=50'],
    ['overview.manager', manager, '/follow-ups/manager/overview?limit=50'],
    ['employees.sort.clients', owner, '/employees?limit=50&sort=clientsCount'],
    ['clients', owner, '/clients?limit=50'],
    ['properties', owner, '/properties?limit=50'],
    ['notifications', owner, '/notifications?limit=20'],
  ];
  for (const [label, token, p] of list) {
    await req(token, p);
    const times = [];
    for (let i = 0; i < 5; i++) { const r = await req(token, p); if (r.status !== 200) throw new Error(label + ' ' + r.status); times.push(r.ms); }
    console.log(`${label} p50=${pct(times,50)} p95=${pct(times,95)}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
