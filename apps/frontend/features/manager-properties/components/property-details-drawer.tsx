'use client';
import { useState } from 'react';
import type { PreviewProperty } from '../preview-data';
import { PropertyOverlay } from './property-overlay';
import { PropertiesSegmentedTabs } from './properties-segmented-tabs';
import { PropertyStatusBadge } from './property-status-badge';
import styles from './properties.module.css';
export function PropertyDetailsDrawer({
  property,
  onClose,
}: {
  property: PreviewProperty;
  onClose: () => void;
}) {
  const [employeeId, setEmployeeId] = useState(property.employees[0]?.id ?? '');
  return (
    <PropertyOverlay title={property.title} drawer onClose={onClose}>
      <div className={styles.drawerImage} aria-hidden="true" />
      <div className={styles.badges}>
        <PropertyStatusBadge status={property.status} />
        <span className={styles.badge}>{property.code}</span>
      </div>
      <p>{property.description}</p>
      <dl className={styles.facts}>
        {[
          ['السعر', property.price],
          ['المنطقة', property.region],
          ['المساحة', `${property.area} م²`],
          ['التوزيع', property.rooms],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <section className={styles.inset}>
        <h3>صاحب العقار / المالك</h3>
        <strong>{property.owner}</strong>
        <p>بيانات تجريبية — قد يتابع أكثر من موظف مع نفس المالك.</p>
      </section>
      <h3>الموظفون المتابعون مع المالك</h3>
      <PropertiesSegmentedTabs
        id="owner-followups"
        label="اختيار الموظف المتابع"
        items={property.employees.map((employee) => ({
          id: employee.id,
          label: employee.name,
        }))}
        value={employeeId}
        onChange={setEmployeeId}
      />
      {property.employees.map((employee) => (
        <section
          key={employee.id}
          role="tabpanel"
          tabIndex={0}
          hidden={employeeId !== employee.id}
          id={`owner-followups-panel-${employee.id}`}
          aria-labelledby={`owner-followups-tab-${employee.id}`}
        >
          <h3>سجل متابعة {employee.name}</h3>
          <ul className={styles.followups}>
            {employee.entries.map((entry) => (
              <li key={entry.date}>
                <time dateTime={entry.date}>{entry.date}</time>
                <p>{entry.note}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PropertyOverlay>
  );
}
