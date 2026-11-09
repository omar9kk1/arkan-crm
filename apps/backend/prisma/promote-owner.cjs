/* global require, process, console */
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * One-time, explicit promotion of the existing primary Manager to OWNER.
 *
 * SAFE BY DEFAULT:
 *   node apps/backend/prisma/promote-owner.cjs
 *   node apps/backend/prisma/promote-owner.cjs --email owner@example.com
 *
 * WRITE (requires both flags):
 *   node --env-file=apps/backend/.env apps/backend/prisma/promote-owner.cjs \
 *     --email owner@example.com --apply --confirm
 *
 * It refuses to guess when more than one active Manager exists, refuses when
 * an OWNER already exists, bumps authVersion and revokes every session in the
 * same transaction, and prints a dry-run preview by default.
 */
const { PrismaClient } = require('@prisma/client');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const email = valueOf('--email');
const apply = has('--apply');
const confirm = has('--confirm');

const prisma = new PrismaClient();

async function candidate(user) {
  const [properties, clients, contacts, notifications] = await Promise.all([
    prisma.property.count({ where: { createdByUserId: user.id } }),
    prisma.client.count({
      where: {
        OR: [
          { createdByUserId: user.id },
          { responsibleEmployee: { userId: user.id } },
        ],
      },
    }),
    prisma.contact.count({ where: { responsibleUserId: user.id } }),
    prisma.notification.count({ where: { userId: user.id } }),
  ]);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
    linked: { properties, clients, contacts, notifications },
  };
}

async function main() {
  const existingOwners = await prisma.user.count({ where: { role: 'OWNER' } });
  const managers = await prisma.user.findMany({
    where: { role: 'MANAGER', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, createdAt: true },
  });
  const candidates = [];
  for (const manager of managers) candidates.push(await candidate(manager));

  let selected = null;
  if (email) {
    const normalized = email.trim().toLowerCase();
    selected =
      candidates.find(
        (item) => item.email.toLowerCase() === normalized,
      ) ?? null;
    if (!selected) {
      console.error('[promote-owner] ERROR: email is not an active MANAGER');
      process.exitCode = 2;
      return;
    }
  } else if (candidates.length === 1) {
    selected = candidates[0];
  } else if (candidates.length === 0) {
    console.error('[promote-owner] ERROR: no active MANAGER candidate exists');
    process.exitCode = 2;
    return;
  } else {
    console.error(
      `[promote-owner] ERROR: ambiguous promotion (${candidates.length} active Managers). ` +
        'Re-run with --email; no account was guessed.',
    );
    console.error(JSON.stringify(candidates, null, 2));
    process.exitCode = 2;
    return;
  }

  const preview = {
    dryRun: !apply,
    existingOwners,
    selected,
    candidates,
  };

  if (!apply) {
    console.log(JSON.stringify(preview, null, 2));
    console.log(
      '[promote-owner] DRY RUN ONLY. Re-run with --apply --confirm to write.',
    );
    return;
  }
  if (!confirm) {
    console.error(
      '[promote-owner] ERROR: --apply requires --confirm; nothing was written',
    );
    process.exitCode = 3;
    return;
  }
  if (existingOwners > 0) {
    console.error(
      '[promote-owner] ERROR: an OWNER already exists; refusing to promote another account',
    );
    process.exitCode = 3;
    return;
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.user.findFirst({
      where: { id: selected.id, role: 'MANAGER', isActive: true },
      select: { id: true },
    });
    if (!current) throw new Error('the selected account is no longer an active MANAGER');
    await tx.user.update({
      where: { id: selected.id },
      data: { role: 'OWNER', authVersion: { increment: 1 } },
    });
    await tx.refreshToken.updateMany({
      where: { userId: selected.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId: selected.id,
        action: 'OWNER_PROMOTE',
        entityType: 'User',
        entityId: selected.id,
        before: { role: 'MANAGER' },
        after: { role: 'OWNER', system: true },
      },
    });
  });

  console.log(
    JSON.stringify(
      {
        ...preview,
        dryRun: false,
        applied: true,
        note: 'All previous sessions were revoked. A fresh login is required.',
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('[promote-owner] FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
