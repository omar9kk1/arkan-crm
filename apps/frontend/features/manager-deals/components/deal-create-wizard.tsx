'use client';
import {
  useDraftState,
  useDraftScope,
} from '../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../lib/drafts/draft-tools';

import { GlassSelect } from '../../../components/ui/glass-select';
import { GlassCombobox } from '../../../components/ui/glass-combobox';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { searchDealClients } from '../../../lib/api/deals-api';
import { useAuth } from '../../auth/components/auth-provider';
import {
  isEmployeeAttributionConfirmed,
  mapClientOption,
  money,
  type DealClientOption,
  type DealDraft,
  type DealEmployeeOption,
  type DealPropertyOption,
} from '../deal-model';
import { EmployeeSelection } from './employee-selection';
import { DealStepIndicator } from './deal-step-indicator';
import { CommissionBreakdown } from './commission-breakdown';
import styles from './deals.module.css';
export function DealCreateWizard({
  properties,
  clients,
  employees,
  onClose,
  onCreate,
}: {
  properties: DealPropertyOption[];
  clients: DealClientOption[];
  employees: DealEmployeeOption[];
  onClose: () => void;
  onCreate: (draft: DealDraft) => Promise<string | null>;
}) {
  const formKey = 'create-deal';
  const { clear: clearFormDraft } = useDraftScope(formKey);
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';

  const [step, setStep] = useDraftState(formKey + ':step', 0);
  const [draft, setDraft] = useDraftState<DealDraft>(formKey + ':draft', {
    propertyId: '',
    clientId: '',
    propertyEmployeeUserId: '',
    propertyEmployeeName: '',
    clientEmployeeUserId: '',
    clientEmployeeName: '',
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
  const [clientSearch, setClientSearch] = useState('');
  const [clientOptions, setClientOptions] =
    useState<DealClientOption[]>(clients);
  const [clientCursor, setClientCursor] = useState<string | null>(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientLoadingMore, setClientLoadingMore] = useState(false);
  const [clientError, setClientError] = useState('');
  const [selectedClient, setSelectedClient] =
    useState<DealClientOption | null>(() =>
      clients.find((item) => item.id === draft.clientId) ?? null,
    );
  const clientRequest = useRef(0);
  const submitted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const intro = useRef<HTMLParagraphElement>(null);

  const loadClients = useCallback(
    async (searchText: string, cursor?: string, append = false) => {
      const requestId = ++clientRequest.current;
      if (append) setClientLoadingMore(true);
      else {
        setClientLoading(true);
        setClientError('');
        setClientOptions([]);
        setClientCursor(null);
      }
      try {
        const page = await searchDealClients({
          search: searchText.trim() || undefined,
          limit: 50,
          ...(cursor ? { cursor } : {}),
        });
        if (requestId !== clientRequest.current) return;
        const mapped = page.items.map(mapClientOption);
        setClientOptions((previous) =>
          append ? [...previous, ...mapped] : mapped,
        );
        setClientCursor(page.nextCursor);
      } catch (cause) {
        if (requestId !== clientRequest.current) return;
        setClientError(
          cause instanceof Error
            ? cause.message
            : 'تعذر تحميل العملاء. حاول مرة أخرى.',
        );
        if (!append) {
          setClientOptions([]);
          setClientCursor(null);
        }
      } finally {
        if (requestId === clientRequest.current) {
          setClientLoading(false);
          setClientLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (step !== 1) return;
    const timer = setTimeout(
      () => void loadClients(clientSearch),
      clientSearch.trim() ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [step, clientSearch, loadClients]);

  useEffect(() => {
    if (selectedClient) return;
    const found = clients.find((item) => item.id === draft.clientId);
    if (found) setSelectedClient(found);
  }, [clients, draft.clientId, selectedClient]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      const scrollBody = intro.current?.parentElement;
      if (scrollBody) scrollBody.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);
  const property = properties.find((item) => item.id === draft.propertyId);
  const client = selectedClient;

  // OWNER confirms manually; MANAGER confirmation is derived from the real
  // responsible employee (must be an active eligible employee in scope) so
  // «التالي» works without the confirmation button.
  const propertyEmployeeConfirmed = isEmployeeAttributionConfirmed({
    isOwner,
    manuallyConfirmed: confirmed.property,
    responsibleUserId: property?.suggestedEmployeeUserId,
    attributedUserId: draft.propertyEmployeeUserId,
    eligibleUserIds: employees.map((employee) => employee.userId),
  });
  const clientEmployeeConfirmed = isEmployeeAttributionConfirmed({
    isOwner,
    manuallyConfirmed: confirmed.client,
    responsibleUserId: client?.employeeUserId,
    attributedUserId: draft.clientEmployeeUserId,
    eligibleUserIds: employees.map((employee) => employee.userId),
  });

  // MANAGER attribution is read-only: keep the draft aligned with the
  // property's current responsible employee even after a persisted draft.
  useEffect(() => {
    if (isOwner || !property) return;
    if (
      draft.propertyEmployeeUserId === property.suggestedEmployeeUserId &&
      draft.propertyEmployeeName === property.suggestedEmployeeName
    )
      return;
    setDraft({
      ...draft,
      propertyEmployeeUserId: property.suggestedEmployeeUserId,
      propertyEmployeeName: property.suggestedEmployeeName,
    });
    setConfirmed((previous) => ({ ...previous, property: false }));
    // Setters are stable; the effect is keyed on the real persisted values.
  }, [
    isOwner,
    property,
    draft,
    setDraft,
    setConfirmed,
  ]);

  // MANAGER client attribution is read-only too: always use the selected
  // client's actual responsible employee, even with a persisted draft.
  useEffect(() => {
    if (isOwner || !client) return;
    if (
      draft.clientEmployeeUserId === client.employeeUserId &&
      draft.clientEmployeeName === client.employee
    )
      return;
    setDraft({
      ...draft,
      clientEmployeeUserId: client.employeeUserId,
      clientEmployeeName: client.employee,
    });
    setConfirmed((previous) => ({ ...previous, client: false }));
  }, [isOwner, client, draft, setDraft, setConfirmed]);

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
              onSubmit={async (event) => {
                event.preventDefault();
                if (step === 0) {
                  if (!property) {
                    setError('اختر العقار أولًا.');
                    return;
                  }
                  if (!draft.propertyEmployeeUserId) {
                    setError(
                      'لا يوجد موظف مسؤول عن هذا العقار؛ تعذّر المتابعة.',
                    );
                    return;
                  }
                  if (!propertyEmployeeConfirmed) {
                    setError(
                      isOwner
                        ? 'اعتمد الموظف المسؤول عن العقار أولًا.'
                        : 'لا يوجد موظف مسؤول صالح عن هذا العقار؛ تعذّر المتابعة.',
                    );
                    return;
                  }
                }
                if (step === 1) {
                  if (!client) {
                    setError('اختر العميل أولًا.');
                    return;
                  }
                  if (!draft.clientEmployeeUserId) {
                    setError(
                      'لا يوجد موظف مسؤول عن هذا العميل؛ تعذّر المتابعة.',
                    );
                    return;
                  }
                  if (!clientEmployeeConfirmed) {
                    setError(
                      isOwner
                        ? 'اعتمد الموظف المسؤول عن العميل أولًا.'
                        : 'لا يوجد موظف مسؤول صالح عن هذا العميل؛ تعذّر المتابعة.',
                    );
                    return;
                  }
                }
                if (
                  step === 3 &&
                  (!property ||
                    !client ||
                    !propertyEmployeeConfirmed ||
                    !clientEmployeeConfirmed)
                ) {
                  setError('راجع العقار والعميل والموظفين المسؤولين أولًا.');
                  return;
                }
                if (step < 3) {
                  move(step + 1);
                  return;
                }
                if (submitted.current) return;
                submitted.current = true;
                const failure = await onCreate(draft);
                if (failure) {
                  submitted.current = false;
                  setError(failure);
                  return;
                }
                clearFormDraft();
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
                        const item = properties.find(
                          (p) => p.id === event.target.value,
                        );
                        setDraft({
                          ...draft,
                          propertyId: event.target.value,
                          propertyEmployeeUserId:
                            item?.suggestedEmployeeUserId ?? '',
                          propertyEmployeeName:
                            item?.suggestedEmployeeName ?? '',
                        });
                        setConfirmed({ ...confirmed, property: false });
                      }}
                    >
                      <option value="">اختر العقار</option>
                      {properties.map((item) => (
                        <option
                          key={item.id}
                          value={item.id}
                          disabled={!item.available}
                        >
                          {item.title} · {item.code} · {item.statusLabel}
                        </option>
                      ))}
                    </GlassSelect>
                  </label>
                  {!properties.some((item) => item.available) && (
                    <p>لا توجد عقارات متاحة حاليًا.</p>
                  )}
                  {property && (
                    <EmployeeSelection
                      suggested={property.suggestedEmployeeName || 'غير محدد'}
                      options={employees}
                      value={draft.propertyEmployeeUserId}
                      label="العقار تابع/مدخل بواسطة الموظف"
                      confirmed={propertyEmployeeConfirmed}
                      allowOverride={isOwner}
                      showConfirm={isOwner}
                      onChange={(userId) => {
                        const employee = employees.find(
                          (item) => item.userId === userId,
                        );
                        setDraft({
                          ...draft,
                          propertyEmployeeUserId: userId,
                          propertyEmployeeName: employee?.name ?? '',
                        });
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
                    <GlassCombobox
                      value={draft.clientId}
                      selectedLabel={selectedClient?.name}
                      options={clientOptions.map((item) => ({
                        value: item.id,
                        label: item.name,
                      }))}
                      onChange={(clientId) => {
                        const item =
                          clientOptions.find((c) => c.id === clientId) ??
                          clients.find((c) => c.id === clientId) ??
                          null;
                        setSelectedClient(item);
                        setDraft({
                          ...draft,
                          clientId,
                          clientEmployeeUserId: item?.employeeUserId ?? '',
                          clientEmployeeName: item?.employee ?? '',
                        });
                        setConfirmed({ ...confirmed, client: false });
                      }}
                      onQueryChange={setClientSearch}
                      filterLocally={false}
                      loading={clientLoading}
                      loadingMore={clientLoadingMore}
                      emptyLabel={
                        clientSearch.trim()
                          ? 'لا توجد نتائج'
                          : 'لا يوجد عملاء متاحون'
                      }
                      hasMore={Boolean(clientCursor)}
                      onLoadMore={() =>
                        void loadClients(
                          clientSearch,
                          clientCursor ?? undefined,
                          true,
                        )
                      }
                      label="اختيار العميل"
                      placeholder="ابحث باسم العميل أو الهاتف..."
                    />
                  </label>
                  {clientError && (
                    <div className={styles.notice}>
                      <p role="alert">{clientError}</p>
                      <Button
                        type="button"
                        onClick={() => void loadClients(clientSearch)}
                      >
                        إعادة المحاولة
                      </Button>
                    </div>
                  )}
                  {client && (
                    <EmployeeSelection
                      suggested={client.employee}
                      options={employees}
                      value={draft.clientEmployeeUserId}
                      label="العميل متابع بواسطة الموظف"
                      confirmed={clientEmployeeConfirmed}
                      allowOverride={isOwner}
                      showConfirm={isOwner}
                      onChange={(userId) => {
                        const employee = employees.find(
                          (item) => item.userId === userId,
                        );
                        setDraft({
                          ...draft,
                          clientEmployeeUserId: userId,
                          clientEmployeeName: employee?.name ?? '',
                        });
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
                    {property?.title} ({property?.code}) للعميل {client?.name}.
                  </p>
                  <p>
                    السعر: {money(draft.price)} · تاريخ الإغلاق: {draft.date}
                  </p>
                  <CommissionBreakdown
                    deal={{
                      companyCommission: draft.companyCommission,
                      propertyCommission: draft.propertyCommission,
                      clientCommission: draft.clientCommission,
                      propertyEmployee: draft.propertyEmployeeName,
                      clientEmployee: draft.clientEmployeeName,
                    }}
                  />
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
                  {propertyEmployeeConfirmed
                    ? draft.propertyEmployeeName
                    : 'بانتظار الاعتماد'}
                </dd>
              </div>
              <div>
                <dt>موظف العميل</dt>
                <dd>
                  {clientEmployeeConfirmed
                    ? draft.clientEmployeeName
                    : 'بانتظار الاعتماد'}
                </dd>
              </div>
            </dl>
          </Card>
          <Card>
            <h3>قبل إنشاء الصفقة</h3>
            <p>راجع السعر وتوزيع العمولات وبيانات الموظفين قبل التأكيد.</p>
            <p className={styles.muted}>
              سيتم حفظ الصفقة وتحديث حالة العقار عند التأكيد.
            </p>
          </Card>
        </aside>
      </div>
    </PropertyOverlay>
  );
}
