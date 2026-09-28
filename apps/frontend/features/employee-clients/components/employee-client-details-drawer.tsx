import { useDraftState } from '../../../lib/drafts/use-form-draft';
import { Toast } from '../../../components/ui/toast';
import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
import { Button } from '../../../components/ui/button';
import { type EmployeeClient, type FollowUp } from '../client-model';
import {
  ClientFollowUpTimeline,
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
}: {
  client: EmployeeClient;
  onClose: () => void;
  onFollowUp: (item: FollowUp) => void;
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
        <bdi>{client.phone}</bdi> · الموظف المسؤول: أحمد محمد
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
            <div className={styles.list}>
              {client.properties.length ? (
                client.properties.map((p) => (
                  <SuitablePropertyMiniCard key={p.name} property={p} />
                ))
              ) : (
                <p>لا يوجد عقار مناسب ضمن العينة الحالية.</p>
              )}
            </div>
          ) : (
            <p>{client.notes || 'لا توجد ملاحظات.'}</p>
          )}
        </section>
      ))}
      {adding ? (
        <AddFollowUpModal
          clientId={client.id}
          onCancel={() => setAdding(false)}
          onSave={(item) => {
            onFollowUp(item);
            setAdding(false);
            setTab('history');
            setNotice('تم تسجيل المتابعة مؤقتًا');
          }}
        />
      ) : (
        <Button onClick={() => setAdding(true)}>إضافة متابعة</Button>
      )}
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </PropertyOverlay>
  );
}
