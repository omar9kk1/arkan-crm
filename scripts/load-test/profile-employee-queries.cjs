/* Read-only EXPLAIN/timing comparison for employee directory SQL. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { loadDatabaseUrl } = require('./config.cjs');

const URL = loadDatabaseUrl();
const STATE = JSON.parse(
  fs.readFileSync(path.join(os.tmpdir(), 'arkan-crm-load-state.json'), 'utf8'),
);
const prisma = new PrismaClient({ datasources: { db: { url: URL } } });

function planSummary(rows) {
  const plan = rows[0]['QUERY PLAN'][0];
  const root = plan.Plan;
  const nodes = [];
  const walk = (node, depth = 0) => {
    nodes.push(
      `${'  '.repeat(depth)}${node['Node Type']}${node['Relation Name'] ? ` on ${node['Relation Name']}` : ''}${node['Index Name'] ? ` using ${node['Index Name']}` : ''} rows=${node['Actual Rows']} time=${node['Actual Total Time']}ms`,
    );
    for (const child of node.Plans || []) walk(child, depth + 1);
  };
  walk(root);
  return {
    executionMs: plan['Execution Time'],
    planningMs: plan['Planning Time'],
    nodes,
  };
}

async function explain(label, sql, params) {
  const rows = await prisma.$queryRawUnsafe(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    ...params,
  );
  const summary = planSummary(rows);
  console.log(`PLAN ${label} ${JSON.stringify(summary)}`);
}

async function time(label, sql, params, n = 5) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const started = performance.now();
    await prisma.$queryRawUnsafe(sql, ...params);
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  console.log(`TIME ${label} ${JSON.stringify({ medianMs: Number(times[Math.floor(n / 2)].toFixed(1)), minMs: Number(times[0].toFixed(1)), maxMs: Number(times[n - 1].toFixed(1)) })}`);
}

const oldClients = `
WITH counted AS (
  SELECT u.id,
         (SELECT COUNT(DISTINCT c.id)::int FROM "Client" c WHERE c."createdById" = e.id OR c."responsibleEmployeeId" = e.id) AS metric
  FROM "User" u
  LEFT JOIN "EmployeeProfile" e ON e."userId" = u.id
  WHERE u.role = 'EMPLOYEE'
    AND ($1::uuid IS NULL OR e."managerUserId" = $1::uuid)
)
SELECT id, metric FROM counted ORDER BY metric DESC, id ASC LIMIT 51`;

const oldProperties = `
WITH counted AS (
  SELECT u.id,
         (SELECT COUNT(*)::int FROM "Property" p WHERE p."createdByUserId" = u.id) AS metric
  FROM "User" u
  LEFT JOIN "EmployeeProfile" e ON e."userId" = u.id
  WHERE u.role = 'EMPLOYEE'
    AND ($1::uuid IS NULL OR e."managerUserId" = $1::uuid)
)
SELECT id, metric FROM counted ORDER BY metric DESC, id ASC LIMIT 51`;

const oldDeals = `
WITH counted AS (
  SELECT u.id,
         (SELECT COUNT(DISTINCT d.id)::int FROM "Deal" d WHERE d."propertyEmployeeId" = e.id OR d."clientEmployeeId" = e.id) AS metric
  FROM "User" u
  LEFT JOIN "EmployeeProfile" e ON e."userId" = u.id
  WHERE u.role = 'EMPLOYEE'
    AND ($1::uuid IS NULL OR e."managerUserId" = $1::uuid)
)
SELECT id, metric FROM counted ORDER BY metric DESC, id ASC LIMIT 51`;

const scoped = `
  scoped AS (
    SELECT u.id, u."isActive", e.id AS profile_id
    FROM "User" u
    LEFT JOIN "EmployeeProfile" e ON e."userId" = u.id
    WHERE u.role = 'EMPLOYEE'
      AND ($1::uuid IS NULL OR e."managerUserId" = $1::uuid)
  )`;

const clientPairs = `
  client_pairs AS (
    SELECT c."createdById" AS profile_id, c.id
    FROM "Client" c WHERE c."createdById" IS NOT NULL
    UNION
    SELECT c."responsibleEmployeeId", c.id
    FROM "Client" c WHERE c."responsibleEmployeeId" IS NOT NULL
  )`;

const newClients = `
WITH ${scoped}, ${clientPairs},
client_counts AS (
  SELECT s.profile_id, COUNT(*)::int AS metric
  FROM client_pairs cp
  JOIN scoped s ON s.profile_id = cp.profile_id
  GROUP BY s.profile_id
),
counted AS (
  SELECT s.id, COALESCE(cc.metric, 0)::int AS metric
  FROM scoped s LEFT JOIN client_counts cc ON cc.profile_id = s.profile_id
)
SELECT id, metric FROM counted ORDER BY metric DESC, id ASC LIMIT 51`;

const newProperties = `
WITH ${scoped},
property_counts AS (
  SELECT s.id AS user_id, COUNT(p.id)::int AS metric
  FROM scoped s
  JOIN "Property" p ON p."createdByUserId" = s.id
  GROUP BY s.id
),
counted AS (
  SELECT s.id, COALESCE(pc.metric, 0)::int AS metric
  FROM scoped s LEFT JOIN property_counts pc ON pc.user_id = s.id
)
SELECT id, metric FROM counted ORDER BY metric DESC, id ASC LIMIT 51`;

const dealPairs = `
  deal_pairs AS (
    SELECT d."propertyEmployeeId" AS profile_id, d.id
    FROM "Deal" d WHERE d."propertyEmployeeId" IS NOT NULL
    UNION
    SELECT d."clientEmployeeId", d.id
    FROM "Deal" d WHERE d."clientEmployeeId" IS NOT NULL
  )`;

const newDeals = `
WITH ${scoped}, ${dealPairs},
deal_counts AS (
  SELECT s.profile_id, COUNT(*)::int AS metric
  FROM deal_pairs dp
  JOIN scoped s ON s.profile_id = dp.profile_id
  GROUP BY s.profile_id
),
counted AS (
  SELECT s.id, COALESCE(dc.metric, 0)::int AS metric
  FROM scoped s LEFT JOIN deal_counts dc ON dc.profile_id = s.profile_id
)
SELECT id, metric FROM counted ORDER BY metric DESC, id ASC LIMIT 51`;

const newSummary = `
WITH ${scoped}, ${clientPairs},
client_counts AS (
  SELECT s.profile_id, COUNT(*)::int AS cnt
  FROM client_pairs cp
  JOIN scoped s ON s.profile_id = cp.profile_id
  GROUP BY s.profile_id
),
late_counts AS (
  SELECT s.profile_id, COUNT(f.id)::int AS cnt
  FROM "FollowUpSubject" f
  JOIN scoped s ON s.profile_id = f."responsibleId"
  WHERE f.active AND f."nextDueAt" < $2::timestamptz
  GROUP BY s.profile_id
)
SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE s."isActive")::int AS active,
       COALESCE(SUM(cc.cnt), 0)::int AS clients_total,
       COALESCE(SUM(lc.cnt), 0)::int AS late_total
FROM scoped s
LEFT JOIN client_counts cc ON cc.profile_id = s.profile_id
LEFT JOIN late_counts lc ON lc.profile_id = s.profile_id`;

async function oldSummaryTiming(managerId) {
  const users = await prisma.user.findMany({
    where: { role: 'EMPLOYEE', ...(managerId ? { employee: { managerUserId: managerId } } : {}) },
    select: { id: true, isActive: true },
  });
  const userIds = users.map((u) => u.id);
  const profiles = await prisma.employeeProfile.findMany({
    where: { userId: { in: userIds } },
    select: { id: true },
  });
  const profileIds = profiles.map((p) => p.id);
  const now = new Date();
  const key = new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${key}T00:00:00.000Z`) - 3 * 3600000);
  const measure = async (label, fn) => {
    const times = [];
    for (let i = 0; i < 3; i++) {
      const s = performance.now();
      await fn();
      times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    console.log(`TIME ${label} ${JSON.stringify({ medianMs: Number(times[1].toFixed(1)) })}`);
  };
  await measure('old.summary.users', () => prisma.user.findMany({ where: { role: 'EMPLOYEE', ...(managerId ? { employee: { managerUserId: managerId } } : {}) }, select: { id: true, isActive: true } }));
  await measure('old.summary.profiles', () => prisma.employeeProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } }));
  await measure('old.summary.clients', () => prisma.$queryRawUnsafe(
    `SELECT p."userId", COUNT(DISTINCT c.id)::bigint FROM "EmployeeProfile" p JOIN "Client" c ON c."createdById" = p.id OR c."responsibleEmployeeId" = p.id WHERE p."userId" = ANY($1::uuid[]) GROUP BY p."userId"`,
    userIds,
  ));
  await measure('old.summary.late', () => prisma.followUpSubject.groupBy({
    by: ['responsibleId'],
    where: { responsibleId: { in: profileIds }, active: true, nextDueAt: { lt: start } },
    _count: { _all: true },
  }));
}

(async () => {
  const db = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  if (db[0]?.db !== 'arkan_crm_load_test') throw new Error('wrong DB');
  const managerA = await prisma.user.findUniqueOrThrow({
    where: { email: STATE.credentials.managerA },
    select: { id: true },
  });
  const start = new Date(new Date().setUTCHours(0, 0, 0, 0));
  for (const [label, sql] of [
    ['old.clients.owner', oldClients],
    ['old.properties.owner', oldProperties],
    ['old.deals.owner', oldDeals],
    ['new.clients.owner', newClients],
    ['new.properties.owner', newProperties],
    ['new.deals.owner', newDeals],
  ]) {
    await explain(label, sql, [null]);
    await time(label, sql, [null], 5);
  }
  await explain('new.clients.managerA', newClients, [managerA.id]);
  await time('new.clients.managerA', newClients, [managerA.id], 5);
  await explain('new.summary.owner', newSummary, [null, start]);
  await time('new.summary.owner', newSummary, [null, start], 5);
  await explain('new.summary.managerA', newSummary, [managerA.id, start]);
  await time('new.summary.managerA', newSummary, [managerA.id, start], 5);
  await oldSummaryTiming(null);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
