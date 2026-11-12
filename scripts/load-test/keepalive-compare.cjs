/* One bounded keep-alive comparison at 100 simulated users. Read-only. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { loadApiBaseUrl, loadDatabaseUrl, loadTestPassword } = require('./config.cjs');
const PASSWORD = loadTestPassword();

const API_URL = new URL(loadApiBaseUrl());
const HOST = API_URL.hostname.replace(/^\[|\]$/g, '');
const PORT = Number(API_URL.port || 80);
const URL = loadDatabaseUrl();
const STATE = JSON.parse(
  fs.readFileSync(path.join(os.tmpdir(), 'arkan-crm-load-state.json'), 'utf8'),
);
const PID_FILE = path.join(os.tmpdir(), 'arkan-load-backend.pid');
const TIMEOUT = 20000;
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 128,
  maxFreeSockets: 128,
  keepAliveMsecs: 15000,
  timeout: TIMEOUT,
});
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return Number(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(1));
};

function httpRequest(token, pathname, requestAgent = agent) {
  return new Promise((resolve) => {
    const started = performance.now();
    const req = http.request(
      {
        host: HOST,
        port: PORT,
        path: pathname,
        method: 'GET',
        agent: requestAgent,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
      (res) => {
        let bytes = 0;
        res.on('data', (chunk) => { bytes += chunk.length; });
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, ms: performance.now() - started, bytes }),
        );
      },
    );
    req.setTimeout(TIMEOUT, () => req.destroy(new Error('TIMEOUT')));
    req.on('error', (error) =>
      resolve({
        status: 0,
        ms: performance.now() - started,
        bytes: 0,
        error: error.code || error.message,
      }),
    );
    req.end();
  });
}

async function login(email) {
  const response = await fetch(`http://${HOST}:${PORT}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await response.json();
  if (!body?.data?.accessToken) throw new Error('login failed');
  return body.data.accessToken;
}

(async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const db = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  if (db[0]?.db !== 'arkan_crm_load_test') throw new Error('wrong DB');
  const tokens = {
    owner: await login(STATE.credentials.owner),
    managerA: await login(STATE.credentials.managerA),
    managerB: await login(STATE.credentials.managerB),
    employee0: await login(STATE.credentials.employee0),
  };
  const pool = [
    { token: tokens.owner, role: 'owner' },
    { token: tokens.managerA, role: 'manager' },
    { token: tokens.managerB, role: 'manager' },
    { token: tokens.employee0, role: 'employee' },
  ];
  const mixes = {
    owner: ['/clients?limit=50', '/properties?limit=50', '/employees?limit=50&sort=clientsCount', '/notifications?limit=20', '/dashboard/manager?period=month'],
    manager: ['/follow-ups?limit=50', '/follow-ups/manager/overview?limit=50', '/employees?limit=50', '/clients?limit=50', '/dashboard/manager?period=month'],
    employee: ['/clients?limit=50', '/properties?limit=50', '/follow-ups?limit=50', '/notifications?limit=20', '/clients/recommendation-candidates'],
  };
  // Warm the keep-alive pool and fingerprint caches.
  for (let i = 0; i < 8; i++) await httpRequest(pool[i % pool.length].token, mixes[pool[i % pool.length].role][0]);

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

  let maxDbConnections = 0;
  let maxHealthMs = 0;
  const dbTimer = setInterval(async () => {
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()`,
      );
      maxDbConnections = Math.max(maxDbConnections, Number(rows[0].n));
    } catch {}
  }, 500);
  const healthAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 1,
    maxFreeSockets: 1,
    keepAliveMsecs: 15000,
    timeout: TIMEOUT,
  });
  const healthTimer = setInterval(async () => {
    const r = await httpRequest(null, '/health', healthAgent);
    maxHealthMs = Math.max(maxHealthMs, r.ms);
  }, 500);

  const level = Number(process.env.LOAD_LEVEL || 100);
  const tasks = Array.from({ length: level * 4 }, (_, i) => {
    const p = pool[i % pool.length];
    return { token: p.token, path: mixes[p.role][i % mixes[p.role].length] };
  });
  const beBefore = backendStats();
  const dbBefore = dockerStats();
  const started = performance.now();
  const outcomes = await Promise.all(tasks.map((t) => httpRequest(t.token, t.path)));
  const elapsed = (performance.now() - started) / 1000;
  clearInterval(dbTimer);
  clearInterval(healthTimer);
  agent.destroy();
  healthAgent.destroy();

  const times = outcomes.map((o) => o.ms);
  const errors = outcomes.filter((o) => o.status < 200 || o.status >= 300);
  const byPath = {};
  const related = tasks.map((t, i) => ({ path: t.path, ...outcomes[i] }));
  for (const item of related) {
    const bucket = (byPath[item.path] ??= { count: 0, ms: [], errors: 0 });
    bucket.count += 1;
    bucket.ms.push(item.ms);
    if (item.status < 200 || item.status >= 300) bucket.errors += 1;
  }
  const pathStats = Object.fromEntries(
    Object.entries(byPath).map(([pathname, bucket]) => [
      pathname,
      {
        count: bucket.count,
        p50: pct(bucket.ms, 50),
        p95: pct(bucket.ms, 95),
        errors: bucket.errors,
      },
    ]),
  );
  const result = {
    level,
    requests: outcomes.length,
    rps: Number((outcomes.length / elapsed).toFixed(2)),
    p50: pct(times, 50),
    p95: pct(times, 95),
    errorRate: Number(((errors.length / outcomes.length) * 100).toFixed(2)),
    statusCounts: outcomes.reduce((acc, o) => { acc[String(o.status)] = (acc[String(o.status)] || 0) + 1; return acc; }, {}),
    errorTypes: errors.reduce((acc, o) => { const k = o.error || `HTTP_${o.status}`; acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
    maxDbConnections,
    maxHealthMs: Number(maxHealthMs.toFixed(1)),
    backendBefore: beBefore,
    backendAfter: backendStats(),
    dbBefore,
    dbAfter: dockerStats(),
    freeMbBefore: Math.round(os.freemem() / (1024 * 1024)),
    freeMbAfter: Math.round(os.freemem() / (1024 * 1024)),
    byPath: pathStats,
  };
  console.log(`KEEPALIVE_COMPARE=${JSON.stringify(result)}`);
  fs.writeFileSync(path.join(os.tmpdir(), 'arkan-keepalive-compare.json'), JSON.stringify(result, null, 2));
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
