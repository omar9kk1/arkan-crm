'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';
import type { EmployeeClient } from '../client-model';

import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
import {
  createClients,
  filterClients,
  isLate,
  localDate,
  tabs,
} from '../client-model';
import { EmployeeClientCard } from './client-cards';
import { EmployeeClientDetailsDrawer } from './employee-client-details-drawer';
import { AddClientModal } from './add-client-modal';
import styles from './clients.module.css';
export function EmployeeClientsPage() {
  const [clients, setClients] = useState(createClients),
    [tab, setTab] = useState('all'),
    [query, setQuery] = useState(''),
    [selectedId, setSelectedId] = useDraftState<string | null>(
      'ui:features/employee-clients/components/employee-clients-page.tsx:selectedId',
      null,
    ),
    [adding, setAdding] = useDraftState(
      'ui:features/employee-clients/components/employee-clients-page.tsx:adding',
      false,
    ),
    [notice, setNotice] = useState('');
  const [clientContext, setClientContext] =
    useDraftState<EmployeeClient | null>('ui:client-context', null);
  const selected =
    clients.find((c) => c.id === selectedId) ||
    (clientContext?.id === selectedId ? clientContext : undefined);
  const visible = filterClients(clients, tab, query);
  return (
    <EmployeePageShell
      title="العملاء"
      description="متابعة عملاءك، طلباتهم، آخر تواصل، والمتابعات القادمة والمتأخرة."
      actions={<Button onClick={() => setAdding(true)}>إضافة عميل</Button>}
    >
      <p className={styles.muted}>
        بيانات تجريبية مرتبطة بالموظف أحمد محمد للمعاينة فقط.
      </p>
      <div className={styles.stats}>
        {[
          ['إجمالي عملاءك', clients.length],
          [
            'عملاء يحتاجون متابعة',
            clients.filter((c) => !c.next || c.next <= localDate()).length,
          ],
          ['متابعات متأخرة', clients.filter((c) => isLate(c)).length],
          [
            'طلبات بدون عقار مناسب',
            clients.filter((c) => !c.properties.length).length,
          ],
        ].map(([title, value]) => (
          <StatCard
            key={title}
            title={String(title)}
            value={value}
            icon="users"
            hint="ضمن العينة التجريبية"
          />
        ))}
      </div>
      <div className={styles.toolbar}>
        <SegmentedTabs
          id="employee-clients"
          label="فلترة العملاء"
          items={tabs}
          value={tab}
          onChange={setTab}
        />
        <SearchBar
          label="بحث العملاء"
          placeholder="ابحث باسم العميل أو الهاتف أو نوع الطلب..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {tabs.map((item) => (
        <section
          key={item.id}
          role="tabpanel"
          id={`employee-clients-panel-${item.id}`}
          aria-labelledby={`employee-clients-tab-${item.id}`}
          hidden={tab !== item.id}
          tabIndex={0}
        >
          {tab === item.id && (
            <div className={styles.list}>
              {visible.map((client) => (
                <EmployeeClientCard
                  key={client.id}
                  client={client}
                  onOpen={() => {
                    setClientContext(client);
                    setSelectedId(client.id);
                  }}
                />
              ))}
              {!visible.length && (
                <Card>لا يوجد عملاء يطابقون البحث والفلاتر.</Card>
              )}
            </div>
          )}
        </section>
      ))}
      {selected && (
        <EmployeeClientDetailsDrawer
          key={selected.id}
          client={selected}
          onClose={() => setSelectedId(null)}
          onFollowUp={(item) =>
            setClients((previous) =>
              previous.map((c) =>
                c.id === selected.id
                  ? { ...c, next: item.next, history: [item, ...c.history] }
                  : c,
              ),
            )
          }
        />
      )}
      {adding && (
        <AddClientModal
          clients={clients}
          onClose={() => setAdding(false)}
          onSave={(client) => {
            setClients((previous) => [
              client,
              ...previous.filter((item) => item.id !== client.id),
            ]);
            setTab('all');
            setQuery('');
            setAdding(false);
            setNotice('تم حفظ العميل والطلب مؤقتًا');
          }}
        />
      )}
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </EmployeePageShell>
  );
}
