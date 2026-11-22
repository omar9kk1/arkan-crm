'use client';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { FollowUpsBoard } from './followups-board';

export default function EmployeeFollowupsPage() {
  return (
    <EmployeePageShell
      title="المتابعات"
    >
      <FollowUpsBoard propertyBase="/employee" toolbarLayout="inline" />
    </EmployeePageShell>
  );
}
