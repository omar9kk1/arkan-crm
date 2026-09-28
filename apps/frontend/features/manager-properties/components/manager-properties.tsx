'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Button } from '../../../components/ui/button';
import { StatCard } from '../../../components/ui/stat-card';
import { SearchBar } from '../../../components/ui/search-bar';
import { SectionHeader } from '../../../components/ui/section-header';
import {
  approvalProperties,
  programProperties,
  type PreviewProperty,
} from '../preview-data';
import { PropertiesSegmentedTabs } from './properties-segmented-tabs';
import { PropertyCard } from './property-card';
import { PropertyDetailsDrawer } from './property-details-drawer';
import { ApprovalPropertyCard } from './approval-property-card';
import { AddPropertyModal } from './add-property-modal';
import styles from './properties.module.css';
export function ManagerProperties() {
  const [properties, setProperties] = useState<PreviewProperty[]>([
    ...programProperties,
  ]);
  const [tab, setTab] = useState('program');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<PreviewProperty | null>(null);
  const [adding, setAdding] = useDraftState(
    'ui:features/manager-properties/components/manager-properties.tsx:adding',
    false,
  );
  const [notice, setNotice] = useState({ text: '', sequence: 0 });
  const matches = (property: PreviewProperty) =>
    `${property.title} ${property.region} ${property.code}`
      .toLocaleLowerCase('ar')
      .includes(query.trim().toLocaleLowerCase('ar'));
  const visible = properties.filter(matches);
  const approvals = approvalProperties.filter(matches);
  const regions = [...new Set(visible.map((property) => property.region))];
  return (
    <ManagerPageShell
      title="عقارات المدير"
      description="صفحة واحدة لإدارة العقارات داخل النظام، ومراجعة العقارات المرسلة من الموظفين قبل اعتمادها."
      actions={<Button onClick={() => setAdding(true)}>إضافة عقار</Button>}
    >
      <div className={styles.scope}>
        <p className={styles.preview}>
          بيانات تجريبية فقط • أرقام التبويبات توضيحية والقوائم تعرض عينة مصغرة
          • الإجراءات لا تُحفظ.
        </p>
        <div className={styles.stats}>
          {[
            { title: 'عقار داخل البرنامج', value: properties.length },
            { title: 'بانتظار الموافقة', value: approvalProperties.length },
            { title: 'عقار معتمد', value: properties.length },
            { title: 'مطلوب تعديل', value: 0 },
          ].map((item) => (
            <StatCard
              key={item.title}
              {...item}
              icon="building"
              hint="ضمن العينة التجريبية"
            />
          ))}
        </div>
        <div className={styles.toolbar}>
          <PropertiesSegmentedTabs
            id="properties"
            label="قوائم العقارات"
            items={[
              {
                id: 'program',
                label: 'العقارات',
                count: 26 + properties.length - programProperties.length,
              },
              {
                id: 'approval',
                label: 'تحت المراجعة',
                count: 5,
              },
            ]}
            value={tab}
            onChange={setTab}
          />
          <SearchBar
            label="البحث في العقارات بالمنطقة أو الكود"
            placeholder="ابحث بالمنطقة أو الكود..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <section
          role="tabpanel"
          tabIndex={0}
          id="properties-panel-program"
          aria-labelledby="properties-tab-program"
          hidden={tab !== 'program'}
        >
          {regions.map((region) => (
            <section key={region} className={styles.region}>
              <SectionHeader
                title={`عقارات ${region}`}
                description="العقارات المعتمدة داخل البرنامج"
              >
                <span className={styles.badge}>
                  {
                    visible.filter((property) => property.region === region)
                      .length
                  }{' '}
                  عقار
                </span>
              </SectionHeader>
              <div className={styles.propertyGrid}>
                {visible
                  .filter((property) => property.region === region)
                  .map((property) => (
                    <PropertyCard
                      key={property.code}
                      property={property}
                      onOpen={() => setSelected(property)}
                    />
                  ))}
              </div>
            </section>
          ))}
          {!visible.length && (
            <p className={styles.inset}>لا توجد عقارات تطابق البحث.</p>
          )}
        </section>
        <section
          role="tabpanel"
          tabIndex={0}
          id="properties-panel-approval"
          aria-labelledby="properties-tab-approval"
          hidden={tab !== 'approval'}
        >
          <SectionHeader
            title="عقارات بانتظار الموافقة"
            description="العقارات التي أرسلها الموظفون وتحتاج قرار مراجعة."
          />
          <div className={styles.approvalList}>
            {approvals.map((property) => (
              <ApprovalPropertyCard
                key={property.code}
                property={property}
                onAction={(action, item) =>
                  setNotice((previous) => ({
                    text: `معاينة: ${action} للعقار ${item.code}. لم يتم إرسال أو حفظ أي تغيير.`,
                    sequence: previous.sequence + 1,
                  }))
                }
              />
            ))}
          </div>
          {!approvals.length && (
            <p className={styles.inset}>لا توجد طلبات تطابق البحث.</p>
          )}
        </section>
        <Toast
          message={notice.text}
          eventKey={notice.sequence}
          onDismiss={() => setNotice((previous) => ({ ...previous, text: '' }))}
        />
        {selected && (
          <PropertyDetailsDrawer
            key={selected.code}
            property={selected}
            onClose={() => setSelected(null)}
          />
        )}
        {adding && (
          <AddPropertyModal
            onClose={() => setAdding(false)}
            onSave={(added) => {
              setProperties((previous) => [...added, ...previous]);
              setAdding(false);
              setTab('program');
              setQuery('');
              setNotice((previous) => ({
                text: 'تم إضافة العقار مؤقتًا',
                sequence: previous.sequence + 1,
              }));
            }}
          />
        )}
      </div>
    </ManagerPageShell>
  );
}
