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
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
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
import {
  useVisibleContacts,
  type RegistryContact,
} from '../../../lib/contact-registry';
import { useAuth } from '../../auth/components/auth-provider';
import { matchesPerson } from '../../../lib/search';
import { ContactCard } from '../../manager-clients/components/contact-card';
import { ContactDetailsDrawer } from '../../manager-clients/components/contact-details-drawer';
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
  const { user } = useAuth();
  const [category, setCategory] = useState<'clients' | 'owners' | 'brokers'>(
    'clients',
  );
  const [contactId, setContactId] = useState<string | null>(null);
  // Privacy: only the employee's own records and shared company records.
  const owners = useVisibleContacts(user, 'OWNER');
  const brokers = useVisibleContacts(user, 'BROKER');
  const contactList: RegistryContact[] =
    category === 'owners' ? owners : category === 'brokers' ? brokers : [];
  const visibleContacts = contactList.filter((contact) =>
    matchesPerson(contact, query),
  );
  const selectedContact = contactList.find(
    (contact) => contact.id === contactId,
  );
  const selected =
    clients.find((c) => c.id === selectedId) ||
    (clientContext?.id === selectedId ? clientContext : undefined);
  const visible = filterClients(clients, tab, query);
  return (
    <EmployeePageShell
      title="العملاء"
      description="متابعة عملاءك وملفات الملاك والوسطاء المرتبطين بك، وآخر تواصل والمتابعات."
      actions={<Button onClick={() => setAdding(true)}>إضافة عميل</Button>}
    >
      <p className={styles.muted}>
        بيانات تجريبية مرتبطة بالموظف أحمد محمد للمعاينة فقط.
      </p>
      <div className={styles.toolbar}>
        <SegmentedTabs
          id="employee-contacts"
          label="جهات التواصل"
          items={[
            { id: 'clients', label: 'العملاء', count: clients.length },
            { id: 'owners', label: 'الملاك', count: owners.length },
            { id: 'brokers', label: 'الوسطاء', count: brokers.length },
          ]}
          value={category}
          onChange={(value) => setCategory(value as typeof category)}
        />
      </div>
      {category === 'clients' && (
        <>
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
        </>
      )}
      {(category === 'owners' || category === 'brokers') && (
        <>
          <div className={styles.toolbar}>
            <SearchBar
              label="بحث جهات التواصل"
              placeholder="ابحث بالاسم أو الهاتف..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={styles.list}>
            {visibleContacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                onOpen={() => setContactId(contact.id)}
              />
            ))}
            {!visibleContacts.length && (
              <Card>لا توجد جهات تواصل مطابقة للبحث.</Card>
            )}
          </div>
          <p className={styles.muted}>
            تظهر هنا سجلات جهات التواصل التي سجّلتها بنفسك فقط؛ لا تُعرض سجلات
            الموظفين الآخرين ولا السجلات المشتركة.
          </p>
        </>
      )}
      {selectedContact && (
        <ContactDetailsDrawer
          key={selectedContact.id}
          contact={selectedContact}
          onClose={() => setContactId(null)}
        />
      )}
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
