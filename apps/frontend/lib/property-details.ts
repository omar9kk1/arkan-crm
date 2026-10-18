import type {
  ApprovalStatusApi,
  ContactSummaryDto,
  PublicPropertyDto,
  PropertyViewDto,
} from './api/property-types';
import { hasPrivateContact, isPrivatePropertyDto } from './api/property-types';

/** Display projection only: no contact notes, storage paths or reconstructed data. */
export type PropertyDetails = Pick<
  PublicPropertyDto,
  | 'listingType'
  | 'status'
  | 'governorate'
  | 'district'
  | 'block'
  | 'plotNumber'
  | 'address'
  | 'sizeSqm'
  | 'floorCount'
  | 'floors'
  | 'askingPrice'
  | 'negotiable'
  | 'requestedProperty'
  | 'responsibleName'
> & {
  generalDescription: string;
  contact: Pick<ContactSummaryDto, 'type' | 'name' | 'phone'> | null;
  reviewStatus: ApprovalStatusApi | null;
  reviewNotes: string | null;
};

/** Recognize the wizard envelope only to omit its duplicate generated summary.
 * Never use its text/JSON as a source of structured or private fields. */
export function generalPropertyDescription(value: string | null): string {
  if (!value?.trim()) return '';
  const text = value.trim();
  if (text.startsWith('{')) {
    try {
      const envelope: unknown = JSON.parse(
        text.split('\n\n=== العقار المطلوب في البدل ===')[0] ?? '',
      );
      if (
        envelope &&
        typeof envelope === 'object' &&
        'entryMethod' in envelope &&
        'floors' in envelope
      )
        return '';
    } catch {
      // A damaged wizard envelope must not expose raw internal JSON either.
      if (/"entryMethod"\s*:/.test(text) && /"floors"\s*:/.test(text))
        return '';
    }
  }
  return value;
}

export function mapPropertyDetails(dto: PropertyViewDto): PropertyDetails {
  const privateDto = isPrivatePropertyDto(dto);
  const contact = hasPrivateContact(dto) ? dto.contact : null;
  return {
    listingType: dto.listingType,
    status: dto.status,
    governorate: dto.governorate,
    district: dto.district,
    block: dto.block,
    plotNumber: dto.plotNumber,
    address: dto.address,
    sizeSqm: dto.sizeSqm,
    floorCount: dto.floorCount,
    floors: dto.floors.map((floor) => ({ ...floor })),
    askingPrice: dto.askingPrice,
    negotiable: dto.negotiable,
    requestedProperty:
      dto.listingType === 'EXCHANGE' ? dto.requestedProperty : null,
    responsibleName: dto.responsibleName,
    generalDescription: generalPropertyDescription(dto.description),
    contact: contact
      ? {
          type: contact.type,
          name: contact.name,
          phone: contact.phone,
        }
      : null,
    reviewStatus: privateDto ? dto.reviewStatus : null,
    reviewNotes: privateDto ? dto.reviewNotes : null,
  };
}
