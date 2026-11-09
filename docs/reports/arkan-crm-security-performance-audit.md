# تقرير تدقيق الأمان والأداء وجودة الكود — Arkan CRM

**التاريخ:** 2026-11-06  
**المشروع:** `D:\Projects\arkan-crm`  
**الفرع:** `main` — `HEAD d43cae5` (متزامن مع `origin/main`)  
**نطاق التدقيق:** الخلفية، الواجهة، المصادقة، الصلاحيات، الملفات، قاعدة البيانات، الاعتماديات، الأداء، جودة الكود.  
**حالة Git قبل التدقيق:** working tree نظيف بالكامل.

> **ملاحظة نشر:** لم يتم تنفيذ أي `commit` أو `push` أو `reset` أو `rebase` أو migration. جميع الإصلاحات أدناه موجودة كتغييرات غير ملتزمة بانتظار المراجعة اليدوية.

---

## 1. التقييم الأمني العام

التقييم العام: **جيد وقوي في طبقة التطبيق**، مع نقاط ضعف متبقية معظمها في الاعتماديات وبعض قرارات المعمارية والإنتاج.

ما تم التحقق منه فعليًا:

- كلمات المرور تُخزّن بـ `scrypt` مع ملح فريد (`N=32768`) وتُقارن بـ `timingSafeEqual`.
- رموز الوصول JWT قصيرة العمر (15 دقيقة افتراضيًا) وتُتحقق من الجلسة الحية في قاعدة البيانات عند كل طلب.
- رموز التحديث عشوائية 48 بايت، تُخزّن مجزّأة SHA-256، أحادية الاستخدام، وتُدوّر مع الحفاظ على lineage.
- الخروج يلغي عائلة الجلسة كاملة ويوقف اشتراكات Push المرتبطة بها.
- تعطيل الحساب يلغي جلساته، وتغيير الدور يبطل الرموز القديمة بسبب مطابقة الدور مع قاعدة البيانات.
- لا توجد Cookies للمصادقة، لذلك لا يوجد سطح CSRF تقليدي؛ الرموز تُرسل عبر `Authorization`.
- كل استعلامات SQL الخام في كود الإنتاج مُعاملة (parameterized) ولا يوجد `queryRawUnsafe` خارج الاختبارات.
- `ValidationPipe` عالمي مع `whitelist` و`forbidNonWhitelisted`، وmultipart يُتحقق منه يدويًا بنفس القواعد.
- رفع الصور يعتمد على البايتات الفعلية، ثم إعادة ترميز Sharp، وإزالة الميتاداتا، وحدود بكسل/أبعاد/حجم.
- التخزين خاص، والمفاتيح مُولّدة على الخادم، و`resolve()` يرفض traversal، وصور العقارات تُقدَّم عبر endpoint مُصرَّح.
- لا توجد مصادر XSS مباشرة (`dangerouslySetInnerHTML`, `innerHTML`, `eval`)، وReact يهرّب النصوص.
- اختبارات IDOR/BOLA الموجودة تغطي العقارات، العملاء، جهات التواصل، المتابعات، الإشعارات، ومراجعات العملاء، وكلها ناجحة.

**لا توجد ثغرة IDOR/BOLA أو تسريب بيانات مؤكدة في كود التطبيق بعد الفحص والاختبارات.**

---

## 2. النتائج الحرجة والعالية

### 2.1 حرجة — تم إصلاحها

| # | النتيجة | الملف/المكوّن | الدليل | الإصلاح |
|---|---|---|---|---|
| C1 | Next.js 16.3.4 يحتوي عدة ثغرات حرجة: RCE في `next/og` وImage Optimization، تلوث كاش، SSRF، وتسريب Draft Mode/`use cache` | `apps/frontend/package.json` | `npm audit`: 11 advisory حرجة/عالية على `next` | ترقية إلى **16.4.5** |
| C2 | `proxy-addr` 2.0.7 — انتحال IP عبر IPv4-mapped IPv6 | transitive عبر `express` | `npm audit` (Critical) | `npm audit fix` → **2.0.8** |
| C3 | `shell-quote` 1.9.0 — حقن أوامر عبر `quote()` | transitive عبر `concurrently` (أدوات تطوير فقط) | `npm audit` (Critical) | ترقية ثم **إزالة `concurrently` غير المستخدمة** |

### 2.2 عالية — تم إصلاحها

| # | النتيجة | الملف/المكوّن | الإصلاح |
|---|---|---|---|
| H1 | `body-parser` 2.3.0 — DoS عبر بايتات زائدة بعد جسم مضغوط | transitive عبر `express` | **2.4.0** |
| H2 | `joi` 18.2.8 — تلوث prototype وDoS في رسائل/بريد متعدد | `apps/backend` | **18.3.2** |
| H3 | `sharp` 0.35.4 — ثغرة librsvg | `apps/backend`, transitive في Next | **0.35.5** |
| H4 | غياب رؤوس أمان أساسية في API والواجهة | `configure-app.ts`, `next.config.ts` | إضافة `nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`, وإخفاء `X-Powered-By` |
| H5 | CORS في الإنتاج كان يضيف `localhost` و`192.168.1.8` دائمًا | `main.ts` | استخراج `resolveCorsOrigins()`؛ الأصل المحلي للتطوير فقط وليس الإنتاج |

### 2.3 عالية — متبقية وتحتاج موافقة

| # | النتيجة | السبب | خطر فعلي | المطلوب |
|---|---|---|---|---|
| R1 | `multer` 2.4.0 — عدة advisories DoS | مثبّت حصريًا داخل `@nestjs/platform-express@11.2.8` | **متوسط بعد التخفيف**: الرفع يتطلب جلسة موظف/مدير، لا نستخدم `fileFilter` غير متزامن، والتخزين ذاكرة وليس قرصًا، وأُضيفت حدود multipart صارمة | ترقية Nest 12 / multer ≥2.5 مع اختبار انحدار كامل، أو override مُدار عند توفر حل رسمي |
| R2 | `prisma`/`deepmerge-ts` 6.19.3 | إصلاحه يتطلب Prisma 7.10.1 (Major) | **منخفض**: أداة CLI تطوير/ترحيل، وليست مسار الطلبات | خطة ترقية Major منفصلة بموافقة المالك |
| R3 | `@nestjs/platform-express` advisory مركب | ناتج عن multer أعلاه | نفس R1 | معالجة R1 |

**لا توجد ثغرة حرجة متبقية بعد الإصلاحات (0 Critical).**

---

## 3. النتائج المتوسطة والمنخفضة

### 3.1 متوسطة (متبقية / تحتاج قرارًا)

| # | النتيجة | الملف | التفصيل |
|---|---|---|---|
| M1 | لا توجد سياسة CSP | `apps/frontend/next.config.ts` | الرؤوس المضافة لا تشمل CSP. Next يحتاج nonces/hashes وقد يتطلب تعديل بنية العرض. |
| M2 | رموز الجلسة في `sessionStorage` | `apps/frontend/features/auth/session.ts` | أفضل من `localStorage`، لكن أي XSS يستطيع قراءتها. الحل المعماري: httpOnly + Secure + SameSite cookies مع CSRF token. |
| M3 | لا يوجد rate limiting عام ولا موزّع | `auth.module.ts` | تسجيل الدخول 10/دقيقة والتحديث 30/دقيقة داخل الذاكرة فقط؛ لا يعمل عبر عدة instances. |
| M4 | لا يوجد إعداد `trust proxy` | `main.ts` | خلف reverse proxy قد يظهر كل المستخدمين بعنوان واحد فيتأثر حد الدخول. لا يمكن تغييره دون معرفة طوبولوجيا النشر. |
| M5 | SSRF محتمل عبر Web Push endpoint | `push/dto/push-subscription.dto.ts`, `push.service.ts` | المدير فقط يستطيع تسجيل endpoint تعسفي HTTPS، ثم يرسل الخادم إليه. يُنصح بقائمة نطاقات لمزودي Push. |
| M6 | فهارس قاعدة بيانات ناقصة | `prisma/schema.prisma` | لا فهارس على `Deal.closedAt`, `Client.createdAt`, `AuditLog(action, createdAt)`, `Property.createdAt`، مع أنها مسارات لوحة المدير والفلاتر. يلزم migration بموافقة. |
| M7 | `GET /clients` الافتراضي 1000 صف مع includes | `clients.service.ts` | يحمّل قائمة كبيرة للعميل؛ يلزم pagination/بحث server-side قبل النمو الكبير. |
| M8 | إحصاءات العملاء تحمّل كل IDs ثم تُجمّع | `clients.service.ts` | استهلاك ذاكرة مع نمو العملاء؛ يفضل SQL aggregates. |
| M9 | لوحة المدير تحمّل كل صفقات الفترة إلى الذاكرة | `dashboard.service.ts` | مقبول حاليًا، لكن "كل الوقت" قد يصبح مكلفًا؛ يفضل التجميع في SQL. |
| M10 | كشف التكرار يحمّل كل العقارات النشطة في المحافظة/المنطقة ثم يصنّف في الذاكرة | `properties.service.ts` | يتأثر مع كثافة العقارات؛ يفضل prefilter أدق أو trigram. |
| M11 | الحضور وNFC واجهة Mock في `localStorage` | `employee-attendance/*` | لا يوجد تحقق خادمي ولا سجل تدقيق حقيقي. يجب استبداله قبل الإنتاج إن كانت الميزة مطلوبة. |
| M12 | مسار معاينة تطويري داخل بناء محلي | `apps/frontend/app/dev/` | مستبعد من Git عبر `.gitignore`، فلا يصل للنشر من نسخة نظيفة؛ يبقى محليًا فقط. |

### 3.2 منخفضة

| # | النتيجة |
|---|---|
| L1 | `POST /auth/logout` غير محدود المعدل (لكنه يتطلب رمزًا صالحًا). |
| L2 | سياسة كلمة المرور 8 أحرف فقط، بلا تعقيد أو MFA. |
| L3 | لا كشف لإعادة استخدام Refresh Token على مستوى العائلة (rotation يمنع الاستخدام لكن لا يلغي العائلة عند الاشتباه). |
| L4 | لا HSTS؛ يجب ضبطه على reverse proxy بعد التأكد من HTTPS. |
| L5 | `/health/ready` عام ويكشف فقط حالة DB/Redis (لا أسرار). |
| L6 | وحدات `owners`, `attendance`, `smart-paste` فارغة (حدود نطاق مستقبلية) — كود ميت لكنه غير ضار. |
| L7 | JWT guard يستعلم الجلسة من DB في كل طلب؛ أمان إبطال فوري مقابل حمل DB إضافي. |
| L8 | مسودات النماذج في `localStorage` (مُنقّاة من password/token، ومفصولة بـ userId) لكنها تبقى بعد الخروج. |
| L9 | `JWT_REFRESH_SECRET` كان موجودًا في `.env.example` دون استخدام — أُزيل. |

---

## 4. الإصلاحات المنفذة والملفات المتغيرة

### 4.1 إصلاحات أمنية

1. **ترقية الاعتماديات الحرجة/العالية:**
   - `next` 16.3.4 → **16.4.5**
   - `joi` 18.2.8 → **18.3.2**
   - `sharp` 0.35.4 → **0.35.5**
   - `@nestjs/platform-express` 11.2.3 → **11.2.8**
   - `ts-jest` 29.4.12 → **29.4.15**
   - `npm audit fix`: `proxy-addr` 2.0.8، `body-parser` 2.4.0، `qs` 6.17.1.

2. **رؤوس أمان API** في `apps/backend/src/common/configure-app.ts`:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Referrer-Policy: no-referrer`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
   - تعطيل `X-Powered-By`.

3. **CORS إنتاجي آمن** عبر `apps/backend/src/config/cors-origins.ts`:
   - `FRONTEND_ORIGIN` فقط في `NODE_ENV=production`.
   - origins المحلية للتطوير فقط.
   - إزالة التكرار والمسافات.

4. **حدود multipart صارمة** في `properties.controller.ts`:
   - ملف واحد، 5MB، 10 حقول، 1MB لكل حقل، 20 part، 2000 header pair.
   - يخفف فئة DoS الخاصة بـ multer بغض النظر عن الترقية.

5. **حماية Service Worker من Open Redirect** في `public/sw.js`:
   - فتح المسارات الداخلية فقط (`/...` وليس `//...`).

6. **إزالة `concurrently`** غير المستخدمة من root devDependencies.

7. **إزالة `JWT_REFRESH_SECRET`** الميت من `.env.example`.

### 4.2 إصلاحات أداء

1. **إيقاف استطلاع الإشعارات في التبويبات المخفية** في `features/notifications/store.ts`:
   - لا polling ولا طلب أولي ما دامت الصفحة مخفية.
   - إعادة مزامنة فورية عند `visibilitychange` أو `focus`.
   - تنظيف مستمعات `visibilitychange`/`focus` عند إلغاء الاشتراك.

2. **تحسين حجم الحزمة** نتيجة ترقية Next وإزالة أدوات غير مستخدمة (قياس فعلي أدناه).

### 4.3 إصلاحات جودة الكود

1. ضبط ESLint لبيئة Service Worker في `eslint.config.mjs` (كان `npm run lint` يفشل بـ9 أخطاء `self is not defined`).
2. إزالة توجيه `eslint-disable` القديم غير الضروري.
3. إضافة اختبارات انحدار أمنية جديدة.

### 4.4 الملفات المتغيرة

**معدّلة (12):**
- `package.json`, `package-lock.json`
- `apps/backend/package.json`
- `apps/backend/.env.example`
- `apps/backend/src/main.ts`
- `apps/backend/src/common/configure-app.ts`
- `apps/backend/src/properties/properties.controller.ts`
- `apps/frontend/package.json`
- `apps/frontend/next.config.ts`
- `apps/frontend/public/sw.js`
- `apps/frontend/features/notifications/store.ts`
- `eslint.config.mjs`

**جديدة (4):**
- `apps/backend/src/config/cors-origins.ts`
- `apps/backend/test/cors-origins.spec.ts`
- `apps/backend/test/security-hardening.spec.ts`
- `apps/backend/test/properties-upload-limits.spec.ts`

**جديد (تقرير):**
- `docs/reports/arkan-crm-security-performance-audit.md`

---

## 5. الأداء: القياسات قبل/بعد

### 5.1 حزمة JavaScript للواجهة (قياس فعلي)

| القياس | قبل | بعد | الفرق |
|---|---:|---:|---:|
| إجمالي ملفات JS | 44 | 43 | -1 |
| إجمالي البايتات (غير مضغوطة) | 1,640,363 | 1,567,775 | **-72,588 (-4.43%)** |

السبب: ترقية Next 16.4.5 + إزالة `concurrently` من شجرة التطوير. القياس من `.next/static/chunks` بعد `next build` إنتاجي.

### 5.2 استطلاع الإشعارات في التبويب المخفي

- قبل: كل تبويب يرسل **4 طلبات/دقيقة** (قائمة + عدّاد غير المقروء كل 15 ثانية) حتى وهو مخفي.
- بعد: **0 طلبات أثناء الإخفاء**، ثم طلبان فورًا عند العودة.
- القياس: محسوب من مسار الكود (15 ثانية × طلبان)، وليس من متصفح مباشر.

### 5.3 قاعدة البيانات (قراءة فقط على قاعدة التطوير)

بيانات الجداول وقت القياس:

| الجدول | الصفوف |
|---|---:|
| Property | 4 |
| Deal | 0 |
| Client | 0 |
| Contact | 0 |
| Notification | 9 |
| AuditLog | 215 |
| FollowUpSubject | 0 |
| FollowUpEntry | 0 |

خطط `EXPLAIN (ANALYZE, BUFFERS)` أظهرت **Seq Scan** على `Deal`, `AuditLog`, `Client`, `Property`, `Notification`. لكن حجم البيانات صغير جدًا، لذلك لا يمكن اعتبار التوقيت دليلًا على تحسن أو تدهور. الدليل الحقيقي على نقص الفهارس هو `schema.prisma` نفسه:

- `Deal.closedAt` بلا فهرس (لوحة المدير).
- `Client.createdAt` بلا فهرس (العملاء الجدد).
- `AuditLog(action, createdAt)` بلا فهرس (آخر الأنشطة).
- `Property.createdAt` بلا فهرس (قوائم العقارات والفرز).

**لم يتم إجراء أي تحسين استعلام أو migration، ولم ندّع تحسنًا زمنيًا غير مقيس.**

---

## 6. تنظيف الكود المنجز

- إزالة `concurrently` غير المستخدمة (كانت مذكورة فقط في scripts قديمة/توثيق).
- إزالة `JWT_REFRESH_SECRET` غير المستخدم من قالب البيئة.
- إصلاح إعداد ESLint للـ Service Worker بدل تعطيل القاعدة.
- إزالة تعليق `eslint-disable` الميت.
- لا توجد `console.log` أو أدوات تصحيح متروكة في كود الإنتاج.
- لم تُحذف أي ميزة أو صفحة أو اختبار أو migration.

---

## 7. الاختبارات والبناء

### 7.1 خط الأساس قبل التعديل

| الفحص | النتيجة |
|---|---|
| Backend Jest | **62 suites / 676 tests ناجحة** |
| Backend typecheck | ✅ |
| Frontend typecheck | ✅ |
| ESLint | ❌ 9 أخطاء (`self` في `apps/frontend/public/sw.js`) |
| `nest build` | ✅ |
| `next build` | ✅ |

### 7.2 بعد جميع الإصلاحات

| الفحص | النتيجة |
|---|---|
| Backend Jest | **65 suites / 683 tests ناجحة** |
| Backend typecheck | ✅ |
| Frontend typecheck | ✅ |
| ESLint | ✅ 0 أخطاء / 0 تحذيرات |
| `nest build` | ✅ |
| `next build` | ✅ |
| اختبارات الأمان الجديدة | ✅ 11/11 |
| اختبار حدود multipart | ✅ ضمن الحزمة الكاملة |

الاختبارات الجديدة تغطي:

- وجود رؤوس الأمان وغياب `X-Powered-By` على كل استجابة.
- منع إضافة origins التطوير في الإنتاج، والسماح بها في التطوير، وإزالة التكرار.
- رفض multipart بعدد حقول زائد قبل الوصول للخدمة، وعدم إنشاء أي عقار.

### 7.3 تدقيق الاعتماديات (npm audit)

| الشدة | قبل | بعد |
|---|---:|---:|
| Critical | 5 | **0** |
| High | 10 | **5** |
| Moderate | 25 | **23** |
| Low | 5 | **5** |
| **الإجمالي** | **45** | **33** |

الـ5 High المتبقية:

- `multer` (عبر Nest) — DoS، مخفّف بحدود multipart.
- `prisma` / `@prisma/config` / `deepmerge-ts` — أداة CLI، إصلاحها Major.
- `@nestjs/platform-express` — تجميعي بسبب multer.

جميع ما تبقى من Moderate/Low في أدوات التطوير (`jest`, `ts-jest`, `typescript-eslint`, `glob`, `minimatch`, `fork-ts-checker`) وليست في حزمة الإنتاج.

---

## 8. المخاطر المتبقية التي تحتاج موافقة المالك

هذه **لم تُعدّل** لأنها تتطلب تغييرًا معماريًا أو migration أو ترقية Major:

1. **ترقية Nest 12 / multer ≥2.5** لإنهاء advisories الـDoS المتبقية.
2. **ترقية Prisma 7.x** لمعالجة deepmerge-ts (خطة واختبارات مخصصة).
3. **CSP كاملة** للواجهة (nonces/hashes) وHSTS على الـreverse proxy.
4. **نقل الجلسات إلى httpOnly Secure SameSite cookies** مع CSRF بدل `sessionStorage`.
5. **Rate limiting موزّع** عبر Redis + إعداد `trust proxy` حسب طوبولوجيا النشر.
6. **قائمة نطاقات مسموحة لـWeb Push** لمنع SSRF.
7. **migration للفهارس:** `Deal.closedAt`, `Client.createdAt`, `AuditLog(action, createdAt)`, `Property.createdAt`.
8. **Pagination وSQL aggregates** للعملاء ولوحة المدير بدل تحميل البيانات للذاكرة.
9. **استبدال حضور/NFC الوهمي** بتطبيق خادمي موثّق ومُدقّق.
10. **تنظيف دوري** لرموز التحديث المنتهية وسجلات AuditLog القديمة.

---

## 9. قائمة تقوية الإنتاج الموصى بها

- [ ] تشغيل التطبيق خلف HTTPS وإنهاء TLS على reverse proxy موثوق.
- [ ] ضبط `trust proxy` بعدد hops معروف بدقة، وعدم الثقة بـ`X-Forwarded-For` من الإنترنت.
- [ ] تفعيل HSTS (`max-age=31536000; includeSubDomains`) وCSP على الواجهة.
- [ ] استخدام Redis لتخزين حدود المعدل في كل instances.
- [ ] إضافة حدود معدل عامة مناسبة للقراءات والداشبورد، مع استثناءات polling محسوبة.
- [ ] إبقاء `JWT_ACCESS_SECRET` عشوائيًا ≥32 حرفًا وتدويره دوريًا.
- [ ] تفعيل مراقبة محاولات الدخول الفاشلة وتنبيه عند الأنماط الشاذة.
- [ ] ضبط نسخ احتياطي مشفّر لقاعدة البيانات و`STORAGE_ROOT` واختبار الاستعادة.
- [ ] مراجعة صلاحيات حسابات المديرين سنويًا، وتفعيل MFA عند توفرها.
- [ ] إزالة/تعطيل مسارات التطوير من أي نشر إنتاجي.
- [ ] تحديث الاعتماديات أمنيًا شهريًا ومراجعة `npm audit` في CI.
- [ ] إضافة فحوص أمان آلية (SAST/DAST) واختبارات IDOR مستمرة.

---

## 10. الخلاصة

- **لا توجد ثغرات حرجة متبقية** في الاعتماديات بعد الترقية.
- **لم تُكتشف ثغرات IDOR/BOLA أو حقن SQL أو تجاوز صلاحيات** في كود التطبيق؛ الاختبارات الحالية تؤكد ذلك.
- أخطر ما تبقى هو **multer DoS** (مخفّف)، و**تخزين الرموز في sessionStorage**، و**غياب CSP/Rate limiting الموزّع**، و**الفهارس الناقصة**.
- تم إصلاح كل ما يمكن إصلاحه بأمان دون migration أو تغيير معماري، مع اختبارات انحدار.
- جميع التغييرات **غير ملتزمة وغير مدفوعة**، بانتظار المراجعة اليدوية.

**متوقف للمراجعة اليدوية.**
