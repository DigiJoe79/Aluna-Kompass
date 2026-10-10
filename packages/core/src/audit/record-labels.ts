import { eq } from 'drizzle-orm';
import type { CallContext } from '../context';
import { apiTokens, mediaAssets, mediaFolders, roles, users } from '../db/schema';
import type { Deps } from '../deps';
import type { RecordLabelInput } from '../modules/manifest';

/** Der Name je Typ des Kerns, oder `undefined`, wenn der Datensatz fehlt. */
const NAMES: Record<string, (deps: Deps, id: string) => string | undefined> = {
  user: (deps, id) => deps.db.select({ name: users.name }).from(users).where(eq(users.id, id)).get()?.name,
  role: (deps, id) => deps.db.select({ name: roles.name }).from(roles).where(eq(roles.id, id)).get()?.name,
  apiToken: (deps, id) => deps.db.select({ name: apiTokens.name }).from(apiTokens).where(eq(apiTokens.id, id)).get()?.name,
  mediaAsset: (deps, id) => deps.db.select({ filename: mediaAssets.filename }).from(mediaAssets).where(eq(mediaAssets.id, id)).get()?.filename,
  mediaFolder: (deps, id) => deps.db.select({ path: mediaFolders.path }).from(mediaFolders).where(eq(mediaFolders.path, id)).get()?.path,
};

/**
 * Beschriftung der Datensätze des Kerns, vor allem für die Spalte „Objekt“ im Änderungsprotokoll (Joe 2026-10-09):
 * Name statt ID. Ohne eigene Rechteprüfung — wer `audit.view` hat, sieht Nutzernamen schon in der Spalte „Nutzer“,
 * und Rollen, Zugangsschlüssel und Dateien nennen keine Personendaten. Nicht aus `index.ts` exportieren (MCP-Paritätswächter).
 */
export function coreRecordLabels(deps: Deps, _ctx: CallContext, entityType: string, id: string): RecordLabelInput | null {
  const name = NAMES[entityType];
  if (!name) return null;
  const label = name(deps, id);
  return label === undefined ? { label: '', href: null, state: 'missing' } : { label, href: null, state: 'ok' };
}
