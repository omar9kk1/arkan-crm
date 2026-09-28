'use client';
import { useState } from 'react';
import {
  initialDeals,
  mockProperties,
  mockClients,
  employees,
  type DealDraft,
  type MockDeal,
  type MockProperty,
} from './mock-data';
export function useMockDeals() {
  const [store, setStore] = useState({
    deals: initialDeals,
    properties: mockProperties,
  });
  function create(draft: DealDraft) {
    const property = store.properties.find(
      (item) => item.id === draft.propertyId && item.status === 'متاح',
    );
    const client = mockClients.find((item) => item.id === draft.clientId);
    if (
      !property ||
      !client ||
      !employees.includes(draft.propertyEmployee) ||
      !employees.includes(draft.clientEmployee)
    )
      return false;
    if (
      ![
        draft.price,
        draft.companyCommission,
        draft.propertyCommission,
        draft.clientCommission,
      ].every((value) => Number.isFinite(value) && value >= 0) ||
      draft.price <= 0 ||
      !draft.date
    )
      return false;
    const status: MockProperty['status'] =
      draft.type === 'بيع' ? 'تم البيع' : 'تم التأجير';
    const updated = { ...property, status };
    const deal: MockDeal = {
      ...draft,
      id: crypto.randomUUID(),
      property: updated,
      client,
      createdBy: 'مدير النظام',
    };
    setStore((previous) =>
      previous.properties.some(
        (item) => item.id === property.id && item.status === 'متاح',
      )
        ? {
            deals: [deal, ...previous.deals],
            properties: previous.properties.map((item) =>
              item.id === property.id ? updated : item,
            ),
          }
        : previous,
    );
    return true;
  }
  return { ...store, create };
}
