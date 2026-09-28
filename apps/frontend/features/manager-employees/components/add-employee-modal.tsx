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
import type { EmployeeSample } from '../mock-data';
import styles from './add-employee.module.css';
export function AddEmployeeModal({
  existing,
  onClose,
  onSave,
}: {
  existing: readonly EmployeeSample[];
  onClose: () => void;
  onSave: (employee: EmployeeSample) => void;
}) {
  const formKey = 'add-employee';
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
      title="إضافة موظف"
      onClose={onClose}
      className={styles.modal}
    >
      {result ? (
        <Card className={styles.result}>
          <h3>تم إضافة الموظف مؤقتًا</h3>
          <p>
            احتفظ بهذه البيانات وأرسلها للموظف. سيتم ربط إنشاء الحساب الحقيقي في
            مرحلة الـ API.
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
          <p>أدخل بيانات الموظف وجهّز بيانات دخوله التجريبية.</p>
          <div className={styles.layout}>
            <>
              <DraftTools formKey={formKey} />{' '}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (saved.current) return;
                  const data = new FormData(event.currentTarget);
                  const text = (key: string) =>
                    String(data.get(key) || '').trim();
                  const email = text('email').toLowerCase();
                  if (
                    !text('name') ||
                    !text('phone') ||
                    existing.some((item) => item.email?.toLowerCase() === email)
                  ) {
                    setMessage('راجع الاسم والهاتف، وتأكد أن البريد غير مكرر.');
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
                  saved.current = true;
                  onSave({
                    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: text('name'),
                    phone: text('phone'),
                    email,
                    jobRole: text('jobRole') as 'موظف مبيعات' | 'مدير',
                    salary,
                    hiredAt: text('hiredAt'),
                    active: text('status') === 'active',
                    notes: text('notes'),
                    clientsCount: 0,
                    propertiesCount: 0,
                    dealsCount: 0,
                    commission: 0,
                    lateCount: 0,
                    clients: [],
                    enteredProperties: [],
                    deals: [],
                    followups: [],
                  });
                  clearFormDraft();
                  setMessage('');
                  setResult({ email, password });
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
                      {...draftField('jobRole', 'موظف مبيعات')}
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
                هذه معاينة فقط؛ لن يتم إنشاء حساب حقيقي أو إرسال رسالة للموظف.
              </p>
              <p>اختيار «مدير» هنا لا يمنح صلاحيات فعلية.</p>
            </Card>
          </div>
        </>
      )}
    </PropertyOverlay>
  );
}
