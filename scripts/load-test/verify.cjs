/* Functional + bounded load verification for arkan_crm_load_test only. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { loadApiBaseUrl, loadDatabaseUrl, loadTestPassword } = require('./config.cjs');

const BASE = loadApiBaseUrl();
const LOAD_DB = 'arkan_crm_load_test';
const LOAD_URL = loadDatabaseUrl();
const STATE_FILE =
  process.env.LOAD_STATE_FILE ||
  path.join(os.tmpdir(), 'arkan-crm-load-state.json');
const PASSWORD = loadTestPassword();
const STAGE = process.env.LOAD_STAGE || 'A';
const PID_FILE = path.join(os.tmpdir(), 'arkan-load-backend.pid');

const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
const results = [];
let failures = 0;

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail ?? null });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
}

function pct(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Number(sorted[Math.max(0, idx)].toFixed(1));
}

async function request(token, pathname) {
  const started = performance.now();
  const response = await fetch(`${BASE}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return {
    status: response.status,
    ms: performance.now() - started,
    bytes: Buffer.byteLength(text),
    body,
  };
}

async function login(email) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok || !body?.data?.accessToken) {
    throw new Error(`login failed for ${email}: ${response.status}`);
  }
  return body.data.accessToken;
}

async function getAll(token, pathname, limit = 100, maxPages = 1000) {
  let cursor = null;
  let pages = 0;
  const ids = [];
  const items = [];
  let first = null;
  let bytes = 0;
  do {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (cursor) params.set('cursor', cursor);
    const separator = pathname.includes('?') ? '&' : '?';
    const page = await request(token, `${pathname}${separator}${params}`);
    bytes += page.bytes;
    if (page.status !== 200) {
      throw new Error(`GET ${pathname} failed: ${page.status}`);
    }
    const data = page.body?.data;
    if (!data || !Array.isArray(data.items)) {
      throw new Error(`GET ${pathname} returned unexpected payload`);
    }
    if (!first) first = data;
    for (const item of data.items) {
      ids.push(item.id);
      items.push(item);
    }
    cursor = data.nextCursor;
    pages += 1;
    if (pages > maxPages) throw new Error(`pagination exceeded ${maxPages} pages`);
    if (cursor && data.items.length === 0) throw new Error('empty page with cursor');
  } while (cursor);
  return { ids, items, pages, first, bytes };
}

function uniqueCount(ids) {
  return new Set(ids).size;
}

async function expected() {
  const prisma = new PrismaClient({ datasources: { db: { url: LOAD_URL } } });
  const db = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  if (db[0]?.db !== LOAD_DB) throw new Error(`wrong DB ${db[0]?.db}`);
  const managerA = state.ids.managerA;
  const managerB = state.ids.managerB;
  const profile = state.ids.employee0Profile;
  const employee0 = state.ids.employee0;
  const managerClientWhere = {
    OR: [
      { createdByUserId: managerA },
      { createdBy: { managerUserId: managerA } },
      { responsibleEmployee: { managerUserId: managerA } },
    ],
  };
  const employeeClientWhere = {
    OR: [
      { createdBy: { userId: employee0 } },
      { responsibleEmployee: { userId: employee0 } },
    ],
  };
  const out = {
    employees: await prisma.user.count({ where: { role: 'EMPLOYEE' } }),
    clients: await prisma.client.count(),
    properties: await prisma.property.count({ where: { deletedAt: null } }),
    availableProperties: await prisma.property.count({
      where: { deletedAt: null, status: 'AVAILABLE' },
    }),
    managerAClients: await prisma.client.count({ where: managerClientWhere }),
    managerAEmployees: await prisma.employeeProfile.count({
      where: { managerUserId: managerA },
    }),
    managerBEmployees: await prisma.employeeProfile.count({
      where: { managerUserId: managerB },
    }),
    managerAPersonalFollowUps: await prisma.followUpSubject.count({
      where: { responsibleUserId: managerA },
    }),
    managerAOverview: await prisma.followUpSubject.count({
      where: {
        active: true,
        responsibleId: { not: null },
        responsible: { managerUserId: managerA },
      },
    }),
    employee0FollowUps: await prisma.followUpSubject.count({
      where: { responsible: { userId: employee0 } },
    }),
    employee0Clients: await prisma.client.count({ where: employeeClientWhere }),
    employee0RecommendationCandidates: await prisma.client.count({
      where: { AND: [employeeClientWhere, { requestData: { not: null } }] },
    }),
    ownerNotifications: await prisma.notification.count({
      where: { userId: state.ids.owner },
    }),
    ownerUnread: await prisma.notification.count({
      where: { userId: state.ids.owner, readAt: null },
    }),
    employee0Properties: await prisma.property.count({
      where: { createdByUserId: employee0, deletedAt: null },
    }),
    employee0Subjects: await prisma.followUpSubject.findMany({
      where: { responsibleId: profile },
      take: 1,
      select: { id: true },
    }),
    managerBTeamEmployees: await prisma.employeeProfile.findMany({
      where: { managerUserId: managerB },
      take: 1,
      select: { userId: true },
    }),
    outsiderClient: await prisma.client.findFirst({
      where: { responsibleEmployee: { managerUserId: managerB } },
      select: { id: true },
    }),
    outsiderPendingProperty: await prisma.property.findFirst({
      where: {
        deletedAt: null,
        status: 'PENDING',
        createdByUserId: { not: employee0 },
      },
      select: { id: true },
    }),
    deletedProperties: await prisma.property.count({
      where: { deletedAt: { not: null } },
    }),
  };
  await prisma.$disconnect();
  return out;
}

async function main() {
  console.log(`STAGE ${STAGE} :: ${BASE} :: ${state.db}`);
  const tokens = {
    owner: await login(state.credentials.owner),
    managerA: await login(state.credentials.managerA),
    managerB: await login(state.credentials.managerB),
    employee0: await login(state.credentials.employee0),
    ownerDirect: state.ids.ownerDirectEmail
      ? await login(state.ids.ownerDirectEmail)
      : null,
  };
  // First-page sync is part of the existing follow-up endpoint; warm it
  // before taking DB expectations so counts describe the stabilized feed.
  await request(tokens.managerA, '/follow-ups?limit=1');
  await request(tokens.managerB, '/follow-ups?limit=1');
  await request(tokens.employee0, '/follow-ups?limit=1');
  const exp = await expected();

  check('auth/me owner', (await request(tokens.owner, '/auth/me')).status === 200);
  check('auth/me manager', (await request(tokens.managerA, '/auth/me')).status === 200);
  check('auth/me employee', (await request(tokens.employee0, '/auth/me')).status === 200);
  check('auth/me without token', (await request(null, '/auth/me')).status === 401);

  // Owner: clients, search, stats, filters
  const clientsAll = await getAll(tokens.owner, '/clients');
  check('owner clients total', clientsAll.ids.length === exp.clients, `${clientsAll.ids.length}/${exp.clients}`);
  check('owner clients unique', uniqueCount(clientsAll.ids) === exp.clients);
  const clientSearch = await request(tokens.owner, `/clients?search=${encodeURIComponent(state.ids.lastClientName)}&limit=50`);
  check('client search finds last client', clientSearch.body?.data?.items?.some((item) => item.id === state.ids.lastClientId), state.ids.lastClientName);
  const stats = await request(tokens.owner, '/clients/stats');
  check('clients stats total', stats.body?.data?.totalClients === exp.clients, `${stats.body?.data?.totalClients}/${exp.clients}`);
  const late = await getAll(tokens.owner, '/clients?filter=late');
  check('late client filter non-empty', late.ids.length > 0, `${late.ids.length}`);

  // Owner: properties
  const propertiesAll = await getAll(tokens.owner, '/properties');
  check('owner properties total', propertiesAll.ids.length === exp.properties, `${propertiesAll.ids.length}/${exp.properties}`);
  check('owner properties unique', uniqueCount(propertiesAll.ids) === exp.properties);
  const propertySearch = await request(tokens.owner, `/properties?q=${encodeURIComponent(state.ids.lastPropertyReference)}&limit=50`);
  check('property search finds last property', propertySearch.body?.data?.items?.some((item) => item.id === state.ids.lastPropertyId), state.ids.lastPropertyReference);
  const available = await getAll(tokens.owner, '/properties?status=AVAILABLE');
  check('property status filter total', available.ids.length === exp.availableProperties, `${available.ids.length}/${exp.availableProperties}`);

  // Owner: employees + global sorting
  const employeesAll = await getAll(tokens.owner, '/employees');
  check('owner employees total', employeesAll.ids.length === exp.employees, `${employeesAll.ids.length}/${exp.employees}`);
  check('owner employees unique', uniqueCount(employeesAll.ids) === exp.employees);
  check('owner employees summary', employeesAll.first?.summary?.total === exp.employees, `${employeesAll.first?.summary?.total}/${exp.employees}`);
  const employeeSearch = await request(tokens.owner, `/employees?search=${encodeURIComponent(state.ids.lastEmployeeName)}&limit=50`);
  check('employee search finds last employee', employeeSearch.body?.data?.items?.some((item) => item.id === state.ids.lastEmployeeUserId), state.ids.lastEmployeeName);
  for (const sort of ['clientsCount', 'propertiesCount', 'dealsCount']) {
    const sorted = await getAll(tokens.owner, `/employees?sort=${sort}`);
    check(`employee global sort ${sort} total`, sorted.ids.length === exp.employees, `${sorted.ids.length}/${exp.employees}`);
    check(`employee global sort ${sort} unique`, uniqueCount(sorted.ids) === exp.employees);
  }
  const topClients = await request(tokens.owner, '/employees?sort=clientsCount&limit=1');
  check('employee clients sort top is heavy employee', topClients.body?.data?.items?.[0]?.id === state.ids.employee0, topClients.body?.data?.items?.[0]?.id);
  const topDeals = await request(tokens.owner, '/employees?sort=dealsCount&limit=1');
  check('employee deals sort returns a row', Boolean(topDeals.body?.data?.items?.[0]?.id));

  // Manager isolation
  const managerAEmployees = await getAll(tokens.managerA, '/employees');
  check('manager A employee count', managerAEmployees.ids.length === exp.managerAEmployees, `${managerAEmployees.ids.length}/${exp.managerAEmployees}`);
  check('manager A excludes owner-direct', !managerAEmployees.ids.includes(state.ids.ownerDirectUserId));
  const managerBEmployees = await getAll(tokens.managerB, '/employees');
  check('manager B employee count', managerBEmployees.ids.length === exp.managerBEmployees, `${managerBEmployees.ids.length}/${exp.managerBEmployees}`);
  const managerAClients = await getAll(tokens.managerA, '/clients');
  check('manager A client count', managerAClients.ids.length === exp.managerAClients, `${managerAClients.ids.length}/${exp.managerAClients}`);
  const managerADetail = await request(tokens.managerA, `/employees/${state.ids.employee0}`);
  check('manager A can read team detail', managerADetail.status === 200);
  const managerBTeamEmployee = exp.managerBTeamEmployees[0]?.userId;
  const managerAForeignDetail = await request(tokens.managerA, `/employees/${managerBTeamEmployee}`);
  check('manager A cannot read team B detail', managerAForeignDetail.status === 404);
  const managerAForeignDirect = await request(tokens.managerA, `/employees/${state.ids.ownerDirectUserId}`);
  check('manager A cannot read owner-direct detail', managerAForeignDirect.status === 404);
  check('employee cannot list employees', (await request(tokens.employee0, '/employees')).status === 403);

  // Employee property pagination + scope
  const employeeProps = await getAll(tokens.owner, `/employees/${state.ids.employee0}/properties`);
  check('employee property pagination total', employeeProps.ids.length === employeeProps.first.total, `${employeeProps.ids.length}/${employeeProps.first.total}`);
  check('employee property pagination unique', uniqueCount(employeeProps.ids) === employeeProps.ids.length);
  check('employee property count > 50', employeeProps.ids.length > 50, `${employeeProps.ids.length}`);
  check('employee own client readable', (await request(tokens.employee0, `/clients/${state.ids.heavyClientIds[0]}`)).status === 200);
  check('employee outsider client hidden', (await request(tokens.employee0, `/clients/${exp.outsiderClient.id}`)).status === 404);
  check('employee outsider pending property hidden', (await request(tokens.employee0, `/properties/${exp.outsiderPendingProperty.id}`)).status === 404);
  const employeeDetails = await request(tokens.employee0, `/clients/${state.ids.heavyClientIds[0]}`);
  check('employee client follow-up detail accessible', employeeDetails.status === 200);

  // Follow-ups
  const managerAFollowUps = await getAll(tokens.managerA, '/follow-ups');
  check('manager A personal follow-ups', managerAFollowUps.ids.length === exp.managerAPersonalFollowUps, `${managerAFollowUps.ids.length}/${exp.managerAPersonalFollowUps}`);
  const managerAOverview = await getAll(tokens.managerA, '/follow-ups/manager/overview');
  check('manager A overview count', managerAOverview.ids.length === exp.managerAOverview, `${managerAOverview.ids.length}/${exp.managerAOverview}`);
  const managerASummary = await request(tokens.managerA, '/follow-ups/manager/summary');
  check('manager A supervision summary total', managerASummary.body?.data?.total === exp.managerAOverview, `${managerASummary.body?.data?.total}/${exp.managerAOverview}`);
  const managerBFollowUps = await getAll(tokens.managerB, '/follow-ups');
  check('manager B personal follow-ups', managerBFollowUps.ids.length > 0, `${managerBFollowUps.ids.length}`);
  const employeeFollowUps = await getAll(tokens.employee0, '/follow-ups');
  check('employee follow-up count', employeeFollowUps.ids.length === exp.employee0FollowUps, `${employeeFollowUps.ids.length}/${exp.employee0FollowUps}`);
  const employeeHistory = exp.employee0Subjects[0]
    ? await request(tokens.employee0, `/follow-ups/${exp.employee0Subjects[0].id}/history`)
    : { status: 0 };
  check('employee follow-up history', employeeHistory.status === 200);
  if (managerBFollowUps.ids[0]) {
    const foreignHistory = await request(tokens.managerA, `/follow-ups/${managerBFollowUps.ids[0]}/history`);
    check('manager A cannot read team B follow-up history', foreignHistory.status === 404);
  }

  // Notifications + dashboard
  const notifications = await getAll(tokens.owner, '/notifications', 100);
  check('owner notifications total', notifications.ids.length === exp.ownerNotifications, `${notifications.ids.length}/${exp.ownerNotifications}`);
  const unread = await request(tokens.owner, '/notifications/unread-count');
  check('owner unread count', unread.body?.data?.count === exp.ownerUnread, `${unread.body?.data?.count}/${exp.ownerUnread}`);
  const dashboard = await request(tokens.owner, '/dashboard/manager?period=month');
  check('dashboard properties total', dashboard.body?.data?.properties?.total === exp.properties, `${dashboard.body?.data?.properties?.total}/${exp.properties}`);
  check('dashboard clients total', dashboard.body?.data?.clients?.total === exp.clients, `${dashboard.body?.data?.clients?.total}/${exp.clients}`);
  check('dashboard employees total', dashboard.body?.data?.employees?.total === exp.employees, `${dashboard.body?.data?.employees?.total}/${exp.employees}`);
  const dashboardAll = await request(tokens.owner, '/dashboard/manager?period=all');
  check('dashboard all period responds', dashboardAll.status === 200);

  // Recommendations beyond the first page
  const recommendations = await request(tokens.employee0, '/clients/recommendation-candidates');
  const recIds = (recommendations.body?.data?.items || []).map((item) => item.id);
  check('employee recommendations total', recIds.length === exp.employee0RecommendationCandidates, `${recIds.length}/${exp.employee0RecommendationCandidates}`);
  check('recommendations include beyond page 1', state.ids.heavyClientIds.slice(50).some((id) => recIds.includes(id)));

  // Single-user performance ------------------------------------------------
  const perf = [];
  const measure = async (label, token, pathname, iterations = 6) => {
    await request(token, pathname);
    const times = [];
    let bytes = 0;
    for (let i = 0; i < iterations; i++) {
      const r = await request(token, pathname);
      if (r.status !== 200) throw new Error(`${label} status ${r.status}`);
      times.push(r.ms);
      bytes = r.bytes;
    }
    perf.push({
      label,
      p50: pct(times, 50),
      p95: pct(times, 95),
      kb: Math.round(bytes / 1024),
    });
  };
  await measure('clients.list', tokens.owner, '/clients?limit=50');
  await measure('clients.search', tokens.owner, `/clients?search=${encodeURIComponent(state.ids.lastClientName)}&limit=50`);
  await measure('clients.stats', tokens.owner, '/clients/stats');
  await measure('clients.late', tokens.owner, '/clients?filter=late&limit=50');
  await measure('properties.list', tokens.owner, '/properties?limit=50');
  await measure('properties.search', tokens.owner, `/properties?q=${encodeURIComponent(state.ids.lastPropertyReference)}&limit=50`);
  await measure('employees.sort.clients', tokens.owner, '/employees?limit=50&sort=clientsCount');
  await measure('employees.sort.properties', tokens.owner, '/employees?limit=50&sort=propertiesCount');
  await measure('employees.sort.deals', tokens.owner, '/employees?limit=50&sort=dealsCount');
  await measure('employee.properties', tokens.owner, `/employees/${state.ids.employee0}/properties?limit=50`);
  await measure('notifications.list', tokens.owner, '/notifications?limit=20');
  await measure('notifications.unread', tokens.owner, '/notifications/unread-count');
  await measure('dashboard.month', tokens.owner, '/dashboard/manager?period=month');
  await measure('dashboard.all', tokens.owner, '/dashboard/manager?period=all');
  await measure('auth.me', tokens.owner, '/auth/me');
  await measure('manager.followups', tokens.managerA, '/follow-ups?limit=50');
  await measure('manager.overview', tokens.managerA, '/follow-ups/manager/overview?limit=50');
  await measure('manager.employees', tokens.managerA, '/employees?limit=50');
  await measure('manager.dashboard', tokens.managerA, '/dashboard/manager?period=month');
  await measure('employee.clients', tokens.employee0, '/clients?limit=50');
  await measure('employee.followups', tokens.employee0, '/follow-ups?limit=50');
  await measure('employee.recommendations', tokens.employee0, '/clients/recommendation-candidates');
  await measure('employee.notifications', tokens.employee0, '/notifications?limit=20');

  // Concurrent load ---------------------------------------------------------
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
  const dockerStats = () => {
    try {
      return execFileSync('docker', ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemUsage}}', 'arkan-crm-postgres-1'], { encoding: 'utf8' }).trim();
    } catch {
      return 'unavailable';
    }
  };
  const backendStats = () => {
    try {
      return execFileSync('powershell', ['-NoProfile', '-Command', `$p=Get-Process -Id ${backendPid}; '{0:N1}|{1:N0}' -f $p.CPU, $p.WorkingSet64`], { encoding: 'utf8' }).trim();
    } catch {
      return 'unavailable';
    }
  };
  const loadLevels = [];
  const runLoad = async (level) => {
    const perUser = 4;
    const tasks = [];
    for (let i = 0; i < level * perUser; i++) {
      const principal = tokenPool[i % tokenPool.length];
      const mix = mixes[principal.role];
      tasks.push({ token: principal.token, path: mix[i % mix.length] });
    }
    const dbBefore = dockerStats();
    const beBefore = backendStats();
    const started = performance.now();
    const outcomes = await Promise.all(
      tasks.map(async (task) => {
        try {
          const r = await request(task.token, task.path);
          return { ms: r.ms, status: r.status, path: task.path };
        } catch (error) {
          const cause = error?.cause?.code || error?.cause?.message || '';
          return {
            ms: performance.now() - started,
            status: 0,
            path: task.path,
            error: `${error?.name || 'Error'}: ${error?.message || String(error)}${cause ? ` (${cause})` : ''}`,
          };
        }
      }),
    );
    const elapsed = (performance.now() - started) / 1000;
    const times = outcomes.map((o) => o.ms);
    const errors = outcomes.filter((o) => o.status < 200 || o.status >= 300).length;
    const statusCounts = outcomes.reduce((acc, o) => {
      const key = String(o.status);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const errorSamples = outcomes
      .filter((o) => o.status < 200 || o.status >= 300)
      .slice(0, 5)
      .map((o) => ({ path: o.path, status: o.status, error: o.error ?? null }));
    const levelResult = {
      level,
      requests: outcomes.length,
      rps: Number((outcomes.length / elapsed).toFixed(2)),
      p50: pct(times, 50),
      p95: pct(times, 95),
      errorRate: Number(((errors / outcomes.length) * 100).toFixed(2)),
      statusCounts,
      errorSamples,
      dbBefore,
      dbAfter: dockerStats(),
      backendBefore: beBefore,
      backendAfter: backendStats(),
      slowest: [...outcomes]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 3)
        .map((o) => ({ path: o.path, ms: Number(o.ms.toFixed(1)), status: o.status })),
    };
    loadLevels.push(levelResult);
    console.log(`LOAD ${JSON.stringify(levelResult)}`);
    return levelResult;
  };

  const levels = (process.env.LOAD_LEVELS || '10,50,100')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  for (const level of levels) {
    const r = await runLoad(level);
    if (r.errorRate > 10 || r.p95 > 15000) {
      console.log(`STOP load escalation after level ${level}`);
      break;
    }
  }

  const summary = {
    stage: STAGE,
    db: state.db,
    counts: state.counts,
    functionalChecks: results.length,
    failures,
    performance: perf,
    loadLevels,
  };
  const outFile = path.join(os.tmpdir(), `arkan-load-result-${STAGE}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  console.log(`RESULT_FILE=${outFile}`);
  console.log(`SUMMARY=${JSON.stringify({ functionalChecks: results.length, failures, loadLevels, perf: perf.length })}`);
  if (failures) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
