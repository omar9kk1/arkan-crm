'use client';
import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { AddClientModal } from './add-client-modal';
import type { EditClientRequestPayload } from '../../employee-clients/components/request-wizard/client-request-bundle';
import { Button } from '../../../components/ui/button';
import type { ClientSample } from '../client-model';
import { FollowUpTimeline } from './follow-up-timeline';
import { PersonProperties } from './person-properties';
import {
  ClientProfileActions,
  ClientProfileIdentity,
  ClientRequestSection,
  profileDrawerClass,
} from '../../client-shared/client-profile-sections';
import styles from './clients.module.css';
export function ClientDetailsDrawer({
  client,
  onClose,
  onOpenProperty,
  onEditSave,
}: {
  client: ClientSample;
  onClose: () => void;
  /** Ask the properties page to open one exact `Property.id`. */
  onOpenProperty?: (propertyId: string) => void;
  /**
   * «تعديل بيانات العميل» — launches the ORIGINAL shared 4-step wizard in
   * EDIT mode (the same one used to create clients), saving through the
   * authorized `PATCH /clients/:id`. True = committed.
   */
  onEditSave?: (payload: EditClientRequestPayload) => Promise<boolean>;
}) {
  const [tab, setTab] = useState('summary');
  const [editing, setEditing] = useState(false);
  // Only meaningful rows: a permanently empty placeholder («نوع العميل» is
  // '—' until a real type exists) never earns a card — a genuinely missing
  // value elsewhere still falls back to «—» inside the shared grid.
  const identity = [
    { label: 'الاسم', value: client.name },
    { label: 'الهاتف', value: client.phone },
    ...(client.type.trim() && client.type !== '—'
      ? [{ label: 'نوع العميل', value: client.type }]
      : []),
    { label: 'الموظف المسؤول', value: client.employee },
    { label: 'الحالة', value: client.status },
    { label: 'آخر متابعة', value: client.lastFollowUp },
    { label: 'آخر نتيجة متابعة', value: client.timeline[0]?.result },
    { label: 'المتابعة القادمة', value: client.nextFollowUp },
  ];
  const requestProps = {
    requestData: client.requestData,
    notes: client.notes,
    legacyRequest: client.request,
  };
  return (
    <PropertyOverlay
      drawer
      className={profileDrawerClass}
      title={`ملف العميل · ${client.name}`}
      onClose={onClose}
      /* The edit action is INTENTIONAL and pinned: a footer row on the
         dialog's own background, never a button floating between sections. */
      footer={
        onEditSave && !editing ? (
          <ClientProfileActions>
            <Button onClick={() => setEditing(true)}>تعديل بيانات العميل</Button>
          </ClientProfileActions>
        ) : null
      }
    >
      <ClientProfileIdentity items={identity} />
      {client.status === 'متابعة متأخرة' && (
        <p className={styles.alert}>
          توجد متابعة متأخرة تحتاج مراجعة من المدير
        </p>
      )}
      {/* The ONE shared 4-step wizard, EDIT mode — prefilled from the real
          persisted client data and stored request document, saved through the
          same authorized PATCH (`/clients/:id`). No separate edit form and no
          duplicated steps anywhere. */}
      {editing && onEditSave ? (
        <AddClientModal
          editing={client}
          clients={[client]}
          onClose={() => setEditing(false)}
          onEditSave={onEditSave}
          onSave={() => true}
        />
      ) : null}
      <SegmentedTabs
        id="client-file"
        label="أقسام ملف العميل"
        items={[
          { id: 'summary', label: 'الملخص' },
          { id: 'followups', label: 'سجل المتابعات' },
          { id: 'matches', label: 'الطلبات / العقارات المناسبة' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <section
        role="tabpanel"
        tabIndex={0}
        id="client-file-panel-summary"
        aria-labelledby="client-file-tab-summary"
        hidden={tab !== 'summary'}
      >
        {/* Structured `requestData` first; when an older client has none, its
            real request details live in the free-text notes — shown READABLY
            here instead of the old empty dash. Never parsed, never rewritten. */}
        <ClientRequestSection heading="ملخص الطلب" {...requestProps} />
        <p>ملف تجريبي للعرض فقط.</p>
      </section>
      <section
        role="tabpanel"
        tabIndex={0}
        id="client-file-panel-followups"
        aria-labelledby="client-file-tab-followups"
        hidden={tab !== 'followups'}
      >
        <h3>سجل المتابعات</h3>
        <FollowUpTimeline entries={client.timeline} />
      </section>
      <section
        role="tabpanel"
        tabIndex={0}
        id="client-file-panel-matches"
        aria-labelledby="client-file-tab-matches"
        hidden={tab !== 'matches'}
      >
        <ClientRequestSection heading="الطلبات" {...requestProps} />
        <h3>العقارات المناسبة</h3>
        <PersonProperties properties={client.properties} />
        {/* Real `ClientPropertyInterest` rows saved by the wizard. Only these
            are recorded DB facts: cards carry the immutable `Property.id` and
            open the exact property via the same deep-link channel. */}
        {client.propertyInterests?.length ? (
          <>
            <h3>استفسارات عقارات البرنامج</h3>
            <PersonProperties
              properties={client.propertyInterests}
              onOpenProperty={onOpenProperty}
            />
          </>
        ) : null}
        <p className={styles.secondary}>
          مطابقات تجريبية وليست اقتراحات من النظام.
        </p>
      </section>
    </PropertyOverlay>
  );
}
