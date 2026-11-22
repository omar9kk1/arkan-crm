import {
  filsToAmount,
  mapFinanceMovement,
  mapFinanceSummary,
  movementCardDisplay,
  movementDetailRows,
  summarize,
  summaryCount,
  summaryMoney,
  toFils,
} from '../../frontend/features/manager-finance/finance-model';
import type { FinanceMovementApiDto } from '../../frontend/lib/api/finance-types';

const kwdFxFields = {
  reportingAmount: '0.011',
  reportingCurrency: 'KWD' as const,
  fxStatus: 'NOT_REQUIRED' as const,
  fxRate: null,
  fxRateDate: null,
  fxProvider: null,
};

describe('Finance frontend model', () => {
  it('keeps KWD amounts exact at three decimals (integer fils)', () => {
    expect(toFils('1.234')).toBe(1234n);
    expect(toFils('0.001')).toBe(1n);
    expect(toFils('0.001') + toFils('0.002')).toBe(3n);
    expect(filsToAmount(1234n)).toBe('1.234');
    expect(filsToAmount(1n)).toBe('0.001');
    expect(filsToAmount(0n)).toBe('0');
  });

  it('maps a deal ledger row without losing real ids or Arabic status', () => {
    const dto: FinanceMovementApiDto = {
      id: 'movement-1',
      reference: 'FM-D-1',
      kind: 'deal',
      sourceType: 'DEAL',
      sourceId: 'deal-1',
      direction: 'INCOME',
      amount: '0.011',
      currency: 'KWD',
      ...kwdFxFields,
      occurredAt: '2026-11-10',
      createdAt: '2026-11-10T00:00:00.000Z',
      title: 'عمولة بيع — A-000001',
      counterparty: 'الشركة',
      status: 'EARNED',
      property: { id: 'property-1', code: 'A-000001', title: 'بيت المطلاع' },
      client: { id: 'client-1', name: 'محمد العتيبي' },
      employee: { id: 'user-1', name: 'أحمد محمد' },
      manager: { id: 'manager-1', name: 'مدير الفريق' },
      calculation: ['قيمة الصفقة: 1.234'],
      notes: null,
      dealId: 'deal-1',
      commissionId: null,
      manualExpenseId: null,
    };
    const movement = mapFinanceMovement(dto);
    expect(movement.type).toBe('income');
    expect(movement.sourceType).toBe('صفقة');
    expect(movement.direction).toBe('داخل');
    expect(movement.status).toBe('مستحقة');
    expect(movement.statusCode).toBe('EARNED');
    expect(movement.amountFils).toBe(11n);
    expect(movement.property).toBe('A-000001 — بيت المطلاع');
    expect(movement.clientOrOwner).toBe('محمد العتيبي');
    expect(movement.employee).toBe('أحمد محمد');
    expect(movement.sourceId).toBe('deal-1');
  });

  it('maps pending/paid commission statuses and joins summary currencies', () => {
    const base: FinanceMovementApiDto = {
      id: 'movement-2',
      reference: 'FM-C-2',
      kind: 'commission',
      sourceType: 'COMMISSION',
      sourceId: 'commission-1',
      direction: 'EXPENSE',
      amount: '0.001',
      currency: 'KWD',
      reportingAmount: '0.001',
      reportingCurrency: 'KWD',
      fxStatus: 'NOT_REQUIRED',
      fxRate: null,
      fxRateDate: null,
      fxProvider: null,
      occurredAt: '2026-11-10',
      createdAt: '2026-11-10T00:00:00.000Z',
      title: 'عمولة موظف',
      counterparty: 'أحمد محمد',
      status: 'PENDING',
      property: null,
      client: null,
      employee: { id: 'user-1', name: 'أحمد محمد' },
      manager: null,
      calculation: [],
      notes: null,
      dealId: 'deal-1',
      commissionId: 'commission-1',
      manualExpenseId: null,
    };
    expect(mapFinanceMovement(base).status).toBe('بانتظار الصرف');
    expect(mapFinanceMovement({ ...base, status: 'PAID' }).status).toBe(
      'تم الصرف',
    );

    const summaries = [
      mapFinanceSummary({
        currency: 'KWD',
        count: 2,
        unresolvedCount: 0,
        income: '0.011',
        commission: '0.001',
        payroll: '0',
        manual: '0.002',
        pendingCommission: '0.003',
        pendingPayroll: '0',
        net: '0.008',
      }),
    ];
    expect(summaryCount(summaries)).toBe(2);
    expect(summaryMoney(summaries, (totals) => totals.net)).toContain('0.008');
    expect(summaryMoney([], (totals) => totals.net)).toContain('0');
  });

  it('keeps internal ids and technical references out of card/detail labels', () => {
    const movement = mapFinanceMovement({
      id: 'movement-3',
      reference: 'FM-C-c45415db12344abc8def1234567890ab',
      kind: 'commission',
      sourceType: 'COMMISSION',
      sourceId: 'c45415db-1234-4abc-8def-1234567890ab',
      direction: 'EXPENSE',
      amount: '0.005',
      currency: 'KWD',
      reportingAmount: '0.005',
      reportingCurrency: 'KWD',
      fxStatus: 'NOT_REQUIRED',
      fxRate: null,
      fxRateDate: null,
      fxProvider: null,
      occurredAt: '2026-11-10',
      createdAt: '2026-11-10T00:00:00.000Z',
      title: 'عمولة سارة',
      counterparty: 'سارة',
      status: 'PENDING',
      property: { id: 'property-1', code: 'A-000001', title: 'عقار المطلاع' },
      client: null,
      employee: { id: 'user-1', name: 'سارة' },
      manager: null,
      calculation: ['المرجع: D-20261111-AF0A0F83'],
      notes: null,
      dealId: 'deal-1',
      commissionId: 'commission-1',
      manualExpenseId: null,
    });

    const card = movementCardDisplay(movement);
    expect(card).toMatchObject({
      title: 'عمولة سارة',
      party: '',
      employee: '',
      property: 'A-000001 — عقار المطلاع',
    });
    const serialized = JSON.stringify([
      card,
      movementDetailRows(movement),
    ]);
    expect(serialized).not.toContain('c45415db-1234-4abc-8def-1234567890ab');
    expect(serialized).not.toContain('FM-C-');
    expect(serialized).not.toContain('D-20261111-AF0A0F83');

    // A row without descriptive metadata falls back to a neutral title.
    const fallback = movementCardDisplay({ ...movement, title: '  ' });
    expect(fallback.title).toBe('حركة مالية');
  });

  it('keeps the original EGP amount on the card and shows KWD rate/date only in details', () => {
    const movement = mapFinanceMovement({
      id: 'movement-egp',
      reference: 'FM-M-egp',
      kind: 'manual',
      sourceType: 'MANUAL_EXPENSE',
      sourceId: 'expense-egp',
      direction: 'EXPENSE',
      amount: '1000.00',
      currency: 'EGP',
      reportingAmount: '5.765',
      reportingCurrency: 'KWD',
      fxStatus: 'CONVERTED',
      fxRate: '0.0057646',
      fxRateDate: '2026-11-20',
      fxProvider: 'frankfurter',
      occurredAt: '2026-11-20',
      createdAt: '2026-11-20T00:00:00.000Z',
      title: 'تصوير عقار',
      counterparty: 'مصروفات الشركة',
      status: 'RECORDED',
      property: null,
      client: null,
      employee: null,
      manager: null,
      calculation: ['المبلغ: 1000.000 EGP'],
      notes: 'تصوير',
      dealId: null,
      commissionId: null,
      manualExpenseId: 'expense-egp',
    });

    const card = JSON.stringify(movementCardDisplay(movement));
    expect(card).not.toContain('5.765');
    expect(card).not.toContain('0.0057646');
    expect(card).not.toContain('2026-11-20');
    expect(movement.amountFils).toBe(1000000n);

    const details = movementDetailRows(movement);
    expect(details).toEqual(
      expect.arrayContaining([
        ['المعادل بالدينار الكويتي', expect.stringContaining('5.765')],
        ['سعر الصرف', expect.stringContaining('0.0057646')],
        ['تاريخ سعر الصرف', '2026-11-20'],
        ['مصدر سعر الصرف', expect.stringContaining('Frankfurter')],
      ]),
    );
  });

  it('flags unresolved legacy rows and excludes them from KWD totals', () => {
    const movement = mapFinanceMovement({
      id: 'movement-unresolved',
      reference: 'FM-M-legacy',
      kind: 'manual',
      sourceType: 'MANUAL_EXPENSE',
      sourceId: 'expense-legacy',
      direction: 'EXPENSE',
      amount: '250.00',
      currency: 'EGP',
      reportingAmount: null,
      reportingCurrency: 'KWD',
      fxStatus: 'UNRESOLVED',
      fxRate: null,
      fxRateDate: null,
      fxProvider: null,
      occurredAt: '2026-11-01',
      createdAt: '2026-11-01T00:00:00.000Z',
      title: 'مصروف قديم',
      counterparty: 'مصروفات الشركة',
      status: 'RECORDED',
      property: null,
      client: null,
      employee: null,
      manager: null,
      calculation: [],
      notes: null,
      dealId: null,
      commissionId: null,
      manualExpenseId: 'expense-legacy',
    });

    expect(movementDetailRows(movement)).toEqual(
      expect.arrayContaining([
        ['التحويل إلى الدينار', expect.stringContaining('لم تُحتسب')],
      ]),
    );
    expect(summarize([movement]).net).toBe(0n);

    const summaries = [
      mapFinanceSummary({
        currency: 'KWD',
        count: 1,
        unresolvedCount: 1,
        income: '0',
        commission: '0',
        payroll: '0',
        manual: '0',
        pendingCommission: '0',
        pendingPayroll: '0',
        net: '0',
      }),
    ];
    expect(summaries[0]?.unresolvedCount).toBe(1);
    expect(summaryMoney(summaries, (totals) => totals.net)).toBe('0 د.ك');
  });
});
