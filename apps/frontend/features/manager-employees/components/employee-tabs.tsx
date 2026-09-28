import { PropertiesSegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
export const employeeTabs = [
  { id: 'summary', label: 'الملخص' },
  { id: 'clients', label: 'العملاء' },
  { id: 'properties', label: 'العقارات' },
  { id: 'deals', label: 'الصفقات والعمولات' },
  { id: 'followups', label: 'المتابعات' },
];
export function EmployeeTabs({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <PropertiesSegmentedTabs
      id="employee-file"
      label="أقسام ملف الموظف"
      items={employeeTabs}
      value={value}
      onChange={onChange}
    />
  );
}
