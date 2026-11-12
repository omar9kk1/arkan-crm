import { StatCard } from '../../../components/ui/stat-card';

export function EmployeeStatCard({
  title,
  value,
}: {
  title: string;
  value: number | string;
}) {
  return (
    <StatCard title={title} value={value} hint="" icon="users" />
  );
}
