'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { createPreviewMovements } from '../mock-sources';
import {
  filterMovements,
  totalMoney,
  manualMovement,
  type FinanceFilter,
  type FinanceMovement,
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
export function FinancePage() {
  const [movements, setMovements] = useState(createPreviewMovements);
  const [filters, setFilters] = useState(initialFilter);
  const [selected, setSelected] = useState<FinanceMovement | null>(null);
  const [adding, setAdding] = useDraftState(
    'ui:features/manager-finance/components/finance-page.tsx:adding',
    false,
  );
  const [notice, setNotice] = useState('');
  const visible = filterMovements(movements, filters);

  return (
    <ManagerPageShell
      title="المالية"
      description="متابعة كل حركة مالية بالتفاصيل: العمولات الداخلة، عمولات الموظفين، المرتبات، والمصاريف اليدوية."
      actions={
        <Button
          onClick={() => {
            setNotice('');
            setAdding(true);
          }}
        >
          تسجيل مصروف يدوي
        </Button>
      }
    >
      <div className={styles.scope}>
        <p className={styles.muted}>
          معاينة محلية تجمع عينات من الصفقات والعمولات والرواتب والمصاريف. لا
          توجد بيانات محفوظة أو ربط فعلي بالصفحات الأخرى.
        </p>
        <FinanceSummaryCards movements={visible} />
        <FinanceFilters
          value={filters}
          onChange={setFilters}
          parties={[...new Set(movements.map((item) => item.party))]}
        />
        <div className={styles.layout}>
          <aside>
            <Card>
              <h2>ملخص الحركة</h2>
              <p>حسب الفلاتر الحالية</p>
              <dl className={styles.facts}>
                {[
                  ['عدد الحركات', String(visible.length)],
                  [
                    'إجمالي الداخل',
                    totalMoney(visible, (totals) => totals.income),
                  ],
                  [
                    'إجمالي الخارج',
                    totalMoney(
                      visible,
                      (totals) =>
                        totals.commission + totals.payroll + totals.manual,
                    ),
                  ],
                  [
                    'المصاريف اليدوية',
                    totalMoney(visible, (totals) => totals.manual),
                  ],
                  ['صافي الحركة', totalMoney(visible, (totals) => totals.net)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className={styles.muted}>
                صافي الحركة = الداخل − جميع الحركات الخارجة، بما فيها المصاريف
                اليدوية.
              </p>
            </Card>
          </aside>
          <section aria-label="سجل الحركة المالية">
            <h2>سجل الحركة المالية</h2>
            <div className={styles.movements}>
              {visible.map((movement) => (
                <FinanceMovementCard
                  key={movement.id}
                  movement={movement}
                  onOpen={() => setSelected(movement)}
                />
              ))}
            </div>
            {!visible.length && (
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
            onClose={() => setAdding(false)}
            onSave={(draft) => {
              const item = manualMovement(
                draft,
                globalThis.crypto?.randomUUID?.() ??
                  'local-' + Date.now() + Math.random().toString(36).slice(2),
              );
              setMovements((previous) => [item, ...previous]);
              setFilters(initialFilter);
              setAdding(false);
              setNotice('تم تسجيل المصروف اليدوي');
            }}
          />
        )}
        <Toast message={notice} onDismiss={() => setNotice('')} />
      </div>
    </ManagerPageShell>
  );
}
