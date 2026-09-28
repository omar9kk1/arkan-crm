import type { ReactNode } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Card } from '../../../components/ui/card';
import styles from './followups.module.css';
export function FollowupModalShell({
  title,
  children,
  onClose,
  separatePanels = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  separatePanels?: boolean;
}) {
  return (
    <PropertyOverlay title={title} className={styles.modal} onClose={onClose}>
      <p>سجل بيانات التواصل والمتابعة — معاينة محلية فقط.</p>
      <div className={styles.formLayout}>
        {separatePanels ? children : <Card>{children}</Card>}
        <aside className={styles.stack}>
          <Card>
            <h3>بيانات تلقائية</h3>
            <p>الموظف: أحمد محمد</p>
            <p>يسجل وقت النتيجة عند الحفظ.</p>
          </Card>
          <Card>
            <h3>بعد الحفظ</h3>
            <p>
              تتحدث هذه الصفحة مؤقتًا، دون إرسال إشعارات أو تغيير ملفات العملاء
              والملاك في الصفحات الأخرى.
            </p>
          </Card>
        </aside>
      </div>
    </PropertyOverlay>
  );
}
