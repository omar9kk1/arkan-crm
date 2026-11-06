'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';
import type { EmployeeClient } from '../client-model';

import { Toast } from '../../../components/ui/toast';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { GlassSelect } from '../../../components/ui/glass-select';
import {
  employeeClientFromDto,
  filterClients,
  localDate,
  tabs,
  clientClassifications,
  CLIENT_CLASSIFICATIONS,
  type ClientClassification,
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
import { createClientFollowUp } from '../../../lib/api/clients-api';
import {
  submitClientReview,
  type ClientReviewInterestPayload,
} from '../../../lib/api/client-reviews-api';
import { ApiError } from '../../../lib/api-client';
import { CLIENT_REVIEW_QUERY_PARAM } from '../../notifications/notification-target';
import { ClientReviewsTab } from '../../client-reviews/components/client-reviews-tab';
import { useClientReviewCount } from '../../client-reviews/use-client-review-count';
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

/** Server Arabic copy first, then a generic Arabic fallback. */
function reviewErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError && cause.messages.length)
    return cause.messages[0] ?? fallback;
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
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
  // The real «تحت المراجعة» badge number: the SAME authorized feed the tab
  // renders (the employee's own submissions only), kept in step by the tab.
  const reviewCount = useClientReviewCount();
  const clients = useMemo(
    () => clientRows.map(employeeClientFromDto),
    [clientRows],
  );
  // Owners/brokers read the resource form so each tab keeps its own loading
  // and error states while the real API data is fetched.
  const ownersResource = useContacts('OWNER');
  const brokersResource = useContacts('BROKER');
  const contacts = useMemo(
    () =>
      ownersResource.contacts.filter((contact) =>
        canViewContact(user, contact),
      ),
    [ownersResource.contacts, user],
  );
  const brokers = useMemo(
    () =>
      brokersResource.contacts.filter((contact) =>
        canViewContact(user, contact),
      ),
    [brokersResource.contacts, user],
  );
  const contactsLoading = ownersResource.loading;
  const contactsError = ownersResource.error;
  const brokersLoading = brokersResource.loading;
  const brokersError = brokersResource.error;

  const [query, setQuery] = useState('');
  const today = localDate();
  const [tab, setTab] = useState('all');
  const [classification, setClassification] = useState('الكل');
  const [category, setCategory] = useState<
    'clients' | 'owners' | 'brokers' | 'reviews'
  >('clients');
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [clientContext, setClientContext] = useDraftState<
    Record<string, EmployeeClient>
  >('employee-clients:context', {});
  const [selectedContact, setSelectedContact] =
    useState<RegistryContact | null>(null);
  const [ownerFile, setOwnerFile] = useState<string | null>(null);

  // Notification deep link: `?client-review=<id>` opens the reviews tab with
  // that staged review (the tab opens the exact drawer exactly once). The
  // param is TRANSIENT: once handled, it is stripped from the URL with REPLACE
  // navigation (every other query param preserved) — the still-open drawer
  // keeps its selection (tab state, not the URL), a plain refresh or revisit
  // can never re-open it, and Back/Forward never restores a dismissed drawer;
  // the NEXT bell click navigates a fresh param and works again.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // `router` is the component's existing useRouter instance (declared above).
  const focusReviewId =
    searchParams.get(CLIENT_REVIEW_QUERY_PARAM)?.trim() ?? '';
  const reviewKeyRef = useRef('');
  const createIntent = searchParams.get('new')?.trim() ?? '';
  const createKeyRef = useRef('');
  useEffect(() => {
    if (!createIntent) {
      createKeyRef.current = '';
      return;
    }
    if (createKeyRef.current === createIntent) return;
    createKeyRef.current = createIntent;
    setAdding(true);
    const params = new URLSearchParams(searchParams);
    params.delete('new');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [createIntent, searchParams, pathname, router]);
  useEffect(() => {
    // An ABSENT param re-arms the deep link: after the transient param is
    // stripped (replace), clicking the SAME notification later must open the
    // same review again — including while already on this page (SPA nav).
    if (!focusReviewId) {
      reviewKeyRef.current = '';
      return;
    }
    if (reviewKeyRef.current === focusReviewId) return;
    reviewKeyRef.current = focusReviewId;
    setCategory('reviews');
    const params = new URLSearchParams(searchParams);
    params.delete(CLIENT_REVIEW_QUERY_PARAM);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [focusReviewId, searchParams, pathname, router]);

  const filtered = filterClients(clients, tab, today)
    .filter(
      (c) =>
        classification === 'الكل' ||
        clientClassifications(c).includes(
          classification as ClientClassification,
        ),
    )
    .filter((c) => `${c.name} ${c.phone}`.includes(query));

  const ownersList = contacts ?? [];
  const brokersList = brokers ?? [];
  const ownersMapped = ownersList
    .map(ownerFromContact)
    .filter((o) => o.name.includes(query) || o.phone.includes(query));
  const brokersMapped = brokersList
    .map(ownerFromContact)
    .filter((o) => o.name.includes(query) || o.phone.includes(query));

  const selected = selectedId
    ? clients.find((c) => c.id === selectedId) || clientContext[selectedId]
    : null;

  return (
    <EmployeePageShell
      title="العملاء"
      /* Route-specific (owner request): no description paragraph here; the
         shell's other pages keep their descriptions via their own props. */
      description=""
      actions={<Button onClick={() => setAdding(true)}>إضافة عميل</Button>}
    >
      {category === 'clients' && (clientsLoading || clientsError) && (
        <p className={styles.muted} role="status" aria-live="polite">
          {clientsLoading
            ? 'جارٍ تحميل عملاءك…'
            : `تعذر تحميل العملاء: ${clientsError}`}
        </p>
      )}

      {/* Always visible on every category tab: the four cards keep their
          position above the search/tabs row. */}
      <div className={styles.stats}>
        {[
          { title: 'إجمالي عملاءك', value: stats ? stats.totalClients : '—' },
          {
            title: 'عملاء يحتاجون متابعة',
            value: stats ? stats.clientsNeedingFollowUp : '—',
          },
          { title: 'متابعات متأخرة', value: stats ? stats.clientsLate : '—' },
          {
            title: 'طلبات بدون عقار مناسب',
            value: stats ? stats.clientsWithoutProperty : '—',
          },
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

      {/* Approved Astra pattern: the main category tabs keep their own row,
          while the client status filter (now a compact «الحالة» dropdown) and
          the search input share one row below (see .statusRow). */}
      <div className={styles.toolbar}>
        <SegmentedTabs
          id="employee-clients-category"
          label="تصنيف العملاء"
          value={category}
          onChange={(value) =>
            setCategory(value as 'clients' | 'owners' | 'brokers' | 'reviews')
          }
          items={[
            { id: 'clients', label: 'العملاء', count: stats?.totalClients },
            { id: 'owners', label: 'الملاك', count: stats?.owners },
            { id: 'brokers', label: 'الوسطاء', count: stats?.brokers },
            {
              id: 'reviews',
              label: 'تحت المراجعة',
              count: reviewCount.count ?? undefined,
            },
          ]}
        />
      </div>

      {category === 'clients' && (
        <>
          {/* The former wide secondary filter bar (كل العملاء / متابعة اليوم /
              متأخر / بدون عقار مناسب) is now ONE bounded «الحالة» dropdown on
              the RIGHT of a single RTL row, with the search flex-growing to
              fill the rest on the LEFT — the same corrected grid row as the
              follow-ups toolbar. Same `tabs` options, same `tab` state and
              same `filterClients` result, so the filtering behavior, counts,
              default «كل العملاء» and search/text interplay are preserved
              regardless of which control changed last. */}
          <div className={styles.statusRow}>
            <label className={styles.statusField}>
              الحالة
              <GlassSelect
                value={tab}
                onChange={(event) => setTab(event.target.value)}
              >
                {tabs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </GlassSelect>
            </label>
            <label className={styles.statusField}>
              تصنيف العميل
              <GlassSelect
                value={classification}
                onChange={(event) => setClassification(event.target.value)}
              >
                {CLIENT_CLASSIFICATIONS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </GlassSelect>
            </label>
            <SearchBar
              label="البحث في العملاء"
              placeholder="ابحث بالاسم أو الهاتف"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
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
          {contactsLoading
            ? 'جارٍ تحميل الملاك…'
            : `تعذر تحميل الملاك: ${contactsError}`}
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
          {brokersLoading
            ? 'جارٍ تحميل الوسطاء…'
            : `تعذر تحميل الوسطاء: ${brokersError}`}
        </p>
      )}

      {category === 'brokers' && (
        <div className={styles.list}>
          {brokersMapped.map((o) => (
            <OwnerCard
              key={o.id}
              owner={o}
              onOpen={() => {
                const contact = brokersList.find(
                  (c) => `owner-${c.id}` === o.id,
                );
                if (contact) setSelectedContact(contact);
                setOwnerFile(o.id);
              }}
            />
          ))}
        </div>
      )}

      {category === 'reviews' && (
        <ClientReviewsTab
          role="EMPLOYEE"
          focusReviewId={focusReviewId}
          onCountChange={reviewCount.reportCount}
          // The SAME authorized properties deep link the client drawers use.
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
        />
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
                cause instanceof Error
                  ? cause.message
                  : 'تعذر حفظ المتابعة. حاول مرة أخرى.';
              return message;
            }
            await refreshClients();
            return null;
          }}
          // The wizard edit NO LONGER patches the approved row directly: the
          // SAME wizard payload is staged as a client REVIEW (the manager
          // approves it from the shared «تحت المراجعة» tab). The idempotency
          // key stays stable for the whole wizard session, so an accidental
          // double click resolves to THE SAME review, never a duplicate.
          onEditSave={async (payload, idempotencyKey) => {
            try {
              await submitClientReview({
                kind: 'EDIT',
                clientId: selected.id,
                name: payload.name,
                phone: payload.phone,
                notes: payload.notes,
                requestData: payload.requestData,
                addInterests: payload.propertyInterests,
                removeInterests: payload.removePropertyInterestIds.length
                  ? payload.removePropertyInterestIds
                  : undefined,
                idempotencyKey,
              });
            } catch (cause) {
              setNotice(
                reviewErrorMessage(
                  cause,
                  'تعذر إرسال طلب التعديل. حاول مرة أخرى.',
                ),
              );
              return false;
            }
            setNotice('تم إرسال طلب التعديل — بانتظار موافقة الإدارة');
            await refreshClients();
            // The staged review joins the feed immediately: bump the tab
            // badge too (the CREATION path lands on the tab itself, which
            // reports its own fresh length on mount).
            reviewCount.refresh();
            return true;
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
          onSave={async (client: EmployeeClient, idempotencyKey: string) => {
            // The wizard CREATE save is staged as a CREATION review: nothing
            // becomes a row until the manager approves. Real linked selections
            // are validated again server-side inside the review transaction.
            const interests: ClientReviewInterestPayload[] =
              client.requestBundle
                ? bundlePropertyInterests(client.requestBundle).map(
                    (interest) => ({
                      propertyId: interest.propertyId,
                      reason: interest.reason ?? null,
                      notes: interest.notes ?? null,
                    }),
                  )
                : [];
            try {
              await submitClientReview({
                kind: 'CREATION',
                name: client.name,
                phone: client.phone,
                notes: client.notes || null,
                requestData: client.requestBundle
                  ? JSON.stringify({
                      version: 1,
                      types: client.requestBundle.types,
                      requests: client.requestBundle.requests,
                    })
                  : undefined,
                addInterests: interests.length ? interests : undefined,
                idempotencyKey,
              });
            } catch (cause) {
              setNotice(
                reviewErrorMessage(
                  cause,
                  'تعذر إرسال طلب إضافة العميل. حاول مرة أخرى.',
                ),
              );
              return false;
            }
            setAdding(false);
            setCategory('reviews');
            setNotice('أُرسل طلب إضافة العميل — بانتظار موافقة الإدارة');
            return true;
          }}
        />
      )}

      <Toast message={notice} onDismiss={() => setNotice('')} />
    </EmployeePageShell>
  );
}
