'use client';

import { useDraftState } from '../../../lib/drafts/use-form-draft';
import { Button } from '../../../components/ui/button';
import { Toast } from '../../../components/ui/toast';
import { GlassSelect } from '../../../components/ui/glass-select';
import { PropertiesSegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { SearchBar } from '../../../components/ui/search-bar';
import {
  getEmployee,
  setEmployeeActivation,
  updateEmployeeName,
} from '../../../lib/api/employees-api';
import { useAuth } from '../../auth/components/auth-provider';
import {
  mapEmployee,
  mapEmployeeListItem,
  type EmployeeRecord,
} from '../model';
import { useEmployees } from '../../../lib/use-employees';
import type { Assignment } from '../assignment-trial';
import { EmployeeCard } from './employee-card';
import { EmployeeStats } from './employee-stats';
import { OwnerManagersTab } from './owner-managers-tab';
import { AddEmployeeModal } from './add-employee-modal';
import { EmployeeDetailsDrawer } from './employee-details-drawer';
import { AssignPropertyModal } from './assign-property-modal';
import styles from './employees.module.css';

type Overlay = { kind: 'details' | 'assign'; employeeId: string };
type SortKey = 'clientsCount' | 'propertiesCount' | 'dealsCount';
type ManagementTab = 'managers' | 'employees';

export function EmployeesPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [tab, setTab] = useState<ManagementTab>('employees');
  const [adding, setAdding] = useDraftState(
    'ui:features/manager-employees/components/employees-page.tsx:adding',
    false,
  );
  const [addRole, setAddRole] = useState<'MANAGER' | 'EMPLOYEE'>('EMPLOYEE');
  const [justCreated, setJustCreated] = useState(false);
  const [newestId, setNewestId] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState<SortKey>('clientsCount');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [notice, setNotice] = useState('');
  const [overrides, setOverrides] = useState<Record<string, EmployeeRecord>>({});
  const [details, setDetails] = useState<Record<string, EmployeeRecord>>({});
  const [extra, setExtra] = useState<EmployeeRecord[]>([]);
  const [managerRefreshKey, setManagerRefreshKey] = useState(0);

  const {
    employees,
    summary,
    loading,
    loadingMore,
    error: clientsError,
    nextCursor,
    refresh,
    loadMore,
  } = useEmployees({
    search: query,
    status: status as 'all' | 'active' | 'inactive',
    sort,
  });

  useEffect(() => {
    if (isOwner) setTab('managers');
  }, [isOwner]);

  const items = useMemo(() => {
    const base = employees.map(
      (dto) => overrides[dto.id] ?? mapEmployeeListItem(dto),
    );
    return [...extra, ...base].filter(
      (employee, index, list) =>
        list.findIndex((row) => row.id === employee.id) === index,
    );
  }, [employees, overrides, extra]);

  // A just-created employee belongs to the unfiltered first view only.
  useEffect(() => {
    setExtra([]);
    setNewestId('');
  }, [query, status, sort]);

  const reload = useCallback(() => {
    refresh();
    setManagerRefreshKey((value) => value + 1);
  }, [refresh]);

  const openDetails = useCallback(async (id: string) => {
    try {
      const dto = await getEmployee(id);
      setDetails((previous) => ({ ...previous, [id]: mapEmployee(dto) }));
      setOverlay({ kind: 'details', employeeId: id });
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : 'تعذّر تحميل تفاصيل الموظف.',
      );
    }
  }, []);

  const refreshDetail = useCallback(async (id: string) => {
    try {
      const dto = await getEmployee(id);
      setDetails((previous) => ({ ...previous, [id]: mapEmployee(dto) }));
    } catch {
      // Keep the last authorized detail on a transient refresh failure.
    }
  }, []);

  const applyUpdated = useCallback((updated: Parameters<typeof mapEmployee>[0]) => {
    const mapped = mapEmployee(updated);
    setOverrides((previous) => ({ ...previous, [mapped.id]: mapped }));
    setDetails((previous) =>
      previous[mapped.id] ? { ...previous, [mapped.id]: mapped } : previous,
    );
    setExtra((previous) =>
      previous.map((employee) =>
        employee.id === mapped.id ? mapped : employee,
      ),
    );
  }, []);

  const rename = useCallback(
    async (id: string, name: string) => {
      const updated = await updateEmployeeName(id, name);
      applyUpdated(updated);
      setNotice('تم تحديث اسم الموظف.');
    },
    [applyUpdated],
  );

  const changeActivation = useCallback(
    async (id: string, isActive: boolean) => {
      const updated = await setEmployeeActivation(id, isActive);
      applyUpdated(updated);
      refresh();
      setNotice(
        isActive ? 'تم تفعيل حساب الموظف' : 'تم تعطيل حساب الموظف',
      );
    },
    [applyUpdated, refresh],
  );

  const openCreate = (role: 'MANAGER' | 'EMPLOYEE') => {
    setNotice('');
    setAddRole(role);
    setAdding(true);
  };

  const selected = overlay
    ? (details[overlay.employeeId] ??
      items.find((item) => item.id === overlay.employeeId))
    : undefined;
  // The backend applies the global sort; only a just-created row is pinned.
  const visible = newestId
    ? [...items].sort((a, b) =>
        a.id === newestId ? -1 : b.id === newestId ? 1 : 0,
      )
    : items;

  const employeesTab = (
    <>
      <EmployeeStats items={items} summary={summary} />
      <div className={styles.filters}>
        <SearchBar
          label="البحث في الموظفين أو المهام"
          placeholder="ابحث باسم الموظف أو البريد..."
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
            onDetails={() => void openDetails(employee.id)}
            onAssign={
              isOwner
                ? () => {
                    setNotice('');
                    setOverlay({
                      kind: 'assign',
                      employeeId: employee.id,
                    });
                  }
                : undefined
            }
          />
        ))}
      </div>
      {loading && <p className={styles.notice}>جارٍ تحميل الموظفين…</p>}
      {!loading && clientsError && (
        <p className={styles.notice}>
          {clientsError}{' '}
          <Button type="button" variant="ghost" onClick={reload}>
            حاول مرة أخرى
          </Button>
        </p>
      )}
      {!loading && !clientsError && !visible.length && (
        <p className={styles.notice}>
          {summary?.total
            ? 'لا يوجد موظفون يطابقون البحث.'
            : 'لا يوجد موظفون في القائمة.'}
        </p>
      )}
      {nextCursor && !loading && (
        <p className={styles.notice}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            aria-busy={loadingMore}
          >
            {loadingMore ? 'جارٍ التحميل…' : 'تحميل المزيد'}
          </Button>
        </p>
      )}
    </>
  );

  return (
    <ManagerPageShell
      title={isOwner ? 'المديرين والموظفين' : 'الموظفين'}
      actions={
        isOwner ? (
          <Button
            compactOnMobile
            onClick={() =>
              openCreate(tab === 'managers' ? 'MANAGER' : 'EMPLOYEE')
            }
          >
            {tab === 'managers' ? 'إضافة مدير' : 'إضافة موظف'}
          </Button>
        ) : null
      }
      description={
        isOwner
          ? 'إدارة حسابات المديرين والموظفين، تعيين الفرق، ومنح صلاحيات المراجعة.'
          : 'متابعة أداء الموظفين، العملاء، العقارات، الصفقات، العمولات، والمتابعات المتأخرة.'
      }
    >
      <div className={styles.scope}>
        {isOwner ? (
          <>
            <div className={styles.tabs}>
              <PropertiesSegmentedTabs
                id="owner-management-tabs"
                label="أقسام إدارة الحسابات"
                items={[
                  { id: 'managers', label: 'المديرين' },
                  { id: 'employees', label: 'الموظفين' },
                ]}
                value={tab}
                onChange={(value) =>
                  setTab(value as ManagementTab)
                }
              />
            </div>
            {tab === 'managers' ? (
              <OwnerManagersTab
                refreshKey={managerRefreshKey}
                onChanged={reload}
                onCreateManager={() => openCreate('MANAGER')}
              />
            ) : (
              employeesTab
            )}
          </>
        ) : (
          employeesTab
        )}

        {overlay?.kind === 'details' && selected && (
          <EmployeeDetailsDrawer
            key={selected.id}
            employee={selected}
            assignments={assignments.filter(
              (item) => item.employeeId === selected.id,
            )}
            onRename={(name) => rename(selected.id, name)}
            onToggleActivation={(isActive) =>
              changeActivation(selected.id, isActive)
            }
            canManage={isOwner}
            onManagerChanged={() => {
              reload();
              void refreshDetail(selected.id);
            }}
            onClose={() => setOverlay(null)}
          />
        )}
        {overlay?.kind === 'assign' && selected && isOwner && (
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
              setNotice('تم تخصيص العقار (تخصيص تجريبي محلي)');
            }}
          />
        )}
        {adding && isOwner && (
          <AddEmployeeModal
            existing={items}
            defaultRole={addRole}
            onClose={() => {
              setAdding(false);
              if (justCreated) {
                setJustCreated(false);
                setNotice(
                  addRole === 'MANAGER'
                    ? 'تم إنشاء حساب المدير'
                    : 'تم إنشاء حساب الموظف',
                );
              }
            }}
            onCreated={(id) => {
              setJustCreated(true);
              setNewestId(id);
              void getEmployee(id)
                .then((dto) => {
                  const mapped = mapEmployee(dto);
                  setExtra((previous) => [
                    mapped,
                    ...previous.filter((item) => item.id !== id),
                  ]);
                })
                .catch(() => undefined);
              reload();
            }}
          />
        )}
        <Toast message={notice} onDismiss={() => setNotice('')} />
      </div>
    </ManagerPageShell>
  );
}
