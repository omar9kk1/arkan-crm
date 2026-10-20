import { useRouter } from 'next/navigation';
import { Role } from '@arkan/shared';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import type { OwnerSample } from '../client-model';
import { PersonProperties } from './person-properties';
import { OwnerEmployeeFollowUpTabs } from './owner-employee-follow-up-tabs';
import { useAuth } from '../../auth/components/auth-provider';
import { requestOpenProperty } from '../../notifications/open-property';
import { PROPERTY_QUERY_PARAM } from '../../../lib/property-reveal';
import styles from './clients.module.css';
export function OwnerDetailsDrawer({
  owner,
  onClose,
}: {
  owner: OwnerSample;
  onClose: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  // Reuses the existing property deep-link channel AND carries the id in the
  // URL: the properties page resolves both through one authorized
  // `GET /properties/:id`, activates the tab that shows the row, merges the real
  // row into the grid so the exact card is present even off the first page,
  // highlights it and opens the existing drawer. The URL keeps the selection
  // across a refresh or a direct deep-link.
  const openProperty = (propertyId: string) => {
    requestOpenProperty(propertyId);
    const route =
      user?.role === Role.MANAGER ? '/manager/properties' : '/employee/properties';
    router.push(`${route}?${PROPERTY_QUERY_PARAM}=${encodeURIComponent(propertyId)}`);
  };
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
      <PersonProperties
        properties={owner.properties}
        onOpenProperty={openProperty}
      />
      <h3>الموظفون المتابعون مع المالك</h3>
      <p className={styles.secondary}>لكل موظف سجل مستقل مع نفس المالك.</p>
      <OwnerEmployeeFollowUpTabs employees={owner.employees} />
    </PropertyOverlay>
  );
}
