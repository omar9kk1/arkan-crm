/* Read-only: current deal.findMany + JS aggregation vs SQL aggregate on Stage C. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrismaClient, Prisma } = require('@prisma/client');
const { loadDatabaseUrl } = require('./config.cjs');

const URL = loadDatabaseUrl();
const STATE = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'arkan-crm-load-state.json'), 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
const HOUR_MS = 60 * 60 * 1000;
const KUWAIT_OFFSET_MS = 3 * HOUR_MS;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return Number(s[Math.floor(s.length / 2)].toFixed(3)); };

function periodWindow(period, now) {
  const kuwaitNow = new Date(now.getTime() + KUWAIT_OFFSET_MS);
  const year = kuwaitNow.getUTCFullYear();
  const month = kuwaitNow.getUTCMonth();
  const day = kuwaitNow.getUTCDate();
  const todayStart = new Date(Date.UTC(year, month, day) - KUWAIT_OFFSET_MS);
  if (period === 'all') return { start: null, end: null, bucket: 'month', bucketCount: 0, todayStart };
  return {
    start: new Date(Date.UTC(year, month, 1) - KUWAIT_OFFSET_MS),
    end: new Date(Date.UTC(year, month + 1, 1) - KUWAIT_OFFSET_MS),
    bucket: 'day',
    bucketCount: new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
    todayStart,
  };
}
const kuwaitDayOfMonth = (d) => new Date(d.getTime() + KUWAIT_OFFSET_MS).getUTCDate();
const kuwaitMonthIndex = (d) => { const k = new Date(d.getTime() + KUWAIT_OFFSET_MS); return k.getUTCFullYear() * 12 + k.getUTCMonth(); };
const decimalToCents = (value) => {
  const neg = value.startsWith('-');
  const [int, frac = ''] = (neg ? value.slice(1) : value).split('.');
  const cents = BigInt(int || '0') * 100n + BigInt((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
};
const centsToDecimalString = (cents) => {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const frac = (abs % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${abs / 100n}${frac ? `.${frac}` : ''}`;
};

async function measure(label, fn, iterations = 5) {
  const times = [];
  let value;
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    value = await fn();
    times.push(performance.now() - start);
  }
  console.log(`${median(times).toFixed(3)}\t${label}`);
  return value;
}

function jsAggregate(deals, window, now, period) {
  let total = 0;
  let commission = 0;
  for (const deal of deals) {
    total += Number(deal.price);
    commission += Number(deal.companyCommission);
  }
  let dailyCounts = [];
  if (window.bucket === 'month' && !window.start) {
    if (deals.length > 0) {
      const currentMonth = kuwaitMonthIndex(now);
      const indices = deals.map((d) => kuwaitMonthIndex(d.closedAt));
      const firstMonth = Math.min(...indices, currentMonth);
      const lastMonth = Math.max(...indices, currentMonth);
      dailyCounts = Array.from({ length: lastMonth - firstMonth + 1 }, () => 0);
      for (const deal of deals) {
        const index = kuwaitMonthIndex(deal.closedAt) - firstMonth;
        if (index >= 0 && index < dailyCounts.length) dailyCounts[index] += 1;
      }
    }
  } else {
    dailyCounts = Array.from({ length: window.bucketCount }, () => 0);
    for (const deal of deals) {
      const index = window.bucket === 'hour'
        ? new Date(deal.closedAt.getTime() + KUWAIT_OFFSET_MS).getUTCHours()
        : period === 'week' && window.start
          ? Math.floor((deal.closedAt.getTime() - window.start.getTime()) / (24 * HOUR_MS))
          : kuwaitDayOfMonth(deal.closedAt) - 1;
      if (index >= 0 && index < dailyCounts.length) dailyCounts[index] += 1;
    }
  }
  return { total, commission, count: deals.length, dailyCounts };
}

function sqlAggregate(managerId, start, end, bucketSql) {
  return prisma.$queryRaw(Prisma.sql`
    SELECT ${bucketSql} AS bucket,
           COUNT(*)::int AS count,
           SUM(d.price)::text AS value,
           SUM(d."companyCommission")::text AS commission
    FROM "Deal" d
    WHERE (${start}::timestamp IS NULL OR d."closedAt" >= ${start}::timestamp)
      AND (${end}::timestamp IS NULL OR d."closedAt" < ${end}::timestamp)
      AND (
        ${managerId}::uuid IS NULL
        OR d."propertyEmployeeId" IN (SELECT id FROM "EmployeeProfile" WHERE "managerUserId" = ${managerId}::uuid)
        OR d."clientEmployeeId" IN (SELECT id FROM "EmployeeProfile" WHERE "managerUserId" = ${managerId}::uuid)
      )
    GROUP BY 1
    ORDER BY 1
  `);
}

function sqlAggregateExists(managerId, start, end, bucketSql) {
  return prisma.$queryRaw(Prisma.sql`
    SELECT ${bucketSql} AS bucket,
           COUNT(*)::int AS count,
           SUM(d.price)::text AS value,
           SUM(d."companyCommission")::text AS commission
    FROM "Deal" d
    WHERE (${start}::timestamp IS NULL OR d."closedAt" >= ${start}::timestamp)
      AND (${end}::timestamp IS NULL OR d."closedAt" < ${end}::timestamp)
      AND (
        ${managerId}::uuid IS NULL
        OR EXISTS (SELECT 1 FROM "EmployeeProfile" pe WHERE pe.id = d."propertyEmployeeId" AND pe."managerUserId" = ${managerId}::uuid)
        OR EXISTS (SELECT 1 FROM "EmployeeProfile" ce WHERE ce.id = d."clientEmployeeId" AND ce."managerUserId" = ${managerId}::uuid)
      )
    GROUP BY 1
    ORDER BY 1
  `);
}

async function run(label, viewer, period) {
  const now = new Date();
  const window = periodWindow(period, now);
  const range = window.start && window.end ? { gte: window.start, lt: window.end } : null;
  const managerScoped = viewer.role === 'MANAGER';
  const where = {
    ...(range ? { closedAt: range } : {}),
    ...(managerScoped
      ? { OR: [{ propertyEmployee: { managerUserId: viewer.id } }, { clientEmployee: { managerUserId: viewer.id } }] }
      : {}),
  };
  const deals = await measure(`${label} deal.findMany`, () =>
    prisma.deal.findMany({
      where,
      select: { price: true, companyCommission: true, closedAt: true, propertyEmployeeId: true, clientEmployeeId: true },
    }));
  const js = jsAggregate(deals, window, now, period);
  await measure(`${label} JS sum+buckets`, async () => jsAggregate(deals, window, now, period));

  const bucket = window.bucket === 'hour'
    ? Prisma.sql`EXTRACT(hour FROM d."closedAt" + interval '3 hours')::int`
    : window.bucket === 'month'
      ? Prisma.sql`(EXTRACT(year FROM d."closedAt" + interval '3 hours')::int * 12 + EXTRACT(month FROM d."closedAt" + interval '3 hours')::int - 1)`
      : period === 'week'
        ? Prisma.sql`FLOOR(EXTRACT(epoch FROM (d."closedAt" - ${window.start}::timestamp)) / 86400)::int`
        : Prisma.sql`(EXTRACT(day FROM d."closedAt" + interval '3 hours')::int - 1)`;
  const managerId = managerScoped ? viewer.id : null;
  const rows = await measure(`${label} SQL aggregate IN`, () =>
    sqlAggregate(managerId, window.start, window.end, bucket));
  await measure(`${label} SQL aggregate EXISTS`, () =>
    sqlAggregateExists(managerId, window.start, window.end, bucket));

  const totalCents = rows.reduce((sum, r) => sum + decimalToCents(r.value), 0n);
  const commissionCents = rows.reduce((sum, r) => sum + decimalToCents(r.commission), 0n);
  const count = rows.reduce((sum, r) => sum + r.count, 0);
  const sql = { total: centsToDecimalString(totalCents), commission: centsToDecimalString(commissionCents), count };
  let sqlCounts;
  if (window.bucket === 'month' && !window.start) {
    if (rows.length > 0) {
      const currentMonth = kuwaitMonthIndex(now);
      const firstMonth = Math.min(Number(rows[0].bucket), currentMonth);
      const lastMonth = Math.max(Number(rows[rows.length - 1].bucket), currentMonth);
      sqlCounts = Array.from({ length: lastMonth - firstMonth + 1 }, () => 0);
      for (const row of rows) {
        const index = Number(row.bucket) - firstMonth;
        if (index >= 0 && index < sqlCounts.length) sqlCounts[index] = row.count;
      }
    } else {
      sqlCounts = [];
    }
  } else {
    sqlCounts = Array.from({ length: window.bucketCount }, () => 0);
    for (const row of rows) {
      const index = Number(row.bucket);
      if (index >= 0 && index < sqlCounts.length) sqlCounts[index] = row.count;
    }
  }
  const sameTotals = sql.count === js.count
    && Number(sql.total) === js.total
    && Number(sql.commission) === js.commission;
  const sameBuckets = JSON.stringify(sqlCounts) === JSON.stringify(js.dailyCounts);
  console.log(JSON.stringify({
    label,
    count: js.count,
    jsTotal: js.total,
    sqlTotal: sql.total,
    jsCommission: js.commission,
    sqlCommission: sql.commission,
    sameTotals,
    sameBuckets,
    sqlRows: rows.length,
    jsBucketsLength: js.dailyCounts.length,
    sqlFirstBucket: rows[0]?.bucket ?? null,
    sqlLastBucket: rows[rows.length - 1]?.bucket ?? null,
  }));
}

(async () => {
  const db = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  if (db[0]?.db !== 'arkan_crm_load_test') throw new Error('wrong DB');
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: STATE.credentials.owner }, select: { id: true } });
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: STATE.credentials.managerA }, select: { id: true } });
  await run('OWNER month', { id: owner.id, role: 'OWNER' }, 'month');
  await run('OWNER all', { id: owner.id, role: 'OWNER' }, 'all');
  await run('MANAGER A month', { id: manager.id, role: 'MANAGER' }, 'month');
  await run('MANAGER A all', { id: manager.id, role: 'MANAGER' }, 'all');
  await prisma.$disconnect();
})().catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });
