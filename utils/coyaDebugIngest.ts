/**
 * Journalisation NDJSON locale via le middleware Vite (`debugIngestPlugin` dans vite.config.ts).
 * No-op en production : évite les POST `/__debug/ingest` → 405 sur hébergement statique (ex. coya.pro).
 */
export function postCoyaDebugIngest(payload: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  fetch('/__debug/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5fe008' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
