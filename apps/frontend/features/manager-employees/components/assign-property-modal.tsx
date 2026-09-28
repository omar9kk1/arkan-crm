'use client';
import { GlassSelect } from '../../../components/ui/glass-select';

import { useState, useRef } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import {
  employees,
  assignmentProperties,
  assignmentTypes,
  type Assignment,
  type EmployeeSample,
} from '../mock-data';
import styles from './employees.module.css';
export function AssignPropertyModal({
  employeeId,
  items = employees,
  onClose,
  onSave,
}: {
  employeeId: string;
  items?: readonly EmployeeSample[];
  onClose: () => void;
  onSave: (value: Assignment) => void;
}) {
  const [draft, setDraft] = useState<Assignment>({
    employeeId,
    propertyId: '',
    type: 'تسويق فقط',
    note: '',
  });
  const submitted = useRef(false);
  return (
    <PropertyOverlay title="تخصيص عقار" onClose={onClose}>
      <p className={styles.notice}>
        التخصيص معناه تركيز أو أولوية فقط، وليس حصر العمل على موظف واحد. باقي
        الموظفين يستطيعون العمل على نفس العقار.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (submitted.current) return;
          if (
            !employees.some((item) => item.id === draft.employeeId) ||
            !assignmentProperties.some((item) => item.id === draft.propertyId)
          )
            return;
          submitted.current = true;
          onSave(draft);
        }}
      >
        <label className={styles.field}>
          الموظف
          <GlassSelect
            required
            value={draft.employeeId}
            onChange={(event) =>
              setDraft({ ...draft, employeeId: event.target.value })
            }
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </GlassSelect>
        </label>
        <label className={styles.field}>
          العقار
          <GlassSelect
            required
            value={draft.propertyId}
            onChange={(event) =>
              setDraft({ ...draft, propertyId: event.target.value })
            }
          >
            <option value="">اختر العقار</option>
            {assignmentProperties.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.id}
              </option>
            ))}
          </GlassSelect>
        </label>
        <label className={styles.field}>
          نوع التخصيص
          <GlassSelect
            value={draft.type}
            onChange={(event) =>
              setDraft({
                ...draft,
                type: event.target.value as Assignment['type'],
              })
            }
          >
            {assignmentTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </GlassSelect>
        </label>
        <label className={styles.field}>
          ملاحظة
          <textarea
            maxLength={1000}
            value={draft.note}
            onChange={(event) =>
              setDraft({ ...draft, note: event.target.value })
            }
          />
        </label>
        <p className={styles.muted}>
          حفظ تجريبي داخل الصفحة فقط. إعادة تخصيص نفس العقار لنفس الموظف تُحدّث
          ملاحظته ونوعه.
        </p>
        <Button type="submit">حفظ</Button>
      </form>
    </PropertyOverlay>
  );
}
