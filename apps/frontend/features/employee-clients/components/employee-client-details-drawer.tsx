import { useDraftState } from '../../../lib/drafts/use-form-draft';
import { Toast } from '../../../components/ui/toast';
import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { Button } from '../../../components/ui/button';
import { type EmployeeClient, type FollowUp, localDate } from '../client-model';
import {
  ClientFollowUpTimeline,
  ClientInterestMiniCard,
  SuitablePropertyMiniCard,
} from './client-cards';
import { AddFollowUpModal } from './add-follow-up-modal';
import { AddClientRequestModal } from './request-wizard/add-client-request-modal';
import type { EditClientRequestPayload } from './request-wizard/client-request-bundle';
import {
  ClientNotesBlock,
  ClientProfileActions,
  ClientProfileIdentity,
  ClientRequestSection,
  profileDrawerClass,
  visibleNotes,
} from '../../client-shared/client-profile-sections';
import styles from './clients.module.css';
const tabs = [
  { id: 'summary', label: 'الملخص' },
  { id: 'history', label: 'سجل المتابعات' },
  { id: 'properties', label: 'العقارات المناسبة' },
  { id: 'notes', label: 'الملاحظات' },
];
export function EmployeeClientDetailsDrawer({
  client,
  onClose,
  onFollowUp,
  onOpenProperty,
  onEditSave,
}: {
  client: EmployeeClient;
  onClose: () => void;
  onFollowUp: (item: FollowUp) => Promise<string | null>;
  /** Ask the properties page to open one exact `Property.id`. */
  onOpenProperty?: (propertyId: string) => void;
  /**
   * «تعديل بيانات العميل» — the SAME shared 4-step wizard used for creation,
   * opened in EDIT mode over this drawer. It stages a client REVIEW (the
   * manager approves it) instead of patching the approved row; the second
   * argument is the idempotency key of THAT wizard session. True = committed.
   */
  onEditSave?: (payload: EditClientRequestPayload, idempotencyKey: string) => Promise<boolean>;
}) {
  const [tab, setTab] = useState('summary'),
    [adding, setAdding] = useDraftState(
      'ui:client-followup:' + client.id,
      false,
    ),
    [editing, setEditing] = useState(false),
    [notice, setNotice] = useState('');
  // The SAME status rule the manager mapper applies (no next date → open,
  // overdue → late, otherwise on track) — a presentation derivation only.
  const today = localDate();
  const status = !client.next
    ? 'مفتوح'
    : client.next < today
      ? 'متابعة متأخرة'
      : 'متابع';
  // Display-only dedup, SAME rule as the summary: auto-generated request
  // summary lines already shown structurally are suppressed, every human
  // line survives (stored notes are never modified).
  const extraNotes = visibleNotes(client.notes, client.requestData);
  // Meaningful rows only: the DTO placeholders («—» until a real value
  // exists) never earn an empty card, while missing identity values fall
  // back to «—» inside the shared grid.
  const identity = [
    { label: 'الاسم', value: client.name },
    { label: 'الهاتف', value: client.phone },
    { label: 'الموظف المسؤول', value: client.employee },
    { label: 'الحالة', value: status },
    { label: 'آخر متابعة', value: client.history[0]?.date || 'لم تُسجل بعد' },
    { label: 'آخر نتيجة متابعة', value: client.history[0]?.result },
    { label: 'المتابعة القادمة', value: client.next || 'لم تحدد' },
    ...(client.type.trim() && client.type !== '—'
      ? [{ label: 'نوع الطلب', value: client.type }]
      : []),
    ...(client.area.trim() && client.area !== '—'
      ? [{ label: 'المناطق المطلوبة', value: client.area }]
      : []),
    ...(client.budget.trim() && client.budget !== '—'
      ? [{ label: 'الميزانية', value: client.budget }]
      : []),
  ];
  return (
    <PropertyOverlay
      className={profileDrawerClass}
      title={`ملف العميل · ${client.name}`}
      drawer
      onClose={onClose}
      /* Intentional action row, pinned below the scrolling body — never a
         button floating between content sections. */
      footer={
        adding ? undefined : (
          <ClientProfileActions>
            <Button onClick={() => setAdding(true)}>إضافة متابعة</Button>
            <Button onClick={() => setEditing(true)}>تعديل بيانات العميل</Button>
          </ClientProfileActions>
        )
      }
    >
      <ClientProfileIdentity items={identity} />
      <SegmentedTabs
        id="client-detail"
        label="أقسام ملف العميل"
        items={tabs}
        value={tab}
        onChange={setTab}
      />
      {tabs.map((item) => (
        <section
          key={item.id}
          id={`client-detail-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`client-detail-tab-${item.id}`}
          hidden={tab !== item.id}
          tabIndex={0}
        >
          {item.id === 'summary' ? (
            /* Structured `requestData` first; legacy request details that
               exist only in the notes are preserved READABLY below it —
               never parsed, invented or rewritten. */
            <ClientRequestSection
              heading="ملخص الطلب"
              requestData={client.requestData}
              notes={client.notes}
            />
          ) : item.id === 'history' ? (
            <ClientFollowUpTimeline items={client.history} />
          ) : item.id === 'properties' ? (
            <>
              <div className={styles.list}>
                {client.properties.length ? (
                  client.properties.map((p) => (
                    <SuitablePropertyMiniCard key={p.name} property={p} />
                  ))
                ) : (
                  <p>لا يوجد عقار مناسب مرتبط بهذا العميل.</p>
                )}
              </div>
              {/* Real `ClientPropertyInterest` rows: interest in an EXISTING
                  program property, saved with the wizard. Clickable rows open
                  the EXACT property through the shared deep-link channel. */}
              {client.propertyInterests.length ? (
                <>
                  <h3>استفسارات عقارات البرنامج</h3>
                  <div className={styles.list}>
                    {client.propertyInterests.map((interest) => (
                      <ClientInterestMiniCard
                        key={interest.propertyId}
                        interest={interest}
                        onOpenProperty={onOpenProperty}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : extraNotes ? (
            <ClientNotesBlock notes={extraNotes} />
          ) : client.notes ? (
            <p>لا توجد ملاحظات إضافية — تفاصيل الطلب معروضة في ملخص الطلب.</p>
          ) : (
            <p>لا توجد ملاحظات.</p>
          )}
        </section>
      ))}
      {/* THE shared wizard, EDIT mode — the same four steps as creation. */}
      {editing && onEditSave ? (
        <AddClientRequestModal
          editing={client}
          onClose={() => setEditing(false)}
          onEditSave={async (payload, idempotencyKey) => {
            const saved = await onEditSave(payload, idempotencyKey);
            if (saved) {
              setEditing(false);
              setNotice('أُرسل طلب التعديل — بانتظار موافقة الإدارة');
            }
            return saved;
          }}
        />
      ) : null}
      {adding ? (
        <AddFollowUpModal
          clientId={client.id}
          onCancel={() => setAdding(false)}
          onSave={async (item) => {
            const failure = await onFollowUp(item);
            if (failure) {
              setNotice(failure);
              return failure;
            }
            setAdding(false);
            setTab('history');
            setNotice('تم تسجيل المتابعة بنجاح');
            return null;
          }}
        />
      ) : null}
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </PropertyOverlay>
  );
}
