import {
  DEFAULT_SCHEDULE,
  dueBucket,
  escalation,
  formatLateDuration,
  policyFor,
  resolveSchedule,
} from '../src/followups/followup-schedule';
import {
  parseTargetKey,
  requestTypesOf,
  subjectLabel,
  subjectTargetKey,
  tabsOf,
} from '../src/followups/followup-subjects';

const HOUR = 3_600_000;

/**
 * Pure policy/derivation units of the employee follow-ups feature — no
 * database, no network: every threshold/identity rule is deterministic.
 */
describe('followup schedule policy', () => {
  it('defaults to the product timings (property 3/4/5 days, client 5/6/7 days)', () => {
    const schedule = resolveSchedule({});
    expect(schedule).toEqual(DEFAULT_SCHEDULE);
    expect(policyFor('PROPERTY_OWNER', schedule)).toEqual(DEFAULT_SCHEDULE.property);
    expect(policyFor('CLIENT_REQUEST', schedule)).toEqual(DEFAULT_SCHEDULE.client);
    expect(policyFor('INQUIRY', schedule)).toEqual(DEFAULT_SCHEDULE.client);
    expect(policyFor('CLIENT', schedule)).toEqual(DEFAULT_SCHEDULE.client);
  });

  it('honors valid env overrides and ignores invalid values', () => {
    const schedule = resolveSchedule({
      FOLLOWUP_PROPERTY_INTERVAL_HOURS: '48',
      FOLLOWUP_CLIENT_EMPLOYEE_WARN_HOURS: '200',
      FOLLOWUP_SCAN_MINUTES: '5',
    });
    expect(schedule.property.intervalHours).toBe(48);
    expect(schedule.client.employeeWarnHours).toBe(200);
    // Invalid/zero/negative overrides never shrink a threshold.
    expect(
      resolveSchedule({ FOLLOWUP_PROPERTY_INTERVAL_HOURS: 'nope' }).property
        .intervalHours,
    ).toBe(DEFAULT_SCHEDULE.property.intervalHours);
    expect(
      resolveSchedule({ FOLLOWUP_PROPERTY_MANAGER_ESCALATE_HOURS: '0' })
        .property.managerEscalateHours,
    ).toBe(DEFAULT_SCHEDULE.property.managerEscalateHours);
  });

  it('buckets due dates into Kuwait calendar days', () => {
    const now = new Date('2026-01-15T20:00:00Z'); // 23:00 Kuwait
    // Due at 23:30 Kuwait the SAME day → مُستحقة اليوم.
    expect(dueBucket(new Date('2026-01-15T20:30:00Z'), now)).toBe('TODAY');
    // Due yesterday in Kuwait → متأخرة (the DAY decides, not the raw instant).
    expect(dueBucket(new Date('2026-01-14T10:00:00Z'), now)).toBe('OVERDUE');
    // Tomorrow Kuwait → قادمة.
    expect(dueBucket(new Date('2026-01-16T01:00:00Z'), now)).toBe('UPCOMING');
  });

  it('escalates exactly at the contractual hours since the cycle start', () => {
    const schedule = resolveSchedule({});
    const activated = new Date('2026-01-01T00:00:00Z');
    const at = (hours: number) => new Date(activated.getTime() + hours * HOUR);
    const input = (now: Date, overrides: Record<string, number> = {}) => ({
      kind: 'PROPERTY_OWNER' as const,
      activatedAt: activated,
      lastSavedAt: null,
      cycle: 1,
      employeeWarnedCycle: 0,
      managerEscalatedCycle: 0,
      now,
      schedule,
      ...overrides,
    });
    // Due at 72h, no escalation before 96h.
    expect(escalation(input(at(71))).warnEmployee).toBe(false);
    expect(escalation(input(at(96))).warnEmployee).toBe(true);
    expect(escalation(input(at(119))).escalateManager).toBe(false);
    expect(escalation(input(at(120))).escalateManager).toBe(true);
    // Client thresholds (5/6/7 days).
    const client = (now: Date) => escalation({ ...input(now), kind: 'CLIENT_REQUEST' });
    expect(client(at(143)).warnEmployee).toBe(false);
    expect(client(at(144)).warnEmployee).toBe(true);
    expect(client(at(167)).escalateManager).toBe(false);
    expect(client(at(168)).escalateManager).toBe(true);
  });

  it('warn/escalate at most ONCE per cycle and re-arm on a new cycle', () => {
    const schedule = resolveSchedule({});
    const activated = new Date('2026-01-01T00:00:00Z');
    const now = new Date(activated.getTime() + 200 * HOUR);
    const once = escalation({
      kind: 'PROPERTY_OWNER',
      activatedAt: activated,
      lastSavedAt: null,
      cycle: 3,
      employeeWarnedCycle: 3, // already warned this cycle
      managerEscalatedCycle: 2,
      now,
      schedule,
    });
    expect(once.warnEmployee).toBe(false);
    expect(once.escalateManager).toBe(true);
    // A genuinely new note increments cycle → eligibility restarts.
    const rearmed = escalation({
      kind: 'PROPERTY_OWNER',
      activatedAt: activated,
      lastSavedAt: null,
      cycle: 4,
      employeeWarnedCycle: 3,
      managerEscalatedCycle: 2,
      now,
      schedule,
    });
    expect(rearmed.warnEmployee).toBe(true);
    expect(rearmed.escalateManager).toBe(true);
  });

  it('measures lateness from the LATER of last save and activation', () => {
    const schedule = resolveSchedule({});
    const activated = new Date('2026-01-01T00:00:00Z');
    const lastSave = new Date('2026-01-05T00:00:00Z'); // after activation
    const now = new Date(lastSave.getTime() + 96 * HOUR);
    const decision = escalation({
      kind: 'PROPERTY_OWNER',
      activatedAt: activated,
      lastSavedAt: lastSave,
      cycle: 2,
      employeeWarnedCycle: 1,
      managerEscalatedCycle: 0,
      now,
      schedule,
    });
    // From the SAVED note, not from re-activation.
    expect(decision.warnEmployee).toBe(true);
    expect(decision.sinceHours).toBe(96);
    // A re-activation later than the last note restarts the clock.
    const later = escalation({
      kind: 'PROPERTY_OWNER',
      activatedAt: new Date('2026-01-09T00:00:00Z'),
      lastSavedAt: lastSave,
      cycle: 3,
      employeeWarnedCycle: 2,
      managerEscalatedCycle: 2,
      now: new Date(new Date('2026-01-09T00:00:00Z').getTime() + 30 * HOUR),
      schedule,
    });
    expect(later.warnEmployee).toBe(false);
  });

  it('formats Arabic durations of lateness', () => {
    expect(formatLateDuration(0)).toBe('أقل من ساعة');
    expect(formatLateDuration(1)).toBe('ساعة واحدة');
    expect(formatLateDuration(2)).toBe('ساعتان');
    expect(formatLateDuration(5)).toBe('5 ساعات');
    expect(formatLateDuration(24)).toBe('يوم واحد');
    expect(formatLateDuration(48)).toBe('يومان');
    expect(formatLateDuration(96)).toBe('4 أيام');
    expect(formatLateDuration(168)).toBe('7 أيام');
  });
});

describe('followup subject derivation', () => {
  it('reads ONLY the structured document for request types (never notes)', () => {
    expect(requestTypesOf(null)).toEqual([]);
    expect(requestTypesOf('not json')).toEqual([]);
    expect(requestTypesOf('["BUYER"]')).toEqual([]);
    expect(requestTypesOf('{"types":"BUYER"}')).toEqual([]);
    expect(
      requestTypesOf(JSON.stringify({ version: 1, types: ['BUYER', 'EXCHANGER', 'BUYER'] })),
    ).toEqual(['BUYER', 'EXCHANGER']);
    // The canonical order is stable regardless of the stored order.
    expect(
      requestTypesOf(JSON.stringify({ types: ['RENTER', 'BUYER'] })),
    ).toEqual(['BUYER', 'RENTER']);
    // Free-text notes are NEVER parsed into a type.
    expect(requestTypesOf('سأحاول أن أشتري لاحقًا')).toEqual([]);
  });

  it('derives target keys and parses them back', () => {
    expect(subjectTargetKey.property('P1')).toBe('PROPERTY_OWNER:P1');
    expect(subjectTargetKey.clientRequest('C1', 'BUYER')).toBe('CLIENT_REQUEST:C1:BUYER');
    expect(subjectTargetKey.inquiry('I1')).toBe('INQUIRY:I1');
    expect(subjectTargetKey.client('C1')).toBe('CLIENT:C1');
    expect(parseTargetKey('PROPERTY_OWNER:P1')).toEqual({ kind: 'PROPERTY_OWNER' });
    expect(parseTargetKey('CLIENT_REQUEST:C1:BUYER')).toEqual({
      kind: 'CLIENT_REQUEST',
      clientId: 'C1',
      requestType: 'BUYER',
    });
    expect(parseTargetKey('CLIENT_REQUEST:C1:SELLER')).toBeNull();
    expect(parseTargetKey('PROPERTY_OWNER')).toBeNull();
    expect(parseTargetKey('UNKNOWN:P1')).toBeNull();
  });

  it('maps each subject kind to its tabs (one subject, several relevant tabs)', () => {
    expect(tabsOf('PROPERTY_OWNER', null, 'SALE')).toEqual(['owners', 'sellers']);
    expect(tabsOf('PROPERTY_OWNER', null, 'RENT')).toEqual(['owners', 'lessors']);
    expect(tabsOf('PROPERTY_OWNER', null, 'EXCHANGE')).toEqual(['owners']);
    expect(tabsOf('CLIENT_REQUEST', 'BUYER')).toEqual(['buyers']);
    expect(tabsOf('CLIENT_REQUEST', 'RENTER')).toEqual(['renters']);
    expect(tabsOf('CLIENT_REQUEST', 'EXCHANGER')).toEqual(['exchanges']);
    expect(tabsOf('INQUIRY')).toEqual(['inquiries']);
    // Legacy clients are visible in «الكل» only — structure is never guessed.
    expect(tabsOf('CLIENT')).toEqual([]);
  });

  it('builds stable Arabic display labels', () => {
    expect(subjectLabel({ kind: 'PROPERTY_OWNER', reference: 'A-000012' })).toBe(
      'مالك العقار A-000012',
    );
    expect(subjectLabel({ kind: 'INQUIRY', reference: 'A-000012' })).toBe(
      'استفسار عن العقار A-000012',
    );
    expect(
      subjectLabel({ kind: 'CLIENT_REQUEST', requestType: 'BUYER', clientName: 'أحمد' }),
    ).toBe('طلب شراء — أحمد');
    expect(subjectLabel({ kind: 'CLIENT', clientName: 'فاطمة' })).toBe(
      'متابعة عميل فاطمة',
    );
    expect(subjectLabel({ kind: 'CLIENT' })).toBe('متابعة عميل —');
  });
});
