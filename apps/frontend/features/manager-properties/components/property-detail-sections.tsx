'use client';
import type { ReactNode } from 'react';
import type { PropertyDetails } from '../../../lib/property-details';
import { FLOOR_LABEL_BY_TYPE, floorSummary, orderedFloors } from '../../../lib/property-adapter';
import styles from './property-detail-sections.module.css';

type Fact = readonly [string, string | number | null | undefined];
const present = (value: Fact[1]) =>
  value != null && String(value).trim() !== '';
const money = (value: string | null) => {
  if (!value?.trim() || !Number.isFinite(Number(value))) return null;
  return `${Number(value).toLocaleString('ar-KW', { maximumFractionDigits: 3 })} د.ك`;
};
const size = (value: string | null) => (value?.trim() ? `${value} م²` : null);

function Facts({ items }: { items: Fact[] }) {
  return (
    <dl className={styles.facts}>
      {items
        .filter(([, value]) => present(value))
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function PropertyDetailHeader({
  status,
  reference,
}: {
  status: string;
  reference: string;
}) {
  return (
    <div className={styles.headerMeta}>
      {status && <span className={styles.status}>{status}</span>}
      {reference && (
        <span>
          رقم العقار: <bdi>{reference}</bdi>
        </span>
      )}
    </div>
  );
}

export function PropertyDetailSections({
  details: d,
  children,
}: {
  details?: PropertyDetails;
  children?: ReactNode;
}) {
  const location: Fact[] = d
    ? [
        ['المحافظة', d.governorate],
        ['المنطقة', d.district],
        ['القطعة', d.block],
        ['رقم القسيمة', d.plotNumber],
        ['العنوان', d.address],
      ]
    : [];
  const requested = d?.listingType === 'EXCHANGE' ? d.requestedProperty : null;
  // Generated from the floors actually persisted for the property: the number
  // counts normal floors alone, while basement / half / quarter are appended
  // as labels in the required order — "السرداب + 3 أدوار + نصف دور", or simply
  // "3 أدوار + ربع دور" when no basement was ever selected. Notes stay exactly
  // as stored: nothing is invented here for a section that has none.
  const summary: string | null = d ? floorSummary(d.floors, d.floorCount) : null;
  const requestedFacts: Fact[] = requested
    ? [
        ['المحافظة', requested.governorate],
        ['المنطقة', requested.district],
        ['القطعة', requested.block],
        ['رقم القسيمة', requested.plotNumber],
        ['المساحة', size(requested.sizeSqm)],
        ['الميزانية من', money(requested.budgetMin)],
        ['الميزانية إلى', money(requested.budgetMax)],
      ]
    : [];
  const reviewLabels = {
    PENDING: 'بانتظار المراجعة',
    APPROVED: 'تمت الموافقة',
    REJECTED: 'مرفوض',
    CHANGES_REQUESTED: 'مطلوب تعديل',
  };
  return (
    <>
      {location.some(([, value]) => present(value)) && (
        <Section title="الموقع">
          <Facts items={location} />
        </Section>
      )}
      {d && (
        <Section title="السعر والمساحة">
          <Facts
            items={[
              ['السعر المطلوب', money(d.askingPrice)],
              [
                'قابل للتفاوض',
                d.negotiable === true
                  ? 'نعم'
                  : d.negotiable === false
                    ? 'لا'
                    : 'غير محدد',
              ],
              ['المساحة', size(d.sizeSqm)],
            ]}
          />
        </Section>
      )}
      {d && (d.floorCount != null || d.floors.length > 0) && (
        <Section title="الأدوار وتفاصيل المبنى">
          {summary !== null && <Facts items={[['عدد الأدوار', summary]]} />}
          <div className={styles.floors}>
            {orderedFloors(d.floors).map((floor) => (
                <article key={floor.id} className={styles.floor}>
                  <h4>
                    {floor.customLabel || FLOOR_LABEL_BY_TYPE[floor.type]}
                  </h4>
                  {floor.details?.trim() && (
                    <p className={styles.prose}>{floor.details}</p>
                  )}
                </article>
              ))}
          </div>
        </Section>
      )}
      {d?.generalDescription.trim() && (
        <Section title="الوصف العام">
          <p className={styles.prose}>{d.generalDescription}</p>
        </Section>
      )}
      {requested &&
        (requestedFacts.some(([, value]) => present(value)) ||
          requested.floorRequirements?.trim() ||
          requested.notes?.trim()) && (
          <Section title="العقار المطلوب في البدل">
            <Facts items={requestedFacts} />
            {requested.floorRequirements?.trim() && (
              <>
                <h4>متطلبات الأدوار</h4>
                <p className={styles.prose}>{requested.floorRequirements}</p>
              </>
            )}
            {requested.notes?.trim() && (
              <>
                <h4>ملاحظات العقار المطلوب</h4>
                <p className={styles.prose}>{requested.notes}</p>
              </>
            )}
          </Section>
        )}
      {d && (d.responsibleName?.trim() || d.contact) && (
        <Section title="المسؤولية وجهة التواصل">
          <Facts
            items={[
              ['الموظف المسؤول', d.responsibleName],
              [
                'نوع جهة التواصل',
                d.contact
                  ? d.contact.type === 'BROKER'
                    ? 'وسيط عقاري'
                    : 'مالك مباشر'
                  : null,
              ],
              ['الاسم', d.contact?.name],
              ['الهاتف', d.contact?.phone],
            ]}
          />
        </Section>
      )}
      {(d?.reviewStatus || d?.reviewNotes?.trim() || children) && (
        <Section title="معلومات المراجعة">
          {d?.reviewStatus && (
            <Facts items={[['حالة المراجعة', reviewLabels[d.reviewStatus]]]} />
          )}
          {d?.reviewNotes?.trim() && (
            <>
              <h4>ملاحظات المدير</h4>
              <p className={styles.prose}>{d.reviewNotes}</p>
            </>
          )}
          {d?.deletionReason?.trim() && (
            <>
              <h4>سبب الحذف</h4>
              <p className={styles.prose}>{d.deletionReason}</p>
            </>
          )}
          {children}
        </Section>
      )}
    </>
  );
}
