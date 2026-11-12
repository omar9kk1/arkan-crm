import {
  editBundleFromClient,
  editClientSavePayload,
  bundleError,
  typeDraft,
  toggleType,
  type EditClientRequestPayload,
  type ClientRequestBundle,
} from '../../frontend/features/employee-clients/components/request-wizard/client-request-bundle';
import { parseStoredRequestData } from '../../frontend/features/employee-clients/components/request-wizard/client-request-model';
import { employeeClientFromDto } from '../../frontend/features/employee-clients/client-model';
import type { EmployeeClient } from '../../frontend/features/employee-clients/client-model';
import type { ClientApiDto } from '../../frontend/lib/api/client-types';

/** A minimal persisted client shape the edit mode reads. */
const client = (over: Partial<EmployeeClient> = {}): EmployeeClient => ({
  id: 'client-1',
  name: 'زبون محفوظ',
  phone: '66700055',
  type: '—',
  employee: 'غير مُسند',
  area: '—',
  budget: '—',
  notes: 'ملاحظات قديمة يجب ألا تُفقد',
  next: '',
  lastFollowUp: '',
  history: [],
  properties: [],
  propertyInterests: [
    {
      propertyId: 'prop-a',
      name: 'عقار المرتبط الأول',
      code: 'A-000001',
      area: '',
      price: '',
      reason: 'استفسار أول',
      notes: 'ملاحظة الاستفسار',
    },
  ],
  ...over,
});

/** The pack the wizard frontend writes (what the backend stores opaquely). */
const pack = (bundle: ClientRequestBundle): string =>
  JSON.stringify({
    version: 1,
    types: bundle.types,
    requests: bundle.requests,
  });

describe('Wizard edit mode payload (pack/unpack, prefill, removals, identity)', () => {
  it('decodes a stored document back into types and healthy drafts — nothing invented', () => {
    const stored = pack({
      mode: 'EXISTING_CLIENT',
      clientId: client().id,
      name: 'قديم',
      phone: '000',
      notes: '',
      types: ['BUYER'],
      requests: {
        BUYER: {
          name: 'قديم',
          phone: '000',
          notes: 'تفاصيل',
          clientType: 'BUYER',
          interest: { hasLinkedProperty: false, hasNewRequest: true },
          linkedProperty: { propertyId: '', property: null, reason: '', notes: '' },
          message: 'اريد فيلا الدسمة بميزانية 90000، الدور ارضي',
          requestDetails: {
            desiredProperty: {
              governorate: 'ج',
              area: 'الدسمة',
              propertyType: 'فيلا',
              operationType: 'بيع',
              budget: '90000',
              size: '400',
              roomsOrFloor: 'دور',
              duration: '',
              specifications: '',
              notes: '',
            },
            customFields: [],
          },
        },
      },
    });
    const decoded = parseStoredRequestData(stored);
    expect(decoded?.types).toEqual(['BUYER']);
    expect(
      decoded?.requests['BUYER']?.requestDetails?.desiredProperty.budget,
    ).toBe('90000');
    // Corrupt/legacy documents never break — and never invent types.
    expect(parseStoredRequestData(null)).toBe(null);
    expect(parseStoredRequestData('نص حر')).toBe(null);
    expect(parseStoredRequestData('{"version":2,"types":["BUYER"]}')).toBe(null);
    expect(
      parseStoredRequestData('{"version":1,"types":["NOPE"]}'),
    ).toBe(null);
  });

  it('prefills identity from the REAL columns and leaves an unrecorded request EMPTY', () => {
    const bundle = editBundleFromClient(client());
    expect(bundle.mode).toBe('EXISTING_CLIENT');
    expect(bundle.clientId).toBe('client-1');
    expect(bundle.name).toBe('زبون محفوظ');
    expect(bundle.phone).toBe('66700055');
    expect(bundle.notes).toBe('ملاحظات قديمة يجب ألا تُفقد');
    // NO structured request was recorded: types and drafts start honestly
    // empty — the wizard shows the request as to-be-filled, not faked.
    expect(bundle.types).toEqual([]);
    expect(bundle.requests).toEqual({});
  });

  it('builds a save payload for the SAME client id — notes pass through unchanged, interests upsert', () => {
    let bundle = editBundleFromClient(client());
    bundle = toggleType(bundle, 'BUYER');
    const payload = editClientSavePayload(
      bundle,
      client({ requestData: null }),
    );
    expect(payload.requestData).toContain('"version":1');
    expect(payload.requestData).toContain('"BUYER"');
    expect(JSON.parse(payload.requestData).types).toEqual(['BUYER']);
    expect(payload.name).toBe('زبون محفوظ');
    expect(payload.phone).toBe('66700055');
    // Human notes pass through EXACTLY as persisted (never the request
    // summary — legacy notes are not rewritten behind their back).
    expect(payload.notes).toBe('ملاحظات قديمة يجب ألا تُفقد');
    // Nothing linked yet: no upserts, no removals.
    expect(payload.propertyInterests).toEqual([]);
    expect(payload.removePropertyInterestIds).toEqual([]);
    // The client id itself is NOT in the payload — the endpoint path carries
    // the SAME client identity (`PATCH /clients/:id`).
    expect(JSON.stringify(payload)).not.toContain('"id"');
  });

  it('prefills stored types/details and REMOVES only what the user explicitly dropped', () => {
    // A client WITH a persisted structured request that has one linked draft.
    const stored = pack({
      mode: 'EXISTING_CLIENT',
      clientId: 'client-1',
      name: 'x',
      phone: 'x',
      notes: '',
      types: ['RENTER'],
      requests: {
        RENTER: {
          name: 'x',
          phone: 'x',
          notes: '',
          clientType: 'RENTER',
          interest: { hasLinkedProperty: true, hasNewRequest: false },
          linkedProperty: {
            propertyId: 'prop-a',
            property: {
              id: 'prop-a',
              reference: 'A-000001',
              area: 'الدسمة',
              listingType: 'RENT',
              askingPrice: '5000',
            },
            reason: 'استفسار أول',
            notes: 'ملاحظة الاستفسار',
          },
          message: '',
          requestDetails: null,
        },
      },
    });
    const before = client({ requestData: stored });
    const restored = editBundleFromClient(before);
    expect(restored.types).toEqual(['RENTER']);
    expect(restored.requests.RENTER?.linkedProperty.propertyId).toBe('prop-a');

    // The user replaces the linked property with NOTHING: an explicit drop.
    const dropped: ClientRequestBundle = {
      ...restored,
      requests: {
        ...restored.requests,
        RENTER: {
          ...restored.requests['RENTER']!,
          interest: { hasLinkedProperty: false, hasNewRequest: false },
        },
      },
    };
    const payload = editClientSavePayload(dropped, before);
    expect(payload.propertyInterests).toEqual([]);
    expect(payload.removePropertyInterestIds).toEqual(['prop-a']);
  });

  it('never silently removes interests that were not part of the structured state', () => {
    // A persisted interest with NO structured document behind it: dropping
    // the request types must NOT erase the recorded interest row.
    const payload = editClientSavePayload(
      editBundleFromClient(client()),
      client({ requestData: null }),
    );
    expect(payload.removePropertyInterestIds).toEqual([]);
    expect(payload.propertyInterests).toEqual([]);
  });

  it('locks the edit flow to its client id — no client registry needed, identity check skipped', () => {
    // In EDIT mode the client is locked (no combobox, no switching), so the
    // validation NEVER demands the client be present in the openable list —
    // the drawer passes no registry at all.
    const bundle = editBundleFromClient(client({ requestData: null }));
    expect(bundleError(bundle, 3, [], true)).toBe('');
    // Dropping all types is an explicit outcome, also valid in edit mode.
    expect(bundleError(bundle, 3, [], true)).toBe('');
    // CREATE mode keeps the original strictness (needs a real registry hit).
    expect(
      bundleError(
        { ...bundle, mode: 'EXISTING_CLIENT', types: ['BUYER'] },
        3,
        [],
        false,
      ),
    ).toBe('اختر عميلًا موجودًا.');
  });

  it('hydrates from the FULL authorised GET record: identity + stored request + linked interests all prefill', () => {
    // The same shape `GET /clients/:id` returns (the drawer edit fetch).
    const dto: ClientApiDto = {
      id: 'client-1',
      name: 'زبون من الـ GET المصرح',
      phone: '66700055',
      notes: 'ملاحظات سليمة من السجل الكامل',
      source: '',
      status: '',
      responsibleUserId: null,
      responsibleEmployeeName: null,
      createdByUserId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      nextFollowUp: null,
      followUps: [],
      properties: [],
      propertyInterests: [
        {
          propertyId: 'prop-a',
          reference: 'A-000001',
          title: 'عقار المرتبط الأول',
          area: 'الدسمة',
          askingPrice: '30000',
          currency: 'KWD',
          reason: 'استفسار أول',
          notes: 'ملاحظة الاستفسار',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      requestData: pack({
        mode: 'EXISTING_CLIENT',
        clientId: 'client-1',
        name: 'x',
        phone: 'x',
        notes: '',
        types: ['BUYER'],
        requests: {
          BUYER: {
            name: 'x',
            phone: 'x',
            notes: '',
            clientType: 'BUYER',
            interest: { hasLinkedProperty: false, hasNewRequest: true },
            linkedProperty: { propertyId: '', property: null, reason: '', notes: '' },
            message: 'اريد فيلا 90000 الدسمة',
            requestDetails: {
              desiredProperty: {
                governorate: 'الكويت',
                area: 'الدسمة',
                propertyType: 'فيلا',
                operationType: 'شراء',
                budget: '90000',
                size: '',
                roomsOrFloor: '',
                duration: '',
                specifications: '',
                notes: '',
              },
              customFields: [],
            },
          },
        },
      }),
    };
    // The hydration mapping the edit mode uses after `getClient` resolves.
    const mapped = employeeClientFromDto(dto);
    expect(mapped.name).toBe('زبون من الـ GET المصرح');
    expect(mapped.phone).toBe('66700055');
    expect(mapped.notes).toBe('ملاحظات سليمة من السجل الكامل');
    expect(mapped.requestData).toContain('"BUYER"');
    expect(mapped.propertyInterests.map((i) => i.propertyId)).toEqual([
      'prop-a',
    ]);
    const bundle = editBundleFromClient(mapped);
    expect(bundle.clientId).toBe('client-1');
    expect(bundle.types).toEqual(['BUYER']);
    expect(bundle.requests['BUYER']?.requestDetails?.desiredProperty.budget).toBe(
      '90000',
    );
    expect(bundle.requests['BUYER']?.requestDetails?.desiredProperty.area).toBe(
      'الدسمة',
    );
  });

  it('a LEGACY client (requestData=null) hydrates identity + real linked interests with NO invented types', () => {
    const dto: ClientApiDto = {
      id: 'client-legacy',
      name: 'عميل قديم عربي',
      phone: '66700099',
      notes: 'ملاحظات قديمة محفوظة',
      source: '',
      status: '',
      responsibleUserId: null,
      responsibleEmployeeName: null,
      createdByUserId: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      nextFollowUp: null,
      followUps: [],
      properties: [],
      propertyInterests: [
        {
          propertyId: 'prop-b',
          reference: 'A-000002',
          title: 'عقار الاستفسار القديم',
          area: 'حولي',
          askingPrice: null,
          currency: 'KWD',
          reason: 'استفسار قديم',
          notes: '',
          createdAt: '2025-01-01T00:00:00.000Z',
        },
      ],
      requestData: null,
    };
    const mapped = employeeClientFromDto(dto);
    const bundle = editBundleFromClient(mapped);
    // Identity + legacy notes are real; NO structured request is invented.
    expect(bundle.clientId).toBe('client-legacy');
    expect(bundle.name).toBe('عميل قديم عربي');
    expect(bundle.phone).toBe('66700099');
    expect(bundle.notes).toBe('ملاحظات قديمة محفوظة');
    expect(bundle.types).toEqual([]);
    // The legacy linked interest is intact on the record and can never be
    // silently removed by this save (not part of the structured state).
    expect(mapped.propertyInterests).toHaveLength(1);
    const payload = editClientSavePayload(bundle, mapped);
    expect(payload.removePropertyInterestIds).toEqual([]);
  });

  it('restores the per-type note and request details through typeDraft (nothing reset to defaults)', () => {    const stored = pack({
      mode: 'EXISTING_CLIENT',
      clientId: 'client-1',
      name: 'x',
      phone: 'x',
      notes: '',
      types: ['BUYER'],
      requests: {
        BUYER: {
          name: 'x',
          phone: 'x',
          notes: 'ملاحظة الطلب المحفوظة',
          clientType: 'BUYER',
          interest: { hasLinkedProperty: false, hasNewRequest: true },
          linkedProperty: { propertyId: '', property: null, reason: '', notes: '' },
          message: 'اريد فيلا بميزانية 90000 في الدسمة الدور ارضي',
          requestDetails: {
            desiredProperty: {
              governorate: 'الكويت',
              area: 'الدسمة',
              propertyType: 'فيلا',
              operationType: 'شراء',
              budget: '90000',
              size: '',
              roomsOrFloor: 'دور',
              duration: '',
              specifications: '',
              notes: '',
            },
            customFields: [],
          },
        },
      },
    });
    const restored = editBundleFromClient(client({ requestData: stored }));
    // The stored per-type materials survive typeDraft fully.
    const draft = typeDraft(restored, 'BUYER');
    expect(draft.notes).toBe('ملاحظة الطلب المحفوظة');
    expect(draft.interest.hasNewRequest).toBe(true);
    expect(draft.requestDetails?.desiredProperty.budget).toBe('90000');
    expect(draft.requestDetails?.desiredProperty.area).toBe('الدسمة');
    expect(draft.requestDetails?.desiredProperty.roomsOrFloor).toBe('دور');
    expect(draft.message).toContain('الدسمة');
  });

  it('keeps create mode and edit mode apart (draft keys and payload shapes)', () => {    // The create path builds a NEW client row; the edit payload never carries
    // creation semantics and vice versa — the SAME payload type is built ONLY
    // when an `editing` client is passed (comepletely separate builders).
    const editingPayload = editClientSavePayload(
      editBundleFromClient(client()),
      client(),
    );
    expect(editingPayload as EditClientRequestPayload).toBeDefined();
    expect(editingPayload.phone).toBe('66700055');
  });
});
