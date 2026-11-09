# مراجعة إغلاق المرحلة الأمنية الثانية

**التاريخ:** 2026-11-08  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** المراجعة الأمنية النهائية للنسخة الحالية، مع التركيز على هيكل OWNER / MANAGER / EMPLOYEE.  
**قاعدة الاختبار:** `arkan_crm_api_test` فقط.  
**قاعدة الأعمال:** `arkan_crm` — فحص قراءة فقط، دون أي تعديل.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> لا migrations أو resets أو seeds أو تعديل بيانات على `arkan_crm`.  
> لا تعديل `.env` أو `.env.local`.  
> لا commits أو pushes.  
> هذه ليست شهادة جاهزية إنتاجية؛ المشروع ما زال قيد التطوير.

---

## 1. البيئة وطريقة التحقق

- قاعدة الاختبار المعزولة: `arkan_crm_api_test` — **22 migration**.
- قاعدة الأعمال الحقيقية: `arkan_crm` — **22 migration**، وآخر ثلاث migrations هي migrations الهيكل المعروفة فقط.
- لم تُجرَ أي كتابة على بيانات الأعمال.
- الاختبارات شُغّلت عبر `createTestApp` التي تعيد توجيه `DATABASE_URL` إلى `TEST_DATABASE_URL`.
- لم تُطبع أي أسرار أو tokens أو بيانات شخصية في هذا التقرير.

---

## 2. نتائج الاختبارات

### 2.1 المجموعة الأمنية المركزة

الأمر:

```powershell
npm run test -w @arkan/backend -- `
  test/owner-manager-employee-hierarchy.spec.ts `
  test/role-change-session-revocation.spec.ts `
  test/property-trash.spec.ts `
  test/security-task7-penetration.spec.ts `
  test/auth-cookie-mode.spec.ts `
  test/auth-refresh-database.spec.ts `
  test/properties-image-security.spec.ts `
  test/properties-upload-hardening.spec.ts `
  test/push-endpoint.spec.ts `
  test/rate-limit-policies.spec.ts `
  test/csp-policy.spec.ts `
  test/trust-proxy.spec.ts `
  test/cors-origins.spec.ts `
  test/security-hardening.spec.ts
```

**النتيجة النهائية: 14/14 حزمة ناجحة — 128/128 اختبارًا ناجحًا — 0 فشل.**

### 2.2 فحوص مساندة

| الفحص | النتيجة |
|---|---|
| `npm run typecheck -w @arkan/backend` | 0 أخطاء |
| `npm run typecheck -w @arkan/frontend` | 0 أخطاء |
| ESLint على ملفي الاختبار المعدلين | 0 أخطاء |
| ESLint على صفحات/إعدادات الإدارة المعدلة | 0 أخطاء |
| `npm run csp:verify -w @arkan/frontend` | ناجح — 27 route / 29 hash / رأس 2055B |
| `npm run csp:test -w @arkan/frontend` | 8/8 ناجح |
| `npm audit --omit=dev` | 3 high — سلسلة Prisma/deepmerge-ts فقط |

### 2.3 تحديثات الاختبارات المطلوبة

- `security-task7-penetration.spec.ts`: كان يفترض أن MANAGER يستطيع نقل عقار إلى Trash، وهو سلوك قديم. حُدّث ليستخدم OWNER، مع إبقاء فحوص العزل وإضافة تأكيد أن محاولة MANAGER تُرجع `403`.
- `owner-manager-employee-hierarchy.spec.ts`: أُضيف اختبار يغطي فجوة غير مغطاة سابقًا:
  - عدّادات لوحة التحكم لا تتأثر ببيانات فريق آخر.
  - عدّ الموظفين يعكس التعيين الحالي في DB.
  - البحث في العقارات والعملاء يطبق نفس نطاق الفريق.

---

## 3. نتائج التحقق الأمني

### 3.1 عزل الأدوار والفرق — ناجح

- OWNER يرى بيانات الشركة كاملة.
- MANAGER يرى موظفيه المعيّنين وبياناتهم فقط.
- الموظف التابع للمالك مباشرة (`managerUserId = NULL`) لا يظهر لأي MANAGER، ويظهر للمالك.
- عزل الفريق يشمل:
  - العقارات وتفاصيلها وصورها.
  - العملاء وجهات الاتصال.
  - المتابعات وإشراف المدير.
  - لوحة التحكم وعدّاداتها.
  - الإشعارات — كل مستخدم يرى صندوقه فقط.
- نقل الموظف بين الفرق يغيّر الرؤية المستقبلية دون حذف التاريخ، ولا يسرّب بيانات الفريق القديم أو الجديد.
- البحث والعدّادات وdirect URLs مبنية على نفس فلاتر النطاق، وليست فلترة لاحقة في الذاكرة.

### 3.2 أفعال MANAGER المحظورة — ناجح

- إنشاء/تعديل/تفعيل/تعطيل/نقل حسابات الموظفين والمديرين: OWNER فقط (`403` للمدير).
- `/managers` و`/managers/:id/permissions`: OWNER فقط.
- Trash / restore / permanent delete: OWNER فقط على مستوى controller وservice، مع اختبار `403` حقيقي لـMANAGER.
- المالية: عنصر التنقل مخفي عن MANAGER، ومسار `/manager/finance` محمي بـ`RequireRole` للمالك. لا توجد Finance APIs فعلية حاليًا؛ `FinanceModule` هيكل فارغ.
- إعدادات الشركة والحضور والصلاحيات: لا تظهر للمدير في الواجهة. لا توجد APIs خلفية لهذه الإعدادات بعد.
- إعدادات المتابعة: تظهر للمدير للقراءة فقط دون حفظ.
- اعتماد/رفض العقارات: default-deny، ويُقرأ من DB عند كل قرار، ومقيّد بفريق المدير، مع بقاء منح/سحب OWNER كما هو.

### 3.3 المصادقة والجلسات — ناجح

- HttpOnly access/refresh cookies، وCSRF double-submit، ورفض Origin/Referer وcross-site mutations.
- Refresh rotation، ورفض إعادة استخدام refresh القديم، وتسلسل logout.
- `authVersion` والـtrigger يبطلان الجلسات بعد تغيير الدور أو التعطيل، بما في ذلك التعديل المباشر بـSQL.
- إعادة التفعيل لا تحيي الجلسات القديمة؛ يلزم login جديد.
- JWT المزوّر/غير الموقّع/`alg:none` مرفوض، ولا يُعتمد على claim الدور وحده.
- الحساب المعطّل يُرفض فورًا.

### 3.4 الصور والرفع — ناجح

- وصول الصور يتبع نفس رؤية العقار، مع `private, no-store` و`nosniff`.
- إزالة EXIF/XMP/IPTC، وتطبيق orientation، ورفض الملفات التالفة/المتحركة/decompression bombs.
- حدود Multer، وأسماء الملفات الخبيثة، وMIME spoofing، والأجزاء المشوهة: مرفوضة ومنضبطة.
- لا تُترك ملفات يتيمة عند فشل المعالجة.

### 3.5 Web Push وSSRF — ناجح

- allowlist للنطاقات الرسمية فقط.
- رفض loopback/private/link-local/CGNAT/metadata، وDNS rebinding/redirect.
- التحقق وقت الاتصال، وربط الاشتراك بالمستخدم الموثق فقط.

### 3.6 Rate Limiting وProxy وCORS — ناجح

- 429 مع `Retry-After`، وحدود منفصلة للدخول/الرفع/Push/CSRF.
- X-Forwarded-For المزوّر لا يتجاوز الحدود مع تعطيل trust proxy.
- authenticated limits بمفتاح المستخدم الموثق، وليس IP مشترك.
- CORS لا يتوسع في production origins.

### 3.7 CSP — سليم وظيفيًا، وليس مفعّلًا

- CSP المحلي **Report-Only** كما هو مقصود.
- manifest سليم، واختبارات pipeline ناجحة، والمعاينة Enforce تعمل.
- لم يُفعّل Enforce على التطبيق الفعلي.

---

## 4. سلامة البيانات والنسخ الاحتياطي

- النسخة الاحتياطية المعتمدة سابقًا: `D:\ArkanBackups\owner-hierarchy-20261108-034605`، مع تحقق SHA-256 واستعادة تجريبية وأعداد مطابقة.
- لم تُكرر النسخة/الاستعادة لأن الدليل السابق كافٍ لهذه المرحلة.
- `arkan_crm`: **22 migration** مطبّقة، وآخرها `20261108090200_auth_revocation_triggers`.
- عدد ملفات migrations في المشروع: **22** — لا توجد migration جديدة منذ التفعيل.
- فحص الـmigrations الثلاث الخاصة بالهيكل: لا `DROP TABLE` / `TRUNCATE` / `DELETE FROM` / `DROP COLUMN` / تغيير هدّام لأعمدة قائمة.
- لم تُعدّل أي بيانات أعمال أثناء هذه المراجعة.

---

## 5. النتائج المؤكدة

### لا توجد ثغرة تطبيقية Critical أو High قابلة للاستغلال في النسخة المحلية الحالية.

### F1 — High (إنتاجي، تبعية): Prisma / deepmerge-ts

| البند | القيمة |
|---|---|
| المكوّن | `prisma@6.19.3` → `@prisma/config` → `deepmerge-ts` |
| الدليل | `npm audit --omit=dev` = **3 high** بهذه السلسلة فقط |
| الأثر | Stack exhaustion عند تمرير رسم كائنات دائري إلى Prisma CLI/Config |
| Runtime | `@prisma/client` لا يحمّل هذه السلسلة وقت التشغيل حسب التحقق السابق |
| الحالة | **مقبول مؤقتًا للتطوير المحلي** — ليس ضمن كود التطبيق |
| المطلوب للإنتاج | ترقية Prisma 7.x أو قبول مخاطر رسمي، وإزالة Prisma CLI من صورة runtime |

### F2 — Medium (إنتاجي): صورة Docker تشمل devDependencies وPrisma CLI

- المكوّن: `docker/backend.Dockerfile`.
- الأثر: سطح هجوم أكبر داخل الحاوية.
- الإصلاح: multi-stage build + `npm prune --omit=dev`.
- ليس عيبًا في التطبيق المحلي؛ لا تغيير دون اعتماد.

### F3 — Medium (إنتاجي): CSP ما زال Report-Only

- لا يمنع XSS فعليًا حتى تفعيل Enforce.
- يحتاج HTTPS + `CSP_REPORT_URI` + قرار اعتماد.
- المطلوب قبل الإنتاج: تفعيل Enforce والتحقق من manifest في CI.

### F4 — Medium (إنتاجي): Rate Limiting الافتراضي in-memory

- كافٍ لنسخة محلية واحدة.
- عند تعدد النسخ: Redis-backed limiter إلزامي.

### F5 — Medium (إنتاجي): Trusted proxy / HTTPS / Secure cookies

- trust proxy معطّل افتراضيًا، وهو الصحيح محليًا.
- الإنتاج يحتاج طوبولوجيا proxy محددة + HTTPS + Secure cookies.
- منطق الكوكيز الحالي يفشل مغلقًا في production، لكنه يحتاج ضبطًا نشرحيًا.

### F6 — Low (إنتاجي): مسار التطوير `/dev/potential-duplicate-preview`

- ما زال موجودًا في source وbuild.
- بياناته اصطناعية ولا يمنح وصولًا لبيانات أعمال، لكنه يجب أن يُحذف أو يُقيّد قبل الإنتاج.

### F7 — Low (نظافة كود): فروع MANAGER الميتة في مساعدات Trash

- `trashedScopeWhere` و`assertTrashedScope` ما زالت تحتوي فروع MANAGER، لكنها غير قابلة للوصول لأن `assertTrashAccess` يرفض غير OWNER أولًا.
- لا يوجد أثر أمني حالي؛ يُنصح بتنظيفها لاحقًا لتقليل خطر إعادة الاستخدام الخاطئ.

### ملاحظة — المالية والحضور والإعدادات

- المالية والحضور وإعدادات الشركة/الحضور لا تملك APIs خلفية بعد؛ الحماية الحالية واجهة فقط.
- هذا حدّ ميزة مؤجلة وليس ثغرة في النسخة المحلية.
- عند بناء APIs مستقبلية، يجب تطبيق نفس قواعد OWNER/MANAGER على الخادم قبل إتاحتها.

---

## 6. القرار

### ✅ GO — إغلاق المرحلة الأمنية الحالية للتطوير المحلي

لأنه لا توجد ثغرة تطبيقية Critical/High قابلة للاستغلال، وجميع مسارات العزل والجلسات والرفع والصور وPush/Rate Limiting/CSP الأساسية اجتازت الاختبارات المركزة.

### ❌ NO-GO — النشر الإنتاجي

حتى إغلاق البوابات التالية:

- Prisma 7.x أو قبول مخاطر موقّع + إزالة CLI من runtime.
- Docker multi-stage/prune وإزالة devDependencies.
- CSP Enforce + تقارير + تكامل manifest في CI.
- Redis limiter عند تعدد النسخ.
- HTTPS + Secure cookies + trusted proxy حسب الطوبولوجيا.
- إزالة/تقييد مسار `/dev/...`.
- إعادة `npm audit` والاختبارات الأمنية في CI قبل الإصدار.
- بناء APIs المالية/الحضور/الإعدادات مع تفويض خلفي قبل إتاحتها للمستخدمين.

---

## 7. قائمة مراجعة أمنية للfeatures القادمة

1. كل مسار جديد: هل يبدأ من `request.user` ولا يثق بأي ID دور من العميل؟
2. هل الاستعلام نفسه مقيّد بالنطاق (DB-level) وليس فلترة بعد الجلب؟
3. هل التفاصيل والصور والعدّادات والبحث وdirect URLs تستخدم نفس فلتر الرؤية؟
4. هل الأفعال الحساسة (حذف/استعادة/صلاحيات/تعطيل/مالية) OWNER-only على الخادم؟
5. هل MANAGER مقيّد بفريقه الحالي، والموظف ببياناته فقط؟
6. هل تغيير الدور/التعطيل/النقل يبطل الجلسات ويحدّث الرؤية فورًا؟
7. هل الملفات المرفوعة محدودة الحجم والنوع، وتُزال metadata، وتُخزّن بأسماء آمنة؟
8. هل الأخطاء تُرجع 401/403/404 دون تسريب وجود السجل أو تفاصيل داخلية؟
9. هل كل mutation محمي بـCSRF عند استخدام cookie auth؟
10. هل أُضيف اختبار عزل سلبي (cross-team / cross-employee) وليس happy-path فقط؟

---

## 8. الملفات المعدلة في هذه المراجعة

- `apps/backend/test/security-task7-penetration.spec.ts`
  - تحديث اختبار Trash ليعكس سياسة OWNER-only.
- `apps/backend/test/owner-manager-employee-hierarchy.spec.ts`
  - إضافة اختبار عزل لوحة التحكم والبحث.
- `docs/reports/security-phase2-closure-review.md` — هذا التقرير.

**لم يُعدّل أي كود منتج أو schema أو migration أو `.env` أو بيانات أعمال.**
