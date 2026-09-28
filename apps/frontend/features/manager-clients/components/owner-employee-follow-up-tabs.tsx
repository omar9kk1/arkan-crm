'use client';
import { useState } from 'react';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../manager-properties/components/properties-segmented-tabs';
import type { OwnerEmployee } from '../mock-data';
import { FollowUpTimeline } from './follow-up-timeline';
export function OwnerEmployeeFollowUpTabs({
  employees,
}: {
  employees: readonly OwnerEmployee[];
}) {
  const [selected, setSelected] = useState(employees[0]?.id ?? '');
  if (!employees.length) return <p>لا يوجد موظف متابع في العينة الحالية.</p>;
  return (
    <>
      <SegmentedTabs
        id="owner-employees"
        label="الموظفون المتابعون مع المالك"
        items={employees.map((employee) => ({
          id: employee.id,
          label: employee.name,
        }))}
        value={selected}
        onChange={setSelected}
      />
      {employees.map((employee) => (
        <section
          key={employee.id}
          role="tabpanel"
          tabIndex={0}
          id={`owner-employees-panel-${employee.id}`}
          aria-labelledby={`owner-employees-tab-${employee.id}`}
          hidden={selected !== employee.id}
        >
          <h3>سجل متابعة {employee.name}</h3>
          <FollowUpTimeline entries={employee.timeline} />
        </section>
      ))}
    </>
  );
}
