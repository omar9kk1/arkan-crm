/* Focused employee directory API measurement on arkan_crm_load_test only. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { loadApiBaseUrl, loadDatabaseUrl, loadTestPassword } = require('./config.cjs');
const PASSWORD = loadTestPassword();

const BASE = loadApiBaseUrl();
const LOAD_DB = 'arkan_crm_load_test';
const URL = loadDatabaseUrl();
const STATE = JSON.parse(
  fs.readFileSync(path.join(os.tmpdir(), 'arkan-crm-load-state.json'), 'utf8'),
);
const PID_FILE = path.join(os.tmpdir(), 'arkan-load-backend.pid');
const LABEL = process.argv[2] || 'run';

function pct(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, i)].toFixed(1));
}

async function request(token, pathname) {
  const started = performance.now();
  const response = await fetch(`${BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  }).catch((error) => ({ status: 0, error, text: async () => '' }));
  const text = await response.text();
  return {
    status: response.status ?? 0,
    ms: performance.now() - started,
    bytes: Buffer.byteLength(text),
    body: text,
  };
}

async function login(email) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok || !body?.data?.accessToken) throw new Error(`login ${response.status}`);
  return body.data.accessToken;
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const db = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  if (db[0]?.db !== LOAD_DB) throw new Error(`wrong DB ${db[0]?.db}`);
  const ownerToken = await login(STATE.credentials.owner);
  const managerToken = await login(STATE.credentials.managerA);
  const backendPid = Number(fs.readFileSync(PID_FILE, 'utf8'));
  const backendStats = () => {
    try {
      return execFileSync('powershell', ['-NoProfile', '-Command', `$p=Get-Process -Id ${backendPid}; '{0:N1}|{1:N0}' -f $p.CPU, $p.WorkingSet64`], { encoding: 'utf8' }).trim();
    } catch { return 'unavailable'; }
  };
  const dockerStats = () => {
    try {
      return execFileSync('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemUsage}}', 'arkan-crm-postgres-1'], { encoding: 'utf8' }).trim();
    } catch { return 'unavailable'; }
  };

  const measure = async (label, token, pathname, n = 6) => {
    await request(token, pathname);
    const times = [];
    let bytes = 0;
    for (let i = 0; i < n; i++) {
      const r = await request(token, pathname);
      if (r.status !== 200) throw new Error(`${label} ${r.status}`);
      times.push(r.ms);
      bytes = r.bytes;
    }
    return { label, p50: pct(times, 50), p95: pct(times, 95), kb: Math.round(bytes / 1024) };
  };

  const endpoints = [
    ['owner.list', ownerToken, '/employees?limit=50'],
    ['owner.clients', ownerToken, '/employees?limit=50&sort=clientsCount'],
    ['owner.properties', ownerToken, '/employees?limit=50&sort=propertiesCount'],
    ['owner.deals', ownerToken, '/employees?limit=50&sort=dealsCount'],
    ['owner.search', ownerToken, `/employees?search=${encodeURIComponent(stateLastEmployee())}&limit=50`],
    ['manager.list', managerToken, '/employees?limit=50'],
    ['manager.clients', managerToken, '/employees?limit=50&sort=clientsCount'],
  ];
  const perf = [];
  for (const [label, token, p] of endpoints) perf.push(await measure(label, token, p));

  const load = async (level) => {
    const paths = [
      '/employees?limit=50',
      '/employees?limit=50&sort=clientsCount',
      '/employees?limit=50&sort=propertiesCount',
      '/employees?limit=50&sort=dealsCount',
    ];
    const tokens = [ownerToken, managerToken];
    const beBefore = backendStats();
    const dbBefore = dockerStats();
    const started = performance.now();
    const outcomes = await Promise.all(
      Array.from({ length: level }, async (_, i) => {
        const r = await request(tokens[i % tokens.length], paths[i % paths.length]);
        return { ...r, path: paths[i % paths.length] };
      }),
    );
    const elapsed = (performance.now() - started) / 1000;
    const times = outcomes.map((o) => o.ms);
    const errors = outcomes.filter((o) => o.status < 200 || o.status >= 300);
    return {
      level,
      requests: outcomes.length,
      rps: Number((outcomes.length / elapsed).toFixed(2)),
      p50: pct(times, 50),
      p95: pct(times, 95),
      errorRate: Number(((errors.length / outcomes.length) * 100).toFixed(2)),
      statusCounts: outcomes.reduce((acc, o) => {
        acc[String(o.status)] = (acc[String(o.status)] || 0) + 1;
        return acc;
      }, {}),
      slowest: [...outcomes].sort((a, b) => b.ms - a.ms).slice(0, 3).map((o) => ({ path: o.path, ms: Number(o.ms.toFixed(1)), status: o.status })),
      backendBefore: beBefore,
      backendAfter: backendStats(),
      dbBefore,
      dbAfter: dockerStats(),
    };
  };

  const load10 = await load(10);
  const load50 = await load(50);
  const result = {
    label: LABEL,
    db,
    perf,
    load10,
    load50,
  };
  console.log(`EMPLOYEE_MEASURE=${JSON.stringify(result)}`);
  fs.writeFileSync(path.join(os.tmpdir(), `arkan-employee-measure-${LABEL}.json`), JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

function stateLastEmployee() {
  return STATE.ids.lastEmployeeName;
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
