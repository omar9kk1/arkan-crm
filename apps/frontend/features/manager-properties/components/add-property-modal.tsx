import { AddPropertyModal as PropertyForm } from '../../employee-properties/components/add-property-modal';
import { formatPropertyDescription } from '../../../lib/property-description';
import type { PreviewProperty } from '../preview-data';
export function AddPropertyModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (properties: PreviewProperty[]) => void;
}) {
  return (
    <PropertyForm
      manager
      onClose={onClose}
      onSave={(properties) =>
        onSave(
          properties.map((property) => ({
            code: property.code,
            title: property.title,
            region: property.region,
            price: property.price
              ? `${Number(property.price).toLocaleString('en-US')} د.ك`
              : 'غير محدد',
            area: Number(property.area),
            rooms: property.rooms,
            status: 'معتمد',
            requestDraft: property.requestDraft,
            owner: property.owner,
            imageUrl: property.imageUrl,
            ownerUserId: property.ownerUserId,
            responsibleName: property.responsibleName,
            contactType: property.contactType,
            description: [
              formatPropertyDescription(property.description),
              `العنوان: ${property.address}`,
              property.ownerNotes,
            ]
              .filter(Boolean)
              .join('\n'),
            employees: [],
          })),
        )
      }
    />
  );
}
