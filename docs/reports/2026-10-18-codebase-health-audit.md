# تدقيق صحة المشروع وعمارته — Arkan CRM

- **التاريخ:** 2026-10-18
- **نوع المهمة:** تدقيق شامل للقراءة فقط (READ-ONLY) قبل إضافة ميزات جديدة.
- **النطاق الفعلي:** شجرة العمل الحالية بالكامل بما فيها التعديلات غير المُثبتة (uncommitted)، وليس فقط `HEAD`.
- **القيود المطبَّقة أثناء التدقيق:** لا تعديل كود، لا تعديل/ترحيل قاعدة بيانات، لا Git (reset/stash/clean/commit/push)، لا تثبيت حزم، لا ملفات جديدة عدا هذا التقرير، لا تغيير واجهة/إعدادات.
- **منهجية التحقق:** فحص مباشر للملفات والأسطر المذكورة، فحص `git status`/`git diff`/`git stash`، وتشغيل أوامر التحقق غير التدميرية المذكورة في القسم (0). ملاحظات فرعية (subagents) استُخدمت للتوسّع، وأُعيد التحقق من أغلب الادعاءات الحرجة يدويًا على الملفات نفسها.

---

## (0) أوامر التحقق التي نُفّذت فعليًا ونتائجها

| الأمر | النتيجة |
| --- | --- |
| `npm run typecheck` (من جذر المستودع: يبني `@arkan/shared` ثم `typecheck` لكل workspace) | ✅ نجح — صفر أخطاء |
| `npm run lint` (`eslint apps packages`) | ✅ نجح — صفر أخطاء وصفر تحذيرات |
| `npm run build` (`shared` + `backend` + `frontend`) | ✅ نجح — بُنيت كل المسارات (‏16 مسارًا + `/login`) |
| Backend: `npx jest --runInBand` مع `TEST_DATABASE_URL` لقاعدة الاختبار المعزولة `.../arkan_crm_api_test_20261015173606` | ✅ **14 حزمة اختبار / 169 اختبارًا — 0 تخطّي (skip)** — زمن التنفيذ ~101 ثانية |
| `npm run format:check` (Prettier) | ❌ **يفشل: 305 ملفًا غير منسَّقة** |
| اختبارات الواجهة الأمامية | ⚠️ **غير ممكن تنفيذها: لا توجد سكربتات اختبار أصلًا** — `apps/frontend/package.json` يحتوي `dev`/`build`/`start`/`typecheck` فقط |
| تحقق متصفح (E2E) لهذا التدقيق | **لم يُجرَ** — التدقيق قراءة فقط. النتائج السلوكية المذكورة في تقارير سابقة ليست جزءًا من هذا التدقيق ولم تُعاد. |

**حول فشل Prettier (فشل مُؤكَّد، سابق):** الأثر يشمل ملفات لم تُمسّ إطلاقًا (`TODO.md`, `tsconfig.base.json`, `PROJECT_CONTEXT.md`, `packages/shared/*`)، ما يدل على أن الفشل **pre-existing** وليس مُدخَلًا بالتغييرات الأخيرة. لا يؤثر على الوظيفة، لكنه يعني أن `format:check` غير صالح حاليًا كبوابة جودة (خاصة مع تحذيرات `LF will be replaced by CRLF` على عشرات الملفات).

**لم يُجرَ:** أي migration، أي استعلام على قاعدة الإنتاج، أي تعديل ملفات مصدر، أي commit.

---

## (أ) التقييم العام للصحة والعمارة

**الحالة: صحية مع تركّز دَين تقني مُتحكَّم فيه في موقعين رئيسيين (خدمة خلفية واحدة مفرَّطة الحجم، وملف واجهة واحد مفرَّط الحجم)، ومرحلة انتقال حقيقية بين mock وبيانات فعلية في الواجهة الأمامية.**

نقاط القوة المؤكَّدة:

- **الطبقة الخلفية ناضجة:** حارسان عالميان عبر `APP_GUARD` (`JwtAuthGuard` ثم `RolesGuard` — `apps/backend/src/auth/auth.module.ts:35-36`)، وأربعة مسارات عامة فقط (`@Public`) في كل المشروع: ثلاثة في `auth.controller.ts:18,25,32` وواحد في `health.controller.ts:4` (‏grep مؤكَّد). عزل بيانات الإشعارات مُتحقَّق منه على الخادم. سير عمل العقارات يستخدم قيودًا شرطية (`updateMany` شرطي) مع قفل إ.optimistic عبر `version`. الصور تمر بتنقية كاملة (كشف توقيع البايتات + إزالة EXIF + سقوف أبعاد). `Validation Pipe` عالمي بـ `whitelist + forbidNonWhitelisted + transform`، و**صفر استخدامات `any` وصفر `@ts-ignore`** في `apps/backend/src`.
- **الواجهة الأمامية في مرحلة انتقال حقيقية:** الخصائص (كلا الدورين)، الموظفون، جهات الاتصال، والإشعارات (كلا الدورين) موصولة بقاعدة البيانات الفعلية؛ بينما 8~9 ميزات ما تزال تعمل ببيانات مُختلقة داخل حالة React (مُوثَّقة بالتفصيل في قسم Mock).
- **التنقيب المتجمّع:** نموذج خلفي واحد مفرَّط الحجم (`properties.service.ts` ~875 سطرًا) وملف واجهة واحد مفرَّط الحجم (`new-property-modal-v2.tsx` 1251 سطرًا)، وتكرار مقصود لواجهات Manager/Employee (كروت، محوّرات، CSS) بدلاً من مكوّنات مشتركة.
- **شبكة أمان معمارية في موضع البيانات:** يوجد `fetch` واحد وترويسة `Authorization` واحدة في كل الواجهة الأمامية، وحلقة `setInterval` واحدة فقط في كل التطبيق (الإشعارات). هذا إنجاز يجب ألا يُهدَّد.

---

## (ب) ملخص التصنيف حسب الخطورة

| الخطورة | العدد | الخلاصة |
| --- | --- | --- |
| CRITICAL | **0** | لم تُعثر على ثغرة تكشف بيانات مستخدمين، ولا كسر في مسار عمل أساسي، ولا تسريب رموز. |
| HIGH | **4** | حدود معدّل مفقودة على تسجيل الدخول، سرّ مثال مقبول من التحقق، أرقام مُختلقة تُعرض كحقيقية، تعطيل حساب موظف متعذّر. |
| MEDIUM | **12** | كرّة منطق سير العمل، نموذجان لسياسة خصوصية واحدة، استعلام غير محدود، فهارس ناقصة، اختبارات تتخطّى نفسها بصمت، ~1000 سطر كود ميت، اقتران عرضي، PII تبقى بعد الخروج، ملف ضخم، سباق بريد/غياب audit، تناقض دور. |
| LOW | **12** | قيم صلبة، تعارض توثيق/سلوك، استدعاء مصادقة عند كل تنقّل، أحجام صفحات مختلفة، مال عبر float، طابور فارغ، ملفات بيئية متاخرة/ناقصة، تقادم توثيقي، exports ميتة. |

---

## (ج) المشاكل المؤكَّدة بالدليل — التصنيف التفصيلي

> **تمييز مهم:** ما يلي **مؤكَّد بالدليل المباشر من الكود** (قُرئ الملف والسطر المذكور). ما يلي بند **"خطر محتمل"** (potentiel risk) مُعلَّم صراحةً: أي احتمالية استغلال أو سلوك لم يُختبَر زمنيًا، أو مشكلة تظهر فقط عند نمو البيانات/crash.

### CRITICAL — لا توجد (مؤكَّد غيابًا)

- لا مسار غير عام غير المحمي (‏grep مؤكَّد: 4 وظائف `@Public` فقط).
- لا تسريب `passwordHash` (‏`EMPLOYEE_SELECT` يستثنيه صراحةً — `employees.service.ts:24-32`، مُختبَر في `employees.spec.ts:142`).
- لا تسريب جهات تواصل المالك/الوسيط لغير المصرّح لهم (‏`PublicPropertyDto` بنيويًا لا يحمل مفاتيح `contact`/`contactId`/`phone` — `property.dto.ts:38-79`).
- عزل الإشعارات عبر `userId: viewer.id` في كل العمليات (`notifications.service.ts:244,272,287,292,301`) ومعرّف غريب ⇒ 404 غير كاشف (`:290`)، مُختبَر (`notifications.spec.ts:413,456`).

---

### HIGH

#### H1 — لا يوجد تقييد معدّل (rate limiting) على تسجيل الدخول وتجديد التوكن — **مؤكَّد**
- **المسار/الأسطر:** `apps/backend/src/auth/auth.controller.ts:18-37` (`POST /auth/login` و`POST /auth/refresh` كلاهما `@Public()`). لا ذكر لـ `@nestjs/throttler` في `apps/backend/package.json`، وgrep عبر المستودع لـ `throttl|rateLimit` = صفر نتائج.
- **الدليل:** لا يوجد أي عدّاد محاولات؛ الحماية الوحيدة هي كلفة تجزئة scrypt.
- **لماذا يهم:** لا سقف لتخمين كلمة المرور أو توكن التحديث.
- **الأثر المحتمل:** اختراق حساب ببطء عبر بربرة (‏threat محتمل — لم يُختبَر).
- **الإصلاح الأدنى:** إضافة `@nestjs/throttler` (نحو 10/دقيقة على `/auth/login`) عبر `APP_GUARD`.
- **التأثير على وحدات أخرى:** لا شيء — يُضاف خارج أي منطق أعمال.

#### H2 — قيمة سرّ التوقيع في ملف المثال المُثبَّت في المستودع تجتاز التحقق — **مؤكَّد (الوضع)، محتمل (الاستغلال)**
- **المسار/الأسطر:** `apps/backend/.env.example:11` يحمل قيمة سرّ JWT مثال طويلة (‏>32 حرفًا) مقابل `apps/backend/src/config/environment.ts:34` الذي يرفض **الحرفية الواحدة فقط** `replace-with-random-secret-at-least-32-characters`.
- **الدليل:** `git ls-files` يؤكد أن `apps/backend/.env.example` مُثبَّت (tracked)، وأن قيم المثال في سطري 11 و12 أطول من الحد فلا تُرفض. اختبار `test/environment.spec.ts:17-27` يغطي الحرفية المرفوضة فقط ولا يفحص ملف المثال.
- **لماذا يهم:** كل من يتبع التوثيق الرسمي يعمل بسرّ توقيع معروف علنًا.
- **الخطر المحتمل:** مع توقيع سرّ معروف + `sid` مسروق من أي توكن مُلتقط = انتحال هوية. **وجود تخفيف حقيقي:** الحارس يعيد التحقق من جلسة حيّة في قاعدة البيانات عند كل طلب (`jwt-auth.guard.ts:47-59`)، فالتسرّب وحده لا يكفي دون جلسة سليمة.
- **الإصلاح الأدنى:** إضافة قيمة المثال إلى `.invalid(...)` + اختبار في `environment.spec.ts` يفحص ملف `.env.example` نفسه.
- **التأثير:** `environment.ts` + ملف اختبار واحد.

#### H3 — أرقام مُختلقة تُعرض كبيانات حقيقية بجانب سجلات حقيقية — **مؤكَّد**
- **المسار/الأسطر (كلها قُرئت يدويًا):**
  - `apps/frontend/features/manager-clients/components/clients-page.tsx:88` → `const clientCount = 28 + items.length - clients.length;` ويُعرض كبطاقة إحصائية في `:151` وكعدّاد تبويب في `:169`.
  - `clients-page.tsx:154` → `{ title: 'متابعة هذا الأسبوع', value: 54 }` (رقم ثابت مُختلق بالكامل).
  - `clients-page.tsx:81` → `useState<ClientSample[]>([...clients])` و`:100-118` → دمج مصفوفتَي `clients` و`owners` الوهميتين من `features/manager-clients/mock-data.ts:43,127` **في نفس القائمة** مع سجلات `GET /contacts` الحقيقية (أسماء وهمية بهواتف لا يمكن تمييزها عن الحقيقية).
  - `apps/frontend/features/manager-attendance/components/attendance-page.tsx:25` → `useState(createMockRecords)` و`:28-42` → دمج ~32 صفًا وهميًا من `attendance-model.ts:93-117` فوق سجلات الحضور الفعلية بمفتاح تفادي (‏employeeId, date) — **الصف الوهمي قد يحجب صفًا حقيقيًا بنفس المفتاح**.
  - إضافة عميل في `clients-page.tsx:285-299` تكتب لحالة React فقط (‏toast «تم إضافة العميل والطلب مؤقتًا») بينما «إضافة مالك/وسيط» في `:301-325` يكتب فعليًا عبر `createContact` — تناقض persistence في شاشة واحدة.
- **التخفيف الموجود (مُؤكَّد):** لافتات شفافية موجودة في `clients-page.tsx:145-148` و`attendance-page.tsx:87-90` وغيرهما — لكنها لا تمنع **الدمج** ولا تكشف أي رقم من الأرقام نفسها.
- **لماذا يهم:** ليست بيانات معزولة تُعرض بلافتة؛ هي مُدمجة بسجلات حقيقية، وقد تُتخذ قرارات بأرقام مخترعة.
- **الأثر:** فقدان الثقة بالبيانات + خطر استمرار صف وهمي يحجب حقيقيًا (الحضور).
- **الإصلاح الأدنى:** حذف إزاحة `28` والرقم `54` (ملف واحد، صفر تغيير تصميمي)؛ إيقاف دمج `createMockRecords` في صفحة المدير (ملف واحد).
- **التأثير:** `manager-clients` و`manager-attendance` فقط.

#### H4 — تعطيل حساب موظف متعذّر تمامًا رغم أن `isActive` بوابة الأمان — **مؤكَّد**
- **المسار/الأسطر:** الكتابة الوحيدة لـ `isActive` هي عند الإنشاء `apps/backend/src/employees/employees.service.ts:92` (‏`dto/create-employee.dto.ts:57-59`). و`PATCH /employees/:id` يحدّث **الاسم فقط** (`update-employee.dto.ts:11-16`، `employees.service.ts:119-122`)، بينما `isActive` يُقرأ كبوابة في `auth.service.ts:32,37,55` و`jwt-auth.guard.ts:56`.
- **لماذا يهم:** حساب موظف مُغادر أو مُخترَق لا يمكن إيقافه من الواجهة، وكل جلساته تبقى صالحة.
- **الأثر:** استمرار وصول غير مصرّح به لا يُسقَط.
- **الإصلاح الأدنى:** السماح بـ `UpdateEmployeeDto.isActive?: boolean` — محميٌّ أصلًا بـ `@Roles(Role.MANAGER)` على مستوى الصنف (`employees.controller.ts:25`).
- **التأثير:** وحدة `employees` + اختبار واحد.

---

### MEDIUM

#### M1 — تكرار منطق سير العمل ثلاثي المرات داخل خدمة مفرَّطة الحجم — **مؤكَّد**
- `apps/backend/src/properties/properties.service.ts` (~875 سطرًا): `approve` ≈ `:275-310`، `reject` ≈ `:345-397`، `requestChanges` ≈ `:440-473` تعيد كلها نفس الهيكل: `updateMany` شرطي على `PENDING` (+‏`version`)، `count === 0 → 409`، قراءة آخر `PropertyApprovalRequest` بترتيب `createdAt`، فحص `status !== PENDING → 409`، ثم `updateMany` شرطي على صف المراجعة، ونصوص أخطاء متطابقة حرفياً. و`resubmit` يعيد قراءة آخر مراجعة مرتين إضافيتين (`:648-651`, `:680-683`).
- **لماذا يهم:** القواعد صحيحة اليوم ومُختبَرة، لكن تعديل نسخة واحدة (مثل إضافة حارس) يُنحرف صامتًا عن الأخريات — وهو قلب أمان السير العمل.
- **الإصلاح الأدنى:** استخراج `assertPendingTransition(...)` و`readLatestApproval(...)` في ملف `property-workflow.ts` مع بقاء السلوك مطابقًا.
- **التأثير:** `properties.service.ts` وحده؛ مجموعة الاختبارات الحالية (169) ستُثبت عدم الانحراف.

#### M1b (ضمن M1) — خدمة مفرَّطة الحجم — **مؤكَّد**
- `properties.service.ts` هو الوحيد الذي يتجاوز ~400 سطر (‏~875). كل المتحكّمات ≤143 سطرًا. المطلوب: تقسيم حسب المسؤولية بعد استخراج helpers، لا إعادة كتابة.

#### M2 — نموذجان مختلفان لسياسة ملكية جهة الاتصال نفسها — **مؤكَّد**
- `apps/backend/src/contacts/contact-policy.ts:12-16` (فلتر Prisma يُستخدم في `contacts.service.ts:62,92,126,143`) مقابل نسخة مكتوبة يدويًا في `apps/backend/src/properties/property-serializer.ts:196-212` (`isManager || (isCreator && ownsContact)` ثم `contactId: canSeeContact ? ... : null`).
- **لماذا يهم:** قاعدة خصوصية واحدة يمكن أن تنحرف بين مسارَي القراءة (قائمة/تفاصيل مقابل API جهات الاتصال). كلاهما صحيح ومُختبَر اليوم، لكن لا يوجد مصدر حقيقة واحد.
- **الإصلاح الأدنى:** دالة واحدة `canViewContact(viewer, contact, property)` تُستدعى من كلا المكانين.
- **التأثير:** ملفَين + اختباران.

#### M3 — استعلام غير محدود في كل `GET /employees` — **مؤكَّد**
- `apps/backend/src/employees/employees.service.ts:144-154`: `prisma.property.findMany({ where: { createdByUserId: { in: userIds } }, orderBy: { createdAt: 'desc' }, select: {...} })` **بلا `take`** — يحمّل كل عقارات المشروع لكل استدعاء لدليل الموظفين، ثم يُقتطع لـ 50 لكل موظف عند الترميز فقط (`:187-188`).
- **لماذا يهم:** O(كل العقارات) في كل استدعاء؛ يكبر بلا سقف مع نمو البيانات.
- **الإصلاح الأدنى:** حساب `propertiesByStatus` عبر `prisma.property.groupBy({ by: ['status'], ... })` + `take` للعرض.
- **التأثير:** `employees.service.ts` فقط.

#### M4 — فهارس ناقصة على المسارات الحارة — **مؤكَّد (بنية المخطط)، محتمل (الأثر)** — *يتطلب migration*
- `apps/backend/prisma/schema.prisma:350-363`: ‏`PropertyApprovalRequest` يحمل `@@index([status, createdAt])` فقط (‏`:363`) **بلا فهرس على `propertyId`**، بينما يُستجوب بـ `propertyId ORDER BY createdAt DESC` في خمسة مواضع (`properties.service.ts:289,360,453,648,680`) وفي **كل قراءة تفاصيل عقار** عبر `include: { approvals: { orderBy: { createdAt: 'desc' } } }` (`property-serializer.ts:25`).
- `schema.prisma:264`: ‏`Property` يحمل `@@index([area, status])` فقط — `area` تتقدّم في المفتاح فلا ينفع فلتر `status` منفردًا (`properties.service.ts:213`)، والفرز `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]` (`:221`) بلا فهرس `createdAt`، و`@@index([createdByUserId])` (`:267`) بلا عمود `status` الذي تحتاجه فلترة الرؤية الخاصة بالموظف (`property-visibility.ts:21-29`).
- **الأثر المحتمل:** مسح كامل + فرز عند نمو الجدول (لم يُختبَر أداءه — البيانات الحالية صغيرة).
- **الإصلاح الأدنى:** فهرسان إضافيان (additive): `@@index([propertyId, createdAt])` و`@@index([status, createdAt])` (وأيضًا `@@index([createdByUserId, status])` اختياريًا).
- **تنبيه:** أي إصلاح هنا **يحتاج هجرة (migration) وموافقتك الصريحة** — لم يُنفَّذ.

#### M5 — حزم اختبار كاملة تتخطّى نفسها بصمت عند غياب `TEST_DATABASE_URL` — **مؤكَّد**
- `apps/backend/test/support/test-app.ts:24`: `export const describeWithDatabase = hasTestDatabase ? describe : describe.skip;` — و9 من 14 ملفًا تلفّ نفسها بذلك: `contacts.spec.ts:17`, `employees.spec.ts:40`, `notifications.spec.ts:48`, `properties.spec.ts:19`, `property-request-changes.spec.ts:28`, `properties-assets.spec.ts:22`, `properties-image-security.spec.ts:55`, `properties-image-restart.spec.ts:19`, `frontend-properties-contract.spec.ts:124`.
- **لماذا يهم:** ‏`npm test` قد يظهر أخضر مع تعطيل **كامل** أطقم العزل والخصوصية وسير العمل — شبكة أمان اختبارية انحارت.
- **التحقق الحالي:** عند تشغيل الجلسة بـ `TEST_DATABASE_URL` نصًّا: **169/169 نجحتًا بلا تخطٍّ**، أي أن كل الحزم شُغّلت فعليًا اليوم.
- **الإصلاح الأدنى:** فشل/تحذير صريح في setup عند غياب المتغير في بيئة CI.
- **التأثير:** `test/support` فقط.

#### M6 — ~1000+ سطر كود ميت يعطل التنظيف (ويعيق حذف mock) — **مؤكَّد**
- سلسلة معالجات العقار القديمة **بلا أي مستورد حيّ** (‏grep على الاستيرادات الديناميكية والثابتة): `property-offer-steps.tsx`, `property-form-steps.tsx`, `property-owner-step.tsx`, `property-paste-step.tsx` (≈520 سطرًا)، و`property-data-editor.tsx` (≈189 سطرًا) يُستورد من `property-offer-steps.tsx:2` فقط — أي سلسلة ميتة بالكامل.
- سلسلة `employee-clients/components/request-wizard/`: `model.ts` (‏36 سطرًا)، `client-request-form-step.tsx`, `client-review-step.tsx`, `modal-stepper.tsx`, `smart-paste-panel.tsx`, `usage-help-panel.tsx` وCSS الخاص بها — **بلا مستوردين** (≈239 سطرًا).
- **العقدة الحقيقية:** دالة بحث نقية `matchesPerson` تعيش داخل ملف mock: `features/manager-clients/mock-data.ts:229` وتُستورد من **ثلاثة** ملفات حيّة: `manager-employees/components/employees-page.tsx:13`، `employee-clients/components/employee-clients-page.tsx:29`، و`manager-clients/components/clients-page.tsx:23` (مسار نسبي `../mock-data`) → **حذف ملف الـ mock الآن يكسر ثلاث صفحات حقيقية**.
- **نقطة مهمة:** ‏`property-request-model.ts` **ليس ميتًا بالكامل** — يبقى حيًّا عبر `parse-property-message.ts:5` (الذي يُستورد من `new-property-modal-v2.tsx:19`) والنوع في `employee-properties/model.ts:3` و`manager-properties/preview-data.ts:22`. الميت هو مكوّنات الخطوات فقط.
- **الإصلاح الأدنى:** نقل `matchesPerson` إلى `lib/search.ts` أولًا، ثم حذف السلسلات الميتة.
- **التأثير:** ~4 ملفات تحرير + حذف لا يمسّ السلوك.

#### M7 — اقتران عرضي عبر الميزات يمنع إعادة الاستخدام — **مؤكَّد**
- `manager-properties/components/properties-segmented-tabs.tsx` يُستورد من **‏10 ملفات عبر 8 ميزات**: `manager-notifications/notification-filters.tsx:1`, `employee-notifications/employee-notification-filters.tsx:1`, `manager-clients/clients-page.tsx:19`, `manager-clients/client-details-drawer.tsx:4`, `manager-clients/owner-employee-follow-up-tabs.tsx:3`, `manager-deals/deals-page.tsx:11`, `manager-employees/employee-tabs.tsx:1`, `employee-properties/employee-properties-page.tsx:11`, `employee-properties/employee-property-details-drawer.tsx:3`, `employee-clients/employee-clients-page.tsx:13` — مكوّن عام عالق داخل ميزة المدير.
- صفحات إشعارات الموظف مُطلَّقة بـ CSS المدير: `employee-notifications-page.tsx:16` + `employee-notification-filters.tsx:4` + `employee-notification-details-drawer.tsx:7` → `manager-notifications/components/notifications.module.css`؛ وكذلك `employee-properties-page.tsx:27` → CSS خصائص المدير؛ و`employee-attendance-page.tsx:30` → CSS حضور المدير.
- تكرار ≈120 سطرًا في `manager-properties.tsx:40-180` مقابل `employee-properties-page.tsx:31-140` (نفس `requestId`/`silentRef`/`refetch`/`usePropertyRefreshSignal`/`useOpenPropertyRequest`/`loadMore`) يختلفان في دالة المحوّر فقط.
- كروت مكررة ≈95%: `property-card.tsx:19-81` مقابل `employee-property-card.tsx:20-86` (نفس الهيكل، نفس جلب الصورة المشروط بالرؤية، نفس الـ SVG fallback `:54-67` مقابل `:59-72`) + ~15 قاعدة CSS متوازية في ملفَي `properties.module.css`.
- محوّرا إشعارات مكرران: `notification-details-drawer.tsx:28-60` مقابل `employee-notification-details-drawer.tsx:26-73`.
- **الإصلاح الأدنى على دفعات:** نقل التبويبات إلى `components/ui/`، حقن `usePropertyList({map, pageSize})`، مكوّن `PropertyImageCard` واحد، محوّر إشعارات واحد — **بلا أي تغيير بصري**.
- **التأثير:** عدد متوسط من الملفات (11 مستوردًا للتوبويبات وحدها) لكن تعديل ميكانيكي.

#### M8 — `GET /auth/me` يُستدعى عند كل تنقّل داخل التطبيق — **مؤكَّد**
- `features/auth/components/auth-provider.tsx:31-55`: الأثر بـ deps `[pathname, attempt]` يستدعي `restoreSession()` → `api.getMe()` (`features/auth/session.ts:111-146`). الـ `pending` في `session.ts:147-154` يمنع التزامن المتزامن فقط، لا التسلسلي.
- **الأثر:** طلبات هدر على كل انتقال + مصدر حقيقة ثانٍ للمستخدم (حالة React مقابل الخادم).
- **الإصلاح الأدنى:** تخزين آخر جلسة مُتحقَّق منها وإعادة التحقق عند التركيب/‏401 فقط.
- **التأثير:** ميزة `auth` وحدها؛ كل الصفحات تستهلك `useAuth()` كما هي.

#### M9 — بيانات PII وبقايا جلسة تبقى بعد تسجيل الخروج — **مؤكَّد (البقاء)، محتمل (الضرر)**
- `lib/drafts/draft-storage.ts:51-66`: مسوّدات نماذج (أسماء/هواتف عملاء وأصحاب) تُكتب في `localStorage` ولا تُمسح عند `signOut` (التنظيف في `use-form-draft.ts:66-78` لكل نموذج فقط)، و`sanitizeDraft():2-11` يزيل فقط مفاتيح مطابقة لـ `password|token|secret|credential`.
- `features/employee-attendance/nfc-store.ts:2` مفتاح `arkan:mock-attendance-records` يبقى عبر الحسابات في نفس الجهاز (`:68-71`).
- `features/notifications/open-property.ts:21-34`: طلب «فتح العقار» المعلّق **لا يُصفّر** عند تغيّر الهوية (على عكس مخزن الإشعارات `store.ts:151-164`) → قد يُستهلك من المستخدم التالي ويولّد إشعار 404 زائف.
- **الإصلاح الأدنى:** مسح `arkan:draft:*` (‏+ اختياريًا سجل الحضور الوهمي) وتصفير `open-property` داخل `session.signOut`.
- **التأثير:** `session.ts` + ملفَين (سطر لكل سطر تقريبًا).

#### M10 — ملف واحد ضخم يخدم الدورين — **مؤكَّد**
- `features/employee-properties/components/new-property-modal-v2.tsx` = **1251 سطرًا** (‏1205 غير فارغة؛ 2.5× أكبر ملف تالي)، وهو **حيّ ومُستخدَم** عبر `add-property-modal.tsx:3-4` (‏re-export) → `employee-properties-page.tsx:276` **و** `manager-properties.tsx:482`.
- **الأثر:** أي تعديل للنموذج يهدّد كلا الدورين، وصعوبة مراجعة الكود.
- **الإصلاح الأدنى:** تقسيم حسب الخطوة (لصق/تحليل، طوابق، جهة اتصال، إجراءات) بسلوك مطابق — الاستيرادات تبقى عبر الـ re-export فلا يتغيّر شيء خارجيًا.

#### M11 — سباق بريد إلكتروني يُنتج 500 بدل 409، وغياب تدقيق (audit) لكتابة الحسابات — **مؤكَّد (الكود)، محتمل (السباق)**
- `employees.service.ts:79-87`: `findUnique({ email })` ثم `create` → طلب متزامن يضرب قيد الـ unique (`schema.prisma:117`) → `P2002` غير مُلتقَط → `api-exception.filter.ts:46-48` يعيد 500 عام. الحالة المتسلسلة تُرجع 409 صحيحًا (`employees.service.ts:83-84`، مُختبَر `employees.spec.ts:283-292`).
- **لا يوجد** أي `auditLog.create` في `employees.service.ts` (grep مؤكَّد)، بينما كل النطاقات الأخرى تكتب سجلًا: `auth.service.ts:80,114`، `contacts.service.ts:42,106`، `properties.service.ts:165,311,398,476,625,698` — إنشاء حساب دخول وإعادة تسميته بلا أثر forensics.
- **الإصلاح الأدنى:** التقاط `PrismaClientKnownRequestError`‏ `P2002` → `ConflictException`، و`$transaction` يجمع `user.create/update` مع `auditLog.create` بنفس نمط `contacts.service.ts:30-52`.
- **التأثير:** وحدة `employees` فقط.

#### M12 — `POST /employees` يقبل `role: MANAGER` فيُنتج حسابًا غائبًا عن الدليل نفسه — **مؤكَّد**
- `dto/create-employee.dto.ts:39-40` ‏(`@IsEnum(Role)`) يقبل القيمتين → `employees.service.ts:91` يخزّن القيمة، بينما `list()` يفلتر `role: Role.EMPLOYEE` (`:60`) و`update()` يعيد 404 لغير الموظفين (`:113-117`)، ولا اختبار يغطي هذه الحالة.
- **اللماذا:** ترقية الدور محكومة بالمدير (مقبولة)، لكن الحساب الناتج **لا يظهر** في الدليل الذي أُنشئ منه — تناقض صامت.
- **الإصلاح الأدنى:** رفض `role: MANAGER` في الخدمة، أو توثيق السلوك واختباره.

---

### LOW

| # | الدليل (مسار/سطر) | المشكلة | الإصلاح الأدنى | التأثير |
| --- | --- | --- | --- | --- |
| L1 | `apps/backend/src/main.ts:17-18` يضيف `'http://localhost:3000'` و`'http://192.168.1.8:3000'` بلا شرط فوق `FRONTEND_ORIGIN`؛ و`apps/frontend/next.config.ts:4` ‏`allowedDevOrigins` يكرّر نفس الـ LAN IP كسلسلة سحرية | أصل CORS صلب + تكرار قيمة | اشتقها من الإعدادات في الملفَين | ملفان |
| L2 | `apps/backend/.env.example:12` ‏`JWT_REFRESH_SECRET` لا تُقرأ أبدًا (توكن التحديث opaque في DB — `auth.service.ts:98-113`)، وJoi يسمح بمفاتيح مجهولة | متغير ميت يُضلّل | حذف السطر | ملف واحد |
| L3 | `property-serializer.ts:170` يُعيد `responsibleName` (اسم الشخص) لكل المشاهدين، بينما `property.dto.ts:60-67` يوثّق أن الواجهة تعرض **pill دور** «بدلًا من كشف اسم المدير الشخصي» | تعارض توثيق/سلوك على مستوى الخصوصية | بوّبة الدور أو توثيق القرار صراحةً — **انتبه لاختبارات الـ contract** | استجابات الخصائص + اختبارات |
| L4 | `features/notifications/store.ts:140-144` يبتلع كل خطأ بصمت بعد أول نجاح (‏`status` يبقى `ready`) → استجابة 401/403 متكرّرة تُبقي شارة «جاهز» قديمة بلا إشارة للمستخدم | صمت أخطاء المصادقة في منتصف الجلسة | نشر `error` أو إطلاق حدث انتهاء الجلسة عند `ApiError 401/403` | ملف `store.ts` فقط |
| L5 | `manager-properties.tsx:36` ‏`PAGE_SIZE = 100` مقابل `employee-properties-page.tsx:29` ‏`PAGE_SIZE = 50` لنفس الـ endpoint | أحجام صفحات متناقضة | ثابت مشترك | ملفان |
| L6 | `dto/create-employee.dto.ts:51-55` ‏`@Type(() => Number)` → float → Decimal، بينما `common/money.ts:4-9` يوجب ألّا يمرّ المال بالفقاعي | تجاوز سياسة المال | استخدام `@IsDecimalString()` | ملف واحد |
| L7 | `jobs.module.ts:24` يسجّل طابور `system` بلا أي `@Processor` (grep = 0) → Redis شرط إقلاع لطابور فارغ؛ و`app.module.ts:34-48` وحدات صورية فارغة (`users/clients/owners/deals/commissions/payroll/finance/attendance/followups/smart-paste`)؛ و`Property.createdById/ownerId` (`schema.prisma:241-246`) و`Notification.clientId/ownerId/dealId/followUpId/payrollEntryId` (`:538-547`) بلا أي كتابة في `src/` | مساحة سطح ميتة | حذف/توثيق عند دمج الميزات التالية | لا يمسّ السلوك |
| L8 | `properties.service.ts:100` يكتب بايتات الصورة **قبل** الـ transaction، والتعويض شرط `catch` فقط (`:195-199`)، ولا يوجد جارٍ لتنظيف اليتامى (`files.service.ts:105-112` يشير إلى «تقرير الطور» لكن بلا processor) | **خطر محتمل:** crash بين الحفظ والـ commit يترك ملفًا بلا سجل | جارٍ تنظيف عند الإقلاع يقارن مفاتيح التخزين بـ `FileAsset.key` | `files`/`properties` |
| L9 | `POST /properties` بلا idempotency (`properties.service.ts:860-874`) — الإرسال المزدوج ينشئ عقارين؛ و`PATCH /contacts/:id` last-write-wins (`contacts.service.ts:95-105`) | **خطران محتملان** (سباق إرسال مزدوج) | رأس `Idempotency-Key` اختياري أو التقاط `P2002` على `reference` | endpoints محدّدة |
| L10 | `apps/frontend/.env.example` لا يوثّق `NEXT_PUBLIC_API_URL` المطلوب (`api-client.ts:134-135` يرمي خطأ عند غيابه) بينما `.env.local.example:1` يوثّقه | توثيق بيئة متباين → clone جديد يتعطّل | إضافة المفتاح إلى `.env.example` | مستند واحد |
| L11 | `TODO.md` (‏`## 2` ‏«الواجهة الأمامية تستدعي فقط APIs المصادقة» وبند الإشعارات/الموظفين/الاتصالات ما يزال مفتوحًا) متقادم أمام الشجرة الحالية (‏properties/employees/notifications/contacts موصولة فعلًا) | تقادم توثيقي يضللّ المطوّر التالي | مزامنة قائمة التبقّيات بعد اعتماد التغييرات | مستندات |
| L12 | exports/CSS ميتة مُتحقَّق منها: `components/ui/placeholder-panel.tsx:1` (بلا مستورد)، `PropertyStatusBadge` الثاني في `employee-property-card.tsx:11-19`، `useContactList` في `lib/contact-registry.ts:169-172`، وCSS `.urgent`/`.toast` في `manager-notifications/notifications.module.css:64,90` بلا أي `styles.urgent`/`styles.toast` | بقايا من المحوّر المُحذوف `notification-priority-badge.tsx` | حذف بعد نقل `matchesPerson` (‏M6) | ملفات معزولة |

---

## تمييز: مشاكل مؤكَّدة مقابل مخاطر محتملة

**مؤكَّد بالدليل (قُرأ الكود/البنية فعليًا):** كل بنود HIGH وMEDIUM وLOW أعلاه ما عدا الحالات المُعلَّمة «محتمل»؛ غياب فهرس `propertyId` (بنية مخطط مؤكَّدة عبر قراءة `schema.prisma`); التخطّي الصامت للاختبارات (‏`test-app.ts:24` مؤكَّد، وقد أُثبت عكسه اليوم بتشغيل 169/169 بلا تخطٍّ); فشل Prettier (نُفِّذ فعليًا: 305 ملفًا).

**مخاطر محتملة (لم تُختبَر زمنيًا أو تتطلّب شرطًا):**
- H2 (استغلال سرّ المثال) يتطلّب تسريب توكن + جلسة سليمة.
- M3/M4 (أداء الاستعلام والفهارس) لن تظهر إلا مع نمو البيانات.
- M11 (سباق البريد) لم يُختبَر بتزامن فعلي.
- L8 (ملفات يتيمة) تظهر فقط عند crash في نافذة زمنية ضيقة.
- L9 (الإرسال المزدوج) لم يُختبَر بطلبات متزامنة.
- أي ادعاء عن سلوك المتصفح (مزامنة الجرس/الصفحة، تحديث بعد الإجراءات) **ليس جزءًا من هذا التدقيق** — نُفِّذ في تقارير سابقة ولم يُعاد هنا.

**لم يُختبَر/تعذّر:**
- اختبارات الواجهة الأمامية: **لا توجد أصلاً** (لا سكربت).
- فحص أداء قاعدة بيانات حقيقي (لا بيانات إنتاجية مُستخدمة، ولا تشغيل EXPLAIN).
- تحقق متصفح لهذا التدقيق (قراءة فقط).

---

## (د) أولويات الإصلاح الخمس — مرتبة بالخطر والأهمية

1. **تقوية المصادقة (H1 + H2):** إضافة `@nestjs/throttler` على `/auth/login|refresh` + رفض قيمة سرّ المثال في `.env.example` عبر `.invalid(...)` مع اختبار يفحص الملف نفسه. تغيير صغير، أثر أمني مباشر، صفر مساس بالواجهة.
2. **إيقاف تزييف الأرقام في الصفحات الحية (H3):** حذف `28 +` و`54` في `clients-page.tsx` وإيقاف دمج `createMockRecords` في `attendance-page.tsx`. ملفّان، صفر تغيير تصميمي، يستعيد صحة البيانات فورًا.
3. **تأمين شبكة الاختبار (M5):** جعل `test/support` يفشل/يتحذّر صراحةً عند غياب `TEST_DATABASE_URL` في CI. يمنع اعتماد «أخضر» زائف قبل أي إصلاح آخر.
4. **دورة حياة حساب الموظف (H4 + M11):** السماح بـ `isActive=false` في `UpdateEmployeeDto`، و التقاط `P2002` → 409، وإضافة `auditLog.create` لإنشاء/إعادة تسمية الحسابات. متسق مع كل نطاق آخر في المشروع.
5. **استعداد الأداء (M3 + M4):** تقييد استعلام `GET /employees` (‏`take`/‏`groupBy`) + فهرسا `PropertyApprovalRequest(propertyId, createdAt)` و`Property(status, createdAt)`. **الجزء الفهارسي يتطلب هجرة additive واحدة ولن تُجرى إلا بموافقة صريحة.**

*(التسلسل الآمن: 1 ← 2 ← 3 فورية بلا migration؛ 4 وحدة backend؛ 5 يحتاج موافقة على migration.)*

---

## (هـ) كود جيد — لا يُعاد كتابته

1. **`features/notifications/store.ts`** — مُتحقَّق منه: `setInterval` **الوحيد** في الواجهة كلها (`:77`)، عدّاد مرجعي للمشتركين (`:54`, `:88-98`)، حارس `generation` يمنع نشر استجابة المستخدم السابق على الجديد (`:123-129`, `:154`), قراءة/كتابة متفائلة مع إعادة مزامنة عند الفشل (`:166-201`)، قراءة cursor لا ترتدّ (`:136-138`)، و`useSyncExternalStore` بصمة خادم صحيحة (`:70-73`).
2. **`features/notifications/property-refresh.ts` + `open-property.ts`** — نشر/استهلاك بلا replay وبـ nonce (‏`requestOpenProperty`/`consumeOpenProperty`)، بلا حلقات، بعمق ربط صحيح مُتحقَّق منه من الجرس ودرج الإشعار.
3. **`features/notifications/components/notification-bell.tsx`** — حارس توست مبذور (`:56-78`)، تصفير عند تغيّر الهوية (`:62-67`)، رابط عميق واعٍ بالدور (`:153-166`).
4. **`lib/api-client.ts` + `lib/api/authorized.ts`** — `fetch` واحد، ترويسة واحدة، إلغاء بمهدة (`AbortController`)، refresh أحادي الطيران بمحاولة واحدة، ترجمة رسائل تحقق الخادم إلى العربية، والتوكن لا يُوضع أبدًا في URL.
5. **`lib/api/*.ts`** (‏properties/notifications/employees/contacts) — وحدات رقيقة لكل نطاق مع تعليقات توضّح ما يعيد الخادم تفويضه.
6. **الحارس المقيَّد بجلسة قاعدة البيانات** (`jwt-auth.guard.ts:21-60`) — يتحقق عند كل طلب: إلغاء، انتهاء، تغيّر دور، `isActive`. هذا ما يجعل H2 خطورة متوسطة لا حرجة.
7. **مساعدات الرؤية كأجزاء (fragments) داخل استعلام Prisma** (`property-visibility.ts:17-30`, `contact-policy.ts:12-16`) — افتراض fail-closed داخل `where`، مع إرجاع 404 لا يكشف (`notifications.service.ts:290`, `contacts.service.ts:128`, `properties.service.ts:732`).
8. **نظام الإشعارات الخلفي** — المستلِم من JWT لا من جسم الطلب (`notifications.controller.ts:29,36,42,50`)، قوائم أعمدة allowlist صريحة (`NOTIFICATION_SELECT` في `notifications.service.ts:22-30` و`notification.dto.ts:8-35` — تستثني `userId`)، تسليم داخل نفس الـ transaction، وفريد `@@unique([userId, eventKey])` مع `skipDuplicates` (`schema.prisma:551`, `notifications.service.ts:68`)، والنص العربي الدقيق في مكان واحد (`notification-events.ts:42-49`).
9. **آلة حالة مراجعة العقارات** — `updateMany` شرطي + قفل `version` + إعادة فحص آخر مراجعة داخل الـ transaction، مع اختبارات تزامن فعلية (`property-request-changes.spec.ts:291`, `properties.spec.ts:304`).
10. **خط أنابيب الصور** — كشف توقيع البايتات (`storage.service.ts:24-60`)، تنقية sharp مع سقوف بكسل/أبعاد وإزالة EXIF GPS وإعادة تحقّق بعد التنقية (`image-sanitizer.ts:55-129`)، حماية path traversal (`storage.service.ts:103-116`)، وعدم خدمة المفاتيح الخام أبدًا (‏URL يُبنى من `property-serializer.ts:167-169`).
11. **هيئة Validation** — `whitelist + forbidNonWhitelisted` عالمي (`common/configure-app.ts:6-12`)، DTO مكتوبة لكل `@Body/@Query`، و`ParseUUIDPipe` لكل `@Param`، و**صفر `any` وصفر `@ts-ignore`** في الواجهة كلها (‏grep مؤكَّد)، و`parseAndValidatePayload` لإعادة تحقق multipart (`common/validation/json-payload.ts:21-41`).
12. **`features/manager-employees/model.ts:44-53,75-81`** — دلالة «null ≠ 0» مع عرض «—»؛ لا أصفار مُختلقة.
13. **جودة مجموعة الاختبارات** — 169 اختبارًا على قاعدة حقيقية بـ TRUNCATE معزول (`test-app.ts:92-103`)، صور fixture حقيقية، اختبارات خصوصية EXIF/قنابل ضغط/polyglot، واختبارات تزامن. وُلّدت الحالة القصوى اليوم: **14 حزمة / 169 اختبارًا / 0 تخطّي**.

---

## (و) تقييم أمان العمل غير المُثبَّت (Git)

**الحالة وقت التدقيق:**
- فرع `main`، ‏`HEAD = ff71379` (‏«docs: prepare project developer handoff»)، 4 commits فقط في المستودع كله.
- **لا شيء في الـ staging** (`git diff --cached` فارغ)، **لا stash**، ولا تعديل على `HEAD`.
- أحجام التغيير: **‏60 ملفًا متتبَّعًا معدَّلًا/محذوفًا** (‏`+2941 / −1769` سطرًا)، من بينها حذفان: `features/manager-employees/mock-data.ts` و`features/manager-notifications/components/notification-priority-badge.tsx`.

**ملفات/مجلدات جديدة غير المُتتبَّعة (untracked) — قائمة حرجة:**
- وحدات خلفية كاملة: `src/properties/`, `src/employees/`, `src/notifications/`, `src/contacts/`, `src/files/` (+‏DTOs ومجلدات `src/common/decorators|money|pagination|text|validation`).
- **هجرتان مُنشأَتان:** `prisma/migrations/20261015100000_property_schema_expansion/` و`prisma/migrations/20261017120000_notification_events/` — **كلتاهما مُطبَّقتان بالفعل على قاعدة التطوير واختبار** (تاريخي المهام السابقة)، لكن ملفاتهما غير مُثبَّتة.
- **‏11 ملف اختبار جديد** + `test/support/`: ‏`contacts`, `employee-property-filters`, `employees`, `frontend-properties-contract`, `frontend-property-adapter`, `notifications`, `properties`, `properties-assets`, `properties-image-restart`, `properties-image-security`, `property-request-changes`.
- مكتبة واجهة: `apps/frontend/features/notifications/` (‏store/view/bell/open-property/property-refresh)، `apps/frontend/lib/api/`، `lib/contact-registry.ts`, `lib/property-*.ts`.
- `docs/reports/` كاملًا (‏24 تقريرًا + assets).

**التقييم: خطر مرتفع على استمرارية العمل.**
- أمر واحد `git reset --hard` أو `git clean -fdx` سيمحو أسابيع عمل.
- المخاطرة الأخصّ: الهجرتان غير المُثبَّتتان على قاعدة بيانات **مُطبَّقتان فعليًا** — أي حذف يدوي لملفاتهما يترك schema القاعدة ومخطط المشروع متناقضين.
- `.env` محمي بـ `.gitignore` (لا ملفات سرّ مُثبَّتة؛ الاستثناء الوحيد هو قيم المثال في `apps/backend/.env.example` — أنظر H2).
- تحذيرات `LF will be replaced by CRLF` على عشرات الملفات — تجميلية، لا تغيّر محتوى.
- `apps/frontend/AGENTS.md` غير مُثبَّت لكن تعليقه يوضّح أن `next dev` يُعيد توليده تلقائيًا؛ **يُفضَّل تثبيته مع العمل** حتى تهدأ الشجرة.

**الخطوة الآمنة التالية (بعد الموافقة، ولم تُنفَّذ):** تثبيت العمل الحالي بمنطقـيات commits مُجزّأة (backend modules + tests / frontend notifications / employees / styles / docs) **قبل** أي تنظيف، لأن حذف الكود الميت (‏M6) لا يجب أن يُمزج مع تعديلات وظيفية في نفس commit.

---

## (ز) خطة التنظيف المرحلية — دون تغيير الواجهة أو السلوك

**المرحلة 0 — الأمان (قبل أي شيء):** تثبيت الشجرة الحالية بcommits مُجزّأة *(بعد الموافقة)*؛ جعل اختبارات قاعدة البيانات تفشل/تتحذّر عند غياب `TEST_DATABASE_URL` (‏M5).

**المرحلة 1 — صحة البيانات (ملفّان، صفر تصميم):** حذف إزاحة `28` والرقم `54` في `clients-page.tsx`؛ إيقاف دمج `createMockRecords` في `attendance-page.tsx` (‏H3).

**المرحلة 2 — تقوية الأمان:** `throttler` + رفض سرّ المثال (‏H1/H2)؛ `isActive` قابل للتعطيل + التقاط `P2002` + `auditLog` (‏H4/M11)؛ مسح المسوّدات وبقايا `open-property` عند `signOut` (‏M9)؛ نشر حالة خطأ في مخزن الإشعارات عند 401/403 (‏L4).

**المرحلة 3 — حذف الكود الميت (≈1000 سطر):** نقل `matchesPerson` إلى `lib/search.ts` أولًا (‏M6) ثم حذف سلاسل المعالجات الميتة في `employee-properties` و`employee-clients/request-wizard`، ثم exports/CSS الميتة (‏L12).

**المرحلة 4 — تجميع ميكانيكي (بلا أي تغيير بصري):** نقل التبويبات إلى `components/ui/`؛ حقن `usePropertyList` مشترك؛ استخراج `assertPendingTransition`/`readLatestApproval` خلفيًا وتوحيد `canViewContact`؛ تقسيم `new-property-modal-v2` (‏M1/M2/M7/M10). كل دفحة بمراجعة `npm run build` + مجموعة الـ169 اختبارًا.

**المرحلة 5 — الأداء (تتطلب موافقة على migration إضافي):** فهرسا `PropertyApprovalRequest.propertyId` و`Property(status, createdAt)` + تقييد استعلام `GET /employees` (‏M3/M4).

**المرحلة 6 — تحويل mock → API (قرار منتج، الأوسع نطاقًا):** الحضور أولًا (يلزم backend حقيقي بدل `nfc-store`)، ثم العملاء/المتابعات، ثم الصفقات/المالية/اللوحات — مع **الإبقاء على اللافتات الشفافة** حتى يكتمل كل اتصال. البدء بـ TODO.md المُحدَّث كمصدر نطاق.

**خارج الخطة (اختياري، غير موصى به الآن):** دمج كروت/مخططات Manager+Employee في مكوّنات مشتركة — يوفّر ~15 قاعدة CSS لكنه يمسّ المظهر المعتمد، فلا يُنفَّذ إلا باعتماد صريح.

---

## (ط) حالة التقرير

| البند | الحالة |
| --- | --- |
| نطاق التدقيق والقيود | `Completed` |
| أوامر التحقق (typecheck/lint/build/jest) | `Completed` — كلها ناجحة عدا `format:check` |
| تصنيف المشكلات (‏0 حرجة / 4 عالية / 12 متوسطة / 12 منخفضة) | `Completed` |
| أوائل الإصلاح الخمس + خطة مرحليات | `Completed` |
| تقييم أمان Git/العمل غير المُثبَّت | `Completed` |
| تنفيذ أي إصلاح | **`Not Implemented` (بانتظار الموافقة)** |
| تحقق متصفح لهذا التدقيق | **`Not Tested`** |
| اختبارات واجهة أمامية | **`Not Implemented` (لا توجد بنية اختبار أصلًا)** |
| أي migration أو تعديل قاعدة بيانات | **لم يُجرَ** |

> هذا تقرير تدقيق وتوثيق فقط: لم يُعدَّل أي كود تطبيقي، ولم تُغيَّر قاعدة بيانات أو واجهة أو اعتمادات أو إعدادات، ولم يُنفَّذ أي commit.
