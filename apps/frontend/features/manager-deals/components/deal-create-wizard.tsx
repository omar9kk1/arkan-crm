'use client';
import {
  useDraftState,
  useDraftScope,
} from '../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../lib/drafts/draft-tools';

import { GlassSelect } from '../../../components/ui/glass-select';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import {
  mockClients,
  money,
  type DealDraft,
  type MockProperty,
} from '../mock-data';
import { EmployeeSelection } from './employee-selection';
import { DealStepIndicator } from './deal-step-indicator';
import { CommissionBreakdown } from './commission-breakdown';
import styles from './deals.module.css';
export function DealCreateWizard({
  properties,
  onClose,
  onCreate,
}: {
  properties: MockProperty[];
  onClose: () => void;
  onCreate: (draft: DealDraft) => boolean;
}) {
  const formKey = 'create-deal';
  const { clear: clearFormDraft } = useDraftScope(formKey);

  const [step, setStep] = useDraftState(formKey + ':step', 0);
  const [draft, setDraft] = useDraftState<DealDraft>(formKey + ':draft', {
    propertyId: '',
    clientId: '',
    propertyEmployee: '',
    clientEmployee: '',
    type: 'بيع',
    price: 0,
    companyCommission: 0,
    propertyCommission: 0,
    clientCommission: 0,
    date: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [confirmed, setConfirmed] = useDraftState(formKey + ':confirmed', {
    property: false,
    client: false,
  });
  const [error, setError] = useState('');
  const submitted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const intro = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      const scrollBody = intro.current?.parentElement;
      if (scrollBody) scrollBody.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);
  const property = properties.find((item) => item.id === draft.propertyId);
  const client = mockClients.find((item) => item.id === draft.clientId);
  const available = properties.filter((item) => item.status === 'متاح');
  function move(next: number) {
    setStep(next);
    setError('');
  }
  return (
    <PropertyOverlay
      title="تسجيل صفقة جديدة"
      onClose={onClose}
      className={styles.wizardModal}
    >
      <p ref={intro} className={styles.wizardIntro}>
        اختر العقار والعميل، راجع الموظفين والعمولات، ثم أكّد تفاصيل الصفقة.
      </p>
      <DealStepIndicator step={step} />
      <div className={styles.wizardLayout}>
        <Card className={styles.wizardContent}>
          <h3 ref={heading} tabIndex={-1}>
            الخطوة {step + 1}:{' '}
            {
              [
                'اختيار العقار',
                'اختيار العميل',
                'بيانات الصفقة',
                'مراجعة وإنشاء',
              ][step]
            }
          </h3>
          <>
            <DraftTools formKey={formKey} />{' '}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (step === 0 && (!property || !confirmed.property)) {
                  setError('اختر العقار واعتمد الموظف أولًا.');
                  return;
                }
                if (step === 1 && (!client || !confirmed.client)) {
                  setError('اختر العميل واعتمد الموظف أولًا.');
                  return;
                }
                if (step < 3) {
                  move(step + 1);
                  return;
                }
                if (submitted.current) return;
                submitted.current = true;
                if (onCreate(draft)) {
                  clearFormDraft();
                } else {
                  submitted.current = false;
                  setError(
                    'تعذر إنشاء الصفقة. راجع البيانات وتأكد أن العقار ما زال متاحًا.',
                  );
                }
              }}
            >
              {step === 0 && (
                <>
                  <label className={styles.field}>
                    العقار
                    <GlassSelect
                      required
                      value={draft.propertyId}
                      onChange={(event) => {
                        const item = available.find(
                          (p) => p.id === event.target.value,
                        );
                        setDraft({
                          ...draft,
                          propertyId: event.target.value,
                          propertyEmployee: item?.employee ?? '',
                        });
                        setConfirmed({ ...confirmed, property: false });
                      }}
                    >
                      <option value="">اختر العقار</option>
                      {properties.map((item) => (
                        <option
                          key={item.id}
                          value={item.id}
                          disabled={item.status !== 'متاح'}
                        >
                          {item.title} · {item.id} · {item.status}
                        </option>
                      ))}
                    </GlassSelect>
                  </label>
                  {!available.length && <p>لا توجد عقارات متاحة في العينة.</p>}
                  {property && (
                    <EmployeeSelection
                      suggested={property.employee}
                      value={draft.propertyEmployee}
                      label="العقار تابع/مدخل بواسطة الموظف"
                      confirmed={confirmed.property}
                      onChange={(value) => {
                        setDraft({ ...draft, propertyEmployee: value });
                        setConfirmed({ ...confirmed, property: false });
                      }}
                      onConfirm={() =>
                        setConfirmed({ ...confirmed, property: true })
                      }
                    />
                  )}
                </>
              )}
              {step === 1 && (
                <>
                  <label className={styles.field}>
                    العميل
                    <GlassSelect
                      required
                      value={draft.clientId}
                      onChange={(event) => {
                        const item = mockClients.find(
                          (c) => c.id === event.target.value,
                        );
                        setDraft({
                          ...draft,
                          clientId: event.target.value,
                          clientEmployee: item?.employee ?? '',
                        });
                        setConfirmed({ ...confirmed, client: false });
                      }}
                    >
                      <option value="">اختر العميل</option>
                      {mockClients.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </GlassSelect>
                  </label>
                  {client && (
                    <EmployeeSelection
                      suggested={client.employee}
                      value={draft.clientEmployee}
                      label="العميل متابع بواسطة الموظف"
                      confirmed={confirmed.client}
                      onChange={(value) => {
                        setDraft({ ...draft, clientEmployee: value });
                        setConfirmed({ ...confirmed, client: false });
                      }}
                      onConfirm={() =>
                        setConfirmed({ ...confirmed, client: true })
                      }
                    />
                  )}
                </>
              )}
              {step === 2 && (
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    نوع الصفقة
                    <GlassSelect
                      value={draft.type}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          type: event.target.value as DealDraft['type'],
                        })
                      }
                    >
                      <option>بيع</option>
                      <option>تأجير</option>
                    </GlassSelect>
                  </label>
                  {(
                    [
                      { key: 'price', label: 'سعر العقار' },
                      { key: 'companyCommission', label: 'عمولة الشركة' },
                      { key: 'propertyCommission', label: 'عمولة موظف العقار' },
                      { key: 'clientCommission', label: 'عمولة موظف العميل' },
                    ] as const
                  ).map((field) => (
                    <label className={styles.field} key={field.key}>
                      {field.label} (د.ك)
                      <input
                        required
                        type="number"
                        min={field.key === 'price' ? 0.001 : 0}
                        max="1000000000"
                        step="0.001"
                        value={draft[field.key]}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            [field.key]:
                              event.target.value === ''
                                ? 0
                                : Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                  <label className={styles.field}>
                    تاريخ الإغلاق
                    <input
                      required
                      type="date"
                      value={draft.date}
                      onChange={(event) =>
                        setDraft({ ...draft, date: event.target.value })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    ملاحظات
                    <textarea
                      maxLength={1000}
                      value={draft.notes}
                      onChange={(event) =>
                        setDraft({ ...draft, notes: event.target.value })
                      }
                    />
                  </label>
                </div>
              )}
              {step === 3 && (
                <>
                  <p>
                    سيتم {draft.type === 'بيع' ? 'بيع' : 'تأجير'} العقار{' '}
                    {property?.title} ({draft.propertyId}) للعميل {client?.name}
                    .
                  </p>
                  <p>
                    السعر: {money(draft.price)} · تاريخ الإغلاق: {draft.date}
                  </p>
                  <CommissionBreakdown deal={draft} />
                  <ul className={styles.list}>
                    <li>تم احتساب عمولة الشركة.</li>
                    <li>تم احتساب عمولة موظف العقار.</li>
                    <li>تم احتساب عمولة موظف العميل.</li>
                  </ul>
                  <p>{draft.notes || 'لا توجد ملاحظات.'}</p>
                </>
              )}
              {error && <p role="alert">{error}</p>}
              <div className={styles.actions}>
                {step > 0 && (
                  <Button type="button" onClick={() => move(step - 1)}>
                    السابق
                  </Button>
                )}
                <Button type="submit">
                  {step === 3 ? 'إنشاء صفقة' : 'التالي'}
                </Button>
              </div>
            </form>{' '}
          </>
        </Card>
        <aside className={styles.wizardSummary}>
          <Card>
            <h3>ملخص الصفقة</h3>
            <dl className={styles.facts}>
              <div>
                <dt>العقار</dt>
                <dd>{property?.title || 'لم يتم الاختيار بعد'}</dd>
              </div>
              <div>
                <dt>العميل</dt>
                <dd>{client?.name || 'لم يتم الاختيار بعد'}</dd>
              </div>
              <div>
                <dt>موظف العقار</dt>
                <dd>
                  {confirmed.property
                    ? draft.propertyEmployee
                    : 'بانتظار الاعتماد'}
                </dd>
              </div>
              <div>
                <dt>موظف العميل</dt>
                <dd>
                  {confirmed.client ? draft.clientEmployee : 'بانتظار الاعتماد'}
                </dd>
              </div>
            </dl>
          </Card>
          <Card>
            <h3>قبل إنشاء الصفقة</h3>
            <p>راجع السعر وتوزيع العمولات وبيانات الموظفين قبل التأكيد.</p>
            <p className={styles.muted}>
              معاينة محلية فقط — لا تُرسل أي بيانات.
            </p>
          </Card>
        </aside>
      </div>
    </PropertyOverlay>
  );
}
