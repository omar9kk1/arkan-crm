'use client';
import {
  useDraftState,
  useDraftScope,
} from '../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../lib/drafts/draft-tools';

import { useEffect, useRef, useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import { Toast } from '../../../components/ui/toast';
import type { Property } from '../model';
import {
  initialPropertyRequest,
  offerLabels,
  toProperty,
  validateRequest,
  type PropertyOfferType,
  type PropertyRequestDraft,
} from './property-request-model';
import { PropertyOwnerStep } from './property-owner-step';
import { PropertyOfferSteps } from './property-offer-steps';
import styles from './property-request.module.css';
export function AddPropertyModal({
  property,
  onClose,
  onSave,
  manager = false,
}: {
  property?: Property;
  onClose: () => void;
  onSave: (properties: Property[]) => void;
  manager?: boolean;
}) {
  const formKey = 'add-property:' + (property?.id || 'new');
  const { clear: clearFormDraft } = useDraftScope(formKey);

  const [draft, setDraft] = useDraftState(formKey + ':draft', () =>
    initialPropertyRequest(property),
  );
  const [storedStep, setStep] = useDraftState(formKey + ':step', 0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  // Keep saved step IDs compatible; the former data-review step now belongs to analysis.
  const step = storedStep === 3 ? 2 : storedStep;
  const heading = useRef<HTMLHeadingElement>(null),
    saved = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const showError = (message: string) => {
    setError(message);
    requestAnimationFrame(() =>
      errorMessage.current?.focus({ preventScroll: true }),
    );
  };
  const [selectedTypes, setSelectedTypes] = useDraftState<PropertyOfferType[]>(
    formKey + ':selectedTypes',
    [draft.offerType],
  );
  const [offers, setOffers] = useDraftState<
    Partial<Record<PropertyOfferType, PropertyRequestDraft>>
  >(formKey + ':offers', () => ({ [draft.offerType]: draft }));
  const titles = [
    { id: 0, title: 'بيانات المالك' },
    { id: 1, title: 'نوع العرض' },
    { id: 2, title: 'تحليل الرسالة' },
    { id: 4, title: 'مراجعة وإرسال' },
  ];
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    content.current?.scrollTo({ top: 0 });
  }, [step]);
  return (
    <PropertyOverlay
      title={property ? 'تعديل وإعادة إرسال العقار' : 'إضافة عقار'}
      className={styles.modal}
      onClose={onClose}
      onCloseButton={clearFormDraft}
    >
      <ol className={styles.steps} aria-label="مراحل إضافة العقار">
        {titles.map(({ id, title }, index) => (
          <li key={id} aria-current={step === id ? 'step' : undefined}>
            <span className={styles.stepNumber}>{index + 1}</span>
            <span>{title}</span>
          </li>
        ))}
      </ol>
      <h2 className={styles.stageTitle} ref={heading} tabIndex={-1}>
        {titles.find((item) => item.id === step)?.title}
      </h2>
      <>
        <DraftTools formKey={formKey} />{' '}
        <form
          className={styles.form}
          onInvalidCapture={() =>
            showError(
              'راجع الخانة المحددة: أكمل البيانات المطلوبة وأدخل أرقامًا صحيحة غير سالبة.',
            )
          }
          onSubmit={(e) => {
            e.preventDefault();
            const message =
              step === 0
                ? validateRequest(draft, 0)
                : !selectedTypes.length
                  ? 'اختر نوع عرض واحدًا على الأقل.'
                  : selectedTypes
                      .map((type) => {
                        const error = validateRequest(
                          { ...offers[type]!, owner: draft.owner },
                          step === 2 ? 3 : step,
                        );
                        return error ? offerLabels[type] + ': ' + error : '';
                      })
                      .find(Boolean);
            if (message) {
              showError(message);
              return;
            }
            setError('');
            if (step < 4) {
              setStep(step === 2 ? 4 : step + 1);
              return;
            }
            if (saved.current) return;
            saved.current = true;
            onSave(
              selectedTypes.map((type, index) =>
                toProperty(
                  { ...offers[type]!, owner: draft.owner },
                  manager,
                  index === 0 ? property : undefined,
                ),
              ),
            );
            clearFormDraft();
          }}
        >
          <div className={styles.content} ref={content}>
            {step === 0 && (
              <PropertyOwnerStep draft={draft} onChange={setDraft} />
            )}
            {step === 1 && (
              <>
                <p className={styles.hint}>
                  يمكنك اختيار أكثر من نوع عرض. لكل نوع تفاصيل عقار مستقلة.
                </p>
                <div className={styles.types}>
                  {(Object.keys(offerLabels) as PropertyOfferType[]).map(
                    (type) => (
                      <button
                        className={styles.choice}
                        type="button"
                        aria-pressed={selectedTypes.includes(type)}
                        key={type}
                        onClick={() => {
                          setSelectedTypes((previous) =>
                            previous.includes(type)
                              ? previous.filter((item) => item !== type)
                              : [...previous, type],
                          );
                          setOffers((previous) => ({
                            ...previous,
                            [type]: previous[type] || {
                              ...initialPropertyRequest(),
                              offerType: type,
                            },
                          }));
                        }}
                      >
                        <strong>{offerLabels[type]}</strong>
                        <span>
                          {type === 'SALE'
                            ? 'المالك يريد بيع العقار.'
                            : type === 'RENT'
                              ? 'المالك يريد تأجير العقار.'
                              : 'المالك لديه عقار ويريد مبادلته بعقار آخر أو يريد فرق بدل.'}
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </>
            )}
            {step >= 2 &&
              selectedTypes.map((type) => (
                <section key={type} className={styles.offerSection}>
                  <h3 className={styles.offerTitle}>{offerLabels[type]}</h3>
                  <PropertyOfferSteps
                    step={step}
                    draft={{ ...offers[type]!, owner: draft.owner }}
                    onChange={(value) => {
                      const detected = value.offerType;
                      if (detected !== type) {
                        if (selectedTypes.includes(detected)) {
                          setError(
                            `النص يخص ${offerLabels[detected]}؛ انقله إلى قسم ${offerLabels[detected]} الموجود حتى لا تُستبدل بياناته.`,
                          );
                          return false;
                        }
                        setSelectedTypes((previous) =>
                          previous.map((item) =>
                            item === type ? detected : item,
                          ),
                        );
                        setOffers((previous) => {
                          const next = { ...previous, [detected]: value };
                          delete next[type];
                          return next;
                        });
                      } else
                        setOffers((previous) => ({
                          ...previous,
                          [type]: value,
                        }));
                      return true;
                    }}
                    onError={setError}
                    onNotice={setNotice}
                    manager={manager}
                  />
                </section>
              ))}
            {property?.managerNotes && (
              <p className={styles.hint}>
                ملاحظات المدير: {property.managerNotes}
              </p>
            )}
          </div>
          {error && (
            <p ref={errorMessage} role="alert" tabIndex={-1}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="button" onClick={onClose}>
              إلغاء
            </Button>
            {step > 0 && (
              <Button
                type="button"
                onClick={() => {
                  setError('');
                  setStep(step === 4 ? 2 : step - 1);
                }}
              >
                السابق
              </Button>
            )}
            <Button type="submit">
              {step === 4
                ? manager
                  ? 'إضافة العقار'
                  : 'إرسال العقار للمراجعة'
                : 'التالي'}
            </Button>
          </div>
        </form>{' '}
      </>
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </PropertyOverlay>
  );
}
