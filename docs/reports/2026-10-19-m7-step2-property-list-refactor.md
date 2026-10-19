# M7 — Step 2: استخراج منطق جلب وتحديث قائمة العقارات المشترك إلى Hook واحد

**التاريخ:** 2026-10-19
**النطاق:** استخراج منطق جلب/تحديث قائمة العقارات المكرر فعليًا بين صفحتَي المدير والموظف إلى وحدة مشتركة واحدة `apps/frontend/lib/use-property-list.ts`
**HEAD عند التنفيذ:** `fda252137c0e605c7a0dd54b350480679ee5dc3a` (لم يُنشأ أي commit في هذه الخطوة)

---

## 1. ما تم إنجازه

- فحص الصفحتين كاملتين قبل أي تغيير: `features/manager-properties/components/manager-properties.tsx` (496 سطرًا) و`features/employee-properties/components/employee-properties-page.tsx` (299 سطر).
- التأكد أن المستهلكين لقناتَي الإشعارات (`usePropertyRefreshSignal` و`useOpenPropertyRequest`) هما الصفحتان فقط، ولا يوجد سطر ثالث يكرر نمط الجلب (`listProperties(` تُستدعى في الملفين فقط).
- استخراج الآلية المكرّرة حرفيًا إلى Hook عام واحد: **`apps/frontend/lib/use-property-list.ts`** (223 سطرًا، ملف جديد untracked).
- تحويل الصفحتين للاستدعاء من الـHook المشترك **دون أي تغيير في الواجهة أو السلوك**: نفس الأصناف ونفس الـJSX ونفس نصوص الأخطاء العربية حرفيًا.
- تشغيل typecheck وlint وproduction build للتحقق (كلها ناجحة، القسم 5).

**ما انتقل إلى الـHook المشترك (كان مكررًا حرفيًا في الصفحتين):**

1. حالة القائمة: `items` / `nextCursor` / `loading` (تبدأ `true`) / `loadingMore` / `error` / `selected`.
2. درع الطلب أحادي الاتجاه `requestId` (الرد المتأخر لا يستطيع أبدًا الكتابة فوق تحميل أحدث) — نفس اسم المتغير ونفس منطقه.
3. الوضع الصامت `silentRef`: قراءة مُطلَقة من إشارة الإشعارات تُبقي الصفوف الظاهرة حتى تحلّ محلّها الصفوف الجديدة (ولا تُمسح الصفوف عند فشل قراءة صامتة).
4. `nonce` + دالة `refetch` — مطابقتان تمامًا لما كانتا في الصفحتين.
5. تأثير إشارة التحديث: `refreshSignal === 0 → return` ثم `silentRef = true; refetch()` — منقول كما هو بما في ذلك التعليق التوضيحي.
6. تأثير الفتح العميق من الإشعار: `getProperty` → تحويل عبر Mapper → `setSelected`، مع `cancelled` cleanup، ورسالة الخطأ `«تعذّر فتح العقار.»`، و`consumeOpenProperty` في `finally`.
7. تأثير الجلب الرئيسي: الحلقة أحادية الـ`do/while` مع حماية `id !== requestId.current` في كل خطوة، ورسالة الخطأ الافتراضية `«تعذر تحميل العقارات من الخادم.»`، وسلوك الفشل الصامت (إبقاء الصفوف + إيقاف المؤشر فقط).
8. دالة `loadMore`: حماية `!nextCursor || loadingMore`، الإلحاق بدل الاستبدال، ورسالة الخطأ `«تعذر تحميل المزيد من العقارات.»`.

**ما تبقّى في الصفحتين دون تغيير (أي بُعد):** كل الـJSX وتصميم Astra، التبويبات والفلترة (`filterProperties`/`matchesTab`)، عدّادات التبويبات والإحصاءات، أزرار وقرارات المراجعة (`approve`/`submitDecision`/`busyId`/`ApiError 409`)، نوافذ الإضافة والمودالات، ورسائل Toast.

---

## 2. الفروقات بين الصفحتين — محفوظة عبر **الإعداد** لا عبر النسخ

| البُعد | المدير | الموظف | كيف حُفظ |
| ------ | ------ | ------ | -------- |
| حجم الصفحة | `PAGE_SIZE = 100` | `PAGE_SIZE = 50` | خيار `pageSize` لكل صفحة كما هو |
| صفحات لكل تحميل | `MAX_PAGES_PER_LOAD = 3` (حلقة تجلب حتى 3 صفحات لتغطية عدّادات العناوين) | صفحة واحدة فقط | خيار `maxPagesPerLoad` بقيمة افتراضية `1`؛ مع `1` تصبح الحلقة تحميل صفحة واحدة بالضبط — طلب `listProperties({ limit: 50 })` **مطابق حرفيًا** لطلب الموظف القديم |
| نموذج العرض | `PreviewProperty` عبر `mapPreviewFromApi` | `Property` عبر `mapPropertyFromApi` | خيار `mapProperty` (كلاهما نفس الدوال في `lib/property-adapter.ts` بدون تغيير) |
| الإبلاغ عن فشل الفتح العميق | `notify(...)` (Toast بـ `sequence`) | `setNotice(...)` (نص) | خيار `onOpenError` — كل صفحة تُبلغ بآلية إعلانها الخاصة |
| تذييل اسم العميل | `viewer: user` | `viewer: user` (و`disabled={!user}` في زر الإضافة باقٍ كما هو) | خيار `viewer` من نفس `useAuth()` |

---

## 3. المسارات: قبل وبعد

| العنصر | قبل (مكرر في ملفين) | بعد (وحدة واحدة) |
| ------ | -------------------- | ----------------- |
| جلب القائمة + الحماية من الرد المتأخر + الوضع الصامت | نسخة في كل صفحة | `apps/frontend/lib/use-property-list.ts` |
| إشارة تحديث الإشعارات (`usePropertyRefreshSignal` + تأثيرها) | نسخة في كل صفحة | نفسه |
| الفتح العميق (`useOpenPropertyRequest` + `getProperty` + `consumeOpenProperty`) | نسخة في كل صفحة | نفسه |
| `loadMore` | نسخة في كل صفحة | نفسه |

اختيار الموقع `lib/` متسق مع سلوك المستودع القائم: `lib/drafts/use-form-draft.ts` يستورد بالفعل `useAuth` من `features/auth` في الاتجاه نفسه، ويوجد Hook React آخر في `lib/api/use-property-image.ts`، ولا توجد قواعد ESLint تمنع حدود الاستيراد.

---

## 4. كل الملفات التي تغيّرت

### 4.1 ملف جديد (untracked)
- **`apps/frontend/lib/use-property-list.ts`** (223 سطرًا) — الـHook المشترك `usePropertyList<T>` مع واجهتَي `UsePropertyListOptions<T>` و`PropertyListResult<T>`، وتعليقات توثيقية تشرح ما هو مشترك وما هو مُهيَّأ لكل صفحة.

### 4.2 ملفان معدَّلان فقط
| الملف | قبل | بعد | التغيير |
| ----- | ---- | ---- | ------- |
| `features/manager-properties/components/manager-properties.tsx` | 496 سطرًا | 389 سطرًا | **+41/−148** تقريبًا: حُذفت الحالات الخمس و`requestId`/`silentRef`/`nonce` وثلاثة تأثيرات و`loadMore`، واستُبدل استدعاء `usePropertyList<PreviewProperty>({ pageSize: PAGE_SIZE, maxPagesPerLoad: MAX_PAGES_PER_LOAD, mapProperty: mapPreviewFromApi, viewer: user, onOpenError: notify })`. بقي `notify` و`approve`/`submitDecision`/`onAction` كما كانتا |
| `features/employee-properties/components/employee-properties-page.tsx` | 299 سطرًا | 198 سطرًا | **+4/−105** تقريبًا: نفس الحذف، واستدعاء `usePropertyList<Property>({ pageSize: PAGE_SIZE, mapProperty: mapPropertyFromApi, viewer: user, onOpenError: setNotice })` |

**إجمالي الـdiff:** ملفان معدَّلان (+45/−253) + ملف جديد (223 سطرًا). صافي انخفاض كبير في التكرار.

### 4.3 الاستيرادات المُزالة من الصفحتين (أصبحت كلها داخل الـHook)
- `getProperty`, `listProperties` من `lib/api/properties-api` (المدير بقي يستورد ثلاث دوال قرارات المراجعة فقط: `approveProperty`, `rejectProperty`, `requestChangesProperty`).
- `PropertyViewDto` من `lib/api/property-types`.
- `consumeOpenProperty`, `useOpenPropertyRequest` من `features/notifications/open-property`.
- `usePropertyRefreshSignal` من `features/notifications/property-refresh`.
- من `react`: `useEffect` و`useRef` (المدير) و`useCallback` (الموظف) — لم تعد مطلوبة في الصفحتين.

### 4.4 الاستيرادات المُضافة للصفحتين
- سطر واحد لكل صفحة: `import { usePropertyList } from '../../../lib/use-property-list';`

> لا يوجد barrel/index يُعيد تصدير القديم، ولا أي ملف آخر يستورد رموزًا محذوفة من الصفحتين (الصفحتان تُصدّران `ManagerProperties` و`EmployeePropertiesPage` فقط، وهو ما يستورده `app/manager/properties/page.tsx` و`app/employee/properties/page.tsx` بلا تغيير).

---

## 5. كيف حُفظ السلوك والصلاحيات وال_pagination والتحديث وواجهة Astra

- **مرجعيات التأثيرات (effect deps) محفوظة:** تأثير الجلب يعمل على `[nonce, viewer, pageSize, maxPagesPerLoad]` (الأخيران ثوابت لا تتغير = سلوك `[nonce, user]` القديم حرفيًا)، وتأثير الفتح العميق على `[openRequest, viewer]` (كما كانت مع `notify` المستقر عبر `useCallback([])`)، وتأثير الإشارة على `[refreshSignal, refetch]`.
- **مرجعيات_mapper المُمرَّرة عبر ref:** `mapProperty` و`onOpenError` تُخزَّنان في refs ويُحدَّثان بعد كل render، حتى لو أعاد مستقبل مستقبلي تمرير دالة غير مستقرة (inline) لا تتغيّر مرجعية التأثيرات — والصفحتان تمرّران دوالًا مستوى الوحدة مستقرة أصلًا (`mapPreviewFromApi` / `mapPropertyFromApi` / `notify` / `setNotice`)، فأي تغيّر في مرجعية التأثيرات مستحيل هنا.
- **الصلاحيات:** لم يتغيّر شيء — الخادم هو مصدر الصلاحية في القراءة (`GET /properties` و`GET /properties/:id`)؛ الـHook يُمرّر `viewer` بنفس الدوال المحوّلة نفسها؛ ورفض/اعتماد/طلب تعديل بقيت في صفحة المدير بمنطق `ApiError`/409/404 كما كانت.
- **الـpagination:** المدير يجلب حتى 3 صفحات × 100 في كل تحميل ثم «تحميل المزيد» بالـcursor؛ الموظف يجلب 50 ثم «تحميل المزيد». مع `maxPagesPerLoad=1` تصبح حلقة الـHook تحميل صفحة واحدة بالضبط (نفس طلب الموظف القديم `listProperties({ limit: 50 })` بلا `cursor`)، ونفس `setNextCursor(page.nextCursor)`.
- **التحديث من الإشعارات:** نفس القناة ونفس السلوك الصامت (لا وميض للوحة، إعادة محاولة في التحديث التالي عند الفشل، لا حلقة تكرار لأن القائمة لا تنشر شيئًا). جرس الإشعارات (`notification-bell.tsx` → `notifyPropertyDataChanged`) لم يُمسّ.
- **الفتح العميق من الإشعار:** نفس مسار `getProperty` → mapper → `setSelected` → فشل يُبلَّغ عبر آلية الصفحة (Toast بـ`sequence` للمدير، نص للموظف) → `consumeOpenProperty` في `finally` مع `cancelled` في cleanup.
- **نصوص الأخطاء العربية حرفيًا كما كانت:** `«تعذر تحميل العقارات من الخادم.»` و`«تعذر تحميل المزيد من العقارات.»` و`«تعذّر فتح العقار.»`.
- **واجهة Astra:** لم يتغيّر أي حرف في الـJSX أو ملفات CSS أو الأصناف أو RTL أو العدّادات؛ الصفحتان تُصدّران نفس المكوّنان بنفس الـprops؛ build الإنتاج أخرج 22 مسارًا ثابتًا بنجاح.

---

## 6. نتائج الفحص والبناء

| الفحص | الأمر | النتيجة |
| ----- | ----- | ------- |
| Frontend typecheck | `npm run typecheck -w @arkan/frontend` (بعد بناء `@arkan/shared`) | **نجح — exit 0، بلا أخطاء** |
| Lint | `npm run lint` (`eslint apps packages`) | **نجح — exit 0، بلا تحذيرات** |
| Frontend production build | `npm run build -w @arkan/frontend` (Next.js 16.3.4 Turbopack) | **نجح — exit 0**؛ «Compiled successfully» + «Finished TypeScript» + 22/22 مسارًا ثابتًا، بما فيها `/manager/properties` و`/employee/properties` |

لم تُشغَّل اختبارات قاعدة البيانات (لا حاجة — تغيير frontend للاستخراج فقط، بلا أي لمس للـAPI أو الـDB).

---

## 7. التحذيرات والمشكلات والعناصر غير المُنجَزة

1. **تحذيرات LF/CRLF من Git:** تظهر `LF will be replaced by CRLF the next time Git touches it` عند `git diff` لملفي الصفحتين — سلوك قائم مسبقًا في المستودع (`core.autocrlf=true`) وليس خاصًّا بهذه الخطوة.
2. **لم يُنشأ commit:** التعليمات تُلزم عدم الالتزام (commit/push/reset/clean ممنوعة). التغييرات معلَّقة في شجرة العمل فقط.
3. **قنوات الإشعارات لم تُندمج في الـHook:** `property-refresh.ts` و`open-property.ts` بقيتا كما هي؛ الـHook يستهلكهما فقط (كان خارج نطاق الخطوة: دمج قنوات النشر/الاستهلاك).
4. **`new-property-modal-v2.tsx` و`property-request-model.ts` لم تُمَس:** لا يُكرّران نمط جلب القائمة (النطاق المُعتمد هو منطق قائمة العقارات في الصفحتين فقط).
5. **لا تغييرات في الوثائق القديمة:** لم يُعدَّل أي تقرير سابق يذكر مسارات قديمة (مستندات فقط).

---

## 8. حالة شجرة Git الحالية

- **HEAD:** `fda252137c0e605c7a0dd54b350480679ee5dc3a` (لم يتغيّر؛ لم يُنشأ commit).
- **معدَّل (unstaged) — تغييرات M7 Step 2 (ملفان، +45/−253):**
  - `M` `apps/frontend/features/manager-properties/components/manager-properties.tsx`
  - `M` `apps/frontend/features/employee-properties/components/employee-properties-page.tsx`
- **غير متعقَّب (untracked) — ملف جديد (1):**
  - `??` `apps/frontend/lib/use-property-list.ts`
- **لم يُنفَّذ:** commit / push / reset / clean / stash / checkout، ولم تُمَس قاعدة البيانات.

---

## 9. تأكيد الحفاظ على تصميم Astra والوظائف الحيّة

- **تصميم Astra:** لم يتغيّر — نفس الـJSX حرفيًا في الصفحتين، ونفس ملفات CSS، ونفس الأصناف والألوان والمسافات وRTL والحركة؛ لم تُضَف ولا تُحذَف قاعدة CSS واحدة.
- **الوظائف:** نفس القائمة تُجلب بنفس الطلبات وبنفس الحماية من الرد المتأخر وبنفس التحديث الصامت من الإشعارات وبنفس الفتح العميق من الإشعار؛ قرارات المراجعة للمدير وصلاحياتها كما كانت؛ تبويبات وفلاتر الموظف كما كانت.
- **لا تكرار ولا كسر:** المنطق المكرر انتقل إلى وحدة واحدة (223 سطرًا توثيقية)، وحُذف 253 سطرًا من الصفحتين، وtypecheck + lint + build الإنتاج كلها ناجحة (exit 0).
