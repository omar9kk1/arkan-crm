import {
  useDraftState,
  useDraftScope,
  useDraftFields,
} from '../../../lib/drafts/use-form-draft';
import { DraftTools } from '../../../lib/drafts/draft-tools';
import { useRef, useState } from 'react';
import { PropertyOverlay } from '../../manager-properties/components/property-overlay';
import { Card } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { GlassSelect } from '../../../components/ui/glass-select';
import { createEmployee } from '../../../lib/api/employees-api';
import type {
  CreateEmployeePayload,
  EmployeeRoleApi,
} from '../../../lib/api/employee-types';
import type { EmployeeRecord } from '../model';
import styles from './add-employee.module.css';
export function AddEmployeeModal({
  existing,
  defaultRole = 'EMPLOYEE',
  onClose,
  onCreated,
}: {
  existing: readonly EmployeeRecord[];
  /** OWNER can open the same form as a Manager-account creator. */
  defaultRole?: EmployeeRoleApi;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const isManagerForm = defaultRole === 'MANAGER';
  const formKey = isManagerForm ? 'add-manager' : 'add-employee';
  const defaultRoleLabel = isManagerForm ? 'مدير' : 'موظف مبيعات';
  const { clear: clearFormDraft } = useDraftScope(formKey);
  const draftField = useDraftFields(formKey);

  const [generate, setGenerate] = useDraftState(formKey + ':generate', true);
  const [result, setResult] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [message, setMessage] = useState('');
  const saved = useRef(false);
  return (
    <PropertyOverlay
      title={isManagerForm ? 'إضافة مدير' : 'إضافة موظف'}
      onClose={onClose}
      className={styles.modal}
    >
      {result ? (
        <Card className={styles.result}>
          <h3>
            {isManagerForm ? 'تم إنشاء حساب المدير' : 'تم إنشاء حساب الموظف'}
          </h3>
          <p>
            أُنشئ الحساب فعليًا في قاعدة البيانات. احتفظ بهذه البيانات وأرسلها
            للموظف.
          </p>
          <label>
            البريد الإلكتروني
            <input readOnly dir="ltr" value={result.email} />
          </label>
          <label>
            كلمة المرور المؤقتة
            <input readOnly dir="ltr" value={result.password} />
          </label>
          <div className={styles.actions}>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `البريد الإلكتروني: ${result.email}\nكلمة المرور المؤقتة: ${result.password}`,
                  );
                  setMessage('تم نسخ بيانات الدخول');
                } catch {
                  setMessage(
                    'تعذر النسخ التلقائي. يمكنك تحديد البيانات ونسخها يدويًا.',
                  );
                }
              }}
            >
              نسخ بيانات الدخول
            </Button>
            <Button onClick={onClose}>إغلاق</Button>
          </div>
          <p role="status">{message}</p>
        </Card>
      ) : (
        <>
          <p>أدخل بيانات الموظف وجهّز بيانات دخوله.</p>
          <div className={styles.layout}>
            <>
              <DraftTools formKey={formKey} />{' '}
              <form
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (saved.current) return;
                  const form = event.currentTarget;
                  const data = new FormData(form);
                  const text = (key: string) =>
                    String(data.get(key) || '').trim();
                  const email = text('email').toLowerCase();
                  if (
                    !text('name') ||
                    !text('phone') ||
                    existing.some(
                      (item) => item.email.toLowerCase() === email,
                    ) ||
                    !text('hiredAt')
                  ) {
                    setMessage('راجع الاسم والهاتف وتاريخ التعيين والبريد.');
                    return;
                  }
                  const salary = Number(text('salary'));
                  if (!Number.isFinite(salary) || salary < 0) {
                    setMessage('أدخل راتبًا صحيحًا.');
                    return;
                  }
                  const password = generate ? 'ChangeMe123!' : text('password');
                  if (password.length < 8) {
                    setMessage('كلمة المرور لا تقل عن 8 أحرف.');
                    return;
                  }
                  const role: EmployeeRoleApi =
                    text('jobRole') === 'مدير' ? 'MANAGER' : 'EMPLOYEE';
                  const payload: CreateEmployeePayload = {
                    name: text('name'),
                    email,
                    password,
                    role,
                    phone: text('phone'),
                    hiredAt: text('hiredAt'),
                    baseSalary: salary,
                    isActive: text('status') === 'active',
                  };
                  saved.current = true;
                  try {
                    const created = await createEmployee(payload);
                    clearFormDraft();
                    setMessage('');
                    setResult({ email, password });
                    onCreated(created.id);
                  } catch (cause) {
                    saved.current = false;
                    setMessage(
                      cause instanceof Error
                        ? cause.message
                        : 'تعذر إنشاء الحساب.',
                    );
                  }
                }}
              >
                <Card className={styles.fields}>
                  <label>
                    اسم الموظف
                    <input
                      {...draftField('name', '')}
                      name="name"
                      required
                      maxLength={100}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    رقم الهاتف
                    <input
                      {...draftField('phone', '')}
                      name="phone"
                      type="tel"
                      required
                      maxLength={30}
                      dir="ltr"
                    />
                  </label>
                  <label>
                    البريد الإلكتروني
                    <input
                      {...draftField('email', '')}
                      name="email"
                      type="email"
                      required
                      maxLength={254}
                      dir="ltr"
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    الدور الوظيفي
                    <GlassSelect
                      {...draftField('jobRole', defaultRoleLabel)}
                      name="jobRole"
                    >
                      <option>موظف مبيعات</option>
                      <option>مدير</option>
                    </GlassSelect>
                  </label>
                  <label>
                    الراتب الأساسي (د.ك)
                    <input
                      {...draftField('salary', '')}
                      name="salary"
                      type="number"
                      min="0"
                      step="0.001"
                      required
                    />
                  </label>
                  <label>
                    تاريخ التعيين
                    <input
                      {...draftField('hiredAt', '')}
                      name="hiredAt"
                      type="date"
                      required
                    />
                  </label>
                  <label>
                    الحالة
                    <GlassSelect
                      {...draftField('status', 'active')}
                      name="status"
                    >
                      <option value="active">نشط</option>
                      <option value="inactive">غير نشط</option>
                    </GlassSelect>
                  </label>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={generate}
                      onChange={(event) => setGenerate(event.target.checked)}
                    />
                    توليد كلمة مرور مؤقتة
                  </label>
                  {!generate && (
                    <label>
                      كلمة المرور المؤقتة
                      <input
                        name="password"
                        type="text"
                        minLength={8}
                        maxLength={128}
                        required
                        autoComplete="off"
                        dir="ltr"
                      />
                    </label>
                  )}
                  <label className={styles.full}>
                    ملاحظات
                    <textarea
                      {...draftField('notes', '')}
                      name="notes"
                      maxLength={1000}
                    />
                  </label>
                </Card>
                {message && <p role="alert">{message}</p>}
                <div className={styles.actions}>
                  <Button type="button" onClick={onClose}>
                    إلغاء
                  </Button>
                  <Button type="submit">حفظ الموظف</Button>
                </div>
              </form>{' '}
            </>
            <Card>
              <h3>بيانات الدخول</h3>
              <p>بعد الحفظ يظهر البريد وكلمة المرور لتتمكن من نسخهما.</p>
              <p>
                يُنشأ الحساب فعليًا في قاعدة البيانات بكلمة مرور مُشفّرة؛ ولا
                تُرسل رسالة للموظف.
              </p>
              <p>اختيار «مدير» يُنشئ حساب مدير فعلي ولا يظهر في قائمة الموظفين.</p>
              <p>
                الملاحظات لا تُحفظ: لا يوجد حقل لها في قاعدة البيانات بعد.
              </p>
            </Card>
          </div>
        </>
      )}
    </PropertyOverlay>
  );
}
