import path from 'node:path';

/**
 * Das Verzeichnis des Templates im Volume: der Dateispeicher dieses Moduls,
 * `<DATA_PATH>/site/template`. `SITE_TEMPLATE_DIR` überschreibt das (Tests, E2E).
 */
export function siteTemplateDir(env: Record<string, string | undefined> = process.env): string {
  if (env.SITE_TEMPLATE_DIR) return path.resolve(env.SITE_TEMPLATE_DIR);
  return path.resolve(env.DATA_PATH ?? './data', 'site', 'template');
}
