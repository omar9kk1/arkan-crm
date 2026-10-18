/**
 * Local-only trial data for the «تخصيص عقار» action.
 *
 * Property assignment has NO backend endpoint yet — `PropertyAssignment` is
 * never read by the API — so this feature is deliberately kept as an in-page
 * trial and nothing here is persisted or treated as a real statistic. The
 * employee cards/drawer therefore render the assigned-properties metric as «—»,
 * because the backend genuinely cannot answer it yet.
 */
export const assignmentProperties = [
  { id: 'K029', title: 'المطلاع - N12' },
  { id: 'K0331', title: 'غرناطة - قطعة 2' },
  { id: 'K0334', title: 'غرناطة - قطعة 4' },
  { id: 'K041', title: 'فيلا صباح الأحمد' },
];
export const assignmentTypes = [
  'تسويق فقط',
  'متابعة مالك',
  'تجهيز معاينات',
] as const;
export interface Assignment {
  employeeId: string;
  propertyId: string;
  type: (typeof assignmentTypes)[number];
  note: string;
}
