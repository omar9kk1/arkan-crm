# المرحلة الأمنية الثانية — المهمة 3: خطة تقوية المصادقة والجلسات

**التاريخ:** 2026-11-06  
**المشروع:** `D:\Projects\arkan-crm`  
**النوع:** تشخيص وتصميم فقط — **لم يتم تعديل كود المصادقة**.  
**الحالة:** خطة جاهزة للمراجعة والموافقة قبل التنفيذ.

> لم يتم تعديل أي كود أو قاعدة بيانات أو migration أو credentials.  
> لم يتم تنفيذ reset أو seed أو commit أو push.  
> جميع إصلاحات تدقيق الأمان السابقة وحماية Web Push SSRF وMulter محفوظة.

---

## 1. البنية الحالية للمصادقة والجلسات

### 1.1 تدفق تسجيل الدخول

1. المتصفح يرسل `POST /auth/login` إلى NestJS (`apps/backend/src/auth/auth.controller.ts`).
2. `AuthService.login()`:
   - يقرأ `User.email/passwordHash/isActive`.
   - يتحقق من كلمة المرور بـ`scrypt` و`timingSafeEqual` (`auth/password.ts`).
   - يفتح transaction، يعيد قراءة الحساب، وينشئ **lineage جديدة** عبر `randomUUID()`.
   - ينشئ `RefreshToken` صفًا في قاعدة البيانات بمعرّف `sessionId` وتوكن عشوائي 48 بايت مجزّأ SHA-256.
   - يوقّع JWT وصول يحتوي `sub`, `role`, `sid`, مع `exp` و`iss` و`aud`.
3. الاستجابة الحالية: `{ accessToken, refreshToken, expiresIn }` في جسم JSON.
4. الواجهة تحفظ **الكل** في `sessionStorage` تحت `arkan.auth.v1` (`features/auth/session.ts`).

### 1.2 تدفق الطلبات

- `authorizedRequest()` (`lib/api/authorized.ts`) يقرأ access token من `sessionStorage` ويضيف `Authorization: Bearer ...`.
- `apiRequest()` (`lib/api-client.ts`) ينفذ `fetch` إلى `NEXT_PUBLIC_API_URL` دون `credentials`.
- `JwtAuthGuard` (`auth/guards/jwt-auth.guard.ts`):
  - يستخرج Bearer.
  - يتحقق من التوقيع والـclaims.
  - يقرأ `RefreshToken` بالـ`sid` ويتحقق من: المستخدم، عدم الإلغاء، عدم الانتهاء، `isActive`، وتطابق الدور.
  - يضع `request.user = { id, role, sessionLineageId }`.

### 1.3 تدوير Refresh Token

- `POST /auth/refresh` يقرأ `refreshToken` من الجسم.
- يبحث بالـhash، يقفل lineage بـadvisory lock، يعيد القراءة، ثم:
  - يستخدم `updateMany` شرطيًا لإبطال الصف (single-use).
  - ينشئ access + refresh جديدين في نفس lineage.
- إعادة استخدام التوكن القديم → 401.
- `POST /auth/logout` يبحث عن التوكن، يقفل lineage، ويبطل **كل صفوف العائلة**، ثم يسجل `AUTH_LOGOUT`.

### 1.4 الجلسات والأدوار

- تعطيل الحساب يلغي كل `RefreshToken` الخاصة به (`employees.service.ts`).
- `JwtAuthGuard` يتحقق من `user.isActive` ومن تطابق الدور في قاعدة البيانات، لذلك تغيير الدور/التعطيل يبطل الرموز الحالية عند الطلب التالي.
- Session lineage تُستخدم في Web Push: الاشتراك مربوط بـ`userId` + `lineageId`، والـpush يُرفض إذا لم توجد جلسة حية.

### 1.5 تعدد التبويبات والأجهزة

- `sessionStorage` **لكل تبويب**، لذلك:
  - كل تبويب يعمل بجلسة/توكنات مستقلة.
  - فتح تبويب جديد لا يشارك الجلسة.
  - تسجيل الخروج في تبويب لا يمس تبويبات أخرى محليًا (لكن قد يبطل lineage إن كان نفس التوكن).
- كل جهاز/متصفح يحصل على lineage مستقلة عبر login منفصل.

### 1.6 Web Push والإشعارات

- `features/notifications/push.ts` يستخدم `authorizedRequest` (أي Bearer حاليًا).
- `PUT /push/subscriptions` يربط الـendpoint بـ`userId` + `sessionLineageId` المستخرج من الجلسة.
- `PushService.deliver()` يقرأ الإشعارات المخزنة ويرسلها إلى اشتراكات المستلم.
- Service Worker (`public/sw.js`) لا يقرأ توكنات ولا يخزنها؛ يعرض push ويفتح رابطًا داخليًا.
- `PushDispatcherService` يقرأ `Notification` rows ويرسل push.

### 1.7 الملفات الأمامية والخلفية المتأثرة حاليًا

**الخلفية:**
- `apps/backend/src/auth/auth.controller.ts`
- `apps/backend/src/auth/auth.service.ts`
- `apps/backend/src/auth/auth.module.ts`
- `apps/backend/src/auth/guards/jwt-auth.guard.ts`
- `apps/backend/src/auth/guards/roles.guard.ts`
- `apps/backend/src/auth/dto/login.dto.ts`, `refresh-token.dto.ts`
- `apps/backend/src/main.ts`
- `apps/backend/src/common/configure-app.ts`
- `apps/backend/src/config/environment.ts`
- `apps/backend/src/config/cors-origins.ts`
- `apps/backend/src/push/*` (تسجيل/إلغاء/test)
- `apps/backend/src/properties/properties.controller.ts` (صور ورفع)
- جميع Controllers الأخرى (الحماية عالمية + CSRF لاحقًا)
- `apps/backend/.env.example`

**الواجهة:**
- `apps/frontend/features/auth/session.ts` (sessionStorage + refresh + logout)
- `apps/frontend/features/auth/api/auth-api.ts`
- `apps/frontend/features/auth/components/auth-provider.tsx`
- `apps/frontend/features/auth/components/logout-button.tsx`
- `apps/frontend/lib/api-client.ts`
- `apps/frontend/lib/api/authorized.ts`
- `apps/frontend/lib/api/properties-api.ts` (صور blob)
- `apps/frontend/lib/api/*` (كل المسارات تمر عبر `authorizedRequest`)
- `apps/frontend/features/notifications/push.ts`
- `apps/frontend/features/notifications/store.ts` (حدث انتهاء الجلسة والمزامنة)
- `apps/frontend/public/sw.js` (مراجعة فقط — لا يجب أن يقرأ توكنات)
- `packages/shared/src/dto/auth.ts` (`AuthUser`, `TokenPair`)
- `apps/frontend/next.config.ts` (CSP لاحقًا)

---

## 2. المخاطر المؤكدة في البنية الحالية

| # | الخطر | الدليل | الأثر |
|---|---|---|---|
| R1 | access وrefresh tokens في `sessionStorage` | `session.ts` | أي XSS يستطيع قراءة التوكنين وتصديرهما؛ refresh صالح 7 أيام = اختطاف جلسة كامل |
| R2 | لا توجد حماية HttpOnly | `sessionStorage` | لا يوجد حاجز ضد JavaScript |
| R3 | لا CSP | `next.config.ts` يحتوي رؤوسًا لكن ليس CSP | يزيد احتمال XSS ويجعل R1 أخطر |
| R4 | Access token طويل العمر نسبيًا | 900 ثانية | نافذة إعادة استخدام عند التسريب |
| R5 | Refresh token مكشوف للواجهة | جسم JSON + sessionStorage | يمكن تصديره بسهولة |
| R6 | لا CSRF حاليًا | Bearer header وليس cookie | ليس خطرًا الآن، لكنه يصبح خطرًا مباشرًا عند الانتقال إلى cookies |
| R7 | تعدد التبويبات غير متزامن | sessionStorage لكل تبويب | جلسات متعددة، refresh races محتملة عند مشاركة cookies لاحقًا |
| R8 | Logout يعتمد على مسح التخزين المحلي | `session.ts` | مع HttpOnly cookies لا يمكن للواجهة مسح الكوكي محليًا إذا فشل الاتصال بالخادم |
| R9 | CORS الحالي لا يفعّل credentials | `main.ts` | يجب تعديل دقيق عند إضافة cookies، دون wildcard |
| R10 | عدم وجود ربط CSRF بالجلسة | — | يجب تصميم synchronizer/double-submit قبل تفعيل cookies |

**ملاحظة:** لا يوجد حاليًا تسريب tokens في URL أو logs أو استجابات إشعارات. عند التصميم يجب إبقاء ذلك.

---

## 3. مقارنة الحلول

### الخيار A — Cookies آمنة من NestJS مباشرة (موصى به)

**الفكرة:** يظل NestJS هو مصدر الجلسة، لكنه يضع access/refresh في HttpOnly cookies، والواجهة تستدعي API مباشرة مع `credentials: 'include'` وCSRF.

**المزايا:**
- أقل تغيير معماري: نفس الـAPI والمسارات والـDTOs.
- لا حاجة لبناء proxy لكل الطلبات أو للـmultipart/الصور.
- يبقي المصادقة في مكان واحد (NestJS) ويحافظ على RBAC وaudit.
- يسمح بإبقاء Bearer مؤقتًا في وضع dual للترحيل والاختبارات.
- لا يتطلب تغيير قاعدة البيانات أو ترقية Nest.

**العيوب:**
- يحتاج CSRF كاملًا وOrigin/Fetch Metadata.
- يحتاج CORS مع `credentials: true` و`SameSite` مناسبًا.
- إذا كان النطاقان **cross-site** (وليسا same-site)، فكوكيز `SameSite=None` قد تتعارض مع قيود المتصفحات وthird-party cookies.
- Logout بدون اتصال بالخادم لا يمكنه مسح HttpOnly cookies محليًا.

### الخيار B — Next.js BFF

**الفكرة:** المتصفح يتحدث إلى Next.js same-origin فقط (`/api/*`)، وNext.js يخزن الجلسة ويمرر Bearer إلى NestJS.

**المزايا:**
- لا cross-origin cookies، وCSRF أبسط (same-origin).
- يمكن إخفاء access/refresh تمامًا عن المتصفح (server-side session).
- CSP أسهل نسبيًا.

**العيوب:**
- يتطلب proxy/catch-all لكل مسارات API، بما فيها multipart uploads، image blobs، pagination، error envelope، وربما streaming.
- يضيف طبقة حالة/نشر جديدة (Next server يجب أن يعمل دائمًا للـAPI).
- يحتاج إدارة refresh server-side وتزامنها مع كل الطلبات.
- سطح هجوم/تعقيد أكبر، وتغيير واسع لكل `lib/api/*`.
- لا يحل مشكلة XSS في الواجهة نفسها؛ XSS يمكنه إرسال طلبات عبر BFF.

### التوصية

**الخيار A**، بشرط أن يكون النشر الإنتاجي **same-site** (مثل `app.example.com` و`api.example.com`، أو same-origin عبر reverse proxy).  
إذا كان النطاقان مختلفين تمامًا (cross-site) ولا يمكن توحيدهما، فالتوصية البديلة هي **BFF** أو وضع الاثنين خلف origin واحد (وهو عمليًا الخيار A same-origin). لا يُنصح بـBFF كخطوة أولى بسبب التعقيد.

---

## 4. التصميم المقترح للكوكيز وCSRF

### 4.1 الكوكيز

| الكوكي | القيمة | HttpOnly | Secure | SameSite | Path | Max-Age | ملاحظات |
|---|---|---|---|---|---|---|---|
| Access | JWT access | ✅ | ✅ prod | Lax | `/` | 900s | `__Host-arkan_access` في الإنتاج |
| Refresh | opaque 48-byte | ✅ | ✅ prod | Lax | `/auth` | 7 أيام | `__Secure-arkan_refresh` (Path ليس `/` لذلك لا يصلح `__Host-`) |
| CSRF | random 32-byte | ❌ (يقرأها JS) | ✅ prod | Lax | `/` | 7 أيام | `__Host-arkan_csrf` في الإنتاج |

- **Domain:** لا يُضبط (host-only)، لمنع cookie tossing من نطاقات فرعية أخرى.
- **الإنتاج:** `Secure=true`، أسماء `__Host-`/`__Secure-`.
- **التطوير:** `Secure=false`، أسماء `arkan_dev_access`/`arkan_dev_refresh`/`arkan_dev_csrf`، `SameSite=Lax`.
- **`Cache-Control: no-store`** على كل استجابة تصدر/تمسح كوكيز المصادقة.
- **`Expires`/`Max-Age=0`** عند المسح، بنفس Path/SameSite/Secure.
- **Access cookie قصير العمر** لتقليل نافذة إعادة الاستخدام؛ refresh طويل لكنه HttpOnly وsingle-use.
- لا يتم إرجاع access/refresh في JSON إطلاقًا بعد اكتمال الترحيل.

### 4.2 لماذا SameSite وحده لا يكفي

- `SameSite=Lax` لا يمنع كل CSRF (خصوصًا same-site subdomain attacks أو المتصفحات القديمة/السلوك المختلف).
- لذلك يُضاف:
  1. **CSRF double-submit**: cookie + `X-CSRF-Token` header.
  2. **Origin/Referer validation** على كل طلب غير آمن.
  3. **Fetch Metadata**: رفض `Sec-Fetch-Site: cross-site`، وقبول `same-origin`/`same-site`.
  4. **Custom header** يجبر preflight في الطلبات cross-origin.
  5. **`__Host-`** لمنع cookie injection من نطاقات فرعية.

### 4.3 تدفق CSRF

1. عند فتح التطبيق (أو قبل login): `GET /auth/csrf` (public) → يضع كوكي CSRF ويعيد `{ csrfToken }`.
2. الواجهة تحتفظ بالتوكن **في الذاكرة فقط** (لا sessionStorage).
3. كل طلب `POST/PUT/PATCH/DELETE` يرسل `X-CSRF-Token`.
4. الخادم يتحقق:
   - وجود الكوكي + header.
   - تطابقهما بـ`timingSafeEqual`.
   - `Origin` ضمن القائمة الدقيقة (أو Referer بنفس الأصل).
   - `Sec-Fetch-Site` ليس `cross-site`.
5. `GET/HEAD/OPTIONS` آمنة ولا تحتاج CSRF.
6. Login/refresh/logout نفسها تتطلب CSRF؛ Login CSRF خطر حقيقي.
7. يتم تدوير CSRF token عند login (منع fixation)، ويُعاد في استجابة login أو عبر `/auth/csrf`.

**ملاحظة:** إذا كان API على نطاق فرعي مختلف، كوكي `__Host-` خاص بالـAPI ولا تستطيع JS في نطاق الواجهة قراءته. لذلك تُعاد قيمة CSRF في JSON من `/auth/csrf` وتُحفظ في الذاكرة — وهي ليست سر مصادقة.

### 4.4 CORS

```text
credentials: true
origin: القائمة الدقيقة من FRONTEND_ORIGIN (لا *)
allowedHeaders: Content-Type, X-CSRF-Token, Idempotency-Key
methods: GET, POST, PATCH, PUT, DELETE, OPTIONS
maxAge: 600
```

- `Vary: Origin`.
- لا `Access-Control-Allow-Credentials` مع wildcard.
- في same-origin deployment لا حاجة لـCORS أصلًا.
- لا يُسمح بـ`Authorization` كبديل دائم؛ فقط في dual mode أثناء الترحيل.

### 4.5 بيئات التشغيل

- **التطوير:** `http://localhost:3000` و`http://localhost:4000` same-site؛ `Secure=false`؛ Lax.
- **الإنتاج الموصى به:** HTTPS، `app.example.com` + `api.example.com` (same-site)؛ `Secure=true`؛ Lax؛ host-only cookies.
- **إذا كان cross-site:** `SameSite=None; Secure` مع الوعي بقيود third-party cookies؛ يفضل reverse proxy لتوحيد الأصل بدل ذلك.
- **HSTS وTLS** على reverse proxy؛ لا تعتمد على `X-Forwarded-Proto` دون `trust proxy` مضبوط.

### 4.6 الجلسات والتدوير والإلغاء

- Login ينشئ **lineage جديدة** دائمًا (لا reuse).
- Refresh يدوّر التوكن ويبقي نفس lineage.
- Access token مرتبط بـ`sid` لصف الجلسة؛ إبطال الصف يبطل access فورًا.
- Logout يبطل كل صفوف lineage ويمسح الكوكيز.
- تعطيل الحساب يبقي السلوك الحالي: إبطال كل refresh tokens ورفض access.
- تغيير الدور: `JwtAuthGuard` يرفض الدور القديم؛ refresh جديد يحمل الدور الجديد.
- لا حاجة لتغيير schema أو migration.

### 4.7 تعدد التبويبات والتدوير المتزامن

الكوكيز مشتركة بين التبويبات، لذا يجب منع race على refresh single-use:

1. **Web Locks API** (`navigator.locks.request('arkan-auth-refresh', ...)`) في `session.ts`:
   - عند الحاجة للـrefresh، اطلب القفل.
   - بعد الحصول عليه، استدعِ `GET /auth/me` أولًا.
   - إذا نجح (تبويب آخر جدّد بالفعل) → لا refresh.
   - إذا 401 → نفّذ refresh مرة واحدة.
2. تبويبات أخرى تنتظر القفل، ثم تعيد `/auth/me` وتستخدم الكوكيز المحدثة.
3. **Fallback** للمتصفحات القديمة:
   - BroadcastChannel لتنسيق محاولة واحدة.
   - أو retry محدود: بعد 401، انتظر 150–300ms ثم `/auth/me`؛ لا تكرر refresh أكثر من مرة.
4. Logout في تبويب يبث `arkan:logout` عبر BroadcastChannel؛ التبويبات الأخرى تمسح الحالة في الذاكرة وتعيد التوجيه، دون محاولة refresh.
5. `SESSION_EXPIRED_EVENT` الحالي يبقى داخل التبويب؛ يُضاف حدث cross-tab.

**لا يُنصح** بإضافة جدول/أعمدة refresh-grace في هذه المرحلة؛ Web Locks + retry يغطي الحالة دون migration.

### 4.8 Session Fixation وReplay

- Login لا يثق بأي session id من العميل؛ ينشئ `randomUUID` lineage و`sessionId`.
- إذا كانت هناك كوكيز قديمة/مختلفة، تُستبدل بالكامل.
- Refresh token single-use + hash في DB، فلا يمكن replay بعد التدوير.
- Access token قصير + `sid` مرتبط بصف حي.
- CSRF يمنع login CSRF وforced logout/refresh.
- `__Host-` يمنع cookie tossing من subdomain.
- TLS يمنع الاعتراض.

### 4.9 Web Push والتوافق

- لا يتغير بروتوكول Push نفسه.
- `PushService` يستمر في أخذ `sessionLineageId` من `JwtAuthGuard`، لكنه سيأتي من كوكي access بدل Bearer.
- `ensurePushBinding()` سيعمل عبر cookies + CSRF.
- Service Worker لا يحتاج أي توكن؛ push provider → browser لا يمر عبر API.
- Logout: يجب استدعاء `disablePush()` قبل `/auth/logout` (كما هو الآن)؛ إذا فشل الاتصال، سيبقى اشتراك push حتى تنظفه الجلسة الميتة/الخادم.
- بعد الترحيل، `lineageId` تظل كما هي في DB؛ لا migration.

---

## 5. الملفات والـendpoints المطلوب تغييرها

### 5.1 Backend — endpoints

| Endpoint | التغيير |
|---|---|
| `POST /auth/login` | يضع access/refresh/CSRF cookies؛ يعيد `{ user, csrfToken, expiresIn }` فقط |
| `POST /auth/refresh` | يقرأ refresh cookie؛ يدوّر ويضع cookies؛ يعيد `{ user, csrfToken, expiresIn }` |
| `POST /auth/logout` | يقرأ refresh cookie؛ يبطل lineage؛ يمسح cookies |
| `GET /auth/me` | كما هو (يعتمد على cookie access) |
| `GET /auth/csrf` | **جديد** — عام؛ يصدر CSRF cookie + token |
| كل `POST/PUT/PATCH/DELETE` | CSRF Guard عالمي + Origin/Fetch Metadata |
| `GET /properties/:id/image` | auth cookie + `credentials` من الواجهة |
| `PUT/DELETE /push/subscriptions`, `POST /push/test` | cookie + CSRF |
| باقي endpoints | لا تغيير في العقد؛ فقط auth/CSRF عالمي |

### 5.2 Backend — ملفات

- `auth/auth.controller.ts` — `@Res({ passthrough: true })` للكوكيز، endpoints جديدة.
- `auth/auth.service.ts` — فصل إرجاع الجلسة عن HTTP (لا يعرف `Response`).
- `auth/auth.module.ts` — providers للـCookie/Csrf، تسجيل `CsrfGuard` كـ`APP_GUARD`.
- `auth/guards/jwt-auth.guard.ts` — قراءة access cookie + Bearer fallback مؤقت.
- **جديد** `auth/cookie.service.ts` — أسماء/خيارات/إصدار/مسح.
- **جديد** `auth/csrf.service.ts` + `auth/guards/csrf.guard.ts`.
- **جديد** `auth/request-origin.ts` (Or إنشاء داخل CSRF service).
- `config/environment.ts` — `AUTH_COOKIE_MODE`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `CSRF_SECRET?`, `TRUST_PROXY`.
- `main.ts` — CORS `credentials:true`، allowed headers.
- `common/configure-app.ts` — cookie parser/CSRF guard إن لزم.
- `push/*` — لا تغيير منطقي، فقط CSRF/الكوكيز تمر تلقائيًا.
- `.env.example` — أسماء المتغيرات دون أسرار.
- Tests.

**اعتمادية محتملة:** `cookie-parser` أو استخدام حزمة `cookie` الموجودة transitive. يفضل إضافة اعتمادية مباشرة صغيرة بدل parser يدوي؛ قرار مالك.

### 5.3 Frontend — ملفات

- `features/auth/session.ts` — إزالة `sessionStorage`، حفظ user في الذاكرة، refresh عبر cookie، Web Locks/BroadcastChannel.
- `features/auth/api/auth-api.ts` — login/refresh/logout/csrf بدون tokens.
- `features/auth/components/auth-provider.tsx` — `restoreSession` عبر `/auth/me`؛ لا tokens.
- `features/auth/components/logout-button.tsx` — التعامل مع فشل logout (retry/رسالة).
- `lib/api-client.ts` — `credentials:'include'`، `X-CSRF-Token` للطرق غير الآمنة، إزالة Authorization تدريجيًا.
- `lib/api/authorized.ts` — لا precondition للتوكن؛ 401 → refresh مرة واحدة؛ 403 CSRF لا يطلق refresh.
- `lib/api/properties-api.ts` — الصور/blob مع credentials.
- `features/notifications/push.ts` — PUT/DELETE/POST عبر CSRF تلقائي.
- `features/notifications/store.ts` — استقبال logout cross-tab.
- `public/sw.js` — مراجعة/تأكيد عدم وجود توكنات (لا تغيير متوقع).
- `packages/shared/src/dto/auth.ts` — إزالة/تقييد `TokenPair` بعد الترحيل.
- `next.config.ts` — CSP/HSTS لاحقًا (خارج هذه المهمة لكن مرتبط).

### 5.4 الملفات التي لا تحتاج تغييرًا منطقيًا

- جميع صفحات Manager/Employee وRTL/Astra-glass.
- Property P/A numbering، duplicates، approvals، trash، follow-ups، client reviews، dashboards.
- الإشعارات in-app وWeb Push delivery.
- `sw.js` (بعد التأكد).
- Database schema (لا migration).

---

## 6. خطة التنفيذ الآمنة المرحلية

### المرحلة 0 — تجهيز وقرارات

- تأكيد طوبولوجيا النطاقات (same-site vs cross-site).
- اختيار أسماء/بادئات الكوكيز ومدد الحياة.
- إضافة متغيرات بيئة (قيم تطوير فقط) واختبارات cookie parser.
- لا تغيير سلوك المستخدم بعد.

### المرحلة 1 — Backend dual mode (بدون كسر)

- إضافة `AUTH_COOKIE_MODE=legacy|dual|cookie` (الافتراضي `legacy`).
- في `dual`:
  - Login/refresh يضعان cookies **و**يعيدان tokens في JSON (للتوافق).
  - Guard يقبل cookie أولًا ثم Bearer.
  - Logout يقبل cookie أو body token.
- إضافة `/auth/csrf` وCSRF Guard، لكن تفعيله الكامل في `dual` للطلبات التي تستخدم cookies فقط؛ Bearer clients تبقى مسموحة مؤقتًا.
- اختبارات backend فقط؛ لا تغيير واجهة.

### المرحلة 2 — Frontend cookie mode

- إضافة `NEXT_PUBLIC_AUTH_MODE=legacy|dual|cookie`.
- في `cookie`:
  - `apiRequest` يضيف `credentials:'include'`.
  - `session.ts` لا يقرأ/يكتب tokens.
  - CSRF bootstrap + header.
  - Web Locks/BroadcastChannel.
- **ترحيل الجلسة القديمة:** إذا وُجد `arkan.auth.v1`، استخدم refresh token القديم مرة واحدة عبر dual mode للحصول على cookies، ثم امسح التخزين. إذا فشل، امسحه واطلب login.
- اختبار staging كامل: login، refresh، logout، رفع صور، إشعارات، push، تعدد تبويبات.

### المرحلة 3 — Cookie-only

- `AUTH_COOKIE_MODE=cookie` و`NEXT_PUBLIC_AUTH_MODE=cookie`.
- إيقاف إرجاع access/refresh في JSON.
- إيقاف قبول Bearer من المتصفح (يمكن إبقاءه لـCLI بقرار منفصل).
- تفعيل CSRF لكل الطلبات غير الآمنة.
- مراقبة 401/403/refresh errors.

### المرحلة 4 — تنظيف

- حذف `TokenPair` من الواجهة إن لم يعد مستخدمًا.
- حذف مسار body tokens من refresh/logout بعد نافذة ترحيل.
- إبقاء legacy cleanup لمفتاح `arkan.auth.v1` لمدة إصدار واحد.
- تحديث التوثيق و`.env.example`.

### الرجوع (Rollback)

- إعادة `AUTH_COOKIE_MODE=legacy` و`NEXT_PUBLIC_AUTH_MODE=legacy`؛ الكود يظل dual-capable.
- لا حاجة لعكس migration (لا يوجد).
- الكوكيز يمكن مسحها عند login التالي؛ لا فقدان بيانات.
- في حال مشكلة CSRF، يمكن تعطيل cookie mode مع إبقاء Bearer مؤقتًا.
- لا rollback لقاعدة البيانات.

---

## 7. خطة اختبارات الأمان والانحدار

### 7.1 الكوكيز

- `Set-Cookie` في login/refresh:
  - access: HttpOnly, Secure في prod, SameSite=Lax, Path=/, Max-Age=900, `__Host-`.
  - refresh: HttpOnly, Secure, Path=/auth, Max-Age=7d, `__Secure-`.
  - CSRF: غير HttpOnly، Secure prod، Path=/، `__Host-`.
- في dev: لا `Secure`، أسماء dev.
- لا access/refresh tokens في JSON بعد cookie-only.
- `document.cookie` لا يحتوي access/refresh (اختبار متصفح/وحدة).
- مسح الكوكيز عند logout و`Cache-Control: no-store`.

### 7.2 CSRF وOrigin

- POST بدون header → 403.
- Header مختلف عن cookie → 403.
- Cookie موجود والheader غائب → 403.
- Origin `evil.example` → 403.
- Referer خارج القائمة → 403.
- `Sec-Fetch-Site: cross-site` → 403.
- `same-origin`/`same-site` مع token صحيح → 200/201.
- GET/HEAD لا تتأثر.
- Login/refresh/logout محمية.
- CSRF token rotation عند login.

### 7.3 الجلسات

- Login ينجح ويعيد user.
- Refresh يدوّر؛ التوكن القديم 401.
- Logout يبطل lineage ويمسح الكوكيز؛ access القديم 401.
- Access منتهي → refresh مرة واحدة؛ لا loop.
- Refresh منتهي/ملغي → 401 ومسح حالة.
- تعطيل الحساب يبطل الجلسة.
- تغيير الدور يرفض الدور القديم.
- Session fixation: كوكي قديم/مزروع لا يُعاد استخدامه بعد login.
- Replay: refresh token قديم لا ينجح.

### 7.4 التزامن والتبويبات

- طلبان متزامنان على 401: refresh واحد فقط؛ كلاهما ينجح بعد retry.
- Web Locks: تبويبان يتشاركان cookies؛ واحد يجدد، الآخر يستخدم `/me`.
- Fallback: retry محدود دون logout loop.
- Logout في تبويب يبث حدثًا ويصفّر الآخر.
- Push binding بعد refresh/login يظل صحيحًا.

### 7.5 الصلاحيات والوظائف

- Manager/Employee login وrole routing.
- Manager-only endpoints ترفض الموظف (403).
- الخصائص والعملاء والمتابعات والمراجعات والـtrash تعمل عبر cookies.
- رفع/استبدال الصور يعمل مع multipart + CSRF.
- اعتماد المدير بعد تغيير الصورة.
- الإشعارات والـbell وWeb Push وclick URL.
- عدم كسر P/A numbering أو duplicate detection.

### 7.6 Dev/Prod وCORS

- Preflight `OPTIONS` يعيد origin الصحيح + credentials.
- لا wildcard.
- Cookie `Secure` في prod فقط.
- `SameSite` حسب القرار.
- لا قبول لـcross-site origins.

### 7.7 عدم تسريب الأسرار

- لا access/refresh في JSON النهائي.
- لا tokens/CSRF في logs.
- لا Authorization في query strings.
- `Set-Cookie` لا يظهر في body.
- اختبار لقطات logs.

**ملاحظة:** اختبارات `supertest` لا تفرض SameSite فعليًا؛ يلزم اختبار متصفح (Playwright غير مثبت حاليًا) أو فحص يدوي في staging لسلوك SameSite/third-party cookies.

---

## 8. قرارات المالك المطلوبة

1. **طوبولوجيا النطاقات الإنتاجية:** هل `app` و`api` على نفس الموقع (subdomains) أم cross-site؟ التوصية: same-site أو reverse proxy.
2. **الاحتفاظ بـBearer API clients:** هل يوجد CLI/تكامل خارجي يحتاج Authorization؟ إذا نعم، تمديد dual mode بمدة محددة.
3. **مدة الجلسات:** access 15 دقيقة وrefresh 7 أيام مقترحة (الحالية).
4. **SameSite:** Lax (موصى) أو None+Secure إن كان cross-site.
5. **اعتمادية cookie parser:** إضافة `cookie-parser`/`cookie` مباشرة أم parser داخلي.
6. **Logout دون اتصال:** هل نقبل عرض خطأ وإبقاء الجلسة حتى retry، أم نستخدم علامة `logout-pending` غير حساسة؟
7. **CSRF:** double-submit + `__Host-` + Origin/Fetch (موصى) أم synchronizer token مخزّن في DB/Redis.
8. **CSP:** جدولتها ضمن نفس الإصدار أم منفصلة (موصى: قبل أو مع cookie rollout).
9. **Web Locks fallback:** هل ندعم متصفحات قديمة بتأخير/retry أم نفترض المتصفحات الحديثة؟

---

## 9. الخلاصة

- البنية الحالية سليمة في التدوير والتحقق، لكنها تعتمد على `sessionStorage` وتعرض access/refresh لأي XSS.
- **الخيار A (Nest HttpOnly cookies + CSRF)** هو الأقل خطرًا والأقل تغييرًا، ويحافظ على كل الوظائف.
- الانتقال يجب أن يكون **مرحليًا (legacy → dual → cookie)** مع إبقاء Bearer مؤقتًا للترحيل والاختبارات.
- لا حاجة إلى migration أو ترقية Nest؛ التغيير في طبقة HTTP/الواجهة.
- لا ينبغي اعتبار SameSite حماية كافية؛ CSRF + Origin + Fetch Metadata + `__Host-` ضرورية.
- أكبر المخاطر المتبقية بعد التنفيذ: XSS (يجب CSP)، وقيود cross-site cookies، وعدم القدرة على مسح HttpOnly cookies محليًا عند logout دون اتصال.

**متوقف للمراجعة والموافقة قبل التنفيذ.**
