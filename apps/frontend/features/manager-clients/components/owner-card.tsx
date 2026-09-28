import type { OwnerSample } from '../mock-data';
import { PersonCard } from './person-card';
export function OwnerCard({
  owner,
  onOpen,
}: {
  owner: OwnerSample;
  onOpen: () => void;
}) {
  return (
    <PersonCard
      name={owner.name}
      phone={owner.phone}
      summary={`${owner.properties.length} عقار · ${owner.properties.map((property) => property.code).join('، ')}`}
      employee={owner.employees.map((employee) => employee.name).join('، ')}
      lastFollowUp={owner.lastFollowUp}
      status={owner.status}
      late={owner.status === 'متأخر'}
      onOpen={onOpen}
    />
  );
}
