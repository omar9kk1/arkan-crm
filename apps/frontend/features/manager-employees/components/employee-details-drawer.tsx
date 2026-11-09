'use client';
import Link from 'next/link';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { AnimatedCount } from '../../../components/ui/animated-count';
import {
  employeeAttendanceTags,
  nfcHref,
} from '../../employee-attendance/nfc-store';
import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { GlassSelect } from '../../../components/ui/glass-select';
import {
  assignEmployeeManager,
  listEmployeeProperties,
  listManagers,
} from '../../../lib/api/employees-api';
import type { ManagerDto } from '../../../lib/api/employee-types';
import { assignmentProperties, type Assignment } from '../assignment-trial';
import {
  mapEmployeeProperty,
  money,
  propertyStatusSummary,
  UNAVAILABLE,
  type EmployeePropertyRef,
  type EmployeeRecord,
} from '../model';
import { EmployeeStats } from './employee-stats';
import { EmployeeTabs } from './employee-tabs';
import styles from './employees.module.css';

export function EmployeeDetailsDrawer({
  employee,
  assignments,
  onRename,
  onToggleActivation,
  onClose,
  canManage = true,
  onManagerChanged,
}: {
  employee: EmployeeRecord;
  assignments: Assignment[];
  /** Persists a new display name, then the page refreshes this card. */
  onRename: (name: string) => Promise<void>;
  /** Activates/deactivates the account; the page updates after API success. */
  onToggleActivation: (isActive: boolean) => Promise<void>;
  onClose: () => void;
  /** OWNER account management; MANAGER team view is read-only. */
  canManage?: boolean;
  /** Refreshes the employee list after an individual assignment/transfer. */
  onManagerChanged?: () => void;
}) {
  const tag = employeeAttendanceTags.find((t) =>
    t.email === employee.email.toLowerCase(),
  );
  const [tab, setTab] = useState('summary');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(employee.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmingActivation, setConfirmingActivation] = useState(false);
  const [activationBusy, setActivationBusy] = useState(false);
  const [activationError, setActivationError] = useState('');
  const [managers, setManagers] = useState<ManagerDto[]>([]);
  const [managerBusy, setManagerBusy] = useState(false);
  const [managerError, setManagerError] = useState('');
  const [propertyRows, setPropertyRows] = useState<EmployeePropertyRef[]>(
    employee.properties,
  );
  const [propertyCursor, setPropertyCursor] = useState<string | null>(null);
  const [propertyTotal, setPropertyTotal] = useState(employee.propertyCount);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesError, setPropertiesError] = useState('');

  useEffect(() => {
    if (!canManage || employee.role !== 'EMPLOYEE') return;
    let active = true;
    listManagers()
      .then((page) => {
        if (active) setManagers(page.items);
      })
      .catch((cause) => {
        if (active)
          setManagerError(
            cause instanceof Error
              ? cause.message
              : 'تعذر تحميل المديرين.',
          );
      });
    return () => {
      active = false;
    };
  }, [canManage, employee.role]);

  useEffect(() => {
    let active = true;
    setPropertiesLoading(true);
    setPropertiesError('');
    listEmployeeProperties(employee.id, { limit: 50 })
      .then((page) => {
        if (!active) return;
        setPropertyRows(page.items.map(mapEmployeeProperty));
        setPropertyCursor(page.nextCursor);
        setPropertyTotal(page.total);
      })
      .catch((cause) => {
        if (!active) return;
        setPropertiesError(
          cause instanceof Error
            ? cause.message
            : 'تعذّر تحميل عقارات الموظف.',
        );
      })
      .finally(() => {
        if (active) setPropertiesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [employee.id]);

  const loadMoreProperties = async () => {
    if (!propertyCursor || propertiesLoading) return;
    setPropertiesLoading(true);
    setPropertiesError('');
    try {
      const page = await listEmployeeProperties(employee.id, {
        cursor: propertyCursor,
        limit: 50,
      });
      setPropertyRows((previous) => {
        const seen = new Set(previous.map((property) => property.id));
        return [
          ...previous,
          ...page.items
            .map(mapEmployeeProperty)
            .filter((property) => !seen.has(property.id)),
        ];
      });
      setPropertyCursor(page.nextCursor);
      setPropertyTotal(page.total);
    } catch (cause) {
      setPropertiesError(
        cause instanceof Error
          ? cause.message
          : 'تعذّر تحميل المزيد من العقارات.',
      );
    } finally {
      setPropertiesLoading(false);
    }
  };

  const changeManager = async (managerUserId: string) => {
    setManagerBusy(true);
    setManagerError('');
    try {
      await assignEmployeeManager(employee.id, managerUserId || null);
      onManagerChanged?.();
    } catch (cause) {
      setManagerError(
        cause instanceof Error ? cause.message : 'تعذر تعيين الموظف.',
      );
    } finally {
      setManagerBusy(false);
    }
  };

  const panel = (id: string, content: ReactNode) => (
    <section
      key={id}
      role="tabpanel"
      tabIndex={0}
      id={`employee-file-panel-${id}`}
      aria-labelledby={`employee-file-tab-${id}`}
      hidden={tab !== id}
    >
      {content}
    </section>
  );
  const submitName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = name.trim();
    if (!value || saving) return;
    setSaving(true);
    setError('');
    try {
      await onRename(value);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر حفظ الاسم.');
    } finally {
      setSaving(false);
    }
  };
  const confirmActivation = async () => {
    if (activationBusy) return;
    setActivationBusy(true);
    setActivationError('');
    try {
      await onToggleActivation(!employee.active);
      setConfirmingActivation(false);
    } catch (cause) {
      setActivationError(
        cause instanceof Error ? cause.message : 'تعذر تحديث حالة الحساب.',
      );
    } finally {
      setActivationBusy(false);
    }
  };
  return (
    <PropertyOverlay
      title={`ملف الموظف · ${employee.name}`}
      drawer
      onClose={onClose}
    >
      <div className={styles.employeeDrawer}>
      <p>
        {employee.roleLabel} · {employee.active ? 'نشط' : 'غير نشط'}
      </p>
      <EmployeeTabs value={tab} onChange={setTab} />
      {panel(
        'summary',
        <>
          <dl className={styles.metrics}>
            {[
              ['الهاتف', employee.phone || UNAVAILABLE],
              ['تاريخ التعيين', employee.hiredAt || UNAVAILABLE],
              [
                'الراتب الأساسي',
                employee.salary === null
                  ? UNAVAILABLE
                  : money(employee.salary),
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <bdi>{value}</bdi>
                </dd>
              </div>
            ))}
          </dl>
          {canManage && (
            <>
          <Card className={styles.drawerCard}>
            <h3>الاسم الظاهر</h3>
            {editing ? (
              <form onSubmit={submitName}>
                <label className={styles.field}>
                  اسم الموظف
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={100}
                    required
                    autoFocus
                    autoComplete="off"
                  />
                </label>
                {error && <p role="alert">{error}</p>}
                <div className={styles.actions}>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'جارٍ الحفظ…' : 'حفظ الاسم'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEditing(false);
                      setName(employee.name);
                      setError('');
                    }}
                  >
                    إلغاء
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <p>
                  <bdi>{employee.name}</bdi>
                </p>
                <div className={styles.actions}>
                  <Button
                    type="button"
                    onClick={() => {
                      setName(employee.name);
                      setError('');
                      setEditing(true);
                    }}
                  >
                    تعديل
                  </Button>
                </div>
              </>
            )}
          </Card>
          <Card className={styles.drawerCard}>
            <h3>حساب الدخول</h3>
            <p>الحالة: {employee.active ? 'نشط' : 'معطّل'}</p>
            {confirmingActivation ? (
              <>
                <p>
                  {employee.active
                    ? 'سيفقد الموظف القدرة على تسجيل الدخول وتُلغى جلساته الحالية. هل أنت متأكد؟'
                    : 'سيُسمح للموظف بتسجيل الدخول من جديد. هل أنت متأكد؟'}
                </p>
                {activationError && <p role="alert">{activationError}</p>}
                <div className={styles.actions}>
                  <Button
                    type="button"
                    disabled={activationBusy}
                    onClick={confirmActivation}
                  >
                    {activationBusy
                      ? 'جارٍ التنفيذ…'
                      : employee.active
                        ? 'تأكيد التعطيل'
                        : 'تأكيد إعادة التفعيل'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={activationBusy}
                    onClick={() => {
                      setConfirmingActivation(false);
                      setActivationError('');
                    }}
                  >
                    إلغاء
                  </Button>
                </div>
              </>
            ) : (
              <>
                {activationError && <p role="alert">{activationError}</p>}
                <div className={styles.actions}>
                  <Button
                    type="button"
                    onClick={() => {
                      setActivationError('');
                      setConfirmingActivation(true);
                    }}
                  >
                    {employee.active ? 'تعطيل الحساب' : 'إعادة تفعيل الحساب'}
                  </Button>
                </div>
              </>
            )}
          </Card>
          {employee.role === 'EMPLOYEE' && (
            <Card className={styles.drawerCard}>
              <h3>المدير المسؤول</h3>
              <p>
                الحالة الحالية:{' '}
                <bdi>{employee.managerName ?? 'مالك النظام'}</bdi>
              </p>
              <label className={styles.field}>
                تعيين المدير
                <GlassSelect
                  value={employee.managerUserId ?? ''}
                  disabled={managerBusy}
                  onChange={(event) =>
                    void changeManager(event.target.value)
                  }
                >
                  <option value="">مالك النظام — تبعية مباشرة</option>
                  {managers
                    .filter((manager) => manager.isActive)
                    .map((manager) => (
                      <option key={manager.id} value={manager.id}>
                        {manager.name}
                      </option>
                    ))}
                </GlassSelect>
              </label>
              {managerError && <p role="alert">{managerError}</p>}
            </Card>
          )}
            </>
          )}
          <Card className={styles.drawerCard}>
            <h3>كارت الحضور NFC</h3>
            <p>حالة الكارت: {tag ? 'مربوط' : 'غير مربوط'}</p>
            {tag && (
              <>
                <p>
                  <bdi>{tag.tagId}</bdi>
                </p>
                <Link href={nfcHref(tag.tagId)}>رابط تجربة mock</Link>
              </>
            )}
            <p>
              في النسخة الحقيقية سيتم ربط الكارت من خلال API وإدارة الصلاحيات.
            </p>
          </Card>
          <EmployeeStats employee={employee} />
        </>,
      )}
      {panel(
        'clients',
        <>
          <h3>العملاء المسؤول عنهم</h3>
          <p className={styles.notice}>
            هذا القسم غير مُنفّذ في الخادم بعد، لذلك يُعرض «{UNAVAILABLE}» بدلًا
            من رقم تقديري.
          </p>
        </>,
      )}
      {panel(
        'properties',
        <>
          <h3>العقارات التي أدخلها ({propertyTotal})</h3>
          {propertiesError ? (
            <p className={styles.notice}>{propertiesError}</p>
          ) : null}
          {propertyRows.length ? (
            <>
              <p className={styles.muted}>
                {propertyStatusSummary(employee.propertiesByStatus)}
              </p>
              <ul className={styles.list}>
                {propertyRows.map((property) => (
                  <li key={property.id}>
                    <strong>
                      {property.reference} · {property.title}
                    </strong>
                    <p>{property.statusLabel}</p>
                  </li>
                ))}
              </ul>
              {propertyCursor && (
                <p className={styles.notice}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void loadMoreProperties()}
                    disabled={propertiesLoading}
                    aria-busy={propertiesLoading}
                  >
                    {propertiesLoading ? 'جارٍ التحميل…' : 'تحميل المزيد'}
                  </Button>
                </p>
              )}
            </>
          ) : (
            <p>لم يسجّل هذا الموظف أي عقار حتى الآن.</p>
          )}
          <h3>
            العقارات المخصصة له (<AnimatedCount value={assignments.length} />)
          </h3>
          <p className={styles.notice}>
            التخصيص أولوية وتركيز فقط، وباقي الموظفين يمكنهم العمل على نفس
            العقار.
          </p>
          {assignments.length ? (
            <ul className={styles.list}>
              {assignments.map((item) => (
                <li key={item.propertyId}>
                  <strong>
                    {
                      assignmentProperties.find(
                        (property) => property.id === item.propertyId,
                      )?.title
                    }{' '}
                    · {item.propertyId}
                  </strong>
                  <p>{item.type}</p>
                  <p>{item.note || 'لا توجد ملاحظة.'}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p>لا توجد عقارات مخصصة لهذا الموظف.</p>
          )}
        </>,
      )}
      {panel(
        'deals',
        <>
          <h3>الصفقات والعمولات</h3>
          <p>إجمالي العمولة: {UNAVAILABLE}</p>
          <p className={styles.notice}>
            قسم الصفقات والعمولات غير مُنفّذ في الخادم بعد، لذلك لا تُعرض أرقام
            تقديرية.
          </p>
        </>,
      )}
      {panel(
        'followups',
        <>
          <h3>متابعات متأخرة: {UNAVAILABLE}</h3>
          <p className={styles.notice}>
            قسم المتابعات غير مُنفّذ في الخادم بعد، لذلك لا تُعرض أرقام تقديرية.
          </p>
        </>,
      )}
      </div>
    </PropertyOverlay>
  );
}
