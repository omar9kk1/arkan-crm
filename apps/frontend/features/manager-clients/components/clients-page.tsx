'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Toast } from '../../../components/ui/toast';
import { AddClientModal } from './add-client-modal';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { SectionHeader } from '../../../components/ui/section-header';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
import {
  clients,
  owners,
  matchesPerson,
  type ClientSample,
  type OwnerSample,
} from '../mock-data';
import { ClientCard } from './client-card';
import { OwnerCard } from './owner-card';
import { ClientDetailsDrawer } from './client-details-drawer';
import { OwnerDetailsDrawer } from './owner-details-drawer';
import styles from './clients.module.css';
type OpenFile =
  | { kind: 'client'; person: ClientSample }
  | { kind: 'owner'; person: OwnerSample };
export function ClientsPage() {
  const [items, setItems] = useState<ClientSample[]>([...clients]);
  const [adding, setAdding] = useDraftState(
    'ui:features/manager-clients/components/clients-page.tsx:adding',
    false,
  );
  const [notice, setNotice] = useState('');
  const clientCount = 28 + items.length - clients.length;
  const [tab, setTab] = useState('clients');
  const [query, setQuery] = useState('');
  const [file, setFile] = useState<OpenFile | null>(null);
  const visibleClients = items.filter((person) => matchesPerson(person, query));
  const visibleOwners = owners.filter((person) => matchesPerson(person, query));
  return (
    <ManagerPageShell
      title="العملاء"
      actions={
        <Button
          compactOnMobile
          onClick={() => {
            setNotice('');
            setAdding(true);
          }}
        >
          إضافة عميل
        </Button>
      }
      description="إدارة ملفات العملاء والملاك، ومعرفة الموظفين المسؤولين وسجل المتابعات."
    >
      <div className={styles.scope}>
        <p className={styles.secondary}>
          بيانات وأرقام تجريبية فقط • القوائم تعرض عينة مصغرة، وأرقام الهاتف
          توضيحية.
        </p>
        <div className={styles.stats}>
          {[
            { title: 'عملاء نشطين', value: clientCount },
            { title: 'ملاك مسجلين', value: 16 },
            { title: 'متابعات متأخرة', value: 7 },
            { title: 'متابعة هذا الأسبوع', value: 54 },
          ].map((item) => (
            <StatCard
              key={item.title}
              {...item}
              icon="users"
              hint="معاينة بيانات البروتوتايب"
            />
          ))}
        </div>
        <div className={styles.toolbar}>
          <SegmentedTabs
            id="people"
            label="العملاء والملاك"
            items={[
              { id: 'clients', label: 'العملاء', count: clientCount },
              { id: 'owners', label: 'الملاك', count: 16 },
            ]}
            value={tab}
            onChange={setTab}
          />
          <SearchBar
            label={
              tab === 'clients'
                ? 'البحث باسم العميل أو الهاتف'
                : 'البحث باسم المالك أو الهاتف'
            }
            placeholder="ابحث باسم العميل أو الهاتف..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SectionHeader
          title={tab === 'clients' ? 'ملفات العملاء' : 'ملفات الملاك'}
          description="اضغط على الملف للاطلاع على التفاصيل والمتابعات."
        />
        <section
          role="tabpanel"
          tabIndex={0}
          id="people-panel-clients"
          aria-labelledby="people-tab-clients"
          hidden={tab !== 'clients'}
        >
          <div className={styles.peopleList}>
            {visibleClients.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                onOpen={() => setFile({ kind: 'client', person: client })}
              />
            ))}
          </div>
          {!visibleClients.length && (
            <p className={styles.empty}>لا يوجد عملاء مطابقون للبحث.</p>
          )}
        </section>
        <section
          role="tabpanel"
          tabIndex={0}
          id="people-panel-owners"
          aria-labelledby="people-tab-owners"
          hidden={tab !== 'owners'}
        >
          <div className={styles.peopleList}>
            {visibleOwners.map((owner) => (
              <OwnerCard
                key={owner.id}
                owner={owner}
                onOpen={() => setFile({ kind: 'owner', person: owner })}
              />
            ))}
          </div>
          {!visibleOwners.length && (
            <p className={styles.empty}>لا يوجد ملاك مطابقون للبحث.</p>
          )}
        </section>
        {adding && (
          <AddClientModal
            clients={items}
            onClose={() => setAdding(false)}
            onSave={(client) => {
              setItems((previous) => [
                client,
                ...previous.filter((item) => item.id !== client.id),
              ]);
              setAdding(false);
              setTab('clients');
              setQuery('');
              setNotice('تم إضافة العميل والطلب مؤقتًا');
            }}
          />
        )}
        <Toast message={notice} onDismiss={() => setNotice('')} />
        {file?.kind === 'client' && (
          <ClientDetailsDrawer
            key={file.person.id}
            client={file.person}
            onClose={() => setFile(null)}
          />
        )}
        {file?.kind === 'owner' && (
          <OwnerDetailsDrawer
            key={file.person.id}
            owner={file.person}
            onClose={() => setFile(null)}
          />
        )}
      </div>
    </ManagerPageShell>
  );
}
