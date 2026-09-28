import { SuitablePropertyMiniCard } from '../client-cards';
import { sampleProperties, type RequestDraft } from './model';
import fields from '../clients.module.css';
export function ClientReviewStep({ draft }: { draft: RequestDraft }) {
  return (
    <>
      <h3>مراجعة العميل والطلب</h3>
      <dl className={fields.facts}>
        {[
          ['الاسم', draft.name],
          ['الهاتف', draft.phone],
          ['نوع الطلب', draft.type],
          ['المنطقة', draft.area],
          ['الميزانية', `${draft.budget} د.ك`],
          [
            'طريقة الإضافة',
            draft.mode === 'new'
              ? 'طلب جديد'
              : `مرتبط بعقار: ${draft.property}`,
          ],
          ['ملاحظات', draft.notes || 'لا توجد'],
          ['الرسالة الأصلية', draft.message || 'لم يتم لصق رسالة'],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>
        {draft.mode === 'existing'
          ? 'العقار المرتبط'
          : 'عقارات مناسبة — معاينة فقط'}
      </h3>
      <p>عينات توضيحية وليست نتيجة مطابقة فعلية؛ لا يتم إرسال إشعارات.</p>
      <div className={fields.list}>
        {sampleProperties
          .filter((p) => draft.mode === 'new' || p.name === draft.property)
          .map((p) => (
            <SuitablePropertyMiniCard key={p.name} property={p} />
          ))}
      </div>
    </>
  );
}
