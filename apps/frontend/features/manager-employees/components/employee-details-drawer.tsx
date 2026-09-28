'use client';
import Link from 'next/link';
import { Card } from '../../../components/ui/card';
import {
  employeeAttendanceTags,
  nfcHref,
} from '../../employee-attendance/nfc-store';
import { useState, type ReactNode } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { FollowUpTimeline } from '../../manager-clients/components/follow-up-timeline';
import {
  money,
  assignmentProperties,
  type EmployeeSample,
  type Assignment,
} from '../mock-data';
import { EmployeeStats } from './employee-stats';
import { EmployeeTabs } from './employee-tabs';
import styles from './employees.module.css';
export function EmployeeDetailsDrawer({
  employee,
  assignments,
  onClose,
}: {
  employee: EmployeeSample;
  assignments: Assignment[];
  onClose: () => void;
}) {
  const tag = employeeAttendanceTags.find((t) =>
    employee.email
      ? t.email === employee.email.toLowerCase()
      : t.profileId === employee.id,
  );
  const [tab, setTab] = useState('summary');
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
  return (
    <PropertyOverlay
      title={`ملف الموظف · ${employee.name}`}
      drawer
      onClose={onClose}
    >
      <p>
        {employee.jobRole || 'موظف مبيعات'} ·{' '}
        {employee.active ? 'نشط' : 'غير نشط'}
      </p>
      <EmployeeTabs value={tab} onChange={setTab} />
      {panel(
        'summary',
        <>
          <dl className={styles.metrics}>
            {[
              ['الهاتف', employee.phone],
              ['تاريخ التعيين', employee.hiredAt],
              ['الراتب الأساسي', money(employee.salary)],
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
          <EmployeeStats
            employee={employee}
            assignedCount={assignments.length}
          />
          <p>الأعداد توضيحية، والقوائم التالية تعرض عينات مصغرة.</p>
        </>,
      )}
      {panel(
        'clients',
        <>
          <h3>العملاء المسؤول عنهم</h3>
          <ul className={styles.list}>
            {employee.clients.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </>,
      )}
      {panel(
        'properties',
        <>
          <h3>العقارات التي أدخلها</h3>
          <ul className={styles.list}>
            {employee.enteredProperties.map((property) => (
              <li key={property}>{property}</li>
            ))}
          </ul>
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
          <p>إجمالي العمولة: {money(employee.commission)}</p>
          <ul className={styles.list}>
            {employee.deals.map((deal) => (
              <li key={deal.code}>
                <strong>
                  {deal.title} · {deal.code}
                </strong>
                <p>{money(deal.commission)}</p>
              </li>
            ))}
          </ul>
        </>,
      )}
      {panel(
        'followups',
        <>
          <h3>متابعات متأخرة: {employee.lateCount}</h3>
          <p className={styles.notice}>
            توجد متابعات متأخرة تحتاج مراجعة من المدير. السجل أدناه عينة
            توضيحية.
          </p>
          <FollowUpTimeline entries={employee.followups} />
        </>,
      )}
    </PropertyOverlay>
  );
}
