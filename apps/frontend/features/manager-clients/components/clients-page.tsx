'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { useState } from 'react';
import {
  canViewContact,
  useRegistryContacts,
  type RegistryContact,
} from '../../../lib/contact-registry';
import { createContact } from '../../../lib/api/contacts-api';
import { matchesPerson } from '../../../lib/search';
import { useAuth } from '../../auth/components/auth-provider';
import { Button } from '../../../components/ui/button';
import { Toast } from '../../../components/ui/toast';
import { AddClientModal } from './add-client-modal';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { SectionHeader } from '../../../components/ui/section-header';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import {
  clients,
  owners,
  type ClientSample,
  type OwnerSample,
  type SuitableProperty,
} from '../mock-data';
import { ClientCard } from './client-card';
import { OwnerCard } from './owner-card';
import { ContactCard } from './contact-card';
import { ClientDetailsDrawer } from './client-details-drawer';
import { OwnerDetailsDrawer } from './owner-details-drawer';
import { ContactDetailsDrawer } from './contact-details-drawer';
import { ContactFormModal } from './contact-form-modal';
import styles from './clients.module.css';
type OpenFile =
  | { kind: 'client'; person: ClientSample }
  | { kind: 'owner'; person: OwnerSample }
  | { kind: 'contact'; contact: RegistryContact };

/** Adapts an employee-registered owner registry record to the owner file UI. */
function ownerFromContact(
  contact: RegistryContact,
  propertiesByCode: Map<string, SuitableProperty>,
): OwnerSample {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    lastFollowUp: contact.createdAt || '—',
    status: 'جديد',
    properties: contact.propertyCodes.map(
      (code) =>
        propertiesByCode.get(code) ?? {
          code,
          title: code,
          summary: 'عقار مسجّل من الموظف (بيانات الجلسة فقط).',
        },
    ),
    employees: contact.ownerName
      ? [
          {
            id: contact.ownerUserId || contact.id,
            name: contact.ownerName,
            timeline: [],
          },
        ]
      : [],
  };
}
export function ClientsPage() {
  const { user } = useAuth();
  // Owner/broker records come from `GET /contacts` (the Clients list itself is
  // still the local mock area and is intentionally untouched).
  const {
    contacts: registry,
    loading: contactsLoading,
    error: contactsError,
    refresh: refreshContacts,
  } = useRegistryContacts();
  const [items, setItems] = useState<ClientSample[]>([...clients]);
  const [adding, setAdding] = useDraftState(
    'ui:features/manager-clients/components/clients-page.tsx:adding',
    false,
  );
  const [addingType, setAddingType] = useState<null | 'OWNER' | 'BROKER'>(null);
  const [notice, setNotice] = useState('');
  const clientCount = 28 + items.length - clients.length;
  const [tab, setTab] = useState('clients');
  const [query, setQuery] = useState('');
  const [file, setFile] = useState<OpenFile | null>(null);
  // The manager is authorized to see every owner/broker record.
  const visibleContacts = registry.filter((contact) =>
    canViewContact(user, contact),
  );
  const brokerCount = visibleContacts.filter(
    (contact) => contact.type === 'BROKER',
  ).length;
  const ownerCount =
    owners.length +
    visibleContacts.filter(
      (contact) => contact.type === 'OWNER' && contact.scope === 'EMPLOYEE',
    ).length;
  const propertiesByCode = new Map<string, SuitableProperty>();
  for (const owner of owners) {
    for (const property of owner.properties) {
      propertiesByCode.set(property.code, property);
    }
  }
  const visibleClients = items.filter((person) => matchesPerson(person, query));
  const visibleOwners: OwnerSample[] = [
    ...owners,
    ...visibleContacts
      .filter(
        (contact) => contact.type === 'OWNER' && contact.scope === 'EMPLOYEE',
      )
      .map((contact) => ownerFromContact(contact, propertiesByCode)),
  ].filter((person) => matchesPerson(person, query));
  const visibleBrokers = visibleContacts.filter(
    (contact) => contact.type === 'BROKER' && matchesPerson(contact, query),
  );
  const searchLabel =
    tab === 'clients'
      ? 'البحث باسم العميل أو الهاتف'
      : tab === 'owners'
        ? 'البحث باسم المالك أو الهاتف'
        : 'البحث باسم الوسيط أو الهاتف';
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
      description="إدارة ملفات العملاء والملاك والوسطاء، ومعرفة الموظفين المسؤولين وسجل المتابعات."
    >
      <div className={styles.scope}>
        <p className={styles.secondary}>
          بيانات وأرقام تجريبية فقط • القوائم تعرض عينة مصغرة، وأرقام الهاتف
          توضيحية.
        </p>
        <div className={styles.stats}>
          {[
            { title: 'عملاء نشطين', value: clientCount },
            { title: 'ملاك مسجلين', value: ownerCount },
            { title: 'وسطاء مسجلين', value: brokerCount },
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
            label="العملاء والملاك والوسطاء"
            items={[
              { id: 'clients', label: 'العملاء', count: clientCount },
              { id: 'owners', label: 'الملاك', count: ownerCount },
              { id: 'brokers', label: 'الوسطاء', count: brokerCount },
            ]}
            value={tab}
            onChange={setTab}
          />
          <SearchBar
            label={searchLabel}
            placeholder="ابحث بالاسم أو الهاتف..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <SectionHeader
          title={
            tab === 'clients'
              ? 'ملفات العملاء'
              : tab === 'owners'
                ? 'ملفات الملاك'
                : 'ملفات الوسطاء'
          }
          description="اضغط على الملف للاطلاع على التفاصيل والمتابعات."
        />
        {tab !== 'clients' && (contactsLoading || contactsError) && (
          <p className={styles.secondary} role="status" aria-live="polite">
            {contactsLoading
              ? 'جارٍ تحميل سجل الملاك والوسطاء…'
              : `تعذر تحميل السجل: ${contactsError}`}
          </p>
        )}
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
          <div className={styles.row}>
            <span>
              الملاك المسجلون من الموظفين يظهرون هنا تلقائيًا عند إنشاء عقار
              جديد.
            </span>
            <Button
              variant="ghost"
              compactOnMobile
              onClick={() => setAddingType('OWNER')}
            >
              إضافة مالك
            </Button>
          </div>
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
        <section
          role="tabpanel"
          tabIndex={0}
          id="people-panel-brokers"
          aria-labelledby="people-tab-brokers"
          hidden={tab !== 'brokers'}
        >
          <div className={styles.row}>
            <span>
              سجل الوسطاء مشترك مع خطوة اختيار الوسيط في إنشاء العقار.
            </span>
            <Button
              variant="ghost"
              compactOnMobile
              onClick={() => setAddingType('BROKER')}
            >
              إضافة وسيط
            </Button>
          </div>
          <div className={styles.peopleList}>
            {visibleBrokers.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                onOpen={() => setFile({ kind: 'contact', contact })}
              />
            ))}
          </div>
          {!visibleBrokers.length && (
            <p className={styles.empty}>لا يوجد وسطاء مطابقون للبحث.</p>
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
        {addingType && (
          <ContactFormModal
            type={addingType}
            onClose={() => setAddingType(null)}
            onSave={async ({ name, phone, notes }) => {
              // Ownership is derived server-side from the signed-in manager, so
              // only the entered fields are posted.
              try {
                await createContact({ type: addingType, name, phone, notes });
                refreshContacts();
                setAddingType(null);
                setQuery('');
                setNotice(
                  `تم إضافة ${addingType === 'BROKER' ? 'الوسيط' : 'المالك'} إلى السجل`,
                );
              } catch (cause) {
                setNotice(
                  cause instanceof Error
                    ? cause.message
                    : 'تعذر إضافة السجل. حاول مرة أخرى.',
                );
              }
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
        {file?.kind === 'contact' && (
          <ContactDetailsDrawer
            key={file.contact.id}
            contact={file.contact}
            onClose={() => setFile(null)}
          />
        )}
      </div>
    </ManagerPageShell>
  );
}
