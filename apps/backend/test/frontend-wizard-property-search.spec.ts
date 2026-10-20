import {
  formatSnapshotPrice,
  linkedPropertyPreview,
  normalizeLinkedProperty,
  propertySearchOptionLabel,
  requestError,
  requestSummary,
  type LinkedPropertyDraft,
  type LinkedPropertySnapshot,
  type ClientRequestDraft,
} from '../../frontend/features/employee-clients/components/request-wizard/client-request-model';
import {
  bundlePropertyInterests,
  initialBundle,
  saveBundle,
  type ClientRequestBundle,
} from '../../frontend/features/employee-clients/components/request-wizard/client-request-bundle';
import type { EmployeeClient } from '../../frontend/features/employee-clients/client-model';

/**
 * Pure unit tests for the wizard's real property search integration. The demo
 * K027/K0331 list is gone: options, selection, validation and the saved
 * snapshot all operate on real backend rows identified by `Property.id`.
 */

const snapshot = (
  overrides: Partial<LinkedPropertySnapshot> = {},
): LinkedPropertySnapshot => ({
  id: 'b7c1e2f3-0000-4000-8000-000000000001',
  reference: 'AK-123456-ABCDEF1234',
  area: 'غرناطة',
  listingType: 'SALE',
  askingPrice: '250000.00',
  ...overrides,
});

const draftWith = (
  linked: Partial<LinkedPropertyDraft>,
): ClientRequestDraft => ({
  ...{
    name: 'عميل',
    phone: '60000000',
    notes: '',
    clientType: 'BUYER',
    interest: { hasLinkedProperty: true, hasNewRequest: false },
    linkedProperty: {
      propertyId: '',
      property: null,
      reason: 'استفسار',
      notes: '',
    },
    message: '',
    requestDetails: null,
  },
  linkedProperty: {
    ...{
      propertyId: '',
      property: null,
      reason: 'استفسار',
      notes: '',
    },
    ...linked,
  } as LinkedPropertyDraft,
});

describe('propertySearchOptionLabel — public dropdown line', () => {
  it('shows code · area · operation · price from public fields only', () => {
    expect(
      propertySearchOptionLabel({
        reference: 'AK-123456-ABCDEF1234',
        district: 'غرناطة',
        governorate: 'الفروانية',
        listingType: 'SALE',
        askingPrice: '250000.00',
      }),
    ).toBe(
      `AK-123456-ABCDEF1234 · غرناطة · بيع · ${formatSnapshotPrice('250000.00')}`,
    );
  });

  it('falls back to governorate when the district is empty, then غير محدد', () => {
    expect(
      propertySearchOptionLabel({
        reference: 'AK-1',
        district: null,
        governorate: 'الجهراء',
        listingType: 'RENT',
        askingPrice: null,
      }),
    ).toBe('AK-1 · الجهراء · إيجار · غير محدد');
    expect(
      propertySearchOptionLabel({
        reference: 'AK-2',
        district: null,
        governorate: null,
        listingType: 'EXCHANGE',
        askingPrice: null,
      }),
    ).toBe('AK-2 · غير محدد · بدل · غير محدد');
  });
});

describe('selection validation uses the real Property.id', () => {
  it('accepts a draft whose selection is a real row (id + snapshot agree)', () => {
    const real = snapshot();
    const draft = draftWith({
      propertyId: real.id,
      property: real,
    });
    // Name/phone are valid and the real selection passes — no error at all.
    expect(requestError(draft, 1)).toBe('');
  });

  it('rejects a stale id with no matching snapshot (older broken drafts)', () => {
    const draft = draftWith({ propertyId: 'some-id', property: null });
    expect(requestError(draft, 1)).toBe('اختر العقار المرتبط.');
  });

  it('rejects an id that disagrees with its snapshot', () => {
    const draft = draftWith({
      propertyId: 'id-1',
      property: snapshot({ id: 'id-2' }),
    });
    expect(requestError(draft, 1)).toBe('اختر العقار المرتبط.');
  });
});

describe('normalizeLinkedProperty — draft self-healing', () => {
  it('keeps a consistent real selection untouched', () => {
    const real = snapshot();
    const linked = normalizeLinkedProperty({
      propertyId: real.id,
      property: real,
      reason: 'استفسار',
      notes: '',
    });
    expect(linked.propertyId).toBe(real.id);
    expect(linked.property).toEqual(real);
  });

  it('clears an id that no snapshot backs', () => {
    expect(
      normalizeLinkedProperty({
        propertyId: 'legacy-id',
        property: null,
        reason: '',
        notes: '',
      }),
    ).toEqual({ propertyId: '', property: null, reason: '', notes: '' });
  });
});

describe('requestSummary — readable public info about the selection', () => {
  it('names the property by its real code and area, never by fake names', () => {
    const real = snapshot();
    const draft = draftWith({ propertyId: real.id, property: real });
    const text = requestSummary(draft);
    expect(text).toContain('العقار المرتبط: AK-123456-ABCDEF1234');
    expect(text).toContain('منطقة العقار: غرناطة');
  });
});

describe('linkedPropertyPreview — selected chip text', () => {
  it('matches the option line format for the same row', () => {
    const real = snapshot();
    expect(linkedPropertyPreview(real)).toBe(
      propertySearchOptionLabel({
        reference: real.reference,
        district: real.area,
        governorate: null,
        listingType: real.listingType,
        askingPrice: real.askingPrice,
      }),
    );
  });
});

describe('saveBundle — only REAL linked rows, keyed by Property.id', () => {
  const clients: EmployeeClient[] = [];
  const bundle = (
    linked: Partial<LinkedPropertyDraft>,
  ): ClientRequestBundle => ({
    ...initialBundle(),
    name: 'عميل',
    phone: '60000000',
    types: ['BUYER'],
    requests: {
      BUYER: draftWith(linked),
    },
  });

  it('attaches the snapshot of the selected real row (code, area, price)', () => {
    const real = snapshot({ askingPrice: '250000.50' });
    const saved = saveBundle(bundle({ propertyId: real.id, property: real }), clients);
    expect(saved.properties).toEqual([
      {
        name: real.reference,
        area: real.area,
        price: formatSnapshotPrice('250000.50'),
      },
    ]);
    expect(saved.area).toBe(real.area);
    expect(saved.budget).toBe(`مشتري: ${formatSnapshotPrice('250000.50')}`);
    const savedRequest = saved.requestBundle?.requests.BUYER;
    expect(savedRequest).toBeDefined();
    expect(savedRequest!.linkedProperty.propertyId).toBe(real.id);
    expect(savedRequest!.linkedProperty.property).toEqual(real);
  });

  it('attaches NOTHING for a stale id that no real selection backs', () => {
    const saved = saveBundle(bundle({ propertyId: 'orphan-id' }), clients);
    expect(saved.properties).toEqual([]);
  });

  it('attaches nothing when no property was selected', () => {
    const noInterest: ClientRequestDraft = {
      ...draftWith({ propertyId: '', property: null }),
      interest: { hasLinkedProperty: false, hasNewRequest: false },
    };
    const saved = saveBundle(
      { ...initialBundle(), name: 'عميل', phone: '60000000', types: ['BUYER'], requests: { BUYER: noInterest } },
      clients,
    );
    expect(saved.properties).toEqual([]);
    const draftRequest = saved.requestBundle?.requests.BUYER;
    expect(draftRequest).toBeDefined();
    expect(draftRequest!.linkedProperty).toEqual({
      propertyId: '',
      property: null,
      reason: '',
      notes: '',
    });
  });
});

describe('bundlePropertyInterests — the payloads the save PERSISTS', () => {
  const bundleWith = (
    drafts: ClientRequestDraft[],
    types: ClientRequestBundle['types'],
  ): ClientRequestBundle => ({
    ...initialBundle(),
    name: 'عميل',
    phone: '60000000',
    types,
    requests: Object.fromEntries(
      types.map((type, index) => [type, drafts[index]]),
    ) as ClientRequestBundle['requests'],
  });

  it('emits one payload per real linked selection with its reason/notes', () => {
    const real = snapshot();
    const payloads = bundlePropertyInterests(
      bundleWith(
        [draftWith({ propertyId: real.id, property: real, notes: 'سأل عن السعر' })],
        ['BUYER'],
      ),
    );
    expect(payloads).toEqual([
      {
        propertyId: real.id,
        reason: 'استفسار',
        notes: 'سأل عن السعر',
      },
    ]);
  });

  it('emits NOTHING when only the free-text request is filled', () => {
    const noLink: ClientRequestDraft = {
      ...draftWith({ propertyId: '', property: null }),
      interest: { hasLinkedProperty: false, hasNewRequest: true },
    };
    expect(
      bundlePropertyInterests(bundleWith([noLink], ['BUYER'])),
    ).toEqual([]);
  });

  it('emits one payload per DISTINCT property even across repeated types', () => {
    const first = snapshot();
    const second = snapshot({ id: 'b7c1e2f3-0000-4000-8000-000000000002' });
    const payloads = bundlePropertyInterests(
      bundleWith(
        [
          draftWith({ propertyId: first.id, property: first, reason: 'استفسار' }),
          draftWith({ propertyId: second.id, property: second }),
          draftWith({ propertyId: first.id, property: first, reason: 'متابعة' }),
        ],
        ['BUYER', 'RENTER', 'EXCHANGER'],
      ),
    );
    expect(payloads.map((p) => p.propertyId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('ignores a stale propertyId that its snapshot does not back', () => {
    const payloads = bundlePropertyInterests(
      bundleWith(
        [draftWith({ propertyId: 'orphan-id', property: null })],
        ['BUYER'],
      ),
    );
    expect(payloads).toEqual([]);
  });

  it('saveBundle mirrors the persisted payloads in its display interests, id included', () => {
    const real = snapshot({ reference: 'AK-123456-ABCDEF1234' });
    const saved = saveBundle(
      bundleWith(
        [draftWith({ propertyId: real.id, property: real, notes: 'سأل عن السعر' })],
        ['BUYER'],
      ),
      [],
    );
    expect(saved.propertyInterests).toEqual([
      {
        propertyId: real.id,
        name: real.reference,
        area: real.area,
        price: formatSnapshotPrice(real.askingPrice),
        reason: 'استفسار',
        notes: 'سأل عن السعر',
      },
    ]);
  });
});
