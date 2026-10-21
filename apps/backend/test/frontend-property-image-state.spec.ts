import {
  effectiveImageUrl,
  satisfiesImageRequirement,
  storedPropertyImages,
} from '../../frontend/features/employee-properties/components/new-property-model-v2';

/**
 * The wizard's image state.
 *
 * The property's SAVED image is a real image: it satisfies the mandatory-image
 * rule in every step (the wizard used to demand a new upload in the summary
 * step, which contradicted the step that showed the saved image), and a chosen
 * replacement is shown instead of it until the manager approves.
 */

const SAVED = 'http://localhost:3001/properties/abc/image';

describe('effectiveImageUrl — what the wizard shows', () => {
  it('shows the saved image when no replacement was chosen', () => {
    expect(
      effectiveImageUrl({ localPreview: null, storedUrl: SAVED }),
    ).toBe(SAVED);
  });

  it('shows the chosen replacement instead of the saved image', () => {
    expect(
      effectiveImageUrl({ localPreview: 'blob:new', storedUrl: SAVED }),
    ).toBe('blob:new');
  });

  it('has no image at all when neither exists', () => {
    expect(
      effectiveImageUrl({ localPreview: null, storedUrl: null }),
    ).toBeNull();
  });
});

describe('satisfiesImageRequirement — the saved image counts', () => {
  it('is satisfied by the saved image of the edited property', () => {
    expect(
      satisfiesImageRequirement({
        newImage: null,
        storedImages: storedPropertyImages({
          id: 'property-1',
          primaryImageUrl: SAVED,
        }),
        editingExisting: true,
      }),
    ).toBe(true);
  });

  it('is satisfied by a chosen replacement (the preview before the save)', () => {
    expect(
      satisfiesImageRequirement({
        newImage: { file: {}, preview: 'blob:new' },
        storedImages: [],
        editingExisting: true,
      }),
    ).toBe(true);
  });

  it('still blocks a genuinely new property without any image', () => {
    expect(
      satisfiesImageRequirement({
        newImage: null,
        storedImages: [],
        editingExisting: false,
      }),
    ).toBe(false);
  });
});
