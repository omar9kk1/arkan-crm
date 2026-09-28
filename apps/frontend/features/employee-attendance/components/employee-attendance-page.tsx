'use client';
import { Toast } from '../../../components/ui/toast';

import Link from 'next/link';
import { Button } from '../../../components/ui/button';
import { useAuth } from '../../auth/components/auth-provider';
import { useAttendance } from '../use-attendance';
import {
  tagForEmail,
  nfcHref,
  registerAttendance,
  readAttendance,
  saveAttendance,
} from '../nfc-store';
import { attendanceIdentity } from '../mock-identity';
import { useEffect, useState } from 'react';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { StatCard } from '../../../components/ui/stat-card';
import { Card } from '../../../components/ui/card';
import {
  filterHistory,
  localDate,
  duration,
  type AttendanceRecord,
} from '../model';
import { AttendanceTodayCard } from './attendance-today-card';
import { AttendanceHistoryCard } from './attendance-history-card';
import { AttendanceFilters } from './attendance-filters';
import styles from './attendance.module.css';
import shared from '../../manager-attendance/components/attendance.module.css';
export function EmployeeAttendancePage() {
  const { user } = useAuth();
  const [identity, setIdentity] = useState<{
    email: string;
    name: string;
  } | null>(null);
  const [identityError, setIdentityError] = useState('');
  useEffect(() => {
    if (!user) return;
    try {
      setIdentity(attendanceIdentity(user));
      setIdentityError('');
    } catch {
      setIdentity(null);
      setIdentityError('سجّل الدخول مجددًا لتهيئة هوية الحضور التجريبية');
    }
  }, [user]);
  const { records: stored, error } = useAttendance();
  const [period, setPeriod] = useState('week'),
    [status, setStatus] = useState(''),
    [notice, setNotice] = useState('');
  const date = localDate();
  const labels = {
    PRESENT: 'حاضر',
    LATE: 'متأخر',
    ABSENT: 'غائب',
    LEAVE: 'إجازة',
  } as const;
  const records: AttendanceRecord[] = stored
    .filter((r) => r.employeeEmail === identity?.email)
    .map((r) => ({ ...r, status: labels[r.status], note: r.notes }));
  const record = records.find((r) => r.date === date) || null;
  const tag = tagForEmail(identity?.email || '');
  const manual = () => {
    if (!identity) return;
    try {
      const next = registerAttendance(
        readAttendance(),
        identity,
        '',
        new Date(),
        'MANUAL',
      );
      saveAttendance(next.records);
      setNotice('تم حفظ التسجيل مؤقتًا');
      setPeriod('today');
      setStatus('');
    } catch {
      setNotice('تعذر حفظ الحضور محليًا');
    }
  };
  const visible = filterHistory(records, period, status, date);
  return (
    <EmployeePageShell
      title="الحضور والانصراف"
      description="متابعة حضورك اليومي، وقت الدخول والخروج، ساعات العمل، والتنبيهات الخاصة بالتأخير."
    >
      <div className={shared.stats}>
        {[
          ['حالة اليوم', record ? 'حاضر' : 'لم يسجل بعد'],
          ['وقت الحضور', record?.checkIn || '—'],
          ['وقت الانصراف', record?.checkOut || '—'],
          ['ساعات العمل اليوم', record ? duration(record) : '—'],
        ].map(([title, value]) => (
          <StatCard
            key={title}
            title={title!}
            value={value}
            icon="clock"
            hint="معاينة محلية"
          />
        ))}
      </div>
      <div className={styles.overview}>
        <AttendanceTodayCard
          date={date}
          record={record}
          onIn={manual}
          onOut={manual}
        />
        <Card>
          <h2>تنبيهات الحضور</h2>
          {records.some((r) => r.status === 'متأخر') ? (
            <p>يوجد تأخير مسجل، وقد تتم مراجعته من المدير في المرتبات.</p>
          ) : (
            <p>لا توجد تأخيرات مسجلة.</p>
          )}
          <p>لا يتم حساب خصومات في هذه المعاينة.</p>
          <p>
            السجلات تجريبية ومحفوظة في هذا المتصفح فقط، وتظهر للمدير في نفس
            المتصفح.
          </p>
        </Card>
      </div>
      <Card>
        <h2>تسجيل عبر NFC</h2>
        <p>
          قرّب هاتفك من كارت NFC الموجود على مكتبك لتسجيل الحضور أو الانصراف.
        </p>
        {tag ? (
          <>
            <p>
              <bdi>{tag.tagId}</bdi>
            </p>
            <p style={{ overflowWrap: 'anywhere' }}>
              <Link href={nfcHref(tag.tagId)}>{nfcHref(tag.tagId)}</Link>
            </p>
            <Button
              onClick={() => {
                window.location.href = nfcHref(tag.tagId);
              }}
            >
              تجربة تسجيل NFC
            </Button>
          </>
        ) : (
          <p>لا يوجد كارت حضور مرتبط بحسابك</p>
        )}
      </Card>
      {(error || identityError) && <p role="alert">{error || identityError}</p>}
      <section aria-label="سجل حضور الموظف">
        <h2>سجل الحضور</h2>
        <AttendanceFilters
          period={period}
          status={status}
          onPeriod={setPeriod}
          onStatus={setStatus}
        />
        <div className={styles.list}>
          {visible.map((item) => (
            <AttendanceHistoryCard key={item.date} record={item} />
          ))}
          {!visible.length && (
            <Card>
              {records.length
                ? 'لا توجد سجلات تطابق الفترة والحالة.'
                : 'لا توجد سجلات حضور بعد'}
            </Card>
          )}
        </div>
      </section>
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </EmployeePageShell>
  );
}
