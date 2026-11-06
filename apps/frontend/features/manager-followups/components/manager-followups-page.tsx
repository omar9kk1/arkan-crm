'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ManagerPageShell } from '../../../components/layout/manager/manager-page-shell';
import { PropertiesSegmentedTabs as SegmentedTabs } from '../../../components/ui/properties-segmented-tabs';
import { FollowUpsBoard } from '../../employee-followups/components/followups-board';
import { SupervisionSection } from './supervision-section';
import { FOLLOW_UP_SUBJECT_QUERY_PARAM } from '../../notifications/notification-target';
import managerStyles from './manager-followups.module.css';

/**
 * The MANAGER follow-ups page with EXACTLY two sections:
 *
 *  - «متابعاتي»: the manager's OWN follow-ups (the properties/registered
 *    clients the manager himself is responsible for) — the COMPLETE employee
 *    experience through the shared `FollowUpsBoard` (eight tabs, filters,
 *    search, the LEFT drawer with «تسجيل متابعة»/«سجل المتابعات», the +3d
 *    owner/+5d request schedule from the server save time). Personal section
 *    writes through the same batch-save path, scoped to the manager's own
 *    subjects by the server.
 *
 *  - «متابعات الموظفين»: strict supervision over EMPLOYEE subjects —
 *    read-only + the manual «تذكير الموظف» reminders. No notes on employee
 *    subjects, no due-date/ownership/cycle edits, no history edits, ever.
 *
 * Both sections stay MOUNTED (hidden) — switching never unmounts them, so
 * unsaved drafts and loaded feeds survive every switch. The shell «تحديث»
 * reloads both through their refresh counters.
 */
export function ManagerFollowups() {
  const searchParams = useSearchParams();
  // An employee follow-up notification deep link (`?follow-up=<id>`) must
  // ALWAYS open the monitoring section — never the default «متابعاتي». It
  // works on direct URL load/refresh (URL at mount) AND when the page is
  // already open and the same link is navigated to again (URL change effect),
  // while the drawer itself lives inside `SupervisionSection`.
  const hasEmployeeDeepLink = Boolean(
    searchParams.get(FOLLOW_UP_SUBJECT_QUERY_PARAM)?.trim(),
  );
  const [section, setSection] = useState<'mine' | 'employees'>(
    hasEmployeeDeepLink ? 'employees' : 'mine',
  );
  useEffect(() => {
    if (hasEmployeeDeepLink) setSection('employees');
  }, [hasEmployeeDeepLink]);

  return (
    <ManagerPageShell
      title="المتابعات"
      description="متابعاتك الشخصية، وإشراف شامل على متابعات الموظفين مع تذكير الموظف للمتأخرة."
    >
      <div className={managerStyles.sectionSwitcher}>
        <SegmentedTabs
          id="manager-followups-section-tabs"
          label="قسما المتابعات"
          value={section}
          onChange={(value) =>
            setSection(value === 'employees' ? 'employees' : 'mine')
          }
          items={[
            { id: 'mine', label: 'متابعاتي' },
            { id: 'employees', label: 'متابعات الموظفين' },
          ]}
        />
      </div>

      {/* BOTH sections stay mounted: `hidden` (not `display:none` children
          trees) so their state — notes drafts, loaded feeds, open drawers —
          survives every switch untouched. */}
      <div hidden={section !== 'mine'} aria-hidden={section !== 'mine'}>
        <FollowUpsBoard
          propertyBase="/manager"
          refreshSignal={0}
          toolbarLayout="inline"
        />
      </div>
      <div
        hidden={section !== 'employees'}
        aria-hidden={section !== 'employees'}
      >
        <SupervisionSection refreshSignal={0} />
      </div>
    </ManagerPageShell>
  );
}
