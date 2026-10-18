# تقارير التطوير — Arkan CRM

هذا المجلد هو الموقع الدائم لتوثيق مهام التطوير في مشروع **Arkan CRM** (أركان الخليج العقارية).

## الغرض

- توثيق كل مهمة تطوير في تقرير مستقل بدل الاعتماد على ملخصات المحادثات.
- حفظ سجل تاريخي يمكن الرجوع إليه لمعرفة ما نُفّذ فعليًا وما تبقّى.
- الفصل بين ما تم التحقق منه عمليًا وما لم يُختبَر بعد.

## قواعد الاستخدام

1. لكل مهمة تطوير جديدة يُضاف ملف Markdown جديد داخل `docs/reports/`.
2. **لا يُستبدل أو يُحذف أي تقرير سابق** — التقارير سجل تراكمي.
3. اسم الملف يتبع النمط: `YYYY-MM-DD-وصف-مختصر.md` (مثال: `2026-10-14-property-form-redesign.md`).
4. يُحدَّث هذا الفهرس (README) عند إضافة تقرير جديد.
5. يعتمد التقرير على **الكود المصدري الفعلي** وحالة Git ونتائج أوامر التحقق، لا على الافتراضات.
6. تُستخدم قيم الحالة التالية بوضوح: `Completed` / `Partial` / `Not Implemented` / `Not Tested`.
7. لا تُدرج أسرار أو كلمات مرور أو رموز وصول أو قيم بيئة خاصة في التقارير.

## فهرس التقارير (زمنيًا)

| التاريخ | التقرير | الموضوع | الحالة العامة |
| --- | --- | --- | --- |
| 2026-10-14 | [property-form-redesign](./2026-10-14-property-form-redesign.md) | إعادة تصميم نموذج إضافة العقار (معالج من ست خطوات) | الواجهة الأمامية `Completed` — التكامل الخلفي `Not Implemented` |
| 2026-10-14 | [owner-broker-form](./2026-10-14-owner-broker-form.md) | تحسين الخطوة الخامسة: اختيار المالك أو الوسيط في نموذج إضافة العقار | الواجهة الأمامية `Completed` — سجل الوكلاء والاستمرارية `Not Implemented` |
| 2026-10-14 | [brokers-privacy-property-image](./2026-10-14-brokers-privacy-property-image.md) | إضافة الوسطاء إلى العملاء والمتابعات، خصوصية بيانات المالك/الوسيط، وإصلاح صورة العقار على الكروت | الواجهة الأمامية `Partial` — الخصوصية تفويض خلفي `Not Implemented` (BLOCKER) والاستمرارية `Not Implemented` |
| 2026-10-14 | [contact-privacy-manager-image](./2026-10-14-contact-privacy-manager-image.md) | تصحيح خصوصية جهات التواصل (منع افتراضي) والتحقق من صورة عقار المدير | الواجهة الأمامية `Completed` — التفويض الخلفي `Not Implemented` (BLOCKER) والاستمرارية/رفع الصور `Not Implemented` |
| 2026-10-15 | [three-step-property-wizard](./2026-10-15-three-step-property-wizard.md) | استبدال معالج إضافة العقار بست خطوات بواجهة ثلاثية الخطوات موحدة للمدير والموظف | الواجهة الأمامية `Completed` — التفويض الخلفي/الاستمرارية/رفع الصور `Not Implemented` (BLOCKER) |
| 2026-10-15 | [three-step-wizard-corrections](./2026-10-15-three-step-wizard-corrections.md) | إصلاحات المعالج ثلاثي الخطوات: سعر/مساحة اختياريان، خصوصية الوصف، إزالة حقل مصدر | الواجهة الأمامية `Completed` — التفويض الخلفي/الاستمرارية/رفع الصور `Not Implemented` (BLOCKER) |
| 2026-10-15 | [backend-architecture-audit](./2026-10-15-backend-architecture-audit.md) | تدقيق معمارية الخلفية وتخطيط تنفيذ العقارات/الموافقات/الإصدارات/الصور/الخصوصية | تدقيق وفحص فقط `Completed` — أي تنفيذ خلفي `Not Implemented` (بانتظار موافقة المعمارية) |
| 2026-10-15 | [property-schema-migration-preparation](./2026-10-15-property-schema-migration-preparation.md) | توسيع مخطط Prisma للعقار (بدل/جهات تواصل/أدوار/عقار مطلوب/إصدارات/صورة رئيسية) وإنشاء ترحيل إضافي آمن بدون تطبيقه | مخطط + ملف ترحيل `Completed` — **تطبيق الترحيل `Not Tested` (لم يُطبَّق)** — أي API/واجهة `Not Implemented` |
| 2026-10-15 | [optional-legacy-owner-schema-fix](./2026-10-15-optional-legacy-owner-schema-fix.md) | تصحيح توافق: جعل `Property.ownerId` القديم اختياريًا لعقارات الوسيط، وتحديث الترحيل غير المُطبَّق | مخطط + ملف ترحيل `Completed` — **تطبيق الترحيل `Not Tested` (لم يُطبَّق)** |
| 2026-10-15 | [development-database-migration](./2026-10-15-development-database-migration.md) | نسخ احتياطي + استعادة معزولة + اختبار + تطبيق ترحيل توسيع مخطط العقار على قاعدة التطوير المحلية | النسخ/الاستعادة/الاختبار/التطبيق/التحقّق `Completed` — **توليد Prisma Client `Blocked` (EPERM)** — أي API/واجهة `Not Implemented` |
| 2026-10-15 | [prisma-client-db-connectivity-recovery](./2026-10-15-prisma-client-db-connectivity-recovery.md) | استعادة توليد Prisma Client (حل EPERM) وإعادة تشغيل خادم الخلفية والتحقق القطعي من هوية قاعدة التطوير | استعادة العميل + إعادة تشغيل الخلفية + تأكيد الاتصال `Completed` — **تنفيذ Properties/Contacts APIs `Not Implemented` (بانتظار موافقة)** |
| 2026-10-15 | [contacts-properties-backend-apis](./2026-10-15-contacts-properties-backend-apis.md) | تنفيذ واجهات الخلفية للعقارات وجهات التواصل (إنشاء/قراءة/موافقة/رفض/تصحيح/إعادة إرسال) مع صورة واحدة إلزامية وتفويض وخصوصية على الخادم | الخلفية `Completed` (اختبارات تكامل على قاعدة معزولة `54 passed`) — **إزالة EXIF/التخزين الإنتاجي/تكامل الواجهة الأمامية `Not Implemented`** |
| 2026-10-15 | [property-image-privacy-hardening](./2026-10-15-property-image-privacy-hardening.md) | تحصين خصوصية صور العقارات: فك ترميز آمن وإعادة ترميز وإزالة EXIF/GPS/XMP/IPTC للرفعات الجديدة، مع حدود بكسل/حجم وحماية من قنابل الضغط | الخلفية `Completed` (اختبارات أمنية جديدة + `68 passed`) — **إزالة المعلومات المرئية داخل البكسل/التخزين السحابي الإنتاجي/جامع الملفات اليتيمة `Not Implemented`** |
| 2026-10-15 | [frontend-properties-contacts-integration](./2026-10-15-frontend-properties-contacts-integration.md) | تكامل الواجهة الأمامية مع `/contacts` و`/properties`: طبقة API مؤمَّنة، محوّل المعالج ثلاثي الخطوات، القوائم والصور المؤمَّنة، سير عمل المدير/الموظف | الواجهة الأمامية `Partial` — تحقق بنائي + تكامل API `Completed` (`typecheck`/`lint`/`build` + `106 passed` منها `38` جديدًا) — **سلوكيات React `Not Tested`** — `PropertyRevision`/استبدال الصورة/`CHANGES_REQUESTED` `Not Implemented` |
| 2026-10-15 | [request-changes-my-properties-fix](./2026-10-15-request-changes-my-properties-fix.md) | فصل «طلب تعديل» عن «الرفض»: نقطة نهاية مستقلة للمدير تُبقي العقار `PENDING` وتحوّل المراجعة إلى `CHANGES_REQUESTED`، ضبط الاعتماد/الرفض، توسيع إعادة الإرسال مع حفظ السجل، و`isMine` لإصلاح تبويب «عقاراتي» | الخلفية/API `Completed` (`126 passed` / `11 suites`) — `typecheck`/`lint`/`build`/`prisma validate`/`migrate status` ناجحة — **سلوكيات React التفاعلية `Not Tested`** — **لا ترحيل جديد، لا اعتمادية جديدة** |
| 2026-10-16 | [employee-property-tab-filtering](./2026-10-16-employee-property-tab-filtering.md) | تصحيح فلاتر تبويبات عقارات الموظف: «كل العقارات» و«عقاراتي» = `AVAILABLE` (و`isMine`) فقط، «تحت المراجعة» = المعلّق الخاص غير المطلوب تعديله، «مطلوب تعديل» = طلب التعديل + المرفوض، مع توحيد قواعد العدّادات وتفادي الإجماليات الناقصة | الواجهة الأمامية `Completed` (منطق الفلترة + 8 اختبارات وحدة؛ `134 passed` / `12 suites`) — `typecheck`/`lint`/`build`/`git diff --check` ناجحة — **سلوك المتصفح `Not Tested`** — **تغييرات فرونت-إند فقط، لا ترحيل، لا اعتمادية جديدة** |

| 2026-10-16 | [full-image-property-card-fix](./2026-10-16-full-image-property-card-fix.md) | تصحيح كروت عقارات الموظف: صورة كاملة، المنطقة والسعر فقط، وفتح درج التفاصيل الحالي | `Completed` — تحقق متصفح سطح مكتب/عرض هاتف + `7` حالات مركزة؛ typecheck/lint/build/diff-check ناجحة |

| 2026-10-16 | [organized-property-details-drawer](./2026-10-16-organized-property-details-drawer.md) | تنظيم تفاصيل الموظف والمدير من DTO: صورة وموقع وسعر وأدوار مستقلة وبدل وتواصل مصرح ومراجعة | التنفيذ والفحوصات `Completed` — المراجعة البصرية اليدوية `Not Tested`؛ فجوات الإرسال موثقة |

| 2026-10-18 | [codebase-health-audit](./2026-10-18-codebase-health-audit.md) | تدقيق شامل للقراءة فقط: المعمارية، السلامة الوظيفية، الأمان وقاعدة البيانات، mock مقابل بيانات حقيقية — مع أولويات إصلاح وخطة تنظيف مرحليات | التدقيق `Completed` (‏typecheck/lint/build ناجحة + `169 passed`) — `format:check` يفشل (‏305 ملفًا، سابق) — **تنفيذ أي إصلاح `Not Implemented` (بانتظار الموافقة)** — تحقق متصفح `Not Tested` |

> ملاحظة: التقارير تلتزم بقواعد المشروع الموثّقة في `AGENTS.md` و`PROJECT_CONTEXT.md` و`TODO.md`، ولا تُصرّح بأي جاهزية إنتاجية.
