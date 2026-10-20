'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';
import type { EmployeeClient } from '../client-model';

import { Toast } from '../../../components/ui/toast';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import {
  employeeClientFromDto,
  filterClients,
  localDate,
  tabs,
} from '../client-model';
import { ownerFromRegistryContact } from '../../manager-clients/client-model';
import { EmployeeClientCard } from './client-cards';
import { EmployeeClientDetailsDrawer } from './employee-client-details-drawer';
import { AddClientModal } from './add-client-modal';
import {
  canViewContact,
  useContacts,
  type RegistryContact,
} from '../../../lib/contact-registry';
import { useAuth } from '../../auth/components/auth-provider';
import { useClients } from '../../../lib/use-clients';
import { createClient, createClientFollowUp, updateClient } from '../../../lib/api/clients-api';
import { bundlePropertyInterests } from './request-wizard/client-request-bundle';
import { requestOpenProperty } from '../../notifications/open-property';
import { PROPERTY_QUERY_PARAM } from '../../../lib/property-reveal';
import { Role } from '@arkan/shared';
import { OwnerCard } from '../../manager-clients/components/owner-card';
import { OwnerDetailsDrawer } from '../../manager-clients/components/owner-details-drawer';
import { ContactDetailsDrawer } from '../../manager-clients/components/contact-details-drawer';
import styles from './clients.module.css';

export type OpenFile = {
  kind: 'client' | 'owner' | 'contact';
  id: string;
};

function ownerFromContact(contact: RegistryContact) {
  return ownerFromRegistryContact(contact);
}

export default function EmployeeClientsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const {
    clients: clientRows,
    stats,
    loading: clientsLoading,
    error: clientsError,
    refresh: refreshClients,
  } = useClients();
  const clients = useMemo(() => clientRows.map(employeeClientFromDto), [clientRows]);
  // Owners/brokers read the resource form so each tab keeps its own loading
  // and error states while the real API data is fetched.
  const ownersResource = useContacts('OWNER');
  const brokersResource = useContacts('BROKER');
  const contacts = useMemo(
    () => ownersResource.contacts.filter((contact) => canViewContact(user, contact)),
    [ownersResource.contacts, user],
  );
  const brokers = useMemo(
    () => brokersResource.contacts.filter((contact) => canViewContact(user, contact)),
    [brokersResource.contacts, user],
  );
  const contactsLoading = ownersResource.loading;
  const contactsError = ownersResource.error;
  const brokersLoading = brokersResource.loading;
  const brokersError = brokersResource.error;

  const [query, setQuery] = useState('');
  const today = localDate();
  const [tab, setTab] = useState('all');
  const [category, setCategory] = useState<'clients' | 'owners' | 'brokers'>('clients');
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [clientContext, setClientContext] = useDraftState<Record<string, EmployeeClient>>(
    'employee-clients:context',
    {},
  );
  const [selectedContact, setSelectedContact] = useState<RegistryContact | null>(null);
  const [ownerFile, setOwnerFile] = useState<string | null>(null);

  const filtered = filterClients(clients, tab, today).filter((c) =>
    `${c.name} ${c.phone}`.includes(query),
  );

  const ownersList = contacts ?? [];
  const brokersList = brokers ?? [];
  const ownersMapped = ownersList.map(ownerFromContact).filter((o) => o.name.includes(query) || o.phone.includes(query));
  const brokersMapped = brokersList.map(ownerFromContact).filter((o) => o.name.includes(query) || o.phone.includes(query));

  const selected = selectedId
    ? clients.find((c) => c.id === selectedId) || clientContext[selectedId]
    : null;

  return (
    <EmployeePageShell
      title="العملاء"
      description="متابعة عملاءك وملفات الملاك والوسطاء المرتبطين بك، وآخر تواصل والمتابعات."
      actions={<Button onClick={() => setAdding(true)}>إضافة عميل</Button>}
    >
      {category === 'clients' && (clientsLoading || clientsError) && (
        <p className={styles.muted} role="status" aria-live="polite">
          {clientsLoading ? 'جارٍ تحميل عملاءك…' : `تعذر تحميل العملاء: ${clientsError}`}
        </p>
      )}

      {/* Always visible on every category tab: the four cards keep their
          position above the search/tabs row. */}
      <div className={styles.stats}>
        {[
          { title: 'إجمالي عملاءك', value: stats ? stats.totalClients : '—' },
          { title: 'عملاء يحتاجون متابعة', value: stats ? stats.clientsNeedingFollowUp : '—' },
          { title: 'متابعات متأخرة', value: stats ? stats.clientsLate : '—' },
          { title: 'طلبات بدون عقار مناسب', value: stats ? stats.clientsWithoutProperty : '—' },
        ].map((item) => (
          <StatCard
            key={item.title}
            title={item.title}
            value={item.value}
            icon="users"
            hint="أرقام فعلية من قاعدة البيانات"
          />
        ))}
      </div>

      {/* Approved Astra pattern: category tabs + search share one row, the
          client filter bar stays on its own row below. */}
      <div className={styles.toolbar}>
        <SegmentedTabs
          id="employee-clients-category"
          label="تصنيف العملاء"
          value={category}
          onChange={(value) => setCategory(value as 'clients' | 'owners' | 'brokers')}
          items={[
            { id: 'clients', label: 'العملاء', count: stats?.totalClients },
            { id: 'owners', label: 'الملاك', count: stats?.owners },
            { id: 'brokers', label: 'الوسطاء', count: stats?.brokers },
          ]}
        />
        <SearchBar
          label="البحث في العملاء"
          placeholder="ابحث بالاسم أو الهاتف"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {category === 'clients' && (
        <>
          <SegmentedTabs
            id="employee-clients-tabs"
            label="فلترة العملاء"
            value={tab}
            onChange={setTab}
            items={tabs}
          />
          <div className={styles.list}>
            {filtered.map((c) => (
              <EmployeeClientCard
                key={c.id}
                client={c}
                onOpen={() => {
                  setClientContext((p) => ({ ...p, [c.id]: c }));
                  setSelectedId(c.id);
                }}
              />
            ))}
            {filtered.length === 0 && (
              <Card>لا يوجد عملاء يطابقون البحث والفلاتر.</Card>
            )}
          </div>
        </>
      )}

      {category === 'owners' && (contactsLoading || contactsError) && (
        <p className={styles.muted} role="status" aria-live="polite">
          {contactsLoading ? 'جارٍ تحميل الملاك…' : `تعذر تحميل الملاك: ${contactsError}`}
        </p>
      )}

      {category === 'owners' && (
        <div className={styles.list}>
          {ownersMapped.map((o) => (
            <OwnerCard key={o.id} owner={o} onOpen={() => setOwnerFile(o.id)} />
          ))}
        </div>
      )}

      {category === 'brokers' && (brokersLoading || brokersError) && (
        <p className={styles.muted} role="status" aria-live="polite">
          {brokersLoading ? 'جارٍ تحميل الوسطاء…' : `تعذر تحميل الوسطاء: ${brokersError}`}
        </p>
      )}

      {category === 'brokers' && (
        <div className={styles.list}>
          {brokersMapped.map((o) => (
            <OwnerCard
              key={o.id}
              owner={o}
              onOpen={() => {
                const contact = brokersList.find((c) => `owner-${c.id}` === o.id);
                if (contact) setSelectedContact(contact);
                setOwnerFile(o.id);
              }}
            />
          ))}
        </div>
      )}

      {selected && (
        <EmployeeClientDetailsDrawer
          client={selected}
          onClose={() => setSelectedId(null)}
          // Same deep-link contract as the owner cards: the properties page
          // opens the EXACT property in its existing drawer.
          onOpenProperty={(propertyId) => {
            requestOpenProperty(propertyId);
            const route =
              user?.role === Role.MANAGER
                ? '/manager/properties'
                : '/employee/properties';
            router.push(
              `${route}?${PROPERTY_QUERY_PARAM}=${encodeURIComponent(propertyId)}`,
            );
          }}
          onFollowUp={async (item) => {
            try {
              await createClientFollowUp(selected.id, {
                dueAt: item.next,
                method: item.type,
                outcome: item.result,
                note: item.note || undefined,
              });
            } catch (cause) {
              const message =
                cause instanceof Error ? cause.message : 'تعذر حفظ المتابعة. حاول مرة أخرى.';
              return message;
            }
            await refreshClients();
            return null;
          }}
        />
      )}

      {ownerFile && category === 'owners' && (
        <OwnerDetailsDrawer
          owner={ownersMapped.find((o) => o.id === ownerFile)!}
          onClose={() => setOwnerFile(null)}
        />
      )}

      {ownerFile && category === 'brokers' && selectedContact && (
        <ContactDetailsDrawer
          contact={selectedContact}
          onClose={() => {
            setOwnerFile(null);
            setSelectedContact(null);
          }}
        />
      )}

      {adding && (
        <AddClientModal
          clients={clients}
          onClose={() => setAdding(false)}
          onSave={async (client: EmployeeClient) => {
            const isExisting = clients.some((item) => item.id === client.id);
            // Real linked selections from the wizard (validated snapshots only)
            // are persisted with the save; the backend re-validates every
            // Property.id and refuses an invalid/unavailable/invisible one, so
            // success here means the link is actually in the database.
            const interests = client.requestBundle
              ? bundlePropertyInterests(client.requestBundle)
              : [];
            const interestPayload = interests.length
              ? { propertyInterests: interests }
              : {};
            try {
              if (isExisting) {
                await updateClient(client.id, {
                  name: client.name,
                  phone: client.phone,
                  notes: client.notes,
                  ...interestPayload,
                });
              } else {
                await createClient({
                  name: client.name,
                  phone: client.phone,
                  notes: client.notes,
                  ...interestPayload,
                });
              }
            } catch (cause) {
              const message =
                cause instanceof Error ? cause.message : 'تعذر حفظ العميل. حاول مرة أخرى.';
              setNotice(message);
              return false;
            }
            await refreshClients();
            setAdding(false);
            setTab('all');
            setQuery('');
            setNotice('تم حفظ العميل بنجاح');
            return true;
          }}
        />
      )}

      <Toast message={notice} onDismiss={() => setNotice('')} />
    </EmployeePageShell>
  );
}
