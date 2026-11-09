# المرحلة الأمنية الثانية — المهمة 4B: قرار فرض CSP دون خسارة الأداء

**التاريخ:** 2026-11-07  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** Proof-of-Concept معزول لاختيار طريقة فرض CSP آمنة للواجهة Next.js 16.4.5.  
**الحالة:** **CSP Report-Only ما زال مفعّلًا على التطبيق المحلي. لم يتم تفعيل Enforce.**  
**التوصية:** **Hash-based CSP ثابت (static-preserving)** مع توليد hashes وقت البناء وحقن الهيدر عبر reverse proxy/CDN. SRI اختياري/تجريبي وليس شرطًا.

> لم يتم تغيير `CSP_MODE=report-only` على التطبيق الفعلي.  
> لم يتم تعديل `.env` أو `.env.local` في هذه المهمة.  
> لم يتم تحويل أي route إلى dynamic بشكل دائم.  
> لم تُعدّل بيانات الأعمال، ولا commits أو pushes.  
> مصادقة Cookies/CSRF وإصلاحات SSRF/Multer محفوظة.

---

## 1. ملخص القرار

| الخيار | النتيجة |
|---|---|
| Next.js experimental SRI وحده | ❌ لا يحل inline RSC/bootstrap scripts |
| SRI + hash-based CSP | ✅ 23 route static، 0 violations، hydration كامل |
| Hash-based CSP بدون SRI | ✅ يعمل أيضًا (اختبار تمثيلي) |
| Nonce + dynamic rendering | ✅ يعمل نظريًا لكن يفرض 23 route dynamic — غير مطلوب |

**التوصية النهائية:** اعتماد **Hash-based CSP على الصفحات الثابتة**، مع:
1. استخراج hashes لسكربتات Next inline بعد البناء.
2. حقن `Content-Security-Policy` عبر reverse proxy/CDN على استجابات HTML.
3. نشر ذري (HTML + hash manifest من نفس البناء) مع إبطال كاش HTML.
4. إبقاء Report-Only حتى بناء هذه الأنابيب واختبارها واعتمادها يدويًا.

SRI يمكن إضافته لاحقًا كطبقة إضافية، لكنه **ليس** ما يؤمّن inline scripts.

---

## 2. مراجعة SRI في Next.js 16.4.5

تم بناء نسخة إنتاجية معزولة مع:

```ts
experimental: { sri: { algorithm: 'sha256' } }
```

النتيجة:

| الفحص | النتيجة |
|---|---|
| Build | ✅ ناجح |
| Routes | 23/23 static |
| HTML files | 27 |
| Integrity attributes | 6 لكل صفحة تقريبًا |
| Nonces | 0 |
| Inline scripts | باقية كما هي (3 لكل صفحة) |
| Build time | 23.1s |

**الخلاصة:** SRI أضاف `integrity` للسكربتات الخارجية، لكنه **لم يضف hashes أو nonces للسكربتات inline**. لذلك SRI وحده لا يجعل `script-src 'self'` كافيًا.

---

## 3. Hash-Based CSP على Static Pages

### 3.1 استخراج hashes

من HTML المبني لكل الصفحات:

- 27 ملف HTML.
- 3 inline scripts لكل صفحة تقريبًا:
  - سكربتان مشتركان.
  - RSC payload خاص بكل route.
- **29 hash فريد** فقط لكل التطبيق.
- حجم قائمة الهيدر: **2,027 bytes** تقريبًا.

الهيدر المستخدم في الاختبار (بدون `upgrade-insecure-requests` لأن البيئة HTTP محلية):

```text
default-src 'self';
script-src 'self' 'sha256-...' (29 hashes);
script-src-attr 'none';
style-src 'self' https://fonts.googleapis.com;
style-src-elem 'self' https://fonts.googleapis.com;
style-src-attr 'unsafe-inline';
img-src 'self' blob: data:;
font-src 'self' https://fonts.gstatic.com;
connect-src 'self' http://localhost:4001;
worker-src 'self';
manifest-src 'self';
media-src 'self';
frame-src 'none';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
```

- لا `unsafe-inline` scripts.
- لا wildcard.
- لا nonce.
- لا تغيير في rendering.

### 3.2 اختبار المتصفح الحقيقي

استخدمنا Chrome 156، والتطبيق الإنتاجي المعزول، والـproxy على `localhost:3001` للحفاظ على Origin الصحيح للكوكيز/CORS.

| الفحص | النتيجة |
|---|---|
| Manager login | ✅ |
| Employee login | ✅ |
| Hydration (`self.__next_f`) | ✅ object |
| Client navigation | ✅ العلامة `window.__hashMarker` بقيت |
| Property drawer | ✅ ظهر dialog فعلي |
| Notification bell/dialog | ✅ |
| RTL | ✅ `direction: rtl` |
| Cookie auth / HttpOnly | ✅ |
| `sessionStorage` | فارغ |
| CSRF | ✅ |
| Protected property image | ✅ 200 / `image/jpeg` / 256,550 bytes / blob loaded |
| Notifications | ✅ 200 |
| Push config / Service Worker | ✅ |
| Employee `/employees` | 403 |
| جميع الـ23 route | ✅ 0 CSP violations |
| Console errors | لا أخطاء CSP أو integrity على الصفحات الطبيعية |

### 3.3 تغطية كل المسارات

| المجموعة | العدد | النتيجة |
|---|---|---|
| Manager routes | 13 | ✅ hydration + 0 violations |
| Employee routes | 9 | ✅ hydration + 0 violations |
| Login | 1 | ✅ |
| **الإجمالي** | **23** | **✅ 0 violations** |

### 3.4 الحجب الأمني

| المحاولة | النتيجة |
|---|---|
| Inline script غير موجود في hashes | ❌ محجوب — violation |
| External script `https://example.com/...` | ❌ محجوب |
| `fetch('https://example.com')` | ❌ محجوب — `connect-src` |
| iframe لمسار داخلي | ❌ محجوب — `frame-src 'none'` |
| Form action خارجي | ❌ الطلب محجوب — `form-action` (اختُبر في 4) |
| تضمين التطبيق في parent خارجي | ❌ محجوب — `frame-ancestors 'none'` |
| `unsafe-inline` scripts | غير موجود مطلقًا |

### 3.5 هل SRI ضروري؟

تم اختبار نسخة **بدون SRI** مع نفس الـ29 hash:

- Build 16.5s.
- 23 route static.
- Header 2,027 bytes.
- Manager/Employee، hydration، client navigation، drawer، bell، الصور، Push/SW، والحجب الأمني: ✅.
- 0 CSP violations على المسارات المختبرة.

**الخلاصة:** SRI ليس ضروريًا لفرض CSP. Hash-based CSP هو الأساس. SRI طبقة إضافية اختيارية وتجريبية.

---

## 4. لماذا لا Nonce؟

Nonce يتطلب dynamic rendering لكل صفحة. القياس السابق (Task 4) مع `connection()` في Root Layout:

- 23/23 route → dynamic (`ƒ`).
- Build 26.7s مقابل 21.5s static.
- فقدان static/CDN caching وISR/PPR.
- Server rendering workload لكل طلب.

بما أن Hash-based CSP حقق الفرض الكامل مع 23 route static و0 violations، **لا حاجة لـnonce** في هذه البنية.

---

## 5. مقارنة الأداء

### 5.1 البناء والمسارات

| البناء | Build time | Routes static | HTML /login | HTML /manager/clients |
|---|---:|---:|---:|---:|
| Baseline (السابق) | 18.7s | 23/23 | 9,949 B | 12,951 B |
| Hash فقط (بدون SRI) | 16.5s | 23/23 | 9,949 B | 12,951 B |
| SRI + Hash | 23.1s | 23/23 | 10,397 B (+448) | 13,399 B (+448) |

- فروق build time ليست دليلًا على أداء runtime.
- SRI أضاف ~6.6s build و~448 bytes HTML.
- Hash CSP أضاف 2,027 bytes **header** فقط.

### 5.2 TTFB على الإنتاج المحلي

40 طلبًا بعد warm-up، p50/p95 (ms):

| المسار | Baseline direct | No-SRI direct | Hash proxy | SRI direct | SRI+Hash proxy |
|---|---:|---:|---:|---:|---:|
| `/login` | 2.41 / 3.80 | 3.12 / 6.34 | 4.76 / 7.54 | 3.16 / 5.22 | 3.56 / 5.82 |
| `/manager/clients` | 2.24 / 3.42 | 3.15 / 5.24 | 4.19 / 7.56 | 2.32 / 3.18 | 3.43 / 4.73 |

- كل النسخ static؛ لا فرق بنيوي في server rendering.
- الـproxy المحلي أضاف ~1–2ms p50.
- الفروق الصغيرة بين direct runs ضمن تشويش بيئة محلية.
- في الإنتاج، حقن الهيدر عبر CDN/reverse proxy يجب أن يكون ثابت التكلفة تقريبًا، مع بقاء HTML قابلًا للكاش.

### 5.3 المتصفح

| القياس | No-SRI Hash | SRI + Hash |
|---|---|---|
| Manager TTFB (proxy) | 9.3ms | 10.9ms |
| Manager DOMContentLoaded | 36ms | 43.3ms |
| Manager load | 39.2ms | 45.5ms |
| Employee DOMContentLoaded | 26.7ms | — |
| Hydration | ✅ | ✅ |
| CSP violations على المسارات | 0 | 0 |

هذه أرقام محلية إرشادية وليست benchmark شبكيًا. الأهم: **لا dynamic rendering ولا hydration regression**.

### 5.4 الكاش وCDN

- HTML يبقى static وقابلًا للكاش.
- الـCSP header يتغير مع كل build؛ يجب:
  - نشر HTML والـhash manifest معًا ذريًا.
  - إبطال/تحديث كاش HTML عند كل build.
  - منع تقديم HTML قديم مع CSP جديد (أو العكس).
- لا nonce لكل طلب ⇒ لا يمنع CDN caching.

---

## 6. توصية التنفيذ

### النموذج الموصى به

**Hash-based CSP ثابت + حقن الهيدر في طبقة النشر.**

1. **Postbuild script** يقرأ `.next/server/app/**/*.html`، يستخرج محتوى كل `<script>` inline، ويحسب SHA-256 base64.
2. يكتب manifest مثل `.next/csp-inline-hashes.json` مع build ID.
3. **Reverse proxy/CDN** (Nginx/Caddy/Node edge) يقرأ manifest ويضيف:
   ```text
   Content-Security-Policy: ...hashes...
   ```
   على استجابات HTML فقط.
4. **فحص CI** يفشل إذا:
   - لم توجد hashes،
   - أو اختلف build ID بين manifest وHTML،
   - أو تجاوز حجم الهيدر الحد المضبوط.
5. نشر ذري: HTML + manifest + header من نفس build.
6. إبقاء `CSP_MODE=report-only` حتى تكتمل هذه الأنابيب.
7. بعد نجاح staging واختبار كل المسارات، تفعيل Enforce بموافقة منفصلة.

### SRI

- **اختياري**، وليس شرطًا.
- يمكن إضافته كطبقة `integrity` للسكربتات الخارجية بعد استقرار الأنبوب.
- يبقى experimental؛ لا تعتمد عليه وحده.

### Nonce

- غير موصى به الآن؛ يفرض dynamic rendering وفقدان static caching.
- يبقى بديلًا إذا فشل hash pipeline في بيئة نشر معينة.

---

## 7. العوائق والمخاطر المتبقية

1. **توليد الـhashes ليس مدمجًا في Next.js تلقائيًا.**  
   يحتاج postbuild script + نشر header. هذا عمل تنفيذي خارج هذه المهمة.
2. **حجم الهيدر ينمو مع عدد المسارات.**  
   29 hash = ~2KB. يجب مراقبة الحد عند إضافة routes كثيرة.
3. **ذَرّية النشر والكاش.**  
   HTML قديم + hashes جديدة = تعطيل hydration. يجب إبطال كاش HTML وربط manifest بالـbuild ID.
4. **SRI experimental.**  
   لم يُعتمد كمتطلب؛ يمكن تجربته لاحقًا.
5. **Google Fonts خارجي.**  
   مسموح صراحةً؛ يمكن self-hosting لاحقًا.
6. **style-src-attr `unsafe-inline`.**  
   استثناء ضيق لخصائص React style، وليس للسكربتات.
7. **صفحات الأخطاء/404.**  
   يجب أن تشملها hashes أيضًا؛ أُضيفت ملفات `_global-error`, `_not-found` في الـPOC.
8. **لا CSP report endpoint.**  
   جمع التقارير المركزي يحتاج `CSP_REPORT_URI` أو Reporting API.

---

## 8. هل يمكن فرض CSP بأمان؟

**نعم، تقنيًا:** Hash-based CSP فرض بنجاح على 23 route static، مع 0 violations، hydration كامل، وحجب كامل للسكربتات/الاتصالات/الإطارات غير المصرح بها.

**لكن ليس جاهزًا للتفعيل الآن** لأن:
- آلية توليد الـhashes وحقن الهيدر غير مبنية بعد في النشر.
- النشر الذري وإبطال الكاش يحتاجان تنفيذًا واختبارًا.
- تفعيل Enforce يحتاج موافقة صريحة منفصلة.

**القرار:** البقاء على **Report-Only** حتى بناء hash pipeline واعتماده.

---

## 9. الاختبارات

| الفحص | النتيجة |
|---|---|
| SRI build | ✅ 23 static |
| Hash + SRI: 23 routes | ✅ 0 violations |
| Hash بدون SRI (تمثيلي) | ✅ 0 violations |
| Manager/Employee auth | ✅ |
| Cookie/CSRF/HttpOnly | ✅ |
| Property image | ✅ |
| Notifications / Push config / SW | ✅ |
| Drawer / Dialog / Buttons / RTL | ✅ |
| Client navigation | ✅ |
| Untrusted inline/external scripts | ❌ محجوب |
| External connect / frame / form | ❌ محجوب |
| Focused CSP/auth/security tests | **5 suites / 45 tests** ✅ |
| Frontend + backend TypeScript | ✅ |
| ESLint | ✅ |
| Final report-only build | ✅ 18.3s — 23 static |

---

## 10. الملفات والحالة النهائية

### تغييرات محتجزة (retained)

**لا يوجد.** جميع تجارب SRI/hash/nonce كانت مؤقتة:

- تم استرجاع `next.config.ts` إلى نسخة CSP Report-Only (بدون SRI).
- لم يتغير `app/layout.tsx`.
- لم يتغير `.env` أو `.env.local`.
- لم تُضف proxy أو hash script إلى المستودع.
- سكربتات التجربة والـproxy في مجلد temp خارج المشروع.

### الحالة

| العنصر | الحالة |
|---|---|
| Frontend `:3001` | يعمل — Report-Only |
| Backend `:4001` | يعمل — Cookie auth |
| CSP Enforce | غير مفعّل |
| Git HEAD | `d43cae5` |
| Commits/pushes | لا شيء |

---

## 11. الخلاصة

- SRI وحده لا يحل inline scripts.
- Hash-based CSP حقق الفرض الكامل مع الحفاظ على **23 route static**.
- 29 hash فقط (~2KB) تغطي كل التطبيق.
- كل المسارات وManager/Employee والصور والإشعارات وPush/SW وRTL والتفاعل تعمل.
- الحجب الأمني للسكربتات/الاتصالات/الإطارات غير المصرح بها يعمل.
- التكلفة الأدائية: لا dynamic rendering، لا server rendering إضافي، هيدر ~2KB و~1ms proxy overhead محلي.
- **التوصية:** Hash-based CSP ثابت + build-time hash manifest + reverse proxy/CDN header injection، مع نشر ذري.
- **SRI اختياري/تجريبي وليس ضروريًا.**
- **Nonce غير مطلوب** ولا يُنصح به لهذه البنية.
- **التطبيق الفعلي يبقى على Report-Only حتى تنفيذ الـhash pipeline والموافقة الصريحة.**

**التوقف هنا للمراجعة اليدوية قبل أي تفعيل.**
