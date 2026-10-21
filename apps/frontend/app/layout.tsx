import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../styles/globals.css';
import { AuthProvider } from '../features/auth/components/auth-provider';
import { PushServiceWorkerRegistration } from '../features/notifications/push-service-worker-registration';
export const metadata: Metadata = {
  title: 'أركان الخليج العقارية | إدارة العقارات',
  description: 'نظام أركان الخليج العقارية لإدارة العلاقات العقارية',
  // The web manifest is required for Web Push on iOS/iPadOS (the app must be
  // installable to the home screen) and harmless everywhere else.
  manifest: '/manifest.json',
  icons: {
    icon: '/brand/arkan-gulf-logo.png',
    apple: '/brand/arkan-gulf-logo.png',
  },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Some browser tools inject root attributes before React hydrates.
    // Keep suppression shallow: mismatches inside the login form stay visible.
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>
        <AuthProvider>
          <PushServiceWorkerRegistration />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
