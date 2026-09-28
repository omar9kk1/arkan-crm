import styles from './settings.module.css';
const permissions = [
  ['عرض العقارات', true],
  ['إضافة عقار', true],
  ['إرسال عقار للمراجعة', true],
  ['عرض العملاء', true],
  ['تسجيل متابعة', true],
  ['تسجيل صفقة', false],
  ['عرض المالية', false],
] as const;
export function SettingsPermissionList() {
  return (
    <>
      <p className={styles.note}>
        معاينة توضيحية للصلاحيات فقط؛ لا تغيّر صلاحيات الحسابات.
      </p>
      <div className={styles.permissions}>
        {['Manager', 'Employee'].map((role) => (
          <section key={role} aria-label={`صلاحيات ${role}`}>
            <h3>{role}</h3>
            <ul>
              {permissions.map(([label, employeeAllowed]) => (
                <li key={label}>
                  <span>{label}</span>
                  <span className={styles.badge}>
                    {role === 'Manager' || employeeAllowed
                      ? 'مسموح'
                      : 'للمدير فقط'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
