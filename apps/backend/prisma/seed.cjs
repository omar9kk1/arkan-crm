/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS seed reuses the compiled password helper. */
/* global require, process, console */
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('../dist/auth/password');
const prisma = new PrismaClient();

async function seed() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Demo seed is disabled in production');
  const passwordHash = await hashPassword('ChangeMe123!');
  await prisma.$transaction(async (tx) => {
    const manager = await tx.user.upsert({
      where: { email: 'manager@arkan.test' },
      update: {},
      create: {
        email: 'manager@arkan.test',
        name: 'Demo Manager',
        role: 'MANAGER',
        passwordHash,
      },
    });
    if (manager.role !== 'MANAGER')
      throw new Error('Existing manager seed email has a different role');
    const employee = await tx.user.upsert({
      where: { email: 'employee@arkan.test' },
      update: {},
      create: {
        email: 'employee@arkan.test',
        name: 'Demo Employee',
        role: 'EMPLOYEE',
        passwordHash,
      },
    });
    if (employee.role !== 'EMPLOYEE')
      throw new Error('Existing employee seed email has a different role');
    await tx.employeeProfile.upsert({
      where: { userId: employee.id },
      update: {},
      create: { userId: employee.id },
    });
  });
  console.log('Demo users ready: manager@arkan.test and employee@arkan.test');
}
seed()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
