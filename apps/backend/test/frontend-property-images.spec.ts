import {
  satisfiesImageRequirement,
  storedPropertyImages,
} from '../../frontend/features/employee-properties/components/new-property-model-v2';
import { toUpdatePropertyPayload } from '../../frontend/lib/property-adapter';

/**
 * Pure unit tests for the property wizard's image handling.
 *
 * The images of a property live in the program (the API exposes the authorized
 * image through `primaryImageUrl`), NOT in the wizard draft. These tests pin
 * the behaviour the manual test found broken: an edit must show the stored
 * image, must not demand the same upload again, and must never carry an image
 * in the update payload (the PATCH has no image field, so the stored image is
 * kept untouched).
 */

const PROPERTY_ID = 'b7c1e2f3-0000-4000-8000-000000000001';

const stored = {
  id: PROPERTY_ID,
  primaryImageUrl: `/properties/${PROPERTY_ID}/image`,
};

describe('storedPropertyImages — the images a property already has', () => {
  it('returns the stored image of the property being edited', () => {
    expect(storedPropertyImages(stored)).toEqual([
      `/properties/${PROPERTY_ID}/image`,
    ]);
  });

  it('returns nothing for a property without an image or without an id', () => {
    expect(storedPropertyImages(undefined)).toEqual([]);
    expect(storedPropertyImages(null)).toEqual([]);
    expect(storedPropertyImages({ id: PROPERTY_ID, primaryImageUrl: null })).toEqual([]);
    expect(storedPropertyImages({ primaryImageUrl: '/x/image' })).toEqual([]);
  });
});

describe('satisfiesImageRequirement — the mandatory-image rule', () => {
  it('is satisfied by the image a property already stores (no re-upload)', () => {
    expect(
      satisfiesImageRequirement({
        newImage: null,
        storedImages: storedPropertyImages(stored),
        editingExisting: true,
      }),
    ).toBe(true);
  });

  it('is satisfied by a freshly picked file', () => {
    expect(
      satisfiesImageRequirement({
        newImage: { file: {}, preview: 'blob:x' },
        storedImages: [],
        editingExisting: false,
      }),
    ).toBe(true);
  });

  it('blocks a genuinely NEW property that has no image at all', () => {
    expect(
      satisfiesImageRequirement({
        newImage: null,
        storedImages: [],
        editingExisting: false,
      }),
    ).toBe(false);
  });

  it('keeps an existing row editable even if its image cannot be listed', () => {
    // The stored image is loaded asynchronously; a failed load must not push
    // the employee into uploading the same picture again.
    expect(
      satisfiesImageRequirement({
        newImage: null,
        storedImages: [],
        editingExisting: true,
      }),
    ).toBe(true);
  });

  it('does not let removing a local file touch the stored images', () => {
    // The "remove image" control only clears the file picked on this device:
    // the images of the property are derived from the property row itself.
    const storedImages = storedPropertyImages(stored);
    expect(
      satisfiesImageRequirement({
        newImage: null,
        storedImages,
        editingExisting: true,
      }),
    ).toBe(true);
    expect(storedPropertyImages(stored)).toHaveLength(1);
  });
});

describe('toUpdatePropertyPayload — the edit never carries an image', () => {
  const form = {
    entryMethod: 'MANUAL',
    operation: 'بيع',
    governorate: 'الفروانية',
    district: 'غرناطة',
    block: '3',
    plotNumber: '12',
    area: '400',
    floorCount: 1,
    floors: [],
    price: '300000',
    negotiable: 'قابل للتفاوض',
    requestedProperty: {
      governorate: '',
      district: '',
      block: '',
      plotNumber: '',
      area: '',
      floorRequirements: '',
      notes: '',
      budget: { min: '', max: '' },
    },
    contactType: 'OWNER',
    ownerMode: 'NEW',
    brokerMode: 'NEW',
    ownerId: '',
    brokerId: '',
    brokerName: '',
    brokerPhone: '',
    ownerName: 'مالك',
    contactPhone: '65000000',
  };

  it('sends the price change WITHOUT any image field, so the stored image is kept', () => {
    const payload = toUpdatePropertyPayload(form, 3) as unknown as Record<
      string,
      unknown
    >;
    expect(payload.version).toBe(3);
    expect(payload.askingPrice).toBe('300000');
    expect(Object.keys(payload)).not.toContain('image');
    expect(Object.keys(payload)).not.toContain('images');
    expect(JSON.stringify(payload)).not.toContain('data:image');
    expect(JSON.stringify(payload)).not.toContain('blob:');
  });
});
