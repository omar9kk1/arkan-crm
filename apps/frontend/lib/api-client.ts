import type { ApiResponse } from '@arkan/shared';

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(
      status === 401
        ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة، أو انتهت الجلسة.'
        : status === 403
          ? 'ليس لديك صلاحية الوصول.'
          : 'تعذر إتمام الطلب. حاول مرة أخرى.',
    );
  }
}
export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    accessToken?: string;
  } = {},
): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl)
    throw new Error('عنوان خدمة الدخول غير مضبوط. راجع إعدادات التشغيل.');
  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    response = await fetch(new URL(path, baseUrl), {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.accessToken
          ? { Authorization: `Bearer ${options.accessToken}` }
          : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new ApiError(response.status);
    return ((await response.json()) as ApiResponse<T>).data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new Error('تعذر الاتصال بالخادم. تأكد من الاتصال وحاول مرة أخرى.');
  } finally {
    clearTimeout(timeout);
  }
}
export const apiGet = <T>(path: string, accessToken?: string) =>
  apiRequest<T>(path, { accessToken });
