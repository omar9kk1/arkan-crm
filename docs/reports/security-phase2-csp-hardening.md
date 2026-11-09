# المرحلة الأمنية الثانية — المهمة 4: تقوية Content Security Policy

**التاريخ:** 2026-11-07  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** سياسة CSP للواجهة الأمامية Next.js 16 فقط.  
**الحالة:** **Report-Only مفعّل على التطبيق المحلي. لم يتم تفعيل Enforce.**  
**السبب:** فرض سياسة scripts صارمة يتطلب nonce + dynamic rendering، وهو تغيير معماري يحتاج مراجعة منفصلة.

> التطبيق المحلي ما زال يعمل بمصادقة Cookies.  
> لم يتم تفعيل CSP enforcing على التطبيق الفعلي.  
> لم تُعدّل بيانات الأعمال.  
> لم تُنفّذ commits أو pushes.  
> إصلاحات Cookie/CSRF وWeb Push SSRF وMulter محفوظة.

---

## 1. نتيجة التحقيق

| العنصر | النتيجة |
|---|---|
| Next.js | 16.4.5 — App Router |
| الصفحات | 23 route |
| Rendering | كلها static في البناء الحالي |
| Scripts خارجية | لا يوجد أي third-party script |
| Inline scripts | موجودة من Next.js (RSC/bootstrap) |
| Styles | CSS modules/global + Google Fonts `@import` |
| Fonts | `fonts.googleapis.com` + `fonts.gstatic.com` |
| Images | محلية + `blob:` لصور العقارات + `data:` |
| Service Worker | `/sw.js` محلي + Web Push |
| iframes | لا توجد داخل التطبيق |
| Inline style props | 11 موضع React `style={{...}}` |
| CSP headers حالية | لا يوجد |

### مصادر خارجية مشروعة

- `https://fonts.googleapis.com` — stylesheet الخاص بخط IBM Plex Sans Arabic.
- `https://fonts.gstatic.com` — ملفات الخطوط.
- عنوان API من `NEXT_PUBLIC_API_URL` (محليًا `http://localhost:4001`).

لا توجد مصادر إعلانات/تحليلات/سكربتات خارجية.

---

## 2. التصميم

### أوضاع CSP

```env
CSP_MODE=off | report-only | enforce
```

- **`off`**: لا يُرسل أي CSP header.
- **`report-only`**: `Content-Security-Policy-Report-Only` — لا يمنع شيئًا، ويجمع الانتهاكات.
- **`enforce`**: `Content-Security-Policy` — يمنع فعليًا.

الوضع الفعلي في `.env.local`:

```env
CSP_MODE=report-only
```

### السياسة الإنتاجية المقترحة

```text
default-src 'self';
script-src 'self';
script-src-attr 'none';
style-src 'self' https://fonts.googleapis.com;
style-src-elem 'self' https://fonts.googleapis.com;
style-src-attr 'unsafe-inline';
img-src 'self' blob: data:;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self' <API_ORIGIN>;
worker-src 'self';
manifest-src 'self';
media-src 'self';
frame-src 'none';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests;
```

مع nonce:

```text
script-src 'self' 'nonce-<NONCE>' 'strict-dynamic';
style-src 'self' https://fonts.googleapis.com 'nonce-<NONCE>';
style-src-elem 'self' https://fonts.googleapis.com 'nonce-<NONCE>';
```

### مبادئ

- لا **wildcard** في أي مصدر.
- لا `'unsafe-inline'` في `script-src` مطلقًا.
- `'unsafe-inline'` الوحيد هو `style-src-attr`، وهو استثناء ضيق لخصائص `style` في React وليس للسكربتات.
- `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`.
- `connect-src` يُشتق من `NEXT_PUBLIC_API_URL` بعد التحقق من HTTP(S) ورفض wildcard/credentials.
- لا يوجد hardcode لأي نطاق إنتاجي مستقبلي.
- `upgrade-insecure-requests` في الإنتاج فقط.
- `report-uri` اختياري عبر `CSP_REPORT_URI`؛ لم يُضبط لعدم وجود endpoint.

### استثناءات التطوير (فقط)

في `NODE_ENV != production` تُضاف:

- `script-src 'unsafe-eval'` — تشخيصات React Dev.
- `style-src/elem 'unsafe-inline'` — HMR.
- `connect-src` إلى `ws://localhost:3001` و`http://localhost:3001` وغيرها.

هذه لا تظهر في سياسة الإنتاج enforce.

---

## 3. الملفات المعدّلة

| الملف | التغيير |
|---|---|
| `apps/frontend/lib/csp.ts` | **جديد**: بناء السياسة، التحقق من mode/origin/nonce/report-uri |
| `apps/frontend/next.config.ts` | إضافة CSP header إلى جانب Security headers الحالية |
| `apps/frontend/.env.local` | `CSP_MODE=report-only` (ملف محلي مستثنى من Git) |
| `apps/frontend/.env.example` | توثيق `CSP_MODE` |
| `apps/frontend/.env.local.example` | توثيق `CSP_MODE` |
| `apps/backend/test/csp-policy.spec.ts` | **جديد**: 14 اختبارًا لسياسة CSP |

- لم يتغير `app/layout.tsx` في النهاية؛ تعديل القياس الديناميكي أُعيد بالكامل.
- لم تتغير أي business workflow أو UI.

### نسخة احتياطية

```text
apps/frontend/.env.local.csp-backup-20261107-040812
```

مستثناة من Git بواسطة `.env.*`.

---

## 4. Report-Only على التطبيق المحلي

### Header الفعلي

`Content-Security-Policy-Report-Only` موجود على `http://localhost:3001`، مع بقاء:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

السياسة في التطوير تضم `'unsafe-eval'` و`ws://localhost:3001` و`'unsafe-inline'` للأنماط فقط؛ لا `'unsafe-inline'` scripts.

### المتصفح

تم استخدام Chrome 156 حقيقي، ومدير/موظف من قاعدة التطوير، مع قراءة فقط.

| الفحص | النتيجة |
|---|---|
| Manager login | ✅ |
| Manager reload/pages | ✅ |
| Employee login | ✅ |
| Employee `/employees` | 403 كما هو متوقع |
| Cookie auth / CSRF | ✅ |
| `sessionStorage` | فارغ |
| `document.cookie` | CSRF فقط |
| Property image (قراءة فقط) | 200 / `image/jpeg` / 256,550 bytes |
| Notifications | ✅ |
| Push config | `configured: true` |
| Service Worker | ✅ مسجل |
| CSS/Fonts/Images | ✅ تحميل 200 |
| حلقات أو أخطاء CSP تمنع العرض | لا |

### انتهاكات Report-Only

```text
total: 21
script-src-elem: 21 (inline)
```

- كلها **inline scripts من Next.js** (RSC/bootstrap).
- التوزيع: 3–6 لكل صفحة (login + manager + properties + clients + followups + notifications).
- **لا انتهاكات** في:
  - `style-src` / `style-src-elem` / `style-src-attr`
  - `font-src`
  - `img-src`
  - `connect-src`
  - `worker-src`
  - `frame-src`
- أخطاء console غير CSP كانت 401/403 متوقعة من login/restore وعزل الأدوار.

**الخلاصة:** Report-Only لا يكسر التطبيق، والانتهاك الوحيد الحقيقي هو inline Next scripts.

---

## 5. اختبار Enforce في بيئة معزولة

تم بناء نسخة إنتاجية منفصلة وتشغيلها على `http://localhost:3201` بسياسة `enforce`:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; script-src-attr 'none';
style-src 'self' https://fonts.googleapis.com; style-src-elem 'self' https://fonts.googleapis.com;
style-src-attr 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' https://fonts.gstatic.com;
connect-src 'self' http://localhost:4001; worker-src 'self'; manifest-src 'self'; media-src 'self';
frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'; upgrade-insecure-requests
```

### 5.1 الأثر على التطبيق

| الفحص | النتيجة |
|---|---|
| HTML SSR | ✅ ظهر |
| CSS/Fonts/Images/Manifest | ✅ 200 |
| Next hydration | ❌ `self.__next_f` = undefined |
| Inline Next scripts | ❌ محجوبة (3 انتهاكات على login) |
| التفاعل/الأزرار | ❌ لا hydration |

**هذا هو البلوكر:** السياسة الصارمة بدون nonce تمنع سكربتات Next المضمنة، فيفقد التطبيق hydration رغم ظهور HTML.

### 5.2 اختبار الحجب الأمني

| الهجوم/المحاولة | النتيجة |
|---|---|
| Inline script مضاف | ❌ لم يُنفّذ — violation `script-src-elem` |
| External script `https://example.com/...` | ❌ لم يُحمّل — violation |
| External image | ❌ لم يُحمّل (`naturalWidth=0`) — violation |
| `<object>` خارجي | ❌ محجوب — violation `object-src` |
| `fetch('https://example.com')` | ❌ محجوب — violation `connect-src` |
| iframe لمسار داخلي | ❌ محجوب — violation `frame-src 'none'` |
| تضمين التطبيق في parent خارجي | ❌ محجوب — log: `frame-ancestors 'none'` |
| Form action خارجي | ❌ الطلب محجوب — violation `form-action` |
| External Worker | ❌ محجوب |

**ملاحظة Form:** Chrome سجّل violation وأبلغ أن إرسال البيانات محجوب، لكنه فتح تبويبًا يعرض وجهة محجوبة. لم يُسمح بإرسال النموذج فعليًا. هذا سلوك عرض في المتصفح وليس تجاوزًا.

### 5.3 ما لم يُضاف

- لا `'unsafe-inline'` scripts.
- لا `'unsafe-eval'` في production.
- لا wildcard.
- لا استثناء domains لتسكيت التحذيرات.

---

## 6. تقييم nonce والبديل الأقل تأثيرًا

### nonce

وفق توثيق Next.js 16:

- nonce يتطلب dynamic rendering لكل صفحة.
- static pages لا تستطيع الحصول على nonce لكل طلب.
- PPR غير متوافق.
- ISR/CDN caching يتأثر.

### القياس الفعلي

| البناء | النتيجة | الزمن |
|---|---|---|
| Static (الحالي) | **23/23 routes static** (○) | 21.5s |
| `connection()` في Root Layout (محاكاة nonce) | **23/23 routes dynamic** (ƒ) | 26.7s |
| البناء النهائي Report-Only | 23/23 static | 18.7s |

- تمت إضافة `await connection()` مؤقتًا في Root Layout للقياس فقط، ثم أُعيد الملف بالكامل.
- `git diff apps/frontend/app/layout.tsx` = فارغ.
- لا يوجد nonce proxy في التطبيق الفعلي.

### البديل SRI

- Next.js يقدم SRI تجريبيًا (Experimental) للحفاظ على static generation.
- لم يُعتمد في هذه المهمة؛ يحتاج تجربة معزولة وتحققًا من تعامله مع inline RSC scripts.
- لم يُفعّل أي إعداد تجريبي.

### القرار

**التوقف قبل تحويل التطبيق إلى dynamic rendering.**  
السياسة الصارمة جاهزة نظريًا، لكن فرض scripts يتطلب nonce/SRI ومراجعة معمارية مستقلة.

---

## 7. العوائق المتبقية

1. **Inline Next.js scripts** — السبب الأساسي لعدم إمكانية `script-src 'self'` بدون nonce.
2. **nonce يتطلب dynamic rendering** — 23 route من static إلى dynamic، مع فقدان CDN/ISR/PPR.
3. **`style-src-attr 'unsafe-inline'`** — استثناء ضيق لـ11 React style prop. يمكن إزالته لاحقًا بتحويلها إلى classes.
4. **Google Fonts خارجي** — مسموح صراحةً؛ يمكن self-hosting الخطوط لتقليل الاعتماد الخارجي.
5. **لا CSP report endpoint** — الأدلة من console/`securitypolicyviolation` فقط. يمكن إضافة `CSP_REPORT_URI` لاحقًا.
6. **SRI تجريبي** — يحتاج تقييمًا منفصلًا.
7. **Enforce mode موجود في الإعدادات** — يجب عدم استخدامه على التطبيق الفعلي قبل nonce/SRI؛ سيحجب hydration.

---

## 8. الاختبارات والبناء

| الفحص | النتيجة |
|---|---|
| `csp-policy.spec.ts` | **14/14** |
| Focused CSP/auth/security suites | **5 suites / 45 tests** ✅ |
| Frontend `tsc --noEmit` | ✅ |
| Backend `tsc --noEmit` | ✅ |
| ESLint | ✅ |
| Final report-only `next build` | ✅ 18.7s، 23 static routes |
| Enforce production build | ✅ (اختبار معزول) |
| Dynamic measurement build | ✅ (اختبار معزول) |

اختبارات CSP تغطي:

- رفض wildcard وغير HTTP(S).
- عدم وجود `unsafe-inline` scripts.
- وجود object-src/base-uri/frame-ancestors/form-action.
- اشتقاق API origin.
- رفض nonce غير الآمن.
- report-uri الصالح فقط.
- الفروق بين dev/prod.

---

## 9. الحالة النهائية

| الخدمة | الحالة |
|---|---|
| Frontend `http://localhost:3001` | يعمل — **CSP Report-Only** |
| Backend `http://localhost:4001` | يعمل — cookie auth |
| CSP enforcing على التطبيق الفعلي | **غير مفعّل** |
| بيانات الأعمال | لم تُعدّل |
| Git HEAD | `d43cae5` — لا commits/pushes |
| Backup env | `apps/frontend/.env.local.csp-backup-20261107-040812` |

---

## 10. التراجع

إيقاف CSP تمامًا:

```powershell
cd D:\Projects\arkan-crm
# أزل/غيّر في apps\frontend\.env.local
CSP_MODE=off
# أعد تشغيل الواجهة على 3001
```

أو استعادة النسخة الاحتياطية:

```powershell
Copy-Item apps\frontend\.env.local.csp-backup-20261107-040812 apps\frontend\.env.local -Force
```

ثم إعادة تشغيل الواجهة. لا حاجة لتغيير قاعدة البيانات.

---

## 11. متطلبات التفعيل الإنتاجي / المحلي enforcing

1. اعتماد nonce-based CSP مع تحويل الصفحات إلى dynamic **أو** اعتماد SRI بعد تجربة معزولة.
2. قياس أثر dynamic على الأداء وCDN وPPR قبل الاعتماد.
3. إضافة `CSP_REPORT_URI` و`Reporting-Endpoints` إن أردنا جمع التقارير مركزيًا.
4. self-host الخطوط أو إبقاء `fonts.googleapis.com`/`fonts.gstatic.com` كاستثناء موثق.
5. إزالة `style-src-attr 'unsafe-inline'` عبر تحويل style props إلى classes إن أمكن.
6. استخدام HTTPS و`upgrade-insecure-requests` في الإنتاج.
7. اختبار enforcing على staging مع كل الصفحات والصور وPush.
8. اختبار أن التطبيق يعمل تحت nonce (login، hydration، RSC، الصور، الإشعارات).
9. مراقبة تقارير CSP قبل التحول من Report-Only إلى Enforce.

---

## 12. الخلاصة

- تم تنفيذ سياسة CSP قابلة للضبط (off/report-only/enforce) مع اختبارات.
- **Report-Only مفعّل على التطبيق المحلي ولا يكسر أي شيء.**
- الانتهاكات الفعلية محصورة في inline scripts الخاصة بـNext.js.
- فرض السياسة على نسخة إنتاجية أثبت أنها تحجب inline/external scripts والصور والكائنات والاتصالات والإطارات والنماذج الخارجية.
- لكن الفرض الصارم بدون nonce يمنع hydration.
- nonce يتطلب dynamic rendering لكل الصفحات، وتم قياس الأثر (23 static → 23 dynamic).
- **CSP Report-Only جاهز. CSP Enforce غير جاهز للتفعيل المحلي قبل مراجعة معمارية nonce/SRI.**

**التوقف هنا للمراجعة اليدوية.**
