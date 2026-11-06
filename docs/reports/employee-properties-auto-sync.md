# تقرير: مزامنة تلقائية لعقارات الموظف بعد إجراءات المدير

**التاريخ:** 2026-11-05  
**المشروع:** D:\Projects\arkan-crm  
**الحالة:** مكتمل — بانتظار المراجعة اليدوية  

---

## 1. السبب الجذري

كانت قناة التحديث الموجودة (`notifyPropertyDataChanged`) تُنشر من جرس الإشعارات فقط عند وصول إشعار **ليس** من نوع `SYSTEM`:

```ts
// قبل الإصلاح
if (fresh.some((item) => item.type !== 'SYSTEM')) {
  notifyPropertyDataChanged();
}
```

لكن إشعار «تم حذف العقار بقرار المدير» الذي يصل للموظف نوعه `SYSTEM` (مع `propertyId`)، لذلك:
- لم يُنشر إشارة تحديث قائمة العقارات،
- بقيت البطاقة والعدّادات كما هي حتى تحديث المتصفح يدوياً.

بالإضافة إلى أن **الاستعادة** لا تُنشئ إشعاراً أصلاً، فحتى إصلاح شرط `SYSTEM` وحده لا يكفي. كما أن الاعتماد على إبطال الاستعلام محلياً لا يعمل بين متصفحين/جهازين مختلفين.

---

## 2. طريقة المزامنة المنفَّذة

### 2.1 إصلاح إشارة الإشعارات
أُضيفت دالة نقية في `features/notifications/view.ts`:

```ts
export function notificationAffectsPropertyLists(item: {
  propertyId: string | null;
  type: string;
}): boolean {
  return item.propertyId !== null || item.type.startsWith('PROPERTY_');
}
```

- أي إشعار مرتبط بعقار (بما فيه `SYSTEM` الخاص بالحذف) يُفعّل `notifyPropertyDataChanged()`.
- إشعارات غير مرتبطة بعقار لا تُحرّك القائمة.

### 2.2.polling خفيف + visibility/focus
أُضيف خيار `autoSyncMs` إلى `usePropertyList`، وتستخدمه صفحة عقارات الموظف بقيمة **20,000ms**:

- إعادة قراءة **صامتة** (`silentRef`) عبر `refetch` الموجود: لا `loading` كامل، ولا flicker، والصفوف القديمة تبقى حتى تصل الجديدة.
- تعمل فقط عندما تكون الصفحة **مرئية** (`document.visibilityState === 'visible'`).
- عند `focus` أو `visibilitychange` → إعادة قراءة فورية.
- `clearInterval` وإزالة المستمعين عند إلغاء التركيب (`unmount`) — لا polling بعد مغادرة الصفحة.
- تستخدم نفس حارس الطلبات (`requestId`) ونفس `GET /properties`، فلا تغيير في البحث/الفلاتر/الصلاحيات.
- العدّادات تُحسب من `items`، لذا تتحدث تلقائياً مع إعادة القراءة.

### 2.3 التغطية
| إجراء المدير | آلية التحديث |
|---|---|
| حذف مؤقت | إشعار `SYSTEM` مرتبط بالعقار → إشارة فورية + polling 20s |
| اعتماد | إشعار `PROPERTY_APPROVED` → إشارة فورية + polling |
| رفض | إشعار `PROPERTY_REJECTED` → إشارة فورية + polling |
| استعادة | لا إشعار → polling 20s + focus/visibility |
| تعديلات أخرى | إشارات العقارات الحالية + polling |

### 2.4 طلب الشبكة
- طلب قائمة واحد كل 20 ثانية أثناء ظهور الصفحة فقط.
- لا طلبات إضافية عند إخفاء التبويب.
- إشعارات التطبيق تستمر في دورة 15 ثانية المنفصلة الموجودة مسبقاً (لم تتغير).

---

## 3. الملفات المعدّلة

- `apps/frontend/lib/use-property-list.ts`
  - خيار `autoSyncMs`.
  - تأثير polling + visibility/focus مع cleanup.
- `apps/frontend/features/employee-properties/components/employee-properties-page.tsx`
  - `autoSyncMs: 20_000`.
- `apps/frontend/features/notifications/view.ts`
  - `notificationAffectsPropertyLists`.
- `apps/frontend/features/notifications/components/notification-bell.tsx`
  - استخدام الدالة الجديدة بدل استبعاد `SYSTEM`.
- `apps/backend/test/manager-notification-display.spec.ts`
  - 3 اختبارات لمنطق تفعيل التحديث.

لا تغيير على التصميم الزجاجي أو البطاقات أو البحث أو الصلاحيات.

---

## 4. الاختبارات والتحقق

### اختبارات آلية
```
manager-notification-display.spec.ts + notifications.spec.ts + employee-decision-notifications.spec.ts
→ 3 suites, 30 tests passed
```
اختبارات منطق التحديث:
1. إشعار `SYSTEM` مرتبط بعقار (الحذف) → **true**.
2. إشعار `PROPERTY_*` → **true**.
3. إشعار `SYSTEM` بلا عقار أو `CLIENT_CREATED` → **false**.

### TypeScript / ESLint / Build
| الفحص | النتيجة |
|---|---|
| Frontend `tsc --noEmit` | ✅ |
| Backend `tsc --noEmit` | ✅ |
| ESLint (الملفات المعدلة) | ✅ |
| `next build` | ✅ |

### التحقق في المتصفح
- صفحة عقارات الموظف تُحمَّل الحالة الفارغة بلا أخطاء console.
- بمراقبة `fetch` داخل الصفحة: **حدثت إعادة قراءة دورية** خلال ~22 ثانية (عدّاد الطلبات ارتفع)، ولم تُحدث أي صفحة كاملة.
- إطلاق حدث `focus` أدى إلى إعادة قراءة فورية (العدّاد 3 → 4).
- لا أخطاء console، والحالة الفارغة بقيت صحيحة.

**قيود:** قاعدة التطوير فارغة حالياً (بعد التنظيف المصرح به)، ولم يُنشأ عقار تجريبي فيها لاختبار حذف حقيقي عبر جلستي مدير/موظف. سلوك التحديث مغطى باختبارات المنطق + التحقق الفعلي من polling/focus؛ واختبارات الحذف/الاستعادة/الاعتماد موجودة في الخلفية ومجموعات الاختبار.

---

## 5. ملاحظات
- لم تُجرَ تغييرات على قاعدة البيانات أو migrations أو commits.
- التصميم، الفلاتر، البحث، الخصوصية، والوظائف الحالية كما هي.

**متوقف للمراجعة اليدوية.**
