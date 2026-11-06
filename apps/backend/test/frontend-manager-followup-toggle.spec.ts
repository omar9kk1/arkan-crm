import {
  NOTIFICATION_PREFERENCE_ERROR,
  NOTIFICATION_PREFERENCE_PATH,
  initialNotificationPreferenceState,
  notificationPreferenceCanSave,
  notificationPreferenceReducer,
  notificationPreferenceRequest,
  saveNotificationPreference,
  type NotificationPreferenceState,
} from '../../frontend/features/manager-settings/notification-preference-model';

/**
 * Mocked, database-free coverage for the manager's
 * «تفعيل إشعارات المتابعة» switch.
 *
 * The original bug: the page pre-stringified the PATCH body while `apiRequest`
 * serialises it again, so the server received a JSON string literal and
 * answered 400; the UI silently reverted and the switch never turned ON.
 */

const loaded = (enabled: boolean): NotificationPreferenceState =>
  notificationPreferenceReducer(initialNotificationPreferenceState, {
    type: 'loaded',
    enabled,
  });

describe('manager follow-up notification preference', () => {
  it('sends the preference body as a plain object that is serialised once', () => {
    const { path, options } = notificationPreferenceRequest(true);

    expect(path).toBe('/users/me/notification-preferences');
    expect(path).toBe(NOTIFICATION_PREFERENCE_PATH);
    expect(options.method).toBe('PATCH');
    expect(options.body).toEqual({ enabled: true });
    expect(typeof options.body).toBe('object');

    // Exactly the payload apiRequest puts on the wire — one encoding level,
    // never the `"{\"enabled\":true}"` string literal the API rejected.
    const wireBody = JSON.stringify(options.body);
    expect(wireBody).toBe('{"enabled":true}');
    expect(JSON.parse(wireBody)).toEqual({ enabled: true });

    expect(notificationPreferenceRequest(false).options.body).toEqual({
      enabled: false,
    });
  });

  it('turns ON, saves the server-confirmed true value, and keeps it after reload', async () => {
    const calls: Array<{ path: string; options: unknown }> = [];
    const saved = await saveNotificationPreference(
      async (path, options) => {
        calls.push({ path, options });
        return { notifyEmployeeFollowUps: options.body.enabled };
      },
      true,
    );

    expect(calls).toEqual([
      {
        path: NOTIFICATION_PREFERENCE_PATH,
        options: { method: 'PATCH', body: { enabled: true } },
      },
    ]);
    expect(saved).toBe(true);

    let state = notificationPreferenceReducer(
      initialNotificationPreferenceState,
      { type: 'toggle', enabled: true },
    );
    expect(state).toMatchObject({
      saved: false,
      visible: true,
      saving: true,
      error: '',
    });

    state = notificationPreferenceReducer(state, {
      type: 'saved',
      enabled: saved,
    });
    expect(state).toMatchObject({
      saved: true,
      visible: true,
      saving: false,
      error: '',
    });

    // A page refresh / a fresh login re-reads the stored value from the API.
    expect(loaded(true)).toMatchObject({
      saved: true,
      visible: true,
      saving: false,
    });
  });

  it('turns OFF, saves false, and renders OFF after reload', async () => {
    const saved = await saveNotificationPreference(
      async (_path, options) => ({
        notifyEmployeeFollowUps: options.body.enabled,
      }),
      false,
    );
    expect(saved).toBe(false);

    let state = loaded(true);
    expect(state.visible).toBe(true);

    state = notificationPreferenceReducer(state, {
      type: 'toggle',
      enabled: false,
    });
    expect(state).toMatchObject({ saved: true, visible: false, saving: true });

    state = notificationPreferenceReducer(state, {
      type: 'saved',
      enabled: saved,
    });
    expect(state).toMatchObject({
      saved: false,
      visible: false,
      saving: false,
    });

    expect(loaded(false).visible).toBe(false);
  });

  it('mirrors the server value instead of the optimistic one', async () => {
    const confirmed = await saveNotificationPreference(
      async () => ({ notifyEmployeeFollowUps: false }),
      true,
    );
    expect(confirmed).toBe(false);
    expect(
      notificationPreferenceReducer(
        notificationPreferenceReducer(initialNotificationPreferenceState, {
          type: 'toggle',
          enabled: true,
        }),
        { type: 'saved', enabled: confirmed },
      ),
    ).toMatchObject({ saved: false, visible: false, saving: false });
  });

  it('rolls back to the last saved value and exposes a clear Arabic error', () => {
    let state = notificationPreferenceReducer(loaded(false), {
      type: 'toggle',
      enabled: true,
    });
    expect(state).toMatchObject({ saved: false, visible: true, saving: true });

    state = notificationPreferenceReducer(state, { type: 'failed' });
    expect(state).toMatchObject({
      saved: false,
      visible: false,
      saving: false,
    });
    expect(state.error).toBe(NOTIFICATION_PREFERENCE_ERROR);
    expect(state.error).toMatch(/تعذّر/);

    // The same rollback works when switching OFF fails.
    let off = notificationPreferenceReducer(loaded(true), {
      type: 'toggle',
      enabled: false,
    });
    off = notificationPreferenceReducer(off, { type: 'failed' });
    expect(off).toMatchObject({
      saved: true,
      visible: true,
      saving: false,
    });

    // A new attempt clears the stale error message.
    expect(
      notificationPreferenceReducer(off, { type: 'toggle', enabled: false })
        .error,
    ).toBe('');
  });

  it('blocks duplicate and no-op requests while saving', () => {
    const pending = notificationPreferenceReducer(
      initialNotificationPreferenceState,
      { type: 'toggle', enabled: true },
    );

    expect(notificationPreferenceCanSave(pending, true)).toBe(false);
    // The reducer returns the identical state, so a second click is a no-op.
    expect(
      notificationPreferenceReducer(pending, { type: 'toggle', enabled: true }),
    ).toBe(pending);
    expect(
      notificationPreferenceReducer(pending, { type: 'toggle', enabled: false }),
    ).toBe(pending);

    // Clicking the value the server already has must not hit the API either.
    expect(notificationPreferenceCanSave(loaded(false), false)).toBe(false);
    expect(notificationPreferenceCanSave(loaded(true), true)).toBe(false);
    expect(notificationPreferenceCanSave(loaded(true), false)).toBe(true);
  });
});
