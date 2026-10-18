# واجهات الخلفية الآمنة لجهات التواصل والعقارات — Phase 3A

- **التاريخ:** 2026-10-15
- **المشروع:** Arkan CRM (أركان الخليج العقارية)
- **المرحلة:** Phase 3A — أول واجهات أعمال إنتاجية موجّهة في الخلفية (جهات التواصل + العقارات)
- **الفرع/الالتزام:** `main` — `HEAD = ff71379`، جميع التغييرات **غير مُلتزمة** (لا commit ولا push).
- **مراجع سابقة:** [backend-architecture-audit](./2026-10-15-backend-architecture-audit.md)، [property-schema-migration-preparation](./2026-10-15-property-schema-migration-preparation.md)، [optional-legacy-owner-schema-fix](./2026-10-15-optional-legacy-owner-schema-fix.md)، [development-database-migration](./2026-10-15-development-database-migration.md)، [prisma-client-db-connectivity-recovery](./2026-10-15-prisma-client-db-connectivity-recovery.md)، [three-step-property-wizard](./2026-10-15-three-step-property-wizard.md).

> **نطاق هذه المرحلة:** تنفيذ واجهات الخلفية فقط باستخدام **المخطط المُطبَّق مسبقًا** (لا ترحيل جديد، لا تغيير مخطط، لا تعديل لملفات الترحيل). لم تُعدَّل الواجهة الأمامية، ولم يُعدَّل معالج Astra ثلاثي الخطوات، ولم تُنفَّذ أي كتابة على قاعدة **التطوير** المحلية.

---

## 1. الملخص التنفيذي

تم تنفيذ وحدات خلفية جديدة على NestJS + Prisma 6.19.3 باستخدام **المخطط المُطبَّق فعليًا**:

- **ContactsModule**: إنشاء/قائمة/قراءة/تحديث جهات التواصل (OWNER/BROKER) مع تفويض صفّي على الخادم.
- **PropertiesModule**: إنشاء العقارات (SALE/RENT/EXCHANGE) عبر `multipart/form-data` مع صورة واحدة إلزامية، وقراءة القوائم/التفاصيل/الصورة، وسير عمل الموافقة/الرفض/التصحيح/إعادة الإرسال.
- **FilesModule / StorageService**: تخزين محلي خاص لصورة واحدة، والتحقق من البايتات الفعلية (لا الامتداد)، وتقديم الصورة بتدفّق مع نفس سياسة رؤية العقار.
- **حماية خصوصية جهات التواصل على الخادم**: تسلسل صريح (Selectors/DTOs) يمنع تسريب اسم/هاتف/ملاحظات/معرّف جهة التواصل لغير المخوّلين.

جميع الاختبارات الآلية الجديدة تعمل على **قاعدة بيانات اختبار معزولة** منفصلة تمامًا عن قاعدة التطوير: `arkan_crm_api_test_20261015173606` (تم إنشاؤها وتطبيق الترحيلات الثلاثة الموجودة عليها فقط، ولم تُحذف — محفوظة كدليل).

**نتيجة الاختبارات:** `7` حزم اختبار — `54` اختبارًا — **كلها ناجحة (`54 passed`)**.

> **مهم:** لم تُنفَّذ أي كتابة على قاعدة التطوير `arkan_crm`. التحقق بعد التنفيذ: `Property=0, Contact=0, Owner=0, FileAsset=0, User=2` (كما كان الوضع الأساسي قبل المرحلة).

---

## 2. جدول الحالة (Completed / Partial / Not Implemented / Not Tested / Blocked)

| العنصر | الحالة | الدليل |
| --- | --- | --- |
| CONTACTS: إنشاء/قائمة/تفاصيل/تحديث + تفويض صفّي | `Completed` | `contacts.spec.ts` (ناجح) |
| PROPERTIES: إنشاء (SALE/RENT/EXCHANGE) + تفويض الملكية | `Completed` | `properties.spec.ts` + `properties-assets.spec.ts` |
| صورة واحدة إلزامية + تحقق من البايتات + حجم أقصى 5MB | `Completed` | `properties-assets.spec.ts` |
| GET /properties + GET /properties/:id + سياسة الرؤية | `Completed` | `properties.spec.ts` |
| GET /properties/:id/image بتدفّق + نفس سياسة الرؤية | `Completed` | `properties-assets.spec.ts` |
| موافقة المدير (PENDING → AVAILABLE) | `Completed` | `properties.spec.ts` |
| رفض المدير بسبب إلزامي (PENDING → REJECTED) | `Completed` | `properties.spec.ts` |
| تصحيح المسودة (PENDING/REJECTED) بالسيرة `version` | `Completed` | `properties.spec.ts` |
| إعادة الإرسال (REJECTED → PENDING) مع حفظ سجل الرفض | `Completed` | `properties.spec.ts` |
| منع سباق الموافقة/الرفض (409 لأحد الطرفين) | `Completed` | `properties.spec.ts` |
| DTOs صريحة مانعة لتسريب الخصوصية | `Completed` | `property-serializer.ts` + اختبارات الخصوصية |
| منع أرقام الهاتف/البريد في النص العام (وصف/طوابق/عقار مطلوب) | `Completed` | `public-text.ts` + اختبارات 400 |
| عدم تزوير سجل `Owner` القديم لعقار الوسيط | `Completed` | `properties-assets.spec.ts` |
| بقاء تاريخ الترحيلات دون تغيير (3 ترحيلات) | `Completed` | `properties-assets.spec.ts` + `prisma validate` |
| إزالة بيانات EXIF/GPS من الصور | `Not Implemented` | لا توجد حزمة معالجة صور مثبّتة (انظر §14) |
| تخزين كائنات إنتاجي (S3 متوافق) | `Not Implemented` | التخزين المحلي فقط (مجرد واجهة قابلة للاستبدال) |
| تعديلات الموظف على عقار **AVAILABLE** | `Not Implemented` | خارج نطاق هذه المرحلة (مقصود) |
| سير عمل PropertyRevision | `Not Implemented` | خارج النطاق |
| مشاركة/إعادة إسناد جهات التواصل | `Not Implemented` | خارج النطاق |
| دمج الواجهة الأمامية مع هذه الواجهات | `Not Implemented` | بانتظار موافقة (انظر §18) |
| رؤية الموظف لعقارات SOLD/RENTED/ARCHIVED | `Not Tested` | مُقصى افتراضيًا (Fail Closed، للمدير فقط) |
| اختبار على نظام تشغيل/خادم إنتاجي | `Not Tested` | بيئة تطوير محلية فقط |

---

## 3. الملفات المُضافة والمُعدَّلة

### 3.1 ملفات جديدة (Backend)

| الملف | الوصف |
| --- | --- |
| `apps/backend/src/contacts/contacts.module.ts` | وحدة جهات التواصل |
| `apps/backend/src/contacts/contacts.controller.ts` | نقاط `POST/GET/GET :id/PATCH :id` |
| `apps/backend/src/contacts/contacts.service.ts` | منطق الإنشاء/القراءة/التحديث + التفويض |
| `apps/backend/src/contacts/contact-policy.ts` | فلتر الملكية الصفّي |
| `apps/backend/src/contacts/contact.dto.ts` | شكل استجابة جهة التواصل |
| `apps/backend/src/contacts/dto/create-contact.dto.ts` | تحقق الإنشاء |
| `apps/backend/src/contacts/dto/update-contact.dto.ts` | تحقق التحديث |
| `apps/backend/src/contacts/dto/list-contacts.query.ts` | بارامترات القائمة (مُحدَّدة الحدود) |
| `apps/backend/src/properties/properties.module.ts` *(مُعدَّل من هيكل فارغ)* | وحدة العقارات |
| `apps/backend/src/properties/properties.controller.ts` | كل نقاط العقارات (بما فيها الصورة) |
| `apps/backend/src/properties/properties.service.ts` | منطق العقارات والمعاملات |
| `apps/backend/src/properties/property-visibility.ts` | سياسة الرؤية الصفّية |
| `apps/backend/src/properties/property-serializer.ts` | `toPublicPropertyDto` + التسلسل الخاص |
| `apps/backend/src/properties/property-reference.ts` | توليد المرجع الفريد |
| `apps/backend/src/properties/property.dto.ts` | أشكال الاستجابة العامة/الخاصة |
| `apps/backend/src/properties/dto/*.ts` (9 ملفات) | DTOs الإنشاء/التحديث/الموافقة/الرفض/القائمة/الطوابق/العقار المطلوب/جهة التواصل الجديدة |
| `apps/backend/src/files/storage.service.ts` | تجريد التخزين + كشف نوع الصورة من البايتات |
| `apps/backend/src/files/files.service.ts` *(جديد)* | التحقق/الكتابة/البيانات الوصفية/التنظيف |
| `apps/backend/src/common/text/public-text.ts` | كشف أرقام الهاتف/البريد في النص العام + Sentinel الموقع غير المعروف |
| `apps/backend/src/common/validation/json-payload.ts` | تحقق JSON داخل multipart بنفس قواعد القائمة البيضاء |
| `apps/backend/src/common/validation/decimal.decorator.ts` | `@IsDecimalString()` |
| `apps/backend/src/common/money.ts` | تحويل الأرقام العشرية بأمان (بدون float) |
| `apps/backend/src/common/pagination.ts` | حدود الصفحات |
| `apps/backend/src/common/decorators/raw-response.decorator.ts` | تعليم استجابات ثنائية لا تُغلَّف |
| `apps/backend/test/support/test-app.ts` | أداة اختبار تكامل بقاعدة معزولة |
| `apps/backend/test/contacts.spec.ts` | اختبارات جهات التواصل |
| `apps/backend/test/properties.spec.ts` | اختبارات العقارات/الرؤية/الخصوصية |
| `apps/backend/test/properties-assets.spec.ts` | اختبارات الصور/البدل/التوافق |
| `apps/backend/test/properties-image-restart.spec.ts` | ثبات الصورة بعد إعادة تشغيل التطبيق |

### 3.2 ملفات معدّلة (Backend)

| الملف | التغيير | السبب |
| --- | --- | --- |
| `apps/backend/src/app.module.ts` | إضافة `ContactsModule` | تسجيل الوحدة الجديدة |
| `apps/backend/src/config/environment.ts` | إضافة `STORAGE_ROOT` (اختياري) | مجلد تخزين قابل للضبط دون تعديل `.env` تلقائيًا |
| `apps/backend/src/common/configure-app.ts` | تمرير `Reflector` إلى المعترض | دعم استجابات ثنائية |
| `apps/backend/src/common/interceptors/response.interceptor.ts` | احترام `@RawResponse()` | عدم تغليف تدفّق الصورة داخل `{data}` |
| `apps/backend/src/common/filters/api-exception.filter.ts` | تعيين أخطاء multer (`LIMIT_*`) إلى 400/413 | رسائل واضحة بدل 500 |
| `apps/backend/src/files/files.module.ts` | من هيكل فارغ إلى وحدة حقيقية | توفير `StorageService`/`FilesService` |

> **لم يُعدَّل** `apps/backend/prisma/schema.prisma` في هذه المرحلة (يظهر في `git status` كتعديل سابق من Phase 2A). لم تُضَف أي ترحيلات جديدة.

### 3.3 التوثيق

| الملف | الحالة |
| --- | --- |
| `docs/reports/2026-10-15-contacts-properties-backend-apis.md` | **جديد (هذا التقرير)** |
| `docs/reports/README.md` | مُحدَّث بإضافة سطر الفهرس |

---

## 4. جدول نقاط النهاية النهائي والتفويض

| الطريقة | المسار | التفويض | ملاحظات |
| --- | --- | --- | --- |
| `POST` | `/contacts` | مُصادَق (MANAGER/EMPLOYEE) | الموظف ← مالك السجل = نفسه؛ المدير ← سجل شركة (`responsibleUserId=null`) |
| `GET` | `/contacts` | مُصادَق | المدير: الكل؛ الموظف: سجلاته فقط |
| `GET` | `/contacts/:id` | مُصادَق | غير المخوّل ← `404` (لا كشف) |
| `PATCH` | `/contacts/:id` | مُصادَق | غير المخوّل ← `404` |
| `POST` | `/properties` | مُصادَق | `multipart/form-data`؛ موظف ← `PENDING`، مدير ← `AVAILABLE` |
| `GET` | `/properties` | مُصادَق | مُصفّى حسب السياسة + `status/listingType/governorate/district/limit/cursor` |
| `GET` | `/properties/:id` | مُصادَق | غير المرئي ← `404` |
| `GET` | `/properties/:id/image` | مُصادَق | نفس سياسة `GET /properties/:id` |
| `PATCH` | `/properties/:id` | المُنشئ فقط | `PENDING/REJECTED` فقط + `version` إلزامي |
| `POST` | `/properties/:id/approve` | **MANAGER** | `PENDING → AVAILABLE` |
| `POST` | `/properties/:id/reject` | **MANAGER** | سبب إلزامي؛ `PENDING → REJECTED` |
| `POST` | `/properties/:id/resubmit` | المُنشئ فقط | `REJECTED → PENDING` |

- لا يوجد بادئة `/api` عامة (مطابقة للمشروع الحالي).
- كل النقاط محمية عبر `JwtAuthGuard` العام (لا `@Public()`)؛ الحماية بالأدوار عبر `RolesGuard` الحالي (لم يُستبدل أي إطار مصادقة).

---

## 5. أمثلة DTO ومخططات الاستجابة

### 5.1 إنشاء جهة تواصل — `POST /contacts`

الطلب:
```json
{ "type": "OWNER", "name": "مالك العقار", "phone": "66661111", "notes": "اختياري" }
```
الاستجابة (مغلَّفة دائمًا بـ `{ data }`):
```json
{
  "data": {
    "id": "uuid", "type": "OWNER", "name": "مالك العقار", "phone": "66661111",
    "notes": null, "responsibleUserId": "uuid-or-null",
    "createdAt": "ISO", "updatedAt": "ISO"
  }
}
```

### 5.2 إنشاء عقار — `POST /properties` (multipart/form-data)

حقل واحد نصي `payload` (JSON) + حقل ملف واحد `image`:
```
payload = {
  "listingType": "SALE",
  "governorate": "الفروانية", "district": "غرناطة", "block": "3", "plotNumber": "12",
  "sizeSqm": "400.00", "askingPrice": "250000.00", "negotiable": true,
  "description": "بيت مستقل للبيع",
  "floors": [{ "type": "GROUND", "details": "صالة ومجلس" }, { "type": "FIRST" }],
  "newContact": { "type": "BROKER", "name": "وسيط", "phone": "66661111" }
}
image = <ملف صورة واحد>
```
البديل: `"contactId": "<uuid>"` بدل `newContact` — **متبادلان حصريًا**.

### 5.3 استجابة العقار العامة (لأي موظف مخوّل على عقار `AVAILABLE` لغيره)

```json
{
  "data": {
    "id": "uuid", "reference": "AK-261015-A1B2C3D4E5", "title": "عقار بيع - غرناطة",
    "listingType": "SALE", "status": "AVAILABLE",
    "governorate": "الفروانية", "district": "غرناطة", "block": "3", "plotNumber": "12",
    "address": null, "sizeSqm": "400", "floorCount": null,
    "askingPrice": "250000", "currency": "KWD", "negotiable": true,
    "description": "بيت مستقل للبيع",
    "floors": [{ "id": "uuid", "type": "GROUND", "customLabel": null, "details": "صالة ومجلس", "sortOrder": 0 }],
    "requestedProperty": null,
    "primaryImageUrl": "/properties/uuid/image",
    "responsibleName": "اسم الموظف المسؤول",
    "createdAt": "ISO", "updatedAt": "ISO", "version": 2
  }
}
```
> **لا يحتوي** هذا الشكل على `contact` ولا `contactId` ولا الهاتف ولا مفتاح/مسار التخزين.

### 5.4 استجابة العقار الخاصة (المدير، أو الموظف صاحب العقار وجهة التواصل)

نفس الحقول العامة **زائد**:
```json
{
  "contactId": "uuid",
  "contact": { "id": "uuid", "type": "BROKER", "name": "وسيط", "phone": "66661111", "notes": null },
  "reviewNotes": "سبب الرفض (إن وُجد)"
}
```

### 5.5 تصحيح المسودة — `PATCH /properties/:id`

```json
{ "version": 3, "sizeSqm": "450.00", "description": "نص مصحّح", "floors": [{ "type": "GROUND" }] }
```
- `version` إلزامي؛ نسخة قديمة ← `409`. إرسال `floors` يستبدل القائمة كاملة. لا يغيّر الصورة.

### 5.6 الموافقة/الرفض/إعادة الإرسال

- `POST /properties/:id/approve` — جسم اختياري `{ "version": 1 }`.
- `POST /properties/:id/reject` — `{ "reason": "سبب الرفض الإلزامي", "version": 1 }`.
- `POST /properties/:id/resubmit` — بلا جسم.

---

## 6. قواعد ملكية جهات التواصل

1. **الموظف**: عند إنشاء جهة تواصل يُضبط `responsibleUserId = User.id` للموظف المصادَق. الـ ID مأخوذ من الرمز (JWT) وليس من العميل.
2. **المدير**: يُنشئ سجلات شركة (`responsibleUserId = null`)؛ ولا تُمنح تلقائيًا للموظفين.
3. **الفهرسة (list)**: المدير يرى الكل؛ الموظف يرى `responsibleUserId == user.id` فقط.
4. **القراءة/التحديث بالمعرّف**: خرائط الفلترة تُطبّق داخل الاستعلام؛ أي سجل غير مخوّل ← `404` موحّد (لا كشف وجود).
5. **الربط بعقار**: الموظف لا يستطيع ربط جهة تواصل لا يملكها (حتى لو خمّن الـ ID أو تطابق الاسم/الهاتف) ← `404`، وتُفرض داخل نفس معاملة إنشاء العقار (لا يمكن تجاوزها بتوقيت غير صحيح).
6. **الافتراضي رفض (Default Deny)**: أي ملكية غامضة أو غير مُتحقَّق منها تمنع الوصول.

---

## 7. قواعد رؤية العقارات

| الدور | ما يراه |
| --- | --- |
| **MANAGER** | كل العقارات بكل الحالات (PENDING/REJECTED/AVAILABLE/SOLD/RENTED/ARCHIVED) + كل بيانات جهات التواصل |
| **EMPLOYEE** | كل عقار `AVAILABLE` من أي منشئ + عقاراته الخاصة `PENDING`/`REJECTED` + تفاصيل جهة التواصل لعقاره هو فقط |

- تُطبَّق الفلترة **داخل استعلامات Prisma** (وليس بعد جلب صفوف غير مُصفّاة).
- العقارات بحالة `SOLD/RENTED/ARCHIVED`: **إقصاء افتراضي (Fail Closed)** للموظف — لا يراها حتى لو كان صاحبها، حتى تُعرَّف قواعدها صراحة.
- أي معرّف غير مرئي ← `404` موحّد غير كاشف.
- `GET /properties/:id/image` يستخدم **نفس** سياسة `GET /properties/:id` (صورة عقار `PENDING` لموظف آخر ← `404`).

---

## 8. تصميم التسلسل الآمن للخصوصية (Serializers صريحة)

- تم الفصل بين شكلين: `PublicPropertyDto` (بلا أي جهة تواصل/معرّف/هاتف/مسار تخزين) و`PrivatePropertyDto` يمتدّه ويضيف `contactId`/`contact`/`reviewNotes`.
- **لا تُعاد كائنات Prisma الكاملة**؛ بل تُبنى الاستجابة حقلًا بحقل عبر `toPublicPropertyDto(...)` و`serializeProperty(source, viewer)`.
- الحقول الخاصة تُضاف فقط عندما:
  - `viewer.role === MANAGER`، أو
  - `viewer` هو منشئ العقار **و** جهة التواصل مربوطة به (`contact.responsibleUserId === viewer.id`).
- `responsibleName` مُشتق من علاقة `User` الفعلية (اسم المنشئ) — بلا اختلاق.
- تسلسل القيم العشرية إلى **سلاسل نصية** (`Decimal.toString()`) — لا تحويل عبر float.
- النص العام: `assertNoPrivateContactInfo` يرفض أي وصف/تفصيل طوابق/ملاحظات عقار مطلوب يحتوي رقم هاتف (٨ أرقام متتالية بعد التطبيع، بما في ذلك الأرقام العربية-الهندية و`+965`) أو بريدًا إلكترونيًا ← `400`. هذا يمنع تمرير رسائل واتساب الخام كبيانات عامة (وإن تعذّر التصنيف ⇒ رفض).

---

## 9. تصميم معاملات قاعدة البيانات (Transactions)

كل تغيير متعدد الجداول داخل `prisma.$transaction`:

1. **إنشاء عقار (موظف)**: إنشاء جهة التواصل (إن كانت جديدة) → إنشاء العقار → الطوابق → العقار المطلوب (بدل) → `FileAsset` → ربط `primaryImageId` → `PropertyApprovalRequest` → `AuditLog`. أي فشل ⇒ تراجع كامل. البايتات تُكتب على القرص **قبل** المعاملة وتُحذف (`discard`) في `catch` عند الفشل ⇒ لا صفوف جزئية ولا جهة تواصل يتيمة.
2. **الموافقة**: `updateMany` شرطي (`status=PENDING` و`version` إن مُرِّر) → تحديث طلب الموافقة → `AuditLog`.
3. **الرفض**: نفس الشرط → `REJECTED` → تخزين السبب في `PropertyApprovalRequest.notes` → `AuditLog`.
4. **التصحيح**: `updateMany` شرطي (`createdByUserId`, `status IN (PENDING,REJECTED)`, `version`) ثم استبدال الطوابق/العقار المطلوب → `version++`.
5. **إعادة الإرسال**: `updateMany` شرطي (`REJECTED`) → إنشاء طلب موافقة **جديد** (يبقى سجل الرفض القديم) → `AuditLog`.
6. **التزامن**: الاعتماد على القفل الصفّي في PostgreSQL + شروط `WHERE`. سباق موافقة/رفض ⇒ نجاح واحد فقط والآخر `409`. نسخة قديمة (`version`) ⇒ `409`.

---

## 10. سير عمل الإنشاء/الموافقة/الرفض/إعادة الإرسال

| الخطوة | الدور | النتيجة |
| --- | --- | --- |
| إنشاء | MANAGER | `AVAILABLE` مباشرة، بلا سجل موافقة |
| إنشاء | EMPLOYEE | `PENDING` + سجل `PropertyApprovalRequest(PENDING)` مرئيّ للمدير والمنشئ فقط |
| موافقة | MANAGER | `PENDING → AVAILABLE`، السجل ← `APPROVED` مع `reviewedById/reviewedAt` |
| رفض | MANAGER | `PENDING → REJECTED`، السبب يُخزَّن في سجل الموافقة `REJECTED.notes` |
| تصحيح | المنشئ | `PATCH` على `PENDING/REJECTED`؛ التعديل وحده **لا ينشر** العقار (يبقى `REJECTED`) |
| إعادة إرسال | المنشئ | `REJECTED → PENDING` + سجل موافقة `PENDING` جديد، مع بقاء سجل `REJECTED` (حفظ التاريخ) |

- `Property.version` يُزاد عند كل تغيير حالة/تعديل جوهري.
- أحداث `AuditLog`: `PROPERTY_CREATE/UPDATE/APPROVE/REJECT/RESUBMIT` و`CONTACT_CREATE/UPDATE` — **دون** تخزين أرقام هاتف أو أجسام الطلبات الخام.

---

## 11. تخزين الصور وسياسة المجلد المحلي

- **صورة واحدة إلزامية** لكل عقار جديد، عبر `FileInterceptor('image')` مع حد 5MB وحقل ملف واحد.
- التحقق يعتمد على **توقيع البايتات** (JPEG `FF D8 FF`، PNG، WebP) لا على الامتداد/رأس MIME.
- المفتاح **يُولّد على الخادم**: `<YYYY>/<MM>/<UUID>.<ext>` — لا يُستخدم اسم الملف الأصلي إطلاقًا.
- المجلد الجذري قابل للضبط عبر `STORAGE_ROOT`، والافتراضي **خارج المستودع**: `<home>/.arkan-crm/storage`. لا تُعدَّل `.env` تلقائيًا.
- منع اجتياز المسارات: فحص المفتاح + تأكيد بقاء المسار داخل الجذر.
- `FileAsset` يخزّن `bucket/key/mimeType/sizeBytes/uploadedById/propertyId`؛ ولا يُعاد أيٌّ منها في الاستجابات.
- `GET /properties/:id/image` يتطلب مصادقة، ويستخدم نفس سياسة الرؤية، ويُقدّم بتدفّق مع `Cache-Control: private, no-store` و`X-Content-Type-Options: nosniff`.
- **التنظيف**: عند فشل المعاملة تُحذف البايتات (Best-effort)؛ أي تباعد (ملف بلا صف أو صف بلا ملف) يُعالَج يدويًا لاحقًا.

> **حدود معلومة:** لا تُزال بيانات EXIF/GPS (لا حزمة معالجة صور مثبّتة، ولا نُثبّت اعتماديات دون موافقة)؛ والتخزين المحلي **ليس** جاهزية إنتاجية بذاته (يحتاج سياسة نسخ احتياطي/نشر).

---

## 12. خرائط الطوابق والعقار المطلوب (البدل)

- **الطوابق**: DTO صريح `{ type: FloorType, customLabel?, details?, sortOrder? }`؛ القبو/نصف الدور/ربع الدور كسجلات `FloorType` منفصلة (`BASEMENT/HALF/QUARTER`). `details` نص حر. لا حاجة لعدد غرف/حمّامات.
- **`area` القديم**: يبقى حقلًا نصيًا إلزاميًا يمثّل اسم المنطقة؛ يُملأ هكذا: `district ?? governorate ?? 'موقع غير محدد'` (Sentinel موثّق صريح لموقع غير معروف، وليس منطقة مختلقة). لا يُفسَّر `area` أبدًا كمساحة مترية.
- **`district`/`sizeSqm`**: `district` الحقل الصريح الجديد، و`sizeSqm` مساحة اختيارية `Decimal(14,2)`.
- **EXCHANGE**: إنشاء اختياري لـ `RequestedProperty` (محافظة/منطقة/قطعة/رقم/مساحة/متطلبات طوابق/ملاحظات/حدّ أدنى/حدّ أعلى للميزانية). كل الحقول اختيارية؛ يُقبل min-only أو max-only أو كلاهما أو لا شيء؛ يُرفض السالب و`min > max`. لا يُطلب عقد ثانٍ أو صورة ثانية.
- **SALE/RENT**: يُرفض `requestedProperty` غير المتوقع بدل تخزينه بصمت.
- **السعر/العملة**: `Prisma.Decimal` / سلاسل عشرية فقط، والعملة `KWD` (بدون تغيير دقة `Decimal(14,2)`)؛ `sizeSqm`/`askingPrice` اختياريان (لا يُفرض غير صفري).

---

## 13. أدلة اختبار التكامل (مدير + عدة موظفين)

- إنشاء مستخدمين حقيقيين (MANAGER + EMPLOYEE A + EMPLOYEE B) في قاعدة الاختبار المعزولة، ثم **تسجيل دخول حقيقي** عبر `POST /auth/login` للحصول على رموز JWT فعلية (لا محاكاة للسياسات).
- أمثلة مغطّاة: مدير ينشئ عقارًا `AVAILABLE`؛ موظف ينشئ `PENDING`؛ موظف لا يستطيع الموافقة/الرفض (403)؛ الموافقة تنقل الحالة وترفع `version`؛ الرفض بسبب إلزامي يُخزَّن؛ عقار مرفوض/معلّق مخفي عن موظف آخر (404)؛ تصحيح + إعادة إرسال مع بقاء سجل الرفض (`['REJECTED','PENDING']`)؛ سباق موافقة/رفض ⇒ `[200, 409]`؛ خصوصية: الموظف B يرى بيانات A العامة ولا يستلم إطلاقًا `contact`/`contactId`/الهاتف/الاسم (فحص نصي على الاستجابة)؛ المدير يرى جهة التواصل؛ قائمة لا تسرّب؛ تخمين IDs لا يتجاوز (404).

### 13.1 إعداد قاعدة الاختبار المعزولة (خارج قاعدة التطوير)

```powershell
# اسم قاعدة الاختبار
arkan_crm_api_test_20261015173606
# تطبيق الترحيلات الثلاثة الموجودة عليها فقط
npx prisma migrate deploy
# النتيجة: 3 migrations applied — "All migrations have been successfully applied."
# التحقق اللاحق:
#   test DB migration count = 3
#   dev  DB migration count = 3 (لم تتغير)
#   الجداول الجديدة موجودة في test DB: Contact, FileAsset, PropertyApprovalRequest, PropertyFloor, PropertyRevision, RequestedProperty
```
> لم تُحذف قاعدة الاختبار (محفوظة كدليل). لا `reset` ولا `seed` ولا `db push` على قاعدة التطوير.

---

## 14. نتائج أوامر التحقق والاختبارات

| الأمر | النتيجة |
| --- | --- |
| `npm run typecheck` (tsc --noEmit) | **نجح** — `TYPECHECK_EXIT=0` |
| `npx prisma validate` | **نجح** — `The schema ... is valid` |
| `npx prisma migrate status` (قراءة فقط) | **3 migrations — Database schema is up to date!** |
| `npx jest --runInBand` (مع `TEST_DATABASE_URL`) | **7 حزم ناجحة — 54 اختبارًا ناجحًا** |
| `git diff --check` | **نجح** (`exit 0`، تحذيرات CRLF فقط) |
| `GET /health` | `{"status":"ok","service":"arkan-api"}` |
| `GET /health/ready` | `{"status":"ok","database":"up","redis":"up"}` |
| `GET /properties` و`/contacts` بلا رمز | `401` (المسارات مربوطة ومحمية) |
| عدّ قاعدة التطوير (قراءة فقط) | `Property=0, Contact=0, Owner=0, FileAsset=0, User=2` |
| نسخ الخلفية | نسخة واحدة فقط (PID watcher `11996`)؛ التطبيق أُعيد بناؤه تلقائيًا بعد التعديلات |

```text
Test Suites: 7 passed, 7 total
Tests:       54 passed, 54 total
Time:        ~45 s
```

---

## 15. العوائق والميزات غير المكتملة

- **إزالة EXIF/GPS**: `Not Implemented` — تتطلب حزمة معالجة صور غير مثبّتة؛ لن نثبّت اعتماديات دون موافقة. (لم يُوهَم بتعقيم الصور.)
- **التخزين الإنتاجي**: `Not Implemented` — محلي فقط عبر `StorageService` القابل للاستبدال.
- **تعديلات الموظف على `AVAILABLE` وسير عمل `PropertyRevision`**: `Not Implemented` (خارج النطاق).
- **مشاركة/إعادة إسناد جهات التواصل**: `Not Implemented` (خارج النطاق).
- **رؤية `SOLD/RENTED/ARCHIVED` للموظف**: `Not Tested` — مُقصاة افتراضيًا للمدير فقط لحين تعريف القواعد.
- **إيصالات/إشعارات للموافقة**: لم تُنفَّذ (لا إشعارات ولا طوابير).
- **`responsibleName`**: يعتمد على اسم منشئ العقار من `User`؛ لا يوجد عرض موحّد للملف الوظيفي بعد.
- **واجهة `PATCH`**: لا تدعم مسح الحقول النصية الاختيارية إلى `null` إلا لمنطقة/محافظة/قطاع/رقم القطعة/العنوان (تتطلب إرسال قيمة فارغة نصيًا)؛ موثّق.
- **تأكيد `.env`**: لم يُعدَّل؛ `STORAGE_ROOT` يبقى اختياريًا (افتراضياً خارج المستودع).
- **قاعدة الاختبار المعزولة**: ما زالت موجودة (مقصود كدليل)؛ يمكن إسقاطها بعد قبول النتائج.

---

## 16. تأكيد عدم تعديل الواجهة الأمامية

**لم تُعدَّل أي ملفات في `apps/frontend`** في هذه المرحلة. معالج Astra ثلاثي الخطوات (`new-property-modal-v2.tsx` + `new-property-model-v2.ts`) بقي كما هو. جميع ملفات الواجهة الأمامية التي تظهر في `git status` هي تعديلات **سابقة** غير مرتبطة بهذه المرحلة. لم يُعدَّل:

- منطق المصادقة (`auth`) — لم يُستبدل أي إطار؛ أُعيد استخدام `JwtAuthGuard` و`RolesGuard`.
- لا واجهات أعمال جديدة في الواجهة الأمامية، ولا تكامل مع هذه الواجهات.

---

## 17. الخطوات التالية المقترحة لربط معالج Astra (بانتظار الموافقة)

1. **طبقة عميل API في الواجهة**: إضافة دوال `createProperty(formData)`, `listProperties(params)`, `getPropertyImageUrl(id)` مع إرفاق رمز Bearer.
2. **بناء `FormData`**: تعيين `payload` كـ JSON مطابق لـ `CreatePropertyPayloadDto` (تحويل `ListingOperation` العربية: بيع→`SALE`، إيجار→`RENT`، بدل→`EXCHANGE`)، وإرفاق حقل `image` بالملف الحقيقي.
3. **ربط جهات التواصل**: استخدام `contactId` لجهة التواصل المختارة من السجل، أو `newContact` عند الإنشاء الجديد (متبادلان حصريًا).
4. **التحقق الأمامي المطابق**: نفس قواعد الخلفية (صورة واحدة، حدود الحجم، منع أرقام الهاتف في النص العام) لتجربة أفضل قبل الرفض من الخادم.
5. **استبدال السجل في الذاكرة** (`contact-registry.ts`) باستدعاءات `/contacts` الحقيقية، مع احترام ملكية الموظف.
6. **عرض الحالة**: استخدام `status` و`reviewNotes` لعرض شاشة الموافقة/الرفض للمدير والمنشئ. **لا** تُعرض بيانات `contact` إلا عند وجودها في الاستجابة (الخلفية تحجبها).
7. **الصورة**: استخدام `primaryImageUrl` مباشرة (يتطلب رمز مصادقة) بدل `URL.createObjectURL`.

---

## 18. تحقق نهائي من النطاق

- ✅ لم تُنفَّذ ترحيلات جديدة، ولم يُعدَّل مخطط، ولم تُعدَّل ملفات ترحيل مُطبَّقة.
- ✅ لم تُنفَّذ كتابة على قاعدة **التطوير**، ولا `reset`/`seed`/`db push` عليها.
- ✅ لم تُثبَّت/تُحدَّث أي حزمة.
- ✅ لم يُعدَّل `.env`، ولا الواجهة الأمامية، ولا منطق المصادقة.
- ✅ لم يُنفَّذ `commit`/`push`/`reset`؛ كل العمل غير مُلتزم ومحفوظ.
- ✅ الاختبارات الكاتبة تعمل على قاعدة معزولة فقط.

**التوقف هنا.** لن تبدأ واجهات `PropertyRevision` أو تعديلات الموظف على العقارات المعتمدة أو تكامل الواجهة الأمامية دون موافقة صريحة إضافية.
