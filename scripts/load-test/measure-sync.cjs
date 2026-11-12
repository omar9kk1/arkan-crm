/* Focused follow-up sync measurement; read-only DB, load DB only. */
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

function pct(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, i)].toFixed(1));
}

async function request(token, pathname) {
  const started = performance.now();
  const response = await fetch(`${BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  const ms = performance.now() - started;
  return { status: response.status, ms, bytes: Buffer.byteLength(text), body: text };
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
  const countBefore = await prisma.followUpSubject.count();
  const dupBefore = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS n FROM (SELECT "targetKey" FROM "FollowUpSubject" GROUP BY "targetKey" HAVING COUNT(*) > 1) d',
  );
  const stats = async () => ({
    db: await prisma.$queryRawUnsafe(
      'SELECT xact_commit::bigint AS xact, tup_returned::bigint AS returned, tup_fetched::bigint AS fetched FROM pg_stat_database WHERE datname = current_database()',
    ),
    tables: await prisma.$queryRawUnsafe(
      `SELECT relname, seq_scan::bigint, idx_scan::bigint, n_tup_ins::bigint, n_tup_upd::bigint
       FROM pg_stat_user_tables
       WHERE relname IN ('Property','Client','FollowUpSubject','PropertyAssignment','ClientPropertyInterest')
       ORDER BY relname`,
    ),
  });
  const token = await login(
    STATE.credentials[process.env.SYNC_USER || 'managerA'],
  );

  const cold = await request(token, '/follow-ups?limit=50');
  const warmTimes = [];
  for (let i = 0; i < 8; i++) {
    const r = await request(token, '/follow-ups?limit=50');
    if (r.status !== 200) throw new Error(`warm request status ${r.status}`);
    warmTimes.push(r.ms);
  }
  const beforeWarm = await stats();
  for (let i = 0; i < 8; i++) {
    await request(token, '/follow-ups?limit=50');
  }
  const afterWarm = await stats();

  const backendPid = Number(fs.readFileSync(PID_FILE, 'utf8'));
  const backendStats = () => {
    try {
      return execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `$p=Get-Process -Id ${backendPid}; '{0:N1}|{1:N0}' -f $p.CPU, $p.WorkingSet64`,
        ],
        { encoding: 'utf8' },
      ).trim();
    } catch {
      return 'unavailable';
    }
  };
  const dockerStats = () => {
    try {
      return execFileSync(
        'docker',
        [
          'stats',
          '--no-stream',
          '--format',
          '{{.CPUPerc}}|{{.MemUsage}}',
          'arkan-crm-postgres-1',
        ],
        { encoding: 'utf8' },
      ).trim();
    } catch {
      return 'unavailable';
    }
  };
  const cs = (a, b, key) => {
    const rowA = a.tables.find((r) => r.relname === key);
    const rowB = b.tables.find((r) => r.relname === key);
    return {
      seq: Number(rowB.seq_scan - rowA.seq_scan),
      idx: Number(rowB.idx_scan - rowA.idx_scan),
      ins: Number(rowB.n_tup_ins - rowA.n_tup_ins),
      upd: Number(rowB.n_tup_upd - rowA.n_tup_upd),
    };
  };
  const load = async (level) => {
    const times = [];
    const statuses = [];
    const beBefore = backendStats();
    const dbBefore = dockerStats();
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: level }, async () => {
        try {
          const r = await request(token, '/follow-ups?limit=50');
          return { ms: r.ms, status: r.status };
        } catch (error) {
          return { ms: performance.now() - started, status: 0, error: String(error) };
        }
      }),
    );
    for (const r of results) {
      times.push(r.ms);
      statuses.push(r.status);
    }
    return {
      level,
      requests: level,
      p50: pct(times, 50),
      p95: pct(times, 95),
      errorRate: Number(
        (((statuses.filter((s) => s < 200 || s >= 300).length || 0) / level) * 100).toFixed(2),
      ),
      statuses: statuses.reduce((acc, s) => {
        acc[String(s)] = (acc[String(s)] || 0) + 1;
        return acc;
      }, {}),
      wallMs: Number((performance.now() - started).toFixed(1)),
      backendBefore: beBefore,
      backendAfter: backendStats(),
      dbBefore,
      dbAfter: dockerStats(),
    };
  };

  const load10 = await load(10);
  let load50 = null;
  if (load10.errorRate <= 5 && load10.p95 < 5000) load50 = await load(50);

  const countAfter = await prisma.followUpSubject.count();
  const dupAfter = await prisma.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS n FROM (SELECT "targetKey" FROM "FollowUpSubject" GROUP BY "targetKey" HAVING COUNT(*) > 1) d',
  );
  const result = {
    stage: STATE.stage,
    db,
    cold: { status: cold.status, ms: Number(cold.ms.toFixed(1)), kb: Math.round(cold.bytes / 1024) },
    warm: { n: warmTimes.length, p50: pct(warmTimes, 50), p95: pct(warmTimes, 95) },
    load10,
    load50,
    subjects: { before: countBefore, after: countAfter },
    duplicateTargetKeys: { before: dupBefore[0]?.n ?? 0, after: dupAfter[0]?.n ?? 0 },
    warmStats: {
      xact: Number(afterWarm.db[0].xact - beforeWarm.db[0].xact),
      returned: Number(afterWarm.db[0].returned - beforeWarm.db[0].returned),
      fetched: Number(afterWarm.db[0].fetched - beforeWarm.db[0].fetched),
      Property: cs(beforeWarm, afterWarm, 'Property'),
      Client: cs(beforeWarm, afterWarm, 'Client'),
      FollowUpSubject: cs(beforeWarm, afterWarm, 'FollowUpSubject'),
      PropertyAssignment: cs(beforeWarm, afterWarm, 'PropertyAssignment'),
      ClientPropertyInterest: cs(beforeWarm, afterWarm, 'ClientPropertyInterest'),
    },
  };
  console.log(`SYNC_MEASURE=${JSON.stringify(result)}`);
  const out = path.join(os.tmpdir(), 'arkan-sync-measure.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`SYNC_RESULT_FILE=${out}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
