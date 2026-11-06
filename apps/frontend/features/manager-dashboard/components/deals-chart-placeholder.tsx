import type { ManagerDashboardDto } from '../../../lib/api/dashboard-types';
import { compactKwd, compactMetric } from '../dashboard-preview';
import { DashboardPanel } from './dashboard-panel';
import { SummaryMetrics } from './summary-metrics';
import styles from './dashboard.module.css';

/** Width/height of the existing SVG (unchanged visual frame). */
const CHART_WIDTH = 520;
const CHART_HEIGHT = 180;
const CHART_TOP = 20;
const CHART_BOTTOM = 160;

function chartPaths(dailyCounts: number[]): { line: string; area: string } {
  const max = dailyCounts.reduce((value, count) => Math.max(value, count), 0);
  if (dailyCounts.length === 0 || max <= 0) {
    return {
      line: `M0 ${CHART_BOTTOM} L${CHART_WIDTH} ${CHART_BOTTOM}`,
      area: `M0 ${CHART_BOTTOM} L${CHART_WIDTH} ${CHART_BOTTOM} L${CHART_WIDTH} ${CHART_HEIGHT} L0 ${CHART_HEIGHT} Z`,
    };
  }
  const points = dailyCounts.map((count, index) => {
    const x =
      dailyCounts.length === 1
        ? 0
        : (index / (dailyCounts.length - 1)) * CHART_WIDTH;
    const y =
      CHART_BOTTOM -
      (count / max) * (CHART_BOTTOM - CHART_TOP);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point}`)
    .join(' ');
  return {
    line,
    area: `${line} L${CHART_WIDTH} ${CHART_HEIGHT} L0 ${CHART_HEIGHT} Z`,
  };
}

export function DealsChartPlaceholder({
  deals,
}: {
  deals: ManagerDashboardDto['deals'];
}) {
  const paths = chartPaths(deals.dailyCounts);
  return (
    <DashboardPanel
      title="الصفقات والعمولات"
      description="أداء الصفقات خلال الفترة المختارة."
      badge={compactKwd(deals.totalCommissionInPeriod)}
      className={styles.chartCard}
    >
      <div className={styles.chart}>
        <svg
          viewBox="0 0 520 180"
          preserveAspectRatio="none"
          role="img"
          aria-label="منحنى الصفقات المغلقة خلال الفترة المختارة"
        >
          <defs>
            <linearGradient
              id="manager-preview-area"
              x1="0"
              x2="0"
              y1="0"
              y2="1"
            >
              <stop offset="0%" className={styles.areaStart} />
              <stop offset="100%" className={styles.areaEnd} />
            </linearGradient>
          </defs>
          <path className={styles.gridLine} d="M0 40H520M0 90H520M0 140H520" />
          <path fill="url(#manager-preview-area)" d={paths.area} />
          <path className={styles.chartLine} d={paths.line} />
        </svg>
      </div>
      <SummaryMetrics
        className={styles.chartSummary}
        items={[
          { label: 'صفقة', value: deals.countInPeriod },
          {
            label: 'قيمة الصفقات',
            value: compactMetric(deals.totalValueInPeriod),
          },
          {
            label: 'متوسط الصفقة',
            value: compactMetric(deals.averageValueInPeriod),
          },
        ]}
      />
    </DashboardPanel>
  );
}
