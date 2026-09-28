import districts from './kuwait-districts.json';
// Source: Kuwait_Districts_and_Blocks.xlsx, مناطق الكويت بالتفصيل.
const normalize = (value: string) =>
  value
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/[\u064B-\u065Fـ]/g, '')
    .replace(/^(?:مدينة|ضاحية)\s+/, '')
    .replace(/\s+/g, '');
export const districtOptions = Array.from(
  new Set(districts.map((row) => row.area)),
).map((area) => ({ value: area, label: area }));
// Excel supplies counts, so the requested mock options are numbered 1..count.
// Duplicate rows (e.g. Bayan 11/13) use the union of their numbered ranges.
export function blocksForArea(area: string): string[] {
  const matches = districts.filter(
    (row) => normalize(row.area) === normalize(area),
  );
  const count = Math.max(0, ...matches.map((row) => row.blocks));
  return Array.from({ length: count }, (_, index) => String(index + 1));
}
export function governorateForArea(area: string): string {
  const areas = area.split(/\s+أو\s+|\s+او\s+|[،,\/]/);
  const values = areas.map((value) => {
    const matches = districts.filter(
      (row) => normalize(row.area) === normalize(value),
    );
    const governors = new Set(matches.map((row) => row.governorate));
    return governors.size === 1 ? matches[0]?.governorate : undefined;
  });
  return values.length &&
    values[0] &&
    values.every((value) => value === values[0])
    ? values[0]
    : '';
}
