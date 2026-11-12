'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { PreviewProperty } from '../preview-data';
import { Button } from '../../../components/ui/button';
import { PropertyOverlay } from './property-overlay';
import { Icon } from '../../../components/ui/icon';
import { PropertiesSegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import {
  PropertyDetailHeader,
  PropertyDetailSections,
} from './property-detail-sections';
import { PotentialDuplicateReview } from './potential-duplicate-review';
import detailStyles from './property-detail-sections.module.css';
import styles from './properties.module.css';
import { getProperty } from '../../../lib/api/properties-api';
import type { PropertyViewDto } from '../../../lib/api/property-types';
import { listDeals } from '../../../lib/api/deals-api';
import { mapDeal, type Deal } from '../../manager-deals/deal-model';

export function PropertyDetailsDrawer({
  property,
  onClose,
  onBack,
  onAction,
  onApproveDistinct,
  canDelete = false,
  readOnly = false,
  busy = false,
  compareProperty = null,
  onCloseCompare,
  initialCandidates,
  canOpenDeal = false,
  onOpenDeal,
}: {
  property: PreviewProperty;
  onClose: () => void;
  onBack?: () => void;
  /** When provided, the drawer surfaces the manager's review decisions. */
  onAction?: (action: string, property: PreviewProperty) => void;
  /** Deleting to Trash is reserved for OWNER. */
  canDelete?: boolean;
  /** System Log mode: no review/delete/approve actions, no handlers. */
  readOnly?: boolean;
  /** Approve a potential-duplicate property as a genuinely distinct house. */
  onApproveDistinct?: (property: PreviewProperty) => void;
  /** True while a decision for this row is in flight — blocks a double click. */
  busy?: boolean;
  /** Currently open right-hand comparison property, if any. */
  compareProperty?: PreviewProperty | null;
  /** Closes only the right-hand comparison drawer. */
  onCloseCompare?: () => void;
  /**
   * Visual/test seam only: pre-loaded candidates for the isolated preview
   * fixture. Production callers omit it, so the drawer fetches the candidates
   * with the Manager session exactly as before.
   */
  initialCandidates?: PropertyViewDto[];
  /** OWNER-only: reveal the linked closed Deal of a SOLD property. */
  canOpenDeal?: boolean;
  onOpenDeal?: (deal: Deal) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const leftTitleId = useId();
  const rightTitleId = useId();
  const [employeeId, setEmployeeId] = useState(property.employees[0]?.id ?? '');
  const [candidates, setCandidates] = useState<PropertyViewDto[]>(
    initialCandidates ?? [],
  );
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [confirmDistinctOpen, setConfirmDistinctOpen] = useState(false);
  const [linkedDeal, setLinkedDeal] = useState<Deal | null>(null);
  const [dealLoading, setDealLoading] = useState(false);
  const actionable =
    property.apiStatus === 'PENDING' &&
    property.reviewStatus !== 'CHANGES_REQUESTED';
  const showDealAction =
    property.apiStatus === 'SOLD' && canOpenDeal && Boolean(onOpenDeal);

  // OWNER-only: locate the property's closed Deal through the existing Deals
  // list (sorted newest-first), so a SOLD card can open the real deal drawer.
  useEffect(() => {
    if (!showDealAction || !property.id) {
      setLinkedDeal(null);
      setDealLoading(false);
      return;
    }
    let active = true;
    setDealLoading(true);
    (async () => {
      try {
        let cursor: string | undefined;
        let found: Deal | null = null;
        do {
          const page = await listDeals({
            limit: 100,
            ...(cursor ? { cursor } : {}),
          });
          const match = page.items.find(
            (item) => item.property.id === property.id,
          );
          if (match) {
            found = mapDeal(match);
            break;
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        if (active) setLinkedDeal(found);
      } catch {
        if (active) setLinkedDeal(null);
      } finally {
        if (active) setDealLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [showDealAction, property.id]);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const comparePropertyRef = useRef(compareProperty);
  useEffect(() => {
    comparePropertyRef.current = compareProperty;
  }, [compareProperty]);

  const onCloseCompareRef = useRef(onCloseCompare);
  useEffect(() => {
    onCloseCompareRef.current = onCloseCompare;
  }, [onCloseCompare]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    const dialog = dialogRef.current;
    dialog?.showModal();
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const handleToggle = () => {
      if (dialog && !dialog.open) onCloseRef.current?.();
    };
    const handleCancel = (event: Event) => {
      if (comparePropertyRef.current && onCloseCompareRef.current) {
        event.preventDefault();
        onCloseCompareRef.current();
      }
    };
    dialog?.addEventListener('toggle', handleToggle);
    dialog?.addEventListener('cancel', handleCancel);
    return () => {
      dialog?.removeEventListener('toggle', handleToggle);
      dialog?.removeEventListener('cancel', handleCancel);
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      previousFocus?.focus();
    };
  }, []);

  const closeAll = () => {
    onCloseCompare?.();
    dialogRef.current?.close();
    onClose();
  };

  // Fetch potential-duplicate candidate properties (manager-only). The isolated
  // visual fixture supplies `initialCandidates` and therefore performs no API
  // call; every production drawer keeps the real Manager-authenticated fetch.
  useEffect(() => {
    if (initialCandidates) {
      setCandidates(initialCandidates);
      setCandidatesLoading(false);
      return;
    }
    const ids = property.duplicateCandidateIds;
    if (!ids || ids.length === 0) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    setCandidatesLoading(true);
    Promise.all(ids.map((id) => getProperty(id).catch(() => null)))
      .then((results) => {
        if (cancelled) return;
        setCandidates(results.filter((r): r is PropertyViewDto => r !== null));
      })
      .finally(() => {
        if (!cancelled) setCandidatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [property.duplicateCandidateIds, initialCandidates]);

  return (
    <dialog
      ref={dialogRef}
      className={detailStyles.comparisonRoot}
      aria-labelledby={leftTitleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          if (compareProperty && onCloseCompare) {
            onCloseCompare();
          } else {
            closeAll();
          }
        }
      }}
    >
      {/* LEFT DRAWER: Pending / Selected Property */}
      <div
        className={`${styles.overlay} ${styles.drawer} ${detailStyles.drawer} ${compareProperty ? detailStyles.comparing : ''}`}
        role="region"
        aria-labelledby={leftTitleId}
      >
        <header className={styles.overlayHeader}>
          <div className={styles.overlayTitleGroup}>
            {onBack ? (
              <Button
                onClick={onBack}
                aria-label="رجوع"
                title="رجوع"
                className={styles.overlayBackButton}
              >
                <Icon name="arrowRight" width={16} height={16} />
              </Button>
            ) : null}
            <div>
              <div className={styles.overlayTitleRow}>
                <h2 id={leftTitleId}>{property.title}</h2>
                {Array.isArray(property.duplicateCandidateIds) &&
                  property.duplicateCandidateIds.length > 0 && (
                    <span
                      className={styles.potentialDuplicateSimilarBadge}
                      title="هذا العقار له عقار مشابه مسجّل في النظام"
                    >
                      عقار مشابه
                    </span>
                  )}
              </div>
              <PropertyDetailHeader
                status={property.status}
                reference={property.code}
              />
            </div>
          </div>
          <Button onClick={closeAll} aria-label="إغلاق">
            ×
          </Button>
        </header>
        <div className={styles.overlayBody}>
          {readOnly && (
            <p className={styles.inset} role="note">
              عرض للقراءة فقط من سجل النظام — الحالة المعروضة هي الحالة الحالية
              للعقار وقد تختلف عن لحظة الحدث.
            </p>
          )}
          {/* Potential-duplicate review section — shown only when the backend
              flagged this pending house as a potential duplicate. It sits at
              the TOP so the Manager sees the «عقار مشابه» badge immediately. */}
          {Array.isArray(property.duplicateCandidateIds) &&
            property.duplicateCandidateIds.length > 0 && (
              <PotentialDuplicateReview
                property={property}
                candidates={candidates}
                loading={candidatesLoading}
              />
            )}
          <PropertyDetailSections details={property.details}>
            {onAction && actionable && (
              <div className={styles.actions}>
                {Array.isArray(property.duplicateCandidateIds) &&
                property.duplicateCandidateIds.length > 0 ? (
                  <>
                    <Button
                      type="button"
                      onClick={() => setConfirmDistinctOpen(true)}
                      aria-label={`اعتماد كعقار مختلف ${property.code}`}
                      disabled={busy}
                      aria-busy={busy}
                    >
                      اعتماد كعقار مختلف
                    </Button>
                    <Button
                      type="button"
                      onClick={() => onAction('رفض', property)}
                      aria-label={`رفض كعقار مكرر ${property.code}`}
                      disabled={busy}
                      aria-busy={busy}
                    >
                      رفض كعقار مكرر
                    </Button>
                    <Button
                      type="button"
                      onClick={() => onAction('طلب تعديل', property)}
                      aria-label={`طلب استكمال بيانات ${property.code}`}
                      disabled={busy}
                      aria-busy={busy}
                    >
                      طلب استكمال بيانات
                    </Button>
                  </>
                ) : (
                  ['اعتماد', 'طلب تعديل', 'رفض'].map((action) => (
                    <Button
                      key={action}
                      type="button"
                      onClick={() => onAction(action, property)}
                      aria-label={`${action} ${property.code}`}
                      disabled={busy}
                      aria-busy={busy}
                    >
                      {action}
                    </Button>
                  ))
                )}
              </div>
            )}
            {((onAction && canDelete) || showDealAction) && (
              <div className={styles.actions}>
                {onAction && canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    className={styles.trashButton}
                    onClick={() => onAction('حذف', property)}
                    aria-label={`حذف ${property.code} إلى سلة المحذوفات`}
                    disabled={busy}
                    aria-busy={busy}
                  >
                    <Icon
                      name="trash"
                      width={16}
                      height={16}
                      className={styles.trashIcon}
                    />
                    حذف
                  </Button>
                )}
                {showDealAction && (dealLoading || linkedDeal) && (
                  <Button
                    type="button"
                    className={styles.dealDetailsButton}
                    disabled={dealLoading || !linkedDeal}
                    onClick={() => {
                      if (linkedDeal) onOpenDeal?.(linkedDeal);
                    }}
                  >
                    تفاصيل الصفقة
                  </Button>
                )}
              </div>
            )}
          </PropertyDetailSections>
          {/* Follow-up history has no backend persistence yet, so the block is
              hidden instead of rendering an empty tab strip. */}
          {property.employees.length > 0 && (
            <>
              <h3>الموظفون المتابعون مع المالك</h3>
              <PropertiesSegmentedTabs
                id="owner-followups"
                label="اختيار الموظف المتابع"
                items={property.employees.map((employee) => ({
                  id: employee.id,
                  label: employee.name,
                }))}
                value={employeeId}
                onChange={setEmployeeId}
              />
              {property.employees.map((employee) => (
                <section
                  key={employee.id}
                  role="tabpanel"
                  tabIndex={0}
                  hidden={employeeId !== employee.id}
                  id={`owner-followups-panel-${employee.id}`}
                  aria-labelledby={`owner-followups-tab-${employee.id}`}
                >
                  <h3>سجل متابعة {employee.name}</h3>
                  <ul className={styles.followups}>
                    {employee.entries.map((entry) => (
                      <li key={entry.date}>
                        <time dateTime={entry.date}>{entry.date}</time>
                        <p>{entry.note}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Confirmation dialog for "approve as distinct" */}
      {confirmDistinctOpen && (
        <PropertyOverlay
          title="تأكيد اعتماد عقار مختلف"
          onClose={() => setConfirmDistinctOpen(false)}
        >
          <p className={styles.potentialDuplicateConfirmText}>
            هل تأكدت أن هذا العقار مختلف عن العقار المسجّل؟
          </p>
          <div className={styles.formActions}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDistinctOpen(false)}
              disabled={busy}
            >
              إلغاء
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmDistinctOpen(false);
                if (onApproveDistinct) onApproveDistinct(property);
                else onAction?.('اعتماد', property);
              }}
              disabled={busy}
              aria-busy={busy}
            >
              تأكيد الاعتماد كعقار مختلف
            </Button>
          </div>
        </PropertyOverlay>
      )}

      {/* RIGHT DRAWER: Existing Candidate Property for Comparison */}
      {compareProperty && (
        <div
          className={`${styles.overlay} ${styles.drawer} ${detailStyles.drawer} ${detailStyles.drawerRight} ${detailStyles.comparing}`}
          role="region"
          aria-labelledby={rightTitleId}
        >
          <header className={styles.overlayHeader}>
            <div className={styles.overlayTitleGroup}>
              <Button
                onClick={() => onCloseCompare?.()}
                aria-label="رجوع"
                title="رجوع"
                className={styles.overlayBackButton}
              >
                <Icon name="arrowRight" width={16} height={16} />
              </Button>
              <div>
                <h2 id={rightTitleId}>{compareProperty.title}</h2>
                <PropertyDetailHeader
                  status={compareProperty.status}
                  reference={compareProperty.code}
                />
              </div>
            </div>
            <Button onClick={() => onCloseCompare?.()} aria-label="إغلاق">
              ×
            </Button>
          </header>
          <div className={styles.overlayBody}>
            <PropertyDetailSections details={compareProperty.details} />
          </div>
        </div>
      )}
    </dialog>
  );
}