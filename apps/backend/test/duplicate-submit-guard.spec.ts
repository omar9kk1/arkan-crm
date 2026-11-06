import {
  DuplicateSubmitGuard,
  newSubmissionKey,
  submissionFingerprint,
} from '../../frontend/features/employee-properties/components/duplicate-submit-guard';

/**
 * Pure client-side gate for the Employee Add Property form. These tests model
 * the exact submit path: every attempt first asks the guard whether it may send
 * a request. A blocked attempt must never increment the request counter.
 */
describe('DuplicateSubmitGuard', () => {
  const payload = () => ({
    listingType: 'SALE',
    governorate: 'الجهراء',
    district: 'مدينة المطلاع',
    block: '8',
    plotNumber: '22',
    sizeSqm: '300',
    description: '{\n  "operation": "بيع",\n  "plotNumber": "22"\n}',
    floors: [{ type: 'GROUND', details: 'صالة ومجلس' }],
    newContact: { type: 'OWNER', name: 'Same Owner', phone: '61112222' },
  });

  const counter = () => {
    let keys = 0;
    return {
      next: () => `guard-key-${++keys}`,
      count: () => keys,
    };
  };

  it('treats whitespace and key order as the same submission data', () => {
    const a = payload();
    const b = {
      ...a,
      block: '  8  ',
      plotNumber: ' 22 ',
      description: '{\n  "operation": "بيع",\n  "plotNumber": " 22 "\n}',
      floors: [{ details: ' صالة   ومجلس ', type: 'GROUND' }],
    };
    expect(submissionFingerprint(a)).toBe(submissionFingerprint(b));
  });

  it('normalizes the exchange description envelope too', () => {
    const marker = '=== العقار المطلوب في البدل ===';
    const envelope = (area: string) =>
      JSON.stringify({ operation: 'بدل', requestedProperty: { area } });
    const a = {
      ...payload(),
      description: `${envelope('300')}\n\n${marker}\nالمساحة: 300 م²`,
    };
    const b = {
      ...payload(),
      description: `${envelope(' 300 ')}\n\n${marker}\nالمساحة:   300   م²`,
    };
    expect(submissionFingerprint(a)).toBe(submissionFingerprint(b));
  });

  it('blocks ten repeated clicks and Enter submits after the first 409', () => {
    const guard = new DuplicateSubmitGuard();
    const rejected = payload();
    guard.markRejected(rejected);

    let requests = 0;
    for (let click = 0; click < 10; click += 1) {
      if (!guard.blocks(rejected)) requests += 1;
    }
    // Enter is the same submit path; ten more blocked attempts.
    for (let enter = 0; enter < 10; enter += 1) {
      if (!guard.blocks(rejected)) requests += 1;
    }
    expect(requests).toBe(0);
    expect(guard.locked).toBe(true);
  });

  it('does not unlock or rotate the operation id for a whitespace-only change', () => {
    const keys = counter();
    const guard = new DuplicateSubmitGuard(keys.next);
    const rejected = payload();
    const initialId = guard.id;
    guard.markRejected(rejected);

    const result = guard.reevaluate({
      ...rejected,
      block: '  8 ',
      description: rejected.description.replace('22', ' 22 '),
    });
    expect(result).toEqual({ changed: false, locked: true });
    expect(guard.blocks(rejected)).toBe(true);
    expect(guard.id).toBe(initialId);
    expect(keys.count()).toBe(1); // only the constructor key
  });

  it('unlocks and rotates the key exactly once for a real change', () => {
    const keys = counter();
    const guard = new DuplicateSubmitGuard(keys.next);
    const rejected = payload();
    const initialId = guard.id;
    guard.markRejected(rejected);

    const changed = { ...rejected, plotNumber: '23' };
    const result = guard.reevaluate(changed);
    expect(result).toEqual({ changed: true, locked: false });
    expect(guard.blocks(changed)).toBe(false);
    expect(guard.id).not.toBe(initialId);
    expect(keys.count()).toBe(2);

    // Further edits before the request reuse the fresh, still-unused key.
    const another = { ...changed, block: '9' };
    expect(guard.reevaluate(another)).toEqual({
      changed: false,
      locked: false,
    });
    expect(keys.count()).toBe(2);
  });

  it('locks again when the employee restores the rejected values', () => {
    const keys = counter();
    const guard = new DuplicateSubmitGuard(keys.next);
    const rejected = payload();
    guard.markRejected(rejected);
    const changed = { ...rejected, plotNumber: '23' };
    guard.reevaluate(changed);
    const changedId = guard.id;

    const revert = guard.reevaluate(rejected);
    expect(revert).toEqual({ changed: true, locked: true });
    expect(guard.blocks(rejected)).toBe(true);
    // Reverting is not a new submission, so it must not rotate again.
    expect(guard.id).toBe(changedId);
    expect(keys.count()).toBe(2);
  });

  it('applies the same lock after a second 409 on the corrected data', () => {
    const keys = counter();
    const guard = new DuplicateSubmitGuard(keys.next);
    const first = payload();
    guard.markRejected(first);

    const corrected = { ...first, plotNumber: '24' };
    guard.reevaluate(corrected);
    let requests = 0;
    if (!guard.blocks(corrected)) requests += 1;
    expect(requests).toBe(1);

    guard.markRejected(corrected);
    expect(guard.locked).toBe(true);
    for (let click = 0; click < 10; click += 1) {
      if (!guard.blocks(corrected)) requests += 1;
    }
    expect(requests).toBe(1);
  });

  it('generates non-empty unique operation ids', () => {
    const first = newSubmissionKey();
    const second = newSubmissionKey();
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(second).not.toBe(first);
  });
});
