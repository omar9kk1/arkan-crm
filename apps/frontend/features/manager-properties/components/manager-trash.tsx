'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { Button } from '../../../components/ui/button';
import { SearchBar } from '../../../components/ui/search-bar';
import { Toast } from '../../../components/ui/toast';
import {
  listTrashedProperties,
  restoreProperty,
  permanentDeleteProperty,
} from '../../../lib/api/properties-api';
import { mapPreviewFromApi } from '../../../lib/property-adapter';
import type { PreviewProperty } from '../preview-data';
import { PermanentDeleteDialog } from './trash-dialogs';
import { useAuth } from '../../auth/components/auth-provider';
import styles from './properties.module.css';

function formatTrashDate(value?: string | null) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ar-KW', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

/**
 * Dedicated Manager-only Deleted Properties page.
 *
 * Reuses the existing Trash/restore/permanent-delete APIs and the same
 * Astra-glass card language as the property list. Employees never reach this
 * route (RequireRole) and the backend enforces MANAGER on every endpoint.
 */
export function ManagerTrash() {
  const { user } = useAuth();
  const [rows, setRows] = useState<PreviewProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState({ text: '', sequence: 0 });
  const [permanentTarget, setPermanentTarget] = useState<PreviewProperty | null>(
    null,
  );
  const [dialogError, setDialogError] = useState('');

  const notify = useCallback(
    (text: string) =>
      setNotice((previous) => ({ text, sequence: previous.sequence + 1 })),
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const page = await listTrashedProperties();
      setRows(page.items.map((dto) => mapPreviewFromApi(dto, user)));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'تعذّر تحميل سلة المحذوفات.',
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ar');
    if (!needle) return rows;
    return rows.filter((property) =>
      `${property.code} ${property.region} ${property.title}`
        .toLocaleLowerCase('ar')
        .includes(needle),
    );
  }, [rows, query]);

  const restore = async (property: PreviewProperty) => {
    if (!property.id || busyId) return;
    setBusyId(property.id);
    try {
      await restoreProperty(property.id);
      notify(`تم استعادة العقار ${property.code}.`);
      await load();
    } catch (cause) {
      notify(
        cause instanceof Error ? cause.message : 'تعذّر استعادة العقار.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const confirmPermanent = async () => {
    if (!permanentTarget?.id || busyId) return;
    setBusyId(permanentTarget.id);
    setDialogError('');
    try {
      await permanentDeleteProperty(permanentTarget.id, permanentTarget.code);
      notify(`تم الحذف النهائي للعقار ${permanentTarget.code}.`);
      setPermanentTarget(null);
      await load();
    } catch (cause) {
      setDialogError(
        cause instanceof Error ? cause.message : 'تعذّر الحذف النهائي.',
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ManagerPageShell title="المحذوفات">
      <div className={styles.scope}>
        <div className={styles.toolbar}>
          <SearchBar
            label="البحث في المحذوفات بالكود أو الموقع"
            placeholder="ابحث بالكود أو الموقع..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {loading ? (
          <p className={styles.inset} role="status" aria-live="polite">
            جارٍ تحميل سلة المحذوفات…
          </p>
        ) : error ? (
          <p className={styles.inset} role="alert">
            {error}{' '}
            <Button type="button" variant="ghost" onClick={() => void load()}>
              إعادة المحاولة
            </Button>
          </p>
        ) : visible.length === 0 ? (
          <p className={styles.inset}>
            {query.trim() && rows.length > 0
              ? 'لا توجد عقارات محذوفة تطابق البحث.'
              : 'سلة المحذوفات فارغة'}
          </p>
        ) : (
          <div className={styles.trashGrid}>
            {visible.map((property) => (
              <article
                key={property.id ?? property.code}
                className={styles.trashCard}
              >
                <div className={styles.trashCardHeader}>
                  <span className={styles.trashCardCode}>
                    <bdi>{property.code}</bdi>
                  </span>
                  <span className={styles.trashCardBadge}>محذوف</span>
                </div>
                <dl className={styles.trashCardMeta}>
                  <div>
                    <dt>الموقع</dt>
                    <dd>{property.region || '—'}</dd>
                  </div>
                  <div>
                    <dt>تاريخ الحذف</dt>
                    <dd>{formatTrashDate(property.deletedAt)}</dd>
                  </div>
                  <div>
                    <dt>حذفه</dt>
                    <dd>{property.deletedByName || '—'}</dd>
                  </div>
                  {property.deletionReason && (
                    <div>
                      <dt>السبب</dt>
                      <dd>{property.deletionReason}</dd>
                    </div>
                  )}
                </dl>
                <div className={styles.trashCardActions}>
                  <Button
                    type="button"
                    onClick={() => void restore(property)}
                    disabled={busyId === property.id}
                    aria-busy={busyId === property.id}
                  >
                    استعادة
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => {
                      setDialogError('');
                      setPermanentTarget(property);
                    }}
                    disabled={busyId === property.id}
                  >
                    حذف نهائي
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}

        <Toast
          message={notice.text}
          eventKey={notice.sequence}
          onDismiss={() => setNotice((previous) => ({ ...previous, text: '' }))}
        />
        {permanentTarget && (
          <PermanentDeleteDialog
            propertyCode={permanentTarget.code}
            busy={busyId === permanentTarget.id}
            error={dialogError}
            onConfirm={() => void confirmPermanent()}
            onClose={() => {
              if (busyId) return;
              setPermanentTarget(null);
              setDialogError('');
            }}
          />
        )}
      </div>
    </ManagerPageShell>
  );
}
