import { Button } from '../../../components/ui/button';
import fields from '../../employee-clients/components/clients.module.css';
import wizard from '../../employee-clients/components/request-wizard/request-wizard.module.css';

export function PropertyPasteStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <section className={wizard.pastePanel}>
      <h3>نص العقار</h3>
      <label className={fields.field}>
        Smart Paste
        <textarea
          className={wizard.message}
          maxLength={1500}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="للبيع بيت في المطلاع قطعة 8، شارع واحد، السعر 290 ألف، المالك أبو فهد..."
        />
      </label>
      <small>{value.length}/1500</small>
      <Button type="button" onClick={() => onChange('')}>
        مسح النص
      </Button>
      <small>
        يمكنك لصق الوصف أو الانتقال للإدخال اليدوي. تحليل النص غير مفعّل في هذه
        المعاينة.
      </small>
    </section>
  );
}
