'use client';
import { useEffect, useState } from 'react';
import { Toast } from '../../components/ui/toast';
import { useDraftScope } from './use-form-draft';
const notified = new Set<string>();
// Kept at existing mount points: no buttons or in-form layout are rendered.
export function DraftTools({ formKey }: { formKey: string }) {
  const { restored, prefix } = useDraftScope(formKey);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!restored || !prefix || notified.has(prefix)) return;
    notified.add(prefix);
    setMessage('تم استعادة البيانات غير المحفوظة');
  }, [restored, prefix]);
  return <Toast message={message} onDismiss={() => setMessage('')} />;
}
