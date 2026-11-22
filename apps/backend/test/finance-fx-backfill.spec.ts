import { randomUUID } from 'node:crypto';
import { Role } from '@arkan/shared';
import {
  applyFxBackfill,
  previewFxBackfill,
} from '../src/finance/finance-fx-backfill';
import type { FxRateService } from '../src/finance/fx-rate.service';
import {
  createTestApp,
  createUser,
  describeWithDatabase,
  resetDatabase,
  type TestContext,
} from './support/test-app';

jest.setTimeout(180000);

describeWithDatabase('Finance FX backfill', () => {
  let ctx: TestContext;
  let ownerId: string;

  async function createLegacyMovement(input: {
    amount: string;
    currency: string;
    date: string;
  }) {
    const key = randomUUID();
    const occurredAt = new Date(`${input.date}T00:00:00.000Z`);
    const expense = await ctx.prisma.manualExpense.create({
      data: {
        reference: `ME-fx-${key}`,
        type: 'أخرى',
        amount: input.amount,
        currency: input.currency,
        description: `FX backfill ${key}`,
        createdById: ownerId,
        occurredAt,
      },
      select: { id: true },
    });
    const movement = await ctx.prisma.financeMovement.create({
      data: {
        reference: `FM-M-${expense.id.replace(/-/g, '')}`,
        direction: 'EXPENSE',
        sourceType: 'MANUAL_EXPENSE',
        sourceId: expense.id,
        manualExpenseId: expense.id,
        createdById: ownerId,
        amount: input.amount,
        currency: input.currency,
        reportingAmount: null,
        fxStatus: 'UNRESOLVED',
        counterparty: 'مصروفات الشركة',
        calculationNotes: 'legacy foreign-currency row',
        occurredAt,
      },
      select: { id: true, reference: true },
    });
    return { expense, movement };
  }

  function fakeFx(
    rate = '0.0057646',
  ): jest.Mocked<Pick<FxRateService, 'egpToKwd'>> {
    return {
      egpToKwd: jest.fn(async (date: string) => ({
        base: 'EGP' as const,
        quote: 'KWD' as const,
        rate,
        rateDate: date,
        provider: 'frankfurter' as const,
      })),
    };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    const owner = await createUser(ctx.prisma, {
      email: 'finance.fx.owner@test.local',
      name: 'Finance FX Owner',
      role: Role.OWNER,
    });
    ownerId = owner.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('previews legacy rows without writing anything', async () => {
    const egp = await createLegacyMovement({
      amount: '250.00',
      currency: 'EGP',
      date: '2026-01-05',
    });
    const kwd = await createLegacyMovement({
      amount: '0.500',
      currency: 'KWD',
      date: '2026-01-05',
    });

    const preview = await previewFxBackfill(ctx.prisma, { limit: 10 });
    expect(preview.database).toBe('arkan_crm_api_test');
    expect(preview.schemaReady).toBe(true);
    expect(preview.applyAllowed).toBe(true);
    expect(preview.total).toBe(2);
    expect(preview.byCurrency).toEqual(
      expect.arrayContaining([
        { currency: 'EGP', count: 1, amount: '250.000' },
        { currency: 'KWD', count: 1, amount: '0.500' },
      ]),
    );
    expect(preview.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: egp.movement.id,
          amount: '250.000',
          currency: 'EGP',
          fxStatus: 'UNRESOLVED',
        }),
        expect.objectContaining({
          id: kwd.movement.id,
          amount: '0.500',
          currency: 'KWD',
          fxStatus: 'UNRESOLVED',
        }),
      ]),
    );

    // Preview is read-only.
    const unchanged = await ctx.prisma.financeMovement.findMany({
      where: { id: { in: [egp.movement.id, kwd.movement.id] } },
      select: { reportingAmount: true, fxStatus: true },
    });
    expect(
      unchanged.every(
        (row) =>
          row.reportingAmount === null && row.fxStatus === 'UNRESOLVED',
      ),
    ).toBe(true);
  });

  it('applies the backfill idempotently with each row transaction date', async () => {
    const fx = fakeFx();
    const result = await applyFxBackfill(
      ctx.prisma,
      fx as unknown as FxRateService,
      { limit: 10 },
    );
    expect(result).toMatchObject({
      database: 'arkan_crm_api_test',
      scanned: 2,
      converted: 1,
      repairedKwd: 1,
      skippedUnsupported: 0,
      skippedAlreadyResolved: 0,
      failed: [],
      remaining: 0,
    });
    expect(fx.egpToKwd).toHaveBeenCalledWith('2026-01-05');

    const rows = await ctx.prisma.financeMovement.findMany({
      where: { currency: { in: ['EGP', 'KWD'] } },
      orderBy: { currency: 'asc' },
      select: {
        currency: true,
        amount: true,
        reportingAmount: true,
        fxStatus: true,
        fxRate: true,
        fxRateDate: true,
        fxProvider: true,
      },
    });
    const egp = rows.find((row) => row.currency === 'EGP')!;
    expect(egp.reportingAmount?.toFixed(3)).toBe('1.441');
    expect(egp.fxStatus).toBe('CONVERTED');
    expect(egp.fxRate?.toString()).toBe('0.0057646');
    expect(egp.fxRateDate?.toISOString().slice(0, 10)).toBe('2026-01-05');
    expect(egp.fxProvider).toBe('frankfurter');
    expect(egp.amount.toFixed(3)).toBe('250.000');

    const kwd = rows.find((row) => row.currency === 'KWD')!;
    expect(kwd.reportingAmount?.toFixed(3)).toBe('0.500');
    expect(kwd.fxStatus).toBe('NOT_REQUIRED');

    // Re-running is a no-op.
    const rerun = await applyFxBackfill(
      ctx.prisma,
      fx as unknown as FxRateService,
      { limit: 10 },
    );
    expect(rerun).toMatchObject({ scanned: 0, converted: 0, remaining: 0 });
    expect(fx.egpToKwd).toHaveBeenCalledTimes(1);
    expect((await previewFxBackfill(ctx.prisma, { limit: 10 })).total).toBe(0);
  });

  it('leaves failed rows unresolved so a later run can resume', async () => {
    const legacy = await createLegacyMovement({
      amount: '100.00',
      currency: 'EGP',
      date: '2026-01-06',
    });
    const failing = {
      egpToKwd: jest.fn(async () => {
        throw new Error('provider down');
      }),
    };

    const first = await applyFxBackfill(
      ctx.prisma,
      failing as unknown as FxRateService,
      { limit: 10 },
    );
    expect(first).toMatchObject({
      scanned: 1,
      converted: 0,
      failed: [
        {
          reference: legacy.movement.reference,
          currency: 'EGP',
          message: 'provider down',
        },
      ],
      remaining: 1,
    });
    expect(
      (
        await ctx.prisma.financeMovement.findUniqueOrThrow({
          where: { id: legacy.movement.id },
          select: { fxStatus: true, reportingAmount: true },
        })
      ).fxStatus,
    ).toBe('UNRESOLVED');

    const succeeding = fakeFx();
    const second = await applyFxBackfill(
      ctx.prisma,
      succeeding as unknown as FxRateService,
      { limit: 10 },
    );
    expect(second).toMatchObject({ scanned: 1, converted: 1, remaining: 0 });
  });

  it('skips currencies the reviewed provider does not support', async () => {
    const legacy = await createLegacyMovement({
      amount: '10.00',
      currency: 'USD',
      date: '2026-01-07',
    });
    const result = await applyFxBackfill(
      ctx.prisma,
      fakeFx() as unknown as FxRateService,
      { limit: 10 },
    );
    expect(result).toMatchObject({
      scanned: 1,
      converted: 0,
      skippedUnsupported: 1,
      remaining: 1,
    });
    expect(
      (
        await ctx.prisma.financeMovement.findUniqueOrThrow({
          where: { id: legacy.movement.id },
          select: { fxStatus: true },
        })
      ).fxStatus,
    ).toBe('UNRESOLVED');

    await ctx.prisma.financeMovement.delete({
      where: { id: legacy.movement.id },
    });
    await ctx.prisma.manualExpense.delete({
      where: { id: legacy.expense.id },
    });
  });
});
