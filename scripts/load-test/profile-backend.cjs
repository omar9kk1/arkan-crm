/* One bounded 100-user keep-alive profile via Node Inspector. Read-only. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { loadApiBaseUrl, loadTestPassword } = require('./config.cjs');
const PASSWORD = loadTestPassword();

const API_URL = new URL(loadApiBaseUrl());
const HOST = API_URL.hostname.replace(/^\[|\]$/g, '');
const PORT = Number(API_URL.port || 80);
const INSPECT = 9229;
const STATE = JSON.parse(
  fs.readFileSync(path.join(os.tmpdir(), 'arkan-crm-load-state.json'), 'utf8'),
);
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
        res.on('data', (c) => { bytes += c.length; });
        res.on('end', () => resolve({ status: res.statusCode || 0, ms: performance.now() - started, bytes }));
      },
    );
    req.setTimeout(TIMEOUT, () => req.destroy(new Error('TIMEOUT')));
    req.on('error', (e) => resolve({ status: 0, ms: performance.now() - started, bytes: 0, error: e.code || e.message }));
    req.end();
  });
}

async function login(email) {
  const r = await fetch(`http://${HOST}:${PORT}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const b = await r.json();
  if (!b?.data?.accessToken) throw new Error('login failed');
  return b.data.accessToken;
}

async function connectInspector() {
  const targets = await fetch(`http://${HOST}:${INSPECT}/json`).then((r) => r.json());
  const target = targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('no inspector target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { ws, send };
}

async function main() {
  const inspector = await connectInspector();
  await inspector.send('Runtime.enable');
  await inspector.send('Profiler.enable');
  const monitor = await inspector.send('Runtime.evaluate', {
    expression: `(() => {
      const { monitorEventLoopDelay } = process.getBuiltinModule('node:perf_hooks');
      globalThis.__eld = monitorEventLoopDelay({ resolution: 20 });
      globalThis.__eld.enable();
      return 'ok';
    })()`,
    returnByValue: true,
  });
  if (monitor.exceptionDetails) throw new Error('event-loop monitor failed');
  await inspector.send('Profiler.start');

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
  for (let i = 0; i < 8; i++) await httpRequest(pool[i % pool.length].token, mixes[pool[i % pool.length].role][0]);

  let maxHealth = 0;
  const healthAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 1,
    maxFreeSockets: 1,
    keepAliveMsecs: 15000,
    timeout: TIMEOUT,
  });
  const healthTimer = setInterval(async () => {
    const r = await httpRequest(null, '/health', healthAgent);
    maxHealth = Math.max(maxHealth, r.ms);
  }, 500);

  const level = Number(process.env.PROFILE_LEVEL || 100);
  const tasks = Array.from({ length: level * 4 }, (_, i) => {
    const p = pool[i % pool.length];
    return { token: p.token, path: mixes[p.role][i % mixes[p.role].length] };
  });
  const started = performance.now();
  const outcomes = await Promise.all(tasks.map((t) => httpRequest(t.token, t.path)));
  const elapsed = (performance.now() - started) / 1000;
  clearInterval(healthTimer);
  agent.destroy();
  healthAgent.destroy();

  const profile = await inspector.send('Profiler.stop');
  const profileFile = path.join(os.tmpdir(), 'arkan-backend-profile.cpuprofile');
  fs.writeFileSync(profileFile, JSON.stringify(profile.profile));

  const delayResult = await inspector.send('Runtime.evaluate', {
    expression: `(() => {
      const h = globalThis.__eld;
      h.disable();
      return JSON.stringify({
        min: h.min, max: h.max, mean: h.mean, stddev: h.stddev,
        p50: h.percentile(50), p95: h.percentile(95), p99: h.percentile(99)
      });
    })()`,
    returnByValue: true,
  });
  const delay = JSON.parse(delayResult.result.value);
  const times = outcomes.map((o) => o.ms);
  const errors = outcomes.filter((o) => o.status < 200 || o.status >= 300);
  const result = {
    level,
    requests: outcomes.length,
    rps: Number((outcomes.length / elapsed).toFixed(2)),
    p50: pct(times, 50),
    p95: pct(times, 95),
    errorRate: Number(((errors.length / outcomes.length) * 100).toFixed(2)),
    statusCounts: outcomes.reduce((acc, o) => { acc[String(o.status)] = (acc[String(o.status)] || 0) + 1; return acc; }, {}),
    maxHealthMs: Number(maxHealth.toFixed(1)),
    eventLoopDelayMs: Object.fromEntries(
      Object.entries(delay).map(([key, value]) => [key, Number((value / 1e6).toFixed(1))]),
    ),
    profileFile,
  };
  console.log(`PROFILE_RESULT=${JSON.stringify(result)}`);
  fs.writeFileSync(path.join(os.tmpdir(), 'arkan-profile-result.json'), JSON.stringify(result, null, 2));
  inspector.ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
