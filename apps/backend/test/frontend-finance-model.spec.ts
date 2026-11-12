import {
  filsToAmount,
  mapFinanceMovement,
  mapFinanceSummary,
  summaryCount,
  summaryMoney,
  toFils,
} from '../../frontend/features/manager-finance/finance-model';
import type { FinanceMovementApiDto } from '../../frontend/lib/api/finance-types';

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
});
