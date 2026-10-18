# M7 — Step 1: نقل مكوّن التبويبات المشترك إلى `components/ui`

**التاريخ:** 2026-10-19
**النطاق:** نقل `properties-segmented-tabs` (والاعتماد الخاص `properties-tabs`) من `features/manager-properties` إلى `apps/frontend/components/ui/`
**HEAD عند التنفيذ:** `0d71c25` (لم يُنشأ أي commit في هذه الخطوة)

---

## 1. ما تم إنجازه

- فحص المكوّن المشترك `properties-segmented-tabs.tsx` وأنماطه **وكل مستهلكيه** (13 مستهلكًا) قبل أي تغيير.
- اكتشاف أن `properties-tabs.tsx` هو **اعتماد خاص** لا يستورده إلا `properties-segmented-tabs.tsx` (لا مستهلك آخر في المستودع).
- نقل وحدة التبويبات كاملة (ملفَّي TSX + أنماط CSS) إلى الموقع المشترك `apps/frontend/components/ui/` **دون إعادة كتابة سلوكها**.
- إنشاء ملف CSS مخصّص للتبويب الأساسي ونقل قواعد `.tabs` إليه **حرفيًا** من `features/manager-properties/components/properties.module.css`، ثم إزالة تلك القواعد من الملف الأصلي (لتفادي تكرار/كود CSS ميت).
- تحديث استيرادات **13 مستهلكًا** لتشير إلى الموقع الجديد.
- تشغيل typecheck وlint وproduction build للتحقق.

لم تُغيَّر أي منطق تصفية أو تحديد تبويب أو بيانات، ولا أي واجهة/تصميم.

---

## 2. المسارات: الأصلي والجديد

| العنصر | المسار الأصلي | المسار الجديد |
| ------ | ------------- | ------------- |
| المكوّن المشترك | `apps/frontend/features/manager-properties/components/properties-segmented-tabs.tsx` | `apps/frontend/components/ui/properties-segmented-tabs.tsx` |
| أنماطه | `apps/frontend/features/manager-properties/components/properties-segmented-tabs.module.css` | `apps/frontend/components/ui/properties-segmented-tabs.module.css` |
| التبويب الأساسي (اعتماد خاص) | `apps/frontend/features/manager-properties/components/properties-tabs.tsx` | `apps/frontend/components/ui/properties-tabs.tsx` |
| أنماط التبويب الأساسي | كانت داخل `.../components/properties.module.css` (قواعد `.tabs`) | `apps/frontend/components/ui/properties-tabs.module.css` (ملف جديد) |

---

## 3. كل الملفات والاستيرادات التي تغيّرت

### 3.1 ملفات جديدة (untracked) في `apps/frontend/components/ui/`
- `properties-segmented-tabs.tsx` — نسخة بايت-ببايت من الملف الأصلي (10 أسطر).
- `properties-segmented-tabs.module.css` — نسخة بايت-ببايت من الملف الأصلي (74 سطرًا).
- `properties-tabs.tsx` — نسخة من الملف الأصلي (60 سطرًا) مع تغيير **سطر استيراد واحد** فقط:
  - من `import styles from './properties.module.css';`
  - إلى `import styles from './properties-tabs.module.css';`
- `properties-tabs.module.css` — ملف جديد (31 سطرًا) يحوي قواعد `.tabs` المنقولة حرفيًا (مع تعليق توضيحي في الأعلى).

### 3.2 ملفات محذوفة من `features/manager-properties/components/`
- `properties-segmented-tabs.tsx` (10 أسطر)
- `properties-segmented-tabs.module.css` (74 سطرًا)
- `properties-tabs.tsx` (60 سطرًا)

### 3.3 ملف CSS معدَّل
- `apps/frontend/features/manager-properties/components/properties.module.css`
  - حُذفت **30 سطرًا** (0 إضافات): كتلة `.tabs` الأساسية ومعها `.toolbar .tabs` و`.tabs button` و`.tabs button[aria-selected='true']` (24 سطرًا)، وقواعد `@media (max-width:600px)` الخاصة بـ`.tabs` و`.tabs button` (6 أسطر).
  - لم تُحذف أي قاعدة أخرى (`.toolbar`, `.stats`, `.propertyCard` ... إلخ باقية كما هي).

### 3.4 المستهلكون المُحدَّثون (13 ملفًا)
جميعهم في `apps/frontend/features/<feature>/components/`، وكلهم تغيّر فيهم **سطر استيراد واحد** فقط:

| # | الملف | الاستيراد القديم | الاستيراد الجديد |
| - | ----- | ---------------- | ---------------- |
| 1 | `manager-properties/components/manager-properties.tsx` | `'./properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 2 | `manager-properties/components/property-details-drawer.tsx` | `'./properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 3 | `manager-clients/components/clients-page.tsx` | `'../../manager-properties/components/properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 4 | `manager-clients/components/client-details-drawer.tsx` | `'../../manager-properties/components/properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 5 | `manager-clients/components/owner-employee-follow-up-tabs.tsx` | `'../../manager-properties/components/properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 6 | `manager-deals/components/deals-page.tsx` | `'../../manager-properties/components/properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 7 | `manager-employees/components/employee-tabs.tsx` | `'../../manager-properties/components/properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 8 | `manager-notifications/components/notification-filters.tsx` | `'../../manager-properties/components/properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 9 | `employee-properties/components/employee-properties-page.tsx` | `'../../manager-properties/components/properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 10 | `employee-properties/components/employee-property-details-drawer.tsx` | `'../../manager-properties/components/properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 11 | `employee-clients/components/employee-clients-page.tsx` | `'../../manager-properties/components/properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 12 | `employee-clients/components/employee-client-details-drawer.tsx` | `'../../manager-properties/components/properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |
| 13 | `employee-notifications/components/employee-notification-filters.tsx` | `'../../manager-properties/components/properties-segmented-tabs'` | `'../../../components/ui/properties-segmented-tabs'` |

> لا توجد ملفات barrel/index تُعيد تصدير المكوّن، ولا يوجد alias مسارات (`@/`) في `tsconfig`، لذا كانت الاستيرادات النسبية هي المسار الوحيد الواجب تحديثه.

**الاستيراد الداخلي المنقول:** `components/ui/properties-segmented-tabs.tsx` يستورد `'./properties-tabs'` (بقي كما هو، وهو الآن داخلي في `components/ui`).

---

## 4. كيف حُوفظ على الأنماط والسلوك

- **الكود:** نُسخت ملفات TSX بايت-ببايت. التغيير الوحيد في المنطق هو سطر استيراد CSS داخل `properties-tabs.tsx` (لا تغيير سلوك). المكوّن العام `PropertiesSegmentedTabs` ما زال يولّد نفس `<PropertiesTabs {...props} className={styles.segmented} />` بنفس واجهة الخصائص (API) والأنماط والـARIA والتنقّل بلوحة المفاتيح (Arrow/Home/End) والعدّادات.
- **الأنماط:** نُقلت قواعد `.tabs` **حرفيًا** إلى `properties-tabs.module.css` بنفس المحدِّدات والخصائص.
- **ترتيب التحميل والنوعية (specificity):** بقي ملف التبويب الأساسي (`properties-tabs.module.css`) يُحمَّل **قبل** `properties-segmented-tabs.module.css` (لأن `properties-segmented-tabs.tsx` يستورد `'./properties-tabs'` قبل أنماطه)، فبقيت النوعية النسبية بين `.tabs` (صنف واحد) و`.segmented.segmented` (صنفان) كما كانت تمامًا → نفس النتيجة البصرية.
- **الكود الميت المُزال (بلا أثر بصري):** القاعدة `.toolbar .tabs { margin-bottom: 0 }` لم تُنقل (لأن `.toolbar` ينتمي إلى وحدة أخرى). وهي **بلا أثر أصلًا** لأن `.segmented.segmented { margin: 0 }` يتفوّق عليها بالنوعية ويضبط الهامش النهائي على 0.
- **سلوك الجوال محفوظ:** قاعدة `@media (max-width:600px) { .tabs button { flex: 1 } }` نُقلت مع القواعد (بينما `width:100%` يوفّرها `.segmented.segmented` داخل نفس الـmedia).
- **متغيّرات التصميم (CSS custom properties):** خصائص مثل `--manager-button-surface`, `--glass-border`, `--radius-control` تُورَث عبر DOM كما هو (لم يتغيّر موضع العنصر في الشجرة)، فلا حاجة لأي تعديل.

---

## 5. نتائج الفحص والبناء

| الفحص | النتيجة |
| ----- | ------- |
| Frontend typecheck (`npm run typecheck` — جميع الأعمال) | **نجح — exit 0** |
| Lint (`npm run lint` → `eslint apps packages`) | **نجح — exit 0** |
| Frontend production build (`npm run build -w @arkan/frontend`) | **نجح — exit 0**؛ تُرجمت كل المسارات بما فيها صفحات المدير/الموظف للعقارات والعملاء والموظفين والإشعارات |

لم تُشغَّل اختبارات قاعدة البيانات (لا حاجة — تغيير واجهة/نقل ملفات فقط).

---

## 6. التحذيرات والمشكلات والعناصر غير المُنجَزة

1. **تحذيرات LF/CRLF من Git:** عند `git diff`/`git add` تظهر تحذيرات `LF will be replaced by CRLF the next time Git touches it` لعدة ملفات (بسبب `core.autocrlf=true`) — سلوك قائم مسبقًا في المستودع وليس خاصًّا بهذه الخطوة.
2. **مرجع قديم في التوثيق:** يظهر المسار القديم `manager-properties/components/properties-segmented-tabs.tsx` في `docs/reports/2026-10-18-codebase-health-audit.md` فقط. لم يُعدَّل لأنه مستند (التعليمات: لا تحديث توثيق).
3. **إبقاء أنماط `.toolbar .tabs`:** لم تُنقل كما هو موضّح في القسم 4 (بلا أثر).
4. **حالة الفرع:** HEAD ما زال `0d71c25`؛ لم يُنشأ commit. عمل M5/M6 ما زال موجودًا (مُجهّزًا في الفهرس + شجرة العمل). لم يُنفَّذ push/reset/clean/stash/checkout.
5. **لم تظهر أي إشارة لكسر استيراد:** لا يوجد أي ملف يستورد `properties-segmented-tabs`/`properties-tabs` من المسار القديم (عدا ذكر التوثيق أعلاه).

---

## 7. حالة شجرة Git الحالية

- **HEAD:** `0d71c25` (`security: harden authentication and employee account management`).
- **المُجهّز (staged) — عمل M5/M6 السابق، لم يُمسّ (19 ملفًا، +209/−1204):**
  - `M`  `apps/backend/test/support/test-app.ts`
  - `M`  `apps/frontend/features/manager-clients/components/mock-data.ts`
  - `M`  `apps/frontend/features/manager-employees/components/employees-page.tsx`
  - `A`  `apps/frontend/lib/search.ts`
  - `A`  `docs/reports/2026-10-18-m6-step3-client-wizard-cleanup.md`
  - `D`  12 ملفًا (7 في `employee-clients/components/request-wizard/` + 5 في `employee-properties/components/`)
  - `M`  (جزئيًا) `employee-clients/components/employee-clients-page.tsx` و`manager-clients/components/clients-page.tsx`
- **غير المُجهّز (unstaged) — تغييرات M7 (17 ملفًا، +13/−187):**
  - 13 ملف مستهلك (سطر استيراد واحد لكل ملف)
  - `D`  `features/manager-properties/components/properties-segmented-tabs.tsx`
  - `D`  `features/manager-properties/components/properties-segmented-tabs.module.css`
  - `D`  `features/manager-properties/components/properties-tabs.tsx`
  - `M`  `features/manager-properties/components/properties.module.css` (حذف 30 سطرًا)
- **غير متعقّب (untracked) — ملفات M7 الجديدة (4):**
  - `apps/frontend/components/ui/properties-segmented-tabs.tsx`
  - `apps/frontend/components/ui/properties-segmented-tabs.module.css`
  - `apps/frontend/components/ui/properties-tabs.tsx`
  - `apps/frontend/components/ui/properties-tabs.module.css`

**لم يُنفَّذ:** commit / push / reset / clean / stash.

---

## 8. تأكيد الحفاظ على تصميم Astra والوظائف الحيّة

- **تصميم Astra:** لم يتغيّر — نفس الأصناف ونفس قواعد CSS (منقولة حرفيًا) ونفس النوعية وترتيب التحميل، ولا تغيير في الألوان أو الأبعاد أو المسافات أو RTL أو الحركات.
- **الوظائف:** نفس المكوّن المشترك يستخدمه الآن كلٌّ من صفحات المدير والموظف (13 مستهلكًا) عبر المسار المشترك الجديد؛ لا تغيير في منطق التصفية أو اختيار التبويب أو العدّادات أو التنقّل بلوحة المفاتيح.
- **لا تكرار ولا كسر:** الملفات الأصلية أُزيلت، والاستيرادات كلها تُحلّ من الموقع الجديد، وbuild الإنتاج نجح (exit 0).
