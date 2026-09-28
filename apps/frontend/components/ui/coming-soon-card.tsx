import { Card } from './card';
import styles from './coming-soon.module.css';

interface Preview {
  title: string;
  description: string;
}
export function ComingSoonCard({
  title,
  description,
  note,
}: Preview & { note?: string }) {
  return (
    <Card className={styles.hero} aria-label={title}>
      <span className={styles.badge}>الإصدار القادم</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {note && <p className={styles.note}>{note}</p>}
    </Card>
  );
}
export function ComingSoonPreviews({
  items,
  label,
}: {
  items: readonly Preview[];
  label: string;
}) {
  return (
    <section className={styles.grid} aria-label={label}>
      {items.map((item) => (
        <Card key={item.title} className={styles.preview}>
          <h3>{item.title}</h3>
          <p>{item.description}</p>
          <span className={styles.status}>قادم في الإصدار القادم</span>
        </Card>
      ))}
    </section>
  );
}
