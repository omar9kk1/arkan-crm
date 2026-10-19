'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { Button } from '../../../components/ui/button';
import { SearchBar } from '../../../components/ui/search-bar';
import { Card } from '../../../components/ui/card';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { tabs, filterProperties, type Property } from '../model';
import { mapPropertyFromApi } from '../../../lib/property-adapter';
import { usePropertyList } from '../../../lib/use-property-list';
import { EmployeePropertyCard } from './employee-property-card';
import { EmployeePropertyDetailsDrawer } from './employee-property-details-drawer';
import { AddPropertyModal } from './add-property-modal';
import { useAuth } from '../../auth/components/auth-provider';
import common from '../../employee-clients/components/clients.module.css';
import styles from './properties.module.css';
import shared from '../../manager-properties/components/properties.module.css';

const PAGE_SIZE = 50;

export function EmployeePropertiesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [form, setForm] = useDraftState<{ property?: Property } | null>(
    'ui:features/employee-properties/components/employee-properties-page.tsx:form',
    null,
  );
  const [notice, setNotice] = useState('');

  // The rows, the cursor, the loading/error flags, the notification refresh
  // signal and the notification deep-link all come from the shared list core
  // (`maxPagesPerLoad` stays at its default of one page per load). This page
  // keeps the tabs, the filtering and the exact markup.
  const {
    items,
    nextCursor,
    loading,
    loadingMore,
    error,
    refetch,
    loadMore,
    selected,
    setSelected,
  } = usePropertyList<Property>({
    pageSize: PAGE_SIZE,
    mapProperty: mapPropertyFromApi,
    viewer: user,
    onOpenError: setNotice,
  });

  const visible = filterProperties(items, tab, query);
  const regions = [...new Set(visible.map((p) => p.region))].filter(Boolean);

  return (
    <EmployeePageShell
      title="العقارات"
      description="إدارة العقارات التي أضفتها أو المخصصة لك للتركيز على التسويق أو متابعة المالك."
      actions={
        <Button onClick={() => setForm({})} disabled={!user}>
          إضافة عقار
        </Button>
      }
    >
      <div className={`${common.toolbar} ${styles.toolbar}`}>
        <div className={styles.tabFrame}>
          <SegmentedTabs
            id="employee-properties"
            label="فلترة العقارات"
            items={tabs.map((item) => ({
              ...item,
              // The count uses the SAME rule as the panel filter. It is shown
              // only when the full set is loaded (no pending cursor and not
              // mid-request): while a cursor is live the loaded set is a
              // partial view, so a count would be a lower bound masquerading
              // as a total.
              count:
                !loading && nextCursor === null
                  ? filterProperties(items, item.id, '').length
                  : undefined,
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

      {loading ? (
        <Card role="status" aria-live="polite">
          جارٍ تحميل العقارات…
        </Card>
      ) : error ? (
        <Card>
          <h2>تعذر تحميل العقارات</h2>
          <p>{error}</p>
          <Button type="button" onClick={refetch}>
            إعادة المحاولة
          </Button>
        </Card>
      ) : items.length === 0 ? (
        <Card>لم يسجّل الخادم أي عقار حتى الآن.</Card>
      ) : (
        <>
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
                  {regions.map((region) => (
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
          {nextCursor && (
            <div className={styles.loadMore}>
              <Button
                type="button"
                variant="ghost"
                onClick={loadMore}
                disabled={loadingMore}
                aria-busy={loadingMore}
              >
                {loadingMore ? 'جارٍ التحميل…' : 'تحميل المزيد'}
              </Button>
            </div>
          )}
        </>
      )}

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
          // One mounted wizard per target: switching between a property and a
          // fresh one always re-derives its form instead of reusing the
          // previous target's state.
          key={form.property?.id ?? 'new'}
          property={form.property}
          onClose={() => setForm(null)}
          onSave={() => {
            setForm(null);
            setNotice(
              form.property
                ? 'تم حفظ التعديلات وإعادة الإرسال للمراجعة'
                : 'تم إرسال العقار للمراجعة',
            );
            // The backend is the source of truth: reload instead of splicing a
            // client-built record into the list.
            refetch();
          }}
        />
      )}
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </EmployeePageShell>
  );
}
