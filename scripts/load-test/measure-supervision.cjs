/* Focused supervision API measurement on arkan_crm_load_test only. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { loadApiBaseUrl, loadDatabaseUrl, loadTestPassword } = require('./config.cjs');
const PASSWORD = loadTestPassword();

const BASE = loadApiBaseUrl();
const URL = loadDatabaseUrl();
const STATE = JSON.parse(
  fs.readFileSync(path.join(os.tmpdir(), 'arkan-crm-load-state.json'), 'utf8'),
);
const PID_FILE = path.join(os.tmpdir(), 'arkan-load-backend.pid');
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return Number(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(1));
};
async function request(token, p) {
  const t = performance.now();
  try {
    const r = await fetch(`${BASE}${p}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    return { status: r.status, ms: performance.now() - t, bytes: Buffer.byteLength(text), body: text };
  } catch (e) {
    return { status: 0, ms: performance.now() - t, bytes: 0, body: '', error: e?.cause?.code || e?.name || 'error' };
  }
}
async function login(email) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const b = await r.json();
  if (!b?.data?.accessToken) throw new Error('login failed');
  return b.data.accessToken;
}
async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const db = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  if (db[0]?.db !== 'arkan_crm_load_test') throw new Error('wrong DB');
  const managerToken = await login(STATE.credentials.managerA);
  const ownerToken = await login(STATE.credentials.owner);
  const managerA = await prisma.user.findUniqueOrThrow({
    where: { email: STATE.credentials.managerA },
    select: { id: true },
  });
  const expectedSummary = await prisma.followUpSubject.count({
    where: { active: true, responsible: { managerUserId: managerA.id } },
  });
  const lastTeamEmployee = await prisma.employeeProfile.findFirstOrThrow({
    where: { managerUserId: managerA.id, followUpSubjects: { some: { active: true } } },
    orderBy: { user: { name: 'desc' } },
    select: { user: { select: { name: true, id: true } } },
  });
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
  const measure = async (label, token, p, n = 6) => {
    await request(token, p);
    const times = [];
    let bytes = 0;
    let last = null;
    for (let i = 0; i < n; i++) {
      const r = await request(token, p);
      if (r.status !== 200) throw new Error(`${label} ${r.status}`);
      times.push(r.ms);
      bytes = r.bytes;
      last = JSON.parse(r.body);
    }
    return { label, p50: pct(times, 50), p95: pct(times, 95), kb: Math.round(bytes / 1024), data: last?.data };
  };
  const overview = await measure('overview', managerToken, '/follow-ups/manager/overview?limit=50');
  const summary = await measure('summary', managerToken, '/follow-ups/manager/summary');
  const employees = await measure('employees.page1', managerToken, '/follow-ups/manager/employees?limit=100');
  const employeeSearch = await measure(
    'employees.search.last',
    managerToken,
    `/follow-ups/manager/employees?search=${encodeURIComponent(lastTeamEmployee.user.name)}&limit=100`,
  );

  let cursor = null;
  const allEmployeeIds = [];
  let employeePages = 0;
  const collectStart = performance.now();
  do {
    const r = await request(managerToken, `/follow-ups/manager/employees?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (r.status !== 200) throw new Error(`employee page ${r.status}`);
    const page = JSON.parse(r.body).data;
    allEmployeeIds.push(...page.items.map((i) => i.userId));
    cursor = page.nextCursor;
    employeePages++;
  } while (cursor);
  const collectMs = performance.now() - collectStart;

  const mix = ['/follow-ups/manager/overview?limit=50', '/follow-ups/manager/summary', '/follow-ups/manager/employees?limit=100'];
  const load = async (level) => {
    const beBefore = backendStats();
    const dbBefore = dockerStats();
    const started = performance.now();
    const outcomes = await Promise.all(
      Array.from({ length: level }, async (_, i) => {
        const pathname = mix[i % mix.length];
        return { ...(await request(managerToken, pathname)), pathname };
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
      statusCounts: outcomes.reduce((acc, o) => { acc[String(o.status)] = (acc[String(o.status)] || 0) + 1; return acc; }, {}),
      slowest: [...outcomes].sort((a, b) => b.ms - a.ms).slice(0, 3).map((o) => ({ path: o.pathname, ms: Number(o.ms.toFixed(1)), status: o.status })),
      backendBefore: beBefore,
      backendAfter: backendStats(),
      dbBefore,
      dbAfter: dockerStats(),
    };
  };
  const load10 = await load(10);
  const load50 = await load(50);

  const result = {
    summary: {
      total: expectedSummary,
      managerA: managerA.id,
      lastTeamEmployee: lastTeamEmployee.user,
    },
    overview: { p50: overview.p50, p95: overview.p95, kb: overview.kb, items: overview.data.items.length, hasSummary: 'summary' in overview.data, hasEmployees: 'employees' in overview.data },
    summaryApi: { p50: summary.p50, p95: summary.p95, kb: summary.kb, total: summary.data.total },
    employees: { p50: employees.p50, p95: employees.p95, kb: employees.kb, count: employees.data.items.length, next: Boolean(employees.data.nextCursor) },
    employeeSearch: { p50: employeeSearch.p50, p95: employeeSearch.p95, kb: employeeSearch.kb, count: employeeSearch.data.items.length, found: employeeSearch.data.items.some((i) => i.userId === lastTeamEmployee.user.id) },
    allEmployeeOptions: { pages: employeePages, count: allEmployeeIds.length, unique: new Set(allEmployeeIds).size, ms: Number(collectMs.toFixed(1)) },
    load10,
    load50,
  };
  console.log(`SUPERVISION_MEASURE=${JSON.stringify(result)}`);
  fs.writeFileSync(path.join(os.tmpdir(), 'arkan-supervision-measure.json'), JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); process.exit(1); });
