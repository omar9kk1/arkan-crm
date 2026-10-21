'use client';

import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import {
  currentPushStatus,
  disablePush,
  enablePush,
  fetchPushTest,
  type PushStatus,
} from '../../notifications/push';
import styles from './settings.module.css';

/**
 * The manager's "إشعارات خارج البرنامج" switch.
 *
 * It is scoped to THIS device: switching it ON subscribes this browser and
 * binds the subscription to the signed-in manager and the current session,
 * switching it OFF removes exactly this browser's subscription. The in-app
 * notifications (the bell) are never affected by this switch.
 */
export function PushNotificationToggle() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    let active = true;
    void currentPushStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        if (active)
          setStatus({ supported: false, enabled: false, permission: 'unsupported' });
      });
    return () => {
      active = false;
    };
  }, []);

  const change = async (next: boolean) => {
    setBusy(true);
    setNotice('');
    try {
      if (next) {
        const result = await enablePush();
        if (!result.enabled) setNotice(result.error ?? 'تعذر تفعيل الإشعارات.');
        setStatus((current) => ({
          supported: current?.supported ?? true,
          enabled: result.enabled,
          permission: current?.permission ?? 'granted',
        }));
      } else {
        await disablePush();
        setStatus((current) => ({
          supported: current?.supported ?? true,
          enabled: false,
          permission: current?.permission ?? 'granted',
        }));
      }
    } finally {
      setBusy(false);
    }
  };

  const supported = status?.supported ?? true;

  /** Sends one test message to this device — the proof that push works. */
  const sendTest = async () => {
    setTesting(true);
    setNotice('');
    try {
      const response = await fetchPushTest();
      if (response.sent > 0) {
        setNotice(`أُرسلت رسالة تجريبية إلى ${response.sent} جهاز.`);
      } else {
        setNotice(
          'لا يوجد جهاز مشترك في هذا المتصفح — فعّل الإشعارات أولًا.',
        );
      }
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : 'تعذر إرسال الرسالة التجريبية.',
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          role="switch"
          checked={status?.enabled ?? false}
          disabled={!supported || busy}
          onChange={(event) => void change(event.target.checked)}
        />
        <span>إشعارات خارج البرنامج</span>
      </label>
      <p className={styles.note}>
        يعمل على هذا الجهاز فقط؛ بقية أجهزتك غير متأثرة. إشعارات البرنامج
        الداخلية تبقى مفعّلة دائمًا.
      </p>
      {!supported && (
        <p className={styles.note}>
          هذا المتصفح لا يدعم الإشعارات الخارجية.
        </p>
      )}
      {status?.permission === 'denied' && (
        <p className={styles.note}>
          الإذن مرفوض في إعدادات المتصفح — فعّله من إعدادات الموقع ثم أعد
          المحاولة.
        </p>
      )}
      {supported && (
        <Button
          onClick={() => void sendTest()}
          disabled={testing || busy}
          aria-busy={testing}
        >
          {testing ? 'جارٍ الإرسال…' : 'إرسال إشعار تجريبي'}
        </Button>
      )}
      {notice && <p className={styles.note}>{notice}</p>}
    </div>
  );
}
