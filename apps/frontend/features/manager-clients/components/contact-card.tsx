import type { RegistryContact } from '../../../lib/contact-registry';
import styles from './clients.module.css';

const typeLabel: Record<RegistryContact['type'], string> = {
  OWNER: 'مالك',
  BROKER: 'وسيط',
};

/** Owner/broker registry card. Mirrors the clients/owners person card layout. */
export function ContactCard({
  contact,
  onOpen,
}: {
  contact: RegistryContact;
  onOpen: () => void;
}) {
  const propertySummary = contact.propertyCodes.length
    ? `${contact.propertyCodes.length} عقار · ${contact.propertyCodes.join('، ')}`
    : 'لا توجد عقارات مرتبطة';
  const scopeLabel = contact.scope === 'COMPANY' ? 'سجل مشترك' : 'سجل الموظف';
  return (
    <button
      type="button"
      className={styles.personCard}
      onClick={onOpen}
      aria-label={`فتح ملف ${contact.name}`}
    >
      <span className={styles.personMain}>
        <span className={styles.avatar} aria-hidden="true">
          {contact.name.slice(0, 1)}
        </span>
        <span>
          <strong>{contact.name}</strong>
          <span className={styles.secondary}>
            {typeLabel[contact.type]} · {propertySummary}
          </span>
          <bdi className={styles.phone}>{contact.phone}</bdi>
        </span>
      </span>
      <span>
        <span className={styles.secondary}>الموظف المسؤول</span>
        <strong>{contact.ownerName || 'سجل الشركة'}</strong>
      </span>
      <span>
        <span className={styles.secondary}>عدد العقارات</span>
        <strong>{contact.propertyCodes.length}</strong>
      </span>
      <span className={styles.badge}>{scopeLabel}</span>
    </button>
  );
}
