# المرحلة الأمنية الثانية — المهمة 5: تقوية Rate Limiting وTrust Proxy

**التاريخ:** 2026-11-07  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** حدود الطلبات ومعالجة proxy فقط.  
**الحالة:** منفّذ ومختبر محليًا — بانتظار المراجعة.  
**وضع التطبيق:** Cookies/CSRF نشطة، CSP Report-Only، Trust Proxy معطّل، Redis storage غير مفعّل افتراضيًا.

> لم تُعدّل بيانات أعمال أو قاعدة البيانات.  
> لم يتم تعديل `.env` أو `.env.local` الفعلي.  
> لا migrations/resets/seeds، ولا commits/pushes.  
> Cookie/CSRF وCSP pipeline وSSRF/Multer محفوظة.

---

## 1. الحماية السابقة مقابل الجديدة

### سابقًا

- `POST /auth/login`: حد محلي 10 طلبات/60s لكل IP.
- `POST /auth/refresh`: حد محلي 30/60s لكل IP.
- لا حماية عامة لباقي الـendpoints.
- لا معالجة `trust proxy`؛ `X-Forwarded-For` غير موثوق.
- الطلبات الم authenticated لا تميّز بين مستخدم وآخر خلف نفس IP.

### جديدًا

- Guard عام لكل الـendpoints، keyed بـ**verified user** عند وجوده، وIP عند عدمه.
- حدود خاصة إضافية للـendpoints الحساسة/المكلفة.
- Login/Refresh يحتفظان بGuard محلي IP، والGuard العام **يتخطاهما** لمنع تكديس الحدود.
- Trust Proxy معطّل افتراضيًا، ولا يُقبل `true`/`*` أو hostnames.
- Redis-backed limiter اختياري ومختبر، غير مفعّل في `.env` الحالي.
- `Retry-After` و`X-RateLimit-*` من Nest Throttler.

---

## 2. سياسات الـendpoints

جميع الحدود قابلة للضبط؛ الافتراضي نافذة 60 ثانية.

| Endpoint | الحد | المفتاح | ملاحظات |
|---|---:|---|---|
| `POST /auth/login` | 10/min | IP | Guard محلي IP؛ الـGuard العام يتخطاه |
| `POST /auth/refresh` | 30/min | IP | Guard محلي IP؛ لا تكديس |
| `GET /auth/csrf` | 60/min | IP | Bootstrap عام |
| كل الطلبات الموثقة | 600/min | `user:<verified id>` | يشمل dashboards/polling/navigation العادي |
| الطلبات العامة غير الموثقة | 600/min | IP | CSRF له حد خاص أدق |
| `GET /properties` | 120/min | user | قراءة قائمة مكلفة |
| `POST /properties` | 20/min | user | multipart upload |
| `PATCH /properties/:id` | 20/min | user | تعديل/استبدال صورة |
| `PUT /push/subscriptions` | 20/min | user | تسجيل جهاز |
| `DELETE /push/subscriptions` | 20/min | user | إلغاء جهاز |
| `POST /push/test` | 5/min | user | إرسال Push تجريبي |

### الضبط عبر البيئة

```env
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_GLOBAL_PER_MIN=600
RATE_LIMIT_LOGIN_PER_MIN=10
RATE_LIMIT_REFRESH_PER_MIN=30
RATE_LIMIT_CSRF_PER_MIN=60
RATE_LIMIT_EXPENSIVE_READ_PER_MIN=120
RATE_LIMIT_UPLOAD_PER_MIN=20
RATE_LIMIT_PUSH_REGISTER_PER_MIN=20
RATE_LIMIT_PUSH_TEST_PER_MIN=5
```

- القيم تُقرأ وقت الطلب، فلا تحتاج rebuild.
- القيم غير الصالحة ترجع للافتراضي الآمن.
- `Retry-After` يُعاد مع 429، إضافة إلى `X-RateLimit-Limit/Remaining/Reset`.

### مفتاح التتبع

- **Authenticated**: `request.user.id` من JWT الذي وضعه `JwtAuthGuard`؛ لا يُستخدم أي header أو body كمصدر هوية.
- **Anonymous**: `request.ip` بعد تطبيع IPv6، ثم SHA-256 داخل Throttler.
- لا يتم تخزين user id أو IP خام في Redis؛ المفتاح النهائي hash من Nest.
- Login/refresh يظلان IP-keyed لأن الهوية غير مؤكدة بعد؛ هذا يحد brute-force لكنه يشارك office NAT (مقيد وموثق).

### التنسيق مع polling

- إشعارات: كل 15s.
- property/dashboard sync: كل 20s.
- افتراضي 600/min للمستخدم يستوعب عدة تبويبات، مع حدود 120 للقراءات المكلفة.
- اختبار 15+15 طلب إشعارات + 5 قوائم عقارات نجح بالكامل.

---

## 3. Trust Proxy

- `TRUST_PROXY` غير مضبوط → **معطّل**.
- لا يُقبل `true` أو `*` أو hostnames.
- يُقبل فقط قائمة صريحة من IPv4/IPv6/CIDR:
  ```env
  TRUST_PROXY=127.0.0.1/32,::1/128
  ```
- التطبيق يفشل عند القيمة غير الصالحة بدل الاعتماد على إعداد غير آمن.
- لا يُستخدم `X-Forwarded-For/Host/Proto` إلا بعد تطابق العنوان الفعلي مع قائمة proxies الموثوقة وقواعد Express.
- اختبارات:
  - XFF مُزوّر مع trust معطّل → `req.ip` يبقى عنوان الاتصال، والبروتوكول/الهوست لا يتأثران.
  - IPv4 وIPv6 وCIDR صريحة تعمل عند تفعيلها.
  - `true`, `*`, hostnames, prefix خارج النطاق → مرفوضة.

---

## 4. Redis / التوزيع

- Redis الموجودة (BullMQ) يمكن أن تستضيف العدادات.
- تم تنفيذ `RedisThrottlerStorage`:
  - Lua atomic: INCR + PEXPIRE + block SET PX.
  - مفاتيح namespaced (`arkan:rate-limit:` افتراضيًا أو `RATE_LIMIT_KEY_PREFIX`).
  - TTL للعداد وTTL للـblock؛ لا صفوف دائمة.
  - `RATE_LIMIT_STORAGE=redis` لتفعيله؛ الافتراضي `memory`.
- اختبارات Redis:
  - **4/4** storage (limit/block/concurrency/expiry/disabled).
  - **1/1** app integration عبر Redis (429 + Retry-After + recovery).
- **غير مفعّل في التطبيق المحلي الفعلي**؛ لا تغيير في `.env`.
- في بيئة multi-instance يجب `RATE_LIMIT_STORAGE=redis`؛ memory-only لا توفر حماية موزعة ويجب عدم ادعاء ذلك.

---

## 5. الملفات المعدّلة

| الملف | التغيير |
|---|---|
| `apps/backend/src/common/guards/app-throttler.guard.ts` | **جديد** — global user/IP guard، skip OPTIONS/login/refresh |
| `apps/backend/src/common/rate-limit/redis-throttler.storage.ts` | **جديد** — Redis atomic storage |
| `apps/backend/src/common/rate-limit/rate-limit.module.ts` | **جديد** — provider wiring |
| `apps/backend/src/config/rate-limit.ts` | **جديد** — حدود قابلة للضبط |
| `apps/backend/src/config/trust-proxy.ts` | **جديد** — parser وتحقق |
| `apps/backend/src/auth/auth.module.ts` | Throttler async + global guard |
| `apps/backend/src/auth/auth.controller.ts` | Login/Refresh/CSRF policies |
| `apps/backend/src/properties/properties.controller.ts` | List/upload limits |
| `apps/backend/src/push/push.controller.ts` | Registration/test limits |
| `apps/backend/src/common/configure-app.ts` | Trust proxy application |
| `apps/backend/src/config/environment.ts` | Rate/proxy/Redis env validation |
| `apps/backend/.env.example` | توثيق المتغيرات (بدون أسرار) |
| `apps/backend/package.json` + lock | `ioredis` صريح (5.x) |
| `apps/backend/test/trust-proxy.spec.ts` | **جديد** — 6 اختبارات |
| `apps/backend/test/rate-limit-policies.spec.ts` | **جديد** — 7 اختبارات |
| `apps/backend/test/redis-throttler-storage.spec.ts` | **جديد** — 4 اختبارات |
| `apps/backend/test/rate-limit-redis-integration.spec.ts` | **جديد** — 1 اختبار |
| `apps/backend/test/property-duplicate-priority.spec.ts` | reset limiter بين اختبارات الرفع |

لم يتغير frontend أو UI أو CSP.

---

## 6. الاختبارات

| الفحص | النتيجة |
|---|---|
| Full backend suite | **76 suites / 769 tests** ✅ |
| Rate-limit policies | **7/7** ✅ |
| Trust proxy | **6/6** ✅ |
| Redis storage | **4/4** ✅ |
| Redis app integration | **1/1** ✅ |
| Login 429 + Retry-After + recovery | ✅ |
| Forged XFF | ✅ لا يتجاوز الحد |
| Multiple employees same IP | ✅ allowances مستقلة |
| CSRF/401/403 | ✅ بلا تغيير |
| Notification/property polling | ✅ ضمن الحدود |
| Upload 429 | ✅ |
| Push register/test 429 | ✅ |
| TypeScript backend/frontend | ✅ |
| ESLint | ✅ |
| Root build (shared/backend/frontend + CSP manifest) | ✅ |

### اختبار التطبيق المحلي الفعلي

- `GET /auth/csrf` = 200، `X-RateLimit-Limit: 60`.
- Login cookie + CSRF = 200.
- `GET /auth/me` = 200، `X-RateLimit-Limit: 600`.
- `GET /properties?limit=1` = 200، `X-RateLimit-Limit: 120`.
- Logout = 200، `/auth/me` بعدها = 401.

---

## 7. متطلبات الإنتاج المتبقية

1. اختيار topology الفعلي للـproxy ثم ضبط `TRUST_PROXY` بعناوين/CIDR صريحة فقط.
2. تفعيل `RATE_LIMIT_STORAGE=redis` للـmulti-instance، مع مراقبة Redis وTTL/atomic failures.
3. ضبط الحدود حسب traffic الحقيقي (خصوصًا login خلف NAT مشترك).
4. التأكد من أن reverse proxy يحافظ على `Retry-After` و`X-RateLimit-*`.
5. مراقبة 429 وتنبيهات Redis؛ memory-only لا تحمي أكثر من instance.
6. عدم استخدام `trust proxy=true` أو `*` تحت أي ظرف.
7. تفعيل CSP وCookie production requirements بشكل منفصل (CSP ما زال Report-Only).

---

## 8. الحالة النهائية

| العنصر | الحالة |
|---|---|
| Frontend `:3001` | يعمل — Report-Only |
| Backend `:4001` | يعمل — Cookie auth + new limiter |
| Trust Proxy | معطّل |
| Rate-limit storage | memory (Redis opt-in) |
| Full suite | 76/769 ✅ |
| Git HEAD | `d43cae5` |
| Commits/pushes | لا شيء |
| بيانات الأعمال | لم تُعدّل |

**التوقف هنا للمراجعة قبل الإنتاج.**
