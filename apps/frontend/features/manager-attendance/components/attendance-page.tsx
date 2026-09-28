'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useAttendance } from '../../employee-attendance/use-attendance';
import { tagForEmail } from '../../employee-attendance/nfc-store';
import { GlassSelect } from '../../../components/ui/glass-select';
import { useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import {
  createMockRecords,
  filterRecords,
  today,
  type AttendanceFilter,
} from '../attendance-model';
import { AttendanceSummaryCards } from './attendance-summary-cards';
import { AttendanceFilters } from './attendance-filters';
import { AttendanceCard } from './attendance-card';
import { AttendanceManualModal } from './attendance-manual-modal';
import styles from './attendance.module.css';
export function AttendancePage() {
  const [samples, setRecords] = useState(createMockRecords);
  const { records: stored, error } = useAttendance();
  const [method, setMethod] = useState('');
  const converted = stored.map((r) => ({
    ...r,
    employeeId: tagForEmail(r.employeeEmail)?.employeeId || r.employeeEmail,
    status: r.status.toLowerCase() as 'present' | 'late' | 'absent' | 'leave',
    note: r.notes,
  }));
  const records = [
    ...converted,
    ...samples.filter(
      (r) =>
        !converted.some(
          (c) => c.employeeId === r.employeeId && c.date === r.date,
        ),
    ),
  ];
  const [filter, setFilter] = useState<AttendanceFilter>({
    date: today(),
    period: 'today',
    employeeId: '',
    status: '',
  });
  const [adding, setAdding] = useDraftState(
    'ui:features/manager-attendance/components/attendance-page.tsx:adding',
    false,
  );
  const [notice, setNotice] = useState('');
  const visible = filterRecords(records, filter).filter(
    (r) => !method || (r.method || 'MANUAL') === method,
  );
  return (
    <ManagerPageShell
      title="الحضور والانصراف"
      description="متابعة حضور الموظفين اليومي، ساعات العمل، التأخير، الغياب، وربط التأخير بالرواتب لاحقًا."
      actions={
        <div className={styles.actions}>
          <Button onClick={() => setNotice('تم تجهيز تقرير الحضور والانصراف')}>
            تصدير تقرير
          </Button>
          <Button onClick={() => setAdding(true)}>تسجيل حضور يدوي</Button>
        </div>
      }
    >
      <div className={styles.scope}>
        <AttendanceSummaryCards
          records={records.filter((r) => r.date === today())}
        />
        <AttendanceFilters value={filter} onChange={setFilter} />
        <label className={styles.field}>
          طريقة التسجيل
          <GlassSelect
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="">الكل</option>
            <option value="NFC">NFC</option>
            <option value="MANUAL">يدوي</option>
          </GlassSelect>
        </label>
        {error && <p role="alert">{error}</p>}
        <p className={styles.muted}>
          الفترة تنتهي بالتاريخ المختار. البيانات تجريبية؛ لا يوجد تصدير ملف أو
          ربط بالرواتب حاليًا.
        </p>
        <h2>سجل حضور الموظفين</h2>
        <div className={styles.list}>
          {visible.map((record) => (
            <AttendanceCard key={record.id} record={record} />
          ))}
        </div>
        {!visible.length && <Card>لا توجد سجلات تطابق الفلاتر.</Card>}
        {adding && (
          <AttendanceManualModal
            records={records}
            onClose={() => setAdding(false)}
            onSave={(record) => {
              setRecords((previous) => [record, ...previous]);
              setFilter({
                date: record.date,
                period: 'today',
                employeeId: '',
                status: '',
              });
              setAdding(false);
              setNotice('تم حفظ سجل الحضور');
            }}
          />
        )}
        <Toast message={notice} onDismiss={() => setNotice('')} />
      </div>
    </ManagerPageShell>
  );
}
