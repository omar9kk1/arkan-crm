# المرحلة الأمنية الثانية — المهمة 3B: دمج مصادقة Cookies في الواجهة

**التاريخ:** 2026-11-06  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** دمج الواجهة الأمامية مع مصادقة Cookies/CSRF الجاهزة في الخلفية فقط.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية قبل التفعيل.

> **الوضع الافتراضي ما زال `legacy`.**  
> لم يتم تفعيل `dual` أو `cookie` في تطبيق التطوير الفعلي، ولم يتم تعديل `.env` أو `.env.local`.  
> لم يتم تنفيذ أي commit أو push.  
> لم يتم تعديل قاعدة البيانات أو migrations أو seeds.  
> إصلاحات Web Push SSRF وMulter وتدقيق الأمان السابقة محفوظة.

---

## 1. الهدف والنتيجة

تم فصل سلوك المصادقة في الواجهة عن الشكل القديم (Bearer + `sessionStorage`) وإدخال ثلاثة أوضاع قابلة للضبط، مع الإبقاء على `legacy` كافتراضي حرفيًا:

```env
NEXT_PUBLIC_AUTH_MODE=legacy   # legacy (default) | dual | cookie
```

الخادم يبقى المرجع الوحيد للجلسة:

- Access/Refresh cookies هي مصدر الحقيقة في وضعي `cookie` و`dual` بعد الترحيل.
- الواجهة لا تصنع جلسة من تلقاء نفسها ولا تعتمد على claim محلي.
- كل استعادة جلسة تمر عبر `GET /auth/me`.
- لا يتم التعامل مع `403` (CSRF أو صلاحيات) كجلسة منتهية.

تم التحقق من التدفقات في متصفح حقيقي على خوادم مؤقتة وقاعدة بيانات اختبار معزولة، مع إبقاء التطبيق الفعلي على `legacy`.

---

## 2. أوضاع المصادقة في الواجهة

| الوضع | النقل | التخزين | CSRF | استعادة الجلسة | تسجيل الخروج |
|---|---|---|---|---|---|
| `legacy` | `Authorization: Bearer` | `sessionStorage['arkan.auth.v1']` | لا | Bearer عبر `/auth/me` | توكن refresh في الجسم، ثم مسح التخزين |
| `dual` | Bearer قبل الترحيل، ثم cookies | Bearer مؤقتًا حتى نجاح الترحيل فقط | على كل طلب غير آمن بعد وجود CSRF | محاولة ترحيل لمرة واحدة ثم cookies | حسب مصدر الجلسة الحالي |
| `cookie` | cookies فقط | لا access/refresh إطلاقًا في JS | إلزامي على كل طلب غير آمن | cookies عبر `/auth/me` | cookies + CSRF فقط |

### 2.1 وضع `legacy` (الافتراضي)

- `api-client` يرسل `credentials: 'omit'`.
- لا يُضاف `X-CSRF-Token`.
- تسجيل الدخول يعيد التوكنات في JSON وتُحفظ في `sessionStorage` كما كان.
- إعادة تحميل الصفحة تستعيد الجلسة بـ `Authorization: Bearer`.
- تسجيل الخروج يرسل `refreshToken` في الجسم ثم يمسح التخزين.
- لم يتغير أي مسار أو شكل استجابة يراه العميل القديم.

### 2.2 وضع `dual`

- تسجيل الدخول يبدأ بـ `GET /auth/csrf`، ثم `POST /auth/login` مع `X-CSRF-Token`.
- إذا أعاد الخادم `user` مع `Set-Cookie` → تُعتمد الجلسة الكوكيزية وتُمسح توكنات `sessionStorage` فورًا.
- إذا كان الخادم ما زال `legacy` فعلًا وأعاد توكنات فقط → تُحفظ الجلسة القديمة وتستمر بالعمل (توافق خلفي).
- الجلسة القديمة الموجودة مسبقًا تُرحّل مرة واحدة عبر `POST /auth/refresh` مع:
  - `refreshToken` القديم في الجسم،
  - `X-CSRF-Token` صالح،
  - `Origin` الصحيح،
  - `credentials: 'include'`.
- لا تُمسح التوكنات القديمة إلا بعد:
  - نجاح الترحيل وإصدار cookies (`response.user` موجود)، أو
  - تأكيد إبطال الجلسة (`401`).
- `403` أثناء الترحيل لا يمسح التوكنات ولا يُعتبر انتهاء جلسة.

### 2.3 وضع `cookie`

- `credentials: 'include'` على كل الطلبات.
- `GET /auth/csrf` عند الحاجة، والتوكن في الذاكرة فقط (ليس تخزينًا دائمًا).
- `X-CSRF-Token` يُضاف مركزيًا في `api-client` لكل `POST/PATCH/PUT/DELETE`، بما فيها رفع `multipart/form-data`.
- لا تُقرأ ولا تُحفظ access/refresh cookies في JavaScript؛ `document.cookie` يعرض CSRF فقط.
- الاستعادة عبر `GET /auth/me` فقط.
- عند `401`: محاولة refresh واحدة فقط.
- عند `403`: لا refresh ولا مسح جلسة؛ الخطأ يُعرض للمستخدم.
- عند boot في `cookie`: أي `arkan.auth.v1` قديم يُمسح قبل الاستعادة.

---

## 3. تدفقات المصادقة الدقيقة

### 3.1 تسجيل الدخول

1. استدعاء `GET /auth/csrf` (في `dual`/`cookie`).
2. تخزين التوكن في الذاكرة (`csrf-store`).
3. `POST /auth/login` مع `credentials: 'include'` و`X-CSRF-Token`.
4. في `legacy`: حفظ التوكنات في `sessionStorage`.
5. في `dual`/`cookie`: إذا أعاد الخادم `user` → اعتماد الجلسة الكوكيزية ومسح التخزين القديم.
6. إذا أعاد خادم `dual` القديم توكنات فقط → حفظها مؤقتًا والحفاظ على تسجيل الدخول.

### 3.2 استعادة الجلسة بعد التحميل/إعادة التحميل

- `legacy`: قراءة `sessionStorage` ثم `GET /auth/me` بـ Bearer، مع refresh واحد عند `401`.
- `dual`:
  - إذا وُجدت جلسة قديمة → ترحيلها لمرة واحدة.
  - ثم استعادة cookies عبر `/auth/me`.
- `cookie`: مسح أي تخزين قديم، ثم `/auth/me`، ثم refresh واحد فقط عند `401`.

### 3.3 Refresh

- `authorizedRequest` يعالج `401` فقط:
  - refresh واحد،
  - إعادة الطلب مرة واحدة،
  - بلا حلقات أو retries متكررة.
- `cookieRefresh` داخل قفل موزّع:
  - يجرّب `/auth/me` أولًا (قد يكون تاب آخر قد جدّد الكوكي بالفعل)،
  - ثم يجرّب refresh،
  - إذا كان الخطأ `403` (CSRF قديم) يجرّب تجديد CSRF ثم refresh مرة واحدة فقط.
- `401` بعد refresh → جلسة منتهية/ملغاة → مسح الحالة وإطلاق حدث الانتهاء.
- `403` → لا مسح ولا حدث انتهاء.

### 3.4 التنسيق بين التبويبات

- **Web Locks** عند توفرها: قفل `arkan:auth-refresh`.
- **Fallback**: قفل `localStorage` باسم `arkan:auth-refresh-lock` بصلاحية 5 ثوانٍ ومحاولات محدودة.
- **بث الأحداث**:
  - `BroadcastChannel('arkan:auth')` عند توفرها،
  - وإلا `localStorage['arkan:auth-event']` كحدث غير حساس.
- أحداث `logout` و`expired` تمسح الحالة المحلية وتطلق `arkan:session-expired` في التبويبات الأخرى.

### 3.5 تسجيل الخروج

- `legacy`: سلوك محلي أولًا كما كان، ثم إبطال refresh token إن أمكن.
- `dual`/`cookie` مع جلسة كوكيزية:
  - `GET /auth/csrf` ثم `POST /auth/logout` بلا جسم.
  - `401` يعني أن الجلسة منتهية بالفعل → يُعتبر الخروج ناجحًا محليًا.
  - `403` (CSRF قديم) → تجديد CSRF ثم محاولة واحدة فقط.
  - أي فشل آخر لا يُسقط المستخدم من الواجهة ولا يمسح حالة الخادم؛ يبقى في الصفحة ليعيد المحاولة.
- بعد نجاح الخادم فقط يتم مسح الحالة وإعادة التوجيه إلى `/login`.

### 3.6 معالجة الأخطاء دون حلقات

- `/auth/me` → `401` → refresh واحد → إن فشل: انتهاء جلسة.
- `403` لا يدخل مسار refresh إطلاقًا.
- محاولة refresh لا تتكرر داخل نفس الطلب.
- فشل `logout` في وضع الكوكيز لا يسبب قفزة `/login` ثم عودة تلقائية للجلسة.

---

## 4. الملفات المعدّلة

### الواجهة

| الملف | التغيير |
|---|---|
| `apps/frontend/lib/auth-mode.ts` | **جديد**: حل `NEXT_PUBLIC_AUTH_MODE` مع `legacy` كافتراضي |
| `apps/frontend/lib/api/csrf-store.ts` | **جديد**: توكن CSRF في الذاكرة فقط |
| `apps/frontend/lib/api-client.ts` | `credentials` حسب الوضع + `X-CSRF-Token` مركزي لكل الطلبات غير الآمنة بما فيها multipart |
| `apps/frontend/lib/api/authorized.ts` | 401 → refresh واحد فقط، و403 لا يُعالج كانتهاء جلسة |
| `apps/frontend/features/auth/api/auth-api.ts` | CSRF bootstrap، login/refresh/logout، ترحيل legacy |
| `apps/frontend/features/auth/session.ts` | الأوضاع الثلاثة، الترحيل، Web Locks، البث بين التبويبات، قواعد المسح |
| `apps/frontend/features/auth/components/auth-provider.tsx` | عدم إسقاط المستخدم قبل تأكيد logout في أوضاع الكوكيز |
| `apps/frontend/features/auth/components/logout-button.tsx` | البقاء في الصفحة عند فشل تأكيد logout بدل redirect مضلّل |
| `apps/frontend/.env.example` | توثيق `NEXT_PUBLIC_AUTH_MODE=legacy` |
| `apps/frontend/.env.local.example` | توثيق الوضع الافتراضي ومتطلب مطابقة الخلفية |

### الخلفية

| الملف | التغيير |
|---|---|
| `apps/backend/src/auth/auth.controller.ts` | إصلاح توافق `dual`: طلب refresh بلا cookie وبلا body يعيد `401 No refresh session` بدل `400` |
| `apps/backend/test/auth-cookie-mode.spec.ts` | اختبار الترحيل + اختبار الجلسة غير الموجودة في `dual` |
| `apps/backend/test/frontend-auth-mode.spec.ts` | اختبار حل الوضع، نقل CSRF لـ JSON وmultipart، وعدم إرسال CSRF في legacy |
| `apps/backend/test/frontend-authorized.spec.ts` | **جديد**: 401 مرة واحدة، 403 بلا refresh، وCSRF قبل الطلبات غير الآمنة |

> لم يتم تغيير تصميم الكوكيز أو CSRF في الخلفية. التعديل الوحيد سلوكي ومحدود: استجابة `dual` عند غياب أي جلسة أصبحت `401` متوافقة مع سلوك `cookie`، بدل `400` كان يظهر كنص إنجليزي خام في شاشة الدخول.

---

## 5. الاختبارات

### 5.1 اختبارات مركزة

| المجموعة | النتيجة |
|---|---|
| `auth-cookie-mode.spec.ts` | **19/19** |
| `frontend-auth-mode.spec.ts` | **5/5** |
| `frontend-authorized.spec.ts` | **5/5** |
| **الإجمالي النهائي** | **3 مجموعات / 29 اختبارًا ناجحًا** |

تشغيل أوسع شمل `auth.spec.ts` و`auth-rate-limit.spec.ts`:

```text
Test Suites: 5 passed, 5 total
Tests:       43 passed, 43 total
```

### 5.2 التحقق الساكن والبناء

```text
Frontend tsc --noEmit      ✅
Backend  tsc --noEmit      ✅
ESLint (apps + packages)   ✅
next build                 ✅
nest build                 ✅
```

### 5.3 بيانات الاختبار

- قاعدة بيانات معزولة: `arkan_crm_api_test` على منفذ PostgreSQL المحلي.
- خوادم مؤقتة: backend `:4001` وfrontend `:3001`، بمتغيرات بيئة مؤقتة فقط.
- لم يتم استخدام قاعدة بيانات التطوير الفعلية.
- لم يتم تعديل `.env` أو `.env.local`.

---

## 6. نتائج المتصفح الفعلية

### 6.1 وضع `cookie`

**تسجيل الدخول:**

- تسجيل دخول Manager عبر الواجهة نجح.
- الطلبات حملت `credentials: 'include'` و`X-CSRF-Token` و`Origin` الصحيح.
- `document.cookie` بعد الدخول: `arkan_dev_csrf` فقط.
- لا وجود لـ access/refresh cookies في JavaScript.
- `sessionStorage['arkan.auth.v1']` = `null`.
- `GET /auth/me` = `200` بالكوكيز.

**إعادة التحميل:**

- الاستعادة تمت عبر `GET /auth/me` = `200`.
- لم يُطلب refresh إضافي.
- بقي التخزين فارغًا وبقيت الجلسة صالحة.

**تبويبان:**

- تبويب ثانٍ على `/manager` استعاد نفس الجلسة من الكوكيز (`200`).
- لا تسريب توكنات في أي تبويب.

**تسجيل الخروج:**

- `POST /auth/logout` = `200` مع CSRF.
- مسح الكوكيز وإعادة توجيه التبويب النشط إلى `/login`.
- التبويب الآخر استقبل حدث `logout` وأظهر شاشة انتهاء الجلسة.
- `GET /auth/me` بعدها = `401`.
- لا حلقات `401/403`.

**الرفع multipart والصور:**

- `POST /properties` بصيغة `multipart/form-data` **بدون** CSRF = `403 CSRF validation failed`.
- نفس الطلب **مع** `X-CSRF-Token` = `201 Created`.
- تم إنشاء عقار وربط صورة PNG اختبارية.
- `GET /properties/:id/image` بالكوكيز = `200` و`Content-Type: image/png` و`91` بايت.
- نفس الطلب بلا كوكيز = `401`.
- هذا يثبت أن مسار الصور والرفع يعملان بالمصادقة الكوكيزية، وأن CSRF يغطي multipart.

**الإشعارات والعقارات:**

- `GET /notifications` = `200` بالكوكيز فقط.
- `GET /properties` = `200` بالكوكيز فقط.

### 6.2 وضع `dual` والترحيل

تم حقن جلسة `legacy` صالحة في `sessionStorage['arkan.auth.v1']` ثم فتح `/manager`.

النتيجة المرصودة:

1. `GET /auth/csrf` = `200`.
2. `POST /auth/refresh` **مرة واحدة فقط** مع:
   - `refreshToken` القديم في الجسم،
   - `X-CSRF-Token`،
   - `Origin: http://localhost:3001`،
   - `credentials: 'include'`.
3. الاستجابة = `200` وتحتوي `user` و`Set-Cookie` ورموز CSRF جديدة.
4. `sessionStorage['arkan.auth.v1']` أصبح `null`.
5. `document.cookie` يعرض CSRF فقط.
6. `GET /auth/me` = `200`.
7. لوحة Manager ظهرت بالكامل.
8. إعادة التحميل التالية لم تُعد الترحيل: `/auth/me` فقط = `200`.

**تسجيل دخول جديد في `dual` عبر الواجهة:** نجح، وأنشأ جلسة كوكيزية دون حفظ أي access/refresh في المتصفح.

تم أيضًا إصلاح الخلل الذي ظهر أثناء الاختبار: في `dual` بدون أي جلسة، كان `/auth/refresh` يعيد `400 refreshToken is required` ويظهر كنص إنجليزي خام في شاشة الدخول. أصبح الآن `401 No refresh session`، فتتعامل الواجهة معه كعدم وجود جلسة دون رسالة خطأ.

### 6.3 وضع `legacy` (الافتراضي)

- تسجيل دخول Manager عبر الواجهة نجح.
- طلب الدخول لم يحمل `X-CSRF-Token`.
- `document.cookie` فارغ.
- `sessionStorage['arkan.auth.v1']` يحتوي:
  - `accessToken`
  - `refreshToken`
  - `expiresIn`
  - `user`
- `/auth/me` بدون Bearer = `401` (يثبت غياب الاعتماد على الكوكيز).
- بعد إعادة التحميل: `/auth/me` = `200` مع `Authorization: Bearer`.
- تسجيل الخروج:
  - `POST /auth/logout` = `200`
  - الجسم يحتوي `refreshToken`
  - بلا CSRF
  - `sessionStorage` أصبح `null`
  - إعادة توجيه إلى `/login`.

### 6.4 التحقق من الإبطال وتغيّر الدور

**تعطيل المستخدم:**

- بعد تعطيل حساب Manager في قاعدة الاختبار:
  - `/auth/me` = `401`
  - `/notifications` = `401`
  - ثم refresh واحد = `401`
  - مُسحت الكوكيز
  - ظهرت شاشة «انتهت الجلسة» مع زر إعادة المحاولة
- لا حلقات ولا طلبات متكررة.

**تغيير الدور من Manager إلى Employee:**

- التوكن/الكوكي القديم بصلاحية Manager أصبح غير صالح.
- refresh أنتج جلسة Employee جديدة (بلا تصعيد صلاحيات).
- `GET /employees` = `403`.
- الواجهة أعادت التوجيه إلى `/employee`.
- `GET /auth/me` = `200` بدور `EMPLOYEE`.

> هذا سلوك آمن: لا يحتفظ المستخدم بصلاحيات Manager القديمة، ويُخفَّض إلى دوره الحالي بدل الاستمرار بجلسة قديمة.

---

## 7. المخاطر المتبقية

1. **CSRF مقروء من JavaScript بطبيعة التصميم.**  
   هذا مطلوب لـ double-submit، وليس سرًا. Access/Refresh فقط هما HttpOnly.

2. **وجود توكنات `legacy` في `sessionStorage` خلال فترة `dual` قبل الترحيل.**  
   الترحيل يحدث مرة واحدة عند أول استعادة ناجحة، ثم تُمسح. لكن نافذة `dual` تعني بقاء الشكل القديم متاحًا حتى تكتمل الهجرة.

3. **أولوية الكوكي على Bearer.**  
   إذا وُجد كوكي refresh تالف/ملغى مع جلسة legacy صالحة، الخادم يرفض ولا يسقط إلى Bearer. النتيجة المحتملة: تسجيل خروج وإعادة دخول، وليس تجاوزًا أمنيًا. هذا قرار مقصود لمنع غموض مصدر المصادقة.

4. **الاعتماد على same-site.**  
   كوكيز `SameSite=Lax` لا تُرسل على طلبات XHR cross-site. يجب أن تكون الواجهة والـAPI على نفس الموقع (نفس registrable domain) أو إعادة تقييم النشر قبل التفعيل.

5. **`NEXT_PUBLIC_AUTH_MODE` يُحسب وقت البناء.**  
   تغييره يتطلب إعادة بناء الواجهة، وليس مجرد إعادة تشغيل.

6. **تنسيق التبويبات best-effort.**  
   Web Locks وBroadcastChannel قد تكون معطلة في متصفح/سياق معين؛ fallback موجود لكنه لا يقدم ضمانًا مطلقًا.

7. **شاشة انتهاء الجلسة في تبويب غير نشط.**  
   التبويبات الأخرى تعرض «انتهت الجلسة» وزر إعادة المحاولة بدل redirect فوري. هذا يحافظ على السلوك الحالي ويمنع حلقات إعادة التوجيه، لكنه ليس redirectًا تلقائيًا.

8. **تأخير Hydration في Next dev.**  
   لوحظ بقاء «جارٍ التحقق من الجلسة…» لثوانٍ بعد إعادة التحميل في وضع التطوير بسبب إعادة تجميع Next. لا يظهر كخطأ وظيفي، ولا يُعتبر مشكلة إنتاج.

9. **لا يوجد كشف لتغيّر صلاحية CSRF إلا عند 403.**  
   عندها تُجدد مرة واحدة. هذا مقصود ومحدود.

10. **لم يتم تفعيل الوضع على التطبيق الفعلي.**  
    كل النتائج أعلاه من خوادم مؤقتة وقاعدة اختبار معزولة.

---

## 8. متطلبات التفعيل

### 8.1 الترتيب الموصى به

1. **الخلفية أولًا:** `AUTH_COOKIE_MODE=dual` مع الإبقاء على الواجهة `legacy`.  
   هذا لا يكسر العملاء القدامى لأنهم يحصلون على التوكنات كما هي.
2. **الواجهة:** `NEXT_PUBLIC_AUTH_MODE=dual` وإعادة البناء.  
   راقب نسبة نجاح الترحيل، وأخطاء `401/403`، وسجلات refresh.
3. بعد ثبات `dual`، انتقل إلى:
   - `AUTH_COOKIE_MODE=cookie`
   - `NEXT_PUBLIC_AUTH_MODE=cookie`
   - مع إعادة بناء الواجهة.
4. لا تفعّل `cookie` مباشرة قبل التأكد من أن جميع العملاء النشطين انتقلوا أو أن جلساتهم القديمة قابلة للإبطال.

### 8.2 شروط النشر

- `NODE_ENV=production`.
- `COOKIE_SECURE=true` إلزامي؛ التطبيق يرفض الإقلاع بدونه.
- `FRONTEND_ORIGIN` يجب أن يسرد origins الإنتاجية **بدقة** وبـ HTTPS.
- الواجهة والـAPI على نفس الموقع (same-site) لضمان إرسال `SameSite=Lax`.
- عدم ضبط `Domain` على الكوكيز (host-only).
- التأكد من أن reverse proxy لا يزيل `Set-Cookie` ولا يغيّر scheme.
- إعادة بناء الواجهة بعد تغيير `NEXT_PUBLIC_AUTH_MODE`.
- مراقبة:
  - `GET /auth/me` 401 غير متوقعة،
  - `POST /auth/refresh` 401/403،
  - `POST /auth/logout` 403،
  - أخطاء CSRF في multipart.

### 8.3 خطة التراجع

- أعد `AUTH_COOKIE_MODE=legacy` و`NEXT_PUBLIC_AUTH_MODE=legacy` وأعد النشر.
- الجلسات القديمة تعمل بالتوكنات كما هي.
- يمكن إبطال جلسات الكوكيز عبر logout أو تدوير أسرار/جلسات الخادم عند الحاجة.
- لا حاجة لتغيير قاعدة البيانات أو migrations.

### 8.4 قائمة تحقق قبل التفعيل

- [ ] مراجعة يدوية لهذا التقرير ولتقرير تجهيز الخلفية.
- [ ] تأكيد HTTPS و`COOKIE_SECURE=true` و`FRONTEND_ORIGIN`.
- [ ] تأكيد same-site بين الواجهة والـAPI.
- [ ] اختبار `dual` على بيئة staging مع جلسات legacy حقيقية.
- [ ] اختبار رفع صورة/ملف كبير وحدود Multer.
- [ ] اختبار Web Push بعد الترحيل (إلغاء الاشتراك لا يكسر logout).
- [ ] اختبار تعطيل مستخدم وتغيير دوره.
- [ ] اختبار تبويبين: refresh متزامن، logout، وانتهاء الجلسة.
- [ ] خطة تراجع معلنة وجاهزة.

---

## 9. الخلاصة

- الواجهة تدعم `legacy` و`dual` و`cookie` دون كسر الوضع الافتراضي.
- وضع `cookie` لا يخزّن access/refresh في JavaScript، ويعتمد على HttpOnly cookies + CSRF.
- ترحيل `dual` يعمل مرة واحدة وبأمان، ولا يمسح التوكنات إلا بعد نجاح أو إبطال مؤكد.
- `403` لا يُعامل كانتهاء جلسة، و`401` لا يسبب حلقات refresh.
- التنسيق بين التبويبات موجود مع fallback.
- الرفع multipart والصور والإشعارات تعمل بالمصادقة الكوكيزية.
- تم إصلاح خلل توافق `dual` الذي كان يعرض خطأ `400` خامًا.
- جميع اختبارات المصادقة المركزة والتحقق الساكن والبناء ناجحة.
- **لم يتم تفعيل الوضع الجديد على التطبيق الفعلي. التوقف هنا للمراجعة اليدوية قبل التفعيل.**
