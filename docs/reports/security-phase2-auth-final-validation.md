# المرحلة الأمنية الثانية — المهمة 3C: التحقق النهائي من جلسات Cookies

**التاريخ:** 2026-11-07  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تحقق أمني واختبار انحدار نهائي لمصادقة Cookies قبل أي تفعيل.  
**الحالة:** مكتمل مع قيد واحد موثّق — **تسليم Web Push الفعلي لم يُتحقق منه** بسبب رفض إذن الإشعارات في متصفح الاختبار.

> **لم يتم تفعيل cookie authentication على التطبيق الفعلي.**  
> لم يتم تعديل `.env` أو `.env.local`.  
> لم تُستخدم قاعدة بيانات التطوير أو بياناتها.  
> لم تُنفّذ migrations أو commits أو pushes.  
> إصلاحات Web Push SSRF وMulter وتدقيق الأمان محفوظة.  
> لم يتم البدء في CSP أو rate limiting أو Prisma.

---

## 1. منهجية الاختبار

- خوادم مؤقتة فقط:
  - Backend: `localhost:4001`
  - Frontend: `localhost:3001`
- قاعدة بيانات معزولة فقط:
  - `arkan_crm_api_test`
- تم تمرير الإعدادات عبر متغيرات بيئة مؤقتة عند تشغيل الخوادم، دون لمس ملفات `.env`.
- حسابات اختبار:
  - `cookie.browser.manager@test.local`
  - `cookie.browser.employee@test.local`
- تم استخدام متصفح Chromium المدمج (Electron/Chrome 152) وجلسات تبويبات حقيقية.
- اختبارات CSRF متعددة الأصول نُفذت أيضًا على مستوى HTTP عبر Node، لأن المتصفح يمنع تزوير `Origin` يدويًا.
- اختبارات Jest تعيد تهيئة **قاعدة الاختبار المعزولة** فقط ضمن بنيتها القياسية؛ لم تُلمس قاعدة التطوير.

### الإعدادات المستخدمة في السيناريوهات

| المتغير | القيمة |
|---|---|
| `DATABASE_URL` | `.../arkan_crm_api_test?schema=public` |
| `FRONTEND_ORIGIN` | `http://localhost:3001` |
| `AUTH_COOKIE_MODE` | `legacy` / `dual` / `cookie` حسب السيناريو |
| `NEXT_PUBLIC_AUTH_MODE` | `legacy` / `dual` / `cookie` حسب السيناريو |
| `COOKIE_SECURE` | `false` (تطوير فقط) |
| `JWT_ACCESS_TTL_SECONDS` | `60` في اختبار الانتهاء الحقيقي (الحد الأدنى المسموح) |
| `PUSH_VAPID_*` | مفاتيح اختبار مولّدة محليًا، subject: `mailto:test@arkan.local` |

---

## 2. تسلسل الترحيل الكامل

| السيناريو | النتيجة | الأدلة |
|---|---|---|
| Backend `legacy` + Frontend `legacy` | ✅ نجح | Bearer + `sessionStorage`، لا CSRF، لا cookies، إعادة تحميل واستعادة، logout سليم |
| Backend `dual` + Frontend `legacy` | ✅ نجح | عميل legacy حصل على التوكنات فقط، بلا `Set-Cookie` وبلا CSRF، واستمر بعد إعادة التحميل |
| Backend `dual` + Frontend `dual` | ✅ نجح | ترحيل جلسة legacy مرة واحدة بدقة، ثم جلسة cookies فقط |
| Backend `cookie` + Frontend `cookie` | ✅ نجح | login/refresh/logout، CSRF، التبويبات، الرافع والصور والإشعارات |

### 2.1 `legacy` + `legacy`

- تسجيل دخول Manager عبر الواجهة = `200`.
- طلب الدخول بلا `X-CSRF-Token`.
- `document.cookie` = فارغ (لم تُضف أي كوكي).
- `sessionStorage['arkan.auth.v1']` يحتوي:
  - `accessToken`
  - `refreshToken`
  - `expiresIn`
  - `user`
- `GET /auth/me` بلا Bearer = `401`.
- إعادة التحميل: `/auth/me` = `200` مع `Authorization: Bearer`.
- تسجيل الخروج:
  - `POST /auth/logout` = `200`
  - الجسم يحتوي `refreshToken`
  - بلا CSRF
  - `sessionStorage` = `null`
  - إعادة توجيه إلى `/login`.

### 2.2 `dual` + `legacy`

- تسجيل الدخول = `200`.
- الاستجابة احتوت `accessToken/refreshToken/expiresIn` فقط.
- لا `X-CSRF-Token`، ولا `Set-Cookie`.
- الجلسة بقيت في `sessionStorage` وعملت بعد إعادة التحميل عبر Bearer.
- هذا يثبت أن تفعيل `dual` على الخلفية لا يكسر عملاء legacy.

### 2.3 `dual` + `dual` — الترحيل الحقيقي

تم إنشاء جلسة legacy حقيقية عبر واجهة API بلا CSRF، ثم حقنها في `sessionStorage` وفتح `/manager`.

النتيجة:

1. `GET /auth/csrf` = `200`.
2. `POST /auth/refresh` **مرة واحدة فقط**:
   - `refreshToken` القديم في الجسم.
   - `X-CSRF-Token` صالح.
   - `Origin: http://localhost:3001`.
   - `credentials: include`.
3. الاستجابة = `200` مع `Set-Cookie` و`user`.
4. `sessionStorage` أصبح `null`.
5. `document.cookie` يعرض CSRF فقط.
6. `GET /auth/me` = `200` بدور `MANAGER`.
7. لوحة Manager ظهرت.
8. إعادة التحميل التالية لم تُعد الترحيل ولم تُطلب refresh إضافي.

**لا تسريب ولا حلقة logout:** لم يُمسح التخزين قبل نجاح الترحيل، ولم يحدث تسجيل خروج غير مقصود.

### 2.4 `cookie` + `cookie`

- تسجيل الدخول عبر الواجهة = `200`.
- استجابة الدخول:
  ```json
  { "user": { "id": "...", "role": "MANAGER" }, "csrfToken": "..." }
  ```
  لا access/refresh tokens.
- `document.cookie` = `arkan_dev_csrf` فقط.
- `sessionStorage` و`localStorage` بلا أي access/refresh.
- `GET /auth/me` = `200` بالكوكيز.
- إعادة التحميل تستعيد الجلسة عبر `/auth/me` دون refresh إضافي.
- لا حلقات 401/403.

---

## 3. اختبار التزامن الحقيقي بين تبويبين

### 3.1 إعداد الانتهاء الحقيقي

- `JWT_ACCESS_TTL_SECONDS=60` (الحد الأدنى الذي يسمح به إعداد الخادم).
- تم إيقاف مؤقت الإشعارات الدوري (15 ثانية) داخل التبويبين أثناء الاختبار فقط، لمنع refresh استباقي يفسد سيناريو الانتهاء.
- بعد الانتظار، تم التحقق مباشرة أن:
  - التبويب A: `GET /auth/me` = `401`
  - التبويب B: `GET /auth/me` = `401`
- لم يحدث أي refresh بعد تسجيل الدخول قبل لحظة الاختبار.

### 3.2 مع Web Locks متاحة

تم النقر على رابط محمي في التبويبين في نفس اللحظة تقريبًا.

النتيجة:

| التبويب | طلبات refresh | النهاية |
|---|---|---|
| A | `POST /auth/refresh` = `200` (مرة واحدة) | `/auth/me` = `200` |
| B | **صفر refresh** | `/auth/me` = `200` بعد انتظار القفل وإعادة استخدام الكوكي الجديد |

- إجمالي عمليات refresh الناجحة للجولة = **1**.
- كلا التبويبين وصلا إلى `/manager/clients`، بلا شاشة انتهاء وبلا إلغاء جلسة.
- الطلبات المتوازية التي حصلت على `401` أُعيدت بعد refresh واحد.
- لا حلقات.

**اسم القفل:** `arkan:auth-refresh`.

### 3.3 بدون Web Locks (fallback)

- تم تعطيل `navigator.locks` داخل التبويبين (`locksAvailable=false`).
- تم إعادة إنتاج انتهاء access الحقيقي مرة أخرى.
- تم النقر على رابط محمي في التبويبين معًا.

النتيجة:

| التبويب | طلبات refresh بعد الجولة | النهاية |
|---|---|---|
| A | `200` مرة واحدة | `/auth/me` = `200` |
| B | **صفر refresh** | `/auth/me` = `200` |

- `localStorage['arkan:auth-refresh-lock']` بعد الجولة = `null` (أُطلق القفل).
- لا إلغاء جلسة، ولا حلقة، وكلا التبويبين بقيّا على `/manager/followups`.

### 3.4 تسجيل الخروج عبر التبويبات

- تسجيل الخروج من التبويب A = `200`.
- التبويب A انتقل إلى `/login`، و`sessionStorage` = `null`.
- التبويب B استقبل حدث `logout`:
  - ظهر: «انتهت الجلسة. الرجاء تسجيل الدخول من جديد.»
  - `GET /auth/me` = `401`.
  - `sessionStorage` = `null`.
- عدد طلبات التبويب B بقي ثابتًا: **81 → 81** بعد 6 ثوانٍ.
- لا حلقات 401/403.

---

## 4. Manager / Employee والصلاحيات

### 4.1 Manager

- تسجيل دخول/خروج عبر الواجهة في وضع cookies: ✅.
- إعادة تحميل واستعادة: ✅.
- `GET /notifications` = `200`.
- `GET /properties` = `200`.
- التنقل إلى الإشعارات والعقارات والإعدادات: ✅.

### 4.2 Employee

- تسجيل الدخول عبر الواجهة = ✅.
- الانتقال إلى `/employee` = ✅.
- `GET /auth/me` = `200` بدور `EMPLOYEE`.
- `GET /employees` = `403 Forbidden`.
- محاولة فتح `/manager` أدت إلى إعادة توجيه إلى `/employee`.
- تسجيل الخروج: ✅.

### 4.3 حساب معطّل

**في المتصفح:**

- بعد تعطيل الحساب وإعادة تحميل صفحة محمية:
  - `GET /auth/me` = `401`.
  - `POST /auth/refresh` = `401`.
  - مسح الكوكيز.
  - الانتقال إلى `/login`.
- إجمالي طلبات المصادقة أثناء الانتقال = 11، ثم استقر العدد تمامًا.
- سبب الدورتين المحدودتين هو انتقال الصفحة من المسار المحمي إلى `/login`؛ **ليسا حلقة**.

**تحقق دقيق على مستوى API:**

| الخطوة | النتيجة |
|---|---|
| `/auth/me` قبل التعطيل | `200` |
| `/auth/me` بعد التعطيل | `401` |
| `/auth/refresh` بعد التعطيل | `401` |

### 4.4 تغيير الدور

**في المتصفح:**

- Manager → Employee أثناء جلسة نشطة.
- بعد إعادة التحميل:
  - الجلسة أصبحت `EMPLOYEE`.
  - `/employees` = `403`.
  - الواجهة انتقلت إلى `/employee`.
- لا تصعيد صلاحيات.

**تحقق دقيق على مستوى API:**

| الخطوة | النتيجة |
|---|---|
| `/auth/me` قبل التغيير | `200` / `MANAGER` |
| access token القديم بعد التغيير | `401` |
| refresh بعد التغيير | `200` |
| `/auth/me` بعد refresh | `200` / `EMPLOYEE` |
| `/employees` بعد التخفيض | `403` |

**الخلاصة:** تغيير الدور يُبطل access token القديم، ولا يمنح صلاحيات المدير السابقة. النتيجة جلسة بدورها الجديد، وهي سلوك آمن.

---

## 5. مصفوفة CSRF والأصول

نُفذت على خادم cookie حقيقي مع كوكي وجلسة حقيقية:

| الاختبار | الحالة | النتيجة |
|---|---|---|
| `GET /auth/csrf` | 200 | ✅ |
| `POST /auth/login` بلا CSRF | 403 | ✅ مرفوض |
| Login + `Origin` خاطئ + CSRF صالح | 403 | ✅ مرفوض |
| Login + `Sec-Fetch-Site: cross-site` + CSRF صالح | 403 | ✅ مرفوض |
| Login صحيح + CSRF + Origin | 200 | ✅ |
| جسم Login | — | ✅ لا access/refresh |
| `GET /auth/me` بالكوكيز | 200 | ✅ |
| `GET /auth/me` بلا كوكيز | 401 | ✅ |
| `PATCH /users/me/notification-preferences` بلا CSRF | 403 | ✅ مرفوض |
| نفس الطلب + Origin خاطئ | 403 | ✅ مرفوض |
| نفس الطلب + CSRF صحيح | 200 | ✅ |
| `POST /auth/refresh` بلا CSRF | 403 | ✅ مرفوض |
| `POST /auth/refresh` بـ CSRF | 200 | ✅ |
| جسم Refresh | — | ✅ لا access/refresh |
| Refresh بـ `Referer` خاطئ بلا Origin | 403 | ✅ مرفوض |
| Refresh بـ `Referer` صحيح بلا Origin | 200 | ✅ |
| `POST /properties` multipart بلا CSRF | 403 | ✅ مرفوض |
| `POST /properties` multipart بـ CSRF | 201 | ✅ |
| `GET /properties/:id/image` بالكوكيز | 200 / `image/png` / 91 bytes | ✅ |
| `GET /properties/:id/image` بلا كوكيز | 401 | ✅ |
| `POST /auth/logout` بلا CSRF | 403 | ✅ مرفوض |
| `POST /auth/logout` + Origin خاطئ | 403 | ✅ مرفوض |
| `POST /auth/logout` + CSRF صحيح | 200 | ✅ |
| `/auth/me` بعد Logout | 401 | ✅ |

### 5.1 نموذج عادي من الواجهة

تم تبديل «تفعيل إشعارات المتابعة» من صفحة إعدادات المدير:

- `PATCH /users/me/notification-preferences` = `200`.
- الطلب حمل `X-CSRF-Token`.
- الجسم: `{"enabled":false}`.
- حالة المفتاح تغيّرت فعليًا، ثم أُعيد تفعيله.

---

## 6. Web Push

### 6.1 ما نجح

- `GET /push/config` = `200`.
- الاستجابة:
  - `configured: true`
  - `publicKey`: مفتاح اختبار VAPID
  - `subject: mailto:test@arkan.local`
- `GET /push/subscriptions` = `200` / `{ subscribed: false }`.
- `POST /push/test` = `200` / `{ sent: 0, devices: 0 }` (لا أجهزة مشتركة).
- اختبارات `push.spec.ts` و`push-endpoint.spec.ts` ناجحة ضمن الحزمة الكاملة.

### 6.2 ما لم ينجح — تسليم Web Push الفعلي

**النتيجة: غير متحقق (UNVERIFIED).**

الأدلة:

- `Notification.permission` = `denied` قبل المحاولة.
- `Notification.requestPermission()` أعاد `denied` بعد المحاولة.
- `pushManager.subscribe(...)` فشل:
  ```
  AbortError: Registration failed - permission denied
  ```
- لذلك لم يتم إنشاء اشتراك حقيقي، ولم تُرسل أي إشعارات فعلية.
- **لا يمكن claim أن التسليم الفعلي نجح.**

هذا قيد بيئي في متصفح الاختبار (إذن الإشعارات مرفوض على مستوى الملف الشخصي)، وليس فشلًا في كود Web Push.

### 6.3 حماية SSRF

تم التحقق من الحماية وقت التشغيل دون أي إضعاف:

| Endpoint | النتيجة |
|---|---|
| `https://127.0.0.1:4001/push` | 400 — مرفوض |
| `https://evil.example/push` | 400 — مرفوض |
| `https://fcm.googleapis.com/fcm/send/...` | 200 — مسموح (مزوّد معروف) |
| حذف الاشتراك التجريبي | 200 |
| الحالة بعد الحذف | `subscribed: false` |

- لم يُعدّل allowlist ولا فحص DNS/IP.
- إصلاحات SSRF السابقة محفوظة.

---

## 7. منع تسريب التوكنات

في وضع `cookie` وبجلسة Manager نشطة:

| الفحص | النتيجة |
|---|---|
| `sessionStorage` keys | `[]` |
| `localStorage` keys | مفاتيح وهمية للحضور فقط (معرّفات مستخدم، لا توكنات) |
| قيم تحتوي JWT/`accessToken`/`refreshToken` | لا شيء |
| `document.cookie` names | `arkan_dev_csrf` فقط |
| URL/resource entries تحتوي توكنًا | لا شيء |
| Console messages تحتوي JWT | لا شيء |
| `Authorization` على `/auth/me` في cookie mode | غير موجود |
| سجلات backend/frontend | لا تطابق `eyJ...` أو `accessToken` أو `refreshToken` |
| جسم Login/Refresh في cookie mode | لا access/refresh |

**ملاحظة:** في وضع `dual` يعيد الخادم التوكنات في جسم استجابة الترحيل للتوافق الخلفي، لكن الواجهة لا تحفظها وتمسح الجلسة القديمة بعد نجاح الترحيل.

---

## 8. الوظائف المحفوظة

| الوظيفة | النتيجة |
|---|---|
| تسجيل دخول/خروج Manager | ✅ |
| تسجيل دخول/خروج Employee | ✅ |
| عزل الأدوار | ✅ |
| إعادة تحميل الجلسة | ✅ في الأوضاع الثلاثة |
| رفع صورة عبر multipart | ✅ 201 مع CSRF |
| استرجاع صورة خاصة | ✅ 200 بالكوكيز، 401 بلا جلسة |
| الإشعارات | ✅ 200 |
| التنقل بين صفحات Manager | ✅ |
| Legacy Bearer | ✅ بلا انحدار |
| Refresh متزامن | ✅ refresh واحد |
| Logout عبر التبويبات | ✅ |
| حماية SSRF للـPush | ✅ |

---

## 9. العيب المكتشف والإصلاح

### العيب

أظهر تشغيل الحزمة الكاملة فشل تجميع في:

`apps/backend/test/frontend-properties-contract.spec.ts`

```
TS2339: Property 'accessToken' does not exist on type 'Session'.
```

السبب: المهمة 3B غيّرت واجهة `Session` عمدًا إلى `{ user }`، وأصبحت التوكنات القديمة تُحفظ في `sessionStorage` وليس على كائن الجلسة. الاختبار القديم كان لا يزال يقرأ `session.accessToken`.

### الإصلاح

- تعديل الاختبار فقط، وليس كود الإنتاج:
  - قراءة `arkan.auth.v1` من `sessionStorage`.
  - التحقق من وجود `accessToken` و`refreshToken` داخله.
- لا تغيير في منطق المصادقة أو الواجهة.

### إعادة التحقق

```text
frontend-properties-contract.spec.ts: 17/17 ✅
Full backend suite: 71 suites / 737 tests ✅
```

**لا عيب إنتاجي مؤكد اكتُشف في Task 3C.** العيب كان تعاقد اختبار قديم مع الواجهة الجديدة.

---

## 10. الاختبارات والبناء النهائي

### 10.1 اختبارات مركزة

13 مجموعة / **93 اختبارًا** ناجحًا:

- `auth-cookie-mode`
- `frontend-auth-mode`
- `frontend-authorized`
- `auth`
- `auth-rate-limit`
- `auth-refresh-database`
- `auth-cookie-config`
- `cors-origins`
- `push-endpoint`
- `push`
- `properties-upload-hardening`
- `properties-upload-limits`
- `security-hardening`

### 10.2 الحزمة الكاملة

بعد إصلاح الاختبار:

```text
Test Suites: 71 passed, 71 total
Tests:       737 passed, 737 total
```

### 10.3 التحقق الساكن والبناء

```text
Frontend tsc --noEmit      ✅
Backend  tsc --noEmit      ✅
ESLint (apps + packages)   ✅
next build                 ✅
nest build                 ✅
```

---

## 11. المخاطر والقيود المتبقية

1. **تسليم Web Push الفعلي غير متحقق.**  
   إذن الإشعارات مرفوض في متصفح الاختبار، والاشتراك فشل بـ`AbortError`. يلزم اختبار في ملف متصفح حقيقي بإذن ممنوح، مع VAPID اختباري، قبل اعتبار Push جاهزًا.

2. **اختبار المتصفح تم على Chromium/Electron فقط.**  
   Firefox وSafari لم يُختبرا. Web Locks fallback تم اختباره بتعطيل `navigator.locks` داخل Chromium، وليس على متصفح لا يدعمها أصلًا.

3. **اختبار انتهاء access استخدم إيقاف مؤقت الإشعارات.**  
   هذا إجراء اختبار فقط. في الاستخدام العادي قد يجدّد المؤقت الدوري (15s) الـaccess قبل انتهائه، وهو سلوك مرغوب. التزامن تم التحقق منه بعد انتهاء حقيقي (`/auth/me = 401`).

4. **حد أدنى TTL = 60 ثانية.**  
   إعداد الخادم يرفض أقل من ذلك؛ استُخدم 60. لا تغيير على الحد.

5. **اختبار cross-origin نُفذ عبر HTTP مباشر.**  
   المتصفح يمنع تزوير `Origin`، لذلك استُخدم Node لإثبات رفض الخادم للأصل الخاطئ و`Sec-Fetch-Site`. المتصفح إضافيًا يمنع الطلب عبر CORS.

6. **وضع `dual` يعيد توكنات legacy في جسم الترحيل.**  
   هذا ضروري للتوافق الخلفي، والواجهة لا تحفظها بعد نجاح الترحيل. وضع `cookie` لا يعيدها إطلاقًا.

7. **CSRF كوكي مقروء من JavaScript.**  
   هذا جزء من double-submit وليس سرًا. Access/Refresh فقط HttpOnly.

8. **صفحة الدخول تحاول refresh واحدًا عند عدم وجود جلسة.**  
   هذا ينتج `401` متوقعًا عند فتح `/login` بلا جلسة، ثم يتوقف. ليس حلقة.

9. **تغيير الدور يخفض الجلسة بدل إجبار تسجيل خروج كامل.**  
   access القديم يُرفض، والـrefresh يمنح الدور الجديد. لا تصعيد صلاحيات، لكنه قرار منتج يجب توثيقه.

10. **لا تغييرات في CSP أو rate limiting أو Prisma.**  
    خارج نطاق 3C حسب التعليمات.

---

## 12. هل المصادقة الكوكيزية جاهزة للتفعيل؟

**الخلاصة:** نواة جلسات Cookies وCSRF والترحيل والتزامن **جاهزة وظيفيًا وأمنيًا** للانتقال إلى تفعيل منفصل بموافقة صريحة، مع التحفظ التالي:

> **Web Push الفعلي (الاشتراك والتسليم) لم يُتحقق منه في هذه البيئة.**  
> لا ينبغي اعتبار Push جاهزًا للإنتاج قبل اختبار تسليم حقيقي في متصفح بإذن ممنوح.

### توصية التفعيل

1. اعتماد هذا التقرير وتقريري 3A/3B.
2. تفعيل `dual` أولًا على الخلفية، ثم الواجهة، ومراقبة الترحيل.
3. التأكد من:
   - HTTPS
   - `COOKIE_SECURE=true`
   - `FRONTEND_ORIGIN` دقيق
   - same-site بين الواجهة والـAPI
4. إجراء اختبار Web Push حقيقي منفصل.
5. الانتقال إلى `cookie` بعد ثبات `dual`.
6. الاحتفاظ بخطة تراجع إلى `legacy`.

**التطبيق الفعلي ما زال على `legacy`. لم يتم تفعيل `dual` أو `cookie` عليه. التوقف هنا للمراجعة اليدوية.**

---

## 13. ملفات المهمة 3C

- تم تعديل ملف اختبار واحد فقط:
  - `apps/backend/test/frontend-properties-contract.spec.ts`
- سكربتات التشغيل والتحقق المؤقتة موجودة خارج المشروع في مجلد temp، ولم تُضف إلى المستودع.
- بقية ملفات المصادقة المذكورة في تقرير 3B ما زالت غير ملتزمة (uncommitted).
- لا commits ولا pushes.
