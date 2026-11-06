import {
  buildHouseComparison,
  countComparisonStates,
  normalizeComparisonNumber,
  normalizeComparisonPhone,
  normalizeComparisonText,
  type ComparisonRow,
} from '../../frontend/features/manager-properties/duplicate-comparison';
import type { PropertyDetails } from '../../frontend/lib/property-details';
import type { PropertyFloorDto } from '../../frontend/lib/api/property-types';
import { classifyDuplicate } from '../src/properties/properties.service';

/**
 * Focused coverage for the pure comparison module used by the Manager's
 * POTENTIAL_DUPLICATE review. The module lives in the frontend because it is a
 * presentation projection; the backend jest runner can import it directly
 * because it has no React or browser dependency.
 */
function floor(
  type: PropertyFloorDto['type'],
  details: string | null,
  sortOrder = 0,
  customLabel: string | null = null,
): PropertyFloorDto {
  return { id: `${type}-${sortOrder}`, type, customLabel, details, sortOrder };
}

function details(overrides: Partial<PropertyDetails> = {}): PropertyDetails {
  return {
    listingType: 'SALE',
    status: 'PENDING',
    governorate: 'الجهراء',
    district: 'مدينة المطلاع',
    block: '8',
    plotNumber: '22',
    address: null,
    sizeSqm: '400.00',
    floorCount: 3,
    floors: [],
    askingPrice: '350000.00',
    negotiable: true,
    requestedProperty: null,
    responsibleName: 'محمد',
    generalDescription: 'وصف عام',
    contact: null,
    reviewStatus: 'PENDING',
    reviewNotes: null,
    deletedAt: null,
    deletionReason: null,
    ...overrides,
  };
}

function rowsOf(groups: ReturnType<typeof buildHouseComparison>) {
  return groups.flatMap((group) => group.rows);
}

function row(
  groups: ReturnType<typeof buildHouseComparison>,
  key: string,
): ComparisonRow {
  const found = rowsOf(groups).find((candidate) => candidate.key === key);
  if (!found) throw new Error(`missing comparison row: ${key}`);
  return found;
}

describe('duplicate comparison normalization', () => {
  it('mirrors the backend Arabic text normalization', () => {
    expect(normalizeComparisonText('  مدينة   المطلاع ')).toBe(
      normalizeComparisonText('مدينه المطلاع'),
    );
    expect(normalizeComparisonText('أحمد')).toBe(normalizeComparisonText('احمد'));
    expect(normalizeComparisonText('قسيمة ٢٢')).toBe('قسيمه 22');
    expect(normalizeComparisonText('القسيمة، ٢٢.')).toBe(
      normalizeComparisonText('القسيمه 22'),
    );
  });

  it('compares phones by digits only', () => {
    expect(normalizeComparisonPhone('6111 2233')).toBe('61112233');
    expect(normalizeComparisonPhone('+965 6111-2233')).toBe('96561112233');
    expect(normalizeComparisonPhone('٦١١١٢٢٣٣')).toBe('61112233');
  });

  it('compares numbers numerically, not as raw strings', () => {
    expect(normalizeComparisonNumber('400.00')).toBe(
      normalizeComparisonNumber(400),
    );
    expect(normalizeComparisonNumber('0350000.00')).toBe(
      normalizeComparisonNumber('350000'),
    );
    expect(normalizeComparisonNumber('غير محدد')).toBe('غير محدد');
    // Whitespace is missing; numeric zero is a real value.
    expect(normalizeComparisonNumber('   ')).toBe('');
    expect(normalizeComparisonNumber(0)).toBe('0');
    expect(normalizeComparisonNumber('0.00')).toBe('0');
  });
});

describe('buildHouseComparison', () => {
  it('labels equal, different and one-sided location fields correctly', () => {
    const groups = buildHouseComparison(
      details({ governorate: 'الجهراء', district: 'مدينة المطلاع', block: '8' }),
      details({ governorate: 'الجهراء', district: 'الفروانية', block: null }),
    );

    expect(row(groups, 'governorate').state).toBe('match');
    expect(row(groups, 'district').state).toBe('different');
    // Exactly one side is missing: it is a REAL difference, not «بيانات ناقصة».
    expect(row(groups, 'block').state).toBe('different');
    // The stored values are still shown; the missing side renders '—'.
    expect(row(groups, 'block').b).toBeNull();
  });

  it('keeps both-missing rows visible as «بيانات ناقصة» and counts them as matched', () => {
    const groups = buildHouseComparison(
      details({ address: null, governorate: null }),
      details({ address: null, governorate: null }),
    );

    const address = row(groups, 'address');
    expect(address.state).toBe('missing');
    expect(address.bothMissing).toBe(true);
    expect(address.a).toBeNull();
    expect(address.b).toBeNull();

    const governorate = row(groups, 'governorate');
    expect(governorate.bothMissing).toBe(true);

    // Presentation summary: both-missing is matched, never «مختلف».
    const location = groups.find((group) => group.key === 'location');
    expect(location).toBeTruthy();
    const counts = countComparisonStates(location!);
    expect(counts.different).toBe(0);
    expect(counts.match).toBeGreaterThanOrEqual(2);
  });

  it('does not treat legitimate numeric 0 as missing', () => {
    const groups = buildHouseComparison(
      details({ askingPrice: '0', floorCount: 0 }),
      details({ askingPrice: '0.00', floorCount: 0 }),
    );

    expect(row(groups, 'askingPrice').state).toBe('match');
    expect(row(groups, 'askingPrice').bothMissing).toBe(false);
    expect(row(groups, 'floorCount').state).toBe('match');
  });

  it('compares owner/broker contact only when both sides carry it', () => {
    const groups = buildHouseComparison(
      details({
        contact: { type: 'OWNER', name: 'عبدالله العتيبي', phone: '6111 2233' },
      }),
      details({
        contact: { type: 'BROKER', name: 'عبدالله العتيبي', phone: '61112233' },
      }),
    );

    expect(row(groups, 'contactType').state).toBe('different');
    expect(row(groups, 'contactName').state).toBe('match');
    expect(row(groups, 'contactPhone').state).toBe('match');

    const withoutCandidateContact = buildHouseComparison(
      details({
        contact: { type: 'OWNER', name: 'عبدالله العتيبي', phone: '61112233' },
      }),
      details({ contact: null }),
    );
    // One side carries a name, the other does not: «مختلف», not «بيانات ناقصة».
    expect(row(withoutCandidateContact, 'contactName').state).toBe('different');
  });

  it('matches floors by type, not by array index', () => {
    const groups = buildHouseComparison(
      details({
        floors: [
          floor('GROUND', 'مجلس + ديوانية', 0),
          floor('FIRST', 'أربع غرف نوم', 1),
          floor('BASEMENT', 'قبو 80 م²', 2),
        ],
      }),
      details({
        floors: [
          // Same floors in a different order: the comparison must pair them by
          // identity (type), otherwise it would report false differences.
          floor('BASEMENT', 'قبو 80 م²', 0),
          floor('FIRST', 'أربع غرف نوم', 1),
          floor('GROUND', 'مجلس + ديوانية', 2),
        ],
      }),
    );

    expect(row(groups, 'floor:GROUND|').state).toBe('match');
    expect(row(groups, 'floor:FIRST|').state).toBe('match');
    expect(row(groups, 'floor:BASEMENT|').state).toBe('match');
  });

  it('marks a floor missing when only one house has it', () => {
    const groups = buildHouseComparison(
      details({ floors: [floor('GROUND', 'مجلس'), floor('HALF', 'نصف دور')] }),
      details({ floors: [floor('GROUND', 'مجلس')] }),
    );

    // The floor exists on only one side: a real difference with '—' on the
    // missing side, not the both-missing «بيانات ناقصة» state.
    expect(row(groups, 'floor:HALF|').state).toBe('different');
    expect(row(groups, 'floor:HALF|').bothMissing).toBe(false);
    expect(row(groups, 'floor:HALF|').b).toBeNull();
  });

  it('marks a floor with empty details on one side as different', () => {
    const groups = buildHouseComparison(
      details({ floors: [floor('FIRST', 'غرفتان')] }),
      details({ floors: [floor('FIRST', null)] }),
    );

    expect(row(groups, 'floor:FIRST|').state).toBe('different');
  });

  it('treats a floor with empty details on both sides as data missing', () => {
    const groups = buildHouseComparison(
      details({ floors: [floor('FIRST', null)] }),
      details({ floors: [floor('FIRST', '   ')] }),
    );

    const floorRow = row(groups, 'floor:FIRST|');
    expect(floorRow.state).toBe('missing');
    expect(floorRow.bothMissing).toBe(true);
  });

  it('compares size and price numerically and formats the display value', () => {
    const groups = buildHouseComparison(
      details({ sizeSqm: '400.00', askingPrice: '350000.00' }),
      details({ sizeSqm: '400', askingPrice: '360000.00' }),
    );

    expect(row(groups, 'sizeSqm').state).toBe('match');
    expect(row(groups, 'askingPrice').state).toBe('different');
    expect(row(groups, 'sizeSqm').a).toContain('400');
    expect(row(groups, 'askingPrice').b).toContain('د.ك');
  });

  it('omits an entire group when every row is empty on both sides', () => {
    const groups = buildHouseComparison(
      details({ requestedProperty: null }),
      details({ requestedProperty: null }),
    );

    expect(groups.some((group) => group.key === 'requested')).toBe(false);
  });

  it('compares the requested property fields of an exchange listing', () => {
    const requested = {
      governorate: 'حولي',
      district: 'السالمية',
      block: '4',
      plotNumber: '10',
      sizeSqm: '350',
      floorRequirements: 'دور أول',
      notes: null,
      budgetMin: '300000',
      budgetMax: '340000',
    };
    const groups = buildHouseComparison(
      details({ requestedProperty: requested }),
      details({ requestedProperty: { ...requested, district: 'الجابرية' } }),
    );

    expect(row(groups, 'requestedGovernorate').state).toBe('match');
    expect(row(groups, 'requestedDistrict').state).toBe('different');
    expect(row(groups, 'requestedBudgetMin').state).toBe('match');
  });
});

/**
 * The visual rules above must never weaken the automatic classifier: two
 * missing values are presentation-only and add NO score.
 */
describe('backend duplicate classifier safety', () => {
  const base = {
    governorate: 'الجهراء',
    district: 'الفروانية',
    block: null,
    plotNumber: null,
    address: null,
    sizeSqm: null,
    floorCount: null,
    listingType: 'SALE',
    description: null,
    contact: null,
    floors: [],
  };

  it('returns DISTINCT when the strong identifiers are missing on BOTH sides', () => {
    expect(classifyDuplicate(base, { ...base }, null, null)).toBe('DISTINCT');
  });

  it('still confirms a real block + plot identity match', () => {
    const identifying = { ...base, block: '8', plotNumber: '15' };
    expect(
      classifyDuplicate(identifying, { ...identifying }, null, null),
    ).toBe('CONFIRMED');
  });

  it('confirms the same plot when the block is missing but real owner evidence matches', () => {
    const existing = {
      ...base,
      plotNumber: '22',
      block: null,
      address: null,
      sizeSqm: '400.00',
      floorCount: 1,
      contact: { name: 'Same Owner', phone: '61112222' },
      floors: [{ type: 'GROUND', details: 'مجلس' }],
    };
    const submitted = {
      ...base,
      plotNumber: '22',
      block: null,
      address: null,
      sizeSqm: '400.00',
      floorCount: 1,
      newContact: { name: 'Same Owner', phone: '61112222' },
      floors: [{ type: 'GROUND', details: 'مجلس' }],
    };
    expect(
      classifyDuplicate(existing, submitted, 'Same Owner', '61112222'),
    ).toBe('CONFIRMED');
  });

  it('does NOT confirm when both owners are missing and only the plot matches', () => {
    const existing = {
      ...base,
      plotNumber: '22',
      block: null,
      address: null,
      sizeSqm: '400.00',
      floorCount: 1,
      contact: null,
      floors: [{ type: 'GROUND', details: 'مجلس' }],
    };
    const submitted = {
      ...base,
      plotNumber: '22',
      block: null,
      address: null,
      sizeSqm: '400.00',
      floorCount: 1,
      newContact: null,
      floors: [{ type: 'GROUND', details: 'مجلس' }],
    };
    expect(classifyDuplicate(existing, submitted, null, null)).toBe('POTENTIAL');
  });

  it('treats a mostly-empty plot-only row as POTENTIAL, never CONFIRMED', () => {
    const existing = { ...base, plotNumber: '22' };
    const submitted = { ...base, plotNumber: '22' };
    expect(classifyDuplicate(existing, submitted, null, null)).toBe('POTENTIAL');
  });

  it('never confirms when the block contradicts the plot match', () => {
    const existing = {
      ...base,
      block: '8',
      plotNumber: '22',
      contact: { name: 'Same Owner', phone: '61112222' },
    };
    const submitted = {
      ...base,
      block: '9',
      plotNumber: '22',
      newContact: { name: 'Same Owner', phone: '61112222' },
    };
    expect(
      classifyDuplicate(existing, submitted, 'Same Owner', '61112222'),
    ).toBe('POTENTIAL');
  });

  it('returns DISTINCT for a different plot or different explicit location', () => {
    const existing = { ...base, plotNumber: '22' };
    expect(
      classifyDuplicate(existing, { ...base, plotNumber: '23' }, null, null),
    ).toBe('DISTINCT');
    expect(
      classifyDuplicate(
        { ...base, district: 'الفروانية' },
        { ...base, district: 'حولي' },
        null,
        null,
      ),
    ).toBe('DISTINCT');
  });

  it('treats whitespace area as missing, never as an area match', () => {
    const existing = {
      ...base,
      plotNumber: '22',
      sizeSqm: '   ',
      contact: { name: 'Same Owner', phone: '' },
    };
    const submitted = {
      ...base,
      plotNumber: '22',
      sizeSqm: '   ',
      newContact: { name: 'Same Owner', phone: '' },
    };
    // Plot + owner name only; whitespace must NOT add the area evidence that
    // would otherwise turn this into CONFIRMED.
    expect(
      classifyDuplicate(existing, submitted, 'Same Owner', ''),
    ).toBe('POTENTIAL');
  });

  it('treats numeric zero area as a real value, not as missing', () => {
    const existing = {
      ...base,
      plotNumber: '22',
      sizeSqm: '0.00',
      contact: { name: 'Same Owner', phone: '' },
    };
    const submitted = {
      ...base,
      plotNumber: '22',
      sizeSqm: '0',
      newContact: { name: 'Same Owner', phone: '' },
    };
    expect(
      classifyDuplicate(existing, submitted, 'Same Owner', ''),
    ).toBe('CONFIRMED');
  });
});
