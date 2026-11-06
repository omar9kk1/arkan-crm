# تقرير: سلة محذوفات العقارات والحذف النهائي العميق (Property Trash & Deep Delete)

**التاريخ:** 2026-11-04  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** التنفيذ والاختبارات مكتملة على قاعدة الاختبار المعزولة — **بانتظار الموافقة على تطبيق الـ migration على قاعدة التطوير المشتركة**  

---

## 1. نظرة عامة على المعمارية

- **الخلفية:** NestJS + Prisma + PostgreSQL. أُضيفت عمليات Trash إلى `PropertiesService` و`PropertiesController`، مع فرض صلاحية `MANAGER` عبر `@Roles(Role.MANAGER)` و`RolesGuard` (ليس في الواجهة فقط).
- **قاعدة البيانات:** حقلان/ثلاثة على `Property` + جدول tombstone جديد.
- **الواجهة:** Next.js/React. تبويب جديد «سلة المحذوفات» داخل صفحة عقارات المدير، مع بطاقات Trash وحوارَي تأكيد (حذف مؤقت / حذف نهائي بكتابة الكود).
- **التخزين:** الصور تُحذف من التخزين المحلي بعد نجاح معاملة قاعدة البيانات (best-effort) عبر `FilesService.discard`.

### قرارات تصميمية
1. **Soft delete = علم `deletedAt`** وليس حذفاً. الصف والكود والمالك والدور والصور والتاريخ تبقى.
2. **الاستعادة** تُرجع نفس السجل ونفس الكود، مع فحص تعارض هوية نشط قبل إعادة التفعيل.
3. **الحذف النهائي** مسموح فقط لسجل موجود في Trash، ويتطلب كتابة كود العقار حرفياً.
4. **المالك/جهة التواصل/العميل كيان مستقل** — لا يُحذف أبداً مع العقار.
5. **Tombstone** يحجز الكود للأبد ويسجّل من حذف ومتى، دون بيانات منزل/مالك.

---

## 2. التغييرات

### 2.1 مخطط قاعدة البيانات (Prisma)

`apps/backend/prisma/schema.prisma`:

```prisma
model Property {
  // ...
  deletedAt         DateTime?
  deletedByUserId   String?   @db.Uuid
  deletedBy         User?     @relation("PropertyDeletedBy", fields: [deletedByUserId], references: [id], onDelete: Restrict)
  deletionReason    String?
  @@index([deletedAt])
}

model PropertyTombstone {
  id              String   @id @default(uuid()) @db.Uuid
  reference       String   @unique
  deletedByUserId String?  @db.Uuid
  deletedBy       User?    @relation("PropertyTombstoneDeletedBy", fields: [deletedByUserId], references: [id], onDelete: Restrict)
  deletedAt       DateTime @default(now())
  summary         Json?
  @@index([deletedAt])
}
```

أُضيفت علاقات عكسية على `User`:
- `deletedProperties Property[] @relation("PropertyDeletedBy")`
- `propertyTombstones PropertyTombstone[] @relation("PropertyTombstoneDeletedBy")`

### 2.2 ملف الـ migration (جاهز، غير مطبَّق على قاعدة التطوير)

`apps/backend/prisma/migrations/20261104120000_property_trash_and_tombstone/migration.sql`

- إضافة الأعمدة الثلاثة + فهرس `Property_deletedAt_idx`.
- إنشاء `PropertyTombstone` + فهرس فريد على `reference` + فهرس `deletedAt`.
- مفاتيح خارجية إلى `User` بـ `ON DELETE RESTRICT`.
- **Rollback يدوي موثّق داخل الملف** (إسقاط الجدول/القيود/الأعمدة).

> **الوضع الحالي:** الـ migration طُبِّق على قاعدة الاختبار المعزولة `arkan_crm_api_test` فقط، **ولم يُطبَّق على `arkan_crm`**. التطبيق على قاعدة التطوير يتطلب موافقة صريحة.

### 2.3 الخلفية

| الملف | التغيير |
|---|---|
| `apps/backend/src/properties/properties.service.ts` | `softDelete`, `restore`, `permanentDelete`, `listTrash`, `findActiveIdentityConflict`, `assertManager`؛ استبعاد المحذوف من القراءات العادية |
| `apps/backend/src/properties/properties.controller.ts` | `GET /properties/trash`, `POST /properties/:id/trash`, `POST /properties/:id/restore`, `DELETE /properties/:id/permanent` (كلها Manager-only) |
| `apps/backend/src/properties/property-visibility.ts` | `deletedAt: null` في كل قراءات Manager/Employee |
| `apps/backend/src/properties/property-serializer.ts` | إظهار `deletedAt`, `deletedByName`, `deletionReason` + تحميل `deletedBy` |
| `apps/backend/src/properties/property.dto.ts` | حقول Trash في DTO |
| `apps/backend/src/properties/dto/trash-property.dto.ts` | سبب اختياري للحذف المؤقت |
| `apps/backend/src/properties/dto/permanent-delete-property.dto.ts` | `confirmationCode` إلزامي |

**الاستبعاد من القراءات العادية:**
- `list` و`findOne` و`openImage` تعتمد `propertyVisibilityWhere` التي أصبحت تتضمن `deletedAt: null`.
- `countMine` يستثني المحذوف.
- `requireExisting` (approve/reject/request-changes/update/resubmit) يستثني المحذوف → 404.
- مرشحو التكرار (`create`) يستثنون المحذوف، لذا لا يمنع عقار مطرود تسجيل عقار جديد.

**الاستعادة — فحص التعارض:**
```
block+plot متطابقان (إن وُجدا) أو address متطابق،
مع governorate/district، ضمن الحالات النشطة فقط، وباستثناء نفس السجل.
```
عند وجود تعارض → `409` ورسالة تحمل كود العقار المتعارض.

**الحذف النهائي — ترتيب العمليات داخل معاملة واحدة:**
1. التحقق: السجل موجود، `deletedAt != null`، والكود المكتوب مطابق.
2. فحص الحواجز: `Deal`, `ManualExpense`, `ClientPropertyInterest` → إن وُجدت، `409` مع بيان السبب.
3. **إبقاء تاريخ المالك:** `FollowUp.propertyId = null`، و`FollowUpSubject.propertyId = null` مع `active=false` و`deactivatedAt` (لا حذف للسجل).
4. حذف البيانات الحصرية: `Notification`، `PropertyApprovalRequest`، `PropertyRevision`، `PropertyFloor`، `RequestedProperty`، `PropertyRegistrant`، `PropertyAssignment`.
5. تحرير `primaryImageId` ثم حذف `FileAsset` (الصفوف).
6. حذف `Property`.
7. إنشاء `PropertyTombstone` (يحجز الكود).
8. إنشاء `AuditLog` (`PROPERTY_PERMANENT_DELETE`).
9. بعد commit: حذف ملفات الصور فيزيائياً (best-effort).

---

## 3. قاعدة حماية المالك/العميل (Critical Clarification)

**مُنفَّذة على مستوى قاعدة البيانات والمنطق الخلفي، وليست سلوك واجهة فقط.**

- `softDelete`: يحدّث `Property` فقط؛ `contactId`/`Contact`/`Owner`/`Client` لا تُلمس.
- `restore`: لا يعيد إنشاء جهة تواصل؛ `contactId` الأصلي يبقى كما هو.
- `permanentDelete`: **لا يوجد أي `delete` أو `update` على `Contact`/`Owner`/`Client`.**
- تاريخ المتابعة المرتبط بالعقار (FollowUp/FollowUpSubject) يبقى مع `propertyId = null` بدل الحذف.
- إذا كان للمالك عدة عقارات: حذف أحدها لا يؤثر على الباقي ولا على جهة التواصل.
- إذا كان للمالك عقار واحد فقط: يبقى سجل المالك موجوداً بعد الحذف بعدد عقارات نشطة = 0.

### اختبارات القاعدة (ضمن `property-trash.spec.ts`)
| # | السيناريو | النتيجة |
|---|---|---|
| 7 | مالك ب عدة عقارات — حذف مؤقت ثم نهائي لواحد | جهة التواصل باقية، العقار الآخر سليم |
| 8 | مالك بعقار واحد — حذف نهائي | جهة التواصل باقية، عدد العقارات المرتبطة = 0 |
| 3 | حذف مؤقت ثم استعادة | نفس الكود، نفس `contactId`، نفس الأدوار |
| 9 | تاريخ متابعة على مستوى المالك | FollowUp/FollowUpSubject/Entry باقية، `propertyId = null` |
| 6 | سجلات مالية محمية | الحذف النهائي مرفوض 409 |

---

## 4. الملفات المعدّلة (كاملة)

### Backend
- `apps/backend/prisma/schema.prisma`
- `apps/backend/prisma/migrations/20261104120000_property_trash_and_tombstone/migration.sql` (جديد)
- `apps/backend/src/properties/properties.service.ts`
- `apps/backend/src/properties/properties.controller.ts`
- `apps/backend/src/properties/property-visibility.ts`
- `apps/backend/src/properties/property-serializer.ts`
- `apps/backend/src/properties/property.dto.ts`
- `apps/backend/src/properties/dto/trash-property.dto.ts` (جديد)
- `apps/backend/src/properties/dto/permanent-delete-property.dto.ts` (جديد)
- `apps/backend/test/property-trash.spec.ts` (جديد)

### Frontend
- `apps/frontend/lib/api/property-types.ts`
- `apps/frontend/lib/api/properties-api.ts`
- `apps/frontend/lib/property-adapter.ts`
- `apps/frontend/features/manager-properties/preview-data.ts`
- `apps/frontend/features/manager-properties/components/manager-properties.tsx`
- `apps/frontend/features/manager-properties/components/trash-dialogs.tsx` (جديد)
- `apps/frontend/features/manager-properties/components/property-details-drawer.tsx`
- `apps/frontend/features/manager-properties/components/properties.module.css`
- `apps/frontend/components/ui/button.tsx` + `button.module.css` (variant danger)

---

## 5. واجهة سلة المحذوفات

- تبويب ثالث «سلة المحذوفات» بجانب «العقارات» و«تحت المراجعة».
- لكل بطاقة: **الكود**، **الموقع**، **تاريخ الحذف**، **اسم المدير الذي حذف**، زر **استعادة**، زر **حذف نهائي**.
- حالات: تحميل، خطأ (مع إعادة المحاولة)، فارغة.
- الحذف المؤقت: زر «حذف إلى سلة المحذوفات» داخل درج العقار، مع حوار تأكيد وسبب اختياري.
- الحذف النهائي: حوار منفصل يحذّر أن العملية لا رجعة فيها عبر أدوات CRM، ويطلب كتابة كود العقار حرفياً، وزر التأكيد معطّل حتى يطابق الكود.

---

## 6. سياسة كود العقار

- لا يُعاد استخدام كود عقار مُعتمد حتى بعد الحذف النهائي.
- لا يتم reset لتسلسل الأكواد.
- `PropertyTombstone.reference` فريد → يحجز الكود للأبد.
- لم يُغيَّر منطق توليد الأكواد (P-codes/A-codes) في هذه المهمة.

---

## 7. النسخ الاحتياطي والاحتفاظ

- الحذف النهائي يحذف من قاعدة البيانات النشطة والتخزين، لكن **النسخ الاحتياطية لقاعدة البيانات قد تحتفظ بالبيانات حتى انتهاء مدة الاحتفاظ المُعدّة**. هذا موثّق في حوار الحذف النهائي وفي هذا التقرير.

---

## 8. نتائج الاختبارات (فعلية)

### `apps/backend/test/property-trash.spec.ts` — 11/11 ناجح
1. الموظف لا يستطيع عرض/تشغيل أي endpoint للسلة (403 لكل منها).
2. الحذف المؤقت يخفي السجل من القائمة/التفاصيل/عدّاد الموظف ويظهر في Trash.
3. الاستعادة ترجع نفس الكود و`contactId` والأدوار والبيانات.
4. الاستعادة مرفوضة (409) عند وجود عقار نشط مكافئ.
5. الحذف النهائي يتطلب سجلاً في Trash + الكود الصحيح (400 لغير المحذوف/الكود الخطأ).
6. الحذف النهائي مرفوض (409) عند وجود سجل مالي/اهتمام عميل.
7. مالك ب عدة عقارات: جهة التواصل والعقار الآخر يبقيان.
8. مالك بعقار واحد: جهة التواصل تبقى بعد الحذف النهائي.
9. تاريخ المتابعة على مستوى المالك يبقى مع `propertyId = null`.
10. عقار محذوف لا يمنع تسجيل عقار مطابق جديد.
11. الكود الأصلي محجوز في tombstone ولا يُعاد استخدامه.

### اختبارات الانحدار
```
property-trash.spec.ts
duplicate-comparison.spec.ts
property-duplicate-priority.spec.ts
properties.spec.ts
property-request-changes.spec.ts
→ Test Suites: 5 passed, 5 total
→ Tests:       87 passed, 87 total
```

### Typecheck / Build / Lint
| الفحص | النتيجة |
|---|---|
| `typecheck` backend | ✅ |
| `typecheck` frontend | ✅ |
| `nest build` | ✅ |
| `next build` | ✅ |
| ESLint على ملفات Trash المعدّلة | ✅ بلا أخطاء |

---

## 9. ما تم التحقق منه في المتصفح vs الاختبارات

- **المتصفح:** لم يتم التحقق البصري/التفاعلي من واجهة السلة، لأن الـ migration لم يُطبَّق على قاعدة التطوير المشتركة (بقرار السلامة) وخادم الـ backend تم إيقافه مؤقتاً (كان يمنع إعادة توليد Prisma Client). أي تشغيل للواجهة الآن سيُرجع خطأ 500 من endpoints السلة حتى تطبيق الـ migration.
- **الاختبارات:** كل سلوك Trash/الاستعادة/الحذف النهائي/حماية المالك/الأكواد تم التحقق منه عبر اختبارات تكامل حقيقية على قاعدة الاختبار المعزولة (HTTP + Prisma + ملفات مؤقتة).

---

## 10. المخاطر والقيود

1. **الـ migration غير مطبَّق على قاعدة التطوير** — مطلوب موافقة صريحة قبل `prisma migrate deploy` على `arkan_crm`.
2. **خادم الـ backend متوقف** حالياً؛ يجب تشغيله بعد تطبيق الـ migration.
3. **Docker Engine أصبح غير مستجيب** أثناء محاولة تحقق قراءة-فقط نهائية على قاعدة التطوير؛ لم يُطبَّق أي تغيير على قاعدة التطوير.
4. **الحذف النهائي يحجب** على `Deal`/`ManualExpense`/`ClientPropertyInterest` بدل حذفها؛ قد يحتاج المدير لمعالجة يدوية.
5. **الصور:** حذف الملفات best-effort بعد commit؛ قد يبقى ملف يتيم إذا فشل حذف القرص، ويُبلَّغ عنه.
6. **FollowUpSubject.targetKey** قد يحتفظ بمعرّف العقار كنص تاريخي بعد `propertyId = null` (ليس FK؛ لا يكسر قاعدة البيانات).
7. **Soft delete لا يوقف** أي ارتباطات مالية قائمة؛ يمكن حذف عقار له صفقات مؤقتاً (قابل للاستعادة)، بينما الحذف النهائي يحجبها.
8. **نسخ قاعدة البيانات** قد تحتفظ بالبيانات حتى انتهاء مدة الاحتفاظ.

---

## 11. خطوات الاختبار اليدوي

> تتطلب أولاً تطبيق الـ migration على قاعدة التطوير (بعد الموافقة) وتشغيل backend.

1. سجّل دخول كمدير.
2. افتح `/manager/properties` → افتح عقاراً → «حذف إلى سلة المحذوفات» → أكّد.
3. تحقق أن العقار اختفى من «العقارات» و«تحت المراجعة»، وظهر في «سلة المحذوفات» مع الكود/الموقع/التاريخ/اسم المدير.
4. اضغط «استعادة» → تحقق من عودة العقار بنفس الكود والبيانات.
5. احذف عقاراً آخر مؤقتاً، ثم «حذف نهائي» → اكتب الكود خطأً (يجب أن يبقى الزر معطلاً/يُرجع 400) ثم اكتبه صحيحاً → تحقق من اختفائه من السلة.
6. تحقق من بقاء جهة التواصل/المالك في شاشة العملاء أو عبر API، وأن العقارات الأخرى لنفس المالك سليمة.
7. سجّل دخول كموظف → تأكد أن `GET /properties/trash` وكل عمليات السلة تُرجع 403.
8. تحقق من أن عقاراً محذوفاً لا يمنع تسجيل عقار جديد بنفس الهوية.
9. تحقق من أن الكود المحذوف نهائياً لا يُعاد استخدامه في تسجيل جديد.

---

## 12. حالة التنفيذ النهائية

- **الكود:** مكتمل (backend + frontend + DTOs + tombstone).
- **الاختبارات:** 11/11 Trash، و87/87 انحدار.
- **البناء:** backend/frontend ناجحان.
- **قاعدة التطوير:** **لم تُلمس**؛ الـ migration جاهز وغير مطبَّق.
- **البيانات الحقيقية:** A-000001 وA-000003 لم تُمسّا.
- **Commits/Pushes:** لا.

**متوقف بانتظار الموافقة الصريحة على تطبيق الـ migration على قاعدة التطوير المشتركة، ثم المراجعة اليدوية.**
