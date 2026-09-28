import { GlassSelect } from '../../../components/ui/glass-select';
import { owners, type Property } from '../model';
import fields from '../../employee-clients/components/clients.module.css';
import wizard from '../../employee-clients/components/request-wizard/request-wizard.module.css';
import styles from './properties.module.css';
type Props = { draft: Property; onChange: (draft: Property) => void };
export function PropertyFormStepper({ step }: { step: number }) {
  return (
    <ol className={wizard.steps} aria-label="مراحل إضافة العقار">
      {[
        ['لصق وصف العقار', 'النص كما وصلك من المالك'],
        ['مراجعة البيانات', 'بيانات صاحب العقار والعقار'],
        ['المراجعة والإرسال', 'الصور والملخص النهائي'],
      ].map(([title, description], i) => (
        <li key={title} aria-current={step === i ? 'step' : undefined}>
          <span className={wizard.number}>{i + 1}</span>
          <div>
            <strong>{title}</strong>
            <small>{description}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}
export function OwnerFormStep({ draft: d, onChange }: Props) {
  return (
    <div className={styles.ownerFields}>
      <h3>بيانات المالك</h3>
      <label className={fields.field}>
        هل المالك موجود بالفعل؟
        <GlassSelect
          defaultValue=""
          onChange={(e) => {
            const owner = owners.find((o) => o.name === e.target.value);
            onChange({
              ...d,
              owner: owner?.name || '',
              phone: owner?.phone || '',
            });
          }}
        >
          <option value="">بيانات مالك يدويًا</option>
          {owners.map((o) => (
            <option key={o.name}>{o.name}</option>
          ))}
        </GlassSelect>
      </label>
      <label className={fields.field}>
        اسم المالك
        <input
          required
          maxLength={100}
          value={d.owner}
          onChange={(e) => onChange({ ...d, owner: e.target.value })}
        />
      </label>
      <label className={fields.field}>
        الهاتف
        <input
          required
          type="tel"
          maxLength={30}
          value={d.phone}
          onChange={(e) => onChange({ ...d, phone: e.target.value })}
        />
      </label>
      <label className={fields.field}>
        ملاحظات
        <textarea
          maxLength={1000}
          value={d.ownerNotes}
          onChange={(e) => onChange({ ...d, ownerNotes: e.target.value })}
        />
      </label>
    </div>
  );
}
export function PropertyDetailsFormStep({ draft: d, onChange }: Props) {
  return (
    <>
      <h3>بيانات العقار</h3>
      <div className={wizard.formGrid}>
        <label className={fields.field}>
          نوع العملية
          <GlassSelect
            value={d.operation}
            onChange={(e) => onChange({ ...d, operation: e.target.value })}
          >
            <option>بيع</option>
            <option>إيجار</option>
          </GlassSelect>
        </label>
        {[
          { key: 'title', label: 'اسم العقار' },
          { key: 'region', label: 'المنطقة' },
          { key: 'address', label: 'العنوان / القطعة / الشارع' },
          { key: 'area', label: 'المساحة (م²)' },
          { key: 'rooms', label: 'عدد الغرف أو الدور' },
          { key: 'price', label: 'السعر (د.ك)' },
        ].map((f) => (
          <label className={fields.field} key={f.key}>
            {f.label}
            <input
              required
              maxLength={200}
              type={f.key === 'price' || f.key === 'area' ? 'number' : 'text'}
              min="0.001"
              step="0.001"
              value={String(d[f.key as keyof Property])}
              onChange={(e) => onChange({ ...d, [f.key]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label className={fields.field}>
        الوصف
        <textarea
          maxLength={1500}
          value={d.description}
          onChange={(e) => onChange({ ...d, description: e.target.value })}
        />
      </label>
    </>
  );
}
export function PropertyReviewStep({
  draft: d,
  manager = false,
}: {
  draft: Property;
  manager?: boolean;
}) {
  return (
    <>
      <h3>الصور والمراجعة</h3>
      <div className={styles.photo}>صور placeholder — لا يوجد رفع ملفات</div>
      <dl className={styles.facts}>
        {[
          ['المالك', d.owner],
          ['الهاتف', d.phone],
          ['ملاحظات المالك', d.ownerNotes || 'لا توجد'],
          ['العقار', d.title],
          ['العملية', d.operation],
          ['المنطقة', d.region],
          ['العنوان', d.address],
          ['المساحة', `${d.area} م²`],
          ['الغرف / الدور', d.rooms],
          ['السعر', `${d.price} د.ك`],
          ['الوصف', d.description || 'لا يوجد'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p>
        {manager
          ? 'سيظهر العقار مؤقتًا ضمن العقارات المعتمدة.'
          : 'سيظهر العقار مؤقتًا بحالة بانتظار الموافقة.'}
      </p>
    </>
  );
}
