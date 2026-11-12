/* Focused Stage C concurrency/security retest. Read-only DB; load DB only. */
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
const TIMEOUT_MS = 20000;

function pct(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, i)].toFixed(1));
}

async function request(token, pathname) {
  const started = performance.now();
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    return {
      status: response.status,
      ms: performance.now() - started,
      bytes: Buffer.byteLength(text),
      body: text,
    };
  } catch (error) {
    return {
      status: 0,
      ms: performance.now() - started,
      bytes: 0,
      body: '',
      error:
        error?.name === 'TimeoutError'
          ? 'TIMEOUT'
          : `${error?.name || 'Error'}: ${error?.message || String(error)}${error?.cause?.code ? ` (${error.cause.code})` : ''}`,
    };
  }
}

async function login(email) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok || !body?.data?.accessToken) {
    throw new Error(`login failed ${response.status}`);
  }
  return body.data.accessToken;
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const db = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  if (db[0]?.db !== LOAD_DB) throw new Error(`wrong DB ${db[0]?.db}`);
  const subjectBefore = await prisma.followUpSubject.count();
  const dupBefore = Number(
    (await prisma.$queryRawUnsafe(
      'SELECT COUNT(*)::int AS n FROM (SELECT "targetKey" FROM "FollowUpSubject" GROUP BY "targetKey" HAVING COUNT(*) > 1) d',
    ))[0].n,
  );

  const tokens = {
    owner: await login(STATE.credentials.owner),
    managerA: await login(STATE.credentials.managerA),
    managerB: await login(STATE.credentials.managerB),
    employee0: await login(STATE.credentials.employee0),
  };

  const managerA = await prisma.user.findUniqueOrThrow({
    where: { email: STATE.credentials.managerA },
    select: { id: true },
  });
  const managerB = await prisma.user.findUniqueOrThrow({
    where: { email: STATE.credentials.managerB },
    select: { id: true },
  });
  const employee0 = await prisma.user.findUniqueOrThrow({
    where: { email: STATE.credentials.employee0 },
    select: { id: true, employee: { select: { id: true } } },
  });
  const teamBSubject = await prisma.followUpSubject.findFirstOrThrow({
    where: {
      responsible: { managerUserId: managerB.id },
      clientId: { not: null },
    },
    select: {
      id: true,
      client: { select: { phone: true } },
      property: { select: { contact: { select: { phone: true } } } },
    },
  });
  const teamBPropertySubject = await prisma.followUpSubject.findFirstOrThrow({
    where: {
      responsible: { managerUserId: managerB.id },
      propertyId: { not: null },
    },
    select: {
      id: true,
      property: { select: { contact: { select: { phone: true } } } },
    },
  });
  const managerBPersonal = await prisma.followUpSubject.findFirstOrThrow({
    where: { responsibleUserId: managerB.id },
    select: { id: true },
  });
  const teamASubject = await prisma.followUpSubject.findFirstOrThrow({
    where: { responsible: { managerUserId: managerA.id } },
    select: { id: true },
  });
  const employee0Subject = await prisma.followUpSubject.findFirstOrThrow({
    where: { responsibleId: employee0.employee.id },
    select: { id: true },
  });

  const history = (token, id) => request(token, `/follow-ups/${id}/history`);
  const security = {};
  security.managerA_teamB = (await history(tokens.managerA, teamBSubject.id)).status;
  security.managerA_managerBPersonal = (await history(tokens.managerA, managerBPersonal.id)).status;
  security.managerA_teamA = (await history(tokens.managerA, teamASubject.id)).status;
  security.owner_teamB = (await history(tokens.owner, teamBSubject.id)).status;
  security.owner_managerBPersonal = (await history(tokens.owner, managerBPersonal.id)).status;
  security.employee0_own = (await history(tokens.employee0, employee0Subject.id)).status;
  security.employee0_teamB = (await history(tokens.employee0, teamBSubject.id)).status;
  const unauthClient = await history(tokens.managerA, teamBSubject.id);
  const unauthProperty = await history(tokens.managerA, teamBPropertySubject.id);
  const phoneClient = teamBSubject.client?.phone || '';
  const phoneContact = teamBSubject.property?.contact?.phone || teamBPropertySubject.property.contact?.phone || '';
  security.unauthorizedLeaksClientPhone = phoneClient ? unauthClient.body.includes(phoneClient) : false;
  security.unauthorizedLeaksContactPhone = phoneContact ? unauthProperty.body.includes(phoneContact) : false;

  const cold = await request(tokens.managerA, '/follow-ups?limit=50');
  const warmTimes = [];
  for (let i = 0; i < 8; i++) {
    const r = await request(tokens.managerA, '/follow-ups?limit=50');
    if (r.status !== 200) throw new Error(`warm status ${r.status}`);
    warmTimes.push(r.ms);
  }

  const tokenPool = [
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
  const backendPid = Number(fs.readFileSync(PID_FILE, 'utf8'));
  const backendStats = () => {
    try {
      return execFileSync('powershell', ['-NoProfile', '-Command', `$p=Get-Process -Id ${backendPid}; '{0:N1}|{1:N0}' -f $p.CPU, $p.WorkingSet64`], { encoding: 'utf8' }).trim();
    } catch {
      return 'unavailable';
    }
  };
  const dockerStats = () => {
    try {
      return execFileSync('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemUsage}}', 'arkan-crm-postgres-1'], { encoding: 'utf8' }).trim();
    } catch {
      return 'unavailable';
    }
  };
  const levelResults = [];
  const runLevel = async (level) => {
    const perUser = 4;
    const tasks = [];
    for (let i = 0; i < level * perUser; i++) {
      const principal = tokenPool[i % tokenPool.length];
      const mix = mixes[principal.role];
      tasks.push({ token: principal.token, path: mix[i % mix.length] });
    }
    const beBefore = backendStats();
    const dbBefore = dockerStats();
    const ramBefore = Math.round(os.freemem() / 1024 / 1024);
    const started = performance.now();
    const outcomes = await Promise.all(
      tasks.map(async (task) => {
        const r = await request(task.token, task.path);
        return { ...r, path: task.path };
      }),
    );
    const elapsed = (performance.now() - started) / 1000;
    const times = outcomes.map((o) => o.ms);
    const errors = outcomes.filter((o) => o.status < 200 || o.status >= 300);
    const statusCounts = outcomes.reduce((acc, o) => {
      const key = String(o.status);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const errorTypes = errors.reduce((acc, o) => {
      const key = o.error?.includes('ECONNRESET')
        ? 'ECONNRESET'
        : o.error === 'TIMEOUT'
          ? 'TIMEOUT'
          : o.status
            ? `HTTP_${o.status}`
            : o.error || 'OTHER';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const result = {
      level,
      requests: outcomes.length,
      rps: Number((outcomes.length / elapsed).toFixed(2)),
      p50: pct(times, 50),
      p95: pct(times, 95),
      errorRate: Number(((errors.length / outcomes.length) * 100).toFixed(2)),
      statusCounts,
      errorTypes,
      slowest: [...outcomes]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5)
        .map((o) => ({ path: o.path, ms: Number(o.ms.toFixed(1)), status: o.status, error: o.error ?? null })),
      backendBefore: beBefore,
      backendAfter: backendStats(),
      dbBefore,
      dbAfter: dockerStats(),
      ramBeforeMB: ramBefore,
      ramAfterMB: Math.round(os.freemem() / 1024 / 1024),
    };
    levelResults.push(result);
    console.log(`LEVEL=${JSON.stringify(result)}`);
    return result;
  };

  const guards = [];
  let previous = null;
  const levels = (process.env.LOAD_LEVELS || '10,50,100')
    .split(',')
    .map(Number);
  for (const level of levels) {
    if (previous && (previous.errorRate > 10 || previous.p95 > 15000)) {
      guards.push(`skipped ${level}: previous level unhealthy`);
      break;
    }
    const result = await runLevel(level);
    previous = result;
    if (result.errorRate > 10 || result.p95 > 15000) {
      guards.push(`stopped after ${level}: errorRate=${result.errorRate} p95=${result.p95}`);
      break;
    }
    if (result.ramAfterMB < 500) {
      guards.push(`stopped after ${level}: low free RAM ${result.ramAfterMB}MB`);
      break;
    }
  }

  const subjectAfter = await prisma.followUpSubject.count();
  const dupAfter = Number(
    (await prisma.$queryRawUnsafe(
      'SELECT COUNT(*)::int AS n FROM (SELECT "targetKey" FROM "FollowUpSubject" GROUP BY "targetKey" HAVING COUNT(*) > 1) d',
    ))[0].n,
  );
  const summary = {
    stage: STATE.stage,
    db,
    counts: {
      users: await prisma.user.count(),
      employees: await prisma.employeeProfile.count(),
      clients: await prisma.client.count(),
      properties: await prisma.property.count(),
      followups: subjectAfter,
    },
    cold: { status: cold.status, ms: Number(cold.ms.toFixed(1)), kb: Math.round(cold.bytes / 1024) },
    warm: { n: warmTimes.length, p50: pct(warmTimes, 50), p95: pct(warmTimes, 95) },
    security,
    levels: levelResults,
    guards,
    integrity: {
      subjectsBefore: subjectBefore,
      subjectsAfter: subjectAfter,
      duplicateTargetKeysBefore: dupBefore,
      duplicateTargetKeysAfter: dupAfter,
    },
  };
  const out = path.join(os.tmpdir(), 'arkan-concurrency-retest.json');
  fs.writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`CONCURRENCY_RESULT_FILE=${out}`);
  console.log(`SUMMARY=${JSON.stringify({ cold: summary.cold, warm: summary.warm, security, levels: levelResults, guards, integrity: summary.integrity })}`);
  await prisma.$disconnect();
  if (Object.entries(security).some(([key, value]) => (key.includes('Leaks') ? value : key.includes('owner') ? value !== 200 : key.includes('teamA') || key.includes('own') ? value !== 200 : value !== 404))) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
