'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { attendanceIdentity } from '../mock-identity';
import { useAuth } from '../../auth/components/auth-provider';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { Card } from '../../../components/ui/card';
import {
  readAttendance,
  registerAttendance,
  saveAttendance,
} from '../nfc-store';
export function NfcPage() {
  const { user } = useAuth();
  const ran = useRef(false);
  const [result, setResult] = useState<{
    message: string;
    time?: string;
    success?: boolean;
    name?: string;
  }>({ message: 'جاري التحقق من كارت الحضور...' });
  useEffect(() => {
    if (!user || ran.current) return;
    ran.current = true;
    try {
      const identity = attendanceIdentity(user);
      const tag = new URLSearchParams(window.location.search).get('tag') || '';
      const marker = `nfc:${identity.email}:${tag}`;
      // History entry marker survives refresh; a new navigation is a new scan.
      if (window.history.state?.arkanNfc?.marker === marker) {
        setResult(window.history.state.arkanNfc.result);
        return;
      }
      const next = registerAttendance(readAttendance(), identity, tag);
      if (next.action !== 'COMPLETED') saveAttendance(next.records);
      const outcome = {
        message:
          next.action === 'CHECK_IN'
            ? 'تم تسجيل الحضور بنجاح'
            : next.action === 'CHECK_OUT'
              ? 'تم تسجيل الانصراف بنجاح'
              : 'تم تسجيل حضور وانصراف اليوم بالفعل',
        time:
          next.action === 'CHECK_IN'
            ? next.record.checkIn
            : next.record.checkOut,
        success: true,
        name: identity.name,
      };
      window.history.replaceState(
        { ...window.history.state, arkanNfc: { marker, result: outcome } },
        '',
      );
      setResult(outcome);
    } catch (e) {
      setResult({
        message:
          e instanceof Error &&
          (e.message.startsWith('كارت') ||
            e.message.startsWith('هذا الكارت') ||
            e.message.startsWith('سجّل الدخول'))
            ? e.message
            : 'تعذر حفظ الحضور محليًا. تحقق من سماح المتصفح بالتخزين ثم حاول مجددًا.',
      });
    }
  }, [user]);
  return (
    <EmployeePageShell
      title="تسجيل عبر NFC"
      description="تسجيل حضور وانصراف تجريبي"
    >
      <Card>
        <div role="status">
          {result.success && <h2>أهلًا {result.name}</h2>}
          <p>{result.message}</p>
          {result.time && <p dir="ltr">{result.time}</p>}
        </div>
        <Link href="/employee/attendance">العودة إلى سجل الحضور</Link>
      </Card>
    </EmployeePageShell>
  );
}
