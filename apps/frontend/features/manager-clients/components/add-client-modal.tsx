import { AddClientRequestModal } from '../../employee-clients/components/request-wizard/add-client-request-modal';
import type {
  EditClientRequestPayload,
} from '../../employee-clients/components/request-wizard/client-request-bundle';
import type { ClientSample } from '../client-model';
export function AddClientModal({
  onClose,
  onSave,
  onEditSave,
  editing,
  clients,
}: {
  onClose: () => void;
  onSave: (client: ClientSample) => void | boolean | Promise<void | boolean>;
  /** EDIT mode passthrough: the SAME wizard reused for an existing client. */
  onEditSave?: (payload: EditClientRequestPayload) => Promise<boolean>;
  editing?: ClientSample;
  clients: readonly ClientSample[];
}) {
  return (
    <AddClientRequestModal
      onClose={onClose}
      // EDIT mode reuses the ONE wizard with the SAME prefilled authorisation
      // path the employee drawer opens — no duplicated four steps anywhere.
      editing={
        editing
          ? {
              id: editing.id,
              name: editing.name,
              phone: editing.phone,
              type: editing.type,
              area: '',
              budget: '',
              notes: editing.notes || '',
              history: [],
              next: editing.nextFollowUp,
              lastFollowUp: editing.lastFollowUp,
              employee: editing.employee,
              properties: editing.properties.map((p) => ({
                name: p.title,
                area: '',
                price: p.summary,
              })),
              propertyInterests: (editing.propertyInterests ?? []).map((row) => ({
                propertyId: row.id,
                name: row.title,
                area: '',
                price: row.summary,
                reason: row.reason,
                notes: row.notes,
              })),
              requestData: editing.requestData,
              requestBundle: editing.requestBundle,
            }
          : undefined
      }
      onEditSave={onEditSave}
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
        lastFollowUp: client.lastFollowUp,
        employee: client.employee,
        properties: client.properties.map((p) => ({
          name: p.title,
          area: '',
          price: p.summary,
        })),
        // Interests handed to the wizard as its own display shape.
        propertyInterests: (client.propertyInterests ?? []).map((row) => ({
          propertyId: row.id,
          name: row.title,
          area: '',
          price: row.summary,
          reason: row.reason,
          notes: row.notes,
        })),
        requestBundle: client.requestBundle,
      }))}
      onSave={async (client) => {
        const previous = clients.find((c) => c.id === client.id);
        const newProperties = client.properties.map((p) => ({
          id: '',
          code: p.name.match(/K\d+/)?.[0] || p.name,
          title: p.name,
          summary: `${p.area} · ${p.price}`,
        }));
        return await onSave({
          id: previous?.id ?? client.id,
          name: client.name,
          phone: client.phone,
          type: client.type,
          employee: previous?.employee || 'المدير — لم يُخصص لموظف بعد',
          lastFollowUp: previous?.lastFollowUp || 'لم تُسجل بعد',
          nextFollowUp: previous?.nextFollowUp || 'لم يُحدد بعد',
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
          // Interests keep coming from the NEXT "refresh" read; the locally
          // changed draft links are only display-aids until then.
          propertyInterests: previous?.propertyInterests ?? [],
          requestBundle: previous?.requestBundle ?? client.requestBundle,
        });
      }}
    />
  );
}
