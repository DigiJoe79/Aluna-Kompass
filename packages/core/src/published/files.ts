import type { Deps } from '../deps';
import { enabledManifests } from '../modules/service';

/**
 * Eine Datei, die ein Modul der Webseite liefert (Haken `publishedFile`): Eine Sicht nennt sie unter einem Schlüssel auf
 * `…AssetId`, der Export kopiert sie neben die Bilder der Mediathek. Das Modul erkennt seine IDs (Präfix) und liefert
 * nur, was es selbst für öffentlich erklärt hat.
 */
export interface PublishedFileSource {
  id: string;
  filename: string;
  mimeType: string;
  read: () => Promise<Uint8Array>;
}

/** Die Datei zu einer ID über die eingeschalteten Module; keins erkennt sie → `null`. */
export function resolvePublishedFile(deps: Deps, id: string): PublishedFileSource | null {
  for (const manifest of enabledManifests(deps)) {
    const file = manifest.publishedFile?.(deps, id) ?? null;
    if (file) return file;
  }
  return null;
}

/**
 * Seit wann eine Zeile einer Sicht unverändert auf der Webseite steht (Haken `publishedLiveSince` des Webseiten-Moduls);
 * `null`, wenn sie dort (noch) nicht so steht oder kein Modul es weiß. Der Kern liest keine Webseiten-Tabellen.
 */
export function publishedItemLiveSince(deps: Deps, view: string, href: string): string | null {
  for (const manifest of enabledManifests(deps)) {
    const since = manifest.publishedLiveSince?.(deps, view, href) ?? null;
    if (since) return since;
  }
  return null;
}
