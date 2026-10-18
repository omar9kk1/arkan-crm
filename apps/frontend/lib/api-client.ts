import type { ApiResponse } from '@arkan/shared';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Envelope produced by the backend `ApiExceptionFilter`. */
interface ApiErrorEnvelope {
  error?: { statusCode?: number; message?: string | string[]; path?: string };
}

/**
 * Backend messages are English (class-validator / NestJS). Known messages are
 * translated so the Arabic UI never shows a raw server string for the flows the
 * user actually hits; anything unrecognised falls back to the raw text so the
 * caller still sees the real reason instead of a generic failure.
 */
function translateServerMessage(message: string): string | null {
  if (/appears to contain a private contact phone/i.test(message))
    return 'توجد بيانات اتصال خاصة (رقم هاتف) داخل نص العقار العام. أزل أرقام الهواتف قبل الحفظ.';
  if (/appears to contain a private contact email/i.test(message))
    return 'توجد بيانات اتصال خاصة (بريد إلكتروني) داخل نص العقار العام. أزل البريد الإلكتروني قبل الحفظ.';
  if (/budgetMin must not exceed budgetMax/i.test(message))
    return 'الحد الأدنى للاسترشاد بالميزانية لا يمكن أن يتجاوز الحد الأعلى.';
  if (/Provide exactly one of contactId or newContact/i.test(message))
    return 'اختر جهة اتصال مسجلة أو أنشئ جهة اتصال جديدة، وليس الاثنتين معًا.';
  if (/requestedProperty is only allowed for EXCHANGE listings/i.test(message))
    return 'بيانات العقار المطلوب بالبدل لا تُقبل إلا في عملية البدل.';
  if (/Exactly one image file is required/i.test(message))
    return 'يجب إرفاق صورة واحدة بالكامل (الحقل "image").';
  if (/exceeds the maximum allowed size of/i.test(message))
    return 'حجم الصورة يتجاوز الحد المسموح به (5 ميجابايت).';
  if (/Unsupported image content|does not match a supported format/i.test(message))
    return 'صيغة الصورة غير مدعومة. المسموح بها JPEG و PNG و WebP فقط.';
  if (/Animated or multipage/i.test(message))
    return 'الصور المتحركة أو متعددة الصفحات غير مقبولة.';
  if (/invalid dimensions/i.test(message))
    return 'أبعاد الصورة غير صالحة.';
  if (/exceeds the allowed (pixel|image) limit/i.test(message))
    return 'أبعاد الصورة تتجاوز الحد المسموح (20000 بكسل لكل ضلع).';
  if (/decoded size/i.test(message))
    return 'الصورة المشفرة داخل الملف أكبر من الحد المسموح (50 مليون بكسل).';
  if (/sanitized image exceeds/i.test(message))
    return 'الصورة بعد إزالة بياناتها الوصفية أصبحت أكبر من الحد المسموح (5 ميجابايت).';
  if (/metadata could not be removed/i.test(message))
    return 'تعذّرت إزالة البيانات الوصفية من الصورة، لذلك لم يُحفظ العقار.';
  if (/must be a non-negative decimal/i.test(message))
    return 'القيمة يجب أن تكون رقمًا غير سالب بكسر عشري من خانتين كحد أقصى.';
  if (/version must be/i.test(message))
    return 'إصدار السجل غير صالح.';
  return null;
}

function displayMessage(status: number, messages: string[]): string {
  if (status === 409)
    return 'تغيّر هذا العقار أو تمت مراجعته بالفعل. حدّث الصفحة لعرض أحدث حالته.';
  if (status === 413) {
    const translated = messages
      .map(translateServerMessage)
      .filter((value): value is string => Boolean(value));
    return translated[0] ?? 'حجم الصورة يتجاوز الحد المسموح به (5 ميجابايت).';
  }
  if (status === 401)
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة، أو انتهت الجلسة.';
  if (status === 403) return 'ليس لديك صلاحية الوصول.';
  if (status === 404) return 'السجل غير موجود أو ليس لديك صلاحية لعرضه.';
  const translated = messages
    .map(translateServerMessage)
    .filter((value): value is string => Boolean(value));
  if (translated.length) return translated.join('\n');
  if (messages.length) return messages.join('\n');
  if (status >= 500) return 'تعذر إتمام الطلب. حاول مرة أخرى.';
  return 'تعذر إتمام الطلب. حاول مرة أخرى.';
}

export class ApiError extends Error {
  /** Raw messages returned by the backend; empty when the body was unreadable. */
  public readonly messages: string[];
  public readonly status: number;
  constructor(status: number, messages: string[] = []) {
    super(displayMessage(status, messages));
    this.status = status;
    this.messages = messages;
  }
}

export interface RequestOptions {
  method?: HttpMethod;
  /** JSON body, serialised automatically. Do not combine with `formData`. */
  body?: unknown;
  /**
   * Multipart body. The browser sets the `Content-Type` header including the
   * boundary, so it is deliberately never set by hand here.
   */
  formData?: FormData;
  accessToken?: string;
  /** Defaults to unwrapping the backend `{ data }` envelope as JSON. */
  responseType?: 'json' | 'blob' | 'none';
  headers?: Record<string, string>;
  /** Defaults to 30s; long uploads and image reads use the same budget. */
  timeoutMs?: number;
}

async function readErrorMessages(response: Response): Promise<string[]> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return [];
  }
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as ApiErrorEnvelope;
    const message = parsed?.error?.message;
    if (typeof message === 'string') return message ? [message] : [];
    if (Array.isArray(message))
      return message.filter((item): item is string => typeof item === 'string');
    return [];
  } catch {
    return [];
  }
}

async function readJsonEnvelope<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return undefined as T;
  const parsed = JSON.parse(text) as ApiResponse<T>;
  return parsed.data;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!baseUrl)
    throw new Error('عنوان خدمة الدخول غير مضبوط. راجع إعدادات التشغيل.');
  const {
    method = 'GET',
    body,
    formData,
    accessToken,
    responseType = 'json',
    headers = {},
    timeoutMs = 30000,
  } = options;

  const requestHeaders: Record<string, string> = { ...headers };
  // Only a JSON body carries an explicit Content-Type; a FormData body must
  // keep the browser-generated boundary.
  if (formData === undefined && body !== undefined)
    requestHeaders['Content-Type'] = 'application/json';
  if (accessToken) requestHeaders['Authorization'] = `Bearer ${accessToken}`;

  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(new URL(path, baseUrl), {
      method,
      headers: requestHeaders,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch {
    throw new Error('تعذر الاتصال بالخادم. تأكد من الاتصال وحاول مرة أخرى.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) throw new ApiError(response.status, await readErrorMessages(response));
  if (responseType === 'none') return undefined as T;
  if (responseType === 'blob') return (await response.blob()) as T;
  return readJsonEnvelope<T>(response);
}

export const apiGet = <T>(path: string, accessToken?: string) =>
  apiRequest<T>(path, { accessToken });
