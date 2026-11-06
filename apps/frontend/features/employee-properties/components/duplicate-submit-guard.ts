/**
 * Pure guard for the Employee "Add Property" submit action.
 *
 * A confirmed-duplicate 409 is a COMPLETED answer for the payload that was
 * sent. Until the payload genuinely changes, every submit path (click, Enter,
 * programmatic form submit) must be blocked locally, with no API request.
 *
 * Whitespace-only edits, key-order changes and null/undefined/empty-string
 * equivalents are not meaningful changes.
 */

/** A stable, human-safe id for one logical create operation. */
export function newSubmissionKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  return `submit-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Normalize strings/objects so semantically equal payloads compare equal. */
export function normalizeSubmissionValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const raw = value;
    // Exchange listings append a readable requested-property block after the
    // structured JSON. Compare the JSON part structurally and the readable
    // text with whitespace normalization.
    const marker = '=== العقار المطلوب في البدل ===';
    const markerAt = raw.indexOf(marker);
    if (markerAt !== -1) {
      try {
        return {
          envelope: normalizeSubmissionValue(
            JSON.parse(raw.slice(0, markerAt).trim()),
          ),
          requested: normalizeSubmissionValue(
            raw.slice(markerAt + marker.length),
          ),
        };
      } catch {
        /* Legacy free text: fall through to normalized text. */
      }
    }
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text === '') return null;
    // The wizard stores a structured JSON description. Compare it structurally
    // so a whitespace-only edit inside a value is not a "change".
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return normalizeSubmissionValue(JSON.parse(text));
      } catch {
        /* Legacy free text: fall through to normalized text. */
      }
    }
    return text;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalizeSubmissionValue);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const normalized = normalizeSubmissionValue(record[key]);
        // An absent key and an empty value are the same submission data.
        if (normalized !== null) result[key] = normalized;
        return result;
      }, {});
  }
  return null;
}

/** Stable comparison string for a submission payload (never sent anywhere). */
export function submissionFingerprint(payload: unknown): string {
  return JSON.stringify(normalizeSubmissionValue(payload));
}

export interface DuplicateSubmitStatus {
  /** Fingerprint of the payload that received the confirmed-duplicate 409. */
  rejectedFingerprint: string | null;
  /** True while the current payload is still the rejected one. */
  locked: boolean;
}

export interface ReevaluateResult {
  /** True when the lock changed, so React must re-render the button. */
  changed: boolean;
  locked: boolean;
}

/**
 * Stateful guard. The component keeps one instance in a ref and mirrors
 * `locked` into React state for rendering.
 */
export class DuplicateSubmitGuard {
  private status: DuplicateSubmitStatus = {
    rejectedFingerprint: null,
    locked: false,
  };
  private operationId: string;

  constructor(private readonly idFactory: () => string = newSubmissionKey) {
    this.operationId = this.idFactory();
  }

  /** The Idempotency-Key for the CURRENT logical operation. */
  get id(): string {
    return this.operationId;
  }

  get locked(): boolean {
    return this.status.locked;
  }

  /** Record a confirmed-duplicate 409 for this payload. */
  markRejected(payload: unknown): void {
    this.status = {
      rejectedFingerprint: submissionFingerprint(payload),
      locked: true,
    };
  }

  /**
   * Re-evaluate on every form change:
   * - same payload (including whitespace-only edits) -> stay locked;
   * - genuinely different payload -> unlock and allocate ONE new operation id;
   * - reverting to the rejected payload -> lock again, without a new id.
   */
  reevaluate(payload: unknown): ReevaluateResult {
    if (!this.status.rejectedFingerprint) {
      return { changed: false, locked: false };
    }
    const matches =
      submissionFingerprint(payload) === this.status.rejectedFingerprint;
    const changed = matches !== this.status.locked;
    this.status = { ...this.status, locked: matches };
    if (changed && !matches) this.operationId = this.idFactory();
    return { changed, locked: matches };
  }

  /** True when this payload must not produce a request. */
  blocks(payload: unknown): boolean {
    return (
      this.status.rejectedFingerprint !== null &&
      submissionFingerprint(payload) === this.status.rejectedFingerprint
    );
  }
}
