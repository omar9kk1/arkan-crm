import {
  DUPLICATE_NOTIFICATION_MESSAGE,
  DUPLICATE_NOTIFICATION_TITLE,
  duplicateNotificationDetails,
  isPotentialDuplicateNotification,
  notificationAffectsPropertyLists,
  notificationDisplay,
  stripInternalIds,
} from '../../frontend/features/notifications/view';

/**
 * Focused coverage for the notification display projection. The module is pure
 * (no React/DOM), so the backend jest runner can import it directly.
 */
describe('manager notification display', () => {
  const uuid = 'c957b7f8-2a05-4a78-b84d-b263822d06c6';

  it('recognises potential-duplicate rows by their event key', () => {
    expect(isPotentialDuplicateNotification({ eventKey: `POTENTIAL_DUPLICATE:${uuid}:x` })).toBe(true);
    expect(isPotentialDuplicateNotification({ eventKey: 'PROPERTY_SUBMITTED:x' })).toBe(false);
    expect(isPotentialDuplicateNotification({ eventKey: null })).toBe(false);
  });

  it('renders the canonical title/message and compact codes/name/status', () => {
    const display = notificationDisplay({
      title: 'old stored title',
      message: `عقار A-000003 (مقدّم من ${uuid}) يشبه العقار A-000001.`,
      propertyReference: 'A-000003',
      eventKey: `POTENTIAL_DUPLICATE:${uuid}:match`,
      duplicate: {
        newPropertyReference: 'A-000003',
        existingPropertyReference: 'A-000001',
        employeeName: 'كريم',
        status: 'PENDING',
      },
    });
    expect(display.isDuplicate).toBe(true);
    expect(display.title).toBe(DUPLICATE_NOTIFICATION_TITLE);
    expect(display.message).toBe(DUPLICATE_NOTIFICATION_MESSAGE);
    expect(display.message).not.toContain(uuid);
    expect(display.details).toEqual([
      { label: 'العقار الجديد', value: 'A-000003', code: true },
      { label: 'العقار المشابه', value: 'A-000001', code: true },
      { label: 'الموظف', value: 'كريم' },
      { label: 'الحالة', value: 'بانتظار المراجعة' },
    ]);
  });

  it('fixes already-stored rows without rewriting the message', () => {
    const display = notificationDisplay({
      title: 'عقار محتمل التكرار — بانتظار المراجعة',
      message: `عقار A-000003 (مقدّم من ${uuid}) يشبه العقار A-000001.`,
      propertyReference: 'A-000003',
      eventKey: `POTENTIAL_DUPLICATE:${uuid}:match`,
      duplicate: {
        newPropertyReference: 'A-000003',
        existingPropertyReference: 'A-000001',
        employeeName: 'كريم',
        status: 'PENDING',
      },
    });
    expect(display.title).toBe(DUPLICATE_NOTIFICATION_TITLE);
    expect(display.message).toBe(DUPLICATE_NOTIFICATION_MESSAGE);
    expect(display.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('omits unavailable optional details gracefully', () => {
    expect(
      duplicateNotificationDetails({
        propertyReference: 'A-000009',
        duplicate: null,
      }),
    ).toEqual([{ label: 'العقار الجديد', value: 'A-000009', code: true }]);
    expect(
      duplicateNotificationDetails({
        propertyReference: null,
        duplicate: null,
      }),
    ).toEqual([]);
    expect(
      duplicateNotificationDetails({
        propertyReference: null,
        duplicate: {
          newPropertyReference: null,
          existingPropertyReference: null,
          employeeName: null,
          status: 'AVAILABLE',
        },
      }),
    ).toEqual([]);
  });

  it('strips raw ids from ordinary legacy messages', () => {
    const display = notificationDisplay({
      title: 'إشعار',
      message: `مرجع داخلي ${uuid} ثم نص عربي`,
      propertyReference: null,
      eventKey: 'PROPERTY_SUBMITTED:x',
      duplicate: null,
    });
    expect(display.isDuplicate).toBe(false);
    expect(display.message).not.toContain(uuid);
    expect(display.message).toContain('ثم نص عربي');
    expect(stripInternalIds(uuid)).toBe('');
  });

  it('rewrites a historical property code to the current one', () => {
    const display = notificationDisplay({
      title: 'إشعار',
      message: 'العقار A-000123 تم اعتماده',
      propertyReference: 'A-000004',
      eventKey: 'PROPERTY_APPROVED:x',
      duplicate: null,
    });
    expect(display.message).toContain('A-000004');
    expect(display.message).not.toContain('A-000123');
  });
});


describe('property-list refresh trigger', () => {
  it('refreshes for the SYSTEM soft-delete decision (property-linked)', () => {
    expect(
      notificationAffectsPropertyLists({
        propertyId: '11111111-1111-4111-8111-111111111111',
        type: 'SYSTEM',
      }),
    ).toBe(true);
  });

  it('refreshes for property events even without a link', () => {
    expect(
      notificationAffectsPropertyLists({
        propertyId: null,
        type: 'PROPERTY_APPROVED',
      }),
    ).toBe(true);
  });

  it('does not refresh for unrelated notifications', () => {
    expect(
      notificationAffectsPropertyLists({ propertyId: null, type: 'SYSTEM' }),
    ).toBe(false);
    expect(
      notificationAffectsPropertyLists({
        propertyId: null,
        type: 'CLIENT_CREATED',
      }),
    ).toBe(false);
  });
});
