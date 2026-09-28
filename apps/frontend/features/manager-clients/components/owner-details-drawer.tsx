import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import type { OwnerSample } from '../mock-data';
import { PersonProperties } from './person-properties';
import { OwnerEmployeeFollowUpTabs } from './owner-employee-follow-up-tabs';
import styles from './clients.module.css';
export function OwnerDetailsDrawer({
  owner,
  onClose,
}: {
  owner: OwnerSample;
  onClose: () => void;
}) {
  return (
    <PropertyOverlay
      drawer
      title={`ملف المالك · ${owner.name}`}
      onClose={onClose}
    >
      <dl className={styles.facts}>
        {[
          ['الاسم', owner.name],
          ['الهاتف', owner.phone],
          ['الحالة', owner.status],
          ['آخر متابعة', owner.lastFollowUp],
          ['عدد العقارات', String(owner.properties.length)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      {owner.status === 'متأخر' && (
        <p className={styles.alert}>
          توجد متابعة متأخرة تحتاج مراجعة من المدير
        </p>
      )}
      <h3>العقارات التابعة للمالك</h3>
      <PersonProperties properties={owner.properties} />
      <h3>الموظفون المتابعون مع المالك</h3>
      <p className={styles.secondary}>لكل موظف سجل مستقل مع نفس المالك.</p>
      <OwnerEmployeeFollowUpTabs employees={owner.employees} />
    </PropertyOverlay>
  );
}
