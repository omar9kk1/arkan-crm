'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { useMemo, useState } from 'react';
import {
  useRegistryContacts,
  type RegistryContact,
} from '../../../lib/contact-registry';
import { createClient, updateClient } from '../../../lib/api/clients-api';
import { useClients } from '../../../lib/use-clients';
import type { ClientApiDto } from '../../../lib/api/client-types';
import { useRouter } from 'next/navigation';
import { requestOpenProperty } from '../../notifications/open-property';
import { PROPERTY_QUERY_PARAM } from '../../../lib/property-reveal';
import { matchesPerson } from '../../../lib/search';
import { Button } from '../../../components/ui/button';
import { Toast } from '../../../components/ui/toast';
import { AddClientModal } from './add-client-modal';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { SectionHeader } from '../../../components/ui/section-header';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import {
  type ClientSample,
  type OwnerSample,
  localDate,
  ownerFromRegistryContact,
} from '../client-model';
import { ClientCard } from './client-card';
import { ClientDetailsDrawer } from './client-details-drawer';
import { OwnerCard } from './owner-card';
import { OwnerDetailsDrawer } from './owner-details-drawer';
import { ContactDetailsDrawer } from './contact-details-drawer';
import { ContactFormModal } from './contact-form-modal';
import styles from './clients.module.css';

export type OpenFile = {
  kind: 'client' | 'owner' | 'contact';
  id: string;
};

const currencyLabel = (code: string | null): string => {
  if (!code) return 'د.ك';
  if (code === 'KWD') return 'د.ك';
  if (code.toLowerCase() === 'usd') return 'دولار أمريكي';
  return code;
};

function formatPrice(price: string | null, currency: string | null): string {
  if (!price) return '';
  const num = Number(price);
  if (Number.isNaN(num)) return price;
  const cur = currencyLabel(currency);
  if (num >= 1000000) return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)} مليون ${cur}`;
  return `${Math.round(num).toLocaleString('ar-KW')} ${cur}`;
}

function clientFromDto(dto: ClientApiDto): ClientSample {
  const today = localDate();
  const logged = dto.followUps.filter((f) => f.outcome || f.note);
  const latestLogged = logged.length ? logged[0] : undefined;
  let status: ClientSample['status'] = 'مفتوح';
  if (dto.nextFollowUp) {
    if (dto.nextFollowUp < today) status = 'متابعة متأخرة';
    else status = 'متابع';
  }
  return {
    id: dto.id,
    name: dto.name,
    phone: dto.phone,
    type: '—',
    employee: dto.responsibleEmployeeName || '—',
    lastFollowUp: latestLogged?.createdAt.slice(0, 10) || 'لم تُسجل بعد',
    status,
    request: '—',
    nextFollowUp: dto.nextFollowUp ?? 'لم يُحدد بعد',
    timeline: logged.map((f) => ({
      id: f.id,
      date: f.createdAt.slice(0, 10),
      employee: f.employeeName,
      result: f.outcome,
      note: f.note,
    })),
    properties: dto.properties.map((p) => ({
      id: p.id,
      code: p.reference,
      title: p.title,
      summary: `${p.area || ''}${p.askingPrice ? ` · ${formatPrice(p.askingPrice, p.currency)}` : ''}`.trim(),
      area: p.area || '',
      price: p.askingPrice ? formatPrice(p.askingPrice, p.currency) : '',
    })),
    // Real `ClientPropertyInterest` rows: each carries the immutable
    // `Property.id` so the drawer's cards deep-link the exact property.
    // District, price, reason and notes stay SEPARATE fields so the card
    // renders one readable line per fact (legacy `summary` kept as fallback).
    propertyInterests: dto.propertyInterests.map((interest) => ({
      id: interest.propertyId,
      code: interest.reference,
      title: interest.title,
      summary: `${interest.area || ''}${interest.askingPrice ? ` · ${formatPrice(interest.askingPrice, interest.currency)}` : ''}`.trim(),
      area: interest.area || '',
      price: interest.askingPrice
        ? formatPrice(interest.askingPrice, interest.currency)
        : '',
      reason: interest.reason || '',
      notes: interest.notes || '',
    })),
    notes: dto.notes || undefined,
  };
}

function ownerFromContact(
  contact: RegistryContact,
): OwnerSample {
  return ownerFromRegistryContact(contact);
}

export default function ManagerClientsPage() {
  const registry = useRegistryContacts();
  const router = useRouter();
  const contacts = registry.contacts;
  const contactsLoading = registry.loading;
  const contactsError = registry.error;
  const refreshContacts = registry.refresh;
  const {
    clients: clientRows,
    stats,
    loading: clientsLoading,
    error: clientsError,
    refresh: refreshClients,
  } = useClients();

  const items = useMemo(() => clientRows.map(clientFromDto), [clientRows]);

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'clients' | 'owners' | 'brokers'>('clients');
  const [file, setFile] = useState<OpenFile | null>(null);
  const [addingType, setAddingType] = useState<'client' | 'owner' | 'broker' | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [selectedBroker, setSelectedBroker] = useState<RegistryContact | null>(null);

  const handleSearch = (value: string) => {
    setQuery(value);
  };

  const visibleClients = items.filter((person) => matchesPerson(person, query));
  const visibleOwners = contacts
    .filter((c) => c.type === 'OWNER' && c.scope === 'EMPLOYEE')
    .map(ownerFromContact)
    .filter((o) => matchesPerson(o, query));
  const visibleBrokers = contacts
    .filter((c) => c.type === 'BROKER')
    .map(ownerFromContact)
    .filter((o) => matchesPerson(o, query));

  const [adding, setAdding] = useState(false);
  const [clientContext, setClientContext] = useDraftState<Record<string, ClientSample>>(
    'manager-clients:context',
    {},
  );

  const addingData = useMemo(() => {
    if (!addingType || addingType !== 'client') return undefined;
    return items;
  }, [addingType, items]);

  const statsCards = [
    { title: 'عملاء نشطين', value: stats ? stats.activeClients : '—' },
    { title: 'ملاك مسجلين', value: stats ? stats.owners : '—' },
    { title: 'وسطاء مسجلين', value: stats ? stats.brokers : '—' },
    { title: 'متابعة هذا الأسبوع', value: stats ? stats.followUpsThisWeek : '—' },
  ];

  return (
    <ManagerPageShell
      title="إدارة العملاء"
      description="إدارة ملفات العملاء والملاك والوسطاء، ومعرفة الموظفين المسؤولين وسجل المتابعات."
      actions={
        <Button
          variant="primary"
          onClick={() => { setAddingType('client'); setAdding(true); }}
        >
          إضافة عميل جديد
        </Button>
      }
    >
      <div className={styles.scope}>
        <div className={styles.stats}>
          {statsCards.map((item) => (
            <StatCard
              key={item.title}
              title={item.title}
              value={item.value}
              icon="users"
              hint="أرقام فعلية من قاعدة البيانات"
            />
          ))}
        </div>

        {/* Approved Astra layout: tabs on the right, search on the left. */}
        <div className={styles.toolbar}>
          <SegmentedTabs
            id="manager-clients-tabs"
            label="قوائم العملاء والملاك والوسطاء"
            value={tab}
            onChange={(value) => setTab(value as 'clients' | 'owners' | 'brokers')}
            items={[
              { id: 'clients', label: 'العملاء', count: stats?.totalClients },
              { id: 'owners', label: 'الملاك', count: stats?.owners },
              { id: 'brokers', label: 'الوسطاء', count: stats?.brokers },
            ]}
          />
          <SearchBar
            label="البحث"
            placeholder="ابحث بالاسم أو رقم الهاتف..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>

        <SectionHeader
          title={tab === 'clients' ? 'ملفات العملاء' : tab === 'owners' ? 'ملفات الملاك' : 'ملفات الوسطاء'}
          description=""
        />

        {tab === 'clients' && (clientsLoading || clientsError) && (
          <p className={styles.secondary} role="status" aria-live="polite">
            {clientsLoading ? 'جارٍ تحميل ملفات العملاء…' : `تعذر تحميل العملاء: ${clientsError}`}
          </p>
        )}
        {tab === 'clients' && !clientsLoading && !clientsError && visibleClients.length === 0 && (
          <p className={styles.secondary}>لا يوجد عملاء مطابقون للبحث.</p>
        )}
        {tab === 'clients' && !clientsLoading && !clientsError && visibleClients.length > 0 && (
          <div className={styles.peopleList}>
            {visibleClients.map((person) => (
              <ClientCard
                key={person.id}
                client={person}
                onOpen={() => {
                  setClientContext((prev) => ({ ...prev, [person.id]: person }));
                  setFile({ kind: 'client', id: person.id });
                }}
              />
            ))}
          </div>
        )}

        {tab === 'owners' && (contactsLoading || contactsError) && (
          <p className={styles.secondary} role="status" aria-live="polite">
            {contactsLoading ? 'جارٍ تحميل ملفات الملاك…' : `تعذر تحميل ملفات الملاك: ${contactsError}`}
          </p>
        )}
        {tab === 'owners' && !contactsLoading && !contactsError && visibleOwners.length === 0 && (
          <p className={styles.secondary}>لا يوجد ملاك مطابقون للبحث.</p>
        )}
        {tab === 'owners' && !contactsLoading && !contactsError && visibleOwners.length > 0 && (
          <div className={styles.peopleList}>
            {visibleOwners.map((person) => (
              <OwnerCard
                key={person.id}
                owner={person}
                onOpen={() => {
                  setFile({ kind: 'owner', id: person.id });
                }}
              />
            ))}
          </div>
        )}

        {tab === 'brokers' && (contactsLoading || contactsError) && (
          <p className={styles.secondary} role="status" aria-live="polite">
            {contactsLoading ? 'جارٍ تحميل ملفات الوسطاء…' : `تعذر تحميل ملفات الوسطاء: ${contactsError}`}
          </p>
        )}
        {tab === 'brokers' && !contactsLoading && !contactsError && visibleBrokers.length === 0 && (
          <p className={styles.secondary}>لا يوجد وسطاء مطابقون للبحث.</p>
        )}
        {tab === 'brokers' && !contactsLoading && !contactsError && visibleBrokers.length > 0 && (
          <div className={styles.peopleList}>
            {visibleBrokers.map((person) => (
              <OwnerCard
                key={person.id}
                owner={person}
                onOpen={() => {
                  const contact = contacts.find((c) => `owner-${c.id}` === person.id);
                  if (contact) setSelectedBroker(contact);
                  setFile({ kind: 'contact', id: person.id });
                }}
              />
            ))}
          </div>
        )}

        {file?.kind === 'client' && (
          <ClientDetailsDrawer
            client={clientContext[file.id] || items.find((c) => c.id === file.id)!}
            onClose={() => setFile(null)}
            // Same deep-link contract as the owner drawer, for the wizard's
            // saved property interests.
            onOpenProperty={(propertyId) => {
              requestOpenProperty(propertyId);
              router.push(
                `/manager/properties?${PROPERTY_QUERY_PARAM}=${encodeURIComponent(propertyId)}`,
              );
            }}
          />
        )}
        {file?.kind === 'owner' && (
          <OwnerDetailsDrawer
            owner={visibleOwners.find((o) => o.id === file.id) || ownerFromContact(contacts.find((c) => `owner-${c.id}` === file.id)!)}
            onClose={() => setFile(null)}
          />
        )}
        {file?.kind === 'contact' && selectedBroker && (
          <ContactDetailsDrawer
            contact={selectedBroker}
            onClose={() => {
              setFile(null);
              setSelectedBroker(null);
            }}
          />
        )}

        {adding && addingType === 'client' && addingData && (
          <AddClientModal
            onClose={() => setAdding(false)}
            clients={addingData}
            onSave={async (client) => {
              const isExisting = items.some((item) => item.id === client.id);
              try {
                if (isExisting) {
                  await updateClient(client.id, {
                    name: client.name,
                    phone: client.phone,
                    notes: client.notes,
                  });
                } else {
                  await createClient({
                    name: client.name,
                    phone: client.phone,
                    notes: client.notes,
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
              setTab('clients');
              setQuery('');
              setNotice('تم حفظ العميل بنجاح');
              return true;
            }}
          />
        )}

        {adding && addingType === 'owner' && (
          <ContactFormModal
            type="OWNER"
            onClose={() => setAdding(false)}
            onSave={async () => {
              setAdding(false);
              await refreshContacts();
              setTab('owners');
              setQuery('');
              setNotice('تم حفظ ملف المالك بنجاح');
            }}
          />
        )}

        {adding && addingType === 'broker' && (
          <ContactFormModal
            type="BROKER"
            onClose={() => setAdding(false)}
            onSave={async () => {
              setAdding(false);
              await refreshContacts();
              setTab('brokers');
              setQuery('');
              setNotice('تم حفظ ملف الوسيط بنجاح');
            }}
          />
        )}

        <Toast message={notice} onDismiss={() => setNotice('')} />
      </div>
    </ManagerPageShell>
  );
}
