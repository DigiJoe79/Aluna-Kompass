import path from 'node:path';

/**
 * Das Verzeichnis des Templates im Volume. Vorgabe ist `site-template` neben der
 * Datenbank; `SITE_TEMPLATE_DIR` überschreibt das (Tests, E2E).
 */
export function siteTemplateDir(env: Record<string, string | undefined> = process.env): string {
  if (env.SITE_TEMPLATE_DIR) return path.resolve(env.SITE_TEMPLATE_DIR);
  const dataDir = path.dirname(env.DATABASE_PATH ?? './data/kompass.db');
  return path.resolve(dataDir, 'site-template');
}
