'use client';
import type { ReactNode } from 'react';
import {
  clientLabels,
  fieldLabels,
  floorSummary,
  parseStoredRequestData,
  requestSummary,
  type ClientType,
} from '../employee-clients/components/request-wizard/client-request-model';
import pageStyles from '../manager-clients/components/clients.module.css';
import styles from './client-profile.module.css';

/**
 * The SHARED building blocks of the «ملف العميل» details drawer (manager +
 * employee): identity grid, request/notes presentation and the pinned action
 * row. Both role drawers import THESE — the layout exists once, the role
 * supplies its own data and permissions.
 */

/** The drawer class both profile drawers share (Astra width, mobile-fluid). */
export const profileDrawerClass = styles.profileDrawer;

/* ---------------------------------------------------------------------------
 * Client identity — a balanced two-column grid (one column on narrow screens),
 * muted labels over readable values. Roles pass only meaningful rows; a blank
 * value renders the honest «—» fallback instead of an empty card.
 * ------------------------------------------------------------------------ */
export interface IdentityItem {
  label: string;
  value?: string;
}

export function ClientProfileIdentity({ items }: { items: IdentityItem[] }) {
  return (
    <dl className={styles.identity}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>
            <bdi>{item.value?.trim() || '—'}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The drawer's intentional action row (rendered in the pinned footer). */
export function ClientProfileActions({ children }: { children: ReactNode }) {
  return <div className={styles.actionRow}>{children}</div>;
}

/* ---------------------------------------------------------------------------
 * Free-text notes — original line breaks and wrapping preserved, never
 * clipped, visually distinct from structured request facts.
 * ------------------------------------------------------------------------ */
export function ClientNotesBlock({
  label,
  notes,
}: {
  label?: string;
  notes: string;
}) {
  return (
    <div className={styles.notesBlock}>
      {label ? <span className={styles.blockLabel}>{label}</span> : null}
      <p className={styles.notesText}>{notes}</p>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Display-only deduplication of `Client.notes`.
 *
 * CONFIRMED ORIGIN: the creation wizard's `saveBundle` stores
 * `notes = bundleSummary(...)` — the human note PLUS one auto-generated
 * `requestSummary(...)` block per stored request type — while the very same
 * request facts live in `Client.requestData`. The suppression below is
 * reliable because the candidate lines are REGENERATED from that SAME stored
 * document with the SAME `requestSummary` code that produced them: only a
 * line-for-line equivalent disappears. Anything else — human paragraphs,
 * extra facts, stale legacy text — is kept untouched, so no unique
 * information can be lost (display only; the stored notes never change).
 * ------------------------------------------------------------------------ */
const normalizedLine = (line: string): string => line.replace(/\s+/g, ' ').trim();

function autoSummaryLines(requestData?: string | null): Set<string> {
  const lines = new Set<string>();
  const stored = parseStoredRequestData(requestData);
  if (!stored) return lines;
  for (const type of stored.types) {
    const draft = stored.requests[type];
    if (!draft) continue;
    for (const line of requestSummary(draft).split('\n')) {
      const normalized = normalizedLine(line);
      if (normalized) lines.add(normalized);
    }
  }
  return lines;
}

/**
 * The notes text worth showing NEXT TO structured request details: every
 * line identical to an auto-generated summary line of THIS client's stored
 * document is dropped; all remaining lines (human notes and any additional
 * information) survive verbatim, with their line breaks preserved. With no
 * structured document the original notes return unchanged — legacy records
 * keep full, readable access to their request details.
 */
export function visibleNotes(
  notes?: string | null,
  requestData?: string | null,
): string {
  const text = notes?.trim() ?? '';
  if (!text) return '';
  const auto = autoSummaryLines(requestData);
  if (!auto.size) return text;
  return text
    .split('\n')
    .filter((line) => {
      const normalized = normalizedLine(line);
      return !normalized || !auto.has(normalized);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ---------------------------------------------------------------------------
 * The persisted wizard request document (`Client.requestData`), decoded ONLY
 * for display — the same honest contract as the review drawer: every value
 * shown below comes straight from the stored document, nothing is guessed,
 * parsed from prose or migrated. Multiple stored requests render as separate
 * cards, never concatenated.
 * ------------------------------------------------------------------------ */
interface StoredRequestProperty {
  governorate?: string;
  area?: string;
  propertyType?: string;
  operationType?: string;
  budget?: string;
  budgetTo?: string;
  size?: string;
  roomsOrFloor?: string;
  duration?: string;
  specifications?: string;
  notes?: string;
  floors?: { name: string; portion: 'FULL' | 'HALF' | 'QUARTER'; details: string }[];
}

interface StoredRequestDraft {
  message?: string;
  /** The per-type draft note (shown in its own card, kept lossless). */
  notes?: string;
  requestDetails?: {
    desiredProperty?: StoredRequestProperty;
    currentProperty?: StoredRequestProperty;
    customFields?: { label: string; value: string }[];
  };
}

interface StoredRequestDocument {
  version?: number;
  types?: string[];
  requests?: Record<string, StoredRequestDraft>;
}

function parseRequestData(raw: string | null | undefined): StoredRequestDocument | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as StoredRequestDocument;
  } catch {
    return null;
  }
}

/** Non-empty persisted facts of one stored request part, label + value only. */
function storedFacts(
  data: StoredRequestProperty | undefined,
): { label: string; value: string }[] {
  if (!data) return [];
  const entries: (keyof typeof fieldLabels)[] = [
    'governorate',
    'area',
    'propertyType',
    'operationType',
    'budget',
    'budgetTo',
    'size',
    'roomsOrFloor',
    'duration',
    'specifications',
    'notes',
  ];
  return entries
    .map((key) => ({ label: fieldLabels[key], value: (data[key] ?? '').trim() }))
    .filter((entry) => entry.value);
}

/** One stored request type as its own card — separated, never merged. */
function RequestCard({ type, draft }: { type: string; draft: StoredRequestDraft }) {
  const details = draft.requestDetails;
  const desired = storedFacts(details?.desiredProperty);
  const current = storedFacts(details?.currentProperty);
  const floors = details?.desiredProperty?.floors ?? [];
  const customFields = details?.customFields ?? [];
  const message = draft.message?.trim() ?? '';
  if (!message && !desired.length && !current.length && !floors.length && !customFields.length) {
    return null;
  }
  return (
    <article className={styles.requestCard}>
      <h4 className={styles.requestCardTitle}>
        طلب {clientLabels[type as ClientType] ?? type}
      </h4>
      {message ? <p className={styles.notesText}>{message}</p> : null}
      {/* The per-type draft note has its own home here, so suppressing its
          duplicated auto-summary line from «ملاحظات العميل» never loses it. */}
      {draft.notes?.trim() ? (
        <>
          <span className={styles.blockLabel}>ملاحظات الطلب</span>
          <p className={styles.notesText}>{draft.notes.trim()}</p>
        </>
      ) : null}
      {desired.length ? (
        <dl className={styles.requestFacts}>
          {desired.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>
                <bdi>{entry.value}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {current.length ? (
        <>
          <span className={styles.blockLabel}>العقار الحالي</span>
          <dl className={styles.requestFacts}>
            {current.map((entry) => (
              <div key={entry.label}>
                <dt>{entry.label}</dt>
                <dd>
                  <bdi>{entry.value}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {floors.length ? (
        <p className={styles.factLine}>
          الأدوار المسقطة: <bdi>{floorSummary(floors)}</bdi>
        </p>
      ) : null}
      {customFields.map((field) => (
        <p key={field.label} className={styles.factLine}>
          {field.label}: <bdi>{field.value}</bdi>
        </p>
      ))}
    </article>
  );
}

/**
 * The request presentation of the profile drawer:
 *
 * - Reliable STRUCTURED data (`Client.requestData`) wins — type pills plus
 *   one separated card per stored request (desired/current facts, floors,
 *   custom fields), and the human notes only as their own separate block.
 * - No structured document → the legacy free-text notes are shown READABLY
 *   (line breaks and wrapping preserved, never parsed or rewritten) so the
 *   details are no longer hidden behind an empty dash.
 * - Nothing at all → one honest fallback line. Notes are never duplicated
 *   across the two presentations.
 */
export function ClientRequestSection({
  requestData,
  notes,
  legacyRequest,
  heading,
}: {
  requestData?: string | null;
  notes?: string;
  /** Older one-line `Client.request`, shown only when it carries real text. */
  legacyRequest?: string;
  heading: string;
}) {
  const stored = parseRequestData(requestData);
  const types = (stored?.types ?? []).filter(
    (type) => type === 'BUYER' || type === 'RENTER' || type === 'EXCHANGER',
  );
  const typeLabels = types.map((type) => clientLabels[type as ClientType] ?? type);
  const parts = types.flatMap((type) => {
    const draft = stored?.requests?.[type];
    return draft ? [{ type, draft }] : [];
  });
  const hasAnyFact = parts.some((part) => {
    const details = part.draft.requestDetails;
    return (
      Boolean(details?.desiredProperty) ||
      Boolean(details?.currentProperty) ||
      Boolean(details?.customFields?.length) ||
      Boolean(part.draft.message?.trim())
    );
  });
  const structured = Boolean(typeLabels.length) || hasAnyFact;
  const legacy = legacyRequest?.trim() && legacyRequest.trim() !== '—'
    ? legacyRequest.trim()
    : '';
  const noteText = notes?.trim() ?? '';
  // The human remainder shown beside STRUCTURED details (deduplicated only
  // against this exact client's regenerated auto-summary lines).
  const humanNotes = visibleNotes(noteText, requestData);

  return (
    <section className={styles.requestSection} aria-label={heading}>
      <h3>{heading}</h3>
      {structured ? (
        <>
          {typeLabels.length ? (
            <div className={`${pageStyles.typePills} ${styles.pillsRow}`}>
              {typeLabels.map((label) => (
                <span key={label} className={pageStyles.typePill}>
                  {label}
                </span>
              ))}
            </div>
          ) : null}
          {parts.map(({ type, draft }) => (
            <RequestCard key={type} type={type} draft={draft} />
          ))}
          {/* Only the HUMAN remainder: auto-generated summary lines that
              duplicate the structured cards above are suppressed (see
              `visibleNotes`); every unique line survives verbatim. */}
          {humanNotes ? (
            <ClientNotesBlock label="ملاحظات العميل" notes={humanNotes} />
          ) : null}
        </>
      ) : (
        <>
          {legacy ? <p className={styles.legacyText}>{legacy}</p> : null}
          {noteText ? (
            <ClientNotesBlock
              label={legacy ? 'ملاحظات العميل' : 'تفاصيل الطلب (نص مسجّلة في ملاحظات العميل)'}
              notes={noteText}
            />
          ) : null}
          {!legacy && !noteText ? (
            <p className={styles.emptyState}>لا توجد تفاصيل طلب مسجّلة لهذا العميل.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
