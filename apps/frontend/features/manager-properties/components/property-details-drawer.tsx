'use client';
import { useState } from 'react';
import type { PreviewProperty } from '../preview-data';
import { Button } from '../../../components/ui/button';
import { PropertyOverlay } from './property-overlay';
import { PropertiesSegmentedTabs } from './properties-segmented-tabs';
import {
  PropertyDetailHeader,
  PropertyDetailSections,
} from './property-detail-sections';
import detailStyles from './property-detail-sections.module.css';
import styles from './properties.module.css';
export function PropertyDetailsDrawer({
  property,
  onClose,
  onAction,
  busy = false,
}: {
  property: PreviewProperty;
  onClose: () => void;
  /** When provided, the drawer surfaces the manager's review decisions. */
  onAction?: (action: string, property: PreviewProperty) => void;
  /** True while a decision for this row is in flight — blocks a double click. */
  busy?: boolean;
}) {
  const [employeeId, setEmployeeId] = useState(property.employees[0]?.id ?? '');
  // Only a property still awaiting a manager decision can be reviewed; a row
  // whose changes were requested is waiting on the employee, not the manager.
  const actionable =
    property.apiStatus === 'PENDING' &&
    property.reviewStatus !== 'CHANGES_REQUESTED';
  return (
    <PropertyOverlay
      title={property.title}
      drawer
      onClose={onClose}
      className={detailStyles.drawer}
      headerDetails={
        <PropertyDetailHeader
          status={property.status}
          reference={property.code}
        />
      }
    >
      <PropertyDetailSections details={property.details}>
        {onAction && actionable && (
          <div className={styles.actions}>
            {['اعتماد', 'طلب تعديل', 'رفض'].map((action) => (
              <Button
                key={action}
                type="button"
                onClick={() => onAction(action, property)}
                aria-label={`${action} ${property.code}`}
                disabled={busy}
                aria-busy={busy}
              >
                {action}
              </Button>
            ))}
          </div>
        )}
      </PropertyDetailSections>
      {/* Follow-up history has no backend persistence yet, so the block is
          hidden instead of rendering an empty tab strip. */}
      {property.employees.length > 0 && (
        <>
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
        </>
      )}
    </PropertyOverlay>
  );
}
