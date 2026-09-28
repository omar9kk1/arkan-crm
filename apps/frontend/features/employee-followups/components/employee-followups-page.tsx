'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Toast } from '../../../components/ui/toast';

import { useState } from 'react';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { StatCard } from '../../../components/ui/stat-card';
import { GlassSelect } from '../../../components/ui/glass-select';
import { SearchBar } from '../../../components/ui/search-bar';
import {
  createSamples,
  filterItems,
  state,
  localDate,
  type Filters,
} from '../model';
import { FollowupCard } from './followup-card';
import { FollowupDetailsDrawer } from './followup-details-drawer';
import { AddFollowupModal } from './add-followup-modal';
import { FollowupResultModal } from './followup-result-modal';
import common from '../../employee-clients/components/clients.module.css';
import styles from './followups.module.css';
const initial: Filters = { period: 'all', kind: '', status: '', query: '' };
export function EmployeeFollowupsPage() {
  const [items, setItems] = useState(createSamples),
    [filters, setFilters] = useState(initial),
    [view, setView] = useDraftState<{
      kind: 'detail' | 'result';
      id: string;
      snapshot?: import('../model').Followup;
    } | null>(
      'ui:features/employee-followups/components/employee-followups-page.tsx:view',
      null,
    ),
    [adding, setAdding] = useDraftState(
      'ui:features/employee-followups/components/employee-followups-page.tsx:adding',
      false,
    ),
    [notice, setNotice] = useState('');
  const selected = items.find((i) => i.id === view?.id) || view?.snapshot;
  return (
    <EmployeePageShell
      title="المتابعات"
      description="متابعة العملاء والملاك، تسجيل نتائج التواصل، ومعرفة المتابعات القادمة والمتأخرة."
      actions={<Button onClick={() => setAdding(true)}>إضافة متابعة</Button>}
    >
      <p className={common.muted}>
        بيانات تجريبية مستقلة. فلاتر الفترة تعتمد على موعد المتابعة، والحالة
        تعتمد على وقت الجهاز.
      </p>
      <div className={common.stats}>
        {[
          [
            'متابعات اليوم',
            items.filter((i) => i.due.slice(0, 10) === localDate()).length,
          ],
          ['متابعات قادمة', items.filter((i) => state(i) === 'قادمة').length],
          ['متابعات متأخرة', items.filter((i) => state(i) === 'متأخرة').length],
          ['متابعات مكتملة', items.filter((i) => i.complete).length],
        ].map(([title, value]) => (
          <StatCard
            key={title}
            title={String(title)}
            value={value}
            icon="clock"
            hint="ضمن العينة التجريبية"
          />
        ))}
      </div>
      <div className={styles.filters}>
        <label className={common.field}>
          الفترة
          <GlassSelect
            value={filters.period}
            onChange={(e) => setFilters({ ...filters, period: e.target.value })}
          >
            {[
              ['today', 'اليوم'],
              ['week', 'آخر 7 أيام'],
              ['month', 'الشهر الحالي'],
              ['all', 'كل الوقت'],
            ].map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </GlassSelect>
        </label>
        <label className={common.field}>
          النوع
          <GlassSelect
            value={filters.kind}
            onChange={(e) => setFilters({ ...filters, kind: e.target.value })}
          >
            <option value="">الكل</option>
            {['عميل', 'مالك', 'عقار'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </GlassSelect>
        </label>
        <label className={common.field}>
          الحالة
          <GlassSelect
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          >
            <option value="">الكل</option>
            {['قادمة', 'متأخرة', 'مكتملة'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </GlassSelect>
        </label>
        <SearchBar
          label="بحث المتابعات"
          placeholder="ابحث باسم العميل أو المالك أو كود العقار..."
          value={filters.query}
          onChange={(e) => setFilters({ ...filters, query: e.target.value })}
        />
      </div>
      <div className={styles.timeline}>
        {filterItems(items, filters).map((item) => (
          <FollowupCard
            key={item.id}
            item={item}
            onOpen={() =>
              setView({ kind: 'detail', id: item.id, snapshot: item })
            }
            onResult={() =>
              setView({ kind: 'result', id: item.id, snapshot: item })
            }
          />
        ))}
        {!filterItems(items, filters).length && (
          <Card>لا توجد متابعات تطابق الفلاتر.</Card>
        )}
      </div>
      {selected && view?.kind === 'detail' && (
        <FollowupDetailsDrawer
          item={selected}
          onClose={() => setView(null)}
          onResult={() =>
            setView({ kind: 'result', id: selected.id, snapshot: selected })
          }
        />
      )}{' '}
      {selected && view?.kind === 'result' && (
        <FollowupResultModal
          item={selected}
          onClose={() =>
            setView({ kind: 'detail', id: selected.id, snapshot: selected })
          }
          onSave={(updated) => {
            setItems((previous) =>
              previous.map((i) => (i.id === updated.id ? updated : i)),
            );
            setView(null);
            setFilters(initial);
            setNotice('تم تسجيل نتيجة المتابعة مؤقتًا');
          }}
        />
      )}
      {adding && (
        <AddFollowupModal
          onClose={() => setAdding(false)}
          onSave={(item) => {
            setItems((previous) => [item, ...previous]);
            setAdding(false);
            setFilters(initial);
            setNotice('تم إضافة المتابعة مؤقتًا');
          }}
        />
      )}
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </EmployeePageShell>
  );
}
