'use client';
import Link from 'next/link';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import {
  employeeAttendanceTags,
  nfcHref,
} from '../../employee-attendance/nfc-store';
import { useState, type FormEvent, type ReactNode } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { assignmentProperties, type Assignment } from '../assignment-trial';
import {
  money,
  propertyStatusSummary,
  UNAVAILABLE,
  type EmployeeRecord,
} from '../model';
import { EmployeeStats } from './employee-stats';
import { EmployeeTabs } from './employee-tabs';
import styles from './employees.module.css';

export function EmployeeDetailsDrawer({
  employee,
  assignments,
  onRename,
  onClose,
}: {
  employee: EmployeeRecord;
  assignments: Assignment[];
  /** Persists a new display name, then the page refreshes this card. */
  onRename: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const tag = employeeAttendanceTags.find((t) =>
    t.email === employee.email.toLowerCase(),
  );
  const [tab, setTab] = useState('summary');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(employee.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
  return (
    <PropertyOverlay
      title={`ملف الموظف · ${employee.name}`}
      drawer
      onClose={onClose}
    >
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
          <Card>
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
          <Card>
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
          <h3>العقارات التي أدخلها ({employee.propertyCount})</h3>
          {employee.properties.length ? (
            <>
              <p className={styles.muted}>
                {propertyStatusSummary(employee.propertiesByStatus)}
              </p>
              <ul className={styles.list}>
                {employee.properties.map((property) => (
                  <li key={property.id}>
                    <strong>
                      {property.reference} · {property.title}
                    </strong>
                    <p>{property.statusLabel}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>لم يسجّل هذا الموظف أي عقار حتى الآن.</p>
          )}
          <h3>العقارات المخصصة له ({assignments.length})</h3>
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
    </PropertyOverlay>
  );
}
