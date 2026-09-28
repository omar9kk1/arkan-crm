import { AddClientRequestModal } from '../../employee-clients/components/request-wizard/add-client-request-modal';
import type { ClientSample } from '../mock-data';
export function AddClientModal({
  onClose,
  onSave,
  clients,
}: {
  onClose: () => void;
  onSave: (client: ClientSample) => void;
  clients: readonly ClientSample[];
}) {
  return (
    <AddClientRequestModal
      onClose={onClose}
      clients={clients.map((client) => ({
        id: client.id,
        name: client.name,
        phone: client.phone,
        type: client.type,
        area: '',
        budget: '',
        notes: client.notes || '',
        history: [],
        next: client.nextFollowUp,
        properties: client.properties.map((p) => ({
          name: p.title,
          area: '',
          price: p.summary,
        })),
        requestBundle: client.requestBundle,
      }))}
      onSave={(client) => {
        const previous = clients.find((c) => c.id === client.id);
        const newProperties = client.properties.map((p) => ({
          code: p.name.match(/K\d+/)?.[0] || p.name,
          title: p.name,
          summary: `${p.area} · ${p.price}`,
        }));
        onSave({
          ...previous,
          id: client.id,
          name: client.name,
          phone: client.phone,
          type: client.type,
          employee: previous?.employee || 'المدير — لم يُخصص لموظف بعد',
          lastFollowUp: previous?.lastFollowUp || 'لم تُسجل بعد',
          nextFollowUp: previous?.nextFollowUp || 'لم تُحدد',
          status: previous?.status || 'مفتوح',
          request: `${client.type} · ${client.area} · الميزانية: ${client.budget}`,
          notes: client.notes,
          timeline: previous?.timeline || [],
          properties: [
            ...(previous?.properties || []),
            ...newProperties,
          ].filter(
            (p, i, list) => list.findIndex((v) => v.code === p.code) === i,
          ),
          requestBundle: client.requestBundle,
        });
      }}
    />
  );
}
