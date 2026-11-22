import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { FxRateService } from '../src/finance/fx-rate.service';

function mockResponse(body: unknown, ok = true) {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response);
}

describe('FxRateService', () => {
  const service = new FxRateService();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls only the pinned HTTPS Frankfurter endpoint with the transaction date', async () => {
    const fetchMock = mockResponse({
      date: '2026-01-01',
      base: 'EGP',
      quote: 'KWD',
      rate: 0.0057646,
    });

    const quote = await service.egpToKwd('2026-01-01');
    expect(quote).toEqual({
      base: 'EGP',
      quote: 'KWD',
      rate: '0.0057646',
      rateDate: '2026-01-01',
      provider: 'frankfurter',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.frankfurter.dev/v2/rate/EGP/KWD?date=2026-01-01',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
    });
  });

  it('accepts the latest prior rate date within the documented age limit', async () => {
    mockResponse({
      date: '2026-01-08',
      base: 'EGP',
      quote: 'KWD',
      rate: 0.0058,
    });
    await expect(service.egpToKwd('2026-01-10')).resolves.toMatchObject({
      rateDate: '2026-01-08',
    });
  });

  it('rejects a rate older than the maximum age', async () => {
    mockResponse({
      date: '2026-01-01',
      base: 'EGP',
      quote: 'KWD',
      rate: 0.0058,
    });
    await expect(service.egpToKwd('2026-01-10')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('never accepts a rate date after the transaction date', async () => {
    mockResponse({
      date: '2026-01-11',
      base: 'EGP',
      quote: 'KWD',
      rate: 0.0058,
    });
    await expect(service.egpToKwd('2026-01-10')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects a future transaction date before calling the provider', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    await expect(service.egpToKwd('2999-01-01')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed on provider errors or an unexpected currency pair', async () => {
    mockResponse({}, false);
    await expect(service.egpToKwd('2026-01-01')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    jest.restoreAllMocks();
    mockResponse({
      date: '2026-01-01',
      base: 'USD',
      quote: 'KWD',
      rate: 0.3,
    });
    await expect(service.egpToKwd('2026-01-01')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects malformed rates instead of inventing a value', async () => {
    mockResponse({
      date: '2026-01-01',
      base: 'EGP',
      quote: 'KWD',
      rate: 'not-a-rate',
    });
    await expect(service.egpToKwd('2026-01-01')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
