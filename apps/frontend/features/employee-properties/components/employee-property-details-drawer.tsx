import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import type { Property } from '../model';
import { awaitingCorrection } from '../../../lib/property-adapter';
import {
  PropertyDetailHeader,
  PropertyDetailSections,
} from '../../manager-properties/components/property-detail-sections';
import detailStyles from '../../manager-properties/components/property-detail-sections.module.css';
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
    <PropertyOverlay
      title={p.title || p.operation}
      drawer
      onClose={onClose}
      className={detailStyles.drawer}
      headerDetails={
        <PropertyDetailHeader status={p.status} reference={p.code} />
      }
    >
      <PropertyDetailSections
        details={p.details}
      >
        {/* Keyed on the stored states, not on the label: both a REJECTED row
            and a PENDING row sent back for changes must keep offering the
            correction + resubmission action. */}
        {awaitingCorrection(p) && p.mine ? (
          <Button onClick={onEdit}>تعديل وإعادة إرسال</Button>
        ) : null}
      </PropertyDetailSections>
      {/* Follow-up history has no backend persistence yet, so the block is
          hidden instead of rendering an empty tab strip. */}
      {p.followers.length > 0 && (
        <>
          <h3>الموظفون المتابعون مع المالك</h3>
          <SegmentedTabs
            id="owner-followers"
            label="الموظفون المتابعون"
            items={p.followers.map((f, i) => ({
              id: String(i),
              label: f.name,
            }))}
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
        </>
      )}
    </PropertyOverlay>
  );
}
