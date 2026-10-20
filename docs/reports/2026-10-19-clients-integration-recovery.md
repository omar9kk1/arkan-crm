# تقرير: استئناف دمج وحدة العملاء (Clients Integration) بعد انقطاع الجلسة

التاريخ: 2026-10-19
نطاق هذه الجلسة: **قراءة وتحقيق فقط** — لم يُغيَّر أي كود تطبيقي، ولم يُنفَّذ أي commit/reset/stash/migration.

## ملخص

انقطعت الجلسة السابقة أثناء الدمج الحقيقي لواجهتي العملاء (مدير/موظف) مع خلفية `/clients`. العمل الموجود في شجرة العمل (working tree) **كامل ومعظمه سليم من الناحية الخلفية، لكن واجهة الأمامية لا تمر مرحلة التحقق**: `tsc --noEmit` في الفرونت يُرجع 7 أخطاء، لذا `next build` سيفشل حتى تُصلح. لم يُستأنف التنفيذ.

## ما تم إنجازه (Completed)

### الخلفية (Backend) — مكتملة وناجحة التحقق
- `apps/backend/src/clients/clients.controller.ts`: `GET /clients`، `GET /clients/stats`، `GET /clients/:id`، `POST /clients`، `PATCH /clients/:id`، `POST /clients/:id/follow-ups` (توجيه `stats` قبل `:id`).
- `apps/backend/src/clients/clients.service.ts` (~583 سطرًا): قائمة/بحث بالاسم-الهاتف، إحصاءات محسوبة من جداول كاملة (عملاء، ملاك، وسطاء، متابعات الأسبوع، متأخر، بدون عقار)، تفاصيل، إنشاء/تعديل داخل `$transaction` مع `AuditLog`، إنشاء متابعات، تسلسل زمني للتاريخ (الأسبوع السبت–الجمعة)، وتعبئة/فك تعبئة `method/outcome/note` داخل `FollowUp.notes` كـ JSON لتفادي أي ترحيل.
- `client-policy.ts`: تصفية صفوفية (المدير: الكل؛ الموظف: المنشأ أو المسؤول عبر `EmployeeProfile.userId`)، والإخفاء بـ 404 بدل 403.
- `client.dto.ts` + `dto/` (create/update/list-query/create-follow-up) مع تحقق `class-validator`.
- `clients.module.ts` مفعَّل (كان حدودًا فارغة)، ومسجَّل في `app.module.ts` و`test/support/test-app.ts`.
- **التحقق الفعلي**: `npx tsc --noEmit` في `apps/backend` → **بدون أي خطأ (نجح)**.

### الواجهة الأمامية (Frontend) — منجز جزئيًا
- طبقة API جديدة: `lib/api/clients-api.ts` + `lib/api/client-types.ts` + `lib/use-clients.ts` (قائمة + إحصاءات + refresh).
- استبدال بيانات `manager-clients/mock-data.ts` (حُذف) بنموذج `manager-clients/client-model.ts` وتحويل كل الاستيرادات في 9 مكوّنات.
- صفحتا `manager/clients` و`employee/clients` محوَّلتان إلى `export default` ومربوطتان بـ `useClients()` مع حالات تحميل/خطأ وToast.
- ربط الإنشاء/التعديل بالخادم (`createClient`/`updateClient`) وربط تسجيل المتابعة من درج الموظف (`createClientFollowUp`) مع عرض رسالة الفشل داخل النموذج.
- تبويبا الملاك والوسطاء يعتمدان `useRegistryContacts`/`useVisibleContacts` (بيانات حقيقية من `/contacts`).
- تبويبات وألوان وتنسيقات Astra لم تُمَس: كل التغييرات في الصفحات/النماذج فقط، و`clients.module.css` و`components/ui/*` كما هي.

### قاعدة البيانات — لا حاجة لأي ترحيل
- `schema.prisma` **غير معدَّل** (غير موجود في git status) وكل الأعمدة المستخدمة موجودة: `Client.createdById/responsibleEmployeeId/status/source`، `FollowUp.notes/dueAt/status`، `Deal` للعقار المرتبط، `Contact` للإحصاء.
- **تحقق فعلي**: `npx prisma validate` → السكيما سليمة ✔ ؛ `npx prisma migrate status` → 4 هجرات، `Database schema is up to date!` ✔ (لا ترحيلات معلّقة).

## ما لم يُنجز / أعمال جزئية (Partial / Not Implemented)

1. **7 أخطاء typecheck في الفرونت (حجب بنائي — `next build` سي FAIL)**:
   - `employee-clients-page.tsx(90)` و`clients-page.tsx(156)`: `useDraftState` تُستدعى بمعامل واحد والدالة تتطلب `(key, initial)` → يجب إضافة `{}`.
   - `clients-page.tsx(177)`: `<ManagerPageShell>` بدون الخصائص الإلزامية `title`/`description` (في HEAD كان يمرّر `title="العملاء"` + وصفًا) — وهو تغيير مرئي في ترويسة الصفحة.
   - 4 أخطاء `implicitly any` في `employee-clients-page.tsx` (السطور 198/206/211/245).
2. **خطأ برمجي وقت التشغيل (Runtime) في صفحة الموظف**: `useVisibleContacts()` تُرجع **مصفوفة** وليس كائن موارد، لكن الصفحة تقرأ `.loading/.error/.refresh` منها → `refreshContacts` و`refreshBrokers` = `undefined`، أي أن `await refreshContacts()` بعد حفظ مالك/وسيط **سيُثير TypeError**. كذلك لا توجد حالة تحميل/خطأ لتبويبَي الملاك والوسطاء (`contactsLoading/Error` غير مستخدمة).
3. **إسناد الموظف المسؤول غير موصول بالواجهة**: لا يُرسل `responsibleUserId` ولا `nextFollowUp` ولا `source` عند الإنشاء/التعديل من معالج المدير/الموظف (الخلفية تدعمها بالكامل) → «إعادة التخصيص» و«أول متابعة» غير متاحين من UI.
4. **`Client.status` غير قابل للتعديل**: خارج `UpdateClientDto` ولا يوجد حقل له في النماذج (الحالة المعروضة مشتقّة في المتصفح فقط).
5. **درج تفاصيل الموظف** يعرض «الموظف المسؤول: —» ثابتًا رغم أن DTO يوفّر `responsibleEmployeeName`.
6. **`GET /clients/:id` غير مستخدم من الفرونت** (الأدراج تعتمد نسخة القائمة) — السلوك سليم لكن التفاصيل الكاملة/المتابعات غير المقصوصة غير مأخوذة من الخادم.
7. **لا اختبارات لوحدة العملاء**: `apps/backend/test/` لا يحتوي `clients.spec.ts` → **`Not Tested`**. **الاختبارات لم تُشغَّل في هذه الجلسة إطلاقًا** (تشغيلها يكتب في قاعدة بيانات الاختبار، وهو ممنوع هنا) — لا توجد أي نتيجة اختبار يمكن الإدعاء بها.
8. **Lint يفشل**: `npx eslint apps packages` → **38 خطأ بالكامل داخل صفحتي العملاء** (استيرادات/متغيّرات غير مستعملة: `isLate`, `RegistryContact`, `ContactCard`, `pending`, `clientCount/ownerCount/brokerCount`, `user`… + عشرات `no-explicit-any`).
9. **كود ميّت/تكرار**: `clients-page.tsx(61)` متغيّر `pending` بلا معنى ولا استخدام؛ تكرار `ownerFromContact` و`formatPrice`/`currencyLabel`/`localDate` بين صفحتي المدير والموظف وبين `client-model` (مدير) و`client-model` (موظف).

## الملفات المتأثرة (شجرة العمل الحالية)

**معدَّلة (20):**
`apps/backend/src/clients/clients.module.ts` · `apps/backend/test/support/test-app.ts` · `apps/frontend/app/manager/clients/page.tsx` · `apps/frontend/app/employee/clients/page.tsx` · `apps/frontend/features/employee-clients/client-model.ts` · `.../employee-clients/components/{employee-clients-page,client-cards,employee-client-details-drawer,add-follow-up-modal}.tsx` · `.../employee-clients/components/request-wizard/add-client-request-modal.tsx` · `.../manager-clients/components/{clients-page,add-client-modal,client-card,client-details-drawer,follow-up-timeline,owner-card,owner-details-drawer,owner-employee-follow-up-tabs,person-properties}.tsx`

**محذوفة (1):** `apps/frontend/features/manager-clients/mock-data.ts`

**غير متتبعة/جديدة (9 مسارات):**
`apps/backend/src/clients/{client-policy.ts,client.dto.ts,clients.controller.ts,clients.service.ts,dto/}` · `apps/frontend/features/manager-clients/client-model.ts` · `apps/frontend/lib/api/{client-types.ts,clients-api.ts}` · `apps/frontend/lib/use-clients.ts`

> لا توجد ملفات مكرّرة أو نسخ احتياطية (`.orig/.rej/.bak`): لم يُعثر على أي ملف، والوحدات الجديدة معرَّفة مرة واحدة فقط.

## حالة Git الحالية

- الفرع `main`، متقدّم عن `origin/main` بـ **5 commits** (لم يُرفَع شيء).
- لا `commit` ولا `push` في هذه الجلسة، ولا أي `reset/restore/checkout/clean/stash`.
- التغييرات كلها **غير مُضافة (unstaged)**: 20 معدَّل + 1 محذوف + 9 غير متتبعة.
- لا أصول جديدة ناتجة عن عمليات هذه الجلسة (`*.tsbuildinfo` مُتجاهَل في `.gitignore`).

## نتائج التحقق الفعلية (شُغِّلت الآن)

| الفحص | النتيجة |
| --- | --- |
| `apps/backend`: `npx tsc --noEmit` | نجح، صفر خطأ ✔ |
| `apps/frontend`: `npx tsc --noEmit` | **فشل: 7 أخطاء** ✘ |
| `npx eslint apps packages` | **فشل: 38 خطأ** (كلها في صفحتي العملاء) ✘ |
| `npx prisma validate` | سليم ✔ |
| `npx prisma migrate status` | 4 هجرات، لا معلّقة ✔ |
| اختبارات Jest (`npm test`) | **لم تُشغَّل — `Not Tested`** |
| `next build` | **لم يُشغَّل** (متوقّع الفشل بسبب الـ typecheck أعلاه) |
| تحقق متصفح (React/سلوك) | **`Not Tested`** |

## حجبات الترحيل (Migration Blockers)

**لا يوجد أي حجب ولا حاجة لترحيل جديد.** المخطط السليم كما هو، وكل ما يحتاجه الدمج مغطّى بأعمدة قائمة. القرار الموثّق في الكود: تعبئة تفاصيل المتابعة (method/outcome/note) داخل `FollowUp.notes` كـ JSON **بشكل متعمَّد** لتفادي الترحيل. أي إضافة مستقبلية لأعمدة مخصّصة للمتابعة أو تغيير `Client.status` إلى enum تتطلب **موافقة صريحة** قبل `prisma migrate dev`.

## الخطوة التالية المقترحة (أصغر خطوة)

إصلاح **7 أخطاء typecheck فقط** دون أي لمسة تصميم، ثم إعادة `npx tsc --noEmit` حتى صفر أخطاء:
1. إضافة القيمة الابتدائية `{}` لنداء `useDraftState` في السطرين 156 (`clients-page.tsx`) و90 (`employee-clients-page.tsx`).
2. إعادة خصائص `title="العملاء"` و`description` إلى `<ManagerPageShell>` كما في `HEAD` (مع تفادي تكرار `<h1>` الداخلي).
3. إضافة أنواع صريحة لقوائم الملاك/الوسطاء في صفحة الموظف لحل `implicit any`.

بعدها مباشرة (خطوة ثانية): استبدال قراءة `.refresh` من `useVisibleContacts` بمصدر `useRegistryContacts()`/`useContacts()` في صفحة الموظف لإصلاح انهيار حفظ المالك/وسيط.

**تم التوقف هنا بانتظار الموافقة قبل أي تنفيذ.**
