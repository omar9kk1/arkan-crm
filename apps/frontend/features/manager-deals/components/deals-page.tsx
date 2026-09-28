'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { StatCard } from '../../../components/ui/stat-card';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
import { useMockDeals } from '../use-mock-deals';
import { money, type MockDeal } from '../mock-data';
import { DealCard } from './deal-card';
import { DealDetailsDrawer } from './deal-details-drawer';
import { DealCreateWizard } from './deal-create-wizard';
import { PayrollExpensesTab } from './payroll-expenses-tab';
import styles from './deals.module.css';
export function DealsPage() {
  const { deals, properties, create } = useMockDeals();
  const [tab, setTab] = useState('log');
  const [creating, setCreating] = useDraftState(
    'ui:features/manager-deals/components/deals-page.tsx:creating',
    false,
  );
  const [selected, setSelected] = useState<MockDeal | null>(null);
  const [notice, setNotice] = useState('');
  const month = new Date().toISOString().slice(0, 7);
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
          بيانات تجريبية فقط • التغييرات محلية وتختفي عند تحديث الصفحة.
        </p>
        <div className={styles.stats}>
          {[
            { title: 'إجمالي الصفقات', value: deals.length },
            {
              title: 'قيمة الصفقات',
              value: money(deals.reduce((sum, deal) => sum + deal.price, 0)),
            },
            {
              title: 'إجمالي العمولات',
              value: money(
                deals.reduce((sum, deal) => sum + deal.companyCommission, 0),
              ),
            },
            {
              title: 'صفقات هذا الشهر',
              value: deals.filter((deal) => deal.date.startsWith(month)).length,
            },
          ].map((item) => (
            <StatCard
              key={item.title}
              {...item}
              icon="deals"
              hint="ضمن العينة التجريبية"
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
            <p>
              لا توجد صفقات تحت المراجعة في العينة الحالية. هذا القسم للمعاينة
              فقط.
            </p>
          </Card>
        </section>
        <Toast message={notice} onDismiss={() => setNotice('')} />
        {selected && (
          <DealDetailsDrawer
            deal={selected}
            onClose={() => setSelected(null)}
          />
        )}
        {creating && (
          <DealCreateWizard
            properties={properties}
            onClose={() => setCreating(false)}
            onCreate={(draft) => {
              if (!create(draft)) return false;
              setCreating(false);
              setTab('log');
              setNotice('تم إنشاء الصفقة وتسجيل العمولات وتحديث حالة العقار');
              return true;
            }}
          />
        )}
      </div>
    </ManagerPageShell>
  );
}
