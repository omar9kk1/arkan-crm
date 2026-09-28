'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { rememberAttendanceIdentity } from '../../employee-attendance/mock-identity';
import { nfcReturn } from '../../employee-attendance/nfc-return';
import { Brand } from '../../../components/layout/brand';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { roleHome } from '../api/auth-api';
import { useAuth } from './auth-provider';
import styles from './login-form.module.css';

export function LoginForm() {
  const { user, checking, error: sessionError, login, retry } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (!checking && user)
      router.replace(
        nfcReturn(user.role, window.location.search) || roleHome(user.role),
      );
  }, [checking, user, router]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const data = new FormData(event.currentTarget);
    setError(null);
    setSubmitting(true);
    try {
      const identity = await login({
        email: String(data.get('email')).trim().toLowerCase(),
        password: String(data.get('password')),
      });
      rememberAttendanceIdentity(identity, String(data.get('email')));
      router.replace(
        nfcReturn(identity.role, window.location.search) ||
          roleHome(identity.role),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تسجيل الدخول.');
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <main className={styles.page}>
      <div className={styles.layout}>
        <aside className={styles.welcome} aria-label="أركان الخليج العقارية">
          <Brand />
          <div>
            <span className={styles.eyebrow}>مساحة عملك العقارية</span>
            <h2>
              كل تفاصيل عملك،
              <br />
              في مكان واحد.
            </h2>
            <p>عملاؤك، عقاراتك، ومتابعاتك اليومية في مساحة منظمة وواضحة.</p>
          </div>
          <span className={styles.caption}>أركان الخليج العقارية</span>
        </aside>
        <Card className={styles.card} aria-labelledby="login-title">
          <div className={styles.mobileBrand}>
            <Brand />
          </div>
          <div className={styles.heading}>
            <span className={styles.eyebrow}>مرحبًا بعودتك</span>
            <h1 id="login-title">تسجيل الدخول</h1>
            <p>أدخل بيانات حسابك للوصول إلى مساحة العمل.</p>
          </div>
          <form
            onSubmit={submit}
            className={styles.form}
            aria-busy={submitting}
          >
            <label className={styles.field} htmlFor="email">
              البريد الإلكتروني
              <input
                id="email"
                name="email"
                type="email"
                dir="ltr"
                autoComplete="username"
                required
                maxLength={254}
                placeholder="name@example.com"
                disabled={submitting}
              />
            </label>
            <label className={styles.field} htmlFor="password">
              كلمة المرور
              <input
                id="password"
                name="password"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                required
                minLength={8}
                maxLength={128}
                disabled={submitting}
              />
            </label>
            {(error || sessionError) && (
              <p className={styles.error} role="alert">
                {error || sessionError}
              </p>
            )}
            <Button type="submit" disabled={submitting || checking || !!user}>
              {submitting
                ? 'جارٍ تسجيل الدخول…'
                : checking
                  ? 'جارٍ التحقق…'
                  : 'تسجيل الدخول'}
            </Button>
            {sessionError && (
              <Button type="button" onClick={retry}>
                إعادة التحقق من الجلسة
              </Button>
            )}
          </form>
        </Card>
      </div>
    </main>
  );
}
