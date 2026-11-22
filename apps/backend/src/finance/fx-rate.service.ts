import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * The only outbound FX provider the backend may call. The host is pinned here
 * (never taken from request data), the request is HTTPS-only and redirects are
 * rejected, so a stored/redirected URL cannot turn this into an SSRF primitive.
 */
export const FX_PROVIDER = 'frankfurter';
export const FX_PROVIDER_HOST = 'api.frankfurter.dev';
export const FX_BASE_CURRENCY = 'EGP';
export const FX_QUOTE_CURRENCY = 'KWD';

/**
 * Maximum accepted gap between the transaction date and the provider's actual
 * rate date. Frankfurter normally returns the same date, or the latest prior
 * publication for weekends/holidays. Seven calendar days covers long official
 * holidays without silently using a stale rate.
 */
export const FX_MAX_RATE_AGE_DAYS = 7;

const FX_TIMEOUT_MS = 8_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RATE_PATTERN = /^\d+(\.\d{1,12})?$/;

const FX_UNAVAILABLE_MESSAGE =
  'تعذر جلب سعر صرف الجنيه المصري مقابل الدينار الكويتي لهذا التاريخ. لم يُحفظ المصروف. تحقق من الاتصال ثم أعد المحاولة.';

export interface FxQuote {
  base: typeof FX_BASE_CURRENCY;
  quote: typeof FX_QUOTE_CURRENCY;
  /** Exact decimal string, never a JSON float. */
  rate: string;
  /** The provider's actual rate date (YYYY-MM-DD). */
  rateDate: string;
  provider: typeof FX_PROVIDER;
}

/** Kuwait is UTC+3 all year (no daylight saving). */
export function kuwaitToday(now = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

@Injectable()
export class FxRateService {
  /**
   * Fetches the EGP -> KWD reference rate for one calendar date. This method is
   * always called OUTSIDE a database transaction; a provider outage therefore
   * aborts the write before any row is persisted (fail closed).
   */
  async egpToKwd(date: string): Promise<FxQuote> {
    const requestedDate = assertCalendarDate(date, 'تاريخ المصروف');
    const today = kuwaitToday();
    if (requestedDate > today) {
      throw new BadRequestException(
        'لا يمكن تحويل مصروف بتاريخ مستقبلي؛ اختر تاريخ اليوم أو تاريخًا سابقًا.',
      );
    }

    const url = new URL(
      `https://${FX_PROVIDER_HOST}/v2/rate/${FX_BASE_CURRENCY}/${FX_QUOTE_CURRENCY}`,
    );
    url.searchParams.set('date', requestedDate);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(FX_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });
    } catch {
      throw new ServiceUnavailableException(FX_UNAVAILABLE_MESSAGE);
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(FX_UNAVAILABLE_MESSAGE);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ServiceUnavailableException(FX_UNAVAILABLE_MESSAGE);
    }

    return parseQuote(body, requestedDate, today);
  }
}

function parseQuote(
  body: unknown,
  requestedDate: string,
  today: string,
): FxQuote {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ServiceUnavailableException(FX_UNAVAILABLE_MESSAGE);
  }
  const record = body as Record<string, unknown>;
  if (
    record.base !== FX_BASE_CURRENCY ||
    record.quote !== FX_QUOTE_CURRENCY
  ) {
    throw new ServiceUnavailableException(FX_UNAVAILABLE_MESSAGE);
  }

  const rateDate =
    typeof record.date === 'string' ? record.date : '';
  if (
    !DATE_PATTERN.test(rateDate) ||
    !isRealCalendarDate(rateDate) ||
    rateDate > requestedDate ||
    rateDate > today
  ) {
    throw new ServiceUnavailableException(FX_UNAVAILABLE_MESSAGE);
  }

  const ageDays = utcDay(requestedDate) - utcDay(rateDate);
  if (ageDays > FX_MAX_RATE_AGE_DAYS) {
    throw new ServiceUnavailableException(FX_UNAVAILABLE_MESSAGE);
  }

  const rawRate =
    typeof record.rate === 'number'
      ? String(record.rate)
      : typeof record.rate === 'string'
        ? record.rate
        : '';
  if (!RATE_PATTERN.test(rawRate)) {
    throw new ServiceUnavailableException(FX_UNAVAILABLE_MESSAGE);
  }

  const rate = new Prisma.Decimal(rawRate);
  if (!rate.isFinite() || rate.lte(0)) {
    throw new ServiceUnavailableException(FX_UNAVAILABLE_MESSAGE);
  }

  return {
    base: FX_BASE_CURRENCY,
    quote: FX_QUOTE_CURRENCY,
    rate: rate.toFixed(),
    rateDate,
    provider: FX_PROVIDER,
  };
}

export function assertCalendarDate(value: string, label: string): string {
  if (!DATE_PATTERN.test(value) || !isRealCalendarDate(value)) {
    throw new BadRequestException(`${label}: التاريخ غير صالح`);
  }
  return value;
}

function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function utcDay(value: string): number {
  return Math.floor(
    new Date(`${value}T00:00:00.000Z`).getTime() / 86_400_000,
  );
}
