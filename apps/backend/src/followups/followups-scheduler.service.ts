import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  FOLLOWUP_EVENT_TITLES,
  followUpEmployeeBody,
  followUpEventKeys,
  followUpManagerBody,
  type NotificationDraft,
} from '../notifications/notification-events';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FollowUpsService } from './followups.service';
import {
  escalation,
  formatLateDuration,
  kuwaitDayKey,
  resolveScanMinutes,
  resolveSchedule,
  type FollowUpSchedule,
} from './followup-schedule';
import { parseTargetKey, subjectLabel } from './followup-subjects';

/**
 * Backend scheduling for the follow-ups feature (task §7).
 *
 * A single in-process timer (the same pattern as `PushDispatcherService`) —
 * no client-side timers, no new dependencies. Every pass:
 *   1. probes the follow-up tables (missing migration → warn ONCE, no spam),
 *   2. re-syncs subjects company-wide (idempotent materialization),
 *   3. evaluates escalation thresholds and COMMITS each subject's notification
 *      drafts together with its cycle flags in ONE transaction.
 *
 * Exactly-once per cycle per recipient comes from two independent layers:
 * the `(userId, eventKey)` unique where eventKey carries `(subjectId, cycle)`,
 * and the conditional `employeeWarnedCycle/managerEscalatedCycle < cycle`
 * update — so restarts, duplicate jobs, retries and polling can never spam.
 * Eligibility re-arms only when a genuinely new note increments `cycle`.
 *
 * Timing is centralized in `followup-schedule.ts` (env-overridable, validated).
 */
@Injectable()
export class FollowUpSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FollowUpSchedulerService.name);
  private readonly schedule: FollowUpSchedule = resolveSchedule();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private missingSchemaWarned = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly followUps: FollowUpsService,
  ) {}

  onModuleInit(): void {
    // Test suites drive `runOnce()` explicitly; never race them with a timer.
    if (process.env.NODE_ENV === 'test') return;
    const minutes = resolveScanMinutes();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, minutes * 60_000);
    this.timer.unref?.();
    // First pass shortly after boot (grace for migrations/app start).
    const boot = setTimeout(() => {
      void this.runOnce();
    }, 20_000);
    boot.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One full pass. Public so focused tests can drive it deterministically. */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!(await this.schemaReady())) return;
      await this.followUps.sync(null);
      await this.evaluateEscalations();
    } catch (error) {
      this.logger.error(
        `Follow-up scan failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * True while migration `20261024120000_follow_up_subjects` is missing:
   * logs ONCE (approval is an owner action — never retried as spam) and the
   * scan simply stays idle until the tables exist.
   */
  private async schemaReady(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1 FROM "FollowUpSubject" LIMIT 1`;
      this.missingSchemaWarned = false;
      return true;
    } catch {
      if (!this.missingSchemaWarned) {
        this.missingSchemaWarned = true;
        this.logger.warn(
          'Follow-up tables missing — migration 20261024120000_follow_up_subjects has NOT been applied (awaiting explicit approval). Late notifications stay idle.',
        );
      }
      return false;
    }
  }

  private async evaluateEscalations(): Promise<void> {
    const now = new Date();
    const subjects = await this.prisma.followUpSubject.findMany({
      where: { active: true, responsibleId: { not: null } },
      take: 2000,
      orderBy: [{ nextDueAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        kind: true,
        targetKey: true,
        activatedAt: true,
        lastSavedAt: true,
        nextDueAt: true,
        cycle: true,
        employeeWarnedCycle: true,
        managerEscalatedCycle: true,
        responsible: { select: { user: { select: { id: true, name: true, isActive: true } } } },
        property: {
          select: {
            id: true,
            reference: true,
            owner: { select: { name: true } },
            contact: { select: { name: true } },
          },
        },
        client: { select: { id: true, name: true } },
      },
    });
    if (subjects.length === 0) return;

    const managers = await this.prisma.user.findMany({
      where: { role: Role.MANAGER, isActive: true },
      select: { id: true },
    });

    const drafts: NotificationDraft[] = [];
    const warnFlags: Array<{ id: string; cycle: number }> = [];
    const escalateFlags: Array<{ id: string; cycle: number }> = [];

    for (const subject of subjects) {
      const decision = escalation({
        kind: subject.kind,
        activatedAt: subject.activatedAt,
        lastSavedAt: subject.lastSavedAt,
        cycle: subject.cycle,
        employeeWarnedCycle: subject.employeeWarnedCycle,
        managerEscalatedCycle: subject.managerEscalatedCycle,
        now,
        schedule: this.schedule,
      });
      if (!decision.warnEmployee && !decision.escalateManager) continue;

      const parsed = parseTargetKey(subject.targetKey);
      const label = subjectLabel({
        kind: subject.kind,
        requestType: parsed?.requestType ?? null,
        reference: subject.property?.reference,
        clientName: subject.client?.name,
      });
      const personName =
        subject.property?.contact?.name ?? subject.property?.owner?.name ?? null;
      const hint =
        subject.kind === 'PROPERTY_OWNER' && personName
          ? `${label} (${personName})`
          : label;
      const overdueDuration = formatLateDuration(decision.overdueSinceDueHours);
      const propertyId = subject.property?.id ?? null;
      const clientId = subject.client?.id ?? null;

      if (decision.warnEmployee && subject.responsible?.user.isActive) {
        drafts.push({
          userId: subject.responsible.user.id,
          type: 'FOLLOWUP_EMPLOYEE_LATE',
          title: FOLLOWUP_EVENT_TITLES.FOLLOWUP_EMPLOYEE_LATE,
          body: followUpEmployeeBody(hint, overdueDuration),
          propertyId,
          clientId,
          followUpSubjectId: subject.id,
          eventKey: followUpEventKeys.employeeLate(subject.id, subject.cycle),
        });
        warnFlags.push({ id: subject.id, cycle: subject.cycle });
      }
      if (decision.escalateManager) {
        for (const manager of managers) {
          drafts.push({
            userId: manager.id,
            type: 'FOLLOWUP_MANAGER_ESCALATION',
            title: FOLLOWUP_EVENT_TITLES.FOLLOWUP_MANAGER_ESCALATION,
            body: followUpManagerBody({
              employeeName:
                subject.responsible?.user.name ?? '',
              label,
              dueDay: kuwaitDayKey(subject.nextDueAt),
              overdueDuration,
            }),
            propertyId,
            clientId,
            // Masked to `null` for managers by the inbox serializer — kept on
            // the row so the event stays self-describing and deduplicated.
            followUpSubjectId: subject.id,
            eventKey: followUpEventKeys.managerEscalation(
              subject.id,
              subject.cycle,
            ),
          });
        }
        escalateFlags.push({ id: subject.id, cycle: subject.cycle });
      }
    }
    if (drafts.length === 0) return;

    // ONE transaction: notifications and their cycle flags commit together —
    // a crash between them is impossible, and a re-run before commit writes
    // nothing at all (both sides are idempotent anyway).
    await this.prisma.$transaction(async (tx) => {
      await this.notifications.deliverFollowUpDrafts(tx, drafts);
      for (const flag of warnFlags) {
        await tx.followUpSubject.updateMany({
          where: { id: flag.id, employeeWarnedCycle: { lt: flag.cycle } },
          data: { employeeWarnedCycle: flag.cycle },
        });
      }
      for (const flag of escalateFlags) {
        await tx.followUpSubject.updateMany({
          where: { id: flag.id, managerEscalatedCycle: { lt: flag.cycle } },
          data: { managerEscalatedCycle: flag.cycle },
        });
      }
    });
    this.logger.log(
      `Follow-up escalation pass: subjects=${subjects.length} notifications=${drafts.length} warnings=${warnFlags.length} escalations=${escalateFlags.length}`,
    );
  }
}
