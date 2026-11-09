'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useRegistryContacts,
  type RegistryContact,
} from '../../../lib/contact-registry';
import { createClient, getClient, updateClient } from '../../../lib/api/clients-api';
import { useClients } from '../../../lib/use-clients';
import type {
  ClientApiDto,
  ClientListItemApiDto,
} from '../../../lib/api/client-types';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { requestOpenProperty } from '../../notifications/open-property';
import {
  CLIENT_REVIEW_QUERY_PARAM,
  MANAGER_CLIENT_BROKER_QUERY_PARAM,
  MANAGER_CLIENT_CLIENT_QUERY_PARAM,
  MANAGER_CLIENT_OWNER_QUERY_PARAM,
} from '../../notifications/notification-target';
import { PROPERTY_QUERY_PARAM } from '../../../lib/property-reveal';
import { matchesPerson } from '../../../lib/search';
import { Button } from '../../../components/ui/button';
import { Toast } from '../../../components/ui/toast';
import { AddClientModal } from './add-client-modal';
import { ClientReviewsTab } from '../../client-reviews/components/client-reviews-tab';
import { useClientReviewCount } from '../../client-reviews/use-client-review-count';
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
    requestData: dto.requestData,
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

/**
 * Lightweight list row -> card model. The full record (timeline, deals and
 * interests) is fetched only when the details drawer opens.
 */
function clientFromListItem(dto: ClientListItemApiDto): ClientSample {
  const today = localDate();
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
    requestData: dto.requestData,
    employee: dto.responsibleEmployeeName || '—',
    lastFollowUp: dto.lastFollowUpAt?.slice(0, 10) || 'لا يوجد متابعة',
    status,
    request: '—',
    nextFollowUp: dto.nextFollowUp ?? 'لا يوجد متابعة',
    timeline: [],
    properties: [],
    propertyInterests: [],
    notes: dto.notes || undefined,
  };
}

function ownerFromContact(
  contact: RegistryContact,
): OwnerSample {
  return ownerFromRegistryContact(contact);
}

export default function ManagerClientsPage() {
  const searchParams = useSearchParams();
  const registry = useRegistryContacts();
  const router = useRouter();
  const pathname = usePathname();
  const contacts = registry.contacts;
  const contactsLoading = registry.loading;
  const contactsError = registry.error;
  const refreshContacts = registry.refresh;
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'clients' | 'owners' | 'brokers' | 'reviews'>('clients');
  const {
    clients: clientRows,
    stats,
    loading: clientsLoading,
    loadingMore: clientsLoadingMore,
    error: clientsError,
    nextCursor,
    refresh: refreshClients,
    loadMore: loadMoreClients,
  } = useClients({ search: tab === 'clients' ? query : '' });
  // The real «تحت المراجعة» badge number: the same authorized feed the tab
  // renders (company-wide for the manager), kept in step by the tab itself.
  const reviewCount = useClientReviewCount();

  const items = useMemo(
    () => clientRows.map(clientFromListItem),
    [clientRows],
  );

  const [file, setFile] = useState<OpenFile | null>(null);
  const [addingType, setAddingType] = useState<'client' | 'owner' | 'broker' | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [selectedBroker, setSelectedBroker] = useState<RegistryContact | null>(null);

  const handleSearch = (value: string) => {
    setQuery(value);
  };

  const visibleClients = items;
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

  // List rows are lightweight; the full timeline/deals/interests are loaded
  // only when the drawer opens.
  const openClient = useCallback(
    async (id: string) => {
      try {
        const dto = await getClient(id);
        setClientContext((context) => ({
          ...context,
          [id]: clientFromDto(dto),
        }));
        setTab('clients');
        setFile({ kind: 'client', id });
      } catch {
        setNotice('تعذّر تحميل تفاصيل العميل.');
      }
    },
    [setClientContext],
  );

  // Notification deep-link support. The bell routes record activity to this page
  // with `client` (a customer id), or `owner`/`broker` (a contact id). The id
  // opens the EXACT drawer on the right tab once the authorised lists have
  // loaded. An id absent from the loaded window is fetched through the
  // authorized `GET /clients/:id`; a contact id that never resolves simply
  // opens nothing — no guessed access, matching the properties deep-link
  // contract. The params are read REACTIVELY (not once per mount): a bell click
  // while the page is already open re-runs this effect for the new id, so the
  // exact new client opens without leaving the page.
  const clientIdParam = searchParams.get(MANAGER_CLIENT_CLIENT_QUERY_PARAM)?.trim() || '';
  const ownerIdParam = searchParams.get(MANAGER_CLIENT_OWNER_QUERY_PARAM)?.trim() || '';
  const brokerIdParam = searchParams.get(MANAGER_CLIENT_BROKER_QUERY_PARAM)?.trim() || '';
  // The review deep link is handed to the tab component, then cleaned.
  const reviewParam = searchParams.get(CLIENT_REVIEW_QUERY_PARAM)?.trim() || '';
  const handledKeyRef = useRef('');
  useEffect(() => {
    if (clientsLoading || contactsLoading) return;
    const deepLinkKey = `${clientIdParam}\u0000${ownerIdParam}\u0000${brokerIdParam}`;
    if (!clientIdParam && !ownerIdParam && !brokerIdParam) return;
    // The same key is not re-handled: the drawer was opened once for it, and the
    // surviving URL must not re-open the drawer on an unrelated refetch.
    if (handledKeyRef.current === deepLinkKey) return;
    handledKeyRef.current = deepLinkKey;

    if (clientIdParam) {
      // Out of the loaded window: fetch the real authorised record once, then
      // open the drawer with it (the drawer prefers `clientContext[id]`).
      void getClient(clientIdParam)
        .then((dto) => {
          setClientContext((context) => ({
            ...context,
            [clientIdParam]: clientFromDto(dto),
          }));
          setTab('clients');
          setFile({ kind: 'client', id: clientIdParam });
        })
        .catch(() => {
          // A denied or stale id answers 404 — the page simply stays silent.
        });
      return;
    }
    if (ownerIdParam) {
      const owner = contacts.find((c) => c.id === ownerIdParam && c.type === 'OWNER');
      if (!owner) return;
      setTab('owners');
      setFile({ kind: 'owner', id: `owner-${ownerIdParam}` });
      return;
    }
    const broker = contacts.find((c) => c.id === brokerIdParam && c.type === 'BROKER');
    if (!broker) return;
    setTab('brokers');
    setSelectedBroker(broker);
    setFile({ kind: 'contact', id: brokerIdParam });
  }, [
    clientsLoading,
    contactsLoading,
    contacts,
    setClientContext,
    clientIdParam,
    ownerIdParam,
    brokerIdParam,
  ]);

  // A review deep link (`?client-review=…`) lands on the reviews tab; the tab
  // itself opens the exact drawer exactly once (same handled-key contract as
  // the record deep links above). The param is TRANSIENT: once handled, it is
  // stripped from the URL with REPLACE navigation (every other query param is
  // preserved) — the still-open drawer keeps its selection (it lives in the
  // tab state, not the URL), a plain refresh or revisit can never re-open it,
  // and Back/Forward never restores a dismissed drawer; the NEXT bell click
  // navigates a fresh param and works again.
  const reviewKeyRef = useRef('');
  useEffect(() => {
    // An ABSENT param re-arms the deep link: after the transient param is
    // stripped (replace), clicking the SAME notification later must open the
    // same review again — including while already on this page (SPA nav).
    if (!reviewParam) {
      reviewKeyRef.current = '';
      return;
    }
    if (reviewKeyRef.current === reviewParam) return;
    reviewKeyRef.current = reviewParam;
    setTab('reviews');
    const params = new URLSearchParams(searchParams);
    params.delete(CLIENT_REVIEW_QUERY_PARAM);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [reviewParam, searchParams, pathname, router]);

  const addingData = useMemo(() => {    if (!addingType || addingType !== 'client') return undefined;
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
      /* Route-specific (owner request): no eyebrow «لوحة المدير» and no
         description paragraph on the Clients page — the other Manager pages
         keep both via the shell's defaults. */
      overline=""
      actions={
        <Button
          variant="primary"
          onClick={() => { setAddingType('client'); setAdding(true); }}
        >
          إضافة عميل
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
            onChange={(value) => setTab(value as 'clients' | 'owners' | 'brokers' | 'reviews')}
            items={[
              { id: 'clients', label: 'العملاء', count: stats?.totalClients },
              { id: 'owners', label: 'الملاك', count: stats?.owners },
              { id: 'brokers', label: 'الوسطاء', count: stats?.brokers },
              { id: 'reviews', label: 'تحت المراجعة', count: reviewCount.count ?? undefined },
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
          title={tab === 'clients' ? 'ملفات العملاء' : tab === 'owners' ? 'ملفات الملاك' : tab === 'brokers' ? 'ملفات الوسطاء' : 'طلبات المراجعة'}
          description=""
        />

        {tab === 'reviews' && (
          <ClientReviewsTab
            role="MANAGER"
            focusReviewId={reviewParam}
            onCountChange={reviewCount.reportCount}
            // The SAME authorized properties deep link the client drawer uses.
            onOpenProperty={(propertyId) => {
              requestOpenProperty(propertyId);
              router.push(
                `/manager/properties?${PROPERTY_QUERY_PARAM}=${encodeURIComponent(propertyId)}`,
              );
            }}
          />
        )}

        {tab === 'clients' && (clientsLoading || clientsError) && (
          <p className={styles.secondary} role="status" aria-live="polite">
            {clientsLoading ? 'جارٍ تحميل ملفات العملاء…' : `تعذر تحميل العملاء: ${clientsError}`}
          </p>
        )}
        {tab === 'clients' && !clientsLoading && visibleClients.length === 0 && (
          <p className={styles.secondary}>لا يوجد عملاء مطابقون للبحث.</p>
        )}
        {tab === 'clients' && !clientsLoading && visibleClients.length > 0 && (
          <div className={styles.peopleList}>
            {visibleClients.map((person) => (
              <ClientCard
                key={person.id}
                client={person}
                onOpen={() => void openClient(person.id)}
              />
            ))}
          </div>
        )}
        {tab === 'clients' && !clientsLoading && nextCursor && (
          <p className={styles.secondary}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void loadMoreClients()}
              disabled={clientsLoadingMore}
              aria-busy={clientsLoadingMore}
            >
              {clientsLoadingMore ? 'جارٍ التحميل…' : 'تحميل المزيد'}
            </Button>
          </p>
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

        {file?.kind === 'client' && clientContext[file.id] && (
          <ClientDetailsDrawer
            client={clientContext[file.id]!}
            onClose={() => setFile(null)}
            // The SAME authorized patch path with NO approval step: the edit
            // takes effect immediately, then the page's lists/stats re-read
            // and the OPEN drawer row is replaced in place (also when it was
            // fetched through a deep link, whose cached copy would otherwise
            // shadow the fresh list).
            onEditSave={async (payload) => {
              let updated: ClientApiDto;
              try {
                updated = await updateClient(file.id, payload);
              } catch (cause) {
                const message =
                  cause instanceof Error
                    ? cause.message
                    : 'تعذر حفظ تعديلات العميل. حاول مرة أخرى.';
                setNotice(message);
                return false;
              }
              setClientContext((context) => ({
                ...context,
                [file.id]: clientFromDto(updated),
              }));
              await refreshClients();
              return true;
            }}
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
