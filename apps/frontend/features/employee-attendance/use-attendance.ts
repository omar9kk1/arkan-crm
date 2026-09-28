'use client';
import { useEffect, useState } from 'react';
import { readAttendance, type MockAttendance } from './nfc-store';
export function useAttendance() {
  const [records, setRecords] = useState<MockAttendance[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const load = () => {
      try {
        setRecords(readAttendance());
        setError('');
      } catch {
        setError(
          'تعذر قراءة سجل الحضور المحلي. تحقق من سماح المتصفح بالتخزين.',
        );
      }
    };
    load();
    window.addEventListener('storage', load);
    window.addEventListener('arkan:attendance-updated', load);
    window.addEventListener('focus', load);
    return () => {
      window.removeEventListener('storage', load);
      window.removeEventListener('arkan:attendance-updated', load);
      window.removeEventListener('focus', load);
    };
  }, []);
  return { records, error };
}
