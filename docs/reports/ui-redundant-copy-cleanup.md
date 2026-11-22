# تنظيف النصوص الوصفية الزائدة من واجهة الأدوار الثلاثة

**التاريخ:** 2026-11-13
**النطاق:** Frontend فقط — نصوص الواجهة، دون تغيير التصميم أو الوظائف أو البيانات.
**الحالة:** مكتمل، بدون commit/push.

---

## 1. الصفحات والمكونات التي تمت مراجعتها

تمت مراجعة **26 مساراً** في `apps/frontend/app` (كل مسارات OWNER/MANAGER/EMPLOYEE)، إضافة إلى المكونات المشتركة والدرجات والبطاقات:

- **Manager/Owner:** الرئيسية، الصفقات، العقارات، العملاء، الموظفون، المالية، المتابعات، الإشعارات، سجل النظام، التقارير، التسويق، الإعدادات، الحضور، المحذوفات.
- **Employee:** الرئيسية، العملاء، العقارات، المتابعات، الإشعارات، الحضور، التسويق، الإعدادات، صفحة NFC.
- **مشتركة:** `ManagerPageShell`, `EmployeePageShell`, `StatCard`, `DashboardPanel`, `DashboardFeed`, `ComingSoon`, وبطاقات الإحصاءات/الأقسام.

---

## 2. الملفات المعدلة (30 ملفاً في هذه المهمة)

### المكونات المشتركة

- `apps/frontend/components/ui/stat-card.tsx` — `hint` أصبح اختيارياً ولا يُصدر فقرة فارغة.
- `apps/frontend/features/manager-dashboard/components/dashboard-panel.tsx` — الوصف اختياري.
- `apps/frontend/features/manager-dashboard/components/dashboard-feed.tsx` — الوصف اختياري.

### لوحة المدير والأقسام

- `apps/frontend/features/manager-dashboard/components/manager-dashboard.tsx`
- `apps/frontend/features/manager-dashboard/components/deals-chart-placeholder.tsx`
- `apps/frontend/features/manager-dashboard/components/top-employees-placeholder.tsx`
- `apps/frontend/features/manager-dashboard/components/people-summary.tsx`
- `apps/frontend/features/manager-dashboard/components/properties-summary.tsx`

### صفحات المدير/المالك

- `apps/frontend/features/manager-deals/components/deals-page.tsx`
- `apps/frontend/features/manager-finance/components/finance-page.tsx`
- `apps/frontend/features/manager-finance/components/finance-summary-cards.tsx`
- `apps/frontend/features/manager-followups/components/manager-followups-page.tsx`
- `apps/frontend/features/manager-followups/components/supervision-section.tsx`
- `apps/frontend/features/manager-notifications/components/notifications-page.tsx`
- `apps/frontend/features/manager-employees/components/employees-page.tsx`
- `apps/frontend/features/manager-attendance/components/attendance-page.tsx`
- `apps/frontend/features/manager-attendance/components/attendance-summary-cards.tsx`
- `apps/frontend/features/manager-marketing/components/marketing-page.tsx`
- `apps/frontend/features/manager-reports/components/reports-page.tsx`
- `apps/frontend/features/manager-settings/components/settings-page.tsx`
- `apps/frontend/features/manager-properties/components/manager-properties.tsx`
- `apps/frontend/features/manager-clients/components/clients-page.tsx`

### صفحات الموظف

- `apps/frontend/features/employee-dashboard/components/dashboard-cards.tsx`
- `apps/frontend/features/employee-dashboard/components/employee-achievements-today.tsx`
- `apps/frontend/features/employee-attendance/components/employee-attendance-page.tsx`
- `apps/frontend/features/employee-clients/components/employee-clients-page.tsx`
- `apps/frontend/features/employee-followups/components/employee-followups-page.tsx`
- `apps/frontend/features/employee-followups/components/followups-board.tsx`
- `apps/frontend/features/employee-notifications/components/employee-notifications-page.tsx`
- `apps/frontend/features/employee-properties/components/employee-properties-page.tsx`

> ملاحظة: توجد أيضاً 3 ملفات في شجرة العمل من مهمة «عدادات الموظفين» السابقة (`employee-stats.tsx`, `model.ts`, `employee-types.ts`) لم تُعدّل في هذه المهمة، وتم الحفاظ عليها كما هي.

---

## 3. أمثلة على النصوص المحذوفة

- وصف رئيسية المدير: «لوحة مؤشرات المدير: حجم النظام، أداء الموظفين، العقارات، العملاء، الملاك، الصفقات، والتنبيهات المهمة.»
- «بيانات مباشرة من قاعدة البيانات • الفترة المختارة» تحت رأس الرئيسية.
- وصف صفحة الصفقات: «المدير فقط يسجل الصفقة، والنظام يقترح موظف العقار وموظف العميل...»
- «الصفقات المسجلة ضمن نطاق صلاحياتك.»
- وصف صفحة المالية: «متابعة كل حركة مالية بالتفاصيل...»
- وصف المتابعات، الإشعارات، الموظفين، الإعدادات، الحضور، العقارات، العملاء في الرؤوس.
- أوصاف أقسام لوحة المدير: «أهم الأشياء التي تحتاج مراجعة المدير»، «أحدث حركة حصلت في النظام»، «حركة العملاء والملاك...»، «توزيع حالة العقارات...»، «أداء الصفقات خلال الفترة المختارة»، «التقييم مقسّم حسب نوع الأداء...».
- نصوص ثانوية في بطاقات الإحصاءات: «ضمن السجل»، «حسب الفلاتر الحالية»، «أرقام فعلية من قاعدة البيانات»، «من قاعدة البيانات مباشرة»، «ملخص اليوم الحالي لجميع الموظفين».
- سطر «حسب الفلاتر الحالية» تحت «ملخص الحركة» في المالية.
- عنوان فرعي «ملخص نشاطك المسجّل في النظام» في إنجازات الموظف.

---

## 4. النصوص المهمة التي تم الحفاظ عليها

- جميع عناوين الصفحات والأقسام وأسماء البطاقات والحقول والأرقام والعملات والتواريخ.
- أزرار الإجراءات والتأكيد والإلغاء ورسائل النجاح/الخطأ/التحقق.
- حالات التحميل والفراغ المفيدة مثل «لا توجد صفقات مسجلة بعد» و«لا توجد حركات تطابق الفلاتر».
- شرح دلالة العمولات المعلقة في المالية (لا تُحسب ضمن الخارج حتى تأكيد المالك).
- شرح حالة المراجعة وإعادة الإرسال في قسم «تحت المراجعة» للعقارات.
- «قراءة الإشعار لا تنفذ إجراءً على العقار» و«قراءة الإشعار لا تعني إنهاء المراجعة المطلوبة».
- تحذير الحضور «البيانات تجريبية؛ لا يوجد تصدير ملف أو ربط بالرواتب حاليًا» و«معاينة محلية».
- تنبيهات الإعدادات التجريبية وصلاحيات المالك، ووصف إشعارات المتابعة الوظيفي.
- وصف الميزات غير المفعّلة في صفحات «قريبًا» (التسويق/التقارير/الإعدادات) لأنه يوضح الحالة الفعلية.
- ملاحظة «ضمن العقارات المحمّلة» عند وجود صفحات إضافية، لأنها تمنع تفسيراً خاطئاً للأرقام.
- عناصر الوصول (aria-label/role/aria-live) لم تُحذف.

---

## 5. التحقق

| الفحص | النتيجة |
|---|---|
| `npm run typecheck -w @arkan/frontend` | 0 |
| ESLint على الملفات المعدلة | 0 |
| `npm run build -w @arkan/frontend` | نجح (Next build + CSP manifest) |

- لم تُجرَ أي تعديلات على Backend أو Prisma أو قاعدة البيانات أو `.env`.
- لا توجد اختبارات UI آلية للنصوص؛ التحقق البصري النهائي مطلوب.

### صفحات تحتاج مراجعة بصرية إضافية

- الرئيسية (المدير): كثافة الأقسام بعد إزالة أوصافها.
- الصفقات والمالية والموظفون: المسافات بعد إزالة الوصف/الـhints.
- الإشعارات وسجل النظام: التأكد من عدم وجود فراغ غير طبيعي تحت العنوان.
- صفحة الموظف الرئيسية/الحضور: تباعد البطاقات بعد إزالة العنوان الفرعي.
- صفحات «قريبًا»: التأكد من أن وصف الميزة المستقبلية ما زال واضحاً.

---

## 6. الخلاصة

تمت إزالة النصوص الوصفية الزائدة من OWNER/MANAGER/EMPLOYEE، مع الحفاظ على كل المعلومات التي تساعد المستخدم على فهم حالة أو اتخاذ قرار أو تجنب خطأ. التصميم الزجاجي وRTL والوظائف والبيانات لم تتغير.

**جاهز للمراجعة، بدون Commit أو Push.**
