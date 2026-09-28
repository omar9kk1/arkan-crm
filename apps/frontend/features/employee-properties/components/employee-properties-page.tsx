'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { Button } from '../../../components/ui/button';
import { SearchBar } from '../../../components/ui/search-bar';
import { Card } from '../../../components/ui/card';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
import { samples, tabs, filterProperties, type Property } from '../model';
import { EmployeePropertyCard } from './employee-property-card';
import { EmployeePropertyDetailsDrawer } from './employee-property-details-drawer';
import { AddPropertyModal } from './add-property-modal';
import common from '../../employee-clients/components/clients.module.css';
import styles from './properties.module.css';
import shared from '../../manager-properties/components/properties.module.css';
export function EmployeePropertiesPage() {
  const [items, setItems] = useState(samples),
    [tab, setTab] = useState('all'),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState<Property | null>(null),
    [form, setForm] = useDraftState<{ property?: Property } | null>(
      'ui:features/employee-properties/components/employee-properties-page.tsx:form',
      null,
    ),
    [notice, setNotice] = useState('');
  const visible = filterProperties(items, tab, query);
  return (
    <EmployeePageShell
      title="العقارات"
      description="إدارة العقارات التي أضفتها أو المخصصة لك للتركيز على التسويق أو متابعة المالك."
      actions={<Button onClick={() => setForm({})}>إضافة عقار</Button>}
    >
      <p className={common.muted}>
        بيانات تجريبية. التخصيص أولوية للتركيز ولا يمنع باقي الموظفين من العمل
        على العقار.
      </p>
      <div className={`${common.toolbar} ${styles.toolbar}`}>
        <div className={styles.tabFrame}>
          <SegmentedTabs
            id="employee-properties"
            label="فلترة العقارات"
            items={tabs.map((item) => ({
              ...item,
              count: filterProperties(items, item.id, '').length,
            }))}
            value={tab}
            onChange={setTab}
          />
        </div>
        <SearchBar
          label="بحث العقارات"
          placeholder="ابحث بالمنطقة أو الكود أو اسم العقار..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {tabs.map((t) => (
        <section
          key={t.id}
          role="tabpanel"
          id={`employee-properties-panel-${t.id}`}
          aria-labelledby={`employee-properties-tab-${t.id}`}
          hidden={tab !== t.id}
          tabIndex={0}
        >
          {tab === t.id && (
            <>
              {[...new Set(visible.map((p) => p.region))].map((region) => (
                <section key={region} className={styles.region}>
                  <h2>{region}</h2>
                  <div className={`${shared.scope} ${shared.propertyGrid}`}>
                    {visible
                      .filter((p) => p.region === region)
                      .map((p) => (
                        <EmployeePropertyCard
                          key={p.id}
                          property={p}
                          onOpen={() => setSelected(p)}
                        />
                      ))}
                  </div>
                </section>
              ))}
              {!visible.length && (
                <Card>لا توجد عقارات تطابق البحث والفلاتر.</Card>
              )}
            </>
          )}
        </section>
      ))}
      {selected && (
        <EmployeePropertyDetailsDrawer
          property={selected}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setForm({ property: selected });
            setSelected(null);
          }}
        />
      )}
      {form && (
        <AddPropertyModal
          property={form.property}
          onClose={() => setForm(null)}
          onSave={(added) => {
            setItems((previous) => [
              ...added,
              ...previous.filter(
                (item) => !added.some((p) => item.id === p.id),
              ),
            ]);
            setForm(null);
            setQuery('');
            setTab('review');
            setNotice('تم إرسال العقار للمراجعة');
          }}
        />
      )}
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </EmployeePageShell>
  );
}
