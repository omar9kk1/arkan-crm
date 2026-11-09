# إنهاء واجهة المالك / المدير

**التاريخ:** 2026-11-08  
**النطاق:** واجهة فقط — بدون تغيير قاعدة البيانات أو الصلاحيات الخلفية أو سلوك الأعمال.  
**الحالة:** مكتمل — اجتاز typecheck/lint والبناء، وتم التحقق من واجهة المالك في المتصفح.

> لم تُعدّل قاعدة البيانات أو migrations أو `.env` أو المصادقة أو CSP أو Rate Limiting.  
> لا commits أو pushes.

---

## 1. ما تم إنجازه

### تسميات الأدوار
- `OWNER` في الشريط العلوي: **«مالك النظام»**.
- `MANAGER`: يبقى **«مدير النظام»**.
- لم تتغيّر أسماء الأدوار في قاعدة البيانات أو الـAPI.

### شريط OWNER الجانبي
- عنصر «الموظفون» أصبح **«المديرين»** للمالك فقط.
- نفس المسار `/manager/employees` — لم تُنشأ صفحة جديدة.
- نسخة الجوال السفلية تستخدم نفس التسمية.

### صفحة إدارة OWNER
أُضيف تبويبان داخل الصفحة الحالية:

**تبويب «المديرين»**
- بطاقات قابلة للفتح لكل مدير.
- تعرض: الاسم، الحالة (نشط/غير نشط)، عدد الموظفين.
- عند الفتح: أسماء الموظفين المعيّنين وحالتهم، وخيارات:
  - اعتماد العقارات.
  - رفض العقارات.
  - تفعيل/تعطيل حساب المدير.
- زر «إضافة مدير» (يفتح نموذج الحساب بدور مدير افتراضيًا).
- حالة فراغ واضحة: «لا يوجد مديرون بعد».

**تبويب «الموظفين»**
- قائمة مسطحة للموظفين (البطاقات الحالية) مع عرض المدير أو **«غير معيّن»**.
- إبقاء كل الوظائف الحالية:
  - إضافة موظف.
  - إعادة التسمية.
  - تفعيل/تعطيل.
  - تعيين/نقل الموظف إلى مدير (قسم «تعيين الموظفين»).
  - فتح التفاصيل وتخصيص العقار.
- الإحصائيات والفلاتر والبحث كما هي.

### تجربة MANAGER
- لا تبويبات إدارية، لا إنشاء حسابات، لا تعيين/نقل، لا تعديل صلاحيات، لا تفعيل/تعطيل.
- قائمة موظفيه فقط من الخادم، مع تفاصيل للقراءة فقط.
- إخفاء زر «تخصيص عقار» في عرض المدير.
- إبقاء تخطيط الموظفين الحالي دون تغيير.

### التصميم
- استخدام مكوّن `PropertiesSegmentedTabs` الموجود للتبويبات.
- استخدام `Card` و`Button` و`GlassSelect` والـtokens الحالية.
- إضافة أنماط بطاقات المدير فقط داخل `employees.module.css`.
- متجاوب: عمود واحد لبطاقة المدير على الجوال.

---

## 2. الملفات المعدلة

- `apps/frontend/components/layout/manager/manager-topbar.tsx`
- `apps/frontend/components/layout/manager/navigation.ts`
- `apps/frontend/components/layout/manager/manager-sidebar.tsx`
- `apps/frontend/components/layout/manager/manager-mobile-bottom-nav.tsx`
- `apps/frontend/features/manager-employees/components/employees-page.tsx`
- `apps/frontend/features/manager-employees/components/employee-card.tsx`
- `apps/frontend/features/manager-employees/components/add-employee-modal.tsx`
- `apps/frontend/features/manager-employees/components/employees.module.css`
- **جديد:** `apps/frontend/features/manager-employees/components/owner-managers-tab.tsx`
- **جديد:** `apps/frontend/features/manager-employees/components/owner-employee-assignments.tsx`
- **حُذف غير المستخدم:** `apps/frontend/features/manager-employees/components/owner-team-controls.tsx`

---

## 3. الاختبارات

| الفحص | النتيجة |
|---|---|
| `npm run typecheck -w @arkan/frontend` | ناجح |
| `eslint` على ملفات الإدارة | ناجح |
| `employees.spec.ts` (9 اختبارات) | **9/9 ناجحة** |
| `npm run build -w @arkan/frontend` | ناجح |
| `npm run csp:verify -w @arkan/frontend` | ناجح — 27 route / 29 hash / 2055B |

**Browser smoke (OWNER، قاعدة `arkan_crm`):**
- الشريط العلوي: **مالك النظام**.
- الشريط الجانبي: **المديرين**.
- صفحة `/manager/employees`:
  - تبويب «المديرين» ظاهر افتراضيًا، وحالة «لا يوجد مديرون بعد» و«إضافة مدير».
  - تبويب «الموظفين» يعمل، ويعرض الموظفين مع «المدير: غير معيّن»، وقسم التعيين، و«إضافة موظف».
  - فتح «إضافة مدير» يفتح النموذج بدور «مدير» افتراضيًا.
- لا أخطاء console/runtime.
- لم يُنشأ أو يُحذف أي سجل حقيقي أثناء الفحص.

---

## 4. ملاحظات / حدود

1. **لا يوجد حساب MANAGER حاليًا** في قاعدة `arkan_crm` (فقط OWNER + موظفان)؛ لذلك لم تُختبر بطاقة مدير حية في المتصفح. تم التحقق من مسار المدير عبر:
   - شروط الواجهة (`isOwner` فقط يظهر التبويبات/الإجراءات)،
   - واختبارات الخادم القائمة التي تثبت أن `/employees` يعيد موظفي الفريق فقط.
2. بطاقات المديرين جاهزة لتعرض الفريق والصلاحيات عند إنشاء أول مدير؛ الافتراضي يبقى بلا اعتماد/رفض.
3. لم تُجرَ أي تغييرات على قاعدة البيانات أو سلوك الأعمال أو الأمان.
4. الخدمات تعمل: backend 4001 healthy، frontend 3001 ready.

---

## 5. الحالة النهائية

- واجهة OWNER/Manager مكتملة حسب المطلوب.
- لا تغييرات على DB / `.env` / Git history.
- **التوقف هنا.**
