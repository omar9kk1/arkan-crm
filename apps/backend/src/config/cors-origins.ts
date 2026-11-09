/**
 * Browser origins allowed to call the API.
 *
 * Production trusts ONLY the explicitly configured `FRONTEND_ORIGIN` list.
 * Local development keeps its convenience origins (localhost / LAN) so the
 * existing dev and mobile-testing flows continue to work, but those origins
 * are never added to a production deployment.
 */
export function resolveCorsOrigins(
  frontendOrigin: string,
  nodeEnv: string,
): string[] {
  const configured = frontendOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const developmentOrigins =
    nodeEnv === 'production'
      ? []
      : [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://192.168.1.8:3000',
        ];
  return [...new Set([...configured, ...developmentOrigins])];
}
