'use client';
import { useMemo } from 'react';
import type { PropertyViewDto } from '../../../lib/api/property-types';
import { displayStatus } from '../../../lib/property-adapter';
import { mapPropertyDetails } from '../../../lib/property-details';
import type { PreviewProperty } from '../preview-data';
import {
  buildHouseComparison,
  countComparisonStates,
  type ComparisonGroup,
  type ComparisonState,
} from '../duplicate-comparison';
import { Icon } from '../../../components/ui/icon';
import styles from './properties.module.css';

const STATE_LABEL: Record<ComparisonState, string> = {
  match: 'مطابق',
  different: 'مختلف',
  missing: 'بيانات ناقصة',
};

// CSS-module lookups are typed `string | undefined`; the classes exist, but the
// fallback keeps the type honest without ever hiding a missing style silently.
const STATE_CLASS: Record<ComparisonState, string> = {
  match: styles.potentialDuplicateStateMatch ?? '',
  different: styles.potentialDuplicateStateDifferent ?? '',
  missing: styles.potentialDuplicateStateMissing ?? '',
};

function GroupSummary({ group }: { group: ComparisonGroup }) {
  const counts = countComparisonStates(group);
  return (
    <summary className={styles.potentialDuplicateGroupSummary}>
      <span className={styles.potentialDuplicateGroupTitle}>{group.title}</span>
      <span className={styles.potentialDuplicateGroupCounts}>
        {counts.match > 0 && (
          <span className={styles.potentialDuplicateCountMatch}>
            {counts.match} متطابق
          </span>
        )}
        {counts.different > 0 && (
          <span className={styles.potentialDuplicateCountDifferent}>
            {counts.different} مختلف
          </span>
        )}
        {counts.missing > 0 && (
          <span className={styles.potentialDuplicateCountMissing}>
            {counts.missing} ناقص
          </span>
        )}
      </span>
    </summary>
  );
}

/**
 * Manager-only comparison of a pending COMPLETE HOUSE against the already
 * registered houses the backend flagged as potential duplicates.
 *
 * It renders only presentation data: the caller fetches the candidates with
 * the Manager session, so private owner/broker fields arrive only when the
 * backend authorised this viewer. Both-missing rows show «بيانات ناقصة» and
 * count as visually matched; one-sided rows are «مختلف». Missing data is never
 * used as duplicate evidence by the backend classifier.
 */
export function PotentialDuplicateReview({
  property,
  candidates,
  loading,
}: {
  property: PreviewProperty;
  candidates: PropertyViewDto[];
  loading: boolean;
}) {
  const compared = useMemo(
    () =>
      candidates.map((candidate) => ({
        candidate,
        groups: buildHouseComparison(
          property.details,
          mapPropertyDetails(candidate),
        ),
      })),
    [candidates, property.details],
  );

  return (
    <section
      className={styles.potentialDuplicateSection}
      aria-labelledby="potential-duplicate-heading"
    >
      <h3
        id="potential-duplicate-heading"
        className={styles.potentialDuplicateHeading}
      >
        <Icon name="megaphone" width={16} height={16} />
        يوجد عقار مشابه يحتاج إلى مراجعة
      </h3>
      <p className={styles.potentialDuplicateDescription}>
        تم العثور على بيانات متشابهة مع عقار مسجّل. راجع الاختلافات قبل اتخاذ
        القرار.
      </p>
      <p className={styles.potentialDuplicateDescription}>
        تمت الإشارة إلى هذا العقار لأن عدة تفاصيل مستقلة (المحافظة، المنطقة،
        رقم القسيمة، المالك، المساحة، الأدوار) تتطابق مع عقار مسجّل، حتى لو
        اختلف رقم القطعة أو السعر. اختلاف القطعة أو السعر لا يلغي التشابه
        القوي — تحقق من جميع الحقول قبل اعتماده كعقار مختلف.
      </p>

      {loading ? (
        <p className={styles.potentialDuplicateLoading}>
          جارٍ تحميل العقارات المشابهة…
        </p>
      ) : compared.length === 0 ? (
        <p className={styles.potentialDuplicateError} role="alert">
          تعذّر تحميل بيانات العقار المشابه. أعد فتح السجل أو حدّث الصفحة.
        </p>
      ) : (
        compared.map(({ candidate, groups }) => (
          <div
            key={candidate.id}
            className={styles.potentialDuplicateCandidate}
          >
            <div className={styles.potentialDuplicateCandidateHeader}>
              <span className={styles.potentialDuplicateCandidateTitle}>
                <strong>
                  <bdi>{candidate.reference}</bdi>
                </strong>
                <span className={styles.potentialDuplicateSimilarBadge}>
                  عقار مشابه
                </span>
              </span>
              <span className={styles.potentialDuplicateBadge}>
                مطابقة محتملة
              </span>
            </div>
            <p className={styles.potentialDuplicateCandidateMeta}>
              {[candidate.governorate, candidate.district]
                .filter(Boolean)
                .join(' — ') || 'الموقع غير محدد'}
              {' · '}
              {displayStatus(candidate)}
            </p>

            {groups.length === 0 ? (
              <p className={styles.potentialDuplicateLoading}>
                لا توجد بيانات كافية للمقارنة.
              </p>
            ) : (
              groups.map((group) => (
                <details
                  key={group.key}
                  className={styles.potentialDuplicateGroup}
                  open
                >
                  <GroupSummary group={group} />
                  <div className={styles.potentialDuplicateRows}>
                    {group.rows.map((row) => (
                      <div
                        key={row.key}
                        className={styles.potentialDuplicateRow}
                      >
                        <div className={styles.potentialDuplicateRowHead}>
                          <span className={styles.potentialDuplicateRowLabel}>
                            {row.label}
                          </span>
                          <span
                            className={`${styles.potentialDuplicateState} ${STATE_CLASS[row.state]}`}
                          >
                            {STATE_LABEL[row.state]}
                          </span>
                        </div>
                        <div className={styles.potentialDuplicateRowValues}>
                          <div className={styles.potentialDuplicateValueCell}>
                            <span
                              className={styles.potentialDuplicateValueLabel}
                            >
                              العقار الجديد
                            </span>
                            <span
                              className={`${styles.potentialDuplicateValue} ${
                                row.long
                                  ? styles.potentialDuplicateValueLong
                                  : ''
                              }`}
                            >
                              {row.a ?? '—'}
                            </span>
                          </div>
                          <div className={styles.potentialDuplicateValueCell}>
                            <span
                              className={styles.potentialDuplicateValueLabel}
                            >
                              العقار المسجّل
                            </span>
                            <span
                              className={`${styles.potentialDuplicateValue} ${
                                row.long
                                  ? styles.potentialDuplicateValueLong
                                  : ''
                              }`}
                            >
                              {row.b ?? '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ))
            )}
          </div>
        ))
      )}
    </section>
  );
}
