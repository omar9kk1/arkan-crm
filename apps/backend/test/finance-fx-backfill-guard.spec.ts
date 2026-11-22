import type { PrismaClient } from '@prisma/client';
import { applyFxBackfill } from '../src/finance/finance-fx-backfill';
import type { FxRateService } from '../src/finance/fx-rate.service';

describe('Finance FX backfill guard', () => {
  it('refuses apply outside the isolated test database', async () => {
    const prisma = {
      $queryRaw: jest.fn(async () => [{ name: 'arkan_crm' }]),
    } as unknown as PrismaClient;

    await expect(
      applyFxBackfill(prisma, {} as FxRateService),
    ).rejects.toThrow(/only arkan_crm_api_test/);
  });
});
