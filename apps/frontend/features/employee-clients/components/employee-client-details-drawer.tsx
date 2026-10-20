import { useDraftState } from '../../../lib/drafts/use-form-draft';
import { Toast } from '../../../components/ui/toast';
import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { Button } from '../../../components/ui/button';
import { type EmployeeClient, type FollowUp } from '../client-model';
import {
  ClientFollowUpTimeline,
  ClientInterestMiniCard,
  SuitablePropertyMiniCard,
} from './client-cards';
import { AddFollowUpModal } from './add-follow-up-modal';
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
}: {
  client: EmployeeClient;
  onClose: () => void;
  onFollowUp: (item: FollowUp) => Promise<string | null>;
  /** Ask the properties page to open one exact `Property.id`. */
  onOpenProperty?: (propertyId: string) => void;
}) {
  const [tab, setTab] = useState('summary'),
    [adding, setAdding] = useDraftState(
      'ui:client-followup:' + client.id,
      false,
    ),
    [notice, setNotice] = useState('');
  return (
    <PropertyOverlay title={client.name} drawer onClose={onClose}>
      <p>
        <bdi>{client.phone}</bdi> · الموظف المسؤول: {client.employee}
      </p>
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
            <dl className={styles.facts}>
              {[
                ['نوع الطلب', client.type],
                ['المناطق المطلوبة', client.area],
                ['الميزانية', `${client.budget} د.ك`],
                ['المتابعة القادمة', client.next || 'لم تحدد'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
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
          ) : (
            <p>{client.notes || 'لا توجد ملاحظات.'}</p>
          )}
        </section>
      ))}
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
      ) : (
        <Button onClick={() => setAdding(true)}>إضافة متابعة</Button>
      )}
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </PropertyOverlay>
  );
}
