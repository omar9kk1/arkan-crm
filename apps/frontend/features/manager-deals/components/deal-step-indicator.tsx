import styles from './deals.module.css';
export function DealStepIndicator({ step }: { step: number }) {
  return (
    <ol className={styles.steps} aria-label="خطوات تسجيل الصفقة">
      {['العقار', 'العميل', 'بيانات الصفقة', 'المراجعة'].map((label, index) => (
        <li key={label} aria-current={step === index ? 'step' : undefined}>
          <span>{index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
