import {
  FLOOR_LABEL_BY_TYPE,
  awaitingCorrection,
  buildDescription,
  deriveMine,
  displayStatus,
  floorSummary,
  formatDecimal,
  mapFloors,
  orderedFloors,
  mapPreviewFromApi,
  mapPropertyFromApi,
  mapRequestedProperty,
  needsResubmitAfterCorrection,
  responsibleLabel,
  reviewStatusOf,
  statusLabel,
  toCreatePropertyPayload,
  toDecimalString,
  toUpdatePropertyPayload,
  type PropertyFormInput,
} from '../../frontend/lib/property-adapter';
import type {
  PrivatePropertyDto,
  PropertyFloorDto,
  PropertyViewDto,
} from '../../frontend/lib/api/property-types';

/**
 * Unit tests for the pure wizard/API adapter used by the Phase 4A integration.
 * These run in the backend Jest project (no React test runner is installed) and
 * import the frontend module directly, so they exercise the real mapping code
 * rather than a re-implementation.
 */

function baseForm(overrides: Partial<PropertyFormInput> = {}): PropertyFormInput {
  return {
    entryMethod: 'MANUAL',
    operation: 'بيع',
    governorate: 'الفروانية',
    district: 'خيطان',
    block: '2',
    plotNumber: '15',
    area: '400',
    landArea: '',
    unitArea: '',
    floorCount: 1,
    floors: [{ label: 'الأرضي', customLabel: '', details: 'صالة ومطبخ' }],
    price: '250000',
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
    ownerName: 'أبو فهد',
    contactPhone: '66661122',
    ...overrides,
  };
}

function publicDto(overrides: Partial<PropertyViewDto> = {}): PropertyViewDto {
  return {
    id: 'prop-1',
    reference: 'K0331',
    title: 'بيت المطلاع',
    listingType: 'SALE',
    status: 'AVAILABLE',
    governorate: 'الجهراء',
    district: 'المطلاع',
    block: '2',
    plotNumber: '15',
    address: null,
    sizeSqm: '400.00',
    floorCount: 1,
    floors: [],
    askingPrice: '250000.00',
    negotiable: true,
    description: '{"entryMethod":"MANUAL"}',
    requestedProperty: null,
    responsibleName: 'أحمد محمد',
    responsibleRole: 'EMPLOYEE',
    primaryImageUrl: 'properties/abc/primary.jpg',
    version: 1,
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    isMine: false,
    ...overrides,
  };
}

function privateDto(overrides: Partial<PrivatePropertyDto> = {}): PrivatePropertyDto {
  return {
    ...publicDto(),
    status: 'PENDING',
    // A private response is only sent to the manager or the property creator, so
    // an own row defaults to isMine = true.
    isMine: true,
    contactId: 'contact-1',
    contact: {
      id: 'contact-1',
      type: 'OWNER',
      name: 'أبو فهد',
      phone: '66661122',
      notes: null,
    },
    reviewNotes: null,
    reviewStatus: null,
    ...overrides,
  };
}

describe('decimal helpers', () => {
  it('accepts non-negative decimals with at most two fraction digits', () => {
    expect(toDecimalString('400')).toBe('400');
    expect(toDecimalString('250000.5')).toBe('250000.5');
    expect(toDecimalString('1.50')).toBe('1.50');
  });

  it('rejects empty, zero, negative and over-precise values', () => {
    expect(toDecimalString('')).toBeUndefined();
    expect(toDecimalString('   ')).toBeUndefined();
    expect(toDecimalString('0')).toBeUndefined();
    expect(toDecimalString('-5')).toBeUndefined();
    expect(toDecimalString('1.234')).toBeUndefined();
    expect(toDecimalString('abc')).toBeUndefined();
    expect(toDecimalString(undefined)).toBeUndefined();
  });

  it('formats stored decimals without the trailing zeros a DB write adds', () => {
    expect(formatDecimal('250000.00')).toBe('250000');
    expect(formatDecimal('1.50')).toBe('1.5');
    expect(formatDecimal('400')).toBe('400');
    expect(formatDecimal(null)).toBe('');
    expect(formatDecimal('')).toBe('');
  });
});

describe('toCreatePropertyPayload', () => {
  it('maps a manual SALE form with a new owner and never leaks contact data', () => {
    const payload = toCreatePropertyPayload(baseForm());
    expect(payload.listingType).toBe('SALE');
    expect(payload.governorate).toBe('الفروانية');
    expect(payload.district).toBe('خيطان');
    expect(payload.block).toBe('2');
    expect(payload.plotNumber).toBe('15');
    expect(payload.sizeSqm).toBe('400');
    expect(payload.askingPrice).toBe('250000');
    expect(payload.negotiable).toBe(true);
    expect(payload.floorCount).toBe(1);
    expect(payload.floors).toEqual([
      { type: 'GROUND', sortOrder: 0, details: 'صالة ومطبخ' },
    ]);
    expect(payload.newContact).toEqual({
      type: 'OWNER',
      name: 'أبو فهد',
      phone: '66661122',
    });
    expect(payload.contactId).toBeUndefined();
    // The drawer builds the address from block/plot/district on the client.
    expect(payload.address).toBeUndefined();
    // The public description must never contain the private phone number.
    expect(payload.description).not.toContain('66661122');
    expect(payload.description).not.toContain('أبو فهد');
    expect(payload.requestedProperty).toBeUndefined();
  });

  it('maps a RENT form to an existing contact id', () => {
    const payload = toCreatePropertyPayload(
      baseForm({ operation: 'إيجار', ownerMode: 'EXISTING', ownerId: 'contact-9' }),
    );
    expect(payload.listingType).toBe('RENT');
    expect(payload.contactId).toBe('contact-9');
    expect(payload.newContact).toBeUndefined();
  });

  it('sends exactly one of contactId / newContact when both are present', () => {
    const payload = toCreatePropertyPayload(
      baseForm({
        ownerMode: 'EXISTING',
        ownerId: 'contact-9',
        ownerName: 'أبو فهد',
        contactPhone: '66661122',
      }),
    );
    expect(payload.contactId).toBe('contact-9');
    expect(payload.newContact).toBeUndefined();
  });

  it('omits negotiable when the wizard has no selection', () => {
    const payload = toCreatePropertyPayload(baseForm({ negotiable: 'غير محدد' }));
    expect(payload.negotiable).toBeUndefined();
  });

  it('maps a BROKER contact from the broker fields', () => {
    const payload = toCreatePropertyPayload(
      baseForm({
        contactType: 'BROKER',
        brokerMode: 'NEW',
        brokerName: 'وسيط الكويت',
        brokerPhone: '99998888',
        ownerName: '',
        contactPhone: '',
      }),
    );
    expect(payload.newContact).toEqual({
      type: 'BROKER',
      name: 'وسيط الكويت',
      phone: '99998888',
    });
  });

  it('keeps budget min/max only for EXCHANGE and drops empty values', () => {
    const payload = toCreatePropertyPayload(
      baseForm({
        operation: 'بدل',
        requestedProperty: {
          governorate: 'حولي',
          district: '',
          block: '',
          plotNumber: '',
          area: '',
          floorRequirements: 'دور أرضي',
          notes: '',
          budget: { min: '100000', max: '150000' },
        },
      }),
    );
    expect(payload.listingType).toBe('EXCHANGE');
    expect(payload.requestedProperty).toEqual({
      governorate: 'حولي',
      floorRequirements: 'دور أرضي',
      budgetMin: '100000',
      budgetMax: '150000',
    });
    expect(payload.description).toContain('=== العقار المطلوب في البدل ===');
  });

  it('drops requestedProperty entirely when nothing was entered', () => {
    expect(mapRequestedProperty(baseForm({ operation: 'بدل' }))).toBeUndefined();
    const payload = toCreatePropertyPayload(
      baseForm({ operation: 'بدل' }),
    );
    expect(payload.requestedProperty).toBeUndefined();
  });

  it('ignores requestedProperty for a non-EXCHANGE listing', () => {
    const payload = toCreatePropertyPayload(
      baseForm({
        operation: 'بيع',
        requestedProperty: {
          governorate: 'حولي',
          district: 'السالمية',
          block: '1',
          plotNumber: '2',
          area: '300',
          floorRequirements: '',
          notes: '',
          budget: { min: '1', max: '2' },
        },
      }),
    );
    expect(payload.requestedProperty).toBeUndefined();
  });
});

describe('floor mapping', () => {
  it('maps approved floor labels to backend FloorType records', () => {
    const floors = mapFloors(
      baseForm({
        floors: [
          { label: 'الأرضي', customLabel: '', details: '' },
          { label: 'الأول', customLabel: '', details: 'غرف نوم' },
          { label: 'السطح', customLabel: '', details: '' },
          { label: 'الميزانين', customLabel: '', details: '' },
          { label: 'أخرى', customLabel: 'ملحق', details: '' },
        ],
      }),
    );
    expect(floors).toEqual([
      { type: 'GROUND', sortOrder: 0 },
      { type: 'FIRST', sortOrder: 1, details: 'غرف نوم' },
      { type: 'ROOF', sortOrder: 2 },
      { type: 'MEZZANINE', sortOrder: 3 },
      { type: 'CUSTOM', sortOrder: 4, customLabel: 'ملحق' },
    ]);
  });

  it('adds separate BASEMENT/HALF/QUARTER records for the property flags', () => {
    const floors = mapFloors(
      baseForm({
        hasBasement: true,
        basementDetails: 'مخزن',
        hasHalfFloor: true,
        halfFloorDetails: 'غرفة',
        hasQuarterFloor: true,
        quarterFloorDetails: 'ملحق علوي',
      }),
    );
    expect(floors).toEqual([
      { type: 'GROUND', sortOrder: 0, details: 'صالة ومطبخ' },
      { type: 'BASEMENT', sortOrder: 1, details: 'مخزن' },
      { type: 'HALF', sortOrder: 2, details: 'غرفة' },
      { type: 'QUARTER', sortOrder: 3, details: 'ملحق علوي' },
    ]);
  });

  it('merges a flag into an existing record of the same type without losing text', () => {
    const floors = mapFloors(
      baseForm({
        floors: [{ label: 'القبو', customLabel: '', details: 'قبو رئيسي' }],
        hasBasement: true,
        basementDetails: 'مخزن إضافي',
      }),
    );
    expect(floors).toEqual([
      { type: 'BASEMENT', sortOrder: 0, details: 'قبو رئيسي | مخزن إضافي' },
    ]);
  });

  it('keeps an enabled optional floor even when its notes are empty', () => {
    const floors = mapFloors(
      baseForm({
        floors: [
          { label: 'الأرضي', customLabel: '', details: '' },
          { label: 'الأول', customLabel: '', details: 'غرف نوم' },
          { label: 'الثاني', customLabel: '', details: '' },
        ],
        floorCount: 3,
        hasQuarterFloor: true,
        quarterFloorDetails: '   ',
      }),
    );
    expect(floors).toEqual([
      { type: 'GROUND', sortOrder: 0 },
      { type: 'FIRST', sortOrder: 1, details: 'غرف نوم' },
      { type: 'SECOND', sortOrder: 2 },
      { type: 'QUARTER', sortOrder: 5 },
    ]);
  });

  it('drops leftover notes for an optional floor the wizard never enabled', () => {
    const floors = mapFloors(
      baseForm({ hasBasement: false, basementDetails: 'ملاحظة قديمة' }),
    );
    expect(floors).toEqual([
      { type: 'GROUND', sortOrder: 0, details: 'صالة ومطبخ' },
    ]);
  });

  it('counts only full floors, Ground included, and never invents one', () => {
    const payload = toCreatePropertyPayload(
      baseForm({
        floorCount: 3,
        floors: [
          { label: 'الأرضي', customLabel: '', details: '' },
          { label: 'الأول', customLabel: '', details: '' },
          { label: 'الثاني', customLabel: '', details: '' },
        ],
        hasQuarterFloor: true,
        quarterFloorDetails: '',
      }),
    );
    expect(payload.floorCount).toBe(3);
    expect(payload.floors?.map((floor) => floor.type)).toEqual([
      'GROUND',
      'FIRST',
      'SECOND',
      'QUARTER',
    ]);
  });

  it('returns undefined when the wizard has no floors', () => {
    expect(mapFloors(baseForm({ floors: [], floorCount: 0 }))).toBeUndefined();
  });
});

/** A persisted floor row, as the drawer receives it from the API. */
function floorRecord(
  type: PropertyFloorDto['type'],
  sortOrder: number,
  details: string | null = null,
): PropertyFloorDto {
  return { id: `f-${sortOrder}`, type, customLabel: null, details, sortOrder };
}

describe('floor display order and summary', () => {
  it('renders the basement as السرداب, never as القبو', () => {
    expect(FLOOR_LABEL_BY_TYPE.BASEMENT).toBe('السرداب');
    expect(FLOOR_LABEL_BY_TYPE.HALF).toBe('نصف دور');
    expect(FLOOR_LABEL_BY_TYPE.QUARTER).toBe('ربع دور');
  });

  it('orders basement first, then full floors, then half and quarter', () => {
    const floors = [
      floorRecord('GROUND', 0),
      floorRecord('FIRST', 1),
      floorRecord('SECOND', 2),
      floorRecord('BASEMENT', 3),
      floorRecord('HALF', 4),
      floorRecord('QUARTER', 5),
    ];
    expect(orderedFloors(floors).map((floor) => floor.type)).toEqual([
      'BASEMENT',
      'GROUND',
      'FIRST',
      'SECOND',
      'HALF',
      'QUARTER',
    ]);
    // The persisted sortOrder stays exactly as saved — only the render order
    // changes, and the source array is never mutated.
    expect(orderedFloors(floors).map((floor) => floor.sortOrder)).toEqual([
      3, 0, 1, 2, 4, 5,
    ]);
    expect(floors.map((floor) => floor.type)).toEqual([
      'GROUND',
      'FIRST',
      'SECOND',
      'BASEMENT',
      'HALF',
      'QUARTER',
    ]);
  });

  it('summarises 3 full floors plus a quarter floor with no basement', () => {
    expect(
      floorSummary(
        [
          floorRecord('GROUND', 0),
          floorRecord('FIRST', 1),
          floorRecord('SECOND', 2),
          floorRecord('QUARTER', 5),
        ],
        3,
      ),
    ).toBe('3 أدوار + ربع دور');
  });

  it('leads with the basement when one is actually stored', () => {
    expect(
      floorSummary(
        [
          floorRecord('GROUND', 0),
          floorRecord('FIRST', 1),
          floorRecord('SECOND', 2),
          floorRecord('BASEMENT', 3),
          floorRecord('HALF', 4),
        ],
        3,
      ),
    ).toBe('السرداب + 3 أدوار + نصف دور');
    expect(
      floorSummary(
        [
          floorRecord('GROUND', 0),
          floorRecord('FIRST', 1),
          floorRecord('BASEMENT', 2),
          floorRecord('QUARTER', 4),
        ],
        2,
      ),
    ).toBe('السرداب + 2 أدوار + ربع دور');
  });

  it('counts optional floors only through their own label', () => {
    // Basement and half are never folded into the number: their notes may be
    // empty and they still count as themselves.
    expect(floorSummary([floorRecord('BASEMENT', 0)], 0)).toBe('السرداب');
    expect(
      floorSummary([floorRecord('HALF', 0), floorRecord('QUARTER', 1)], 0),
    ).toBe('نصف دور + ربع دور');
    // No optional floor: the plain number, exactly as it was rendered before.
    expect(
      floorSummary(
        [floorRecord('GROUND', 0), floorRecord('FIRST', 1)],
        2,
      ),
    ).toBe('2');
    // A row without stored floor records still reports its stored count.
    expect(floorSummary([], 4)).toBe('4');
    expect(floorSummary([], null)).toBeNull();
  });
});

describe('description', () => {
  it('serialises the approved public fields and excludes private contact data', () => {
    const description = buildDescription(baseForm());
    expect(description).toContain('"entryMethod": "MANUAL"');
    expect(description).toContain('"operation": "بيع"');
    expect(description).not.toContain('66661122');
    expect(description).not.toContain('أبو فهد');
  });
});

describe('toUpdatePropertyPayload', () => {
  it('always carries the current version', () => {
    const payload = toUpdatePropertyPayload(baseForm(), 7);
    expect(payload.version).toBe(7);
    expect(payload.listingType).toBe('SALE');
  });
});

describe('mapPropertyFromApi', () => {
  const employee = { id: 'emp-1', role: 'EMPLOYEE' as const };
  const manager = { id: 'mgr-1', role: 'MANAGER' as const };

  it('shows no contact and denies edit for another employee AVAILABLE row', () => {
    const property = mapPropertyFromApi(publicDto(), employee);
    expect(property.owner).toBe('');
    expect(property.phone).toBe('');
    expect(property.hasPrivateContact).toBe(false);
    expect(property.mine).toBe(false);
    expect(property.status).toBe('معتمد');
    expect(property.responsibleName).toBe('أحمد محمد');
    expect(property.responsibleRole).toBe('EMPLOYEE');
    expect(property.version).toBe(1);
    expect(property.primaryImageUrl).toBe('properties/abc/primary.jpg');
    // Area/price render without the trailing zeros the DB stores.
    expect(property.area).toBe('400');
    expect(property.price).toBe('250000');
  });

  it('shows the private contact and allows edit on an own PENDING row', () => {
    const property = mapPropertyFromApi(privateDto(), employee);
    expect(property.owner).toBe('أبو فهد');
    expect(property.phone).toBe('66661122');
    expect(property.contactType).toBe('OWNER');
    expect(property.hasPrivateContact).toBe(true);
    expect(property.mine).toBe(true);
    expect(property.status).toBe('بانتظار الموافقة');
  });

  it('exposes review notes only when the response carried them', () => {
    const withNotes = mapPropertyFromApi(
      privateDto({ status: 'REJECTED', reviewNotes: 'يرجى توضيح المساحة.' }),
      employee,
    );
    expect(withNotes.managerNotes).toBe('يرجى توضيح المساحة.');
    // A rejected row is مرفوض — never mislabelled as a correction request.
    expect(withNotes.status).toBe('مرفوض');
    expect(mapPropertyFromApi(publicDto(), employee).managerNotes).toBe('');
  });

  it('never marks an AVAILABLE row as the manager own', () => {
    expect(deriveMine(manager, 'AVAILABLE')).toBe(false);
    expect(deriveMine(manager, 'PENDING')).toBe(false);
    expect(deriveMine(employee, 'PENDING')).toBe(true);
    expect(deriveMine(employee, 'REJECTED')).toBe(true);
    expect(deriveMine(employee, 'AVAILABLE')).toBe(false);
    expect(deriveMine(null, 'PENDING')).toBe(false);
  });

  it('builds an address from block/plot/district when the row has none', () => {
    const property = mapPropertyFromApi(publicDto(), employee);
    expect(property.address).toBe('قطعة 2، حوض 15، المطلاع');
  });
});

describe('review state (request changes vs reject)', () => {
  const employee = { id: 'emp-1', role: 'EMPLOYEE' as const };

  it('labels a PENDING row whose review requested changes as مطلوب تعديل', () => {
    const dto = privateDto({
      status: 'PENDING',
      reviewStatus: 'CHANGES_REQUESTED',
      reviewNotes: 'يرجى مراجعة السعر.',
    });
    expect(displayStatus(dto)).toBe('مطلوب تعديل');
    expect(reviewStatusOf(dto)).toBe('CHANGES_REQUESTED');
    const property = mapPropertyFromApi(dto, employee);
    expect(property.status).toBe('مطلوب تعديل');
    expect(property.managerNotes).toBe('يرجى مراجعة السعر.');
    expect(property.mine).toBe(true);
  });

  it('labels a REJECTED row مرفوض — never مطلوب تعديل', () => {
    const dto = privateDto({ status: 'REJECTED', reviewStatus: 'REJECTED' });
    expect(displayStatus(dto)).toBe('مرفوض');
    expect(mapPropertyFromApi(dto, employee).status).toBe('مرفوض');
    // Rejection outranks even a stale CHANGES_REQUESTED review record…
    expect(
      statusLabel({ apiStatus: 'REJECTED', reviewStatus: 'CHANGES_REQUESTED' }),
    ).toBe('مرفوض');
    // …while مطلوب تعديل stays reachable only while the row is still PENDING.
    expect(
      statusLabel({ apiStatus: 'PENDING', reviewStatus: 'CHANGES_REQUESTED' }),
    ).toBe('مطلوب تعديل');
    expect(statusLabel({ apiStatus: 'PENDING' })).toBe('بانتظار الموافقة');
    expect(statusLabel({ apiStatus: 'AVAILABLE' })).toBe('معتمد');
    expect(statusLabel({ apiStatus: 'SOLD' })).toBe('تم البيع');
  });

  it('gates the correction + resubmission action on the stored states only', () => {
    expect(awaitingCorrection({ apiStatus: 'REJECTED' })).toBe(true);
    expect(
      awaitingCorrection({
        apiStatus: 'PENDING',
        reviewStatus: 'CHANGES_REQUESTED',
      }),
    ).toBe(true);
    expect(awaitingCorrection({ apiStatus: 'PENDING' })).toBe(false);
    expect(
      awaitingCorrection({ apiStatus: 'PENDING', reviewStatus: 'PENDING' }),
    ).toBe(false);
    expect(awaitingCorrection({ apiStatus: 'AVAILABLE' })).toBe(false);
  });

  it('keeps an ordinary PENDING row as بانتظار الموافقة with no notes', () => {
    const dto = privateDto({ status: 'PENDING', reviewStatus: 'PENDING' });
    expect(displayStatus(dto)).toBe('بانتظار الموافقة');
    const property = mapPropertyFromApi(dto, employee);
    expect(property.managerNotes).toBe('');
  });

  it('hides review state entirely on a public (non-private) response', () => {
    expect(reviewStatusOf(publicDto())).toBeNull();
    expect(displayStatus(publicDto({ status: 'AVAILABLE' }))).toBe('معتمد');
  });

  it('requires an explicit resubmission only for REJECTED or CHANGES_REQUESTED', () => {
    expect(needsResubmitAfterCorrection(publicDto({ status: 'REJECTED' }))).toBe(
      true,
    );
    expect(
      needsResubmitAfterCorrection(
        privateDto({ status: 'PENDING', reviewStatus: 'CHANGES_REQUESTED' }),
      ),
    ).toBe(true);
    expect(
      needsResubmitAfterCorrection(
        privateDto({ status: 'PENDING', reviewStatus: 'PENDING' }),
      ),
    ).toBe(false);
    expect(
      needsResubmitAfterCorrection(publicDto({ status: 'AVAILABLE' })),
    ).toBe(false);
  });

  it('uses the server isMine flag so an own AVAILABLE row stays in My Properties', () => {
    const own = mapPropertyFromApi(
      publicDto({ status: 'AVAILABLE', isMine: true }),
      employee,
    );
    expect(own.mine).toBe(true);
    // An approved row is still not editable through the drawer.
    expect(own.status).toBe('معتمد');

    const other = mapPropertyFromApi(
      publicDto({ status: 'AVAILABLE', isMine: false }),
      employee,
    );
    expect(other.mine).toBe(false);
  });

  it('falls back to deriveMine when a response omits isMine', () => {
    const withoutFlag = {
      ...privateDto({ status: 'PENDING' }),
      isMine: undefined,
    } as unknown as PrivatePropertyDto;
    expect(mapPropertyFromApi(withoutFlag, employee).mine).toBe(true);
  });
});

describe('mapPreviewFromApi', () => {
  it('produces the manager display model including the price suffix', () => {
    const preview = mapPreviewFromApi(privateDto(), {
      id: 'mgr-1',
      role: 'MANAGER' as const,
    });
    expect(preview.id).toBe('prop-1');
    expect(preview.code).toBe('K0331');
    expect(preview.price).toBe('250000 د.ك');
    expect(preview.area).toBe(400);
    expect(preview.status).toBe('بانتظار الموافقة');
    expect(preview.apiStatus).toBe('PENDING');
    expect(preview.version).toBe(1);
    expect(preview.owner).toBe('أبو فهد');
    expect(preview.hasPrivateContact).toBe(true);
    expect(preview.employees).toEqual([]);
  });

  it('falls back to a placeholder price when the row has none', () => {
    const preview = mapPreviewFromApi(
      publicDto({ askingPrice: null, sizeSqm: null }),
      null,
    );
    expect(preview.price).toBe('غير محدد');
    expect(preview.area).toBe(0);
  });

  it('carries the server-derived creator role for the responsible pill', () => {
    const managerRow = mapPreviewFromApi(
      publicDto({ responsibleRole: 'MANAGER', responsibleName: 'Manager' }),
      null,
    );
    expect(managerRow.responsibleRole).toBe('MANAGER');
    // A manager-created row shows the label, never the manager's own name.
    expect(responsibleLabel(managerRow)).toBe('مدير');
    const employeeRow = mapPreviewFromApi(publicDto(), null);
    expect(employeeRow.responsibleRole).toBe('EMPLOYEE');
    expect(responsibleLabel(employeeRow)).toBe('أحمد محمد');
  });
});

describe('responsibleLabel', () => {
  it('uses the employee creator name when an employee registered the row', () => {
    expect(
      responsibleLabel({ responsibleRole: 'EMPLOYEE', responsibleName: 'أحمد محمد' }),
    ).toBe('أحمد محمد');
  });

  it('never invents a pill when the creator is unknown or unnamed', () => {
    expect(responsibleLabel({ responsibleRole: null, responsibleName: null })).toBe('');
    expect(responsibleLabel({})).toBe('');
    expect(
      responsibleLabel({ responsibleRole: 'EMPLOYEE', responsibleName: '   ' }),
    ).toBe('');
    // The owner/broker contact is never a fallback source.
    expect(responsibleLabel({ responsibleRole: null, responsibleName: 'أبو فهد' })).toBe(
      '',
    );
  });
});
