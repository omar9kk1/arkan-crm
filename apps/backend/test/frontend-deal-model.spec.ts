import {
  filsMoney,
  isEmployeeAttributionConfirmed,
  mapDeal,
  mapPropertyOption,
  money,
  toFils,
} from '../../frontend/features/manager-deals/deal-model';
import type { DealApiDto } from '../../frontend/lib/api/deal-types';

describe('Deals frontend model', () => {
  it('accumulates KWD money as exact fils, never as floats', () => {
    expect(toFils('1.234')).toBe(1234n);
    expect(toFils('0.001')).toBe(1n);
    expect(toFils('0.001') + toFils('0.002')).toBe(3n);
    expect(toFils('300000.50')).toBe(300000500n);
    expect(filsMoney(1234n)).toBe(money(1.234));
    expect(filsMoney(1n)).toBe(money(0.001));
  });

  it('maps a backend deal into the existing card/drawer view model', () => {
    const dto: DealApiDto = {
      id: 'deal-1',
      reference: 'D-20261110-ABCDEF',
      type: 'SALE',
      price: '1.234',
      companyCommission: '0.011',
      propertyCommission: '0.001',
      clientCommission: '0.010',
      currency: 'KWD',
      closedAt: '2026-11-10',
      createdAt: '2026-11-10T00:00:00.000Z',
      property: {
        id: 'property-1',
        code: 'A-000123',
        title: 'بيت المطلاع',
        area: '400.00',
        ownerName: 'أبو فهد',
        status: 'SOLD',
        listingType: 'SALE',
      },
      client: { id: 'client-1', name: 'محمد العتيبي' },
      propertyEmployee: { userId: 'user-a', name: 'أحمد محمد' },
      clientEmployee: { userId: 'user-b', name: 'سارة أحمد' },
      recordedBy: { name: 'مدير النظام' },
      notes: 'ملاحظة الصفقة',
      commissions: [
        {
          id: 'commission-property',
          role: 'PROPERTY_EMPLOYEE',
          amount: '0.001',
          status: 'PENDING',
          paidAt: null,
          employeeUserId: 'user-a',
        },
        {
          id: 'commission-client',
          role: 'CLIENT_EMPLOYEE',
          amount: '0.010',
          status: 'PAID',
          paidAt: '2026-11-10',
          employeeUserId: 'user-b',
        },
      ],
    };
    const deal = mapDeal(dto);
    expect(deal.type).toBe('بيع');
    expect(deal.property.statusLabel).toBe('تم البيع');
    expect(deal.property.area).toBe('400 م²');
    expect(deal.property.owner).toBe('أبو فهد');
    expect(deal.propertyEmployee).toBe('أحمد محمد');
    expect(deal.clientEmployee).toBe('سارة أحمد');
    expect(deal.priceFils).toBe(1234n);
    expect(deal.companyCommissionFils).toBe(11n);
    expect(deal.propertyCommissionFils).toBe(1n);
    expect(deal.clientCommissionFils).toBe(10n);
    expect(deal.notes).toBe('ملاحظة الصفقة');
    expect(deal.createdBy).toBe('مدير النظام');
    expect(deal.commissions).toEqual([
      {
        id: 'commission-property',
        role: 'PROPERTY_EMPLOYEE',
        amount: '0.001',
        status: 'PENDING',
        paidAt: null,
        employeeUserId: 'user-a',
      },
      {
        id: 'commission-client',
        role: 'CLIENT_EMPLOYEE',
        amount: '0.010',
        status: 'PAID',
        paidAt: '2026-11-10',
        employeeUserId: 'user-b',
      },
    ]);
  });

  it('maps a property picker option with its availability and suggestion', () => {
    const option = mapPropertyOption({
      id: 'property-1',
      code: 'P-000123',
      title: 'عقار غرناطة',
      area: '420.00',
      ownerName: 'أبو عبدالله',
      status: 'AVAILABLE',
      listingType: 'RENT',
      suggestedEmployeeUserId: 'user-a',
      suggestedEmployeeName: 'أحمد محمد',
    });
    expect(option.available).toBe(true);
    expect(option.statusLabel).toBe('متاح');
    expect(option.area).toBe('420 م²');
    expect(option.suggestedEmployeeUserId).toBe('user-a');
  });

  it('auto-confirms MANAGER attribution only for the real eligible employee', () => {
    const base = {
      isOwner: false,
      responsibleUserId: 'user-a',
      attributedUserId: 'user-a',
      eligibleUserIds: ['user-a', 'user-b'],
    };
    // The real responsible employee is selected automatically.
    expect(
      isEmployeeAttributionConfirmed({ ...base, manuallyConfirmed: false }),
    ).toBe(true);

    // A stale draft override to another (even eligible) employee is not
    // confirmed; changing the property/client resets to false.
    expect(
      isEmployeeAttributionConfirmed({
        ...base,
        manuallyConfirmed: true,
        attributedUserId: 'user-b',
      }),
    ).toBe(false);

    // Missing or ineligible responsible employees are never confirmed.
    expect(
      isEmployeeAttributionConfirmed({
        ...base,
        manuallyConfirmed: false,
        responsibleUserId: null,
        attributedUserId: '',
      }),
    ).toBe(false);
    expect(
      isEmployeeAttributionConfirmed({
        ...base,
        manuallyConfirmed: false,
        responsibleUserId: 'inactive-user',
        attributedUserId: 'inactive-user',
      }),
    ).toBe(false);
  });

  it('keeps OWNER on the manual confirmation workflow', () => {
    expect(
      isEmployeeAttributionConfirmed({
        isOwner: true,
        manuallyConfirmed: false,
        responsibleUserId: 'user-a',
        attributedUserId: 'user-a',
        eligibleUserIds: ['user-a'],
      }),
    ).toBe(false);
    expect(
      isEmployeeAttributionConfirmed({
        isOwner: true,
        manuallyConfirmed: true,
        responsibleUserId: 'user-a',
        attributedUserId: 'user-b',
        eligibleUserIds: ['user-a', 'user-b'],
      }),
    ).toBe(true);
  });
});
