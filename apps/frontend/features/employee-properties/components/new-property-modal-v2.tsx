'use client';
import { useEffect, useRef, useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Button } from '../../../components/ui/button';
import { Toast } from '../../../components/ui/toast';
import { GlassSelect } from '../../../components/ui/glass-select';
import { GlassCombobox } from '../../../components/ui/glass-combobox';
import {
  useDraftScope,
  useDraftState,
} from '../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../lib/drafts/draft-tools';
import {
  blocksForArea,
  districtOptions,
  governorateForArea,
} from '../../../lib/area-governorate';
import type { Property } from '../model';
import { parsePropertyMessage } from './parse-property-message';
import {
  contactLabel,
  findContactByPhone,
  normalizePhone,
  useVisibleContacts,
  type ContactMode,
  type RegistryContact,
} from '../../../lib/contact-registry';
import { useAuth } from '../../auth/components/auth-provider';
import {
  createProperty,
  resubmitProperty,
  updateProperty,
} from '../../../lib/api/properties-api';
import {
  mapPropertyFromApi,
  needsResubmitAfterCorrection,
  toCreatePropertyPayload,
  toUpdatePropertyPayload,
} from '../../../lib/property-adapter';
import {
  applyLinkedContact,
  initialNewPropertyFormV2,
  linkedContactSelection,
  propertyAreaV2,
  type FloorEntry,
  type ListingOperation,
  type NewPropertyFormV2,
  type PropertyImage,
  type RequestedPropertyBudget,
} from './new-property-model-v2';
import styles from './new-property-modal-v2.module.css';

const STEPS = [
  'نوع العملية',
  'بيانات العقار',
  'المالك أو الوسيط والحفظ',
] as const;

const OPERATIONS: ListingOperation[] = ['بيع', 'إيجار', 'بدل'];

const FLOOR_LABELS = [
  'الأرضي',
  'الأول',
  'الثاني',
  'الثالث',
  'الرابع',
  'الخامس',
  'السادس',
  'السابع',
  'السطح',
  'القبو',
  'الميزانين',
  'أخرى',
];

const NEGOTIABLES = ['قابل للتفاوض', 'غير قابل للتفاوض', 'غير محدد'];

const uid = () => Math.random().toString(36).slice(2, 9);

function emptyFloor(index: number): FloorEntry {
  return {
    id: uid(),
    label: FLOOR_LABELS[index] || 'أخرى',
    customLabel: '',
    details: '',
  };
}

function formFromPropertyV2(property?: Property): NewPropertyFormV2 {
  if (!property) return initialNewPropertyFormV2;
  try {
    const parsed: unknown = JSON.parse(
      (property.description || '').split('\n\n=== العقار المطلوب في البدل ===')[0] ?? '',
    );
    if (
      parsed &&
      typeof parsed === 'object' &&
      'entryMethod' in parsed &&
      'floors' in parsed
    )
      return applyLinkedContact(
        {
          ...initialNewPropertyFormV2,
          ...(parsed as NewPropertyFormV2),
          // The structured description never carries contact data, so the stored
          // owner/broker fields are restored after the parsed form.
          ownerName: property.owner,
          contactPhone: property.phone,
          area: propertyAreaV2(parsed as Partial<NewPropertyFormV2>),
          floors: (parsed as NewPropertyFormV2).floors.map((floor) => ({ ...floor, id: floor.id || uid() })),
          image: null,
        },
        property,
      );
  } catch {
    /* Older free-text descriptions are not structured; fall back below. */
  }
  const operation = OPERATIONS.find((value) => value === property.operation);
  return applyLinkedContact(
    {
      ...initialNewPropertyFormV2,
      entryMethod: 'MANUAL',
      contactType: 'OWNER',
      ownerMode: 'NEW',
      ownerName: property.owner,
      contactPhone: property.phone,
      price: property.price,
      operation: operation || 'بيع',
      district: property.region,
      area: property.area,
    },
    property,
  );
}

function validateStepV2(
  form: NewPropertyFormV2,
  step: number,
  hasImage: boolean,
  records: RegistryContact[],
  linkedContactId: string | null = null,
): string {
  if (step === 0) {
    if (form.entryMethod === 'SMART_PASTE' && !form.pastedText.trim())
      return 'الصق رسالة الواتساب أولًا أو اختر الإدخال اليدوي.';
    if (!form.operation) return 'اختر نوع العملية.';
    return '';
  }
  if (step === 1) {
    if (!form.district.trim()) return 'اختر المنطقة.';
    // Area and plot number are now optional — no validation required
    if (propertyAreaV2(form).trim()) {
      const area = Number(propertyAreaV2(form));
      if (!Number.isFinite(area) || area <= 0)
        return 'أدخل مساحة صحيحة أكبر من صفر.';
    }
    // Price is now optional
    if (form.price.trim()) {
      if (!Number.isFinite(Number(form.price)) || Number(form.price) <= 0)
        return 'أدخل سعرًا صحيحًا أكبر من صفر.';
    }
    if (!hasImage) return 'أضف صورة واحدة للعقار من الجهاز.';
    if (form.operation === 'بدل') {
      const min = form.requestedProperty.budget.min.trim();
      const max = form.requestedProperty.budget.max.trim();
      if (min && (!Number.isFinite(Number(min)) || Number(min) < 0))
        return 'أدخل حدًا أدنى صحيحًا للميزانية.';
      if (max && (!Number.isFinite(Number(max)) || Number(max) < 0))
        return 'أدخل حدًا أعلى صحيحًا للميزانية.';
      if (min && max) {
        const minNum = Number(min);
        const maxNum = Number(max);
        if (!Number.isFinite(minNum) || minNum < 0)
          return 'أدخل حدًا أدنى صحيحًا للميزانية.';
        if (!Number.isFinite(maxNum) || maxNum < 0)
          return 'أدخل حدًا أعلى صحيحًا للميزانية.';
        if (minNum > maxNum)
          return 'الحد الأدنى للميزانية لا يمكن أن يتجاوز الحد الأعلى.';
      } else if (min && !Number.isFinite(Number(min))) {
        return 'أدخل حدًا أدنى صحيحًا للميزانية.';
      } else if (max && !Number.isFinite(Number(max))) {
        return 'أدخل حدًا أعلى صحيحًا للميزانية.';
      }
    }
    return '';
  }
  if (step === 2) {
    // The authorized linked contact of the row being edited is always a valid
    // target, even before the contact list finishes loading — otherwise a slow
    // or failed load would block an untouched save and push the user to "new
    // person", which is exactly what creates duplicates.
    const isResolvable = (id: string) =>
      (!!linkedContactId && id === linkedContactId) ||
      records.some((contact) => contact.id === id);
    if (form.contactType === 'BROKER') {
      if (form.brokerMode === 'EXISTING') {
        if (!isResolvable(form.brokerId))
          return 'اختر وسيطًا مسجلًا في النظام أو أضف وسيطًا جديدًا.';
      } else {
        if (!form.brokerName.trim()) return 'أدخل اسم الوسيط.';
        if (!normalizePhone(form.brokerPhone)) return 'أدخل رقم هاتف الوسيط.';
      }
    } else if (form.ownerMode === 'EXISTING') {
      if (!isResolvable(form.ownerId))
        return 'اختر مالكًا مسجلًا في النظام أو أضف مالكًا جديدًا.';
    } else {
      if (!form.ownerName.trim()) return 'أدخل اسم المالك.';
      if (!normalizePhone(form.contactPhone)) return 'أدخل رقم هاتف المالك.';
    }
    return '';
  }
  return '';
}

export function AddPropertyModalV2({
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
  const formKey = 'add-property-v3:' + (property?.id || 'new');
  const { clear: clearFormDraft } = useDraftScope(formKey);
  const { user } = useAuth();

  const [draft, setDraft] = useDraftState<NewPropertyFormV2>(
    formKey + ':draft',
    () => formFromPropertyV2(property),
  );
  // Editing an existing row opens directly on «بيانات العقار»: its listing type
  // is already fixed by the stored row (Step 1 merely displays it) and stays
  // reachable through «السابق». A NEW property always starts on Step 1. The two
  // targets keep separate draft keys — and the page remounts the wizard per
  // target — so an editing step or its data never leak into a new form. An
  // unsaved session on this same target still resumes its own stored step,
  // exactly like the restored form data; a successful save clears both.
  const [step, setStep] = useDraftState(
    formKey + ':step',
    property?.id ? 1 : 0,
  );
  // Optional floors (سرداب / نصف دور / ربع دور) may only be added by a tick
  // made in this wizard session. An autosaved draft restored on open can still
  // carry them from an earlier one, so starting a NEW property re-derives the
  // toggles from the fresh target — all off — instead of inheriting them.
  // Editing keeps the property's own stored selection (its draft key, and the
  // envelope restored above, both belong to that property alone).
  useEffect(() => {
    if (property) return;
    setDraft((previous) =>
      previous.hasBasement ||
      previous.hasHalfFloor ||
      previous.hasQuarterFloor ||
      previous.basementDetails ||
      previous.halfFloorDetails ||
      previous.quarterFloorDetails
        ? {
            ...previous,
            hasBasement: false,
            basementDetails: '',
            hasHalfFloor: false,
            halfFloorDetails: '',
            hasQuarterFloor: false,
            quarterFloorDetails: '',
          }
        : previous,
    );
  }, [property, setDraft]);

  const [image, setImage] = useState<PropertyImage | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const imageRef = useRef<PropertyImage | null>(null);
  const inFlight = useRef(false);
  imageRef.current = image;

  const showError = (message: string) => {
    setError(message);
    requestAnimationFrame(() =>
      errorMessage.current?.focus({ preventScroll: true }),
    );
  };

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    content.current?.scrollTo({ top: 0 });
  }, [step]);

  // The preview object URL belongs to this modal only — the parent list
  // refetches from the API, so the URL is always released on unmount.
  useEffect(
    () => () => {
      if (imageRef.current) URL.revokeObjectURL(imageRef.current.preview);
    },
    [],
  );

  const patch = (value: Partial<NewPropertyFormV2>) => {
    setError('');
    setDraft((previous) => ({ ...previous, ...value }));
  };

  const updateFloor = (id: string, value: Partial<FloorEntry>) =>
    setDraft((previous) => ({
      ...previous,
      floors: previous.floors.map((floor) =>
        floor.id === id ? { ...floor, ...value } : floor,
      ),
    }));

  const updateRequestedProperty = (value: Partial<typeof initialNewPropertyFormV2.requestedProperty>) =>
    setDraft((previous) => ({
      ...previous,
      requestedProperty: { ...previous.requestedProperty, ...value },
    }));

  const updateBudget = (value: Partial<RequestedPropertyBudget>) =>
    setDraft((previous) => ({
      ...previous,
      requestedProperty: {
        ...previous.requestedProperty,
        budget: { ...previous.requestedProperty.budget, ...value },
      },
    }));

  const setImageFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showError('الملف المرفوع ليس صورة. اختر ملف صورة صالحًا.');
      event.target.value = '';
      return;
    }
    if (image) URL.revokeObjectURL(image.preview);
    setImage({ file, preview: URL.createObjectURL(file) });
    setError('');
  };

  const removeImage = () => {
    if (image) URL.revokeObjectURL(image.preview);
    setImage(null);
  };

  const analyze = () => {
    const text = draft.pastedText.trim();
    if (!text) {
      showError('الصق رسالة الواتساب أولًا ثم اضغط تحليل النص.');
      return;
    }
    const { parsed } = parsePropertyMessage(text);
    const data = parsed.currentProperty;
    const operation = OPERATIONS.find((value) => value === data.operationType);
    setDraft((previous) => ({
      ...previous,
      operation: operation || previous.operation,
      governorate: data.governorate || previous.governorate,
      district: data.area || previous.district,
      block: data.block || previous.block,
      price: data.price || previous.price,
      area: data.size || propertyAreaV2(previous),
      parsedInfo: [
        'تم تحليل النص وتعبئة الحقول التالية — راجعها قبل المتابعة:',
        data.area && `المنطقة: ${data.area}`,
        data.price && `السعر: ${data.price}`,
        data.size && `المساحة: ${data.size}`,
        data.block && `القطعة: ${data.block}`,
      ]
        .filter(Boolean)
        .join('\n'),
    }));
    setError('');
    setNotice('تم تحليل النص وتعبئة الحقول');
  };

  const back = () => {
    setError('');
    setStep(Math.max(0, step - 1));
  };

  // Editing an existing row cannot replace its stored image (`PATCH` has no
  // image field), so the image already stored on the row satisfies the step.
  const editingExisting = Boolean(property?.id);
  const hasImage = !!image || editingExisting;
  const linkedContactId = property?.linkedContactId ?? null;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = validateStepV2(
      draft,
      step,
      hasImage,
      contactRecords,
      linkedContactId,
    );
    if (message) {
      showError(message);
      return;
    }
    setError('');
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }
    // Restored drafts intentionally do not contain device files. Recheck all
    // stages before saving, including a draft reopened on the final stage.
    for (let index = 0; index < STEPS.length - 1; index++) {
      const previousError = validateStepV2(
        draft,
        index,
        hasImage,
        contactRecords,
        linkedContactId,
      );
      if (previousError) {
        setStep(index);
        showError(previousError);
        return;
      }
    }
    // Synchronous guard so a fast double click cannot post twice.
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);

    const options = { derivedGovernorate };
    try {
      if (property?.id) {
        if (property.version === undefined)
          throw new Error(
            'تعذّر تحديد إصدار السجل. حدّث الصفحة ثم حاول مرة أخرى.',
          );
        const patched = await updateProperty(
          property.id,
          toUpdatePropertyPayload(draft, property.version, options),
        );
        // Correcting a REJECTED row — or a PENDING row whose manager requested
        // changes — must not publish it: it only goes back to review when the
        // employee explicitly resubmits.
        if (needsResubmitAfterCorrection(patched)) {
          try {
            const resubmitted = await resubmitProperty(patched.id);
            onSave([mapPropertyFromApi(resubmitted, user)]);
            clearFormDraft();
          } catch (cause) {
            onSave([mapPropertyFromApi(patched, user)]);
            showError(
              `${cause instanceof Error ? cause.message : 'تعذّرت إعادة الإرسال للمراجعة.'} — تم حفظ التعديلات فقط.`,
            );
          }
          return;
        }
        onSave([mapPropertyFromApi(patched, user)]);
        clearFormDraft();
        return;
      }
      if (!image?.file) {
        showError('أضف صورة واحدة للعقار من الجهاز.');
        return;
      }
      const created = await createProperty(
        toCreatePropertyPayload(draft, options),
        image.file,
      );
      onSave([mapPropertyFromApi(created, user)]);
      clearFormDraft();
    } catch (cause) {
      // The modal stays open and every entered value is preserved on failure.
      showError(
        cause instanceof Error
          ? cause.message
          : 'تعذر حفظ العقار. حاول مرة أخرى.',
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const blocks = draft.district ? blocksForArea(draft.district) : [];
  const derivedGovernorate = draft.district
    ? governorateForArea(draft.district)
    : '';
  const isExchange = draft.operation === 'بدل';
  const isBroker = draft.contactType === 'BROKER';

  const contactRecords = useVisibleContacts(user, draft.contactType);
  /**
   * The contact linked to the row being edited. When the authorized response
   * carried it, step 3 is pinned to it until the user explicitly switches mode
   * or picks another contact — so an untouched edit/resubmit can never create a
   * duplicate person.
   */
  const linkedSelection = linkedContactSelection(property, draft);
  const contactMode: ContactMode = linkedSelection
    ? 'EXISTING'
    : isBroker
      ? draft.brokerMode
      : draft.ownerMode;
  const contactId = linkedSelection ?? (isBroker ? draft.brokerId : draft.ownerId);
  const contactName = isBroker ? draft.brokerName : draft.ownerName;
  const contactPhone = isBroker ? draft.brokerPhone : draft.contactPhone;
  const selectedContact = contactRecords.find(
    (record) => record.id === contactId,
  );
  const duplicateContact =
    contactMode === 'NEW' && contactPhone.trim()
      ? findContactByPhone(draft.contactType, contactPhone, contactRecords)
      : undefined;

  const setContactMode = (mode: ContactMode) => {
    // Leaving the preselected linked contact is an explicit act: the form then
    // carries an empty id, so the save either keeps the original id (unchanged)
    // or sends a deliberately entered new person — never a silent re-selection.
    patch(
      isBroker
        ? mode === 'NEW'
          ? { brokerMode: mode, brokerId: '', brokerName: '', brokerPhone: '' }
          : { brokerMode: mode }
        : mode === 'NEW'
        ? { ownerMode: mode, ownerId: '', ownerName: '', contactPhone: '' }
        : { ownerMode: mode },
    );
  };

  const selectContact = (id: string) => {
    const record = contactRecords.find((contact) => contact.id === id);
    if (!record) {
      // An id we cannot resolve must never degrade into "new person": keep the
      // selection empty, show the reason and block the step.
      showError('اختر جهة تواصل مسجلة، أو حدث الصفحة ثم أعد المحاولة.');
      return;
    }
    patch(
      isBroker
        ? {
            brokerId: record.id,
            brokerName: record.name,
            brokerPhone: record.phone,
          }
        : {
            ownerId: record.id,
            ownerName: record.name,
            contactPhone: record.phone,
          },
    );
  };

  const reuseContact = (record: RegistryContact) =>
    patch(
      isBroker
        ? {
            brokerMode: 'EXISTING',
            brokerId: record.id,
            brokerName: record.name,
            brokerPhone: record.phone,
          }
        : {
            ownerMode: 'EXISTING',
            ownerId: record.id,
            ownerName: record.name,
            contactPhone: record.phone,
          },
    );

  const previewTitle = `${draft.operation} · ${draft.district || draft.governorate || ''}`.trim() || draft.operation;

  return (
    <PropertyOverlay
      title={property ? 'تعديل وإعادة إرسال العقار' : 'إضافة عقار'}
      className={styles.modal}
      onClose={onClose}
    >
      <ol className={styles.steps} aria-label="مراحل إضافة العقار">
        {STEPS.map((title, index) => (
          <li key={title} data-complete={index < step} aria-current={step === index ? 'step' : undefined}>
            <span className={styles.stepNumber}>{index < step ? '✓' : index + 1}</span>
            <span>{title}</span>
          </li>
        ))}
      </ol>
      <div className={styles.stageHeader}>
      <span className={styles.eyebrow}>الخطوة {step + 1} من 3</span>
      <h2 className={styles.stageTitle} ref={heading} tabIndex={-1}>
        {STEPS[step] || STEPS[0]}
      </h2>
      <p>{['حدّد نوع العرض والطريقة الأنسب لإدخال بياناتك.', 'أضف الموقع والتفاصيل وصورة واضحة للعقار.', 'اربط جهة التواصل وراجع الملخص قبل الحفظ.'][step]}</p>
      </div>
      <DraftTools formKey={formKey} />
      <form className={styles.form} noValidate onSubmit={submit}>
        <div className={styles.content} ref={content}>
          {step === 0 && (
            <section className={styles.panel}>
              <h3>نوع العملية</h3>
              <div className={styles.operationChoices} role="group" aria-label="نوع العملية">
                {OPERATIONS.map((op) => (
                  <button
                    key={op}
                    type="button"
                    className={styles.choice}
                    aria-pressed={draft.operation === op}
                    onClick={() => patch({ operation: op })}
                  >
                    <svg className={styles.operationIcon} aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      {op === 'بيع' ? <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" /> : op === 'إيجار' ? <><circle cx="8" cy="8" r="5" /><path d="m12 12 9 9m-4-4 3-3m-6 3 3-3" /></> : <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />}
                    </svg>
                    <strong>{op}</strong>
                    <small>{op === 'بيع' ? 'عرض العقار للبيع' : op === 'إيجار' ? 'عرض العقار للإيجار' : 'مبادلة بعقار آخر'}</small>
                  </button>
                ))}
              </div>

              <h3 className={styles.subheading}>كيف تريد إدخال بيانات العقار؟</h3>
              <div className={styles.flexRow}>
                <button
                  type="button"
                  className={styles.choice}
                  aria-pressed={draft.entryMethod === 'SMART_PASTE'}
                  onClick={() => patch({ entryMethod: 'SMART_PASTE' })}
                >
                  <strong>لصق ذكي من واتساب</strong>
                  <small>الصق وصف العقار ليُستخرج منه ما يمكن تحليله.</small>
                </button>
                <button
                  type="button"
                  className={styles.choice}
                  aria-pressed={draft.entryMethod === 'MANUAL'}
                  onClick={() => patch({ entryMethod: 'MANUAL' })}
                >
                  <strong>إدخال يدوي</strong>
                  <small>املأ بيانات العقار خطوة بخطوة دون تحليل.</small>
                </button>
              </div>
              {draft.entryMethod === 'SMART_PASTE' && (
                <>
                  <label className={`${styles.field} ${styles.wideField}`}>
                    رسالة الواتساب
                    <textarea
                      value={draft.pastedText}
                      placeholder="الصق وصف العقار كما وصلك: للبيع بيت في المطلاع قطعة 8، السعر 290 ألف، المالك أبو فهد..."
                      onChange={(event) =>
                        patch({ pastedText: event.target.value })
                      }
                    />
                  </label>
                  <div className={styles.flexRow}>
                    <Button type="button" onClick={analyze}>
                      تحليل النص وتعبئة الحقول
                    </Button>
                    <Button
                      type="button"
                      onClick={() =>
                        patch({ pastedText: '', parsedInfo: undefined })
                      }
                    >
                      مسح النص
                    </Button>
                  </div>
                  {draft.parsedInfo && (
                    <p className={styles.hint}>{draft.parsedInfo}</p>
                  )}
                </>
              )}
            </section>
          )}

          {step === 1 && (
            <>
              <section className={styles.panel}>
                <h3>{isExchange ? 'العقار المعروض للبدل' : 'موقع العقار ومساحته'}</h3>
                <div className={styles.grid}>
                  <label className={styles.field}>
                    المحافظة
                    <input
                      value={draft.governorate || derivedGovernorate}
                      onChange={(event) =>
                        patch({ governorate: event.target.value })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    المنطقة <span className={styles.required}>مطلوب</span>
                    <GlassCombobox
                      label="المنطقة"
                      value={draft.district}
                      options={districtOptions}
                      placeholder="ابحث عن المنطقة..."
                      onChange={(value) =>
                        patch({
                          district: value,
                          block: '',
                          governorate: governorateForArea(value),
                        })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    القطعة
                    {blocks.length ? (
                      <GlassSelect
                        value={draft.block}
                        onChange={(event) =>
                          patch({ block: event.target.value })
                        }
                      >
                        <option value="">اختر القطعة</option>
                        {blocks.map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </GlassSelect>
                    ) : (
                      <input
                        value={draft.block}
                        onChange={(event) =>
                          patch({ block: event.target.value })
                        }
                      />
                    )}
                  </label>
                  <label className={styles.field}>
                    رقم القسيمة <span className={styles.optional}>اختياري</span>
                    <input
                      value={draft.plotNumber}
                      onChange={(event) =>
                        patch({ plotNumber: event.target.value })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    المساحة (م²) <span className={styles.optional}>اختياري</span>
                    <input
                      inputMode="decimal"
                      value={propertyAreaV2(draft)}
                      onChange={(event) =>
                        patch({ area: event.target.value })
                      }
                    />
                  </label>
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.sectionHeader}>
                  <h3>الأدوار</h3>
                  <Button
                    type="button"
                    onClick={() =>
                      setDraft((previous) => ({
                        ...previous,
                        floors: [
                          ...previous.floors,
                          emptyFloor(previous.floors.length),
                        ],
                        floorCount: previous.floors.length + 1,
                      }))
                    }
                  >
                    إضافة دور
                  </Button>
                </div>
                {!draft.floors.length && (
                  <p className={styles.hint}>
                    لا توجد أدوار مضافة. يمكنك المتابعة دون أدوار، أو إضافة تفاصيل المبنى هنا.
                  </p>
                )}
                {draft.floors.map((floor, floorIndex) => (
                  <div className={styles.floor} key={floor.id}>
                    <div className={styles.floorHeader}>
                      <strong>
                        {floor.customLabel || floor.label || `الدور ${floorIndex + 1}`}
                      </strong>
                      <Button
                        type="button"
                        onClick={() =>
                          setDraft((previous) => ({
                            ...previous,
                            floors: previous.floors.filter(
                              (item) => item.id !== floor.id,
                            ),
                            floorCount: previous.floors.length - 1,
                          }))
                        }
                      >
                        حذف الدور
                      </Button>
                    </div>
                    <div className={styles.grid}>
                      <label className={styles.field}>
                        التسمية
                        <GlassSelect
                          value={floor.label}
                          onChange={(event) =>
                            updateFloor(floor.id, {
                              label: event.target.value,
                            })
                          }
                        >
                          {FLOOR_LABELS.map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </GlassSelect>
                      </label>
                      {floor.label === 'أخرى' && (
                        <label className={styles.field}>
                          اسم الدور
                          <input
                            value={floor.customLabel}
                            onChange={(event) =>
                              updateFloor(floor.id, {
                                customLabel: event.target.value,
                              })
                            }
                          />
                        </label>
                      )}
                      <label className={`${styles.field} ${styles.wideField}`}>
                        تفاصيل الدور
                        <textarea
                          value={floor.details}
                          placeholder="مثال: شقتان 3 غرف + صالة، حمامان، مطبخ راكب، بلكونة، تشطيب ممتاز"
                          onChange={(event) =>
                            updateFloor(floor.id, {
                              details: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                ))}

                <div className={`${styles.grid} ${styles.extraFloors}`}>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={draft.hasBasement}
                      onChange={(event) =>
                        patch({ hasBasement: event.target.checked })
                      }
                    />
                    <strong>سرداب</strong>
                  </label>
                  {draft.hasBasement && (
                    <label className={`${styles.field} ${styles.wideField}`}>
                      تفاصيل السرداب
                      <textarea
                        value={draft.basementDetails || ''}
                        placeholder="تفاصيل السرداب: مساحته، استخدامه، عدد الغرف..."
                        onChange={(event) =>
                          patch({ basementDetails: event.target.value })
                        }
                      />
                    </label>
                  )}

                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={draft.hasHalfFloor}
                      onChange={(event) =>
                        patch({ hasHalfFloor: event.target.checked })
                      }
                    />
                    <strong>نصف دور</strong>
                  </label>
                  {draft.hasHalfFloor && (
                    <label className={`${styles.field} ${styles.wideField}`}>
                      تفاصيل نصف الدور
                      <textarea
                        value={draft.halfFloorDetails || ''}
                        placeholder="تفاصيل نصف الدور..."
                        onChange={(event) =>
                          patch({ halfFloorDetails: event.target.value })
                        }
                      />
                    </label>
                  )}

                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={draft.hasQuarterFloor}
                      onChange={(event) =>
                        patch({ hasQuarterFloor: event.target.checked })
                      }
                    />
                    <strong>ربع دور</strong>
                  </label>
                  {draft.hasQuarterFloor && (
                    <label className={`${styles.field} ${styles.wideField}`}>
                      تفاصيل ربع الدور
                      <textarea
                        value={draft.quarterFloorDetails || ''}
                        placeholder="تفاصيل ربع الدور..."
                        onChange={(event) =>
                          patch({ quarterFloorDetails: event.target.value })
                        }
                      />
                    </label>
                  )}
                </div>
              </section>

              <section className={styles.panel}>
                <h3>{draft.operation === 'بيع' ? 'سعر البيع' : draft.operation === 'إيجار' ? 'سعر الإيجار' : 'سعر العقار المعروض'} (د.ك)</h3>
                <div className={styles.grid}>
                  <label className={styles.field}>
                    السعر <span className={styles.optional}>اختياري</span>
                    <input
                      inputMode="decimal"
                      value={draft.price}
                      onChange={(event) => patch({ price: event.target.value })}
                    />
                  </label>
                  <label className={styles.field}>
                    قابل للتفاوض؟
                    <GlassSelect
                      value={draft.negotiable}
                      onChange={(event) =>
                        patch({ negotiable: event.target.value as typeof draft.negotiable })
                      }
                    >
                      {NEGOTIABLES.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </GlassSelect>
                  </label>
                </div>
              </section>

              <section className={styles.panel}>
                <h3>صورة العقار الرئيسية <span className={styles.required}>مطلوبة</span></h3>
                <label className={styles.uploadArea}>
                  <span className={styles.uploadIcon} aria-hidden="true">＋</span>
                  <strong>{image ? 'استبدال الصورة' : 'اختر صورة من جهازك'}</strong>
                  <span>صورة واحدة واضحة للعقار · اضغط للاختيار</span>
                  <input type="file" accept="image/*" onChange={setImageFile} />
                </label>
                {image ? (
                  <div className={styles.uploadPreview}>
                    <img
                      className={styles.image}
                      src={image.preview}
                      alt="معاينة صورة العقار"
                    />
                    <span>{image.file.name}</span>
                    <div className={styles.flexRow}>
                      <Button type="button" onClick={removeImage}>
                        إزالة الصورة
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className={styles.hint}>
                    صورة واحدة إلزامية. لا تُقبل روابط صور أو معرض أو فيديو.
                  </p>
                )}
                {editingExisting && image && (
                  <p className={styles.hint}>
                    صورة العقار المحفوظة ستبقى كما هي — استبدال الصورة غير مدعوم
                    عند التعديل في هذه المرحلة.
                  </p>
                )}
              </section>

              {isExchange && (
                <>
                  <section className={styles.panel}>
                    <h3>العقار المطلوب في البدل</h3>
                    <p className={styles.hint}>
                      هذه البيانات تصف ما تريد الحصول عليه في البدل. جميع الحقول اختيارية.
                    </p>
                    <div className={styles.grid}>
                      <label className={styles.field}>
                        المحافظة
                        <input
                          value={draft.requestedProperty.governorate}
                          onChange={(event) =>
                            updateRequestedProperty({
                              governorate: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        المنطقة
                        <GlassCombobox
                          label="المنطقة"
                          value={draft.requestedProperty.district}
                          options={districtOptions}
                          placeholder="ابحث عن المنطقة..."
                          onChange={(value) =>
                            updateRequestedProperty({
                              district: value,
                              block: '',
                              governorate: governorateForArea(value),
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        القطعة
                        <input
                          value={draft.requestedProperty.block}
                          onChange={(event) =>
                            updateRequestedProperty({
                              block: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        رقم القسيمة
                        <input
                          value={draft.requestedProperty.plotNumber}
                          onChange={(event) =>
                            updateRequestedProperty({
                              plotNumber: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        المساحة (م²)
                        <input
                          inputMode="decimal"
                          value={draft.requestedProperty.area}
                          onChange={(event) =>
                            updateRequestedProperty({
                              area: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className={`${styles.field} ${styles.wideField}`}>
                      متطلبات الأدوار
                      <textarea
                        value={draft.requestedProperty.floorRequirements}
                        placeholder="مثال: 3 أدوار، دور أرضي + دورين، سرداب مطلوب..."
                        onChange={(event) =>
                          updateRequestedProperty({
                            floorRequirements: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className={`${styles.field} ${styles.wideField}`}>
                      ملاحظات
                      <textarea
                        value={draft.requestedProperty.notes}
                        placeholder="أي ملاحظات إضافية عن العقار المطلوب..."
                        onChange={(event) =>
                          updateRequestedProperty({
                            notes: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className={styles.grid}>
                      <label className={styles.field}>
                        السعر من (د.ك) — الحد الأدنى
                        <input
                          inputMode="decimal"
                          value={draft.requestedProperty.budget.min}
                          onChange={(event) =>
                            updateBudget({ min: event.target.value })
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        السعر إلى (د.ك) — الحد الأعلى
                        <input
                          inputMode="decimal"
                          value={draft.requestedProperty.budget.max}
                          onChange={(event) =>
                            updateBudget({ max: event.target.value })
                          }
                        />
                      </label>
                    </div>
                  </section>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <section className={styles.panel}>
                <h3>نوع جهة التواصل</h3>
                <div className={`${styles.flexRow} ${styles.contactChoices}`}>
                  <button
                    type="button"
                    className={styles.choice}
                    aria-pressed={!isBroker}
                    onClick={() => patch({ contactType: 'OWNER' })}
                  >
                    <strong>مالك مباشر</strong>
                    <small>تسجيل العقار من المالك نفسه.</small>
                  </button>
                  <button
                    type="button"
                    className={styles.choice}
                    aria-pressed={isBroker}
                    onClick={() => patch({ contactType: 'BROKER' })}
                  >
                    <strong>وسيط عقاري</strong>
                    <small>العقار معروض عبر وسيط أو مكتب وساطة.</small>
                  </button>
                </div>
              </section>

              <section className={styles.panel}>
                <h3>{isBroker ? 'بيانات الوسيط' : 'بيانات المالك'}</h3>
                <div className={`${styles.flexRow} ${styles.modeChoices}`}>
                  <button
                    type="button"
                    className={styles.choice}
                    aria-pressed={contactMode === 'EXISTING'}
                    onClick={() => setContactMode('EXISTING')}
                  >
                    <strong>
                      {isBroker
                        ? 'اختيار وسيط مسجل في النظام'
                        : 'اختيار مالك مسجل في النظام'}
                    </strong>
                    <small>ابحث بالاسم أو رقم الهاتف.</small>
                  </button>
                  <button
                    type="button"
                    className={styles.choice}
                    aria-pressed={contactMode === 'NEW'}
                    onClick={() => setContactMode('NEW')}
                  >
                    <strong>{isBroker ? 'إضافة وسيط جديد' : 'إضافة مالك جديد'}</strong>
                    <small>أدخل الاسم ورقم الهاتف.</small>
                  </button>
                </div>

                {contactMode === 'EXISTING' ? (
                  <div className={styles.grid}>
                    <label className={`${styles.field} ${styles.wideField}`}>
                      {isBroker ? 'الوسيط المسجل' : 'المالك المسجل'}
                      <GlassCombobox
                        label={isBroker ? 'الوسيط المسجل' : 'المالك المسجل'}
                        value={contactId}
                        options={contactRecords.map((record) => ({
                          value: record.id,
                          label: contactLabel(record),
                        }))}
                        onChange={selectContact}
                      />
                    </label>
                    {selectedContact && (
                      <p className={styles.selectedContact}>
                        <strong>{selectedContact.name}</strong>
                        <span>{selectedContact.phone}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className={styles.grid}>
                    <label className={styles.field}>
                      {isBroker ? 'اسم الوسيط' : 'اسم المالك'}
                      <input
                        required
                        value={contactName}
                        onChange={(event) =>
                          patch(
                            isBroker
                              ? { brokerName: event.target.value }
                              : { ownerName: event.target.value },
                          )
                        }
                      />
                    </label>
                    <label className={styles.field}>
                      رقم الهاتف
                      <input
                        required
                        type="tel"
                        value={contactPhone}
                        onChange={(event) =>
                          patch(
                            isBroker
                              ? { brokerPhone: event.target.value }
                              : { contactPhone: event.target.value },
                          )
                        }
                      />
                    </label>
                  </div>
                )}

                {contactMode === 'NEW' && duplicateContact && (
                  <p className={styles.hint}>
                    يوجد {isBroker ? 'وسيط' : 'مالك'} مسجل بنفس رقم الهاتف:{' '}
                    {duplicateContact.name} — {duplicateContact.phone}.{' '}
                    <Button
                      type="button"
                      onClick={() => reuseContact(duplicateContact)}
                    >
                      استخدام السجل الموجود
                    </Button>
                  </p>
                )}
              </section>

              <section className={styles.panel}>
                <h3>ملخص قبل الحفظ</h3>
                <div className={styles.previewCard}>
                  {image ? (
                    <img
                      className={styles.image}
                      src={image.preview}
                      alt="صورة العقار"
                    />
                  ) : (
                    <p className={styles.errorText}>
                      لا توجد صورة للعقار بعد. ارجع إلى الخطوة الثانية وارفع صورة.
                    </p>
                  )}
                  <div className={styles.summaryDetails}>
                  <strong>{previewTitle}</strong>
                  <p>
                    {draft.price
                      ? `${Number(draft.price).toLocaleString('ar-KW')} د.ك`
                      : 'السعر غير محدد'}{' '}
                    · {draft.operation}
                    {draft.negotiable !== 'غير محدد' && ` · ${draft.negotiable}`}
                  </p>
                  <p className={styles.hint}>
                    {draft.district || 'المنطقة غير محددة'} ·{' '}
                    {propertyAreaV2(draft) || '—'} م² ·{' '}
                    {draft.floors.length
                      ? `${draft.floors.length} دور`
                      : 'عدد الأدوار غير محدد'}
                    {draft.hasBasement && ' · سرداب'}
                    {draft.hasHalfFloor && ' · نصف دور'}
                    {draft.hasQuarterFloor && ' · ربع دور'}
                    {isExchange && ' · بدل'}
                  </p>
                  <p className={styles.summaryContact}>
                    جهة التواصل: {isBroker ? 'وسيط' : 'مالك'} — {contactName || '—'}{' '}
                    {contactPhone && <bdi dir="ltr">({contactPhone})</bdi>}
                  </p>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
        {error && (
          <p
            className={styles.errorText}
            ref={errorMessage}
            role="alert"
            tabIndex={-1}
          >
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Button className={styles.cancelAction} variant="ghost" type="button" onClick={onClose}>
            إلغاء
          </Button>
          {step > 0 && (
            <Button variant="ghost" type="button" onClick={back}>
              السابق
            </Button>
          )}
          <Button
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
          >
            {step === STEPS.length - 1
              ? submitting
                ? 'جارٍ الحفظ…'
                : property
                  ? 'حفظ التعديلات وإعادة الإرسال'
                  : manager
                    ? 'إضافة العقار'
                    : 'إرسال العقار للمراجعة'
              : 'التالي'}
          </Button>
        </div>
      </form>
      <Toast message={notice} onDismiss={() => setNotice('')} />
    </PropertyOverlay>
  );
}
