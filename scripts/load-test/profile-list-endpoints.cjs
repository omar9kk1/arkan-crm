/* Temporary: sequential query-count + latency profile for list endpoints. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadApiBaseUrl, loadTestPassword } = require('./config.cjs');
const PASSWORD = loadTestPassword();

const BASE = loadApiBaseUrl();
const STATE = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'arkan-crm-load-state.json'), 'utf8'));
const WARM = 5;
const COUNT = 50;

async function login(email) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const b = await r.json();
  if (!b.data) throw new Error('login failed ' + email);
  return b.data.accessToken;
}

async function get(token, url) {
  const start = performance.now();
  const r = await fetch(BASE + url, { headers: { Authorization: 'Bearer ' + token } });
  const text = await r.text();
  return { status: r.status, ms: performance.now() - start, bytes: Buffer.byteLength(text) };
}

const pct = (values, p) => {
  const s = [...values].sort((a, b) => a - b);
  return Number(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(1));
};

async function run(label, token, url) {
  for (let i = 0; i < WARM; i += 1) await get(token, url);
  await new Promise((r) => setTimeout(r, 2500));
  const start = Date.now();
  const results = [];
  for (let i = 0; i < COUNT; i += 1) results.push(await get(token, url));
  await new Promise((r) => setTimeout(r, 1500));
  const end = Date.now();
  const ok = results.filter((r) => r.status === 200).length;
  console.log(`RUN ${JSON.stringify({ label, url, start, end, count: COUNT, ok, firstStatus: results[0]?.status, p50: pct(results.map((r) => r.ms), 50), p95: pct(results.map((r) => r.ms), 95), bytes: results[0]?.bytes ?? 0 })}`);
}

const CASES = {
  'owner-employees-clients': ['owner', '/employees?limit=50&sort=clientsCount'],
  'manager-employees-clients': ['manager', '/employees?limit=50&sort=clientsCount'],
  'manager-employees-properties': ['manager', '/employees?limit=50&sort=propertiesCount'],
  'manager-followups': ['manager', '/follow-ups?limit=50'],
  'employee-followups': ['employee', '/follow-ups?limit=50'],
};

(async () => {
  const tokens = {
    owner: await login(STATE.credentials.owner),
    manager: await login(STATE.credentials.managerA),
    employee: await login(STATE.credentials.employee0),
  };
  const selected = (process.env.CASE || 'all').split(',');
  for (const name of Object.keys(CASES)) {
    if (!selected.includes('all') && !selected.includes(name)) continue;
    const [role, url] = CASES[name];
    await run(name, tokens[role], url);
  }
})().catch((error) => { console.error(error); process.exit(1); });
