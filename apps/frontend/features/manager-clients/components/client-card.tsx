import type { ClientSample } from '../client-model';
import { PersonCard } from './person-card';
export function ClientCard({
  client,
  onOpen,
}: {
  client: ClientSample;
  onOpen: () => void;
}) {
  return (
    <PersonCard
      name={client.name}
      phone={client.phone}
      summary={`${client.type} · ${client.request}`}
      employee={client.employee}
      lastFollowUp={client.lastFollowUp}
      status={client.status}
      late={client.status === 'متابعة متأخرة'}
      onOpen={onOpen}
    />
  );
}
