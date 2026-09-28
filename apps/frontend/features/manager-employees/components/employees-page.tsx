'use client';
import { useDraftState } from '../../../lib/drafts/use-form-draft';

import { Button } from '../../../components/ui/button';
import { AddEmployeeModal } from './add-employee-modal';
import { Toast } from '../../../components/ui/toast';

import { GlassSelect } from '../../../components/ui/glass-select';

import { useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { SearchBar } from '../../../components/ui/search-bar';
import { matchesPerson } from '../../manager-clients/mock-data';
import { employees, initialAssignments } from '../mock-data';
import { EmployeeCard } from './employee-card';
import { EmployeeStats } from './employee-stats';
import { EmployeeDetailsDrawer } from './employee-details-drawer';
import { AssignPropertyModal } from './assign-property-modal';
import styles from './employees.module.css';
type Overlay = { kind: 'details' | 'assign'; employeeId: string };
type SortKey = 'clientsCount' | 'propertiesCount' | 'dealsCount';
export function EmployeesPage() {
  const [items, setItems] = useState([...employees]);
  const [adding, setAdding] = useDraftState(
    'ui:features/manager-employees/components/employees-page.tsx:adding',
    false,
  );
  const [newestId, setNewestId] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<SortKey>('clientsCount');
  const [assignments, setAssignments] = useState(initialAssignments);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [notice, setNotice] = useState('');
  const selected = items.find((item) => item.id === overlay?.employeeId);
  const visible = items
    .filter(
      (item) =>
        matchesPerson(item, query) &&
        (status === 'all' ||
          (status === 'active' ? item.active : !item.active)),
    )
    .sort((a, b) =>
      a.id === newestId ? -1 : b.id === newestId ? 1 : b[sort] - a[sort],
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
          بيانات تجريبية فقط • التخصيصات مؤقتة وتختفي عند تحديث الصفحة.
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
              assignedCount={
                assignments.filter((item) => item.employeeId === employee.id)
                  .length
              }
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
        {!visible.length && (
          <p className={styles.notice}>لا يوجد موظفون مطابقون للفلاتر.</p>
        )}
        {overlay?.kind === 'details' && selected && (
          <EmployeeDetailsDrawer
            key={selected.id}
            employee={selected}
            assignments={assignments.filter(
              (item) => item.employeeId === selected.id,
            )}
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
              setNotice('تم تخصيص العقار للموظف');
            }}
          />
        )}
        {adding && (
          <AddEmployeeModal
            existing={items}
            onClose={() => setAdding(false)}
            onSave={(employee) => {
              setAdding(false);
              setItems((previous) => [employee, ...previous]);
              setNewestId(employee.id);
              setQuery('');
              setStatus('all');
              setNotice('تم إضافة الموظف مؤقتًا');
            }}
          />
        )}
        <Toast message={notice} onDismiss={() => setNotice('')} />
      </div>
    </ManagerPageShell>
  );
}
