'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { StatCard } from '../../../components/ui/stat-card';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { useDeals } from '../use-deals';
import { filsMoney, type Deal } from '../deal-model';
import { DealCard } from './deal-card';
import { DealDetailsDrawer } from './deal-details-drawer';
import { DealCreateWizard } from './deal-create-wizard';
import { PayrollExpensesTab } from './payroll-expenses-tab';
import styles from './deals.module.css';
export function DealsPage() {
  const { deals, properties, clients, employees, loading, error, create, refreshDeal } =
    useDeals();
  const [tab, setTab] = useState('log');
  const [creating, setCreating] = useDraftState(
    'ui:features/manager-deals/components/deals-page.tsx:creating',
    false,
  );
  const [selected, setSelected] = useState<Deal | null>(null);
  const [notice, setNotice] = useState('');
  const month = new Date().toISOString().slice(0, 7);
  const valueFils = deals.reduce((sum, deal) => sum + deal.priceFils, 0n);
  const commissionFils = deals.reduce(
    (sum, deal) => sum + deal.companyCommissionFils,
    0n,
  );
  const monthCount = deals.filter((deal) => deal.date.startsWith(month)).length;
  return (
    <ManagerPageShell
      title="الصفقات"
      description="المدير فقط يسجل الصفقة، والنظام يقترح موظف العقار وموظف العميل من البيانات المسجلة."
      actions={
        <Button
          className={styles.createDealButton}
          onClick={() => {
            setNotice('');
            setCreating(true);
          }}
        >
          تسجيل صفقة جديدة
        </Button>
      }
    >
      <div className={styles.scope}>
        <p className={styles.muted}>
          {loading
            ? 'جارٍ تحميل الصفقات…'
            : error
              ? error
              : 'الصفقات المسجلة ضمن نطاق صلاحياتك.'}
        </p>
        <div className={styles.stats}>
          {[
            { title: 'إجمالي الصفقات', value: deals.length },
            {
              title: 'قيمة الصفقات',
              value: filsMoney(valueFils),
            },
            {
              title: 'إجمالي العمولات',
              value: filsMoney(commissionFils),
            },
            {
              title: 'صفقات هذا الشهر',
              value: monthCount,
            },
          ].map((item) => (
            <StatCard
              key={item.title}
              {...item}
              icon="deals"
              hint="ضمن السجل"
            />
          ))}
        </div>
        <SegmentedTabs
          id="deals"
          label="أقسام الصفقات"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'log', label: 'سجل الصفقات', count: deals.length },
            { id: 'payroll', label: 'المرتبات والمصاريف' },
            { id: 'review', label: 'تحت المراجعة', count: 0 },
          ]}
        />
        <section
          className={styles.tabPanel}
          role="tabpanel"
          tabIndex={0}
          id="deals-panel-log"
          aria-labelledby="deals-tab-log"
          hidden={tab !== 'log'}
        >
          <p>
            كل صفقة تغيّر حالة العقار إلى تم البيع أو تم التأجير دون حذف العقار.
          </p>
          {!loading && !error && deals.length === 0 && (
            <p className={styles.muted}>لا توجد صفقات مسجلة بعد.</p>
          )}
          <div className={styles.cards}>
            {deals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                onOpen={() => setSelected(deal)}
              />
            ))}
          </div>
        </section>
        <section
          className={styles.tabPanel}
          role="tabpanel"
          tabIndex={0}
          id="deals-panel-payroll"
          aria-labelledby="deals-tab-payroll"
          hidden={tab !== 'payroll'}
        >
          <PayrollExpensesTab />
        </section>
        <section
          className={styles.tabPanel}
          role="tabpanel"
          tabIndex={0}
          id="deals-panel-review"
          aria-labelledby="deals-tab-review"
          hidden={tab !== 'review'}
        >
          <Card>
            <h2>تحت المراجعة</h2>
            <p>لا توجد صفقات تحت المراجعة.</p>
          </Card>
        </section>
        <Toast message={notice} onDismiss={() => setNotice('')} />
        {selected && (
          <DealDetailsDrawer
            deal={selected}
            onClose={() => setSelected(null)}
            onRefresh={() => refreshDeal(selected.id)}
          />
        )}
        {creating && (
          <DealCreateWizard
            properties={properties}
            clients={clients}
            employees={employees}
            onClose={() => setCreating(false)}
            onCreate={async (draft) => {
              const failure = await create(draft);
              if (failure) return failure;
              setCreating(false);
              setTab('log');
              setNotice('تم إنشاء الصفقة وتسجيل العمولات وتحديث حالة العقار');
              return null;
            }}
          />
        )}
      </div>
    </ManagerPageShell>
  );
}
