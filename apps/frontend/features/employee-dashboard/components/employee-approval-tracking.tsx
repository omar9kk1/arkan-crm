'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { listProperties } from '../../../lib/api/properties-api';
import { listClientReviews } from '../../../lib/api/client-reviews-api';
import type { PropertyViewDto } from '../../../lib/api/property-types';
import { isPrivatePropertyDto } from '../../../lib/api/property-types';
import type { ClientReviewSummaryDto } from '../../../lib/api/client-reviews-api';
import { displayDue } from '../../employee-followups/model';
import styles from './employee-dashboard.module.css';

type Bucket = 'pending' | 'approved' | 'rejected';

interface ApprovalItem {
  key: string;
  type: 'property' | 'client';
  id: string;
  title: string;
  secondary: string;
  bucket: Bucket;
  rawStatus: string;
  rejectionReason: string | null;
  submissionDate: string | null;
  decisionDate: string | null;
  detailHref: string;
}

function propertyBucket(p: PropertyViewDto): Bucket | null {
  if (!isPrivatePropertyDto(p)) return null;
  const rs = p.reviewStatus;
  if (rs === 'APPROVED') return 'approved';
  if (rs === 'REJECTED') return 'rejected';
  if (rs === 'PENDING' || rs === 'CHANGES_REQUESTED') return 'pending';
  // fallback by property status
  if (p.status === 'PENDING') return 'pending';
  return null;
}

function clientBucket(s: ClientReviewSummaryDto): Bucket {
  if (s.status === 'APPROVED') return 'approved';
  if (s.status === 'REJECTED') return 'rejected';
  return 'pending'; // PENDING or CHANGES_REQUESTED
}

function bucketLabel(b: Bucket): string {
  if (b === 'pending') return 'قيد المراجعة';
  if (b === 'approved') return 'تمت الموافقة';
  return 'مرفوض';
}

function clientTypeLabel(kind: 'CREATION' | 'EDIT'): string {
  return kind === 'CREATION' ? 'إنشاء عميل' : 'تعديل عميل';
}

export function EmployeeApprovalTracking() {
  const [properties, setProperties] = useState<PropertyViewDto[]>([]);
  const [reviews, setReviews] = useState<ClientReviewSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<Bucket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, rRes] = await Promise.all([
        listProperties({ limit: 50 }),
        listClientReviews(),
      ]);
      setProperties(pRes.items);
      setReviews(rRes.items);
    } catch {
      setError('تعذّر تحميل بيانات الموافقات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo<ApprovalItem[]>(() => {
    const out: ApprovalItem[] = [];
    // properties owned by employee
    for (const p of properties) {
      if (!p.isMine) continue;
      const b = propertyBucket(p);
      if (!b) continue;
      out.push({
        key: `property:${p.id}`,
        type: 'property',
        id: p.id,
        title: p.title ?? p.reference,
        secondary: p.reference,
        bucket: b,
        rawStatus: isPrivatePropertyDto(p)
          ? (p.reviewStatus ?? p.status)
          : p.status,
        rejectionReason: isPrivatePropertyDto(p)
          ? (p.reviewNotes ?? null)
          : null,
        submissionDate: p.createdAt,
        decisionDate:
          isPrivatePropertyDto(p) &&
          (p.reviewStatus === 'APPROVED' || p.reviewStatus === 'REJECTED')
            ? p.updatedAt
            : null,
        detailHref: '/employee/properties',
      });
    }
    // client reviews (employee's own submissions)
    for (const r of reviews) {
      out.push({
        key: `client:${r.id}`,
        type: 'client',
        id: r.id,
        title: `${clientTypeLabel(r.kind)} — ${r.clientName}`,
        secondary:
          r.submissionSummary ??
          (r.hasSubmissionNote ? 'يوجد ملاحظة' : 'بدون ملاحظة'),
        bucket: clientBucket(r),
        rawStatus: r.status,
        rejectionReason: r.reviewNotes,
        submissionDate: r.createdAt,
        decisionDate: r.reviewedAt,
        detailHref: '/employee/clients',
      });
    }
    // sort by most recent meaningful timestamp desc, then id desc
    out.sort((a, b) => {
      const ta = Date.parse(a.decisionDate ?? a.submissionDate ?? '') || 0;
      const tb = Date.parse(b.decisionDate ?? b.submissionDate ?? '') || 0;
      if (tb !== ta) return tb - ta;
      return b.id.localeCompare(a.id);
    });
    return out;
  }, [properties, reviews]);

  const filteredItems = useMemo(
    () =>
      statusFilter ? items.filter((it) => it.bucket === statusFilter) : items,
    [items, statusFilter],
  );

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0 };
    for (const it of items) c[it.bucket]++;
    return c;
  }, [items]);

  const visible = filteredItems.slice(0, 3);

  return (
    <section className={styles.approvalsSection}>
      <h2 className={styles.approvalsTitle}>متابعة الموافقات</h2>

      <div className={styles.approvalsPills}>
        {[
          {
            bucket: 'pending' as Bucket,
            label: 'قيد المراجعة',
            count: counts.pending,
          },
          {
            bucket: 'approved' as Bucket,
            label: 'تمت الموافقة',
            count: counts.approved,
          },
          {
            bucket: 'rejected' as Bucket,
            label: 'مرفوض',
            count: counts.rejected,
          },
        ].map((p) => {
          const active = statusFilter === p.bucket;
          return (
            <button
              key={p.bucket}
              type="button"
              className={`${styles.approvalPill} ${
                active ? styles.approvalPillActive : ''
              }`}
              onClick={() =>
                setStatusFilter((prev) => (prev === p.bucket ? null : p.bucket))
              }
            >
              {p.label} ({p.count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className={styles.approvalsList}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.approvalSkeleton} />
          ))}
        </div>
      ) : error ? (
        <Card>
          <p className={styles.approvalsEmpty}>{error}</p>
          <Button onClick={() => void load()}>إعادة المحاولة</Button>
        </Card>
      ) : filteredItems.length === 0 ? (
        <Card>
          <p className={styles.approvalsEmpty}>لا توجد عناصر بهذه الحالة</p>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <p className={styles.approvalsEmpty}>لا توجد طلبات موافقة حاليًا</p>
        </Card>
      ) : (
        <div className={styles.approvalsList}>
          {visible.map((it) => {
            const open = expanded === it.key;
            return (
              <div key={it.key} className={styles.approvalRow}>
                <button
                  type="button"
                  className={styles.approvalHead}
                  onClick={() => setExpanded(open ? null : it.key)}
                >
                  <div className={styles.approvalHeadText}>
                    <span className={styles.approvalTitle}>{it.title}</span>
                    <span className={styles.approvalSecondary}>
                      {it.secondary}
                    </span>
                  </div>
                  <span
                    className={styles.approvalStatus}
                    data-bucket={it.bucket}
                  >
                    {bucketLabel(it.bucket)}
                  </span>
                  <span className={styles.approvalChevron} aria-hidden="true">
                    {open ? '▲' : '▼'}
                  </span>
                </button>
                {open ? (
                  <div className={styles.approvalDetails}>
                    <p className={styles.approvalDetailLine}>
                      نوع السجل: {it.type === 'property' ? 'عقار' : 'عميل'}
                    </p>
                    <p className={styles.approvalDetailLine}>
                      الحالة: {bucketLabel(it.bucket)}
                    </p>
                    {it.submissionDate ? (
                      <p className={styles.approvalDetailLine}>
                        تاريخ التقديم: {displayDue(it.submissionDate)}
                      </p>
                    ) : null}
                    {it.decisionDate ? (
                      <p className={styles.approvalDetailLine}>
                        تاريخ القرار: {displayDue(it.decisionDate)}
                      </p>
                    ) : null}
                    {it.bucket === 'rejected' && it.rejectionReason ? (
                      <p className={styles.approvalDetailLine}>
                        سبب الرفض: {it.rejectionReason}
                      </p>
                    ) : null}
                    {it.bucket === 'pending' ? (
                      <p className={styles.approvalDetailLine}>
                        بانتظار مراجعة المدير.
                      </p>
                    ) : null}
                    <a href={it.detailHref} className={styles.approvalLink}>
                      عرض التفاصيل
                    </a>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
