/* Read-only per-query dashboard timing on arkan_crm_load_test. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { periodWindow } = require('../../apps/backend/dist/dashboard/dashboard.service.js');
const { clientOwnershipWhere } = require('../../apps/backend/dist/clients/client-policy.js');
const { contactOwnershipWhere } = require('../../apps/backend/dist/contacts/contact-policy.js');
const { propertyVisibilityWhere } = require('../../apps/backend/dist/properties/property-visibility.js');
const { loadDatabaseUrl } = require('./config.cjs');

const URL = loadDatabaseUrl();
const STATE = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'arkan-crm-load-state.json'), 'utf8'));
const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
const median = (a) => { const s=[...a].sort((x,y)=>x-y); return Number(s[Math.floor(s.length/2)].toFixed(2)); };

async function timed(label, fn) {
  const times = [];
  let extra = null;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    const value = await fn();
    times.push(performance.now() - start);
    if (Array.isArray(value)) extra = `${value.length} rows`;
    else if (value && typeof value === 'object' && '_count' in value) extra = `count=${value._count?._all ?? ''}`;
    else if (typeof value === 'number') extra = `count=${value}`;
  }
  const ms = median(times);
  console.log(`${ms}\t${label}${extra ? `\t${extra}` : ''}`);
  return { label, ms, extra };
}

async function profile(label, viewer) {
  const now = new Date();
  const win = periodWindow('month', now);
  const periodRange = win.start && win.end ? { gte: win.start, lt: win.end } : undefined;
  const managerScoped = viewer.role === 'MANAGER';
  const managerId = managerScoped ? viewer.id : null;
  const employeeScope = managerScoped ? { employee: { managerUserId: managerId } } : {};
  const propertyScope = propertyVisibilityWhere(viewer);
  const clientScope = clientOwnershipWhere(viewer);
  const contactScope = contactOwnershipWhere(viewer);
  console.log(`--- ${label} ---`);
  const rows = [];
  rows.push(await timed('property.groupBy(status)', () => prisma.property.groupBy({ by: ['status'], where: { ...propertyScope }, _count: { _all: true } })));
  rows.push(await timed('property.count(trash)', () => prisma.property.count({ where: { deletedAt: { not: null }, ...(managerScoped ? { OR: [{ createdByUserId: viewer.id }, { createdByUser: { employee: { managerUserId: viewer.id } } }] } : {}) } })));
  rows.push(await timed('client.count(total)', () => prisma.client.count({ where: { ...clientScope } })));
  rows.push(await timed('client.count(new)', () => prisma.client.count({ where: { ...clientScope, ...(periodRange ? { createdAt: periodRange } : {}) } })));
  rows.push(await timed('contact.count(owners)', () => prisma.contact.count({ where: { type: 'OWNER', ...contactScope } })));
  rows.push(await timed('contact.count(new owners)', () => prisma.contact.count({ where: { type: 'OWNER', ...contactScope, ...(periodRange ? { createdAt: periodRange } : {}) } })));
  rows.push(await timed('user.count(employees)', () => prisma.user.count({ where: { role: 'EMPLOYEE', ...employeeScope } })));
  rows.push(await timed('user.count(active employees)', () => prisma.user.count({ where: { role: 'EMPLOYEE', isActive: true, ...employeeScope } })));
  rows.push(await timed('followUpSubject.count(late)', () => prisma.followUpSubject.count({ where: { active: true, nextDueAt: { lt: win.todayStart }, ...(managerScoped ? { OR: [{ responsible: { managerUserId: managerId } }, { responsibleUserId: viewer.id }] } : {}) } })));
  rows.push(await timed('followUpEntry.count(completed)', () => prisma.followUpEntry.count({ where: { ...(periodRange ? { createdAt: periodRange } : {}), ...(managerScoped ? { OR: [{ author: { managerUserId: managerId } }, { authorUserId: viewer.id }] } : {}) } })));
  rows.push(await timed('notification.count(duplicates)', () => prisma.notification.count({ where: { userId: viewer.id, eventKey: { startsWith: 'DUPLICATE_ATTEMPT:' }, ...(periodRange ? { createdAt: periodRange } : {}) } })));
  rows.push(await timed('deal.findMany(period)', () => prisma.deal.findMany({ where: { ...(periodRange ? { closedAt: periodRange } : {}), ...(managerScoped ? { OR: [{ propertyEmployee: { managerUserId: managerId } }, { clientEmployee: { managerUserId: managerId } }] } : {}) }, select: { price: true, companyCommission: true, closedAt: true, propertyEmployeeId: true, clientEmployeeId: true } })));
  rows.push(await timed('user.findMany(active employees)', () => prisma.user.findMany({ where: { role: 'EMPLOYEE', isActive: true, ...employeeScope }, select: { id: true, name: true, employee: { select: { id: true } } } })));
  rows.push(await timed('client.groupBy(period/responsible)', () => prisma.client.groupBy({ by: ['responsibleEmployeeId'], where: { responsibleEmployeeId: { not: null }, ...(managerScoped ? { responsibleEmployee: { managerUserId: managerId } } : {}), ...(periodRange ? { createdAt: periodRange } : {}) }, _count: { _all: true } })));
  rows.push(await timed('property.groupBy(period/creator)', () => prisma.property.groupBy({ by: ['createdByUserId'], where: { deletedAt: null, createdByUserId: { not: null }, createdByUser: { role: 'EMPLOYEE', isActive: true, ...(managerScoped ? { employee: { managerUserId: managerId } } : {}) }, ...(periodRange ? { createdAt: periodRange } : {}) }, _count: { _all: true } })));
  rows.push(await timed('auditLog.findMany(recent)', () => prisma.auditLog.findMany({ where: { action: { in: ['PROPERTY_CREATE','PROPERTY_UPDATE','PROPERTY_APPROVE','PROPERTY_REJECT','PROPERTY_TRASH','PROPERTY_RESTORE','PROPERTY_DUPLICATE_BLOCKED','CLIENT_CREATE','CLIENT_UPDATE','CONTACT_CREATE','CONTACT_UPDATE'] }, ...(periodRange ? { createdAt: periodRange } : {}), ...(managerScoped ? { OR: [{ actor: { employee: { managerUserId: managerId } } }, { actorId: viewer.id }] } : {}) }, orderBy: { createdAt: 'desc' }, take: 3, select: { action: true, actor: { select: { name: true } } } })));
  rows.sort((a,b)=>b.ms-a.ms);
  console.log(`SEQ_SUM=${rows.reduce((s,r)=>s+r.ms,0).toFixed(2)}ms`);
  return rows;
}

(async () => {
  const db = await prisma.$queryRawUnsafe('SELECT current_database() AS db');
  if (db[0]?.db !== 'arkan_crm_load_test') throw new Error('wrong DB');
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: STATE.credentials.owner }, select: { id: true } });
  const manager = await prisma.user.findUniqueOrThrow({ where: { email: STATE.credentials.managerA }, select: { id: true } });
  await profile('OWNER month', { id: owner.id, role: 'OWNER' });
  await profile('MANAGER A month', { id: manager.id, role: 'MANAGER' });
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
