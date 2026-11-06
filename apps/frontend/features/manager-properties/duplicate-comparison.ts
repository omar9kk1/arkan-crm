import type { PropertyFloorDto } from '../../lib/api/property-types';
import {
  FLOOR_LABEL_BY_TYPE,
  OPERATION_BY_DEAL,
  floorSummary,
  formatDecimal,
  orderedFloors,
} from '../../lib/property-adapter';
import type { PropertyDetails } from '../../lib/property-details';

/**
 * Pure, presentation-independent comparison of two COMPLETE HOUSES.
 *
 * The Manager review must show the same facts the backend used when it
 * classified the pair, without inventing values or treating two missing values
 * as a match. The normalization helpers below deliberately mirror the backend
 * (`apps/backend/src/properties/properties.service.ts`):
 *
 *   - `normalizeComparisonText` — trim/collapse whitespace, Arabic digits,
 *     alef/taa-marbuta/yaa variants and common punctuation.
 *   - `normalizeComparisonPhone` — digits only.
 *   - `normalizeComparisonNumber` — numeric comparison, text fallback.
 *
 * Presentation rules (they never change the backend classifier):
 *   - both sides missing → the row stays visible with «بيانات ناقصة» but is
 *     counted as matched in the visual section summary;
 *   - exactly one side missing → `different`, and the missing side renders '—';
 *   - both present → equal after normalization is `match`, otherwise `different`.
 * Missing data is never promoted to positive duplicate evidence.
 */
export type ComparisonState = 'match' | 'different' | 'missing';

export interface ComparisonRow {
  key: string;
  label: string;
  /** Display value for the new (pending) house. */
  a: string | null;
  /** Display value for the already registered house. */
  b: string | null;
  state: ComparisonState;
  /** Both sides are missing: badge stays «بيانات ناقصة», summary counts it as matched. */
  bothMissing?: boolean;
  /** Long free text gets a bounded, scrollable cell in the drawer. */
  long?: boolean;
}

export interface ComparisonGroup {
  key: string;
  title: string;
  rows: ComparisonRow[];
}

/**
 * Visual section summary:
 * - both-missing rows count as matched (their badge still says «بيانات ناقصة»);
 * - one-missing rows count as different;
 * - present/equal rows count as matched; present/different as different.
 * This is presentation only and is never fed into the duplicate classifier.
 */
export function countComparisonStates(
  group: ComparisonGroup,
): Record<ComparisonState, number> {
  return group.rows.reduce<Record<ComparisonState, number>>(
    (counts, row) => {
      counts[row.bothMissing ? 'match' : row.state] += 1;
      return counts;
    },
    { match: 0, different: 0, missing: 0 },
  );
}

type ComparisonKind = 'text' | 'phone' | 'number' | 'choice';

export function normalizeComparisonText(
  value: string | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  let v = String(value).trim().toLowerCase();
  v = v.replace(/\s+/g, ' ');
  v = v.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  v = v.replace(/[أإآ]/g, 'ا');
  v = v.replace(/ة/g, 'ه');
  v = v.replace(/ى/g, 'ي');
  v = v.replace(/[،,.;:!?()[\]{}«»"'’“”]/g, '');
  v = v.replace(/\s+/g, ' ').trim();
  return v;
}

export function normalizeComparisonPhone(
  value: string | null | undefined,
): string {
  if (!value) return '';
  // Mirror the backend: convert Arabic-Indic digits before stripping
  // separators, otherwise Arabic-numeral phones would collapse to ''.
  const ascii = String(value).replace(/[٠-٩]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x0660),
  );
  return ascii.replace(/\D/g, '');
}

export function normalizeComparisonNumber(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return '';
  // Whitespace is missing, never numeric zero; a real `0` stays a value.
  const text = typeof value === 'string' ? value.trim() : value;
  if (text === '') return '';
  const numeric = Number(text);
  if (Number.isNaN(numeric)) return normalizeComparisonText(String(text));
  return String(numeric);
}

function raw(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

function sameValue(a: string, b: string, kind: ComparisonKind): boolean {
  if (kind === 'phone') {
    return normalizeComparisonPhone(a) === normalizeComparisonPhone(b);
  }
  if (kind === 'number') {
    return normalizeComparisonNumber(a) === normalizeComparisonNumber(b);
  }
  if (kind === 'choice') return a === b;
  return normalizeComparisonText(a) === normalizeComparisonText(b);
}

function makeRow(
  key: string,
  label: string,
  aRaw: string | null | undefined,
  bRaw: string | null | undefined,
  kind: ComparisonKind = 'text',
  display?: { a?: string | null; b?: string | null; long?: boolean },
): ComparisonRow {
  const a = raw(aRaw);
  const b = raw(bRaw);
  const bothMissing = !a && !b;
  // Both missing: the row stays visible with «بيانات ناقصة» and is counted as
  // matched in the section summary only (never as duplicate evidence).
  // One missing: it is a real difference, and the missing side renders '—'.
  const state: ComparisonState = bothMissing
    ? 'missing'
    : !a || !b
      ? 'different'
      : sameValue(a, b, kind)
        ? 'match'
        : 'different';
  return {
    key,
    label,
    a: display?.a ?? a,
    b: display?.b ?? b,
    state,
    bothMissing,
    long: display?.long,
  };
}

function money(value: string | null | undefined): string | null {
  const text = raw(value);
  if (!text || !Number.isFinite(Number(text))) return text;
  return `${Number(text).toLocaleString('ar-KW', {
    maximumFractionDigits: 3,
  })} د.ك`;
}

function size(value: string | null | undefined): string | null {
  const text = raw(value);
  return text ? `${formatDecimal(text)} م²` : null;
}

function boolLabel(value: boolean | null | undefined): string | null {
  if (value === true) return 'نعم';
  if (value === false) return 'لا';
  return null;
}

function listingLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return OPERATION_BY_DEAL[value as keyof typeof OPERATION_BY_DEAL] ?? value;
}

function contactLabel(value: string | null | undefined): string | null {
  if (value === 'BROKER') return 'وسيط عقاري';
  if (value === 'OWNER') return 'مالك مباشر';
  return value ?? null;
}

function floorKey(floor: PropertyFloorDto): string {
  return `${floor.type}|${floor.customLabel ?? ''}`;
}

function floorLabel(floor: PropertyFloorDto): string {
  const base = FLOOR_LABEL_BY_TYPE[floor.type] ?? floor.type;
  return floor.customLabel ? `${base} (${floor.customLabel})` : base;
}

function floorRows(
  a: PropertyDetails | undefined,
  b: PropertyDetails | undefined,
): (ComparisonRow | null)[] {
  const rows: (ComparisonRow | null)[] = [
    makeRow(
      'floorSummary',
      'ملخص الأدوار',
      a ? floorSummary(a.floors, a.floorCount) : null,
      b ? floorSummary(b.floors, b.floorCount) : null,
    ),
  ];

  const aFloors = a?.floors ?? [];
  const bFloors = b?.floors ?? [];
  const aByKey = new Map(aFloors.map((floor) => [floorKey(floor), floor]));
  const bByKey = new Map(bFloors.map((floor) => [floorKey(floor), floor]));
  const ordered = orderedFloors([...aFloors, ...bFloors]);
  const seen = new Set<string>();

  for (const floor of ordered) {
    const key = floorKey(floor);
    if (seen.has(key)) continue;
    seen.add(key);

    const aFloor = aByKey.get(key);
    const bFloor = bByKey.get(key);
    const aDetails = raw(aFloor?.details);
    const bDetails = raw(bFloor?.details);
    // A floor that exists on only one side is a real difference; a floor that
    // exists on both sides with no details on either side is «بيانات ناقصة»
    // (presentation-matched, never duplicate evidence).
    const bothMissing = !!aFloor && !!bFloor && !aDetails && !bDetails;
    const state: ComparisonState =
      !aFloor || !bFloor
        ? 'different'
        : !aDetails || !bDetails
          ? bothMissing
            ? 'missing'
            : 'different'
          : normalizeComparisonText(aDetails) ===
              normalizeComparisonText(bDetails)
            ? 'match'
            : 'different';

    rows.push({
      key: `floor:${key}`,
      label: floorLabel(floor),
      a: aDetails,
      b: bDetails,
      state,
      bothMissing,
      long: true,
    });
  }

  return rows;
}

/**
 * Builds the Manager comparison groups in a calm, stable order:
 * location → owner → size/specs → floors → listing/description → exchange.
 * Rows that are empty on both sides stay visible as «بيانات ناقصة» (and count
 * as visually matched); the requested-property group is only built when at
 * least one side is an exchange listing with requested data.
 */
export function buildHouseComparison(
  a?: PropertyDetails,
  b?: PropertyDetails,
): ComparisonGroup[] {
  const groups: ComparisonGroup[] = [];

  const push = (
    key: string,
    title: string,
    rows: (ComparisonRow | null)[],
  ) => {
    const present = rows.filter((row): row is ComparisonRow => row !== null);
    if (present.length > 0) groups.push({ key, title, rows: present });
  };

  push('location', 'الهوية والموقع', [
    makeRow('governorate', 'المحافظة', a?.governorate, b?.governorate),
    makeRow('district', 'المنطقة', a?.district, b?.district),
    makeRow('block', 'القطعة', a?.block, b?.block),
    makeRow('plotNumber', 'رقم القسيمة', a?.plotNumber, b?.plotNumber),
    makeRow('address', 'العنوان', a?.address, b?.address),
  ]);

  push('owner', 'بيانات المالك / الوسيط', [
    makeRow(
      'contactType',
      'نوع جهة التواصل',
      a?.contact ? contactLabel(a.contact.type) : null,
      b?.contact ? contactLabel(b.contact.type) : null,
      'choice',
    ),
    makeRow('contactName', 'الاسم', a?.contact?.name, b?.contact?.name),
    makeRow(
      'contactPhone',
      'الهاتف',
      a?.contact?.phone,
      b?.contact?.phone,
      'phone',
    ),
  ]);

  push('specs', 'المساحة والمواصفات', [
    makeRow('sizeSqm', 'المساحة', a?.sizeSqm, b?.sizeSqm, 'number', {
      a: size(a?.sizeSqm),
      b: size(b?.sizeSqm),
    }),
    makeRow(
      'floorCount',
      'عدد الأدوار',
      a?.floorCount != null ? String(a.floorCount) : null,
      b?.floorCount != null ? String(b.floorCount) : null,
      'number',
    ),
    makeRow(
      'negotiable',
      'قابل للتفاوض',
      boolLabel(a?.negotiable),
      boolLabel(b?.negotiable),
      'choice',
    ),
  ]);

  push('floors', 'الأدوار وتفاصيل المبنى', floorRows(a, b));

  push('listing', 'السعر والإدراج والوصف', [
    makeRow('askingPrice', 'السعر المطلوب', a?.askingPrice, b?.askingPrice, 'number', {
      a: money(a?.askingPrice),
      b: money(b?.askingPrice),
    }),
    makeRow(
      'listingType',
      'نوع الإدراج',
      listingLabel(a?.listingType),
      listingLabel(b?.listingType),
      'choice',
    ),
    makeRow(
      'description',
      'الوصف العام',
      a?.generalDescription,
      b?.generalDescription,
      'text',
      { long: true },
    ),
  ]);

  const aRequested = a?.requestedProperty;
  const bRequested = b?.requestedProperty;
  if (aRequested || bRequested) {
    push('requested', 'العقار المطلوب في البدل', [
      makeRow(
        'requestedGovernorate',
        'المحافظة المطلوبة',
        aRequested?.governorate,
        bRequested?.governorate,
      ),
      makeRow(
        'requestedDistrict',
        'المنطقة المطلوبة',
        aRequested?.district,
        bRequested?.district,
      ),
      makeRow(
        'requestedBlock',
        'القطعة المطلوبة',
        aRequested?.block,
        bRequested?.block,
      ),
      makeRow(
        'requestedPlot',
        'رقم القسيمة المطلوب',
        aRequested?.plotNumber,
        bRequested?.plotNumber,
      ),
      makeRow(
        'requestedSize',
        'المساحة المطلوبة',
        aRequested?.sizeSqm,
        bRequested?.sizeSqm,
        'number',
        {
          a: size(aRequested?.sizeSqm),
          b: size(bRequested?.sizeSqm),
        },
      ),
      makeRow(
        'requestedFloorRequirements',
        'متطلبات الأدوار',
        aRequested?.floorRequirements,
        bRequested?.floorRequirements,
        'text',
        { long: true },
      ),
      makeRow(
        'requestedNotes',
        'ملاحظات العقار المطلوب',
        aRequested?.notes,
        bRequested?.notes,
        'text',
        { long: true },
      ),
      makeRow(
        'requestedBudgetMin',
        'الميزانية من',
        aRequested?.budgetMin,
        bRequested?.budgetMin,
        'number',
        {
          a: money(aRequested?.budgetMin),
          b: money(bRequested?.budgetMin),
        },
      ),
      makeRow(
        'requestedBudgetMax',
        'الميزانية إلى',
        aRequested?.budgetMax,
        bRequested?.budgetMax,
        'number',
        {
          a: money(aRequested?.budgetMax),
          b: money(bRequested?.budgetMax),
        },
      ),
    ]);
  }

  return groups;
}
