'use client';
import {
  useDraftState,
  useDraftScope,
} from '../../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../../lib/drafts/draft-tools';
import { getClient } from '../../../../lib/api/clients-api';
import { employeeClientFromDto } from '../../client-model';
import { useEffect, useRef, useState } from 'react';
import { PropertyOverlay } from '../../../manager-properties/components/property-overlay';
import { Button } from '../../../../components/ui/button';
import { Toast } from '../../../../components/ui/toast';
import type { ClientRequestBundle } from './client-request-bundle';
import type { EmployeeClient } from '../../client-model';
import {
  clientLabels,
  linkedPropertyPreview,
  normalizeLinkedProperty,
  parseRequest,
  requestSummary,
  type ClientType,
  type ClientRequestDraft,
} from './client-request-model';
import {
  editBundleFromClient,
  editClientSavePayload,
  initialBundle,
  toggleType,
  typeDraft,
  bundleError,
  saveBundle,
  type EditClientRequestPayload,
} from './client-request-bundle';
import { ClientIdentityStep } from './client-identity-step';
import { ClientTypeReview } from './client-type-review';
import { RequestInterestStep } from './request-interest-step';
import styles from './unified-request.module.css';

const STAGE_TITLES = [
  { id: 0, title: 'بيانات العميل' },
  { id: 1, title: 'أنواع الطلب' },
  { id: 2, title: 'تحليل الرسالة' },
  { id: 4, title: 'مراجعة وحفظ' },
] as const;

/**
 * The FOUR wizard stages — ONE shared implementation for the create mode and
 * the edit mode (same steps, same Astra controls, one commit path). The state
 * layer lives in the MODE WRAPPERS, each handing bundle/step down: the create
 * mode keeps its persisted draft store, while the EDIT mode keeps plain
 * in-memory state hydrated from the authorised record — so no draft store can
 * ever replay stale/empty values over a hydrated edit session.
 */
function WizardStages({
  title,
  step,
  setStep,
  bundle,
  setBundle,
  clients,
  editing,
  formKey,
  onCommit,
  onClose,
  saveLabel,
}: {
  title: string;
  step: number;
  setStep: (value: number) => void;
  bundle: ClientRequestBundle;
  setBundle: (value: ClientRequestBundle) => void;
  clients: readonly EmployeeClient[];
  /** EDIT mode: identity locked to the hydrated record; save is a PATCH. */
  editing: boolean;
  /** Create-mode draft-store key; the edit mode has NO draft key. */
  formKey: string;
  onCommit: (bundle: ClientRequestBundle) => Promise<boolean>;
  onClose: () => void;
  saveLabel: string;
}) {
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null),
    content = useRef<HTMLDivElement>(null),
    submitted = useRef(false);
  const update = (type: ClientType, draft: ClientRequestDraft) =>
    setBundle({
      ...bundle,
      requests: { ...bundle.requests, [type]: draft },
    });
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    content.current?.scrollTo({ top: 0 });
  }, [step]);
  return (
    <>
      <div className={styles.steps} role="group" aria-label={title}>
        {STAGE_TITLES.flatMap(({ id, title: stageTitleNames }, index) => {
          const stepIndex = STAGE_TITLES.findIndex((item) => item.id === id);
          const current = STAGE_TITLES.findIndex((item) => item.id === step);
          const isDone = stepIndex < current;
          const isActive = stepIndex === current;
          const node = (
            <span
              key={id}
              className={styles.stepItem}
              data-state={isActive ? 'active' : isDone ? 'done' : 'upcoming'}
              aria-current={isActive ? 'step' : undefined}
            >
              <span className={styles.stepNumber}>
                {isDone ? '✓' : index + 1}
              </span>
              <span className={styles.stepLabel}>{stageTitleNames}</span>
            </span>
          );
          if (index === 0) return [node];
          return [
            <span
              key={`conn-${index}`}
              className={styles.connector}
              data-active={index <= current ? 'true' : 'false'}
              aria-hidden="true"
            />,
            node,
          ];
        })}
      </div>
      <h2 className={styles.stageTitle} ref={heading} tabIndex={-1}>
        {STAGE_TITLES.find((item) => item.id === step)?.title}
      </h2>
      <>
        {formKey ? <DraftTools formKey={formKey} /> : null}{' '}
        <form
          className={styles.form}
          onSubmit={async (event) => {
            event.preventDefault();
            const validation = bundleError(
              bundle,
              step === 2 ? 3 : step,
              clients,
              editing,
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
            const saved = await onCommit(bundle);
            if (saved === false) {
              submitted.current = false;
              if (editing) setNotice('تعذر حفظ التعديلات. حاول مرة أخرى.');
              return;
            }
          }}
        >
          <div className={styles.content} ref={content}>
            {step === 0 && (
              <ClientIdentityStep
                bundle={bundle}
                clients={clients}
                editing={editing}
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
                    <RequestInterestStep
                      draft={draft}
                      // Per-type fields build on the current stored/edited
                      // draft: a restored edit note or linked selection
                      // survives the transition (no silent state reset).
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
                  const linked = normalizeLinkedProperty(d.linkedProperty);
                  return (
                    <section className={styles.panel} key={type}>
                      <h3>{clientLabels[type]}</h3>
                      {d.interest.hasLinkedProperty && (
                        <p className={styles.preview}>
                          {linked.property
                            ? linkedPropertyPreview(linked.property)
                            : 'لم يتم اختيار عقار بعد'}
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
            <Button type="submit">{step === 4 ? saveLabel : 'التالي'}</Button>
          </div>
        </form>{' '}
      </>
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </>
  );
}

/**
 * CREATE mode — the original behaviour, preserved: the persisted user draft
 * store keeps half-finished sessions alive and is cleared on a saved commit.
 */
function CreateWizardModal({
  onClose,
  onSave,
  clients,
}: {
  onClose: () => void;
  onSave?: (client: EmployeeClient) => void | boolean | Promise<void | boolean>;
  clients: readonly EmployeeClient[];
}) {
  const formKey = 'add-client';
  const { clear: clearFormDraft } = useDraftScope(formKey);
  const [bundle, setBundle] = useDraftState(formKey + ':bundle', initialBundle),
    [rawStep, setRawStep] = useDraftState(formKey + ':step', 0);
  const title = 'إضافة عميل / طلب';
  return (
    <PropertyOverlay title={title} className={styles.modal} onClose={onClose}>
      <WizardStages
        title={title}
        step={rawStep === 3 ? 2 : rawStep}
        setStep={setRawStep}
        bundle={bundle}
        setBundle={setBundle}
        clients={clients}
        editing={false}
        formKey={formKey}
        saveLabel="حفظ العميل والطلب"
        onClose={onClose}
        onCommit={async (current) => {
          if (!onSave) return false;
          const saved = await onSave(saveBundle(current, clients));
          if (saved === false) return false;
          clearFormDraft();
          return true;
        }}
      />
    </PropertyOverlay>
  );
}

/**
 * EDIT mode — HYDRATE FIRST: the FULL authorised client record is fetched
 * (`GET /clients/:id`) and NOTHING editable renders until it lands, so empty
 * defaults can never masquerade as a loaded client. The edit bundle is plain
 * in-memory state built FROM the hydrated record (never a localStorage
 * draft), and it is set exactly once — after that, step navigation and
 * re-renders never reset user edits.
 */
function EditWizardModal({
  editing,
  clients,
  onEditSave,
  onClose,
}: {
  editing: EmployeeClient;
  clients: readonly EmployeeClient[];
  onEditSave?: (payload: EditClientRequestPayload) => Promise<boolean>;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<EmployeeClient | null>(null),
    [loadError, setLoadError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [bundle, setBundle] = useState<ClientRequestBundle>(() => initialBundle()),
    [step, setStep] = useState(0);
  useEffect(() => {
    let active = true;
    setLoadError('');
    getClient(editing.id)
      .then((dto) => {
        if (!active) return;
        // The hydrated full record drives the prefill — identity columns,
        // stored request document and the persisted linked interests.
        const mapped = employeeClientFromDto(dto);
        setRecord(mapped);
        setBundle(editBundleFromClient(mapped));
        setStep(0);
      })
      .catch(() => {
        if (active)
          setLoadError(
            'تعذر تحميل بيانات العميل. تحقق من الاتصال ثم أعد المحاولة.',
          );
      });
    return () => {
      active = false;
    };
  }, [editing.id, attempt]);
  const title = 'تعديل بيانات العميل';
  return (
    <PropertyOverlay title={title} className={styles.modal} onClose={onClose}>
      {loadError ? (
        <section className={styles.panel}>
          <p role="alert">{loadError}</p>
          <div className={styles.actions}>
            <Button type="button" onClick={onClose}>
              إلغاء
            </Button>
            <Button type="button" onClick={() => setAttempt((v) => v + 1)}>
              إعادة المحاولة
            </Button>
          </div>
        </section>
      ) : null}
      {!loadError && !record ? (
        <p className={styles.hint} role="status" aria-live="polite">
          جارٍ تحميل بيانات العميل…
        </p>
      ) : null}
      {record && onEditSave ? (
        <WizardStages
          title={title}
          step={step}
          setStep={setStep}
          bundle={bundle}
          setBundle={setBundle}
          clients={clients}
          editing
          formKey=""
          saveLabel="حفظ التعديل"
          onClose={onClose}
          onCommit={(current) =>
            onEditSave(editClientSavePayload(current, record))
          }
        />
      ) : null}
    </PropertyOverlay>
  );
}

/**
 * The ONE shared 4-step wizard. CREATE and EDIT render through separate mode
 * wrappers so an edit session can never inherit create-mode storage — and the
 * four stages stay a single implementation for both.
 */
/**
 * The ONE shared 4-step wizard. CREATE and EDIT render through separate mode
 * wrappers so an edit session can never inherit create-mode storage — and the
 * four stages stay a single implementation for both.
 */
export function AddClientRequestModal({
  onClose,
  onSave,
  onEditSave,
  editing,
  clients = [],
}: {
  onClose: () => void;
  /**
   * CREATE mode save. Omitted (or unused) in EDIT mode. The second argument
   * is the idempotency key of THIS wizard session: an accidental repeated
   * submission resolves to the SAME review instead of creating a duplicate.
   */
  onSave?: (
    client: EmployeeClient,
    idempotencyKey: string,
  ) => void | boolean | Promise<void | boolean>;
  /**
   * EDIT mode: reuses the SAME wizard for an existing client, hydration-first
   * via the authorised record, staging a client REVIEW (the manager approves)
   * instead of patching the approved row.
   */
  onEditSave?: (
    payload: EditClientRequestPayload,
    idempotencyKey: string,
  ) => Promise<boolean>;
  editing?: EmployeeClient;
  clients?: readonly EmployeeClient[];
}) {
  const sessionKey = useRef(
    globalThis.crypto?.randomUUID?.() ?? `session-${String(Date.now())}`,
  ).current;
  return editing && onEditSave ? (
    <EditWizardModal
      editing={editing}
      clients={clients}
      onEditSave={(payload) => onEditSave(payload, sessionKey)}
      onClose={onClose}
    />
  ) : (
    <CreateWizardModal
      onClose={onClose}
      onSave={(client) =>
        onSave ? onSave(client, sessionKey) : Promise.resolve(false)
      }
      clients={clients}
    />
  );
}
