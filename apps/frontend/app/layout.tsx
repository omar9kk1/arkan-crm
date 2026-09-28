import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../styles/globals.css';
import { AuthProvider } from '../features/auth/components/auth-provider';
export const metadata: Metadata = {
  title: 'أركان الخليج العقارية | إدارة العقارات',
  description: 'نظام أركان الخليج العقارية لإدارة العلاقات العقارية',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Some browser tools inject root attributes before React hydrates.
    // Keep suppression shallow: mismatches inside the login form stay visible.
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
