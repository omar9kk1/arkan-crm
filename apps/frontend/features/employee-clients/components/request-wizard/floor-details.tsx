import { Button } from '../../../../components/ui/button';
import type { RequestFloor } from './client-request-model';
import styles from './unified-request.module.css';

export function FloorDetails({
  floors,
  onChange,
}: {
  floors: RequestFloor[];
  onChange: (floors: RequestFloor[]) => void;
}) {
  const update = (index: number, patch: Partial<RequestFloor>) =>
    onChange(
      floors.map((floor, i) => (i === index ? { ...floor, ...patch } : floor)),
    );
  return (
    <section className={styles.wideField} aria-label="تفاصيل الأدوار">
      <h4>تفاصيل الأدوار</h4>
      <p className={styles.hint}>
        أضف اسم كل دور واكتب مكوناته. يمكنك كتابة نصف دور أو ربع دور في الاسم.
      </p>
      {floors.map((floor, index) => (
        <div className={styles.panel} key={index}>
          <div className={styles.grid}>
            <label className={`${styles.field} ${styles.wideField}`}>
              اسم الدور
              <input
                value={floor.name}
                placeholder="مثال: الأرضي أو الأول أو السطح"
                onChange={(e) => update(index, { name: e.target.value })}
              />
            </label>
            <label className={`${styles.field} ${styles.wideField}`}>
              مكونات الدور
              <textarea
                value={floor.details}
                placeholder="مثال: 3 غرف، صالة، مطبخ، حمامين"
                onChange={(e) => update(index, { details: e.target.value })}
              />
            </label>
          </div>
          <Button
            type="button"
            onClick={() => onChange(floors.filter((_, i) => i !== index))}
          >
            حذف الدور
          </Button>
        </div>
      ))}
      <Button
        type="button"
        onClick={() =>
          onChange([
            ...floors,
            {
              name: `الدور ${floors.length + 1}`,
              portion: 'FULL',
              details: '',
            },
          ])
        }
      >
        إضافة دور
      </Button>
    </section>
  );
}
