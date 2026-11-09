# المرحلة الأمنية الثانية — المهمة 3A: تجهيز الخلفية لمصادقة Cookies آمنة

**التاريخ:** 2026-11-06  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تجهيز الخلفية فقط — لم يتم تعديل الواجهة.  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية.

> **الوضع الافتراضي ما زال `legacy`.** لم يتم تفعيل `dual` أو `cookie` في تطبيق التطوير الفعلي.  
> لم يتم تعديل قاعدة البيانات أو migrations أو seeds أو بيانات العمل.  
> لم يتم تنفيذ commits أو pushes.  
> إصلاحات Web Push SSRF وMulter وتدقيق الأمان السابقة محفوظة.

---

## 1. أوضاع المصادقة

تمت إضافة متغير بيئة:

```env
AUTH_COOKIE_MODE=legacy   # legacy (default) | dual | cookie
COOKIE_SECURE=false       # development only; production must be true
```

| الوضع | السلوك |
|---|---|
| `legacy` (افتراضي) | نفس السلوك الحالي تمامًا: access/refresh في JSON، Bearer فقط، لا cookies، لا CSRF |
| `dual` | تسجيل دخول/تحديث/خروج بالتوكنات القديمة يعمل كما هو. إصدار cookies فقط عند نجاح CSRF. يسمح بالانتقال التدريجي |
| `cookie` | cookies فقط، لا access/refresh في JSON، CSRF إلزامي لكل طلب غير آمن، refresh/logout عبر cookies |

### ضمانات legacy

- `AuthCookieService` لا يقرأ أي كوكي في `legacy`.
- `JwtAuthGuard` يقبل Bearer كما كان.
- `AuthController` يعيد `{ accessToken, refreshToken, expiresIn }` بنفس الشكل.
- `POST /auth/refresh` و`POST /auth/logout` بدون جسم ما زالا يعيدان 400 كما في الاختبارات الحالية.
- `GET /auth/csrf` جديد لكنه غير مطلوب في legacy.

---

## 2. الكوكيز في وضعي dual/cookie

| الكوكي | التطوير | الإنتاج | HttpOnly | Secure | SameSite | Path | Max-Age |
|---|---|---|---|---|---|---|---|
| Access | `arkan_dev_access` | `__Host-arkan_access` | ✅ | ✅ | Lax | `/` | 900s (قابل للضبط عبر TTL) |
| Refresh | `arkan_dev_refresh` | `__Secure-arkan_refresh` | ✅ | ✅ | Lax | `/auth` | 7 أيام |
| CSRF | `arkan_dev_csrf` | `__Host-arkan_csrf` | ❌ (يقرأها JS) | ✅ | Lax | `/` | 7 أيام |

- **Host-only:** لا يتم ضبط `Domain` مطلقًا.
- **`__Host-`** يتطلب Secure + Path=/ + بلا Domain؛ لذلك access/CSRF يستخدمانه في الإنتاج.
- **`__Secure-`** للـrefresh لأن Path=/auth (لا يصلح `__Host-`).
- **`Cache-Control: no-store`** على login/refresh/logout/csrf.
- **المسح:** Max-Age=0 بنفس الاسم/المسار/خصائص الأمان؛ CSRF يُمسح كغير HttpOnly.
- **التطوير:** `Secure=false` و`SameSite=Lax` وأسماء `arkan_dev_*` مناسبة لـHTTP المحلي.
- **الإنتاج:** `Secure=true` إلزامي؛ أي محاولة `COOKIE_SECURE=false` مع `NODE_ENV=production` توقف التطبيق (fail closed).

---

## 3. CSRF

### 3.1 التدفق

1. `GET /auth/csrf` (public) ينشئ توكنًا عشوائيًا 32 بايت (base64url) ويضعه في كوكي CSRF ويعيده في JSON.
2. الواجهة تحتفظ به في الذاكرة، وترسله في `X-CSRF-Token`.
3. الخادم يقارن header مع كوكي CSRF باستخدام `timingSafeEqual`.
4. يتحقق من `Origin` (أو `Referer` عند غياب Origin) مقابل قائمة origins الدقيقة.
5. يرفض `Sec-Fetch-Site: cross-site` / `none` عند وجوده.
6. `GET/HEAD/OPTIONS` آمنة ولا تحتاج توكنًا.

### 3.2 النطاق

- **كل طلب غير آمن** من طلب مصادَق بالكوكي يمر عبر `CsrfGuard` عالمي.
- **login / refresh / logout** تُفحص داخل `AuthController` لأنها تحتاج قواعد legacy/dual:
  - `cookie`: CSRF إلزامي دائمًا.
  - `dual`: CSRF إلزامي إذا وُجد أي أثر لكوكي/هيدر CSRF أو إذا أُصدرت cookies.
  - `legacy`: بلا CSRF.
- لا يتم إصدار cookies إذا فشل CSRF، **قبل** إنشاء أي RefreshToken.
- إذا وُجدت كوكي refresh، فإنها تتقدم على أي body token، ولا يمكن تجاوز CSRF باستخدام body token.
- GET غير الآمن لا يستخدم؛ كل عمليات التغيير POST/PATCH/PUT/DELETE.

### 3.3 SameSite ليس كافيًا

تم الجمع بين:

- HttpOnly cookies.
- SameSite=Lax.
- Double-submit CSRF token.
- Origin/Referer exact allowlist.
- Fetch Metadata.
- Host-only cookies + `__Host-`/`__Secure-`.

---

## 4. CORS وOrigin

- `configureCors()` مشترك بين `main.ts` وبيئة الاختبار.
- `credentials: true` فقط عند `dual`/`cookie`.
- `origin` قائمة دقيقة من `FRONTEND_ORIGIN`؛ **لا wildcard**.
- `allowedHeaders`: `Content-Type`, `Authorization` (فقط لفترة Bearer)، `X-CSRF-Token`, `Idempotency-Key`.
- `methods`: GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS.
- `maxAge: 600`.
- في التطوير تُضاف `localhost:3000` و`localhost:3001` و`192.168.1.8:3000` كـdevelopment origins فقط.  
- في الإنتاج: origins من `FRONTEND_ORIGIN` فقط، ويجب أن تكون HTTPS. أي origin HTTP يوقف التطبيق.

---

## 5. الحماية من تجاوز المصادقة ومن الجلسات

### 5.1 Cookie مقابل Bearer

- إذا وُجد access cookie، فهي **مرجعية**؛ لا fallback إلى Bearer.
- إذا كانت الكوكي غير صالحة/منتهية ووُجد Bearer صالح → **401**، وليس نجاحًا عبر Bearer.
- إذا لم توجد access cookie، يبقى Bearer مقبولًا للترحيل (`legacy`/`dual`).
- إذا وُجدت الكوكي صالحة وBearer غير صالح → الكوكي تُعتمد، ولا يوجد تجاوز.

### 5.2 التدوير والإلغاء

- لم يتغير منطق `AuthService`: refresh single-use، hash في DB، lineage، advisory lock.
- Refresh يدوّر الكوكيز ويبقي نفس lineage.
- Logout يبطل lineage كاملًا ويمسح الكوكيز.
- تعطيل الحساب/تغيير الدور يظل يبطل الجلسات عبر `JwtAuthGuard`.
- التدوير المتزامن: service يمنع نجاح تدويرين لنفس التوكن؛ اختبار cookie يؤكد [200, 401].
- Refresh + logout متزامنان: لا تبقى جلسة حية بعد العملية؛ اختبار مستقل.

### 5.3 تعدد التبويبات

- الكوكيز مشتركة؛ هذا يحسن الاتساق مقارنة بـsessionStorage.
- الواجهة (المرحلة التالية) ستستخدم Web Locks/BroadcastChannel لمنع refresh races وإعلام التبويبات بالخروج.
- الخلفية لا تضيف جدول/أعمدة grace، لذا لا migration.

---

## 6. الملفات المضافة/المعدلة

### جديدة

- `apps/backend/src/auth/auth-cookie.config.ts` — الأوضاع، الأسماء، flags، fail-closed.
- `apps/backend/src/auth/auth-cookie.service.ts` — إصدار/قراءة/مسح الكوكيز.
- `apps/backend/src/auth/cookie-utils.ts` — parser/serializer آمن.
- `apps/backend/src/auth/csrf.service.ts` — token + Origin/Referer/Fetch Metadata.
- `apps/backend/src/auth/guards/csrf.guard.ts` — CSRF عالمي للطلبات غير الآمنة.
- `apps/backend/src/common/configure-cors.ts` — CORS موحد للخادم والاختبارات.
- `apps/backend/test/auth-cookie-config.spec.ts` — config/flags/fail-closed.
- `apps/backend/test/auth-cookie-mode.spec.ts` — cookie/dual integration.

### معدلة

- `apps/backend/src/auth/auth.controller.ts` — modes، cookies، CSRF، `/auth/csrf`.
- `apps/backend/src/auth/auth.service.ts` — إرجاع user داخليًا + دعم refreshToken اختياري بأمان.
- `apps/backend/src/auth/auth.module.ts` — providers + `CsrfGuard` كـ`APP_GUARD`.
- `apps/backend/src/auth/dto/refresh-token.dto.ts` — token اختياري للكوكي فقط.
- `apps/backend/src/auth/guards/jwt-auth.guard.ts` — access cookie + Bearer fallback.
- `apps/backend/src/config/environment.ts` — `AUTH_COOKIE_MODE`, `COOKIE_SECURE`.
- `apps/backend/src/config/cors-origins.ts` — إضافة dev origin 3001.
- `apps/backend/src/main.ts` — CORS موحد عبر `configureCors`.
- `apps/backend/.env.example` — إعدادات الوضع/الأمان وأصل 3001.
- `apps/backend/test/support/test-app.ts` — env overrides + CORS.
- `apps/backend/test/auth-rate-limit.spec.ts` — stubs للخدمات الجديدة.
- `apps/backend/test/cors-origins.spec.ts` — 3001.

**لم يتم تعديل أي كود واجهة أو قاعدة بيانات.**

---

## 7. الاختبارات

### 7.1 اختبارات المصادقة والكوكيز — 6 suites / 44 tests

- `auth.spec.ts` — legacy login/refresh/logout/Bearer/RBAC كما كان.
- `auth-rate-limit.spec.ts` — حدود الدخول/التحديث لم تتأثر.
- `environment.spec.ts` — صحة env.
- `auth-cookie-config.spec.ts` — الأسماء/flags/Secure/Lax/HTTPS/fail-closed.
- `auth-cookie-mode.spec.ts` — 17 اختبارًا:
  - CSRF عشوائي.
  - رفض login بلا CSRF أو CSRF خاطئ.
  - تسجيل cookie mode، flags/Path/Max-Age/HttpOnly، لا tokens في JSON.
  - `/auth/me`.
  - رفض mutation بدون CSRF وقبولها معه.
  - رفض Origin خارج القائمة و`Sec-Fetch-Site: cross-site`.
  - تدوير refresh ورفض التوكن القديم.
  - رفض refresh/logout بدون CSRF.
  - تدوير متزامن [200, 401].
  - refresh + logout متزامنان.
  - رفض الخروج بدون CSRF ثم مسح الكوكيز.
  - عزل الموظفين.
  - تعطيل الحساب.
  - CORS credentials + Authorization + CSRF header.
  - dual mode: login بدون CSRF، Bearer، login مع CSRF، body refresh/logout.
  - عدم fallback من cookie غير صالحة إلى Bearer صالح.
- `cors-origins.spec.ts` — origins الدقيقة.

### 7.2 الانحدار المرتبط — 6 suites / 52 tests

```
security-hardening + properties-upload-hardening + properties-upload-limits
+ push-endpoint + push + notifications
→ 52/52 ناجحة
```

### 7.3 الفحوصات

| الفحص | النتيجة |
|---|---|
| Backend TypeScript | ✅ |
| Frontend TypeScript | ✅ |
| ESLint | ✅ 0 أخطاء |
| `nest build` | ✅ |
| `next build` | ✅ |

لم تُعد الحزمة الكاملة (683)؛ شُغّلت اختبارات المصادقة/الكوكيز + الانحدارات المرتبطة فقط.

---

## 8. ضمانات أمنية محققة

1. **لا cookie auth بدون CSRF**: login/refresh/logout والمهام غير الآمنة كلها تتحقق.
2. **لا access/refresh في JSON** في وضع `cookie`.
3. **Cookie Secure/Lax/Host-only/HttpOnly** للـaccess/refresh، وCSRF قابل للقراءة فقط.
4. **Origin/Referer/Fetch Metadata** مفروضة، وليست SameSite وحدها.
5. **CORS credentials** بأصل دقيق، وليس wildcard.
6. **Bearer لا يتجاوز cookie غير صالحة**؛ لا ambiguity.
7. **Legacy default** يعمل كما هو.
8. **الجلسات**: rotation/revocation/تعطيل/دور كما كانت.
9. **Fail closed**: production بلا Secure أو بـHTTP origin يوقف التشغيل.
10. **No logs** للتوكنات/الكوكيز/رؤوس الحماية.

---

## 9. القيود والمخاطر المتبقية

1. **الواجهة لم تُهاجر بعد**؛ لا تستخدم `dual/cookie` فعليًا. `legacy` هو الافتراضي.
2. **SameSite=Lax** يفترض same-site (مثل `app.example.com` + `api.example.com`). إذا كان النشر cross-site، ستحتاج `SameSite=None; Secure` وقرار مالك، مع قيود third-party cookies.
3. **لا CSP بعد**؛ XSS يمكنه إرسال طلبات مصادقة (لكن لا يقرأ HttpOnly tokens). يجب استكمال CSP.
4. **تعدد التبويبات** مُعالج على مستوى الخلفية (single-use refresh) لكن تنسيق Web Locks/BroadcastChannel في الواجهة لم يُنفذ بعد.
5. **Logout بدون اتصال**: لا يمكن للواجهة مسح HttpOnly cookies محليًا؛ ستحتاج retry/علامة logout-pending عند تنفيذ الواجهة.
6. **Cookies في الإنتاج** لم تُختبر على HTTPS فعلي؛ اختبارات الضمانات unit/HTTP فقط.
7. **Bearer لا يزال مقبولًا عند غياب الكوكي**؛ يمكن إيقافه لاحقًا بعد اكتمال الترحيل إذا لم توجد clients خارجية.
8. **الـCSRF توكن ليس مرتبطًا بجلسة مخزنة**؛ double-submit + `__Host-` + Origin/Fetch هو التصميم الحالي. يمكن إضافة HMAC/جلسة إن طلب المالك.
9. **Dev HTTP**: الكوكيز غير Secure محليًا فقط؛ الإنتاج fail closed.

---

## 10. خطوة الواجهة التالية (لا تُنفذ الآن)

1. إضافة `credentials:'include'` إلى `apiRequest`.
2. إضافة CSRF bootstrap من `/auth/csrf` وإرسال `X-CSRF-Token` لكل طلب غير آمن.
3. إزالة `sessionStorage` من `features/auth/session.ts`؛ استعادة الجلسة عبر `/auth/me` + refresh cookie.
4. ترحيل `arkan.auth.v1` القديم مرة واحدة عبر dual mode ثم مسحه.
5. تنفيذ Web Locks/BroadcastChannel لتعدد التبويبات والخروج.
6. تعديل `authorized.ts` بحيث 401 → refresh مرة واحدة، و403 CSRF لا يطلق refresh.
7. تعديل `push.ts` ورفع الصور/`blob` للعمل عبر cookies.
8. اختبار staging: login/refresh/logout، رفع الصور، الإشعارات، Web Push، تعدد التبويبات.
9. بعد الاستقرار: `AUTH_COOKIE_MODE=cookie` و`NEXT_PUBLIC_AUTH_MODE=cookie`.

---

## 11. قرارات مالك مطلوبة

1. طوبولوجيا النشر: same-site أم cross-site؟
2. مدة access/refresh (المقترح 15 دقيقة/7 أيام).
3. هل نُبقي Bearer API clients بعد الترحيل؟
4. SameSite=Lax أم None+Secure (حسب النطاق).
5. سلوك logout دون اتصال.
6. جدول CSP قبل/مع تفعيل cookies.
7. هل نضيف HMAC أو session-bound CSRF لاحقًا.
8. تأكيد أن `COOKIE_SECURE=true` و`FRONTEND_ORIGIN` HTTPS في الإنتاج.

**متوقف للمراجعة اليدوية قبل أي تفعيل أو تعديل واجهة.**
