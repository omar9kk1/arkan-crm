import { DashboardPanel } from './dashboard-panel';
import { SummaryMetrics } from './summary-metrics';
import styles from './dashboard.module.css';
export function DealsChartPlaceholder() {
  return (
    <DashboardPanel
      title="الصفقات والعمولات"
      description="أداء الصفقات خلال الشهر الحالي."
      badge="18.6K د.ك"
      className={styles.chartCard}
    >
      <div className={styles.chart}>
        <svg
          viewBox="0 0 520 180"
          preserveAspectRatio="none"
          role="img"
          aria-label="منحنى توضيحي ببيانات تجريبية للصفقات، وليس أداءً فعليًا"
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
          <path
            fill="url(#manager-preview-area)"
            d="M0 142 C70 120 95 125 140 92 C190 56 230 80 280 64 C340 42 390 68 430 38 C470 12 500 25 520 18 L520 180 L0 180 Z"
          />
          <path
            className={styles.chartLine}
            d="M0 142 C70 120 95 125 140 92 C190 56 230 80 280 64 C340 42 390 68 430 38 C470 12 500 25 520 18"
          />
        </svg>
      </div>
      <SummaryMetrics
        className={styles.chartSummary}
        items={[
          { label: 'صفقة', value: 14 },
          { label: 'قيمة الصفقات', value: '1.84M' },
          { label: 'متوسط الصفقة', value: '131K' },
        ]}
      />
    </DashboardPanel>
  );
}
