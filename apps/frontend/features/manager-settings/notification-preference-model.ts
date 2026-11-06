/**
 * Pure state + request contract for the manager's
 * «تفعيل إشعارات المتابعة» switch.
 *
 * Kept framework-free so the ON/OFF, rollback and duplicate-request rules can
 * be unit-tested without a React runner.
 *
 * The PATCH body is deliberately a plain OBJECT: `apiRequest` serialises it
 * exactly once. Passing an already-stringified body here would send a JSON
 * *string literal* (double encoding) which the backend body parser rejects
 * with 400 — that was the original bug that kept the switch from turning ON.
 */

export const NOTIFICATION_PREFERENCE_PATH =
  '/users/me/notification-preferences';

export const NOTIFICATION_PREFERENCE_ERROR =
  'تعذّر حفظ إعداد إشعارات المتابعة، وأُعيد الوضع السابق. حاول مرة أخرى.';

export const NOTIFICATION_PREFERENCE_SAVED =
  'تم حفظ إعداد إشعارات المتابعة.';

export const NOTIFICATION_PREFERENCE_SAVING = 'جارٍ حفظ الإعداد…';

export interface NotificationPreferenceResponse {
  notifyEmployeeFollowUps: boolean;
}

export interface NotificationPreferenceRequestOptions {
  method: 'PATCH';
  body: { enabled: boolean };
}

export interface NotificationPreferenceRequestDescriptor {
  path: string;
  options: NotificationPreferenceRequestOptions;
}

export type NotificationPreferenceRequest = (
  path: string,
  options: NotificationPreferenceRequestOptions,
) => Promise<NotificationPreferenceResponse>;

export interface NotificationPreferenceState {
  /** Last value confirmed by the server. */
  saved: boolean;
  /** Value currently rendered by the switch. */
  visible: boolean;
  /** True while the PATCH is in flight. */
  saving: boolean;
  /** Clear Arabic message after a failed save; empty otherwise. */
  error: string;
}

export const initialNotificationPreferenceState: NotificationPreferenceState = {
  saved: false,
  visible: false,
  saving: false,
  error: '',
};

export type NotificationPreferenceAction =
  | { type: 'loaded'; enabled: boolean }
  | { type: 'toggle'; enabled: boolean }
  | { type: 'saved'; enabled: boolean }
  | { type: 'failed'; message?: string };

export function notificationPreferenceRequest(
  enabled: boolean,
): NotificationPreferenceRequestDescriptor {
  return {
    path: NOTIFICATION_PREFERENCE_PATH,
    options: { method: 'PATCH', body: { enabled } },
  };
}

/** A save is only meaningful when it changes the server-confirmed value. */
export function notificationPreferenceCanSave(
  state: NotificationPreferenceState,
  enabled: boolean,
): boolean {
  return !state.saving && enabled !== state.saved;
}

export function notificationPreferenceReducer(
  state: NotificationPreferenceState,
  action: NotificationPreferenceAction,
): NotificationPreferenceState {
  switch (action.type) {
    case 'loaded':
      return {
        saved: action.enabled,
        visible: action.enabled,
        saving: false,
        error: '',
      };
    case 'toggle':
      if (!notificationPreferenceCanSave(state, action.enabled)) return state;
      return { ...state, visible: action.enabled, saving: true, error: '' };
    case 'saved':
      return {
        saved: action.enabled,
        visible: action.enabled,
        saving: false,
        error: '',
      };
    case 'failed':
      return {
        ...state,
        visible: state.saved,
        saving: false,
        error: action.message ?? NOTIFICATION_PREFERENCE_ERROR,
      };
  }
}

/**
 * Sends the preference once and returns the value the server confirmed, so the
 * UI mirrors the saved state rather than the optimistic one.
 */
export async function saveNotificationPreference(
  request: NotificationPreferenceRequest,
  enabled: boolean,
): Promise<boolean> {
  const { path, options } = notificationPreferenceRequest(enabled);
  const response = await request(path, options);
  return response.notifyEmployeeFollowUps;
}
