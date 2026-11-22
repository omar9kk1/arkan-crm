import { PrismaClient } from '@prisma/client';
import {
  applyFxBackfill,
  FX_BACKFILL_TEST_DATABASE,
  previewFxBackfill,
} from '../finance/finance-fx-backfill';
import { FxRateService } from '../finance/fx-rate.service';

/**
 * Read-only by default:
 *   node dist/scripts/finance-fx-backfill.js --preview
 *
 * Apply is intentionally hard-guarded to the isolated test database:
 *   node dist/scripts/finance-fx-backfill.js --apply --database=arkan_crm_api_test
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const limit = Number(readArg('--limit') ?? '50');
  const requestedDatabase = readArg('--database');
  const prisma = new PrismaClient();

  try {
    if (!apply) {
      const preview = await previewFxBackfill(prisma, { limit });
      console.log(JSON.stringify(preview, null, 2));
      return;
    }

    if (requestedDatabase !== FX_BACKFILL_TEST_DATABASE) {
      throw new Error(
        `Refusing --apply: pass --database=${FX_BACKFILL_TEST_DATABASE}. Real-database backfill requires separate authorization.`,
      );
    }

    const result = await applyFxBackfill(prisma, new FxRateService(), {
      limit,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.failed.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

function readArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value?.slice(prefix.length);
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Finance FX backfill failed',
  );
  process.exitCode = 1;
});
