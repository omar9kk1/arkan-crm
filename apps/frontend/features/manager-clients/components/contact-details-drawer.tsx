import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import type { RegistryContact } from '../../../lib/contact-registry';
import styles from './clients.module.css';

const typeLabel: Record<RegistryContact['type'], string> = {
  OWNER: 'مالك مباشر',
  BROKER: 'وسيط عقاري',
};

/** Read-only owner/broker registry record, including associated properties. */
export function ContactDetailsDrawer({
  contact,
  onClose,
}: {
  contact: RegistryContact;
  onClose: () => void;
}) {
  return (
    <PropertyOverlay
      drawer
      title={`ملف ${typeLabel[contact.type]} · ${contact.name}`}
      onClose={onClose}
    >
      <dl className={styles.facts}>
        {[
          ['الاسم', contact.name],
          ['الهاتف', contact.phone],
          ['النوع', typeLabel[contact.type]],
          ['النطاق', contact.scope === 'COMPANY' ? 'سجل مشترك' : 'سجل موظف'],
          [
            'الموظف المسؤول',
            contact.ownerName || 'سجل الشركة (بدون موظف محدد)',
          ],
          ['عدد العقارات المرتبطة', String(contact.propertyCodes.length)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <h3>العقارات المرتبطة</h3>
      {contact.propertyCodes.length ? (
        <ul className={styles.timeline}>
          {contact.propertyCodes.map((code) => (
            <li key={code}>
              <span className={styles.badge}>{code}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.empty}>لا توجد عقارات مرتبطة بهذا السجل بعد.</p>
      )}
      {contact.notes && (
        <>
          <h3>ملاحظات</h3>
          <p style={{ whiteSpace: 'pre-line' }}>{contact.notes}</p>
        </>
      )}
      <p className={styles.alert}>
        سجل واجهة أمامية فقط (بيانات جلسة المتصفح) ولا يمثل بيانات محفوظة في
        قاعدة البيانات.
      </p>
    </PropertyOverlay>
  );
}
