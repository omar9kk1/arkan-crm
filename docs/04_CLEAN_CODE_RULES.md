# 04 - Clean Code Rules

## General

- TypeScript strict mode.
- No `any` إلا عند الضرورة ومع تعليق.
- DTO validation في NestJS باستخدام class-validator/class-transformer.
- Prisma schema هو مصدر الحقيقة للعلاقات.
- كل API ترجع Response shape واضح.
- لا يتم خلط UI logic مع business logic.
- لا يتم خلط manager flows مع employee flows.
- لا يُكتب كود مؤقت يصعب استبداله؛ الأجزاء غير المنفذة تبقى واضحة دون سلوك إنتاج وهمي.
- تُشارك عقود API والـtypes/enums بين التطبيقين عبر packages/shared عند الحاجة، دون مشاركة Prisma Client أو منطق الخادم مع الواجهة.

## Extensibility Rules

- الهدف MVP سريع بأساس قابل للتعديل؛ تنفذ الحاجة الحالية بحدود واضحة دون بناء ميزات مستقبلية قبل طلبها.
- كل Domain مستقل في NestJS: users, employees, clients, owners, properties, deals, commissions, payroll, finance, attendance, followups, notifications, files, smart-paste.
- تواصل المجالات يكون عبر خدمات وعقود معلنة، دون الاعتماد على تفاصيل التنفيذ الداخلية لمجال آخر أو إنشاء اعتمادات دائرية.
- قواعد العمل تعيش في خدمات الخادم؛ Controllers تنسق HTTP فقط، وصفحات الواجهة تنسق العرض والتفاعل فقط.
- لكل مدخل API عقد DTO واضح وValidation؛ تغييرات العقود والمخطط تُراجع لتجنب كسر المستهلكين الحاليين.
- كل عملية مهمة تدعم AuditLog بهوية الفاعل والكيان والإجراء والتوقيت والتغييرات المناسبة، دون تسجيل كلمات المرور أو رموز الجلسات.
- عند تنفيذ عملية مالية أو تعديل مهم، تُحفظ تغييرات البيانات وسجل التدقيق ضمن معاملة واحدة عندما تكون في قاعدة البيانات نفسها.
- المالية تعتمد على FinanceMovement كنموذج موحد؛ إضافة مصدر جديد تتم عبر علاقة وعقد مصدر واضحين مع الحفاظ على sourceType/sourceId وإمكانية تتبع التفاصيل.
- منطق الصفقات والعمولات والمرتبات يكون في خدمات مخصصة، وقواعد الحساب القابلة للتغيير تكون إعدادات أو سياسات واضحة، دون نسب أو مبالغ hardcoded في Controllers أو UI.
- تُفصل الصلاحيات عن الصفحات وقواعد الحساب، وتُعزل التكاملات الخارجية خلف خدمات ذات عقود واضحة لتسهيل إضافة قنوات أو مزودين لاحقًا.
- كل Feature جديدة تُضاف كـModule في الخادم وRoute/feature في الواجهة؛ يحافظ التغيير على العقود القائمة وتُفحص السلوكيات المتأثرة.
- اتجاهات التوسع المستقبلية: التقارير، التسويق، تطبيق موبايل، صلاحيات أوسع، فروع متعددة، مصادر عملاء متعددة، تكامل واتساب، AI parsing أوسع، وتقارير مالية متقدمة.
- هذه اتجاهات تصميم وليست ميزات منفذة أو مطلوبة الآن؛ قد تحتاج لاحقًا إلى migrations وتوسيع العقود.

## Backend Rules

- Controllers مسؤولة عن HTTP فقط.
- Services مسؤولة عن business logic.
- Guards للصلاحيات.
- Interceptors/filters للأخطاء والـ response formatting.
- Audit log لأي عملية مهمة:
  - إنشاء صفقة.
  - تعديل عمولة.
  - دفع راتب.
  - اعتماد عقار.
  - تغيير حالة عقار.
  - حذف أو تعطيل بيانات.

## Frontend Rules

- RTL first.
- Responsive from the beginning.
- Bottom nav للـ mobile بحد أقصى 5 أزرار، والصفحات الإضافية داخل More.
- Search bar له مكان ثابت ومتسق في الصفحات التي تحتاج بحث.
- كل Modal/Drawer لازم يكون responsive.
- Components صغيرة وواضحة.
- المكونات المشتركة تشمل عند الحاجة: Button, Card, Modal, Drawer, Tabs, DataList, SearchBar, StatCard, BottomNav.
- الألوان والمسافات والـradius والـshadows تُعرّف مركزيًا كـdesign tokens/theme variables؛ لا تُكرر أنماطها داخل كل مكون.
- prototype HTML مرجع بصري قابل للتعديل فقط، ولا يستخدم ككود إنتاج.
- تفاصيل نهج التنسيق والاستجابة موجودة في [UI implementation notes](07_UI_IMPLEMENTATION_NOTES.md).

## Git / PR Rules

كل PR يكون صغير:
1. Initial structure.
2. Auth + roles.
3. Prisma schema.
4. Properties module.
5. Clients/Owners module.
6. Deals/Commissions module.
7. Payroll/Finance module.
8. Attendance module.
9. Notifications/jobs.
10. Frontend pages.
