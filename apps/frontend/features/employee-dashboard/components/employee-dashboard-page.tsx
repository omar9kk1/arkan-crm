'use client';
import { Toast } from '../../../components/ui/toast';

import { useEffect, useState } from 'react';
import { EmployeePageShell } from '../../../components/layout/employee/employee-page-shell';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { EmployeeStatCard } from './dashboard-cards';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';

import { EmployeeTodayTasks } from './employee-today-tasks';
import { EmployeeQuickActions } from './employee-quick-actions';
import { EmployeePropertyRecommendations } from './employee-property-recommendations';
import { EmployeeNeedsAttention } from './employee-needs-attention';
import { EmployeeAchievementsToday } from './employee-achievements-today';
import { EmployeeApprovalTracking } from './employee-approval-tracking';
import { EmployeeDashboardAlerts } from './employee-dashboard-alerts';
import styles from './employee-dashboard.module.css';
import { getClientStats } from '../../../lib/api/clients-api';
import { authorizedRequest } from '../../../lib/api/authorized';
import { listFollowUps } from '../../../lib/api/followups-api';

type LoadState = 'loading' | 'ok' | 'error';

export function EmployeeDashboardPage() {
  const [detail, setDetail] = useState<{
    title: string;
    lines: string[];
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [clientsState, setClientsState] = useState<LoadState>('loading');
  const [propertiesState, setPropertiesState] = useState<LoadState>('loading');
  const [followupsState, setFollowupsState] = useState<LoadState>('loading');
  const [clientsCount, setClientsCount] = useState<number | null>(null);
  const [propertiesCount, setPropertiesCount] = useState<number | null>(null);
  const [upcomingCount, setUpcomingCount] = useState<number | null>(null);
  const [overdueCount, setOverdueCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      // clients
      try {
        const stats = await getClientStats();
        if (!active) return;
        setClientsCount(
          typeof stats.totalClients === 'number' ? stats.totalClients : 0,
        );
        setClientsState('ok');
      } catch {
        if (active) {
          setClientsCount(null);
          setClientsState('error');
        }
      }
      // properties (authoritative count)
      try {
        const res = await authorizedRequest<number>(
          '/properties/stats/mine',
        );
        if (!active) return;
        setPropertiesCount(typeof res === 'number' ? res : 0);
        setPropertiesState('ok');
      } catch {
        if (active) {
          setPropertiesCount(null);
          setPropertiesState('error');
        }
      }
      // followups
      try {
        const followups = await listFollowUps();
        if (!active) return;
        let upcoming = 0;
        let overdue = 0;
        for (const item of followups.items) {
          if (item.bucket === 'OVERDUE') overdue += 1;
          else upcoming += 1;
        }
        setUpcomingCount(upcoming);
        setOverdueCount(overdue);
        setFollowupsState('ok');
      } catch {
        if (active) {
          setUpcomingCount(null);
          setOverdueCount(null);
          setFollowupsState('error');
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const display = (state: LoadState, value: number | null) => {
    if (state === 'loading') return '…';
    if (state === 'error') return '—';
    return value ?? 0;
  };

  return (
    <EmployeePageShell description="" typewriter>
      <EmployeeQuickActions />
      <div className={styles.stats}>
        <EmployeeStatCard
          title="العملاء المسؤول عنهم"
          value={display(clientsState, clientsCount)}
        />
        <EmployeeStatCard
          title="العقارات المخصصة له"
          value={display(propertiesState, propertiesCount)}
        />
        <EmployeeStatCard
          title="المتابعات القادمة"
          value={display(followupsState, upcomingCount)}
        />
        <EmployeeStatCard
          title="المتابعات المتأخرة"
          value={display(followupsState, overdueCount)}
        />
      </div>
      <EmployeeTodayTasks />
      <EmployeeAchievementsToday />
      <div className={styles.sections}>
        <section>
          <h2>المتابعات القادمة</h2>
          <Card>
            <p className={styles.recsEmpty}>لا توجد متابعات قادمة</p>
          </Card>
        </section>
        <section>
          <EmployeePropertyRecommendations />
        </section>
        <section>
          <EmployeeNeedsAttention />
        </section>
        <section>
          <EmployeeDashboardAlerts />
        </section>
      </div>
      <EmployeeApprovalTracking />
      {detail && (
        <PropertyOverlay
          title={detail.title}
          drawer
          onClose={() => {
            setDetail(null);
            setNotice('');
          }}
        >
          <div className={styles.list}>
            {detail.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <Button
            onClick={() => setNotice('معاينة فقط — سيتم تفعيل الإجراء لاحقًا')}
          >
            متابعة
          </Button>
          <Toast message={notice} onDismiss={() => setNotice('')} />
        </PropertyOverlay>
      )}
      {!detail && <Toast message={notice} onDismiss={() => setNotice('')} />}
    </EmployeePageShell>
  );
}