import { Card } from '../../../../components/ui/card';
import styles from './request-wizard.module.css';
export function UsageHelpPanel() {
  return (
    <aside className={styles.help}>
      <Card>
        <h3>طريقة الاستخدام</h3>
        <strong>طلب جديد</strong>
        <p>استخدمه لو العميل يبحث عن مواصفات والنظام يطابق له العقارات.</p>
        <strong>عقار موجود</strong>
        <p>استخدمه لو العميل يسأل عن عقار محدد موجود بالفعل.</p>
      </Card>
      <Card>
        <p>
          لو العميل اتصل بسبب إعلان عقار محدد: اختر «عميل على عقار موجود»، ثم
          اختر العقار، ثم احفظ بيانات العميل.
        </p>
        <small>
          هذه معاينة فقط؛ تحليل الرسالة والمطابقة والإشعارات غير مفعّلة حاليًا.
        </small>
      </Card>
    </aside>
  );
}
