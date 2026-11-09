# المرحلة الأمنية الثانية — المهمة 3E: تفعيل مصادقة Cookies محليًا

**التاريخ:** 2026-11-07  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تفعيل مصادقة HttpOnly Cookies على التطبيق المحلي الفعلي فقط.  
**الحالة:** **مكتمل — التطبيق المحلي يعمل الآن في وضع `cookie`.**

> **ليست عملية نشر إنتاجي.**  
> لم يتم تعديل إعدادات الإنتاج.  
> لم تُنفّذ migrations أو resets أو seeds أو commits أو pushes.  
> لم تُعدّل سجلات الأعمال.  
> تم الحفاظ على إصلاحات Web Push SSRF وMulter وCSRF السابقة.

---

## 1. الحالة قبل التفعيل

| العنصر | قبل التفعيل |
|---|---|
| Backend | `http://localhost:4001` — قاعدة `arkan_crm` |
| Frontend | `http://localhost:3001` |
| `AUTH_COOKIE_MODE` في `.env` | غير موجود → `legacy` |
| `COOKIE_SECURE` | غير موجود → افتراضي التطوير |
| `NEXT_PUBLIC_AUTH_MODE` في `.env.local` | غير موجود → `legacy` |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4001` |
| `FRONTEND_ORIGIN` | `http://localhost:3001` |
| `NODE_ENV` | `development` |
| قاعدة البيانات | `arkan_crm` (تم التحقق عبر `current_database()`) |

### النسخ الاحتياطي

تم نسخ ملفي البيئة إلى مسار خاص مستثنى من Git قبل أي تعديل:

```text
apps/backend/.env.auth-backup-20261107-022627
apps/frontend/.env.local.auth-backup-20261107-022627
```

- تم التحقق من أن الملفين مستثنيان بواسطة `.gitignore` (`.env.*`).
- لم تُطبع أي أسرار أو قيم حساسة في السجلات أو التقرير.
- لم يتم نسخ أو تعديل ملفات الإنتاج.

---

## 2. Stage A — Backend `dual` + Frontend `legacy`

### التغيير

- `AUTH_COOKIE_MODE=dual`
- `COOKIE_SECURE=false`
- الواجهة بقيت `legacy` (بدون `NEXT_PUBLIC_AUTH_MODE`).
- إعادة تشغيل الخلفية عبر `npm run backend:start`.

### النتيجة

| الفحص | النتيجة |
|---|---|
| Backend `/health` | 200 |
| تسجيل دخول Manager | 200 |
| طلب Login حمل CSRF؟ | لا |
| Login أعاد `Set-Cookie`؟ | لا |
| التوكنات في `sessionStorage` | نعم (`accessToken` + `refreshToken`) |
| إعادة التحميل عبر Bearer | ✅ |
| صفحات Properties / Clients | ✅ 200 |
| أخطاء مصادقة | لا |

**الخلاصة:** تفعيل `dual` على الخلفية لم يكسر عميل legacy.

---

## 3. Stage B — Backend `dual` + Frontend `dual`

### التغيير

- `NEXT_PUBLIC_AUTH_MODE=dual`
- إعادة تشغيل الواجهة (لأن المتغير build-time).
- إعادة تشغيل الخلفية لم تكن مطلوبة بعد Stage A.

### الترحيل التلقائي

- الجلسة legacy الحية التي كانت مفتوحة في Chrome تم ترحيلها تلقائيًا عند إعادة تشغيل الواجهة:
  - `sessionStorage` أصبح `null`.
  - ظهرت كوكي CSRF.
  - `/auth/me` = 200.

### إثبات الترحيل مرة واحدة

تم إنشاء جلسة legacy مضبوطة (بدون CSRF) ثم إعادة تحميل `/manager` في وضع `dual`:

| العنصر | النتيجة |
|---|---|
| `GET /auth/csrf` | 1 |
| `POST /auth/refresh` | 1 |
| Refresh حمل `refreshToken` القديم | نعم |
| Refresh حمل `X-CSRF-Token` | نعم |
| حالة Refresh | 200 |
| `sessionStorage` بعد الترحيل | `null` |
| `document.cookie` | `arkan_dev_csrf` فقط |
| `/auth/me` | 200 |

### Login / Reload / Logout في `dual`

| العملية | النتيجة |
|---|---|
| Logout | `/login`، `sessionStorage=null`، `/auth/me=401` |
| Login Manager جديد | 200، بلا `sessionStorage`، بكوكيز |
| `GET /auth/refresh` مع CSRF | 200 |
| `GET /auth/me` بعد Refresh | 200 |

> في وضع `dual` يعيد Refresh رموز legacy في جسم الاستجابة للتوافق الخلفي؛ الواجهة لا تحفظها. هذا سلوك مقصود وليس تسريبًا إلى التخزين.

---

## 4. Stage C — Backend `cookie` + Frontend `cookie`

### التغيير

- `AUTH_COOKIE_MODE=cookie`
- `COOKIE_SECURE=false`
- `NEXT_PUBLIC_AUTH_MODE=cookie`
- إعادة تشغيل الخلفية والواجهة.

### الجلسة القائمة

الجلسة الكوكيزية التي أُنشئت في Stage B استمرت بعد التبديل إلى `cookie`:

| الفحص | النتيجة |
|---|---|
| `/auth/me` | 200 (MANAGER) |
| `sessionStorage` | فارغ |
| `localStorage` | لا توكنات مصادقة |
| `document.cookie` | `arkan_dev_csrf` فقط |
| Refresh مع CSRF | 200 |
| مفاتيح جسم Refresh | `user`, `csrfToken` فقط |
| `/auth/me` بعد Refresh | 200 |

### Logout / Login في cookie mode

| العملية | النتيجة |
|---|---|
| Logout | `/login`، `/auth/me=401` |
| Login Manager | `/manager`، `/auth/me=200` |
| Login Employee | `/employee`، `/auth/me=200` |

---

## 5. التحقق الحقيقي في المتصفح

تم استخدام **Google Chrome 156.0.8078.80** بملف مؤقت جديد، على التطبيق المحلي نفسه.

### 5.1 Manager

- Login / Reload / Logout: ✅
- `/manager/properties`: ✅
- `/manager/clients`: ✅
- `/manager/followups`: ✅
- `/manager/notifications`: ✅
- `/auth/me` = 200 في كل الجلسة.
- لا أخطاء مصادقة أو redirect غير متوقع.

### 5.2 Employee

- Login = ✅
- `/auth/me` = 200 بدور `EMPLOYEE`.
- `GET /employees` = **403**.
- الانتقال إلى `/manager` أعاد التوجيه إلى `/employee`.
- Logout = ✅.

### 5.3 الكوكيز والتخزين

| الفحص | النتيجة |
|---|---|
| Access/Refresh في `document.cookie` | غير موجودة |
| Access/Refresh في `sessionStorage` | غير موجودة |
| Access/Refresh في `localStorage` | غير موجودة |
| كوكي CSRF مقروء | نعم (`arkan_dev_csrf`) — بالتصميم |
| `Authorization` في طلبات cookie mode | **0** |
| توكنات في URL | **0** |
| توكنات في Console | **0** |
| توكنات في سجلات التطبيق | **0** |

**ملاحظة دقيقة:** Chrome DevTools Protocol يعرض قيم كوكيز HttpOnly ضمن بيانات `Network.requestWillBeSentExtraInfo` لأداة التصحيح. هذا متاح لأي أداة DevTools/Remote Debugging، وليس متاحًا لـJavaScript في الصفحة ولا للتطبيقات أو السجلات. لا يوجد أي مسار تطبيقي يكشف التوكنات.

### 5.4 CSRF

| الطلب | النتيجة |
|---|---|
| Login عبر الواجهة | حمل `X-CSRF-Token` |
| Logout عبر الواجهة | حمل `X-CSRF-Token` |
| Refresh عبر صفحة cookie mode | حمل `X-CSRF-Token` |
| طلبات GET المحمية | 200 |
| طلبات بدون CSRF (اختبارات آلية) | 403 |

لم تُجرَ تغييرات على نماذج الأعمال في قاعدة التطوير، لذلك لم يُنفّذ PATCH/POST تجريبي على سجلات حقيقية. تغطية CSRF للنماذج والـmultipart موجودة في الاختبارات الآلية وفي بيئة الاختبار المعزولة.

### 5.5 التبويبات

| الفحص | النتيجة |
|---|---|
| تبويبان بنفس الجلسة | ✅ كلاهما `/manager` و`/auth/me=200` |
| Logout من تبويب | التبويب الآخر أظهر «انتهت الجلسة» |
| `/auth/me` في التبويب الآخر | 401 |
| `sessionStorage` في التبويب الآخر | `null` |
| حلقات 401/403 | لا |

### 5.6 الصور والإشعارات وPush

| الفحص | النتيجة |
|---|---|
| `GET /properties` | 200 |
| صورة عقار حقيقي (قراءة فقط) | 200 / `image/jpeg` / 256,550 bytes |
| `GET /notifications` | 200 |
| `GET /push/config` | 200 / `configured: true` |
| `GET /push/subscriptions` | 200 / `subscribed: false` |
| إرسال Push تجريبي إلى أجهزة حقيقية | لم يُنفّذ (تجنب إزعاج المستخدمين) |

- لم يتم إنشاء/تعديل/حذف أي عقار أو عميل أو متابعة.
- لم يتم رفع ملفات أو تغيير صور على قاعدة التطوير.
- معالجة multipart والصور الخاصة مغطاة باختبارات `properties-upload-*` وبيئة `arkan_crm_api_test` من المهام السابقة.

---

## 6. عيب الاختبار المكتشف وإصلاحه

### المشكلة

عند تشغيل الحزمة الكاملة بعد التفعيل، فشلت 8 اختبارات في `test/auth.spec.ts`:

```text
expected 200 "OK", got 403 "Forbidden"
```

السبب: `auth.spec.ts` لا يثبّت `AUTH_COOKIE_MODE`، فورث وضع `cookie` من `.env` المحلي المفعل، وأصبح Login بلا CSRF مرفوضًا. الاختبارات الأخرى تستخدم `createTestApp` الذي يثبّت `legacy` افتراضيًا.

### الإصلاح

تعديل **اختبار فقط** في `test/auth.spec.ts`:

```text
process.env.AUTH_COOKIE_MODE = 'legacy';
process.env.COOKIE_SECURE = 'false';
```

مع تعليق يوضح أن السويت يختبر مسار legacy ويجب ألا يتأثر بتفعيل المطور المحلي.

- لا تغيير في كود الإنتاج.
- لا تغيير في إعدادات التفعيل.
- لا إضعاف لـCSRF.

### إعادة التحقق

```text
auth.spec.ts:                       9/9 ✅
Full backend suite:                71 suites / 737 tests ✅
```

---

## 7. الاختبارات والبناء

| الفحص | النتيجة |
|---|---|
| Full backend suite | **71/71 suites — 737/737 tests** |
| Frontend `tsc --noEmit` | ✅ |
| Backend `tsc --noEmit` | ✅ |
| ESLint (apps + packages) | ✅ |
| `npm run build` (shared + backend + frontend) | ✅ |

ملاحظة: الحزمة الكاملة الأولى بعد التفعيل أظهرت فشل الاختبار أعلاه، ثم أُصلح وأُعيد تشغيلها بالكامل ونجحت.

---

## 8. وضع التشغيل النهائي

| الخدمة | الحالة |
|---|---|
| Backend `http://localhost:4001` | **RUNNING (healthy)** — managed Nest watch |
| Frontend `http://localhost:3001` | **RUNNING** — Next dev |
| `AUTH_COOKIE_MODE` | `cookie` |
| `COOKIE_SECURE` | `false` (تطوير محلي فقط) |
| `NODE_ENV` | `development` |
| `FRONTEND_ORIGIN` | `http://localhost:3001` |
| `NEXT_PUBLIC_AUTH_MODE` | `cookie` |
| قاعدة البيانات | `arkan_crm` |
| `/health` | 200 |
| `/login` | 200 |

**كلتا الخدمتين تعملان في وضع cookie.**

---

## 9. الحفاظ على بيانات الأعمال

- لم تُنفّذ أي عمليات إنشاء/تعديل/موافقة/رفض/حذف على العقارات أو العملاء أو جهات الاتصال أو الصفقات أو المتابعات.
- تم إجراء قراءات فقط:
  - قائمة عقارات (عينة 1)
  - صورة عقار
  - إشعارات
  - إعدادات Push
- تغيّرت سجلات الجلسات (`refreshToken` / login/logout) كما هو متوقع عند تسجيل الدخول والخروج.
- الاختبارات الآلية استخدمت `arkan_crm_api_test` فقط.
- لم يتم reset أو seed أو migrate لقاعدة `arkan_crm`.

---

## 10. إجراء التراجع الدقيق

في حال الحاجة للعودة إلى legacy:

```powershell
cd D:\Projects\arkan-crm

# 1) استعادة ملفات البيئة الأصلية
Copy-Item apps\backend\.env.auth-backup-20261107-022627 apps\backend\.env -Force
Copy-Item apps\frontend\.env.local.auth-backup-20261107-022627 apps\frontend\.env.local -Force

# 2) إعادة تشغيل الخلفية
npm run backend:restart

# 3) إعادة تشغيل الواجهة
# أوقف العملية على المنفذ 3001 ثم:
npm run dev -w @arkan/frontend
```

النسخ الاحتياطية لا تحتوي على `AUTH_COOKIE_MODE` أو `NEXT_PUBLIC_AUTH_MODE`، لذا يعود النظام إلى `legacy` الافتراضي.

### التحقق بعد التراجع

- Login يعيد `accessToken` + `refreshToken`.
- `sessionStorage['arkan.auth.v1']` موجود.
- `document.cookie` لا يعرض كوكيز المصادقة.
- `/auth/me` يعمل بـBearer.
- لا CSRF على Login/Logout.

بديل سريع: ضبط `AUTH_COOKIE_MODE=legacy` و`NEXT_PUBLIC_AUTH_MODE=legacy` وإعادة التشغيل. لكن استعادة النسخ الاحتياطية هي الأدق لأنه يعيد الحالة الأصلية حرفيًا.

---

## 11. متطلبات أي نشر إنتاجي لاحق

1. `NODE_ENV=production`.
2. `COOKIE_SECURE=true` إلزامي — التطبيق يرفض الإقلاع بدونه.
3. HTTPS لكل origins.
4. `FRONTEND_ORIGIN` بقيم إنتاجية دقيقة.
5. نشر الواجهة والخلفية على نفس الموقع (same-site) لأن `SameSite=Lax`.
6. إعادة بناء الواجهة بعد تغيير `NEXT_PUBLIC_AUTH_MODE`.
7. مفاتيح VAPID إنتاجية، وعدم استخدام مفاتيح الاختبار.
8. عدم نسخ `COOKIE_SECURE=false` إلى الإنتاج.
9. مراقبة 401/403 وrefresh/logout بعد النشر.
10. خطة تراجع إلى legacy جاهزة.
11. اختبار Web Push الحقيقي (تم في بيئة الاختبار 3D، لكن يجب تكراره بمفاتيح الإنتاج).

---

## 12. ملاحظات وحدود

- **الجلسات القديمة التي لم تمر عبر Stage B:** المتصفح الذي لم يُفتح أثناء `dual` لن يملك كوكيز؛ عند التبديل إلى `cookie` ستُمسح جلسة `sessionStorage` القديمة ويحتاج المستخدم لتسجيل الدخول مرة واحدة. هذا سلوك متوقع في التفعيل المحلي.
- **CSRF مقروء من JavaScript** بطبيعة double-submit، وليس سرًا. Access/Refresh فقط HttpOnly.
- **DevTools يمكنه رؤية قيم HttpOnly cookies** عند فتح أدوات التصحيح؛ هذا ليس تسريبًا تطبيقيًا.
- **مؤقت الإشعارات 15 ثانية** يجدد الجلسة مبكرًا في الاستخدام النشط؛ اختبار الانتهاء الحقيقي والتزامن تم في 3C على بيئة الاختبار.
- **لم يتم إرسال Push حقيقي على قاعدة التطوير** لتجنب إزعاج الأجهزة الحقيقية؛ تحقق التسليم الفعلي تم في 3D على بيئة معزولة.
- **لا تغييرات في CSP أو rate limiting أو Prisma.**
- **ملف الاختبار `auth.spec.ts` فقط** تغيّر في هذه المهمة؛ لا تغييرات إنتاجية.

---

## 13. الخلاصة

- التطبيق المحلي انتقل بنجاح: `legacy` → `dual` → `cookie`.
- Manager وEmployee يعملان.
- CSRF وHttpOnly cookies فعّالان.
- الصور والإشعارات وإعداد Push تعمل.
- التبويبات متزامنة في تسجيل الخروج.
- لا توكنات مقروءة من JavaScript.
- لا حلقات refresh/logout.
- جميع الاختبارات والتحقق الساكن والبناء ناجحة.
- **الخدمتان تعملان الآن في وضع `cookie` على المنفذين 4001 و3001.**
- لا commits أو pushes.

**التوقف هنا للمراجعة اليدوية.**
