'use client';
import {
  useDraftState,
  useDraftScope,
  useDraftFields,
} from '../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../lib/drafts/draft-tools';

import { GlassSelect } from '../../../components/ui/glass-select';

import { useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import {
  employees,
  statuses,
  today,
  validateRecord,
  type AttendanceStatus,
  type AttendanceRecord,
} from '../attendance-model';
import styles from './attendance.module.css';
export function AttendanceManualModal({
  records,
  onClose,
  onSave,
}: {
  records: readonly AttendanceRecord[];
  onClose: () => void;
  onSave: (record: AttendanceRecord) => void;
}) {
  const formKey = 'manual-attendance';
  const { clear: clearFormDraft } = useDraftScope(formKey);
  const draftField = useDraftFields(formKey);

  const [status, setStatus] = useDraftState<AttendanceStatus>(
    formKey + ':status',
    'present',
  );
  const [error, setError] = useState('');
  const hasTimes = status === 'present' || status === 'late';
  return (
    <PropertyOverlay title="تسجيل حضور يدوي" onClose={onClose}>
      <>
        <DraftTools formKey={formKey} />{' '}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            const record: AttendanceRecord = {
              id:
                globalThis.crypto?.randomUUID?.() ??
                `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
              employeeId: String(data.get('employee')),
              date: String(data.get('date')),
              status,
              checkIn: hasTimes ? String(data.get('checkIn') || '') : '',
              checkOut: hasTimes ? String(data.get('checkOut') || '') : '',
              note: String(data.get('note') || '').trim(),
            };
            const message = validateRecord(record, records);
            if (message) {
              setError(message);
              return;
            }
            onSave(record);
            clearFormDraft();
          }}
        >
          <p className={styles.muted}>
            حفظ تجريبي مؤقت. سجل واحد لكل موظف في اليوم، والأوقات ضمن نفس اليوم.
          </p>
          <label className={styles.field}>
            الموظف
            <GlassSelect
              {...draftField('employee', '')}
              name="employee"
              required
            >
              <option value="" disabled>
                اختر الموظف
              </option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </GlassSelect>
          </label>
          <label className={styles.field}>
            التاريخ
            <input
              {...draftField('date', today())}
              name="date"
              type="date"
              required
            />
          </label>
          <label className={styles.field}>
            الحالة
            <GlassSelect
              value={status}
              onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
            >
              {Object.entries(statuses).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </GlassSelect>
          </label>
          <label className={styles.field}>
            وقت الحضور
            <input
              {...draftField('checkIn', '')}
              name="checkIn"
              type="time"
              required={hasTimes}
              disabled={!hasTimes}
            />
          </label>
          <label className={styles.field}>
            وقت الانصراف (اختياري)
            <input
              {...draftField('checkOut', '')}
              name="checkOut"
              type="time"
              disabled={!hasTimes}
            />
          </label>
          <label className={styles.field}>
            ملاحظة
            <textarea
              {...draftField('note', '')}
              name="note"
              maxLength={1000}
            />
          </label>
          {status === 'late' && (
            <p className={styles.late}>
              قد يرتبط التأخير بخصومات الراتب لاحقًا؛ لا يتم حساب أي خصم الآن.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <Button type="submit">حفظ</Button>
        </form>{' '}
      </>
    </PropertyOverlay>
  );
}
