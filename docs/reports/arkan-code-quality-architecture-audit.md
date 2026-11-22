# تدقيق جودة الكود والهندسة — Arkan CRM

**التاريخ:** 2026-11-12
**الالتزام المدقق:** `71701e5` (HEAD = origin/main)
**النوع:** تدقيق للقراءة فقط — لم يُعدّل أي كود تطبيق أو اختبار أو قاعدة بيانات.

---

## 1. الملخص التنفيذي

المشروع **مبني بجودة أعلى من المتوسط** مقارنة بحجمه: فصل واضح بين الواجهة والخادم، حُرّاس صلاحيات على الخادم، معاملات مالية ذرية بدقة `Decimal(15,3)`, تغطية اختبارات قوية (95 حزمة / 886 اختباراً)، وتصميم واجهة عربي RTL متماسك.

**لا توجد ثغرة تطبيقية حرجة مؤكدة** في مسارات المصادقة أو الصلاحيات أو الماليات. لكن المشروع **ليس جاهزاً للنشر على VPS كما هو** لثلاثة أسباب رئيسية:

1. **شاشات الحضور تعرض بيانات وهمية/محلية** كأنها حقيقية، ولا يوجد حفظ خادمي.
2. **أداة الاختبارات تفرّغ أي قاعدة بيانات** دون التحقق من اسمها، ما قد يمحو بيانات `arkan_crm` عند خطأ إعداد.
3. **إعدادات النشر المرفقة غير آمنة/غير مكتملة**: PostgreSQL مكشوف بكلمة مرور افتراضية، وبناء الواجهة لا يضبط وضع المصادقة/CSP، ولا يوجد تخزين دائم لصور العقارات.

**الحكم:** `READY AFTER SPECIFIC FIXES`

| الشدة | العدد |
|---|---|
| CRITICAL | **0** |
| HIGH | **5** |
| MEDIUM | **6** |
| LOW | **6** |

---

## 2. نظرة معمارية عامة

- **Monorepo** عبر npm workspaces: `apps/backend`, `apps/frontend`, `packages/shared`.
- **Backend:** NestJS 11، 22 خدمة و15 controller، حُرّاس عالميون (JWT، Roles، CSRF، Throttler)، `ValidationPipe` مع `whitelist/forbidNonWhitelisted`، فلتر أخطاء موحّد، وPrisma/PostgreSQL.
- **Frontend:** Next.js 16 App Router، 77 مكوّناً بـ`'use client'`، منطق أعمال في خدمات/موديلات نقية، وعملاء API مركزيون (`api-client.ts`, `authorized.ts`).
- **Database:** 26 ترحيلاً، فهارس مطابقة لاستعلامات القوائم، قيود فريدة للماليات والإشعارات، وsoft-delete للعقارات.
- **Shared:** عقود الاستجابة المشتركة فقط؛ لا ازدواج في منطق الأعمال.

نقاط القوة المعمارية:
- سياسات الصلاحيات مركزية في `common/access/access-policy.ts` بدلاً من شروط متفرقة.
- الماليات داخل معاملات (`Deal` + `Commission` + `FinanceMovement`) مع `@@unique([sourceType, sourceId])`.
- الجلسات: Cookie HttpOnly + CSRF مزدوج + Origin/Fetch-Metadata + تدوير Refresh + `authVersion`.
- رفع الصور: تحقق من البايتات وإعادة ترميز وإزالة metadata، وقراءة الصور بنفس سياسة رؤية العقار.
- Web Push: قائمة مضيفين صريحة + منع IPs الخاصة عند التسجيل وعند الاتصال (SSRF).

---

## 3. نقاط قوة مؤكدة

1. **الصلاحيات على الخادم**: لا توجد فحوص دور على الواجهة فقط؛ `RolesGuard` + استعلامات مقيّدة بالنطاق.
2. **عزل بيانات الفرق**: اختبارات 403/404 في 32 ملف اختبار، وتغطية لانتقال الموظف وملكية المراجعة.
3. **الدقة المالية**: لا استخدام لأرقام عشرية عائمة في الماليات؛ تحقق من 3 خانات عشرية واختبارات `1.234` و`0.001`.
4. **منع التكرار**: معاملة إنشاء الصفقة تستخدم `updateMany({status: AVAILABLE})` ذرياً، والدفع يستخدم claim ذرياً + فهرس فريد.
5. **جودة الاختبارات الوظيفية**: 95 حزمة / 886 اختباراً، منها تزامن و403/404 وسياسات خصوصية.
6. **لا unsafe SQL**: كل `$queryRaw`/`$executeRaw` تستخدم `Prisma.sql` أو tagged template بمعاملات، ولا يوجد `$queryRawUnsafe` في كود الإنتاج.
7. **أمان الجلسة**: لم يُعثر على تخطي لـCSRF في مسارات cookie، و`403` لا يُعامَل كخطأ جلسة.
8. **الديسيبل**: فهارس فعلية على `Deal.closedAt`, `Commission.employeeId/status`, `Notification.userId/...`, و`Property.reference` prefix index.

---

## 4. النتائج المؤكدة بالأدلة

### F1 — شاشات الحضور تعرض بيانات وهمية/محلية كأنها إنتاجية

- **الشدة:** HIGH
- **التصنيف:** Confirmed defect / بيانات مضللة
- **الملفات:**
  - `apps/frontend/features/manager-attendance/components/attendance-page.tsx:25` — `useState(createMockRecords)`
  - `.../attendance-page.tsx:34-42` — دمج السجلات الوهمية مع المحلية وعرضها
  - `apps/frontend/features/manager-attendance/attendance-model.ts:93` — توليد 8 أيام × موظفين وهميين
  - `apps/frontend/features/employee-attendance/nfc-store.ts:2,68-70` — التخزين في `localStorage` فقط
  - `apps/frontend/components/layout/manager/navigation.ts:28-33` و`.../employee-navigation.tsx:39` — المسارات ظاهرة في التنقل
- **الأثر:** المدير يرى سجلات حضور fabricated؛ الموظف يسجل حضوراً في متصفحه فقط، ويفقده عند تغيير المتصفح/الجهاز، ولا يوجد AuditLog أو تحقق خادمي. الشاشة تبدو كميزة مكتملة.
- **إعادة الإنتاج:** تسجيل دخول مدير → «الحضور والانصراف» → تظهر سجلات عينة. أو موظف → تسجيل حضور يدوي → البيانات تبقى في `localStorage`.
- **الإصلاح الأدنى:** إخفاء المسارين من التنقل/الراوت وإزالة `createMockRecords` حتى تنفيذ backend حضور فعلّال. تنفيذ الحضور الحقيقي = تغيير كبير.
- **يمنع النشر؟** نعم إن كانت الحضور ضمن نطاق الإطلاق. الحل الصغير (إخفاء) يمنع الخطر فوراً.
- **الثقة:** عالية.

### F2 — `resetDatabase` يفرّغ أي قاعدة بيانات دون التحقق من اسمها

- **الشدة:** HIGH
- **التصنيف:** Confirmed defect / خطر فقدان بيانات
- **الملف:** `apps/backend/test/support/test-app.ts:89-92` و`:149-160`
- **الأثر:** `createTestApp` يضع `DATABASE_URL = TEST_DATABASE_URL`، ثم `resetDatabase` ينفذ `TRUNCATE TABLE ... CASCADE` على كل جداول `public` دون `SELECT current_database()`. أي إعداد خاطئ لـ`TEST_DATABASE_URL` نحو `arkan_crm` يمحو بيانات الشركة الحقيقية.
- **إعادة الإنتاج:** تعيين `TEST_DATABASE_URL` إلى قاعدة الإنتاج/التطوير ثم تشغيل أي اختبار تكامل.
- **الإصلاح الأدنى:** قبل TRUNCATE:
  `SELECT current_database()` ويُرفض أي اسم غير `arkan_crm_api_test`، مع رفض URL لا يطابق الاسم.
- **يمنع النشر؟** نعم كإجراء سلامة إلزامي قبل CI/VPS.
- **الثقة:** عالية.

### F3 — PostgreSQL مكشوف بكلمة مرور افتراضية في `docker-compose.yml`

- **الشدة:** HIGH
- **التصنيف:** Confirmed deployment defect
- **الملف:** `docker-compose.yml:8-15`
- **الأثر:** `POSTGRES_PASSWORD: postgres` + `ports: "5433:5432"` ينشر قاعدة البيانات على كل واجهات المضيف ببيانات دخول معروفة. على VPS عام = تعرّض مباشر للبيانات.
- **إعادة الإنتاج:** تشغيل `docker compose up` على خادم عام ثم الاتصال بالمنفذ 5433.
- **الإصلاح الأدنى:** ربط المنفذ بـ`127.0.0.1` أو إزالته، وكلمة مرور من secret/env غير متتبعة، وعدم استخدام هذا الملف كإعداد إنتاج.
- **يمنع النشر؟** نعم.
- **الثقة:** عالية.

### F4 — مسار بناء الواجهة لا يضبط وضع المصادقة/CSP، ويُثبّت API افتراضي على localhost

- **الشدة:** HIGH
- **التصنيف:** Confirmed deployment/security defect
- **الملفات:**
  - `docker/frontend.Dockerfile:11-14` — `ARG NEXT_PUBLIC_API_URL=http://localhost:4000` فقط
  - `apps/frontend/lib/auth-mode.ts:8-15` — أي قيمة غير dual/cookie تعود إلى **legacy**
  - `apps/frontend/lib/csp.ts:150-170` — غياب `CSP_MODE` = **off**
  - `apps/frontend/.env.local.example` — القيم الافتراضية legacy/report-only
- **الأثر:** بناء الصورة القياسي دون تمرير arg يضع `http://localhost:4000` في حزمة المتصفح → فشل الاتصال على VPS. ولا توجد ARG لـ`NEXT_PUBLIC_AUTH_MODE` أو `CSP_MODE`، لذلك الصورة قد تعمل بـlegacy (تخزين التوكنات في JS) وCSP معطّل حتى مع ضبط متغيرات runtime.
- **إعادة الإنتاج:** `docker build -f docker/frontend.Dockerfile .` بدون build args ثم فحص الحزمة/السلوك.
- **الإصلاح الأدنى:** إضافة ARGs وENV للثلاثة، وإلزام قيم إنتاج آمنة في سكربت النشر؛ إبقاء CSP report-only مؤقتاً مسموح لكن يجب أن يكون قراراً واعياً.
- **يمنع النشر؟** نعم كإعداد أمني/تشغيلي.
- **الثقة:** عالية.

### F5 — مجلد صور العقارات غير مغطى بتخزين دائم في إعداد النشر

- **الشدة:** HIGH
- **التصنيف:** Confirmed deployment/data-loss risk
- **الملفات:**
  - `apps/backend/src/files/storage.service.ts:73-78` — الافتراضي `<home>/.arkan-crm/storage`
  - `docker-compose.yml` — لا توجد خدمة backend ولا volume تخزين
- **الأثر:** إذا عمل backend في حاوية دون `STORAGE_ROOT` على volume دائم، تُفقد صور العقارات عند إعادة النشر، بينما تبقى صفوف `FileAsset` في قاعدة البيانات → صور مكسورة وفقدان مستندات.
- **إعادة الإنتاج:** تشغيل backend في حاوية افتراضية، رفع صورة، إعادة إنشاء الحاوية.
- **الإصلاح الأدنى:** `STORAGE_ROOT` على volume/fuse، ونسخ احتياطي دوري، واختبار استعادة.
- **يمنع النشر؟** نعم.
- **الثقة:** عالية.

### F6 — ملخصات Finance تُقرأ كل صفوف الدفتر في كل صفحة

- **الشدة:** MEDIUM
- **التصنيف:** Confirmed performance issue
- **الملفات:** `apps/backend/src/finance/finance.service.ts:266-290`، و`apps/frontend/features/manager-finance/components/finance-page.tsx:94-107`
- **الأثر:** كل طلب صفحة يجلب **كل** الحركات المطابقة (بلا `take`) لحساب الملخصات في Node، والواجهة تعيد الطلب حتى 1000 صف. النمو الخطي في الدفتر يضاعف الذاكرة/زمن الاستجابة لكل صفحة.
- **إعادة الإنتاج:** زيادة حركات Finance ثم فتح الصفحة/تغيير الفلتر.
- **الإصلاح الأدنى:** تجميع الملخصات في SQL (`groupBy`/`SUM`) أو endpoint ملخص منفصل، وإرجاعه مرة واحدة.
- **يمنع النشر؟** لا عند ~20 موظفاً، لكنه يقترب من الحد مع نمو الدفتر.
- **الثقة:** عالية.

### F7 — تحميل كل الصفقات وخيارات المعالج بلا حدود

- **الشدة:** MEDIUM
- **التصنيف:** Confirmed performance issue
- **الملفات:**
  - `apps/frontend/features/manager-deals/use-deals.ts:34-42` — حلقة تجلب كل صفحات الصفقات
  - `apps/backend/src/deals/deals.service.ts:487-517` — كل العقارات وكل العملاء في `/deals/options` بلا `take`
  - `apps/frontend/features/manager-properties/components/property-details-drawer.tsx:87-107` — مسح كل الصفقات للعثور على صفقة العقار
- **الأثر:** فتح صفحة الصفقات أو درج عقار مباع قد يطلق عشرات الطلبات المتتابعة مع نمو البيانات. `/deals/options` يعيد كل العملاء رغم وجود `client-options` مُرقّم بالفعل.
- **إعادة الإنتاج:** 5000 صفقة/عميل ثم فتح الصفحة/الدرج ومراقبة الشبكة.
- **الإصلاح الأدنى:** pagination/إحصاءات من الخادم، إزالة العملاء من `/deals/options`، وإضافة `propertyId` filter لربط الصفقة.
- **يمنع النشر؟** لا.
- **الثقة:** عالية.

### F8 — `recommendationCandidates` يعيد كل العملاء المؤهلين بلا حد

- **الشدة:** MEDIUM
- **التصنيف:** Confirmed performance issue (by design)
- **الملف:** `apps/backend/src/clients/clients.service.ts:567-595`
- **الأثر:** يجلب كل عميل لديه `requestData` مع كامل سلسلة JSON للمطابقة. مع آلاف العملاء يصبح الحجم/الذاكرة كبيراً، ويُعاد الحساب في الواجهة.
- **إعادة الإنتاج:** آلاف العملاء مع طلبات منظمة ثم فتح توصيات العميل.
- **الإصلاح الأدنى:** إرجاع المرشحين الأفضل من الخادم أو حد أعلى/دفعات.
- **يمنع النشر؟** لا.
- **الثقة:** عالية.

### F9 — ملفات خدمة/مكوّن ضخمة ترفع مخاطر التغيير

- **الشدة:** MEDIUM
- **التصنيف:** Architectural risk
- **الأدلة:** `properties.service.ts` **2474** سطراً، `followups.service.ts` **2117**، `client-reviews.service.ts` **1052**، `clients.service.ts` **1112**، `new-property-modal-v2.tsx` **1579**، `property-adapter.ts` **768**.
- **الأثر:** تركيز مسؤوليات متعددة (إنشاء/مراجعة/حذف/صور/قراءة) في خدمة واحدة يرفع احتمال التعارض والانحدار عند التعديل، ويصعّب المراجعة. لا يوجد دليل على خطأ حالي بسببه.
- **الإصلاح الأدنى:** استخراج خدمات فرعية/مساعدات نقية عند أول تعديل وظيفي، لا مجرد تقسيم شكلي.
- **يمنع النشر؟** لا.
- **الثقة:** عالية (قياس مباشر).

### F10 — اعتماديات بها تحذيرات أمنية عالية (أدوات Prisma)

- **الشدة:** MEDIUM
- **التصنيف:** Confirmed dependency exposure (build/CLI)
- **الدليل:** `npm audit --omit=dev --audit-level=high` أعاد **3 high** عبر `deepmerge-ts` داخل `prisma`/`@prisma/config` (الإصلاح يتطلب Prisma 7، تغيير كاسر).
- **الأثر:** لا يوجد مسار runtime ظاهر يستدعي دمج كائنات غير موثوقة عبر Prisma CLI؛ الخطر الأساسي على أدوات البناء/CI وليس على طلبات التطبيق. لا يُنصح بـ`npm audit fix --force` قبل اختبار ترقية كاسرة.
- **الإصلاح الأدنى:** خطة ترقية Prisma 7 في نافذة منفصلة، أو قبول مؤقت موثّق بعد تقييم عدم التعرض.
- **يمنع النشر؟** لا، بشرط عدم تشغيل Prisma CLI على مدخلات غير موثوقة.
- **الثقة:** متوسطة.

### F11 — اختبار الهيكل فشل مرة واحدة بشكل عابر ثم نجح

- **الشدة:** MEDIUM
- **التصنيف:** Confirmed test reliability issue
- **الدليل:** أثناء التحقق النهائي، فشل `owner-manager-employee-hierarchy.spec.ts` مرة واحدة في تشغيل كامل (login cookie أعاد 500)، ثم نجح منفرداً **12/12** ونجحت الحزمة الكاملة **886/886** في إعادة التشغيل.
- **الأثر:** احتمال تقلّب CI، وإخفاء خطأ حقيقي لاحقاً. لم يُحدد السبب الجذري في هذه الجولة.
- **إعادة الإنتاج:** غير مؤكدة (1 من 3 تشغيلات كاملة).
- **الإصلاح الأدنى:** تسجيل استجابة 500/stack في الاختبار، وثبات إعداد rate-limit/الخادم، وإعادة المحاولة مع تشخيص.
- **يمنع النشر؟** لا، لكنه يضعف الثقة في بوابة الاختبار.
- **الثقة:** متوسطة.

### F12 — اقتران واجهة بين شرائح manager/employee

- **الشدة:** LOW
- **التصنيف:** Architectural risk / maintainability
- **الملفات:**
  - `apps/frontend/features/employee-clients/components/employee-clients-page.tsx:50-52` يستورد مكوّنات `manager-clients`
  - `apps/frontend/features/employee-notifications/components/employee-notifications-page.tsx:13,16` يستورد بطاقة/CSS `manager-notifications`
  - `apps/frontend/features/employee-dashboard/components/employee-dashboard-page.tsx:9` يستورد `PropertyOverlay` من `manager-properties`
- **الأثر:** حدود الميزات غير واضحة؛ تعديل ميزة مدير قد يكسر ميزة موظف، ويصعب تحديد الملكية.
- **الإصلاح الأدنى:** نقل العناصر المشتركة (Overlay/NotificationCard) إلى `components/` أو `features/shared`.
- **يمنع النشر؟** لا.
- **الثقة:** عالية.

### F13 — كود ميت/وحدات فارغة

- **الشدة:** LOW
- **التصنيف:** Improvement
- **الملفات:**
  - `apps/frontend/features/employee-notifications/components/employee-notification-card.tsx` — لا يوجد أي مستورد (بقيت نسخة قديمة بعد توحيد البطاقة)
  - `apps/backend/src/app.module.ts:11,15-16,18,23` — `OwnersModule`, `CommissionsModule`, `PayrollModule`, `AttendanceModule`, `SmartPasteModule` وحدات فارغة (`@Module({})`)
- **الأثر:** تشويش عند البحث، وإيهام بوجود ميزات خلفية غير منفذة.
- **الإصلاح الأدنى:** حذف البطاقة غير المستخدمة ووحدات placeholder أو توثيقها صراحة.
- **يمنع النشر؟** لا.
- **الثقة:** عالية.

### F14 — بطاقة الإشعار القابلة للنقر ليست عنصراً وصولياً كاملاً

- **الشدة:** LOW
- **التصنيف:** Accessibility defect
- **الملف:** `apps/frontend/features/manager-notifications/components/notification-card.tsx:20-23,54-58`
- **الأثر:** `<Card>` هو `<section>` مع `onClick` فقط، بلا `role="button"`/`tabIndex`/`onKeyDown`؛ مستخدم الكيبورد يعتمد على زر «التفاصيل» الداخلي فقط. الوظيفة متاحة لكن تجربة الوصول ناقصة.
- **الإصلاح الأدنى:** جعل الغلاف `<button>` أو إضافة دور/لوحة مفاتيح مع إبقاء زر التفاصيل.
- **يمنع النشر؟** لا.
- **الثقة:** عالية.

### F15 — غياب E2E/CI/coverage gates

- **الشدة:** LOW
- **التصنيف:** Test/Release improvement
- **الدليل:** 95 حزمة اختبار و18 اختبار واجهة منطقية، لكن لا توجد ملفات E2E/Playwright/Cypress، ولا `.github/workflows`، ولا سكربت coverage.
- **الأثر:** لا توجد بوابة آلية تمنع push يكسر typecheck/build/tests، والواجهات الحرجة (login cookie/CSRF/صور/دفع) لا تُختبر في متصفح حقيقي.
- **الإصلاح الأدنى:** CI يشغّل `check` + `test` + `build`، واختبارات دخان متصفح لمسارات المصادقة والصور.
- **يمنع النشر؟** لا، لكنه مطلوب قبل فريق أكبر.
- **الثقة:** عالية.

### F16 — مراقبة/تسجيل محدودان

- **الشدة:** LOW
- **التصنيف:** Improvement
- **الدليل:** `apps/backend/src/common/filters/api-exception.filter.ts:50-54` يسجل stack للأخطاء 500 فقط، ولا يوجد request-id أو structured logging أو metrics.
- **الأثر:** تشخيص بطء/أخطاء الإنتاج على VPS سيكون يدوياً من السجلات.
- **الإصلاح الأدنى:** request-id + slog JSON + health/metrics أساسية.
- **يمنع النشر؟** لا.
- **الثقة:** عالية.

### F17 — بعض `as unknown as` وتكرار بطاقات

- **الشدة:** LOW
- **التصنيف:** Improvement
- **الدليل:** 13 استخداماً لـ`as unknown as` (أغلبها JSON snapshots/Node adapters)، واستخدام `any` واحد فقط في `typewriter-text.tsx:25`، ولا `@ts-ignore`. تكرار بطاقات العقار بين manager/employee موجود لكنه مبرر جزئياً باختلاف الصلاحيات.
- **الأثر:** مخاطر أنواع منخفضة عند تغيير شكل JSON أو إعدادات Node.
- **الإصلاح الأدنى:** مخططات Zod/type guards للـJSON عند أول تعديل، وتوحيد البطاقات فقط إن ثبت تطابق السلوك.
- **يمنع النشر؟** لا.
- **الثقة:** عالية.

---

## 5. تقييم Backend

**إيجابيات مؤكدة:**
- الحُرّاس عالميون والصلاحيات مفحوصة على الخادم؛ لا اعتماد على قيم العميل.
- `ValidationPipe` يمنع الحقول غير المعروفة، وDTOs صارمة.
- `JwtAuthGuard` يقرأ الجلسة الحية + `authVersion` + الدور + التفعيل في استعلام واحد.
- معاملة إنشاء الصفقة تعالج الحالة والعمولات والدفتر والتدقيق معاً.
- دفع العمولة idempotent مع حركة مالية واحدة وإشعار واحد داخل نفس المعاملة.
- الصور وWeb Push عليهما تحقق أمني متين.

**نقاط ضعف:**
- خدمات ضخمة (F9).
- قراءات غير محدودة في Finance/Deals/Recommendations (F6–F8).
- لا request IDs/metrics (F16).
- أداة اختبار خطرة عند سوء الإعداد (F2).

لا توجد أدلة على تجاوز صلاحيات أو تسريب بيانات عبر API في الكود الحالي؛ الاختبارات السلبية تغطي ذلك جيداً.

---

## 6. تقييم Frontend

**إيجابيات:**
- Client/server boundaries واضحة نسبياً: الصفحات server، التفاعل في feature components.
- عميل API مركزي: Cookie + CSRF + refresh واحد فقط عند 401.
- حالات تحميل/فراغ/خطأ موجودة في القوائم والدرجات.
- مشاركة store الإشعارات تمنع polling مكرراً، وتتوقف في التبويب المخفي.
- تصميم RTL/Astra متماسك، والبطاقات/الحالات تعرض الحالة الحقيقية.

**نقاط ضعف:**
- Attendance mock (F1) أخطر مشكلة وظيفية.
- مكوّنات ضخمة (new-property-modal 1579 سطراً) (F9).
- اقتران manager/employee (F12).
- بعض الوصولية الناقصة (F14).
- تحميل كل الصفقات/الخيارات (F7).
- بناء الإنتاج يحتاج ضبط auth/CSP/API (F4).

لا توجد أدلة على مشكلة أداء إنتاجية عامة بسبب Next.js dev compilation؛ القياسات المتاحة تخص التطوير ولا تُسقط على production.

---

## 7. تقييم قاعدة البيانات وPrisma

**إيجابيات:**
- 26 ترحيلاً متسلسلاً، والثلاثة الأخيرة additive فقط مع rollback.
- فهارس مطابقة: `Property(reference ops text_pattern_ops)`, `Deal(closedAt)`, `Commission(employeeId,status)`, `Notification(userId,eventKey)` فريد.
- `Decimal(15,3)` لكل الماليات، و`@@unique([sourceType,sourceId])` لمنع ازدواج الدفتر.
- `@@unique([employeeId, period])` للرواتب، و`@@unique([userId,eventKey])` للإشعارات.
- soft-delete مع `deletedAt` وفهارس، وعلاقات `Restrict` تحمي السجلات التاريخية.

**نقاط ضعف/مخاطر:**
- `resetDatabase` لا يتحقق من اسم القاعدة (F2) — الأخطر.
- بعض الاستعلامات غير محدودة (F6–F8).
- `Client.phone` ليس فريداً؛ التكرار ممنوع إجرائياً عبر المراجعات وليس بقيد DB. لم يُصنّف عيباً مؤكداً لأن الأعمال قد تسمح بتكرار أرقام.
- لا migrations لتخزين الحضور (لأن الميزة mock) (F1).

---

## 8. تقييم الأمان

**مؤكد وقوي:**
- Cookie HttpOnly + SameSite=Lax + Secure في الإنتاج، وCSRF مزدوج + Origin/Referer + Sec-Fetch-Site.
- رفض الجلسات القديمة بعد تغيير الدور/التعطيل (`authVersion`).
- Rate limiting على login/refresh/global/upload/push، مع Redis اختياري.
- رفع الصور: 5MB، فحص بايتات، إزالة metadata، تخزين خاص، وقراءة بنفس صلاحية العقار.
- Web Push SSRF allowlist + DNS/IP validation.
- لا أسرار متتبعة، وبيئة الإنتاج ترفض JWT الافتراضي/القصير.

**مخاطر نشر (وليست ثغرات تطبيقية):**
- compose DB exposure/default creds (F3).
- frontend build legacy/CSP off/localhost (F4).
- storage volume (F5).
- HSTS/reverse proxy/TLS/trust proxy غير موثقة في المستودع؛ يجب ضبطها على VPS.
- `npm audit` high في أداة Prisma (F10).

---

## 9. تقييم جودة الاختبارات

**قوي:**
- 95 حزمة، 886 اختباراً، تشغيل `--runInBand`.
- تغطية سلبية واسعة (403/404) وتزامن (`Promise.all`) وماليات/خصوصية/جلسات.
- Integration tests تستخدم قاعدة اختبار حقيقية لا mocks فقط.
- وجود اختبارات نموذج واجهة (18 ملف frontend-*).

**ضعيف:**
- لا تحقق من اسم قاعدة الاختبار قبل TRUNCATE (F2).
- لا E2E/متصفح، ولا CI، ولا coverage thresholds.
- Attendance بلا أي اختبار backend.
- فشل عابر واحد غير مفسر (F11).

---

## 10. تقييم الأداء وقابلية التوسع

- **~20 موظفاً:** البنية الحالية كافية؛ الفهارس والاستعلامات المجمّعة (employees/dashboard/followups) جيدة.
- **Finance:** كل صفحة تقرأ كل الحركات للملخصات — أول ما سيتأثر بالنمو (F6).
- **Deals:** تحميل كل الصفقات/الخيارات وعملاء المعالج (F7).
- **Recommendations:** كل العملاء في الذاكرة (F8).
- **إشعارات:** polling مشترك 15 ثانية + إيقاف عند إخفاء التبويب — جيد.
- **بحث/ترقيم:** cursor pagination مستخدم في معظم القوائم، مع فهارس مناسبة.
- **Redis:** rate limiting memory افتراضياً؛ على نسخة واحدة لا مشكلة. تعدد النسخ يتطلب `RATE_LIMIT_STORAGE=redis`.
- **Pool:** Prisma default؛ 20 مستخدماً لا يستدعي ضبطاً خاصاً، لكن `connection_limit` يجب مراجعته مع reverse proxy/instances.

---

## 11. يجب إصلاحه قبل VPS (A)

| # | البند | الشدة | الجهد |
|---|---|---|---|
| A1 | إخفاء/تعطيل شاشات الحضور الوهمية أو تنفيذ حضور خادمي حقيقي | HIGH | Small (إخفاء) / Large (تنفيذ) |
| A2 | إضافة تحقق `current_database() = arkan_crm_api_test` قبل `resetDatabase` | HIGH | Small |
| A3 | إعداد نشر آمن: عدم كشف 5433، كلمة مرور من secret، شبكة خاصة | HIGH | Small |
| A4 | ضبط بناء الواجهة: `NEXT_PUBLIC_API_URL` إلزامي، `NEXT_PUBLIC_AUTH_MODE=cookie/dual`، `CSP_MODE` واعٍ | HIGH | Small/Medium |
| A5 | `STORAGE_ROOT` على volume دائم + نسخ احتياطي/استعادة للصور | HIGH | Small |
| A6 | TLS/HSTS/reverse proxy/TRUST_PROXY + نشر backend/frontend ضمن إعداد إنتاج موثق | HIGH | Medium |

> A3–A6 يمكن تنفيذها كحزمة نشر واحدة قبل الإطلاق. لا تتطلب تغيير كود التطبيق عدا ARGs/إعدادات.

---

## 12. تحسينات آمنة للتأجيل (B/C)

### B — يُفضّل قريباً
- تجميع ملخصات Finance في SQL (Medium).
- إزالة العملاء من `/deals/options` وإضافة pagination/فلتر `propertyId` (Medium).
- حد/ترتيب خادمي لـ`recommendationCandidates` (Medium).
- تقسيم `properties.service` و`followups.service` عند أول تعديل وظيفي (Large).
- خطة ترقية Prisma 7 لمعالجة `deepmerge-ts` (Medium).
- تثبيت اختبار الهيكل العابر (Small/Medium).
- استخراج المكوّنات المشتركة بين manager/employee (Medium).

### C — آمن للتأجيل
- حذف بطاقة `EmployeeNotificationCard` والوحدات الفارغة (Small).
- تحسين وصولية بطاقة الإشعار (Small).
- request-id/structured logging/metrics (Medium).
- CI + E2E + coverage thresholds (Medium).
- تنظيف `as unknown as` وتوحيد البطاقات المكررة (Small).
- تفعيل CSP enforce لاحقاً بعد مراقبة report-only (Medium).

---

## 13. الحكم النهائي

### READY AFTER SPECIFIC FIXES

البنية الأساسية **سليمة وناضجة نسبياً**، والأمان التطبيقي في المصادقة/الصلاحيات/الماليات **قوي ومُختبر**. لا توجد ثغرة حرجة مؤكدة.

لكن **لا يُنصح بالنشر على VPS قبل**:
1. إخفاء/إصلاح الحضور الوهمي.
2. حماية أداة الاختبارات من تفريغ قاعدة الإنتاج.
3. إعداد نشر آمن (DB خاص/kلمة مرور، بناء واجهة صحيح، تخزين دائم، TLS/HSTS).

بعد هذه الإصلاحات، يمكن الإطلاق بثقة مع مراقبة Finance/Deals مع نمو البيانات، ثم تنفيذ تحسينات B تدريجياً.
