import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Card } from '../../../components/ui/card';
import styles from './page.module.css';

export default function Page() {
  return (
    <ManagerPageShell title="الحضور والانصراف">
      <Card className={styles.comingSoon}>
        <p className={styles.message}>قريبًا — في الإصدار القادم</p>
      </Card>
    </ManagerPageShell>
  );
}
