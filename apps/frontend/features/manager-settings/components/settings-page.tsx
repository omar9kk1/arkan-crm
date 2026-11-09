'use client';
import { Toast } from '../../../components/ui/toast';

import { useEffect, useReducer, useRef, useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { GlassSelect } from '../../../components/ui/glass-select';
import { SettingsSectionCard } from './settings-section-card';
import { SettingsField } from './settings-field';
import { SettingsToggle } from './settings-toggle';
import { SettingsPermissionList } from './settings-permission-list';
import { PushNotificationToggle } from './push-notification-toggle';
import styles from './settings.module.css';
import { authorizedRequest } from '../../../lib/api/authorized';
import { useAuth } from '../../auth/components/auth-provider';
import {
  NOTIFICATION_PREFERENCE_ERROR,
  NOTIFICATION_PREFERENCE_PATH,
  NOTIFICATION_PREFERENCE_SAVED,
  NOTIFICATION_PREFERENCE_SAVING,
  initialNotificationPreferenceState,
  notificationPreferenceCanSave,
  notificationPreferenceReducer,
  saveNotificationPreference,
  type NotificationPreferenceResponse,
} from '../notification-preference-model';

export function SettingsPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [notice, setNotice] = useState({ message: '', key: 0 });
  const notify = (message: string) =>
    setNotice((previous) => ({ message, key: previous.key + 1 }));
  const save = () => notify('تم حفظ الإعدادات مؤقتًا');
  const [followUp, dispatchFollowUp] = useReducer(
    notificationPreferenceReducer,
    initialNotificationPreferenceState,
  );
  const [followUpLoading, setFollowUpLoading] = useState(true);
  const followUpSavingRef = useRef(false);

  useEffect(() => {
    let active = true;
    void authorizedRequest<NotificationPreferenceResponse>(
      NOTIFICATION_PREFERENCE_PATH,
    )
      .then((res) => {
        if (active)
          dispatchFollowUp({
            type: 'loaded',
            enabled: res.notifyEmployeeFollowUps,
          });
      })
      .catch(() => {
        if (active) dispatchFollowUp({ type: 'loaded', enabled: false });
      })
      .finally(() => {
        if (active) setFollowUpLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleFollowUpNotify = async (enabled: boolean) => {
    // Ignore rapid repeats: the switch is disabled while saving, and this
    // synchronous ref also covers two clicks landing in the same tick.
    if (
      followUpSavingRef.current ||
      !notificationPreferenceCanSave(followUp, enabled)
    )
      return;
    followUpSavingRef.current = true;
    dispatchFollowUp({ type: 'toggle', enabled });
    try {
      const saved = await saveNotificationPreference(
        (path, options) =>
          authorizedRequest<NotificationPreferenceResponse>(path, options),
        enabled,
      );
      dispatchFollowUp({ type: 'saved', enabled: saved });
      notify(NOTIFICATION_PREFERENCE_SAVED);
    } catch {
      dispatchFollowUp({ type: 'failed' });
      notify(NOTIFICATION_PREFERENCE_ERROR);
    } finally {
      followUpSavingRef.current = false;
    }
  };

  return (
    <ManagerPageShell
      title="الإعدادات"
      description={
        isOwner
          ? 'إدارة إعدادات النظام الأساسية، بيانات الشركة، قواعد المتابعة، الصلاحيات، والتنبيهات.'
          : 'عرض إعدادات المتابعة والتنبيهات الشخصية؛ أما بيانات الشركة والحضور والصلاحيات فمتاحة لمالك النظام فقط.'
      }
    >
      <p className={styles.banner}>
        {isOwner
          ? 'هذه الإعدادات تجريبية حاليًا، وسيتم ربطها بالنظام في مرحلة الـ APIs.'
          : 'يمكنك عرض إعدادات المتابعة فقط، بينما تبقى بيانات الشركة والحضور والصلاحيات وإعدادات الصفقات لدى مالك النظام.'}
      </p>
      <div className={styles.grid}>
        {isOwner ? (
        <SettingsSectionCard title="بيانات الشركة" onSave={save}>
          <SettingsField
            label="اسم الشركة"
            defaultValue="أركان الخليج العقارية"
            required
            maxLength={150}
          />
          <SettingsField
            label="رقم الهاتف"
            type="tel"
            placeholder="رقم هاتف الشركة"
            maxLength={30}
          />
          <SettingsField
            label="البريد الإلكتروني"
            type="email"
            placeholder="company@example.com"
            maxLength={150}
          />
          <SettingsField
            label="العنوان"
            placeholder="عنوان الشركة"
            maxLength={250}
          />
          <div className={styles.logo} aria-label="مكان شعار الشركة">
            شعار الشركة <small>مكان مخصص للشعار — رفع الملفات لاحقًا</small>
          </div>
        </SettingsSectionCard>
        ) : null}
        <SettingsSectionCard
          title="إعدادات المتابعات"
          onSave={isOwner ? save : undefined}
          readOnly={!isOwner}
        >
          {[
            ['متابعة المالك كل (أيام)', 3],
            ['متابعة العميل بعد (أيام)', 5],
            ['تنبيه طلب بدون عقار مناسب بعد (أيام)', 10],
            ['انتهاء أولوية العمولة بعد (أيام)', 60],
            ['مدة أولوية العقار (بالأيام)', 60],
          ].map(([label, value]) => (
            <SettingsField
              key={label}
              label={String(label)}
              type="number"
              min={1}
              step={1}
              required
              defaultValue={value}
            />
          ))}
          {!isOwner ? (
            <p className={styles.note}>
              إعدادات المتابعة للعرض فقط. تعديلها متاح لمالك النظام.
            </p>
          ) : null}
        </SettingsSectionCard>
        {isOwner ? (
        <SettingsSectionCard title="إعدادات الصفقات والعمولات" onSave={save}>
          <SettingsField label="العملة الافتراضية">
            <GlassSelect defaultValue="KWD" aria-label="العملة الافتراضية">
              <option value="KWD">د.ك — دينار كويتي</option>
            </GlassSelect>
          </SettingsField>
          <SettingsToggle label="تفعيل مراجعة عمولات الموظفين" defaultChecked />
          <SettingsToggle
            label="السماح بتوزيع العمولة على أكثر من موظف"
            defaultChecked
          />
          <p className={styles.note}>في MVP المدير فقط هو من يسجل الصفقات.</p>
        </SettingsSectionCard>
        ) : null}
        {isOwner ? (
        <>
        <SettingsSectionCard title="إعدادات الحضور والانصراف" onSave={save}>
          <SettingsField
            label="وقت بداية الدوام"
            type="time"
            defaultValue="09:00"
            required
          />
          <SettingsField
            label="وقت نهاية الدوام"
            type="time"
            defaultValue="17:00"
            required
          />
          <SettingsField
            label="سماحية التأخير بالدقائق"
            type="number"
            defaultValue={15}
            min={0}
            step={1}
            required
          />
          <SettingsToggle label="ربط التأخير بالرواتب — متاح لاحقًا" disabled />
        </SettingsSectionCard>
        <SettingsSectionCard title="الصلاحيات">
          <SettingsPermissionList />
        </SettingsSectionCard>
        </>
        ) : null}
        <SettingsSectionCard title="إعدادات التنبيهات">
          <SettingsToggle
            label="تفعيل إشعارات المتابعة"
            description="استقبال إشعار عند تسجيل الموظفين متابعات جديدة مع الملاك والعملاء."
            checked={followUp.visible}
            disabled={followUpLoading || followUp.saving}
            busy={followUp.saving}
            onChange={(checked) => void toggleFollowUpNotify(checked)}
          />
          {followUp.saving ? (
            <p className={styles.note} role="status" aria-live="polite">
              {NOTIFICATION_PREFERENCE_SAVING}
            </p>
          ) : null}
          {[
            'تنبيه العقارات الجديدة',
            'تنبيه المتابعات المتأخرة',
            'تنبيه الصفقات',
            'تنبيه الحضور المتأخر',
            'تنبيه الرواتب والمصاريف',
          ].map((label) => (
            <SettingsToggle key={label} label={label} defaultChecked />
          ))}
        </SettingsSectionCard>
        <SettingsSectionCard title="الإشعارات الخارجية">
          <PushNotificationToggle />
        </SettingsSectionCard>
      </div>
      <Toast
        message={notice.message}
        eventKey={notice.key}
        onDismiss={() =>
          setNotice((previous) => ({ ...previous, message: '' }))
        }
      />
    </ManagerPageShell>
  );
}
