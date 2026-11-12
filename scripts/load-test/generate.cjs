/* Arkan CRM load-test data generator. Local disposable DB only. */
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../../apps/backend/dist/auth/password.js');
const { loadDatabaseUrl, loadTestPassword } = require('./config.cjs');

const LOAD_DB = 'arkan_crm_load_test';
const STAGE = (process.argv[2] || 'A').toUpperCase();
const LOAD_URL = loadDatabaseUrl();
const STATE_FILE =
  process.env.LOAD_STATE_FILE ||
  path.join(os.tmpdir(), 'arkan-crm-load-state.json');
const PASSWORD = loadTestPassword();

const PROFILES = {
  A: {
    employees: 1050,
    managers: 6,
    clients: 700,
    properties: 700,
    contacts: 300,
    followUps: 900,
    subjects: 900,
    notifications: 300,
    approvals: 150,
    assignments: 150,
    deals: 50,
    auditLogs: 300,
    heavyClients: 120,
    heavyProperties: 80,
  },
  B: {
    employees: 2500,
    managers: 12,
    clients: 2500,
    properties: 2500,
    contacts: 1000,
    followUps: 3500,
    subjects: 3500,
    notifications: 1000,
    approvals: 500,
    assignments: 500,
    deals: 300,
    auditLogs: 1000,
    heavyClients: 220,
    heavyProperties: 140,
  },
  C: {
    employees: 5000,
    managers: 20,
    clients: 15000,
    properties: 15000,
    contacts: 5000,
    followUps: 20000,
    subjects: 20000,
    notifications: 8000,
    approvals: 3000,
    assignments: 3000,
    deals: 5000,
    auditLogs: 5000,
    heavyClients: 350,
    heavyProperties: 220,
  },
};

const cfg = PROFILES[STAGE];
if (!cfg) {
  console.error(`Unknown stage ${STAGE}; use A, B or C`);
  process.exit(2);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(STAGE === 'A' ? 101 : STAGE === 'B' ? 202 : 303);
const pick = (items) => items[Math.floor(rand() * items.length)];
const days = (n) => new Date(now - n * 86400000);
const now = Date.now();
const passwordHashPromise = hashPassword(PASSWORD);

function chunks(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

async function insertMany(prisma, model, rows, size = 1500) {
  for (const chunk of chunks(rows, size)) {
    await prisma[model].createMany({ data: chunk });
  }
}

function parseDb(url) {
  const parsed = new URL(url);
  return parsed.pathname.replace(/^\//, '');
}

async function assertLoadDb(prisma) {
  const db = parseDb(LOAD_URL);
  if (db !== LOAD_DB) {
    throw new Error(`Refusing to touch database "${db}" (expected ${LOAD_DB})`);
  }
  const rows = await prisma.$queryRawUnsafe(
    'SELECT current_database() AS db',
  );
  if (!rows[0] || rows[0].db !== LOAD_DB) {
    throw new Error(`Connected DB is "${rows[0]?.db}" (expected ${LOAD_DB})`);
  }
  return db;
}

async function truncate(prisma) {
  await assertLoadDb(prisma);
  const rows = await prisma.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (!rows.length) return;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${rows
      .map((r) => `"public"."${r.tablename}"`)
      .join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: LOAD_URL } } });
  let db;
  try {
    db = await assertLoadDb(prisma);
    await truncate(prisma);
    const passwordHash = await passwordHashPromise;
    const started = Date.now();
    const counts = {};
    const log = (name, n) => {
      counts[name] = n;
      console.log(
        `[${STAGE}] ${name}: ${n} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
      );
    };

    // Accounts -------------------------------------------------------------
    const owner = {
      id: randomUUID(),
      email: 'load.owner@example.test',
      name: 'Load Owner',
      role: 'OWNER',
      passwordHash,
      createdAt: days(730),
      updatedAt: days(730),
    };
    const managers = Array.from({ length: cfg.managers }, (_, i) => ({
      id: randomUUID(),
      email: `load.manager.${String(i + 1).padStart(2, '0')}@example.test`,
      name: `Load Manager ${String(i + 1).padStart(2, '0')}`,
      role: 'MANAGER',
      passwordHash,
      createdAt: days(700 - i),
      updatedAt: days(700 - i),
    }));
    await prisma.user.createMany({ data: [owner, ...managers] });
    await prisma.managerCapability.createMany({
      data: managers.flatMap((m) => [
        {
          id: randomUUID(),
          managerUserId: m.id,
          capability: 'PROPERTY_APPROVE',
          granted: true,
        },
        {
          id: randomUUID(),
          managerUserId: m.id,
          capability: 'PROPERTY_REJECT',
          granted: true,
        },
      ]),
    });

    const employees = Array.from({ length: cfg.employees }, (_, i) => {
      const team = i < Math.floor(cfg.employees * 0.55)
        ? 0
        : i < Math.floor(cfg.employees * 0.8)
          ? 1
          : i < Math.floor(cfg.employees * 0.95)
            ? 2 + (i % Math.max(1, cfg.managers - 2))
            : -1;
      const managerUserId =
        team < 0 ? null : managers[team % managers.length]?.id ?? null;
      return {
        id: randomUUID(),
        email: `load.employee.${String(i + 1).padStart(5, '0')}@example.test`,
        name: `Load Employee ${String(i + 1).padStart(5, '0')}`,
        role: 'EMPLOYEE',
        isActive: i === 0 || i % 25 !== 0,
        passwordHash,
        createdAt: days(650 - (i % 600)),
        updatedAt: days(650 - (i % 600)),
        managerUserId,
        profileId: randomUUID(),
        team,
      };
    });
    await insertMany(
      prisma,
      'user',
      employees.map(({ managerUserId, profileId, team, ...u }) => u),
    );
    await insertMany(
      prisma,
      'employeeProfile',
      employees.map((e) => ({
        id: e.profileId,
        userId: e.id,
        managerUserId: e.managerUserId,
        phone: `6${String(1000000 + Number(e.email.slice(-5))).slice(-7)}`,
      })),
    );
    log('users', 1 + managers.length + employees.length);
    log('employeeProfiles', employees.length);

    const byProfile = new Map(employees.map((e) => [e.profileId, e]));
    const teamA = employees.filter((e) => e.team === 0);
    const teamB = employees.filter((e) => e.team === 1);
    const ownerDirect = employees.filter((e) => e.team === -1);
    const employee0 = employees[0];

    // Contacts -------------------------------------------------------------
    const contacts = Array.from({ length: cfg.contacts }, (_, i) => {
      const emp = employees[i % employees.length];
      return {
        id: randomUUID(),
        type: i % 3 === 0 ? 'BROKER' : 'OWNER',
        name: `Load Contact ${String(i + 1).padStart(6, '0')}`,
        phone: `5${String(20000000 + i).slice(-8)}`,
        responsibleUserId: emp.id,
        createdAt: days(i % 500),
        updatedAt: days(i % 500),
      };
    });
    await insertMany(prisma, 'contact', contacts);
    log('contacts', contacts.length);

    // Clients --------------------------------------------------------------
    const clients = [];
    for (let i = 0; i < cfg.clients; i++) {
      const managed = i >= cfg.heavyClients && i % 10 === 0;
      const emp = i < cfg.heavyClients ? employee0 : employees[i % employees.length];
      const client = {
        id: randomUUID(),
        name: `Load Client ${String(i + 1).padStart(6, '0')}`,
        phone: `5${String(30000000 + i).slice(-8)}`,
        status: i % 9 === 0 ? 'CLOSED' : i % 13 === 0 ? 'INACTIVE' : 'ACTIVE',
        createdById: managed ? null : emp.profileId,
        responsibleEmployeeId: managed ? null : emp.profileId,
        createdByUserId: managed
          ? managers[Math.floor(i / 10) % managers.length].id
          : null,
        requestData:
          i < cfg.heavyClients && i % 5 !== 0
            ? JSON.stringify({
                type: i % 3 === 0 ? 'BUYER' : i % 3 === 1 ? 'RENTER' : 'EXCHANGER',
                budgetMin: 50000 + i,
                budgetMax: 200000 + i,
              })
            : i % 20 === 0
              ? JSON.stringify({ type: 'BUYER', budgetMin: 75000, budgetMax: 250000 })
              : null,
        createdAt: days(i % 730),
        updatedAt: days(i % 730),
      };
      clients.push(client);
    }
    await insertMany(prisma, 'client', clients);
    log('clients', clients.length);

    // Properties -----------------------------------------------------------
    const statuses = ['PENDING', 'AVAILABLE', 'AVAILABLE', 'AVAILABLE', 'REJECTED', 'SOLD', 'RENTED', 'ARCHIVED'];
    const properties = [];
    for (let i = 0; i < cfg.properties; i++) {
      const managed = i >= cfg.heavyProperties && i % 12 === 0;
      const emp = i < cfg.heavyProperties ? employee0 : employees[i % employees.length];
      const status = statuses[i % statuses.length];
      const approved = !['PENDING', 'REJECTED'].includes(status);
      properties.push({
        id: randomUUID(),
        reference: `P-LOAD-${String(i + 1).padStart(7, '0')}`,
        approvedReference: approved
          ? `A-LOAD-${String(i + 1).padStart(7, '0')}`
          : null,
        title: `Load Property ${String(i + 1).padStart(7, '0')}`,
        area: `Area ${i % 30}`,
        governorate: `Governorate ${i % 6}`,
        district: `District ${i % 40}`,
        currency: 'KWD',
        listingType: i % 2 === 0 ? 'SALE' : 'RENT',
        status,
        createdById: managed ? null : emp.profileId,
        createdByUserId: managed
          ? managers[Math.floor(i / 12) % managers.length].id
          : emp.id,
        contactId: contacts[i % contacts.length].id,
        createdAt: days(i % 730),
        updatedAt: days(i % 730),
        deletedAt: i % 20 === 0 ? days(i % 30) : null,
      });
    }
    await insertMany(prisma, 'property', properties);
    log('properties', properties.length);

    // Assignments + approvals ----------------------------------------------
    const assignments = [];
    for (let i = 0; i < Math.min(cfg.assignments, properties.length); i++) {
      const p = properties[i];
      const emp = employees[i % employees.length];
      assignments.push({
        id: randomUUID(),
        propertyId: p.id,
        employeeId: emp.profileId,
        purpose: i % 3 === 0 ? 'OWNER_FOLLOWUP' : i % 3 === 1 ? 'MARKETING' : 'VIEWINGS',
        createdAt: days(i % 90),
      });
    }
    await insertMany(prisma, 'propertyAssignment', assignments);
    log('propertyAssignments', assignments.length);

    const approvals = [];
    for (const p of properties) {
      if (p.status !== 'PENDING') continue;
      if (approvals.length >= cfg.approvals) break;
      approvals.push({
        id: randomUUID(),
        propertyId: p.id,
        requestedById: p.createdByUserId || owner.id,
        status: 'PENDING',
        createdAt: days(approvals.length % 120),
      });
    }
    await insertMany(prisma, 'propertyApprovalRequest', approvals);
    log('propertyApprovalRequests', approvals.length);

    // Legacy follow-up rows -------------------------------------------------
    const legacyFollowUps = [];
    const followUpStatuses = ['PENDING', 'PENDING', 'PENDING', 'COMPLETED', 'CANCELLED'];
    for (let i = 0; i < cfg.followUps; i++) {
      const c = clients[i % clients.length];
      const emp = c.responsibleEmployeeId
        ? byProfile.get(c.responsibleEmployeeId) || employee0
        : employee0;
      legacyFollowUps.push({
        id: randomUUID(),
        employeeId: emp.profileId,
        clientId: c.id,
        dueAt: days((i % 120) - 60),
        status: followUpStatuses[i % followUpStatuses.length],
        notes: i % 7 === 0 ? `load note ${i}` : null,
        createdAt: days(i % 365),
        updatedAt: days(i % 365),
      });
    }
    await insertMany(prisma, 'followUp', legacyFollowUps);
    log('followUps', legacyFollowUps.length);

    // Follow-up subjects ----------------------------------------------------
    const subjects = [];
    for (const c of clients) {
      if (subjects.length >= cfg.subjects) break;
      const emp = c.responsibleEmployeeId
        ? byProfile.get(c.responsibleEmployeeId) || employee0
        : null;
      subjects.push({
        id: randomUUID(),
        targetKey: `CLIENT:${c.id}`,
        kind: c.requestData ? 'CLIENT_REQUEST' : 'CLIENT',
        responsibleId: emp ? emp.profileId : null,
        responsibleUserId: emp ? null : c.createdByUserId,
        clientId: c.id,
        activatedAt: days(subjects.length % 365),
        lastSavedAt: subjects.length % 4 === 0 ? days(subjects.length % 40) : null,
        nextDueAt: days((subjects.length % 150) - 75),
        cycle: 1,
        active: true,
        createdAt: days(subjects.length % 365),
        updatedAt: days(subjects.length % 365),
      });
    }
    for (const p of properties) {
      if (subjects.length >= cfg.subjects) break;
      const emp = p.createdById
        ? byProfile.get(p.createdById) || employee0
        : null;
      subjects.push({
        id: randomUUID(),
        targetKey: `PROPERTY_OWNER:${p.id}`,
        kind: 'PROPERTY_OWNER',
        responsibleId: emp ? emp.profileId : null,
        responsibleUserId: emp ? null : p.createdByUserId,
        propertyId: p.id,
        activatedAt: days(subjects.length % 365),
        lastSavedAt: subjects.length % 5 === 0 ? days(subjects.length % 50) : null,
        nextDueAt: days((subjects.length % 150) - 75),
        cycle: 1,
        active: true,
        createdAt: days(subjects.length % 365),
        updatedAt: days(subjects.length % 365),
      });
    }
    await insertMany(prisma, 'followUpSubject', subjects);
    log('followUpSubjects', subjects.length);

    // Notifications ---------------------------------------------------------
    const notifications = [];
    for (let i = 0; i < cfg.notifications; i++) {
      const user =
        i % 10 < 5
          ? owner
          : i % 10 < 7
            ? managers[0]
            : i % 10 < 8
              ? managers[1 % managers.length]
              : employees[i % employees.length];
      notifications.push({
        id: randomUUID(),
        userId: user.id,
        type: 'SYSTEM',
        title: `Load notification ${i}`,
        body: 'Synthetic load-test notification',
        eventKey: `LOAD:${i}`,
        readAt: i % 3 === 0 ? days(i % 20) : null,
        createdAt: days(i % 365),
        propertyId: i % 2 === 0 ? properties[i % properties.length].id : null,
        clientId: i % 3 === 0 ? clients[i % clients.length].id : null,
      });
    }
    await insertMany(prisma, 'notification', notifications);
    log('notifications', notifications.length);

    // Deals -----------------------------------------------------------------
    const deals = [];
    for (let i = 0; i < cfg.deals; i++) {
      const p = properties[i % properties.length];
      const c = clients[i % clients.length];
      const pEmp = p.createdById
        ? byProfile.get(p.createdById) || employee0
        : employee0;
      const cEmp = c.responsibleEmployeeId
        ? byProfile.get(c.responsibleEmployeeId) || employee0
        : employee0;
      deals.push({
        id: randomUUID(),
        reference: `D-LOAD-${String(i + 1).padStart(7, '0')}`,
        type: i % 2 === 0 ? 'SALE' : 'RENT',
        propertyId: p.id,
        clientId: c.id,
        recordedById: owner.id,
        propertyEmployeeId: pEmp.profileId,
        clientEmployeeId: cEmp.profileId,
        price: '100000.00',
        companyCommission: '1000.00',
        currency: 'KWD',
        closedAt: days(i % 365),
        createdAt: days(i % 365),
      });
    }
    await insertMany(prisma, 'deal', deals);
    log('deals', deals.length);

    // Audit rows ------------------------------------------------------------
    const actions = ['PROPERTY_APPROVED', 'PROPERTY_REJECTED', 'PROPERTY_CREATED', 'CLIENT_CREATED', 'DEAL_CREATED', 'PROPERTY_RESTORED'];
    const auditLogs = [];
    for (let i = 0; i < cfg.auditLogs; i++) {
      const actor = i % 2 === 0 ? owner : managers[i % managers.length];
      auditLogs.push({
        id: randomUUID(),
        actorId: actor.id,
        action: actions[i % actions.length],
        entityType: i % 2 === 0 ? 'Property' : 'Client',
        entityId: i % 2 === 0 ? properties[i % properties.length].id : clients[i % clients.length].id,
        createdAt: days(i % 365),
      });
    }
    await insertMany(prisma, 'auditLog', auditLogs);
    log('auditLogs', auditLogs.length);

    const heavyClients = clients.slice(0, cfg.heavyClients);
    const heavyProperties = properties.slice(0, cfg.heavyProperties);
    const ownerDirectActive =
      ownerDirect.find((e) => e.isActive) ?? ownerDirect[0] ?? null;
    const state = {
      stage: STAGE,
      db,
      generatedAt: new Date().toISOString(),
      counts,
      credentials: {
        owner: owner.email,
        managerA: managers[0].email,
        managerB: managers[1].email,
        employee0: employee0.email,
      },
      ids: {
        owner: owner.id,
        managerA: managers[0].id,
        managerB: managers[1].id,
        employee0: employee0.id,
        employee0Profile: employee0.profileId,
        employee0Name: employee0.name,
        ownerDirectUserId: ownerDirectActive?.id ?? null,
        ownerDirectName: ownerDirectActive?.name ?? null,
        ownerDirectEmail: ownerDirectActive?.email ?? null,
        lastEmployeeEmail: employees[employees.length - 1].email,
        teamACount: teamA.length,
        teamBCount: teamB.length,
        ownerDirectCount: ownerDirect.length,
        lastEmployeeUserId: employees[employees.length - 1].id,
        lastEmployeeName: employees[employees.length - 1].name,
        lastClientId: clients[clients.length - 1].id,
        lastClientName: clients[clients.length - 1].name,
        lastPropertyId: properties[properties.length - 1].id,
        lastPropertyReference: properties[properties.length - 1].reference,
        lateClientId: heavyClients[0]?.id ?? null,
        heavyClientIds: heavyClients.map((c) => c.id),
        heavyPropertyIds: heavyProperties.map((p) => p.id),
        teamAUserIds: teamA.map((e) => e.id),
        teamBUserIds: teamB.map((e) => e.id),
        ownerDirectUserIds: ownerDirect.map((e) => e.id),
        employee0ClientIds: heavyClients.map((c) => c.id),
      },
    };
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`[${STAGE}] state written to ${STATE_FILE}`);
    console.log(
      `[${STAGE}] total generated rows: ${Object.values(counts).reduce((a, b) => a + b, 0)}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
