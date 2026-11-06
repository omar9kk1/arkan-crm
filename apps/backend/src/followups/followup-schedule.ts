/**
 * Centralized scheduling policy for the employee follow-ups feature (task §4,
 * §7). Everything here is PURE: dates in, decisions out — no Prisma, no
 * network, no side effects, so every threshold rule is unit-testable.
 *
 * Storage contract: all instants are UTC (`Date`). Display days are computed
 * for Asia/Kuwait (UTC+3, no DST — statutory time has not changed since
 * 2008), so «مستحقة اليوم» means the same calendar day in Kuwait regardless
 * of the server/client machine timezone.
 *
 * Timing knobs (all optional, validated by `environmentSchema`, defaults are
 * the product requirement):
 *   FOLLOWUP_PROPERTY_INTERVAL_HOURS        (72  — property due every 3 days)
 *   FOLLOWUP_PROPERTY_EMPLOYEE_WARN_HOURS   (96  — employee warning at +4 days)
 *   FOLLOWUP_PROPERTY_MANAGER_ESCALATE_HOURS(120 — manager escalation at +5 days)
 *   FOLLOWUP_CLIENT_INTERVAL_HOURS          (120 — client due every 5 days)
 *   FOLLOWUP_CLIENT_EMPLOYEE_WARN_HOURS     (144 — employee warning at +6 days)
 *   FOLLOWUP_CLIENT_MANAGER_ESCALATE_HOURS  (168 — manager escalation at +7 days)
 *   FOLLOWUP_SCAN_MINUTES                   (15  — background scan cadence)
 */

/** The four durable subject kinds (mirrors the Prisma enum). */
export type FollowUpSubjectKindName =
  | 'PROPERTY_OWNER'
  | 'CLIENT_REQUEST'
  | 'INQUIRY'
  | 'CLIENT';

export interface SchedulePolicy {
  /** Hours from a saved note/activation until the subject is next due. */
  intervalHours: number;
  /** Hours since cycle start (+Δ beyond the due interval) → employee warning. */
  employeeWarnHours: number;
  /** Hours since cycle start → manager escalation. */
  managerEscalateHours: number;
}

export const DEFAULT_SCHEDULE = {
  // Property owner: due every 3 days, employee warned on day 4, manager on day 5.
  property: { intervalHours: 72, employeeWarnHours: 96, managerEscalateHours: 120 },
  // Client request/inquiry/legacy client: due every 5 days, employee warned on
  // day 6, manager escalated on day 7.
  client: { intervalHours: 120, employeeWarnHours: 144, managerEscalateHours: 168 },
} as const satisfies Record<'property' | 'client', SchedulePolicy>;

export interface FollowUpSchedule {
  property: SchedulePolicy;
  client: SchedulePolicy;
}

const HOUR_MS = 3_600_000;

function hoursFrom(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  // A bad override must never silently shrink/flip a threshold: fall back.
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Resolves the active policy from the environment (invalid → default). */
export function resolveSchedule(
  env: NodeJS.ProcessEnv = process.env,
): FollowUpSchedule {
  return {
    property: {
      intervalHours: hoursFrom(
        env.FOLLOWUP_PROPERTY_INTERVAL_HOURS,
        DEFAULT_SCHEDULE.property.intervalHours,
      ),
      employeeWarnHours: hoursFrom(
        env.FOLLOWUP_PROPERTY_EMPLOYEE_WARN_HOURS,
        DEFAULT_SCHEDULE.property.employeeWarnHours,
      ),
      managerEscalateHours: hoursFrom(
        env.FOLLOWUP_PROPERTY_MANAGER_ESCALATE_HOURS,
        DEFAULT_SCHEDULE.property.managerEscalateHours,
      ),
    },
    client: {
      intervalHours: hoursFrom(
        env.FOLLOWUP_CLIENT_INTERVAL_HOURS,
        DEFAULT_SCHEDULE.client.intervalHours,
      ),
      employeeWarnHours: hoursFrom(
        env.FOLLOWUP_CLIENT_EMPLOYEE_WARN_HOURS,
        DEFAULT_SCHEDULE.client.employeeWarnHours,
      ),
      managerEscalateHours: hoursFrom(
        env.FOLLOWUP_CLIENT_MANAGER_ESCALATE_HOURS,
        DEFAULT_SCHEDULE.client.managerEscalateHours,
      ),
    },
  };
}

/** Background scan cadence in minutes (default 15, minimum 1). */
export function resolveScanMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.FOLLOWUP_SCAN_MINUTES);
  if (!Number.isFinite(parsed) || parsed < 1) return 15;
  return Math.floor(parsed);
}

/** The manual reminder cooldown in HOURS (default 24, minimum 1). */
export function resolveReminderCooldownHours(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return Math.max(
    1,
    hoursFrom(env.FOLLOWUP_REMINDER_COOLDOWN_HOURS, 24),
  );
}

/** Property-owner subjects use the 3-day policy; every other kind the 5-day one. */
export function policyFor(
  kind: FollowUpSubjectKindName,
  schedule: FollowUpSchedule,
): SchedulePolicy {
  return kind === 'PROPERTY_OWNER' ? schedule.property : schedule.client;
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * HOUR_MS);
}

/** The due instant produced by a note saved at `savedAt` (server time, UTC). */
export function nextDueFrom(
  savedAt: Date,
  kind: FollowUpSubjectKindName,
  schedule: FollowUpSchedule,
): Date {
  return addHours(savedAt, policyFor(kind, schedule).intervalHours);
}

/**
 * The Kuwait calendar day (`YYYY-MM-DD`) of a UTC instant.
 * Asia/Kuwait = UTC+3 with no daylight saving, so the offset is constant.
 */
export function kuwaitDayKey(date: Date): string {
  return new Date(date.getTime() + 3 * HOUR_MS).toISOString().slice(0, 10);
}

export type DueBucket = 'OVERDUE' | 'TODAY' | 'UPCOMING';

/**
 * Calendar-day due state in Kuwait time (task §1 filters):
 *   OVERDUE  = due on a previous Kuwait day («متأخرة»);
 *   TODAY    = due later today in Kuwait, any hour («مستحقة اليوم»);
 *   UPCOMING = due on a later day («قادمة»).
 * A due instant earlier today still counts as «مستحقة اليوم» — the bucket is
 * the DAY, the exact time is rendered separately; the notification thresholds
 * below remain exact-hour.
 */
export function dueBucket(nextDueAt: Date, now: Date): DueBucket {
  const due = kuwaitDayKey(nextDueAt);
  const today = kuwaitDayKey(now);
  if (due < today) return 'OVERDUE';
  if (due === today) return 'TODAY';
  return 'UPCOMING';
}

export interface EscalationInput {
  kind: FollowUpSubjectKindName;
  activatedAt: Date;
  /** First/last saved note of the CURRENT subject — null until then. */
  lastSavedAt: Date | null;
  cycle: number;
  employeeWarnedCycle: number;
  managerEscalatedCycle: number;
  now: Date;
  schedule: FollowUpSchedule;
}

export interface EscalationDecision {
  /**
   * The escalation clock start: «since the last saved follow-up/activation» —
   * the LATER of the last saved note and the (re)activation instant, so a
   * re-activated subject never measures lateness from before its reactivation.
   */
  cycleStart: Date;
  /** Whole hours since `cycleStart`. */
  sinceHours: number;
  /** Hours past the due instant (sinceHours − interval), for the copy. */
  overdueSinceDueHours: number;
  /** Fire the employee warning (once per cycle). */
  warnEmployee: boolean;
  /** Fire the manager escalation (once per cycle). */
  escalateManager: boolean;
}

/**
 * Decides whether an active subject has crossed a notification threshold in
 * its CURRENT cycle. The `*Cycle < cycle` guards are what makes every
 * threshold fire at most once per follow-up cycle; a genuinely new saved note
 * increments `cycle` and restarts eligibility (task §7).
 */
export function escalation(input: EscalationInput): EscalationDecision {
  const policy = policyFor(input.kind, input.schedule);
  const cycleStart =
    input.lastSavedAt && input.lastSavedAt > input.activatedAt
      ? input.lastSavedAt
      : input.activatedAt;
  const sinceMs = Math.max(0, input.now.getTime() - cycleStart.getTime());
  const sinceHours = Math.floor(sinceMs / HOUR_MS);
  return {
    cycleStart,
    sinceHours,
    overdueSinceDueHours: Math.max(0, sinceHours - policy.intervalHours),
    warnEmployee:
      input.employeeWarnedCycle < input.cycle &&
      sinceHours >= policy.employeeWarnHours,
    escalateManager:
      input.managerEscalatedCycle < input.cycle &&
      sinceHours >= policy.managerEscalateHours,
  };
}

function countNoun(
  value: number,
  one: string,
  two: string,
  few: string,
  many: string,
): string {
  if (value === 1) return one;
  if (value === 2) return two;
  if (value >= 3 && value <= 10) return `${value} ${few}`;
  return `${value} ${many}`;
}

/**
 * Human Arabic duration of `hours` for cards and notification bodies —
 * «ساعة/ساعتان/ساعات/ساعةً» below a day, «يوم/يومان/أيام/يومًا» beyond it.
 */
export function formatLateDuration(hours: number): string {
  const total = Math.max(0, Math.floor(hours));
  if (total < 1) return 'أقل من ساعة';
  if (total < 24) {
    return countNoun(total, 'ساعة واحدة', 'ساعتان', 'ساعات', 'ساعةً');
  }
  return countNoun(
    Math.floor(total / 24),
    'يوم واحد',
    'يومان',
    'أيام',
    'يومًا',
  );
}
