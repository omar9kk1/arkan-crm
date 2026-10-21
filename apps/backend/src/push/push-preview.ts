/** The longest push preview: the FULL list stays in the in-app notification. */
const PUSH_PREVIEW_LIMIT = 200;

/**
 * The concise push preview of a notification body.
 *
 * The stored body keeps the complete, verified change list (the app shows it
 * all); the push preview is shortened at a field boundary so the operating
 * system toast stays readable, and the notification itself still opens the
 * full list.
 */
export function pushPreviewBody(
  body: string,
  limit = PUSH_PREVIEW_LIMIT,
): string {
  if (body.length <= limit) return body;
  const cut = body.slice(0, limit);
  const separator = Math.max(cut.lastIndexOf('،'), cut.lastIndexOf(','));
  const head = separator > 80 ? cut.slice(0, separator) : cut;
  return `${head.trim()} …`;
}
