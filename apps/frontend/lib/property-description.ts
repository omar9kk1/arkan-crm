// The property wizard stores its structured form as JSON in `description` so the
// form can be restored when editing. Free-text descriptions (seed/demo data) are
// left untouched. This helper renders a short readable Arabic summary for the
// structured case so detail drawers never show a raw JSON blob.
type Unknown = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function summarize(form: Unknown, redactContact: boolean): string {
  const parts: string[] = [];
  const type = text(form.propertyType);
  const operation = text(form.operation);
  if (type || operation)
    parts.push([type, operation].filter(Boolean).join(' · '));

  const location = [
    text(form.district),
    text(form.governorate),
    text(form.neighborhood),
  ].filter(Boolean);
  const block = [
    text(form.block) && `قطعة ${text(form.block)}`,
    text(form.plotNumber) && `حوض ${text(form.plotNumber)}`,
  ].filter(Boolean);
  if (location.length || block.length)
    parts.push(
      ['الموقع: ' + location.join('، '), ...block].filter(Boolean).join(' — '),
    );

  const areas = [
    text(form.landArea) && `أرض ${text(form.landArea)} م²`,
    text(form.unitArea) && `وحدة ${text(form.unitArea)} م²`,
  ].filter(Boolean);
  if (areas.length) parts.push('المساحة: ' + areas.join(' · '));

  if (text(form.price)) parts.push(`السعر: ${text(form.price)} د.ك`);

  const floors = list(form.floors);
  if (floors.length) {
    const labels = floors
      .map((floor) => {
        if (!floor || typeof floor !== 'object') return '';
        const value = floor as Unknown;
        return text(value.customLabel) || text(value.label);
      })
      .filter(Boolean);
    parts.push(
      `الأدوار: ${floors.length}${labels.length ? ` (${labels.join('، ')})` : ''}`,
    );
  }

  if (
    text(form.constructionStatus) &&
    text(form.constructionStatus) !== 'غير محدد'
  )
    parts.push(`حالة الإنشاء: ${text(form.constructionStatus)}`);
  if (text(form.finishing) && text(form.finishing) !== 'غير محدد')
    parts.push(`التشطيب: ${text(form.finishing)}`);

  const features = list(form.features).map(text).filter(Boolean);
  if (text(form.otherFeature)) features.push(text(form.otherFeature));
  if (features.length) parts.push(`المرافق: ${features.join('، ')}`);

  if (text(form.occupancy) && text(form.occupancy) !== 'غير محدد')
    parts.push(`الإشغال: ${text(form.occupancy)}`);
  if (text(form.ownershipDoc) && text(form.ownershipDoc) !== 'غير محدد')
    parts.push(`مستند الملكية: ${text(form.ownershipDoc)}`);

  const isBroker = text(form.contactType) === 'BROKER';
  const owner = isBroker
    ? text(form.brokerName)
    : text(form.ownerName) || text(form.contactPerson);
  const phone = isBroker ? text(form.brokerPhone) : text(form.contactPhone);
  // Owner/broker name and phone are private: only include them when authorized.
  if (!redactContact && (owner || phone))
    parts.push(
      [owner ? `${isBroker ? 'الوسيط' : 'المالك'}: ${owner}` : '', phone]
        .filter(Boolean)
        .join(' — '),
    );

  if (text(form.buildingNote))
    parts.push(`ملاحظات: ${text(form.buildingNote)}`);

  return parts.join(' · ');
}

/** Returns a readable summary for wizard JSON, otherwise the original text. */
export function formatPropertyDescription(
  description: string,
  options: { redactContact?: boolean } = {},
): string {
  const value = description?.trim();
  if (!value || !value.startsWith('{')) return description;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      'entryMethod' in parsed &&
      'floors' in parsed
    ) {
      const summary = summarize(parsed as Unknown, !!options.redactContact);
      if (summary) return summary;
    }
  } catch {
    /* Not structured JSON; fall through to the original text. */
  }
  return description;
}
