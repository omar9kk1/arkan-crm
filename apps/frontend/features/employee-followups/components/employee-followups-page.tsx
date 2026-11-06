'use client';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { FollowUpsBoard } from './followups-board';

export default function EmployeeFollowupsPage() {
  return (
    <EmployeePageShell
      title="المتابعات"
      description="متابعة العملاء، العقارات، والطلبات (مشترين، مستأجرين، بدل، استفسارات) مع سجل متابعة مستقل لكل عنصر."
    >
      <FollowUpsBoard propertyBase="/employee" toolbarLayout="inline" />
    </EmployeePageShell>
  );
}
