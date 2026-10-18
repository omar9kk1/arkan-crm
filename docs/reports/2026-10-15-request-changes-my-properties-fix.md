# سير عمل «طلب تعديل» للمدير وإصلاح تبويب «عقاراتي» للموظف — Phase 4B

- **التاريخ:** 2026-10-15
- **المشروع:** Arkan CRM (أركان الخليج العقارية)
- **المرحلة:** Phase 4B — فصل «طلب تعديل» عن «الرفض» كنقطة نهاية مستقلة للمدير، وإصلاح تبويب «عقاراتي» ليبقى عقار الموظف المعتمد ظاهرًا له
- **الفرع/الالتزام:** `main` — `HEAD = ff71379`، جميع التغييرات **غير مُلتزمة** (لا commit ولا push)
- **مراجع سابقة:** [frontend-properties-contacts-integration](./2026-10-15-frontend-properties-contacts-integration.md)، [contacts-properties-backend-apis](./2026-10-15-contacts-properties-backend-apis.md)، [property-image-privacy-hardening](./2026-10-15-property-image-privacy-hardening.md)، [development-database-migration](./2026-10-15-development-database-migration.md)

> **نطاق هذه المرحلة:** فصل «طلب تعديل» عن «الرفض» في الخلفية (نقطة نهاية مستقلة) والواجهة (ثلاثة إجراءات مدير مميّزة)، وإصلاح تبويب «عقاراتي» للموظف، ثم إثبات ذلك باختبارات آلية، وكتابة هذا التقرير والتوقف. **لا حاجة إلى ترحيل جديد** (المخطط يدعم الحالة كاملة)، **لا إعادة تصميم**، **لا خطوة رابعة في المعالج**، **لا استبدال صورة**، **لا مساس بسجلات العملاء/المتابعات**، **لا اعتمادية جديدة**. كل ما وُصف «مُنفَّذ» تحقّقت منه بالأوامر المذكورة في القسم 12، وكل ما لم يُختبَر آليًا مُصنَّف `Not Tested` بصراحة.

---

## 1. الملخص التنفيذي ونطاق المرحلة

كانت مرحلة 4A تُعيد توجيه زرَّي «طلب تعديل» و«رفض» إلى **نفس** نقطة النهاية `POST /properties/:id/reject` (توثيق مطابقة، لا وظيفة حقيقية). كما كان تبويب «عقاراتي» محدودًا بالصفوف `PENDING`/`REJECTED`، فعقار الموظف **المعتمد** (`AVAILABLE`) كان يختفي من التبويب.

**ما أُنجز فعليًا في هذه المرحلة:**

1. **نقطة نهاية خلفية مستقلة** `POST /properties/:id/request-changes` (للمدير فقط) تُبقي `Property.status = PENDING` وتحوّل طلب المراجعة الحالي إلى `CHANGES_REQUESTED` مع تخزين الإرشادات في `PropertyApprovalRequest.notes` وتسجيل المراجع وختم الزمن وزيادة `version` وكتابة حدث تدقيق.
2. **ضبط الاعتماد والرفض** ليمتنعا (409) ما دام أحدث طلب مراجعة غير `PENDING` (أي `CHANGES_REQUESTED`)، فلا يمكن اعتماد/رفض نفس الطلب قبل إعادة إرسال الموظف.
3. **توسيع إعادة الإرسال** `POST /properties/:id/resubmit` ليدعم حالتين: (أ) `REJECTED` كما كان، (ب) `PENDING` مع أحدث مراجعة `CHANGES_REQUESTED`؛ مع إنشاء **طلب `PENDING` جديد** والحفاظ على السجل السابق.
4. **حقل DTO مشتق من العارض** `isMine: boolean` على `PublicPropertyDto` (يُحسب على الخادم من مطابقة منشئ العقار بالمستخدم المُصادَق) لإصلاح تبويب «عقاراتي».
5. **`reviewStatus` و`reviewNotes`** على `PrivatePropertyDto` (المدير وصاحب العقار فقط) مشتقّان من **أحدث** طلب مراجعة.
6. **الواجهة الأمامية:** محوّل العرض يعرض «مطلوب تعديل» عندما `reviewStatus === 'CHANGES_REQUESTED'`، وزر «طلب تعديل» للمدير يستدعي النقطة الجديدة، وقائمة اعتماد المدير تستبعد `CHANGES_REQUESTED` من الصفوف القابلة للقرار، والمعالج يُعيد الإرسال أيضًا بعد طلب التعديل.
7. **20 اختبارًا آليًا جديدًا** على خلفية وقاعدة معزولة (13 في ملف سير العمل الجديد + 6 في محوّل العرض + 1 في عقد الواجهة).

**ما تبقّى خارج النطاق عمديًا:** تعديل العقارات المتاحة (`PropertyRevision`)، استبدال صورة عند التعديل، استمرارية سجل المتابعات، وتبويب «المُسنَد» (القسم 14).

---

## 2. جدول الحالة التفصيلي

| البند | الحالة | الدليل |
| --- | --- | --- |
| نقطة `POST /properties/:id/request-changes` (مدير فقط) | `Completed` | اختبارات `property-request-changes.spec.ts` (صعود/403/409) |
| بقاء `Property.status = PENDING` عند طلب التعديل | `Completed` | اختبار: `data.status === 'PENDING'` + قراءة مباشرة من القاعدة |
| تحوّل المراجعة الحالية إلى `CHANGES_REQUESTED` + تخزين الإرشادات | `Completed` | اختبار: `approvals[0].status/notes/reviewedById/reviewedAt` |
| سبب/إرشادات إلزامية غير فارغة | `Completed` | سبب من مسافات → 400 (بلا تغيير للصف) |
| كتابة حدث تدقيق بلا نص الإرشادات | `Completed` | اختبار: وجود `PROPERTY_REQUEST_CHANGES` وخلوّه من نص السبب |
| منع اعتماد/رفض الطلب بعد طلب التعديل | `Completed` | اختبار: كلاهما 409 و`version` لم يتغيّر |
| منع طلب التعديل على عقار غير `PENDING` | `Completed` | اختبار: 409 بعد الاعتماد |
| حماية تقادم `version` على طلب التعديل | `Completed` | اختبار: `version + 5` → 409 |
| إخفاء العقار عن موظف آخر أثناء طلب التعديل | `Completed` | اختبار: 404 للقراءة + غيابه عن القائمة |
| رؤية صاحب العقار لحالة المراجعة والإرشادات | `Completed` | اختبار: `reviewStatus = CHANGES_REQUESTED` + `reviewNotes` |
| إعادة الإرسال بعد طلب التعديل تُنشئ طلبًا جديدًا وتحفظ السجل | `Completed` | اختبار: `['CHANGES_REQUESTED','PENDING']` بالترتيب + بقاء الإرشادات |
| منع الإصلاح وحده من النشر | `Completed` | بعد `PATCH` بقيت `PENDING` + `reviewStatus = CHANGES_REQUESTED` |
| اعتماد المدير بعد إعادة الإرسال | `Completed` | اختبار: `AVAILABLE` ثم `reviewStatus = APPROVED` |
| منع إعادة إرسال مكرَّرة | `Completed` | الاختبار الثاني → 409 |
| التزامن: قرار مدير واحد ينجح | `Completed` | سباق `request-changes` ضد `approve` → `[200,409]` |
| بقاء سير «رفض ← تصحيح ← إعادة إرسال» | `Completed` | اختبار: `['REJECTED','PENDING']` |
| `isMine` للعارض الصحيح (المالك vs غيره) | `Completed` | اختبار: `true` للمالك و`false` لغيره عبر القراءة والقائمة |
| عدم تسريب جهة التواصل الخاصة لغير المالك | `Completed` | اختبار: غياب `contact`/`contactId` وغياب الاسم/الهاتف من الاستجابة |
| عقار المدير يبقى `AVAILABLE` فورًا بلا سجل مراجعة | `Completed` | اختبار: `AVAILABLE` + `reviewStatus = null` + عدد مراجعات `0` |
| عرض «مطلوب تعديل» في المحوّل (مدير/موظف) | `Completed` | اختبارات المحوّل: `displayStatus` + `managerNotes` |
| قرار إعادة الإرسال في المحوّل (`needsResubmitAfterCorrection`) | `Completed` | اختبارات المحوّل: `REJECTED`/`CHANGES_REQUESTED` فقط |
| زرّا «طلب تعديل» و«رفض» للمدير يستدعيان نقطتين مختلفتين | `Completed` (منطق) / `Not Tested` (نقر المتصفح) | مراجعة مصدر + بناء ناجح |
| واجهة الموظف: إظهار الإرشادات + زر «تعديل وإعادة إرسال» | `Completed` (منطق الربط) / `Not Tested` (تفاعل React) | مراجعة مصدر (`employee-property-details-drawer.tsx`) |
| بقية اختبارات المشروع تمر | `Completed` | `126 passed` / `11 suites` |
| تعديل العقارات المتاحة (`PropertyRevision`) | `Not Implemented` | خارج النطاق |
| استبدال صورة عند التعديل | `Not Implemented` | خارج النطاق |
| تبويب «المُسنَد» | `Not Implemented` | لا حقل تكليف في الخلفية |

---

## 3. الملفات المُنشأة والمُعدَّلة

**ملفات جديدة (Phase 4B):**

| الملف | الدور |
| --- | --- |
| `apps/backend/src/properties/dto/request-changes.dto.ts` | `RequestChangesDto`: `reason` إلزامي (1..2000) + `version` اختياري |
| `apps/backend/test/property-request-changes.spec.ts` | 13 اختبار تكامل لسير عمل «طلب تعديل» على خادم وقاعدة حقيقيين |
| `docs/reports/2026-10-15-request-changes-my-properties-fix.md` | هذا التقرير |

**ملفات مُعدَّلة (Phase 4B):**

| الملف | التغيير |
| --- | --- |
| `apps/backend/src/properties/properties.service.ts` | `requestChanges` جديدة؛ ضبط `approve`/`reject`؛ توسيع `resubmit` |
| `apps/backend/src/properties/properties.controller.ts` | مسار `POST :id/request-changes` بـ `@Roles(Role.MANAGER)` |
| `apps/backend/src/properties/property-serializer.ts` | `isMine` على العام؛ `reviewStatus` على الخاص؛ `latestReviewNotes` من أحدث مراجعة |
| `apps/backend/src/properties/property.dto.ts` | `isMine` على `PublicPropertyDto`، و`reviewStatus` على `PrivatePropertyDto` |
| `apps/frontend/lib/api/property-types.ts` | `ApprovalStatusApi`، `isMine`، `reviewStatus`، `isPrivatePropertyDto` |
| `apps/frontend/lib/api/properties-api.ts` | `requestChangesProperty` |
| `apps/frontend/lib/property-adapter.ts` | `reviewStatusOf`، `displayStatus`، `CHANGES_REQUESTED_LABEL`، `needsResubmitAfterCorrection`، `isMine` |
| `apps/frontend/features/employee-properties/model.ts` | `reviewStatus?` على النموذج |
| `apps/frontend/features/manager-properties/preview-data.ts` | `reviewStatus?` على نموذج العرض |
| `apps/frontend/features/manager-properties/components/manager-properties.tsx` | `requestChangesProperty`؛ استبعاد `CHANGES_REQUESTED` من قائمة الانتظار؛ إحصاء «مطلوب تعديل» يجمعان الرفض وطلب التعديل |
| `apps/frontend/features/manager-properties/components/review-action-dialog.tsx` | تحديث التعليق فقط (لم يعد يصف إعادة توجيه الزرّين إلى الرفض) |
| `apps/frontend/features/employee-properties/components/new-property-modal-v2.tsx` | `needsResubmitAfterCorrection` بدل شرط `REJECTED` فقط |
| `apps/backend/test/frontend-property-adapter.spec.ts` | تحديث DTOs الاختبار + 6 اختبارات جديدة لمساعدات المراجعة و`isMine` |
| `apps/backend/test/frontend-properties-contract.spec.ts` | اختبار عقد جديد لدورة «طلب تعديل ← تصحيح ← إعادة إرسال ← اعتماد» عبر طبقة الواجهة |

---

## 4. عقد الخلفية: نقطة `POST /properties/:id/request-changes`

- **الصلاحية:** `@Roles(Role.MANAGER)` — رمز الموظف يرجع **403** (مُختبَر).
- **الحمولة:** `{ reason: string, version?: number }`؛ `reason` إلزامي (`@IsNotEmpty`) وبحد أقصى 2000 حرف، ويُقتطع (`trim`) قبل التخزين؛ سبب من مسافات فقط يرجع **400** (مُختبَر، بلا أي تغيير في الصف).
- **التأثير (كل شيء داخل معاملة واحدة):**
  1. `Property` تبقى `PENDING` وتُزاد `version` بمقدار 1 (بشرط مطابقة `status = PENDING` و`version` إن أُرسل → وإلا **409**).
  2. أحدث `PropertyApprovalRequest` يجب أن يكون `PENDING` → وإلا **409**.
  3. تُحدَّث المراجعة إلى `CHANGES_REQUESTED` مع `notes = reason` و`reviewedById` و`reviewedAt` — عبر `updateMany` مشروط بـ `status = PENDING` (عدّاد ذرّي).
  4. يُكتب `AuditLog` بعملية `PROPERTY_REQUEST_CHANGES` يحوي **الانتقال فقط** (`status: PENDING`, `reviewStatus: CHANGES_REQUESTED`) — **بلا** نص الإرشادات وبلا أي بيانات تواصل (مُختبَر).
- **المُعاد:** عرض العقار المصرَّح به (`PropertyViewDto`) بحالة `PENDING` و`reviewStatus = CHANGES_REQUESTED` و`reviewNotes` تحوي الإرشادات.

> **مبدأ التصميم:** تستخدم النقطة نمط التزامن القائم في المشروع نفسه (`updateMany` مشروط + فحص `count` ذرّي)، لذا لا تتفوق على `approve`/`reject` المتزامنين.

---

## 5. تمييز «طلب تعديل» عن «الرفض»

- **الرفض** (`POST /properties/:id/reject`): يحوّل العقار إلى `REJECTED` (حالة نهائية) وتصبح المراجعة `REJECTED` مع تخزين السبب.
- **طلب التعديل** (`POST /properties/:id/request-changes`): **يُبقي** العقار `PENDING` وتحوّل المراجعة إلى `CHANGES_REQUESTED`. **ليس رفضًا** ولا يُمرَّر أبدًا إلى `/reject` (لا في الواجهة ولا في الخلفية).
- **ضبط الاعتماد والرفض:** أُضيف فحص لأحدث مراجعة في `approve` و`reject`: إن كانت موجودة وليست `PENDING` (أي `CHANGES_REQUESTED`) تُلغى المعاملة برمز **409** («المراجعة لم تعُد بانتظار قرار المدير»)، فلا يمكن اعتماد أو رفض طلبٍ سبق أن طُلب فيه تعديل قبل إعادة إرسال الموظف (مُختبَر: كلاهما 409 مع بقاء `version` دون تغيير).
- **حراسة السباق:** أُضيف `updateMany`/فحص `count` على صف المراجعة نفسه (`where: { id, status: PENDING }`) فلا ينجح قراران متزامنان على نفس الطلب.

> **ملاحظة توافق:** كانت النسخة السابقة تُنشئ صف مراجعة `REJECTED` جديدًا عند غياب طلب `PENDING`. السلوك الجديد أدقّ: يرفض (409) أي قرار على مراجعة سبق حسمها، ويبقى مسار «الرفض المباشر لطلب `PENDING`» كما هو (كل الاختبارات السابقة تمر).

---

## 6. إعادة الإرسال وحفظ السجل والتزامن

أصبح `POST /properties/:id/resubmit` يدعم **حالتين** بدل واحدة:

| الحالة | الشرط المسبق | النتيجة |
| --- | --- | --- |
| (أ) رفض سابق | `Property.status = REJECTED` | `PENDING` + طلب مراجعة `PENDING` جديد |
| (ب) طلب تعديل | `Property.status = PENDING` وأحدث مراجعة `CHANGES_REQUESTED` | `PENDING` + طلب مراجعة `PENDING` جديد |

- **صاحب العقار وحده** يعيد الإرسال (غير المالك → **403**) — كما كان.
- **حفظ السجل:** يُنشأ صف مراجعة **جديد** `PENDING` ولا يُمسّ صفّ `REJECTED`/`CHANGES_REQUESTED` السابق (مُختبَر: الترتيب `['CHANGES_REQUESTED','PENDING']` و`['REJECTED','PENDING']`).
- **منع الإصلاح وحده من النشر:** بعد `PATCH` يبقى العقار `PENDING` و`reviewStatus = CHANGES_REQUESTED` حتى يضغط الموظف «إعادة إرسال» (مُختبَر).
- **التزامن (إعادة إرسال مكرَّرة):** حرس `updateMany` على مستوى العقار لا يتغيّر في حالة `PENDING → PENDING`، لذا تُضاف **قراءة داخل المعاملة بعد قفل الصف** لأحدث مراجعة: أول إعادة إرسال تُنشئ `PENDING` جديدًا، والثانية (التي انتظرت القفل) ترى `PENDING` وليس `CHANGES_REQUESTED` → **409** (مُختبَر).
- **لا نشر للعقار:** تبقى الحالة `PENDING` (بانتظار مراجعة المدير)، وليس `AVAILABLE`.

---

## 7. DTOs والتعريض: `isMine` و`reviewStatus`/`reviewNotes`

- **`PublicPropertyDto.isMine: boolean`** — يُحسب على الخادم: `property.createdByUserId === viewer.id` (و`viewer` من الجلسة المُصادَقة، **لا من حمولة العميل أبدًا**). مجموعة معرفة-ذاتية لا تكشف هوية مالك عقارٍ لغيره، **ولا تُستخدم إطلاقًا** لمنح الوصول إلى جهة التواصل (ذلك فحص قائم مستقل في المُسلسِل).
- **`PrivatePropertyDto.reviewStatus: ApprovalStatus | null`** و**`reviewNotes: string | null`** — يُشتقّان من **أحدث** طلب مراجعة (`approvals` مرتّبة `createdAt desc`). يُعاد للخاص **حالة المراجعة والإرشادات فقط**، **ولا يُعاد أي سجل `PropertyApprovalRequest` خام**.
- **دلالة `reviewStatus`:** `PENDING` (طلب عادي قيد المراجعة) / `CHANGES_REQUESTED` (طُلب تعديل) / `REJECTED` / `APPROVED` / `null` (لا سجل مراجعة، مثل عقار أنشأه المدير).
- **حدود التعريض:** كل حقول المراجعة + جهة التواصل على `PrivatePropertyDto` فقط؛ استجابة العقار العام لغيره تبقى `PublicPropertyDto` بلا `contact`/`contactId`/`reviewNotes`/`reviewStatus` (مُختبَر).
- **التغيير المحوري في `latestReviewNotes`:** صار يقرأ من **أحدث** مراجعة بدل «أول مراجعة `REJECTED`»، فيظهر سبب الرفض/إرشادات التعديل طالما هي الأحدث، **ويتصفّر بعد إعادة الإرسال** (لا تُعرض الإرشادات القديمة كأنها الحالة الحالية).

---

## 8. طبقة الواجهة الأمامية: الأنواع ومحوّل العرض

- **`lib/api/property-types.ts`:** إضافة `ApprovalStatusApi`، و`isMine: boolean`، و`reviewStatus` على `PrivatePropertyDto`، ومُصفّي `isPrivatePropertyDto` (يُطابق وجود المفتاح `contact` حتى لو كان `null`).
- **`lib/api/properties-api.ts`:** `requestChangesProperty(id, reason, version)` → `POST /properties/:id/request-changes` (سبب إلزامي + `version`).
- **`lib/property-adapter.ts`:**
  - `reviewStatusOf(dto)` → حالة أحدث مراجعة أو `null` (لا شيء على الاستجابة العامة).
  - `displayStatus(dto)` → «مطلوب تعديل» عندما `CHANGES_REQUESTED`، وإلا تسمية الحالة المعتادة.
  - `needsResubmitAfterCorrection(dto)` → `true` فقط لـ `REJECTED` أو `PENDING + CHANGES_REQUESTED`.
  - `mapPropertyFromApi`: `mine` من `dto.isMine` (مع `deriveMine` كاحتياط للاستجابات القديمة فقط)، و`managerNotes` من ملاحظات المراجعة كلما كانت الاستجابة خاصة، و`reviewStatus`.
- **`Property` و`PreviewProperty`:** أُضيف `reviewStatus?` كي تستطيع واجهة المدير تمييز الصف.

> **قرار:** أُبقي `deriveMine` كدالة مُصدَّرة (احتياط صريح) لأنها مُختبَرة ومستخدمة في الاختبارات، لكنّها **لم تعُد** المصدر الأساسي لقرار «هذا العقار لي».

---

## 9. واجهة المدير

- **ثلاثة إجراءات مميّزة:** «اعتماد» → `approveProperty`، «طلب تعديل» → `requestChangesProperty` (النقطة الجديدة)، «رفض» → `rejectProperty`؛ ونفس حوار السبب الإلزامي (`review-action-dialog.tsx`) يخدم الأخيرين مع تغيير الصياغة فقط.
- **حارس السباق:** `busyId` يمنع النقر المزدوج، ولا حالة متفائلة (success فقط بعد تأكيد الخادم ثم `refetch`).
- **استبعاد غير القابل للقرار:** قائمة «تحت المراجعة» وإحصاء «بانتظار الموافقة» يستبعدان الصفوف `PENDING` التي `reviewStatus = CHANGES_REQUESTED` (فهي بانتظار الموظف، لا المدير).
- **إحصاء «مطلوب تعديل»:** صار يجمع `REJECTED` + `CHANGES_REQUESTED`.
- **رسالة النجاح:** «تم طلب تعديل العقار …» أو «تم رفض العقار …» حسب الإجراء.
- **معالجة 409/404:** تُغلق الحوار وتُعرض الرسالة العربية وتُعاد القائمة؛ أي خطأ آخر يُبقي الحوار والسبب مكتوبًا.

---

## 10. واجهة الموظف وتبويب «عقاراتي»

- **تبويب «عقاراتي»** يعتمد الآن على `isMine` من الخادم، فيشمل عقار الموظف في الحالات `PENDING`/`REJECTED`/`AVAILABLE` (مُختبَر: صفّ `AVAILABLE` لصاحبه `isMine = true`، ولغيره `isMine = false`).
- **عرض «مطلوب تعديل»:** المحوّل يمنح حالة `CHANGES_REQUESTED` الوسم «مطلوب تعديل» نفسه المستخدَم للرفض (نفس مفردات التصميم المعتمد)، فتظهر شارة التحذير ويظهر زر «تعديل وإعادة إرسال» (`status === 'مطلوب تعديل' && mine`).
- **إرشادات المدير:** بطاقة «ملاحظات المدير» في الدرج تعرض `managerNotes` (إرشادات التعديل أو سبب الرفض)، وتختفي تلقائيًا بعد إعادة الإرسال لأن `reviewNotes` تصبح `null`.
- **التصحيح وإعادة الإرسال:** المعالج ثلاثي الخطوات كما هو؛ عند الحفظ يُنفَّذ `PATCH` أولًا، ثم `POST /resubmit` عندما `needsResubmitAfterCorrection` (الرفض السابق **أو** طلب التعديل). الإصلاح وحده لا ينشر.
- **حالات الفراغ/التحميل/الخطأ** والترقيم محفوظة كما في Phase 4A.

---

## 11. الخصوصية والتفويض

- **`isMine` ليس تفويضًا:** لا يُمنح به أي وصول لجهة التواصل؛ التفويض يبقى في `property-serializer.ts` (المدير، أو مُنشئ جهة التواصل).
- **لا تسريب:** اختبار صريح أن موظفًا آخر يرى `AVAILABLE` بلا `contact`/`contactId`، وبلا اسم/هاتف جهة التواصل في متن الاستجابة (مُختبَر).
- **لا سجلات خام:** لا يُعاد أي `PropertyApprovalRequest` خام؛ فقط الحالة والملاحظات.
- **حقول المراجعة خاصة:** `reviewNotes`/`reviewStatus` على `PrivatePropertyDto` (المدير + المالك) فقط؛ استجابة العقار العام نظيفة (مُختبَر).
- **التدقيق بلا أسرار:** حدث `PROPERTY_REQUEST_CHANGES` يسجّل الانتقال فقط دون نص الإرشادات (مُختبَر).

---

## 12. الاختبارات والتحقق الفعلي

### 12.1 المنهجية

لا مشغّل اختبارات مكوّنات في الواجهة، ولم تُضَف أي اعتمادية. الاعتماد على ثلاثة أعمدة مع تمييز صريح للمستوى:

| العمود | ما يغطّيه | مستوى التحقق |
| --- | --- | --- |
| (أ) اختبارات سير العمل `property-request-changes.spec.ts` — **13** | نقطة النهاية الحقيقية على Nest + قاعدة معزولة عبر HTTP | **تكامل API حقيقي** |
| (ب) اختبارات العقد `frontend-properties-contract.spec.ts` — **+1** | طبقة API الحقيقية للواجهة (`requestChangesProperty`، `resubmitProperty`، `isMine`) | **تكامل API حقيقي** |
| (ج) اختبارات المحوّل `frontend-property-adapter.spec.ts` — **+6** | دوال المحوّل الصافية (`displayStatus`، `reviewStatusOf`، `needsResubmitAfterCorrection`، `isMine`) | **وحدة صافية** |
| (د) بناء/بنية + ارتجاع HTTP | `typecheck`، `lint`، `build`، `prisma validate`، `migrate status`، جولة الصحة | **بنائي/مراجعة مصدر** — **ليس** تفاعل متصفح |

### 12.2 أوامر التحقق الفعلية ونتائجها

| الأمر | النتيجة |
| --- | --- |
| `npm run typecheck` (الجذر: shared + backend + frontend) | ✅ `PASS` |
| `npm run lint` (`eslint apps packages`) | ✅ `PASS` |
| `npm run build` (`@arkan/frontend`، Next 16.3.4) | ✅ `PASS` — توليد 22 مسارًا |
| `npx jest --runInBand` من `apps/backend` على قاعدة الاختبار المعزولة | ✅ `11 suites / 126 tests passed` (كانت `10 / 106`) |
| `npx prisma validate` | ✅ «The schema is valid» |
| `npx prisma migrate status` (قراءة فقط) | ✅ «Database schema is up to date!» — 3 ترحيلات — **لم يُطبَّق أي ترحيل جديد** |
| `git diff --check` | ✅ `exit 0` (تحذيرات CRLF موجودة مسبقًا، لا أخطاء مسافات) |
| `GET /health` (4001) | ✅ `{"status":"ok","service":"arkan-api"}` |
| `GET /health/ready` (4001) | ✅ `{"status":"ok","database":"up","redis":"up"}` |
| `POST /properties/<uuid>/request-changes` بلا مصادقة | ✅ `401` — **يثبت أن المسار مُسجَّل** في الخادم العامل (لا 404) |
| `GET /login` (3001) | ✅ `200` |

**قاعدة الاختبار المعزولة:** `arkan_crm_api_test_20261015173606` حصرًا عبر `TEST_DATABASE_URL`. **لم يُكتَب أي بيانات على قاعدة التطوير، ولم يُعَد ضبطها، ولم تُحذف سجلات، ولم تُعدَّل ملفات `.env`، ولم يُطبَّق أي ترحيل.**

### 12.3 خريطة السيناريوهات العشرين المطلوبة إلى غطائها الفعلي

| # | السيناريو | الحالة | الملف/الاختبار |
| --- | --- | --- | --- |
| 1 | المدير يطلب تعديلًا | `Completed` | `property-request-changes` — «request changes» |
| 2 | الإرشادات إلزامية غير فارغة | `Completed` | `property-request-changes` — سبب من مسافات → 400 |
| 3 | الموظف لا يستطيع طلب التعديل | `Completed` | `property-request-changes` — 403 |
| 4 | العقار يبقى `PENDING` | `Completed` | `property-request-changes` + قراءة القاعدة |
| 5 | المراجعة تصبح `CHANGES_REQUESTED` | `Completed` | `property-request-changes` — فحص صف المراجعة |
| 6 | بقية الموظفين لا يرونه | `Completed` | `property-request-changes` — 404 + غياب عن القائمة |
| 7 | المنشئ يرى `CHANGES_REQUESTED` + الإرشادات | `Completed` | `property-request-changes` |
| 8 | المنشئ يصحّح ويعيد الإرسال | `Completed` | `property-request-changes` + عقد الواجهة |
| 9 | إنشاء طلب `PENDING` جديد | `Completed` | فحص الترتيب `['CHANGES_REQUESTED','PENDING']` |
| 10 | بقاء `CHANGES_REQUESTED` السابقة في السجل | `Completed` | فحص الصف الأول و`notes` |
| 11 | المدير يعتمد بعد إعادة الإرسال | `Completed` | `AVAILABLE` + `reviewStatus = APPROVED` |
| 12 | المدير لا يعتمد قبل إعادة الإرسال | `Completed` | 409 للاعتماد **والرفض** |
| 13 | إعادة إرسال مكرَّرة → 409 | `Completed` | `property-request-changes` |
| 14 | قرارات متزامنة: نجاح واحد | `Completed` | سباق `request-changes` ضد `approve` → `[200,409]` |
| 15 | الرفض وإعادة إرسال عقار مرفوض يعملان | `Completed` | `property-request-changes` + اختبارات Phase 4A |
| 16 | عقار `AVAILABLE` لـ A → `isMine = true` لـ A | `Completed` | `property-request-changes` + عقد الواجهة |
| 17 | `isMine = false` لـ B | `Completed` | `property-request-changes` + عقد الواجهة |
| 18 | B لا يرى جهة التواصل الخاصة لـ A | `Completed` | `property-request-changes` + Phase 4A |
| 19 | عقار المدير يبقى `AVAILABLE` فورًا | `Completed` | `property-request-changes` — عدد مراجعات `0` |
| 20 | الاختبارات السابقة تمر | `Completed` | `126 passed` / `11 suites` |

> **خلاصة الصدق:** تغطية آلية كاملة لكل السيناريوهات العشرين **على مستوى الخلفية/API**. أما سلوكيات React التفاعلية (النقر على «طلب تعديل»، إغلاق الحوار، إعادة الجلب) فهي **`Not Tested` آليًا**، ولم يُصرَّح بأي منها كناجحة.

---

## 13. الانحرافات والقيود

| الانحراف | الحقيقة | لماذا |
| --- | --- | --- |
| تمييز «مطلوب تعديل (طلب تعديل)» عن «مطلوب تعديل (مرفوض)» بصريًا | كلاهما يُعرض بنفس الوسم «مطلوب تعديل» (مفردات التصميم المعتمد لا تحوي تسمية منفصلة). التمييز الدلالي قائم في الخلفية (`Property.status` = PENDING مقابل REJECTED، و`ApprovalStatus` = CHANGES_REQUESTED مقابل REJECTED)، والمميّز العملي أن `CHANGES_REQUESTED` **مستبعَد** من قائمة قرارات المدير بينما `REJECTED` انتهى | الحفاظ على مفردات الحالة المعتمدة دون إضافة حالة عرض جديدة |
| حوار المدير لا يعرض إرشادات التعديل داخل درج المدير | الدرج يعرض بيانات العقار؛ الإرشادات تُعرض للموظف في «ملاحظات المدير» | تجنّب تعديل تصميم درج المدير (قرار نطاق) |
| إعادة الإرسال لا تلتقط نسخة `version` صريحة | تعتمد على قفل الصف + قراءة داخل المعاملة لأحدث مراجعة | كافٍ لمنع التكرار المتزامن (مُختبَر بـ `[200,409]`) دون تغيير عقد النقطة |
| `deriveMine` باقية | صارت احتياطًا فقط بعد `isMine` | تُبقي التوافق مع الاختبارات والاستجابات القديمة |

---

## 14. ما لم يُنفَّذ عمديًا وما لم يُختبَر

**خارج النطاق عمديًا (`Not Implemented`):**

- `PropertyRevision` وتعديل العقارات المتاحة.
- استبدال صورة العقار عند التعديل (`PATCH` بلا حقل صورة).
- استمرارية سجل المتابعات عبر `/contacts`.
- تبويب «المُسنَد» (لا حقل تكليف في الخلفية).

**لم يُختبَر آليًا (`Not Tested`):**

- كل سلوكيات React التفاعلية: نقر «طلب تعديل»/«رفض»، إغلاق الحوار عند النجاح، إظهار البطاقة/الزر، دورة حياة object URL، منع النقر المزدوج في المتصفح.
- تحقّق متصفح يدوي لسير العمل الكامل. الاتجاهي الآلي الوحيد: `build` ناجح + `health` + تسجيل المسار (`401`).

---

## 15. تأكيد النطاق (ما لم يُغيَّر)

- ✅ **لا ترحيل جديد**، **لا تعديل مخطط قاعدة البيانات**، **لا تعديل ملفات ترحيل مُطبَّقة**، **لا `prisma migrate`/`db push`** — `migrate status` أكّد «up to date».
- ✅ **لا إعادة تصميم:** الحوار والكروت والأدراج والمعالج ثلاثي الخطوات محفوظة؛ لم تُضف خطوة رابعة ولا حقل مطلوب جديد.
- ✅ **لا مساس بسجلات العملاء/المتابعات**، **لا تبويب «مُسنَد»**، **لا `PropertyRevision`**، **لا استبدال صورة**.
- ✅ **لا اعتمادية جديدة** (لا Playwright/Cypress/مشغّل مكوّنات)، **لا تعديل `.env`**، **لا commit/push**.
- ✅ **لا كتابة على قاعدة التطوير**؛ الاختبارات استخدمت القاعدة المعزولة حصرًا.
- ✅ **لا إيقاف لأي `node.exe`** ولا مُراقِب جديد.

---

## 16. الخطوة التالية والجاهزية

1. تغطية سلوكيات React التفاعلية تلقائيًا (تتطلب موافقة على اعتمادية مشغّل اختبار مكوّنات، أو أتمتة متصفح).
2. تحقّق متصفح يدوي لسير «طلب تعديل ← تصحيح ← إعادة إرسال ← اعتماد» ولظهور العقار المعتمد في «عقاراتي».
3. قرار اختياري لعرض إرشادات التعديل داخل درج المدير، و/أو تسمية عرضية منفصلة تميّز «طلب تعديل» عن «مرفوض» لدى المدير (تغيير تصميمي يتطلب موافقة).

**لا ادّعاء جاهزية إنتاجية، ولا تصديق لأي سلوك واجهة تفاعلي دون تنفيذ فعلي له.**

---

## الحالة النهائية

**Phase 4B — `Completed` على مستوى الخلفية/API وربط الواجهة** — نقطة `request-changes` مستقلة، وضبط الاعتماد/الرفض، وإعادة الإرسال الممتدة مع حفظ السجل، و`isMine` لتبويب «عقاراتي»، مع **20 اختبارًا آليًا جديدًا** على خلفية وقاعدة معزولة (`126 passed` / `11 suites`) و`typecheck`/`lint`/`build`/`prisma validate`/`migrate status`/`git diff --check` والجولة الصحية الناجحة.

**تبقى سلوكيات الواجهة التفاعلية `Not Tested` آليًا** (لا مشغّل اختبار مكوّنات/متصفح)، **ولا ترحيل، ولا اعتمادية جديدة، ولا تغيير تصميمي**، وكل التغييرات **غير مُلتزمة** في Git.
