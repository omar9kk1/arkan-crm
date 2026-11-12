/* Read-only correctness checks for the optimized employee directory. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { loadApiBaseUrl, loadDatabaseUrl, loadTestPassword } = require('./config.cjs');
const PASSWORD = loadTestPassword();

const BASE = loadApiBaseUrl();
const URL = loadDatabaseUrl();
const STATE = JSON.parse(
  fs.readFileSync(path.join(os.tmpdir(), 'arkan-crm-load-state.json'), 'utf8'),
);
const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
};

async function login(email) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await response.json();
  return body.data.accessToken;
}

async function getAll(token, query) {
  const ids = [];
  let cursor = null;
  let pages = 0;
  let first = null;
  do {
    const params = new URLSearchParams({ limit: '100', ...query });
    if (cursor) params.set('cursor', cursor);
    const response = await fetch(`${BASE}/employees?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status !== 200) throw new Error(`status ${response.status}`);
    const body = await response.json();
    const data = body.data;
    if (!first) first = data;
    for (const item of data.items) ids.push(item);
    cursor = data.nextCursor;
    pages += 1;
    if (pages > 100) throw new Error('too many pages');
  } while (cursor);
  return { ids, first, pages };
}

(async () => {
  const db = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  if (db[0]?.db !== 'arkan_crm_load_test') throw new Error('wrong DB');
  const ownerToken = await login(STATE.credentials.owner);
  const managerToken = await login(STATE.credentials.managerA);

  const ownerAll = await getAll(ownerToken, {});
  check('owner total rows', ownerAll.ids.length === 5000, `${ownerAll.ids.length}`);
  check('owner unique ids', new Set(ownerAll.ids.map((i) => i.id)).size === 5000);
  check('owner summary total', ownerAll.first.summary.total === 5000, `${ownerAll.first.summary.total}`);

  for (const sort of ['clientsCount', 'propertiesCount', 'dealsCount']) {
    const all = await getAll(ownerToken, { sort });
    check(`${sort} total`, all.ids.length === 5000, `${all.ids.length}`);
    check(`${sort} unique`, new Set(all.ids.map((i) => i.id)).size === 5000);
    if (sort === 'clientsCount') {
      check('clientsCount top employee', all.ids[0].id === STATE.ids.employee0, all.ids[0].id);
    }
  }

  const managerAll = await getAll(managerToken, {});
  const expectedTeam = await prisma.employeeProfile.count({
    where: { managerUserId: STATE.ids.managerA },
  });
  check('manager team total', managerAll.ids.length === expectedTeam, `${managerAll.ids.length}/${expectedTeam}`);
  check('manager excludes owner-direct', !managerAll.ids.some((i) => i.id === STATE.ids.ownerDirectUserId));

  const employee0 = ownerAll.ids.find((i) => i.id === STATE.ids.employee0);
  const expectedClients = await prisma.client.count({
    where: {
      OR: [
        { createdById: STATE.ids.employee0Profile },
        { responsibleEmployeeId: STATE.ids.employee0Profile },
      ],
    },
  });
  const expectedProperties = await prisma.property.count({
    where: { createdByUserId: STATE.ids.employee0 },
  });
  check('employee0 clients count', employee0.clientsCount === expectedClients, `${employee0.clientsCount}/${expectedClients}`);
  check('employee0 property count', employee0.propertyCount === expectedProperties, `${employee0.propertyCount}/${expectedProperties}`);

  const search = await fetch(
    `${BASE}/employees?search=${encodeURIComponent(STATE.ids.lastEmployeeName)}&limit=50`,
    { headers: { Authorization: `Bearer ${ownerToken}` } },
  ).then((r) => r.json());
  check('search beyond first page', search.data.items.some((i) => i.id === STATE.ids.lastEmployeeUserId));

  const managerSummary = await fetch(`${BASE}/employees?limit=1`, {
    headers: { Authorization: `Bearer ${managerToken}` },
  }).then((r) => r.json());
  check('manager summary total', managerSummary.data.summary.total === expectedTeam, `${managerSummary.data.summary.total}/${expectedTeam}`);

  // Summary correctness against the same definitions used by the service.
  const key = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${key}T00:00:00.000Z`) - 3 * 3600000);
  const expectedSummary = await prisma.$queryRawUnsafe(
    `WITH scoped AS (
       SELECT u.id, u."isActive", e.id AS profile_id
       FROM "User" u LEFT JOIN "EmployeeProfile" e ON e."userId" = u.id
       WHERE u.role = 'EMPLOYEE'
     ),
     pairs AS (
       SELECT c."createdById" AS profile_id, c.id FROM "Client" c WHERE c."createdById" IS NOT NULL
       UNION
       SELECT c."responsibleEmployeeId", c.id FROM "Client" c WHERE c."responsibleEmployeeId" IS NOT NULL
     ),
     cc AS (
       SELECT s.profile_id, COUNT(*)::int cnt FROM pairs p JOIN scoped s ON s.profile_id=p.profile_id GROUP BY s.profile_id
     ),
     lc AS (
       SELECT s.profile_id, COUNT(f.id)::int cnt FROM "FollowUpSubject" f JOIN scoped s ON s.profile_id=f."responsibleId"
       WHERE f.active AND f."nextDueAt" < $1::timestamptz GROUP BY s.profile_id
     )
     SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE s."isActive")::int active,
            COALESCE(SUM(cc.cnt),0)::int clients_total, COALESCE(SUM(lc.cnt),0)::int late_total
     FROM scoped s LEFT JOIN cc ON cc.profile_id=s.profile_id LEFT JOIN lc ON lc.profile_id=s.profile_id`,
    start,
  );
  check('summary total', ownerAll.first.summary.total === Number(expectedSummary[0].total));
  check('summary active', ownerAll.first.summary.active === Number(expectedSummary[0].active), `${ownerAll.first.summary.active}/${expectedSummary[0].active}`);
  check('summary clientsTotal', ownerAll.first.summary.clientsTotal === Number(expectedSummary[0].clients_total), `${ownerAll.first.summary.clientsTotal}/${expectedSummary[0].clients_total}`);
  check('summary lateTotal', ownerAll.first.summary.lateTotal === Number(expectedSummary[0].late_total), `${ownerAll.first.summary.lateTotal}/${expectedSummary[0].late_total}`);

  await prisma.$disconnect();
  console.log(`FAILURES=${failures}`);
  if (failures) process.exitCode = 1;
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
