import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { ModuleManifest } from '../modules/manifest';

/**
 * Unter `dataPath` liegen zwei verschiedene Dinge, die das Backup gleich
 * behandelt und ein Zurücksetzen nicht: **Bestand**, den die Anwendung erzeugt
 * hat — Datenbank, Mediathek, abgelegte Dokumente — und **bereitgestelltes
 * Material**, das jemand hineingelegt hat: das Template der Webseite, eigene
 * Dokument-Basisvorlagen. Beides gehört gesichert, aber nur das erste darf ein
 * `dev:reset` oder ein E2E-Lauf wegräumen; sonst wäre ein selbst gebautes
 * Template nach dem nächsten Testlauf weg.
 *
 * Was bereitgestellt ist, sagt das Modul über `providedFiles` in seinem
 * Manifest — hier steht keine Liste von Modulnamen.
 */
export async function resetDataPath(dataPath: string, manifests: readonly ModuleManifest[]): Promise<void> {
  const keep = new Set(
    manifests.flatMap((manifest) =>
      (manifest.providedFiles ?? []).map((relative) => path.join(dataPath, manifest.key, relative)),
    ),
  );

  const removeExcept = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir).catch(() => [] as string[])) {
      const target = path.join(dir, entry);
      // Ein Elternverzeichnis eines geschützten Pfads wird nicht gelöscht,
      // sondern betreten — dort kann Bestand neben Bereitgestelltem liegen.
      if (keep.has(target)) continue;
      if ([...keep].some((kept) => kept.startsWith(`${target}${path.sep}`))) {
        await removeExcept(target);
        continue;
      }
      // Wiederholen statt scheitern: Legt nebenher jemand eine Datei an — eine
      // Anfrage, die mitten in den Reset läuft und die Datenbank öffnet —,
      // meldet `rm` ENOTEMPTY, obwohl gleich darauf alles weg wäre.
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  };

  await removeExcept(dataPath);
}
