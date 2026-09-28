'use client';
import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { GlassSelect } from '../../../components/ui/glass-select';
import { SettingsSectionCard } from './settings-section-card';
import { SettingsField } from './settings-field';
import { SettingsToggle } from './settings-toggle';
import { SettingsPermissionList } from './settings-permission-list';
import styles from './settings.module.css';
export function SettingsPage() {
  const [notice, setNotice] = useState(0);
  const save = () => setNotice((previous) => previous + 1);
  return (
    <ManagerPageShell
      title="الإعدادات"
      description="إدارة إعدادات النظام الأساسية، بيانات الشركة، قواعد المتابعة، الصلاحيات، والتنبيهات."
    >
      <p className={styles.banner}>
        هذه الإعدادات تجريبية حاليًا، وسيتم ربطها بالنظام في مرحلة الـ APIs.
      </p>
      <div className={styles.grid}>
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
        <SettingsSectionCard title="إعدادات المتابعات" onSave={save}>
          {[
            ['متابعة المالك كل (أيام)', 3],
            ['متابعة العميل بعد (أيام)', 5],
            ['تنبيه طلب بدون عقار مناسب بعد (أيام)', 10],
            ['انتهاء أولوية العمولة بعد (أيام)', 60],
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
        </SettingsSectionCard>
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
        <SettingsSectionCard title="إعدادات التنبيهات" onSave={save}>
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
      </div>
      <Toast
        message={notice ? 'تم حفظ الإعدادات مؤقتًا' : ''}
        eventKey={notice}
        onDismiss={() => setNotice(0)}
      />
    </ManagerPageShell>
  );
}
