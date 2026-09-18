import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Das Verzeichnis des Templates im Volume: der Dateispeicher dieses Moduls,
 * `<DATA_PATH>/site/template`. `SITE_TEMPLATE_DIR` überschreibt das (Tests, E2E).
 */
export function siteTemplateDir(env: Record<string, string | undefined> = process.env): string {
  if (env.SITE_TEMPLATE_DIR) return path.resolve(env.SITE_TEMPLATE_DIR);
  return path.resolve(env.DATA_PATH ?? './data', 'site', 'template');
}

/**
 * Der Stand, den ein Backup-Import beiseitegeschoben hat: Der Kern legt den
 * bisherigen Bestand als `.before-import-<Zeitstempel>` neben das Volume und
 * hebt immer nur den jüngsten auf. Von dort kommt das Template, gegen das
 * verglichen wird, ob ein eingespieltes dasselbe ist (siehe `review.ts`).
 *
 * `null`, wenn es keinen gibt — etwa nach einem Import in eine frische
 * Installation. Dann bleibt die Prüfung beim Menschen.
 */
export function previousTemplateDir(env: Record<string, string | undefined> = process.env): string | null {
  const dataPath = path.resolve(env.DATA_PATH ?? './data');
  let aside: string[];
  try {
    aside = readdirSync(dataPath).filter((name) => name.startsWith('.before-import-'));
  } catch {
    return null;
  }
  if (aside.length === 0) return null;
  // Sortiert ist der jüngste der letzte: Der Zeitstempel im Namen ist ISO-8601
  // ohne Trennzeichen und damit lexikographisch sortierbar.
  const juengster = aside.sort()[aside.length - 1]!;
  const dir = path.join(dataPath, juengster, 'site', 'template');
  return existsSync(dir) ? dir : null;
}
