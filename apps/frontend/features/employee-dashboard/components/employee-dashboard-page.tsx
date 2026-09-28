'use client';
import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { alerts, clients, properties, followups } from '../preview-data';
import {
  EmployeeStatCard,
  FollowUpCard,
  EmployeePropertyCard,
  ClientMiniCard,
} from './dashboard-cards';
import styles from './employee-dashboard.module.css';
export function EmployeeDashboardPage() {
  const [detail, setDetail] = useState<{
    title: string;
    lines: string[];
  } | null>(null);
  const [notice, setNotice] = useState('');
  return (
    <EmployeePageShell>
      <p className={styles.note}>
        معاينة ببيانات واسم موظف تجريبيين، دون ربط ببيانات الحساب.
      </p>
      <div className={styles.stats}>
        {[
          ['العملاء المسؤول عنهم', 12],
          ['العقارات المخصصة له', 7],
          ['المتابعات القادمة', 5],
          ['المتابعات المتأخرة', 2],
        ].map(([title, value]) => (
          <EmployeeStatCard
            key={title}
            title={String(title)}
            value={Number(value)}
          />
        ))}
      </div>
      <div className={styles.sections}>
        <section>
          <h2>المتابعات القادمة</h2>
          <div className={styles.list}>
            {followups.map((item) => (
              <FollowUpCard
                key={item.name}
                item={item}
                onOpen={() =>
                  setDetail({
                    title: `متابعة ${item.name}`,
                    lines: [
                      item.type,
                      item.time,
                      `الحالة: ${item.status}`,
                      'الإجراء المقترح: التواصل وتحديث نتيجة المتابعة لاحقًا.',
                    ],
                  })
                }
              />
            ))}
          </div>
        </section>
        <section>
          <h2>العقارات المناسبة لعملائك</h2>
          <div className={styles.properties}>
            {properties.map((item) => (
              <EmployeePropertyCard
                key={item.name}
                item={item}
                onOpen={() =>
                  setDetail({
                    title: item.name,
                    lines: [
                      item.area,
                      item.price,
                      item.status,
                      'مطابقة تجريبية لطلب عميل؛ التفاصيل والتواصل متاحان لاحقًا.',
                    ],
                  })
                }
              />
            ))}
          </div>
        </section>
        <section>
          <h2>العملاء المهمين</h2>
          <div className={styles.list}>
            {clients.map((item) => (
              <ClientMiniCard key={item.name} item={item} />
            ))}
          </div>
        </section>
        <section>
          <h2>تنبيهات الموظف</h2>
          <div className={styles.list}>
            {alerts.map((alert) => (
              <Card key={alert}>
                <p>{alert}</p>
                <Button
                  compactOnMobile
                  onClick={() =>
                    setNotice('تمت معاينة التنبيه — لا يوجد إجراء محفوظ')
                  }
                >
                  عرض التنبيه
                </Button>
              </Card>
            ))}
          </div>
        </section>
      </div>
      {detail && (
        <PropertyOverlay
          title={detail.title}
          drawer
          onClose={() => {
            setDetail(null);
            setNotice('');
          }}
        >
          <div className={styles.list}>
            {detail.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <Button
            onClick={() => setNotice('معاينة فقط — سيتم تفعيل الإجراء لاحقًا')}
          >
            متابعة
          </Button>
          <Toast message={notice} onDismiss={() => setNotice('')} />
        </PropertyOverlay>
      )}
      {!detail && <Toast message={notice} onDismiss={() => setNotice('')} />}
    </EmployeePageShell>
  );
}
