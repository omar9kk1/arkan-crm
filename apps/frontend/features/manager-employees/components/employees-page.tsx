'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Button } from '../../../components/ui/button';
import { AddEmployeeModal } from './add-employee-modal';
import { Toast } from '../../../components/ui/toast';

import { GlassSelect } from '../../../components/ui/glass-select';

import { useCallback, useEffect, useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { SearchBar } from '../../../components/ui/search-bar';
import { matchesPerson } from '../../manager-clients/mock-data';
import { listEmployees, updateEmployeeName } from '../../../lib/api/employees-api';
import { ApiError } from '../../../lib/api-client';
import { mapEmployee, type EmployeeRecord } from '../model';
import type { Assignment } from '../assignment-trial';
import { EmployeeCard } from './employee-card';
import { EmployeeStats } from './employee-stats';
import { EmployeeDetailsDrawer } from './employee-details-drawer';
import { AssignPropertyModal } from './assign-property-modal';
import styles from './employees.module.css';
type Overlay = { kind: 'details' | 'assign'; employeeId: string };
type SortKey = 'clientsCount' | 'propertiesCount' | 'dealsCount';
export function EmployeesPage() {
  const [items, setItems] = useState<EmployeeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  const [adding, setAdding] = useDraftState(
    'ui:features/manager-employees/components/employees-page.tsx:adding',
    false,
  );
  const [justCreated, setJustCreated] = useState(false);
  const [newestId, setNewestId] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<SortKey>('clientsCount');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    listEmployees()
      .then((page) => {
        if (active) setItems(page.items.map(mapEmployee));
      })
      .catch((cause) => {
        if (!active) return;
        setError(
          cause instanceof ApiError ? cause.message : 'تعذر تحميل الموظفين.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const rename = useCallback(async (id: string, name: string) => {
    const updated = await updateEmployeeName(id, name);
    setItems((previous) =>
      previous.map((item) => (item.id === id ? mapEmployee(updated) : item)),
    );
    setNotice('تم تحديث اسم الموظف');
  }, []);

  const selected = items.find((item) => item.id === overlay?.employeeId);
  const sortValue = (employee: EmployeeRecord, key: SortKey) => {
    if (key === 'propertiesCount') return employee.propertyCount;
    return employee[key] ?? Number.NEGATIVE_INFINITY;
  };
  const visible = items
    .filter(
      (item) =>
        matchesPerson(item, query) &&
        (status === 'all' ||
          (status === 'active' ? item.active : !item.active)),
    )
    .sort((a, b) =>
      a.id === newestId
        ? -1
        : b.id === newestId
          ? 1
          : sortValue(b, sort) - sortValue(a, sort),
    );
  return (
    <ManagerPageShell
      title="الموظفين"
      actions={
        <Button
          compactOnMobile
          onClick={() => {
            setNotice('');
            setAdding(true);
          }}
        >
          إضافة موظف
        </Button>
      }
      description="متابعة أداء الموظفين، العملاء، العقارات، الصفقات، العمولات، والمتابعات المتأخرة."
    >
      <div className={styles.scope}>
        <p className={styles.muted}>
          القائمة من سجلات الخادم الفعلية • «—» تعني أن القيمة غير متوفرة من
          الخادم بعد • التخصيصات تجريبية محليًا فقط.
        </p>
        <EmployeeStats items={items} />
        <div className={styles.filters}>
          <SearchBar
            label="بحث باسم الموظف أو الهاتف"
            placeholder="ابحث باسم الموظف أو الهاتف..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className={styles.field}>
            الحالة
            <GlassSelect
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">الكل</option>
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
            </GlassSelect>
          </label>
          <label className={styles.field}>
            الأداء
            <GlassSelect
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
            >
              <option value="clientsCount">الأعلى عملاء</option>
              <option value="propertiesCount">الأعلى عقارات</option>
              <option value="dealsCount">الأعلى صفقات</option>
            </GlassSelect>
          </label>
        </div>
        <div className={styles.grid}>
          {visible.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              onDetails={() =>
                setOverlay({ kind: 'details', employeeId: employee.id })
              }
              onAssign={() => {
                setNotice('');
                setOverlay({ kind: 'assign', employeeId: employee.id });
              }}
            />
          ))}
        </div>
        {loading && <p className={styles.notice}>جارٍ تحميل الموظفين…</p>}
        {!loading && error && (
          <p className={styles.notice}>
            {error}{' '}
            <Button type="button" variant="ghost" onClick={reload}>
              إعادة المحاولة
            </Button>
          </p>
        )}
        {!loading && !error && !visible.length && (
          <p className={styles.notice}>
            {items.length
              ? 'لا يوجد موظفون مطابقون للفلاتر.'
              : 'لم يُسجّل الخادم أي موظف حتى الآن.'}
          </p>
        )}
        {overlay?.kind === 'details' && selected && (
          <EmployeeDetailsDrawer
            key={selected.id}
            employee={selected}
            assignments={assignments.filter(
              (item) => item.employeeId === selected.id,
            )}
            onRename={(name) => rename(selected.id, name)}
            onClose={() => setOverlay(null)}
          />
        )}
        {overlay?.kind === 'assign' && selected && (
          <AssignPropertyModal
            items={items}
            employeeId={selected.id}
            onClose={() => setOverlay(null)}
            onSave={(assignment) => {
              setAssignments((previous) => [
                ...previous.filter(
                  (item) =>
                    !(
                      item.employeeId === assignment.employeeId &&
                      item.propertyId === assignment.propertyId
                    ),
                ),
                assignment,
              ]);
              setOverlay(null);
              setNotice('تم تخصيص العقار للموظف (تجريبي محليًا)');
            }}
          />
        )}
        {adding && (
          <AddEmployeeModal
            existing={items}
            onClose={() => {
              setAdding(false);
              if (justCreated) {
                setJustCreated(false);
                setNotice('تم إنشاء حساب الموظف');
              }
            }}
            onCreated={(id) => {
              setJustCreated(true);
              setNewestId(id);
              reload();
            }}
          />
        )}
        <Toast message={notice} onDismiss={() => setNotice('')} />
      </div>
    </ManagerPageShell>
  );
}
