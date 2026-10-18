import { BadRequestException } from '@nestjs/common';

/**
 * Sentinel stored in the required legacy `Property.area` column when no real
 * district/area fact is available. It is never a fabricated district: it is a
 * clearly marked "location unknown" value (the wizard legitimately allows an
 * unknown location).
 */
export const UNKNOWN_LOCATION_SENTINEL = 'موقع غير محدد';

/** Arabic-Indic and extended Arabic-Indic digits mapped to ASCII. */
const ARABIC_INDIC = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
const EXTENDED_ARABIC_INDIC = '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9';

function normalizeDigits(value: string): string {
  let out = value;
  if (/[\u0660-\u0669]/.test(out))
    out = out.replace(/[\u0660-\u0669]/g, (d) =>
      ARABIC_INDIC.indexOf(d) === -1 ? d : String(ARABIC_INDIC.indexOf(d)),
    );
  if (/[\u06F0-\u06F9]/.test(out))
    out = out.replace(/[\u06F0-\u06F9]/g, (d) =>
      EXTENDED_ARABIC_INDIC.indexOf(d) === -1
        ? d
        : String(EXTENDED_ARABIC_INDIC.indexOf(d)),
    );
  return out;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

export type PrivateContactKind = 'email' | 'phone';

/**
 * Detects clearly identifiable private contact strings (email or a run of 8+ digits,
 * which covers Kuwaiti mobile/landline numbers including +965 forms) inside free
 * text. Returns null when nothing conclusive is found.
 *
 * Public property text must never carry a source contact's phone/email.
 */
export function findPrivateContactInfo(value: string): PrivateContactKind | null {
  if (!value) return null;
  const text = normalizeDigits(value);
  if (EMAIL_PATTERN.test(text)) return 'email';
  // Collapse common phone separators, then look for a long digit run.
  const compact = text.replace(/[\s()+\-.\u00A0]/g, '');
  if (/\d{8,}/.test(compact)) return 'phone';
  return null;
}

/**
 * Rejects public free text that embeds a source contact phone/email. This is the
 * server-side guard that stops raw WhatsApp/smart-paste data (which routinely
 * contains a contact number) from becoming public property data. It intentionally
 * fails closed: if contact data cannot be ruled out, the submission is rejected.
 */
export function assertNoPrivateContactInfo(
  value: string | null | undefined,
  field: string,
): void {
  if (value === null || value === undefined || value === '') return;
  const found = findPrivateContactInfo(String(value));
  if (found)
    throw new BadRequestException(
      `The ${field} field appears to contain a private contact ${found}. Remove phone numbers and emails from public property text.`,
    );
}
