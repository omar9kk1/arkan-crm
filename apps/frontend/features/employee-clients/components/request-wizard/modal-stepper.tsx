import styles from './request-wizard.module.css';
export function ModalStepper({ step }: { step: number }) {
  return (
    <ol className={styles.steps} aria-label="خطوات إضافة العميل">
      {[
        ['لصق رسالة العميل', 'النص كما وصل للموظف'],
        ['مراجعة البيانات', 'بيانات العميل والطلب'],
        ['المطابقة والحفظ', 'العقارات المناسبة والإشعارات'],
      ].map(([title, description], index) => (
        <li key={title} aria-current={step === index ? 'step' : undefined}>
          <span className={styles.number}>{index + 1}</span>
          <div>
            <strong>{title}</strong>
            <small>{description}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}
