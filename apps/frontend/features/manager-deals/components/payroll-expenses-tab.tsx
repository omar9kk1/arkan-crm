'use client';
import { Toast } from '../../../components/ui/toast';

import { GlassSelect } from '../../../components/ui/glass-select';

import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { StatCard } from '../../../components/ui/stat-card';
import { SectionHeader } from '../../../components/ui/section-header';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { employees, money } from '../mock-data';
import styles from './deals.module.css';
const salaries = [
  { name: 'أحمد محمد', base: 1200, bonus: 50, deduction: 0, status: 'مدفوع' },
  { name: 'سارة أحمد', base: 1300, bonus: 100, deduction: 0, status: 'مدفوع' },
  {
    name: 'خالد مبارك',
    base: 1200,
    bonus: 0,
    deduction: 75,
    status: 'قيد المراجعة',
  },
];
export function PayrollExpensesTab() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const totals = salaries.reduce(
    (sum, row) => ({
      base: sum.base + row.base,
      bonus: sum.bonus + row.bonus,
      deduction: sum.deduction + row.deduction,
    }),
    { base: 0, bonus: 0, deduction: 0 },
  );
  return (
    <>
      <SectionHeader
        title="المرتبات كمصاريف"
        description="معاينة رواتب سبتمبر 2026 كمصروف إداري للشركة."
      >
        <Button onClick={() => setOpen(true)}>تسجيل راتب</Button>
      </SectionHeader>
      <div className={styles.stats}>
        {[
          { title: 'إجمالي الرواتب', value: totals.base },
          { title: 'المكافآت', value: totals.bonus },
          { title: 'الخصومات', value: totals.deduction },
          {
            title: 'صافي المصروف',
            value: totals.base + totals.bonus - totals.deduction,
          },
        ].map((item) => (
          <StatCard
            key={item.title}
            title={item.title}
            value={money(item.value)}
            icon="wallet"
            hint="بيانات تجريبية"
          />
        ))}
      </div>
      <div className={styles.cards}>
        {salaries.map((row) => (
          <Card key={row.name}>
            <div className={styles.row}>
              <h3>{row.name}</h3>
              <span className={styles.badge}>{row.status}</span>
            </div>
            <strong>{money(row.base + row.bonus - row.deduction)}</strong>
            <p>
              أساسي {money(row.base)} · مكافأة {money(row.bonus)} · خصم{' '}
              {money(row.deduction)}
            </p>
          </Card>
        ))}
      </div>
      <Toast message={notice} onDismiss={() => setNotice('')} />
      {open && (
        <PropertyOverlay
          title="تسجيل راتب — معاينة"
          onClose={() => setOpen(false)}
        >
          <p>هذا النموذج للتجربة فقط ولا يسجل مصروفًا حقيقيًا.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setOpen(false);
              setNotice('تمت معاينة تسجيل الراتب فقط، ولم يتم حفظ أي مصروف.');
            }}
          >
            <label className={styles.field}>
              الموظف
              <GlassSelect required defaultValue="">
                <option value="">اختر الموظف</option>
                {employees.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </GlassSelect>
            </label>
            <label className={styles.field}>
              الراتب الأساسي (د.ك)
              <input
                type="number"
                min="0.001"
                max="1000000"
                step="0.001"
                required
              />
            </label>
            <label className={styles.field}>
              شهر الراتب
              <input type="month" required defaultValue="2026-09" />
            </label>
            <Button type="submit">معاينة تسجيل الراتب</Button>
          </form>
        </PropertyOverlay>
      )}
    </>
  );
}
