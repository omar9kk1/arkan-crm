'use client';
import {
  useDraftState,
  useDraftScope,
} from '../../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../../lib/drafts/draft-tools';

import { useEffect, useRef, useState } from 'react';
import { PropertyOverlay } from '../../../manager-properties/components/property-overlay';
import { Button } from '../../../../components/ui/button';
import { Toast } from '../../../../components/ui/toast';
import type { EmployeeClient } from '../../client-model';
import {
  clientLabels,
  parseRequest,
  properties,
  requestSummary,
  type ClientType,
  type ClientRequestDraft,
} from './client-request-model';
import {
  initialBundle,
  toggleType,
  typeDraft,
  bundleError,
  saveBundle,
} from './client-request-bundle';
import { ClientIdentityStep } from './client-identity-step';
import { ClientTypeReview } from './client-type-review';
import { RequestInterestStep } from './request-interest-step';
import styles from './unified-request.module.css';
export function AddClientRequestModal({
  onClose,
  onSave,
  clients = [],
}: {
  onClose: () => void;
  onSave: (client: EmployeeClient) => void;
  clients?: readonly EmployeeClient[];
}) {
  const formKey = 'add-client';
  const { clear: clearFormDraft } = useDraftScope(formKey);

  const [bundle, setBundle] = useDraftState(formKey + ':bundle', initialBundle),
    [storedStep, setStep] = useDraftState(formKey + ':step', 0),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const step = storedStep === 3 ? 2 : storedStep;
  const heading = useRef<HTMLHeadingElement>(null),
    content = useRef<HTMLDivElement>(null),
    submitted = useRef(false);
  const titles = [
    { id: 0, title: 'بيانات العميل' },
    { id: 1, title: 'أنواع الطلب' },
    { id: 2, title: 'تحليل الرسالة' },
    { id: 4, title: 'مراجعة وحفظ' },
  ];
  const update = (type: ClientType, draft: ClientRequestDraft) =>
    setBundle((previous) => ({
      ...previous,
      requests: { ...previous.requests, [type]: draft },
    }));
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    content.current?.scrollTo({ top: 0 });
  }, [step]);
  return (
    <PropertyOverlay
      title="إضافة عميل / طلب"
      className={styles.modal}
      onClose={onClose}
    >
      <ol className={styles.steps} aria-label="مراحل إضافة العميل">
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
          onSubmit={(event) => {
            event.preventDefault();
            const validation = bundleError(
              bundle,
              step === 2 ? 3 : step,
              clients,
            );
            if (validation) {
              setError(validation);
              return;
            }
            setError('');
            if (step < 4) {
              setStep(step === 2 ? 4 : step + 1);
              return;
            }
            if (submitted.current) return;
            submitted.current = true;
            onSave(saveBundle(bundle, clients));
            clearFormDraft();
          }}
        >
          <div className={styles.content} ref={content}>
            {step === 0 && (
              <ClientIdentityStep
                bundle={bundle}
                clients={clients}
                onChange={setBundle}
              />
            )}
            {step === 1 && (
              <section className={styles.panel}>
                <h3>نوع العميل / الطلب</h3>
                <p className={styles.hint}>
                  يمكنك اختيار أكثر من نوع، مثل مستأجر ومبدل عقار معًا.
                </p>
                <div className={styles.types}>
                  {(Object.keys(clientLabels) as ClientType[]).map((type) => (
                    <button
                      type="button"
                      className={styles.choice}
                      key={type}
                      aria-pressed={bundle.types.includes(type)}
                      onClick={() => setBundle(toggleType(bundle, type))}
                    >
                      {clientLabels[type]}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {step === 2 &&
              bundle.types.map((type) => {
                const draft = typeDraft(bundle, type);
                return (
                  <section key={type} className={styles.requestSection}>
                    <h3 className={styles.requestTitle}>
                      {clientLabels[type]}
                    </h3>
                    <>
                      <RequestInterestStep
                        draft={draft}
                        onChange={(value) => update(type, value)}
                        onAnalyze={() => {
                          if (!draft.message.trim()) {
                            setError(
                              `${clientLabels[type]}: اكتب أو الصق تفاصيل الطلب أولًا.`,
                            );
                            return;
                          }
                          update(type, {
                            ...draft,
                            requestDetails: parseRequest(draft.message, type),
                          });
                          setError('');
                          requestAnimationFrame(() => {
                            content.current
                              ?.querySelector<HTMLElement>(
                                `[data-request-fields="${type}"]`,
                              )
                              ?.scrollIntoView({
                                behavior: window.matchMedia(
                                  '(prefers-reduced-motion: reduce)',
                                ).matches
                                  ? 'instant'
                                  : 'smooth',
                                block: 'start',
                                inline: 'nearest',
                              });
                          });
                          setNotice(
                            `تم تحليل طلب ${clientLabels[type]} مؤقتًا، يمكنك تعديل البيانات قبل الحفظ`,
                          );
                        }}
                      />
                    </>
                    {draft.interest.hasNewRequest && draft.requestDetails && (
                      <div data-request-fields={type}>
                        <h3>بيانات الطلب — راجع الخانات وأكمل التفاصيل</h3>
                        <ClientTypeReview
                          draft={draft}
                          onChange={(value) => update(type, value)}
                        />
                      </div>
                    )}
                  </section>
                );
              })}
            {step === 4 && (
              <>
                <section className={styles.panel}>
                  <h3>
                    {bundle.name} · {bundle.phone}
                  </h3>
                  <p>
                    {bundle.types.map((type) => clientLabels[type]).join(' / ')}
                  </p>
                  {bundle.notes && (
                    <p className={styles.summary}>{bundle.notes}</p>
                  )}
                </section>
                {bundle.types.map((type) => {
                  const d = typeDraft(bundle, type);
                  const p = d.interest.hasLinkedProperty
                    ? properties.find(
                        (p) => p.id === d.linkedProperty.propertyId,
                      )
                    : undefined;
                  return (
                    <section className={styles.panel} key={type}>
                      <h3>{clientLabels[type]}</h3>
                      {p && (
                        <p className={styles.preview}>
                          {p.id} · {p.area} · {p.price} · {p.type} · {p.status}
                        </p>
                      )}
                      <div className={styles.summary}>{requestSummary(d)}</div>
                    </section>
                  );
                })}
              </>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
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
              {step === 4 ? 'حفظ العميل والطلب' : 'التالي'}
            </Button>
          </div>
        </form>{' '}
      </>
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </PropertyOverlay>
  );
}
