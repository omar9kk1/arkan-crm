# المرحلة الأمنية الثانية — المهمة 7: اختبار اختراق وتجربة أمنية شاملة

**التاريخ:** 2026-11-07  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تقييم أمني شامل في بيئة اختبار معزولة، دون أي نشر أو تفعيل إنتاجي.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.  
**القرار:** **GO للانتقال إلى مرحلة تجهيز الإنتاج (Production-Readiness Preparation)**، مع بوابات إلزامية قبل أي نشر فعلي. **NO-GO للنشر الإنتاجي الآن.**

> لم يتم استهداف التطبيق التطويري الجاري (`3001/4001`) ولا قاعدة بيانات الأعمال `arkan_crm`.  
> لم يتم تعديل `.env` أو `.env.local` أو المخطط أو migrations أو بيانات الأعمال أو الواجهة أو Git.  
> لم يتم تنفيذ commits أو pushes.  
> لم يتم تفعيل CSP Enforce على التطبيق الفعلي، ولم يتم ترقية Prisma.

---

## 1. بيئة الاختبار والتغطية

| العنصر | القيمة |
|---|---|
| قاعدة البيانات | `arkan_crm_api_test` فقط — مشتقة من `DATABASE_URL` باستبدال اسم القاعدة، دون طباعة أي سر |
| التطبيقات | NestJS مؤقتة داخل الاختبارات (in-process) بمجلدات تخزين مؤقتة |
| الحسابات | Manager + Employee A + Employee B + حساب demotion مخصص |
| Redis | مثيل محلي معزول بمفاتيح ذات بادئة اختبارية فريدة |
| CSP | manifest مبني مسبقًا + معاينة Enforce على منافذ معزولة `3201/3202` |
| الحمولات | محدودة وغير مدمّرة؛ لا DoS أو حمل أو أهداف خارجية |
| الأسرار | لم تُطبع؛ لا كلمات مرور أو tokens في هذا التقرير |

**الأوامر الأساسية (بدون أسرار):**

```powershell
# TEST_DATABASE_URL = DATABASE_URL مع استبدال /arkan_crm بـ /arkan_crm_api_test
npm run test -w @arkan/backend -- <specs>
npm run test:csp
npm run csp:verify -w @arkan/frontend
npm audit --omit=dev
npm ls multer
npm run typecheck -w @arkan/backend
npx eslint apps/backend/test/security-task7-penetration.spec.ts apps/backend/test/support/test-app.ts
```

---

## 2. ملخص النتائج

| المجال | النتيجة |
|---|---|
| المصادقة والجلسات وCSRF | **نجح** — لا ثغرة قابلة للاستغلال |
| IDOR / BOLA | **نجح** — لا تسريب عبر الاستجابة أو الرسائل |
| الإدخال وقواعد الأعمال | **نجح** — لا SQLi ولا Mass Assignment |
| رفع الملفات والصور | **نجح** — لا Path Traversal ولا تمويه MIME |
| Web Push / SSRF | **نجح** — السماح الصارم والتحقق وقت الاتصال |
| Rate Limiting / Proxy | **نجح** — مع تحفظات نشر موثقة |
| CSP / الواجهة | **نجح وظيفيًا** — Report-Only محليًا، والمعاينة Enforce تعمل |
| التبعيات / Docker | **توجد مخاطر معروفة** — Prisma chain + dev deps في صورة runtime |

**إجمالي الاختبارات المنفذة في هذه المهمة:**

- حزمة Task 7 الجديدة: **12/12**
- مجموعة الأمن الأساسية: **27 حزمة / 255 اختبارًا**
- مجموعة IDOR والأعمال الإضافية: **20 حزمة / 178 اختبارًا**
- Redis-backed limits: **1/1**
- CSP: **14 اختبار Backend + 8 اختبار Pipeline**
- `typecheck`: **0 أخطاء** — `eslint` على الملفات المعدلة: **0 أخطاء**

**الإجمالي الأمني المنفذ:** **48 حزمة / 434 اختبارًا** (بالإضافة إلى 22 اختبار CSP غير المرتبط بقاعدة البيانات).

---

## 3. الثغرات/المخاطر المؤكدة

### F1 — High (تبعية، تعرض عملي محدود): سلسلة Prisma/deepmerge-ts

| البند | القيمة |
|---|---|
| المعرف | GHSA-ggr8-5vv4-36mx / CVE-2026-40345 |
| المكوّن | `prisma@6.19.3` → `@prisma/config@6.19.3` → `deepmerge-ts@7.1.5` |
| الشدة | High (CVSS 8.2) — Stack Exhaustion |
| الاستغلال | يتطلب تمرير رسم كائنات متكرر/دائري إلى Prisma CLI/Config |
| Runtime | `@prisma/client` لا يحمّل `@prisma/config` أو `deepmerge-ts` وقت التشغيل (تم التحقق سابقًا عبر `require.cache`) |
| الظهور | `npm audit --omit=dev` = **3 high** بنفس السلسلة؛ `npm audit` الكامل = 31 (5 low / 23 moderate / 3 high) |
| الإصلاح | Prisma **7.10.1** (Major) — لا patch/minor آمن في 6.x |
| الحالة | **مقبول مؤقتًا وموثق** حسب تقرير المهمة 6؛ لم تُنفذ الترقية |
| التخفيف الفوري | إزالة Prisma CLI/dev deps من صورة runtime، وعدم تمرير إعدادات CLI غير موثوقة، وتقييد CI |

**الاختبارات:** لم تتأثر؛ جميع اختبارات Prisma/raw SQL وP/A وadvisory locks نجحت.

---

### F2 — Medium (بنية نشر): صورة Docker الإنتاجية تضم devDependencies وPrisma CLI

| البند | القيمة |
|---|---|
| المكوّن | `docker/backend.Dockerfile` |
| السبب | مرحلة واحدة: `npm ci` يشمل dev، ثم `ENV NODE_ENV=production` دون `npm prune --omit=dev` أو مرحلة runtime منفصلة |
| الأثر | سطح هجوم أكبر، وجود Prisma CLI/config القابل للتأثر داخل الحاوية، صورة أكبر |
| التخفيف | Multi-stage build + `npm prune --omit=dev` بعد البناء، وعدم نسخ CLI/src إلى runtime |
| الحالة | **لم يُعدّل** — تغيير بنية نشر يحتاج اعتمادًا منفصلًا |
| الاختبار | لا تغيير؛ راجع `security-phase2-prisma-dependency-review.md` |

---

### F3 — Medium (مخاطر متبقية مقصودة): CSP ما زال Report-Only بلا نقطة تقارير

| البند | القيمة |
|---|---|
| المكوّن | `apps/frontend/.env.local` (`CSP_MODE=report-only`)، `next.config.ts`، `lib/csp.ts` |
| الأثر | CSP لا يمنع XSS فعليًا، ولا توجد تقارير خادمية (`CSP_REPORT_URI` غير مضبوط) |
| ما تم التحقق منه | manifest: 27 HTML route، 29 hash، رأس 2055B؛ المعاينة المعزولة على `3201` أرسلت `Content-Security-Policy` صارمًا مع hashes، ومنعت سكربت inline غير مصرح وصورة من أصل غير مسموح |
| الاختبار | `test:csp` = 14 + 8 ناجحة؛ `csp:verify` ناجح؛ الصفحة أقلعت وهيدريت (نموذج الدخول ظهر) |
| الحالة | **لم يُفعّل Enforce** على التطبيق الفعلي؛ يحتاج HTTPS + قرار اعتماد + نقطة تقارير |

---

### F4 — Medium (نشر متعدد النسخ): Rate Limiting الافتراضي in-memory

| البند | القيمة |
|---|---|
| المكوّن | `apps/backend/src/common/guards/` + `config/rate-limit.ts` |
| السلوك | المفاتيح المعتمدة: user id للطلبات الموثقة، وIP لتسجيل الدخول/refresh؛ `TRUST_PROXY` معطل افتراضيًا |
| الأثر | مع أكثر من replica، تصبح الحدود لكل نسخة وليست موزعة |
| ما تم التحقق منه | 429 + `Retry-After`، XFF المزوّر لا يتجاوز، موظفان على IP واحد لهما حدود مستقلة، Redis-backed enforcement نجح في اختبار معزول |
| التخفيف | تفعيل Redis storage في الإنتاج متعدد النسخ؛ لا تفعيل trust proxy دون طوبولوجيا معروفة |
| الحالة | Redis اختياري وغير مفعّل محليًا؛ لم يُغيّر |

---

### F5 — Low (نظافة نشر): مسار تطويري داخل بناء الإنتاج

| البند | القيمة |
|---|---|
| المسار | `/dev/potential-duplicate-preview` |
| الدليل | `apps/frontend/.next/csp-manifest.json` يتضمن `server/app/dev/potential-duplicate-preview.html` |
| الأثر | صفحة fixture غير مرتبطة بالتنقل، تعرض بيانات اصطناعية فقط، وقد تجري `GET /properties/:id` قراءة فقط بجلسة Manager |
| التخفيف | حذف المسار من بناء الإنتاج أو تقييده على `NODE_ENV !== 'production'` قبل الإصدار |
| الحالة | **لم يُحذف** — تغيير واجهة/مسار يحتاج اعتمادًا؛ لا يمنح وصولًا لبيانات حقيقية |

---

### F6 — Low (أدوات): تحذير `npm ls` بسبب override المقصود لـ Multer

| البند | القيمة |
|---|---|
| الأمر | `npm ls multer` |
| النتيجة | `multer@2.5.0 invalid: "2.4.0" from @nestjs/platform-express` |
| السبب | `overrides` في الجذر تفرض `multer@2.5.0` لإصلاح advisories، بينما package platform-express يعلن `2.4.0` |
| الأثر | لا خلل runtime؛ لكن `npm ls` يفشل وقد يربك CI |
| الحالة | **مقصود وموثق**؛ جميع اختبارات رفع الصور والحدود نجحت. يُعاد النظر عند تحديث Nest/platform-express |

---

### ملاحظة Low — معلومات تشغيلية

`GET /health/ready` عام ويعيد حالة DB/Redis (`up/down`) دون أسرار. هذا سلوك مقصود لـ probes، وليس تسريبًا حساسًا. لا حاجة لتغييره في هذه المهمة.

---

## 4. السيناريوهات الناجحة (لا ثغرات)

### 4.1 المصادقة والجلسات

- HttpOnly على access/refresh، `SameSite=Lax`، `Path=/` و`/auth`، وCSRF cookie قابل للقراءة فقط.
- CSRF مطلوب لـ login/refresh/logout وكل mutation معتمدة بالكوكي؛ رفض Origin/Referer و`Sec-Fetch-Site: cross-site`.
- رفض إعادة استخدام refresh القديم، وتزامن refresh، وlogout يلغي العائلة فورًا.
- **Session fixation**: كوكي refresh مزوّر مسبقًا لا يثبت الجلسة؛ الجلسة الجديدة تُصدر refresh مختلفًا، والمزوّر يُرفض.
- **JWT**: تعديل `role`/`sub` أو توقيع غير صالح أو `alg:none` → 401؛ لا يُعتمد على claim الدور وحده.
- **Role demotion**: تحويل Manager إلى Employee يبطل وصوله فورًا (401/403)، ويعود فقط بعد تطابق الدور في DB.
- الحساب المعطل/غير النشط يُرفض فورًا (اختبارات قائمة).
- كل المسارات الخاصة أعادت 401 بدون جلسة، دون تسريب `passwordHash` أو tokens أو stack.

### 4.2 IDOR / BOLA

- موظف B لا يقرأ/يعدّل عميل أو جهة اتصال أو إشعار موظف A (404/403 دون تسريب الاسم/الهاتف).
- موظف B لا يرى عقار A Pending ولا صورته، ولا يستطيع approve.
- مسارات Manager (`/employees`, `/dashboard/manager`, `/properties/trash`, `/push/config`, `/users/me/notification-preferences`) → 403 للموظف.
- العقار المحذوف soft-delete يختفي من detail/image لكل الأدوار، بما في ذلك منشئه وManager؛ ويظهر فقط في Trash.
- المالك المؤقت/provisional owner لا يظهر لموظف آخر قبل الاعتماد (اختبارات قائمة).
- Client reviews وfollow-ups وnotifications وpush subscriptions: تغطية IDOR قائمة ناجحة.

### 4.3 الإدخال وقواعد الأعمال

- `' OR 1=1--` و`%` و`_` في البحث تُعامل كبيانات؛ لا 500 ولا تضخيم نتائج.
- Mass assignment مرفوض (400) لحقول `status`, `reference`, `createdByUserId`, `primaryImageId`، بما فيها nested contact.
- Malformed JSON وmultipart payload وUUID غير صالح → 400 منضبط دون stack.
- التكرار 409، idempotency، P/A numbering، سباق الاعتماد، ومنع الاعتماد/الرفض/الاستعادة غير المصرح به: جميعها ناجحة.
- لا يُنشأ Owner رسمي قبل الاعتماد؛ والاعتمادات المتزامنة لا تكرر المالك.

### 4.4 رفع الملفات

- اسم ملف `../../../../evil.png` لا ينتج أي ملف خارج `STORAGE_ROOT` ولا يظهر في الاستجابة.
- محتوى نصي بامتداد `.png` مرفوض (400).
- تجاوز الحجم، decompression bomb، الصور المتحركة، multipart المشوه/المقطوع، والحقول غير المتوقعة: مرفوضة ومنضبطة.
- صورة خاصة: المنشئ/Manager فقط، وموظف آخر → 404، مع `Cache-Control: private, no-store` و`nosniff`.

### 4.5 Web Push / SSRF

- allowlist للنطاقات الرسمية، رفض loopback/private/link-local/CGNAT/metadata/IPv6، وDNS rebinding/redirect، والتحقق وقت الاتصال.
- ربط الاشتراك بجلسة Manager موثقة فقط؛ لا وصول لاشتراك جهاز آخر؛ اختبار الإرسال للذات فقط.
- دليل التسليم الحقيقي السابق يظل صالحًا؛ لم تُجرَ محاولة تسليم خارجية جديدة التزامًا بقيود المهمة.

### 4.6 Rate Limiting / Proxy

- 429 مع `Retry-After`، وتعافي بعد النافذة.
- X-Forwarded-For المزوّر لا يتجاوز حد الدخول؛ trust proxy معطل افتراضيًا.
- حدود المصادقة مفصولة عن IP المشترك، وحدود upload/push/CSRF تعمل.
- Redis-backed centralized enforcement نجح في بيئة معزولة.

### 4.7 CSP / الواجهة

- `.env.local` ما زال `CSP_MODE=report-only`؛ لم يُعدّل.
- manifest تم التحقق منه: 27 route و29 hash ورأس 2055B.
- المعاينة المعزولة (Enforce) أعادت صفحة 200، رأس CSP صارم، 8 سكربتات خارجية بحالة 200، ومنعت:
  - سكربت inline غير مصرح (`inlineExecuted=0`)
  - صورة من أصل غير مسموح (`blocked=true`)
- الهيدريشن يعمل: نموذج الدخول والحقول والأزرار ظهرت بالعربية. أخطاء CORS الظاهرة في المعاينة سببها منفذ 3201 غير مضاف إلى origins، وليست ثغرة CSP.

---

## 5. التغييرات والاختبارات المضافة

**لم يُعدّل أي كود منتج أو schema أو migrations أو `.env` أو UI.**

تمت إضافة:

- `apps/backend/test/security-task7-penetration.spec.ts` — 12 اختبارًا موجّهًا:
  - cookie flags، session fixation، logout revocation، role demotion، CSRF على mutations، حصر unauthenticated.
  - JWT tampering/unsigned/role claim، IDOR لعملاء/جهات/إشعارات/عقارات، manager routes.
  - Mass assignment، SQL/meta characters، malformed input، trashed property/image، traversal filename وMIME spoof.
- `apps/backend/test/support/test-app.ts` — إضافة `UsersModule` إلى تطبيق الاختبار ليغطي مسار تفضيلات إشعارات Manager (كان 404 في harness فقط).

**لا إصلاحات منتج مطبقة** لأن جميع الثغرات القابلة للإصلاح الفوري لم تظهر كعيوب صغيرة مؤكدة؛ البنود المتبقية تحتاج قرارات اعتماد (Prisma/Docker/CSP/Redis/route).

---

## 6. ما لم يُتحقق / عوائق بيئية

| البند | السبب |
|---|---|
| معاينة CSP على المنفذ 3001 | مشغول بتطبيق التطوير الجاري؛ تمت المعاينة على 3201/3202 بدلًا منه |
| تسليم Web Push خارجي حقيقي | ممنوع في هذه المهمة؛ الاعتماد على دليل التسليم السابق + اختبارات push المعزولة |
| اختبار حمل/DoS | ممنوع صراحةً |
| اختبار Docker build/run فعلي | لم يُنفذ بناء صورة جديدة؛ تم الفحص الساكن لـ Dockerfile |
| اختبار متعدد النسخ فعليًا | Redis integration معزول نجح، لكن لم تُشغّل replicas متعددة |
| فحص إنتاجي بـ HTTPS/Secure cookies | لا يوجد نشر إنتاجي في هذه المهمة |

---

## 7. المخاطر المتبقية قبل الإنتاج

1. **Prisma/deepmerge-ts High**: ترقية 7.10.1 مخططة أو قبول مخاطر موقع؛ يجب ألا تبقى `npm audit --omit=dev` حمراء عند الإصدار.
2. **Docker runtime**: إزالة devDependencies/Prisma CLI عبر multi-stage/prune.
3. **CSP**: قرار Enforce بعد HTTPS ونقطة تقارير؛ الاستمرار Report-Only لا يمنع XSS.
4. **Rate limiting**: Redis إلزامي عند تعدد النسخ؛ trust proxy فقط مع طوبولوجيا معروفة.
5. **Cookies الإنتاج**: HTTPS + `Secure` + بادئات `__Host-`/`__Secure-` (المنطق الحالي يفشل مغلقًا في production).
6. **مسار `/dev/...`**: إزالته أو تقييده قبل الإصدار.
7. **Multer override**: إبقاء override وتوثيق تحذير `npm ls` حتى تحديث platform-express.
8. **npm audit العام**: 23 moderate / 5 low في أدوات التطوير (Jest/ESLint/Nest CLI) — ليست runtime، ولم تُرقّ لتجنب تغييرات غير مرتبطة.

---

## 8. القرار النهائي

### GO — للانتقال إلى مرحلة تجهيز الإنتاج

لأن الاختبارات لم تكشف أي ثغرة Critical/High قابلة للاستغلال في طبقة التطبيق: المصادقة، CSRF، IDOR، الإدخال، الرفع، Push/SSRF، والـrate limiting نجحت جميعها في البيئة المعزولة.

### NO-GO — للنشر الإنتاجي الفعلي الآن

حتى إغلاق البوابات التالية:

- Prisma 7.10.1 أو قبول مخاطر رسمي موقّع + إزالة CLI من runtime.
- Docker multi-stage/prune وعدم شحن dev deps.
- قرار CSP Enforce + `CSP_REPORT_URI`.
- Redis limiter عند تعدد النسخ، وHTTPS/Secure cookies، وtrust proxy فقط بطوبولوجيا معروفة.
- إزالة/تقييد مسار `/dev/...` من بناء الإنتاج.
- إعادة `npm audit` والاختبارات الأمنية في CI قبل الإصدار.

---

## 9. الملفات والحالة

**أُضيف/عُدّل في المهمة 7 فقط:**

- `apps/backend/test/security-task7-penetration.spec.ts` (جديد)
- `apps/backend/test/support/test-app.ts` (إضافة UsersModule)
- `docs/reports/security-phase2-final-penetration-test.md` (هذا التقرير)

**لم يُغيّر:**

- `apps/backend/prisma/schema.prisma` أو migrations
- `.env` أو `.env.local`
- أي كود منتج أو واجهة
- أي بيانات أعمال أو `arkan_crm`
- Git history (`HEAD=d43cae5`؛ لا commits/pushes)

**التوقف هنا للمراجعة اليدوية قبل أي تفعيل إنتاجي أو ترقية تبعيات أو تعديل Docker/CSP.**
