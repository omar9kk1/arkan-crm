'use client';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { ComingSoon } from '../../../components/ui/coming-soon';

export default function EmployeeSettingsPage() {
  return (
    <EmployeePageShell description="">
      <ComingSoon
        icon="settings"
        title="الإعدادات"
        message="قريبًا في الإصدار القادم"
        description="نعمل على تجهيز إعدادات حسابك. ستتوفر هذه الصفحة في إصدار قادم."
      />
    </EmployeePageShell>
  );
}
