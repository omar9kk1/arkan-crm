import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import type { Property } from '../model';
import { PropertyStatusBadge } from './employee-property-card';
import styles from './properties.module.css';
export function EmployeePropertyDetailsDrawer({
  property: p,
  onClose,
  onEdit,
}: {
  property: Property;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [employee, setEmployee] = useState('0');
  return (
    <PropertyOverlay title={`${p.title} · ${p.code}`} drawer onClose={onClose}>
      <div
        className={styles.photo}
        role="img"
        aria-label="صورة معمارية توضيحية"
      />
      <PropertyStatusBadge status={p.status} />
      <dl className={styles.facts}>
        {[
          ['المالك', p.owner],
          ['الهاتف', p.phone],
          ['العملية', p.operation],
          ['السعر', `${p.price} د.ك`],
          ['المنطقة', p.region],
          ['العنوان', p.address],
          ['المساحة', `${p.area} م²`],
          ['الغرف / الدور', p.rooms],
          ['سبب التخصيص', p.assignment || 'غير مخصص لك'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p>{p.description}</p>
      <p>{p.ownerNotes}</p>
      {p.assignment && (
        <p>التخصيص أولوية فقط، وباقي الموظفين يمكنهم العمل على العقار.</p>
      )}
      <h3>الموظفون المتابعون مع المالك</h3>
      <SegmentedTabs
        id="owner-followers"
        label="الموظفون المتابعون"
        items={p.followers.map((f, i) => ({ id: String(i), label: f.name }))}
        value={employee}
        onChange={setEmployee}
      />
      {p.followers.map((f, i) => (
        <section
          key={f.name}
          role="tabpanel"
          id={`owner-followers-panel-${i}`}
          aria-labelledby={`owner-followers-tab-${i}`}
          hidden={employee !== String(i)}
        >
          <div className={styles.list}>
            {f.entries.length ? (
              f.entries.map((entry, index) => (
                <Card key={index}>
                  <time>{entry.date}</time>
                  <p>{entry.note}</p>
                </Card>
              ))
            ) : (
              <p>لا توجد متابعات مسجلة.</p>
            )}
          </div>
        </section>
      ))}
      {p.managerNotes && (
        <Card>
          <h3>ملاحظات المدير</h3>
          <p>{p.managerNotes}</p>
        </Card>
      )}
      {p.status === 'مطلوب تعديل' && p.mine && (
        <Button onClick={onEdit}>تعديل وإعادة إرسال</Button>
      )}
    </PropertyOverlay>
  );
}
