'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createDeal,
  getDeal,
  getDealOptions,
  listDeals,
} from '../../lib/api/deals-api';
import {
  mapClientOption,
  mapDeal,
  mapEmployeeOption,
  mapPropertyOption,
  PROPERTY_STATUS_LABEL,
  type Deal,
  type DealClientOption,
  type DealDraft,
  type DealEmployeeOption,
  type DealPropertyOption,
} from './deal-model';

interface DealsState {
  deals: Deal[];
  properties: DealPropertyOption[];
  clients: DealClientOption[];
  employees: DealEmployeeOption[];
  loading: boolean;
  error: string;
  create: (draft: DealDraft) => Promise<string | null>;
  refreshDeal: (dealId: string) => Promise<Deal>;
}

async function loadAllDeals(): Promise<Deal[]> {
  const deals: Deal[] = [];
  let cursor: string | null = null;
  do {
    const page = await listDeals({ limit: 100, ...(cursor ? { cursor } : {}) });
    deals.push(...page.items.map(mapDeal));
    cursor = page.nextCursor;
  } while (cursor);
  return deals;
}

export function useDeals(): DealsState {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [properties, setProperties] = useState<DealPropertyOption[]>([]);
  const [clients, setClients] = useState<DealClientOption[]>([]);
  const [employees, setEmployees] = useState<DealEmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const [dealRows, options] = await Promise.all([
          loadAllDeals(),
          getDealOptions(),
        ]);
        if (!active) return;
        setDeals(dealRows);
        setProperties(options.properties.map(mapPropertyOption));
        setClients(options.clients.map(mapClientOption));
        setEmployees(options.employees.map(mapEmployeeOption));
      } catch (cause) {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : 'تعذر تحميل الصفقات. حاول تحديث الصفحة.',
        );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const create = useCallback(async (draft: DealDraft) => {
    try {
      const created = await createDeal({
        propertyId: draft.propertyId,
        clientId: draft.clientId,
        propertyEmployeeUserId: draft.propertyEmployeeUserId,
        clientEmployeeUserId: draft.clientEmployeeUserId,
        type: draft.type === 'بيع' ? 'SALE' : 'RENT',
        price: String(draft.price),
        companyCommission: String(draft.companyCommission),
        propertyCommission: String(draft.propertyCommission),
        clientCommission: String(draft.clientCommission),
        closedAt: draft.date,
        ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
      });
      const mapped = mapDeal(created);
      setDeals((previous) => [mapped, ...previous]);
      setProperties((previous) =>
        previous.map((property) =>
          property.id === created.property.id
            ? {
                ...property,
                status: created.property.status,
                statusLabel:
                  PROPERTY_STATUS_LABEL[created.property.status] ??
                  created.property.status,
                available: false,
              }
            : property,
        ),
      );
      setError('');
      return null;
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : 'تعذر إنشاء الصفقة. راجع البيانات وتأكد أن العقار ما زال متاحًا.';
      setError(message);
      return message;
    }
  }, []);

  const refreshDeal = useCallback(async (dealId: string) => {
    const fresh = mapDeal(await getDeal(dealId));
    setDeals((previous) =>
      previous.map((deal) => (deal.id === fresh.id ? fresh : deal)),
    );
    return fresh;
  }, []);

  return {
    deals,
    properties,
    clients,
    employees,
    loading,
    error,
    create,
    refreshDeal,
  };
}
