import type { OwnerSample } from '../client-model';
import { PersonCard } from './person-card';
export function OwnerCard({
  owner,
  onOpen,
}: {
  owner: OwnerSample;
  onOpen: () => void;
}) {
  const propertyCount = owner.properties.length;
  const propertyLabel =
    propertyCount >= 3 && propertyCount <= 10 ? 'عقارات' : 'عقار';
  return (
    <PersonCard
      name={owner.name}
      phone={owner.phone}
      summary={`${propertyCount} ${propertyLabel}`}
      employee={owner.employee}
      lastFollowUp={owner.lastFollowUp}
      status={owner.status}
      late={owner.status === 'متأخر'}
      typePills={owner.typePills}
      onOpen={onOpen}
    />
  );
}
