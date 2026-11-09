# المرحلة الأمنية الثانية — المهمة 4C: تنفيذ خط أنابيب CSP Hashes

**التاريخ:** 2026-11-07  
**المشروع:** `D:\Projects\arkan-crm`  
**النطاق:** تنفيذ خط إنتاج hash-based CSP مع الحفاظ على الصفحات الثابتة.  
**الحالة:** **الخط منفّذ ومُختبر. التطبيق المحلي الفعلي ما زال على Report-Only.**  
**التفعيل:** لم يتم تفعيل Enforce تلقائيًا؛ يحتاج موافقة منفصلة.

> لم يتم تغيير `CSP_MODE=report-only` على التطبيق الفعلي.  
> لم يتم تعديل `.env` أو `.env.local`.  
> لم تُفعّل SRI التجريبية ولا nonces ولا dynamic rendering.  
> لم تُعدّل بيانات الأعمال.  
> لا commits أو pushes.  
> مصادقة Cookies/CSRF وإصلاحات SSRF/Multer محفوظة.

---

## 1. الملفات المضافة/المعدلة

| الملف | التغيير |
|---|---|
| `apps/frontend/scripts/csp-hash-lib.mjs` | **جديد** — استخراج hashes، بناء/التحقق من manifest، فحص السياسة والمسارات |
| `apps/frontend/scripts/csp-hashes.mjs` | **جديد** — postbuild script |
| `apps/frontend/scripts/csp-verify.mjs` | **جديد** — CLI للتحقق قبل النشر |
| `apps/frontend/scripts/csp-preview.mjs` | **جديد** — local production-preview enforcement adapter |
| `apps/frontend/scripts/csp-pipeline.test.mjs` | **جديد** — 8 اختبارات للفشل الآمن |
| `apps/frontend/package.json` | `build` أصبح `next build && node scripts/csp-hashes.mjs`، وإضافة `csp:verify` / `csp:preview` / `csp:test` |
| `eslint.config.mjs` | Node globals لسكربتات `.mjs` |
| `docs/reports/security-phase2-csp-build-pipeline.md` | هذا التقرير |

**لم يتم تغيير:**

- `apps/frontend/next.config.ts` (بعد Task 4).
- `apps/frontend/app/layout.tsx`.
- `.env` أو `.env.local`.
- أي كود مصادقة أو أعمال.

---

## 2. تصميم Manifest والهيدر

### الملف

```text
apps/frontend/.next/csp-manifest.json
```

### المحتوى

```json
{
  "schemaVersion": 1,
  "tool": "arkan-csp-hash-pipeline",
  "buildId": "<Next BUILD_ID>",
  "generatedAt": "...",
  "sourceHeader": "Content-Security-Policy-Report-Only",
  "htmlFiles": ["server/app/...html"],
  "routeCount": 27,
  "inlineScriptCount": 81,
  "uniqueHashCount": 29,
  "hashes": ["'sha256-...'"],
  "header": {
    "enforceName": "Content-Security-Policy",
    "reportOnlyName": "Content-Security-Policy-Report-Only",
    "value": "<full production policy + hashes>",
    "previewValue": "<same, minus upgrade-insecure-requests>"
  }
}
```

### كيف يُبنى الهيدر

المصدر هو **سياسة Next المبنية فعليًا** في `.next/routes-manifest.json` (من `next.config.ts` و`CSP_MODE=report-only`). السكربت:

1. يقرأ قيمة `Content-Security-Policy-Report-Only`.
2. يتحقق من وجود `script-src` و`object-src` و`base-uri` و`frame-ancestors`.
3. يرفض أي `'unsafe-inline'` أو `'unsafe-eval'` في `script-src`.
4. يضيف الـ29 hash إلى `script-src` (و`script-src-elem` إن وُجد).
5. ينتج `Content-Security-Policy` enforce.
6. ينتج نسخة preview بدون `upgrade-insecure-requests` للـHTTP المحلي فقط.

### نتائج البناء النظيف

| العنصر | القيمة |
|---|---|
| Build ID | `RhL0UXLyheYSgRI03XcuU` |
| HTML files | 27 |
| تطبيق routes static | **23/23** |
| Inline hashes فريدة | **29** |
| Inline script count | 81 |
| Header production | **2,055 bytes** |
| Header preview | **2,027 bytes** |
| Hashes | `sha256` فقط |
| `unsafe-inline` scripts | لا |
| `unsafe-eval` production | لا |

**ملاحظة:** 23 هي routes التطبيق (Manager/Employee/Login). ملفات HTML الـ27 تشمل أيضًا `_not-found` و`_global-error` و`dev/potential-duplicate-preview`.

---

## 3. Fail-safe

### أثناء البناء

- `next build` يفشل إذا فشل postbuild script (`&&`).
- لا manifest يُكتب إذا فشل التحقق.
- يُكتب إلى ملف مؤقت ثم يُتحقق ثم يُنقل ذريًا.

### قبل تشغيل preview

`csp-preview.mjs` يتحقق **قبل** تشغيل أي خادم من:

- وجود manifest.
- تطابق `buildId` مع `.next/BUILD_ID`.
- تطابق قائمة HTML.
- تطابق hashes مع inline scripts الفعلية.
- تطابق الهيدر مع سياسة `routes-manifest` والـhashes.
- وجود صفحات 404/global error.
- اكتمال HTML لكل route ثابت.

### الاختبارات الآلية

`npm run csp:test -w @arkan/frontend`:

```text
8/8 pass
```

تغطي:

- manifest صالح.
- manifest مفقود.
- build ID قديم/stale.
- hash ناقص.
- HTML تغيّر وأضيف inline script غير مُوقّع.
- هيدر manifest مُعدّل.
- route ثابت بلا HTML.
- صفحة global error مفقودة.

### اختبار live

- حذف manifest فعليًا → `csp-preview` فشل بالرمز 1:
  ```
  CSP manifest is missing ... Run the production build
  ```
- build ID قديم → فشل:
  ```
  CSP manifest is stale: manifest build stale-build-for-test != current build ...
  ```
- بعد الاستعادة: `csp:verify` نجح.
- لم يبدأ أي خادم عند الفشل.

---

## 4. Local Preview Adapter

`apps/frontend/scripts/csp-preview.mjs`:

1. يتحقق من manifest.
2. يتحقق من أن المنفذين `3001` (preview) و`3101` (upstream) متاحان.
3. يكتشف `output: standalone` ويشغّل:
   ```
   node .next/standalone/apps/frontend/server.js
   ```
   مع نسخ `.next/static` و`public` إلى مجلد standalone تلقائيًا.
4. يشغّل proxy على `localhost:3001`:
   - يحذف `Content-Security-Policy-Report-Only` القادم من Next.
   - يضيف `Content-Security-Policy` من `manifest.header.previewValue`.
   - يمرر الكوكيز والهيدرز والـHTML/RSC/static assets.
5. يستخدم `previewValue` الذي يحذف `upgrade-insecure-requests` فقط للـHTTP المحلي.
6. عند SIGINT/SIGTERM يوقف الخادمين.

الأمر:

```powershell
# يجب إيقاف dev frontend على 3001 أولًا
npm run csp:preview -w @arkan/frontend
```

**الإنتاج** يستخدم `manifest.header.value` الكامل (مع `upgrade-insecure-requests`) عبر reverse proxy/CDN على HTTPS.

---

## 5. اختبار المتصفح Enforce

تم تشغيل المعاينة الإنتاجية enforce على `http://localhost:3001` مع Chrome 156 حقيقي.

### المطابقة الفعلية

| الفحص | النتيجة |
|---|---|
| 23 route + 404 | ✅ كل inline scripts مطابقة للمانيفست |
| CSP header على كل HTML | ✅ |
| Hash مفقود في route | 0 |
| 404 page | 404 + 3 inline + 0 missing hash |
| Hydration (`self.__next_f`) | ✅ object على كل route |
| CSP violations على الصفحات الطبيعية | **0** |
| Manager routes | 13/13 ✅ |
| Employee routes | 9/9 ✅ |
| RTL | ✅ `direction: rtl` |
| Client navigation | ✅ |
| Property drawer | ✅ dialog مرئي |
| Notification bell/dialog | ✅ |
| Property image (blob) | ✅ 200 / `image/jpeg` / 256,550 bytes / loaded |
| Notifications | ✅ 200 |
| Push config | ✅ `configured: true` |
| Service Worker | ✅ |
| Employee `/employees` | 403 |
| Manager UI logout | ✅ → `/login` |
| Employee UI logout | ✅ → `/login` |
| Cookie auth / HttpOnly | ✅ |
| `sessionStorage` | فارغ |
| CSRF على Login/Logout | ✅ `X-CSRF-Token` |

### الحجب الأمني

| المحاولة | النتيجة |
|---|---|
| Inline script غير موقّع | ❌ محجوب |
| External script `https://example.com` | ❌ محجوب |
| External fetch | ❌ محجوب (`connect-src`) |
| iframe داخلي | ❌ محجوب (`frame-src 'none'`) |
| Form action خارجي | ❌ محجوب |
| Parent خارجي يعرض التطبيق | ❌ محجوب (`frame-ancestors 'none'`) |

لا يوجد `'unsafe-inline'` scripts ولا استثناءات domains.

---

## 6. الأداء

### Routes والبناء

| الفحص | القيمة |
|---|---|
| Clean production build | 31s (يشمل Next + postbuild) |
| Routes static | 23/23 |
| Manifest HTML | 27 |
| Hash manifest step | أقل من ثانية عمليًا |
| Dynamic rendering | لا |
| Nonce/SRI | لا |

> Build time ليس مقياس runtime؛ الفرق الأساسي أنه لا dynamic rendering ولا server rendering إضافي.

### TTFB (40 طلبًا، p50/p95 محليًا)

| المسار | Preview enforce (3001) | Upstream standalone (3101) |
|---|---:|---:|
| `/login` | 3.82 / 5.34 ms | 2.28 / 3.25 ms |
| `/manager/clients` | 3.50 / 5.06 ms | 2.54 / 3.66 ms |

- Proxy overhead محلي: ~1.2–1.3ms p50.
- الصفحات static بالكامل.
- HTML bytes: 9,949 / 12,951 (بدون تغيير).
- Header: 2,027B preview / 2,055B production.
- لا hydration أو CDN caching regression.
- في الإنتاج، حقن الهيدر عبر CDN/reverse proxy متوقع أن يكون منخفض التكلفة، لكن يجب قياسه في بيئة النشر.

---

## 7. متطلبات النشر الذري

1. **نفس البناء:** يجب أن يُقدَّم HTML والـmanifest والهيدر من نفس `buildId`.
2. **حقن الهيدر:** reverse proxy/CDN يقرأ `manifest.header.value` ويضيف `Content-Security-Policy` على استجابات HTML.
3. **إبطال كاش HTML:** أي HTML قديم مع hashes جديدة = تعطيل hydration. يجب:
   - نشر HTML + manifest معًا،
   - إبطال كاش HTML عند كل build،
   - أو ربط الكاش بـbuild ID.
4. **Standalone deployment:** نسخ `public` و`.next/static` إلى مجلد standalone (المعاينة تفعل ذلك تلقائيًا).
5. **CI:** تشغيل `csp:verify` بعد البناء وقبل النشر، والفشل إذا:
   - manifest مفقود/stale،
   - hashes لا تطابق HTML،
   - route/404/error ناقص،
   - سياسة غير صارمة.
6. **مراقبة الحجم:** 29 hash ≈ 2KB. عند إضافة routes، راقب حجم الهيدر وحدود الخادم/الـproxy.
7. **HTTPS:** استخدم النسخة الكاملة مع `upgrade-insecure-requests` في الإنتاج.
8. **اختبار ما بعد النشر:** فحص HTML الفعلي عبر الشبكة ومطابقة hashes، وليس build artifacts فقط.

---

## 8. القيود المتبقية

- **حقن الهيدر في طبقة النشر لم يُنفّذ بعد** (reverse proxy/CDN أو custom server). المعاينة المحلية تغطي التحقق.
- **إبطال الكاش الذري** يحتاج إعدادًا في بيئة النشر.
- **حجم الهيدر ينمو** مع عدد routes؛ يجب مراقبته.
- **SRI غير مفعّل** (اختياري/تجريبي).
- **Nonce/dynamic غير مستخدم**.
- **style-src-attr `'unsafe-inline'`** استثناء ضيق لخصائص React style فقط.
- **Google Fonts خارجي** (مسموح صراحةً).
- **لا CSP report endpoint** مركزي؛ الأدلة من console/`securitypolicyviolation`.

---

## 9. هل CSP جاهز لتفعيل محلي؟

**نعم تقنيًا:** خط الإنتاج يولّد manifest صحيحًا، والمعاينة enforce نجحت على كل المسارات مع 0 violations ووظائف كاملة.

**لكن التفعيل الفعلي غير تم:** التطبيق المحلي ما زال Report-Only، والتفعيل يحتاج:

1. اعتماد هذا التقرير.
2. موافقة صريحة منفصلة لتفعيل Enforce محليًا.
3. اختيار طريقة حقن الهيدر في النشر.
4. تنفيذ النشر الذري وإبطال الكاش.
5. تشغيل `csp:verify` في CI.
6. اختبار staging/ما بعد النشر.

---

## 10. الحالة النهائية

| العنصر | الحالة |
|---|---|
| Frontend `:3001` | يعمل — **Report-Only** |
| Backend `:4001` | يعمل — Cookie auth |
| Enforce على التطبيق الفعلي | **غير مفعّل** |
| Production build + manifest | تم توليده والتحقق منه |
| Local enforce preview | تم اختباره ثم أُوقف |
| Git HEAD | `d43cae5` |
| Commits/pushes | لا شيء |
| بيانات الأعمال | لم تُعدّل |

**التوقف هنا للمراجعة اليدوية قبل أي تفعيل.**
