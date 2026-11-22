'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { AnimatedCount } from '../../../components/ui/animated-count';
import {
  getFinanceOptions,
  listFinance,
  createManualExpense,
} from '../../../lib/api/finance-api';
import {
  filsToAmount,
  mapFinanceMovement,
  mapFinanceSummary,
  summaryCount,
  summaryMoney,
  type FinanceFilter,
  type FinanceMovement,
  type FinanceSummary,
  type ManualExpenseDraft,
} from '../finance-model';
import { FinanceSummaryCards } from './finance-summary-cards';
import { FinanceFilters } from './finance-filters';
import { FinanceMovementCard } from './finance-movement-card';
import { FinanceDetailsDrawer } from './finance-details-drawer';
import { ManualExpenseModal } from './manual-expense-modal';
import styles from './finance.module.css';

const initialFilter: FinanceFilter = {
  period: 'all',
  type: 'all',
  party: '',
  query: '',
};
const PAGE_SIZE = 100;
// Defensive cap for the automatic page walk; the ledger UI still keeps all
// visible rows, while the API remains the paginated source of truth.
const MAX_ROWS = 1000;

function requestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues)
    globalThis.crypto.getRandomValues(bytes);
  else
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function FinancePage() {
  const [movements, setMovements] = useState<FinanceMovement[]>([]);
  const [summaries, setSummaries] = useState<FinanceSummary[]>([]);
  const [parties, setParties] = useState<string[]>([]);
  const [properties, setProperties] = useState<
    { id: string; label: string }[]
  >([]);
  const [filters, setFilters] = useState(initialFilter);
  const [selected, setSelected] = useState<FinanceMovement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [adding, setAdding] = useDraftState(
    'ui:features/manager-finance/components/finance-page.tsx:adding',
    false,
  );
  const [notice, setNotice] = useState('');
  const manualRequestId = useRef<string | null>(null);
  const unresolvedCount = summaries.reduce(
    (sum, summary) => sum + summary.unresolvedCount,
    0,
  );

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void (async () => {
          setLoading(true);
          setError('');
          setMovements([]);
          setSummaries([]);
          try {
            const items: FinanceMovement[] = [];
            let summaries: FinanceSummary[] = [];
            let parties: string[] = [];
            let cursor: string | undefined;
            do {
              const page = await listFinance({
                period: filters.period,
                type: filters.type,
                party: filters.party || undefined,
                query: filters.query.trim() || undefined,
                limit: PAGE_SIZE,
                cursor,
              });
              items.push(...page.items.map(mapFinanceMovement));
              summaries = page.summaries.map(mapFinanceSummary);
              parties = page.parties;
              cursor = page.nextCursor ?? undefined;
            } while (cursor && items.length < MAX_ROWS);
            if (!cancelled) {
              setMovements(items);
              setSummaries(summaries);
              setParties(parties);
            }
          } catch (loadError) {
            if (!cancelled) {
              setMovements([]);
              setSummaries([]);
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : 'تعذر تحميل السجل المالي.',
              );
            }
          } finally {
            if (!cancelled) setLoading(false);
          }
        })();
      },
      filters.query.trim() ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [filters, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    void getFinanceOptions()
      .then((options) => {
        if (!cancelled)
          setProperties(
            options.properties.map((property) => ({
              id: property.id,
              label: `${property.code} — ${property.title}`,
            })),
          );
      })
      .catch(() => {
        // The page-level error state already reports an unavailable ledger.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <ManagerPageShell
      title="المالية"
      actions={
        <Button
          onClick={() => {
            setNotice('');
            manualRequestId.current = null;
            setAdding(true);
          }}
        >
          تسجيل مصروف يدوي
        </Button>
      }
    >
      <div className={styles.scope}>
        <FinanceSummaryCards summaries={summaries} />
        {unresolvedCount > 0 && (
          <Card className={styles.fxWarning}>
            <p role="status">
              توجد {unresolvedCount} حركة بعملات أجنبية بانتظار تحويلها إلى
              الدينار الكويتي. لم تُحتسب في الإجماليات أعلاه حتى يكتمل التحويل.
            </p>
          </Card>
        )}
        <FinanceFilters
          value={filters}
          onChange={setFilters}
          parties={parties}
        />
        <div className={styles.layout}>
          <aside>
            <Card>
              <h2>ملخص الحركة</h2>
              <dl className={styles.facts}>
                {([
                  // A real COUNT — the same shared count-up as everywhere else.
                  [
                    'عدد الحركات',
                    <AnimatedCount
                      key="movement-count"
                      value={summaryCount(summaries)}
                    />,
                  ],
                  [
                    'إجمالي الداخل',
                    summaryMoney(summaries, (totals) => totals.income),
                  ],
                  [
                    'إجمالي الخارج',
                    summaryMoney(
                      summaries,
                      (totals) =>
                        totals.commission + totals.payroll + totals.manual,
                    ),
                  ],
                  [
                    'المصاريف اليدوية',
                    summaryMoney(summaries, (totals) => totals.manual),
                  ],
                  [
                    'صافي الحركة',
                    summaryMoney(summaries, (totals) => totals.net),
                  ],
                ] as Array<[string, ReactNode]>).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </aside>
          <section aria-label="سجل الحركة المالية">
            <h2>سجل الحركة المالية</h2>
            {loading && (
              <Card>
                <p role="status">جارٍ تحميل الحركة المالية...</p>
              </Card>
            )}
            {!loading && error && (
              <Card>
                <p role="alert">{error}</p>
                <Button onClick={() => setRefreshKey((key) => key + 1)}>
                  إعادة المحاولة
                </Button>
              </Card>
            )}
            <div className={styles.movements}>
              {movements.map((movement) => (
                <FinanceMovementCard
                  key={movement.id}
                  movement={movement}
                  onOpen={() => setSelected(movement)}
                />
              ))}
            </div>
            {!loading && !error && !movements.length && (
              <Card>
                <p>لا توجد حركات تطابق الفلاتر.</p>
                <Button onClick={() => setFilters(initialFilter)}>
                  إعادة ضبط الفلاتر
                </Button>
              </Card>
            )}
          </section>
        </div>
        {selected && (
          <FinanceDetailsDrawer
            movement={selected}
            onClose={() => setSelected(null)}
          />
        )}
        {adding && (
          <ManualExpenseModal
            properties={properties}
            onClose={() => setAdding(false)}
            onSave={async (draft: ManualExpenseDraft) => {
              manualRequestId.current ??= requestId();
              await createManualExpense({
                type: draft.expenseType,
                amount: filsToAmount(draft.amountFils),
                currency: draft.currency,
                date: draft.date,
                ...(draft.propertyId ? { propertyId: draft.propertyId } : {}),
                description: draft.description,
                requestId: manualRequestId.current,
              });
              manualRequestId.current = null;
              setAdding(false);
              setFilters(initialFilter);
              setNotice('تم تسجيل المصروف اليدوي');
              setRefreshKey((key) => key + 1);
            }}
          />
        )}
        <Toast message={notice} onDismiss={() => setNotice('')} />
      </div>
    </ManagerPageShell>
  );
}
