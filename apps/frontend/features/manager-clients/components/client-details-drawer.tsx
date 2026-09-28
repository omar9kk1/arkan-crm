'use client';
import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
import type { ClientSample } from '../mock-data';
import { FollowUpTimeline } from './follow-up-timeline';
import { PersonProperties } from './person-properties';
import styles from './clients.module.css';
export function ClientDetailsDrawer({
  client,
  onClose,
}: {
  client: ClientSample;
  onClose: () => void;
}) {
  const [tab, setTab] = useState('summary');
  return (
    <PropertyOverlay
      drawer
      title={`ملف العميل · ${client.name}`}
      onClose={onClose}
    >
      <dl className={styles.facts}>
        {[
          ['الاسم', client.name],
          ['الهاتف', client.phone],
          ['نوع العميل', client.type],
          ['الموظف المسؤول', client.employee],
          ['الحالة', client.status],
          ['آخر نتيجة متابعة', client.timeline[0]?.result ?? 'لا توجد'],
          ['المتابعة القادمة', client.nextFollowUp],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      {client.status === 'متابعة متأخرة' && (
        <p className={styles.alert}>
          توجد متابعة متأخرة تحتاج مراجعة من المدير
        </p>
      )}
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
        <h3>ملخص الطلب</h3>
        <p>{client.request}</p>
        {client.notes && (
          <>
            <h3>ملاحظات العميل</h3>
            <p style={{ whiteSpace: 'pre-line' }}>{client.notes}</p>
          </>
        )}
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
        <h3>الطلب والعقارات المناسبة</h3>
        <p>{client.request}</p>
        <PersonProperties properties={client.properties} />
        <p className={styles.secondary}>
          مطابقات تجريبية وليست اقتراحات من النظام.
        </p>
      </section>
    </PropertyOverlay>
  );
}
