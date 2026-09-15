import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isoNow, ok, readSetting, recordAudit, type CallContext, type Deps, type Result } from '@kompass/core';
import { siteTemplateState } from './schema';
import { activeTemplate } from './service';

/**
 * Gilt das Template als ungeprüft, weil es mit einem Backup hereinkam?
 *
 * Das Template liegt im Datenvolume und ist ausführbarer Code: `loadTemplate`
 * lädt `kompass.template.ts` per `import()`, und beim Publizieren baut
 * `astro build` das ganze Verzeichnis. Ein Backup-Import ersetzt das Volume —
 * wer ein Archiv einspielen darf, legt damit Code im Container ab, der beim
 * nächsten Publish läuft.
 *
 * Das Template aus dem Backup zu verwerfen wäre die einfachere Antwort, aber
 * die falsche: Für einen Verein ist die Webseite oft das Sichtbarste, was er
 * hat, und ein Vollbackup, das sie nicht zurücknimmt, ist kaputt. Es kommt
 * deshalb mit — nur ausgeführt wird es erst, wenn ein Mensch es eingelesen
 * hat.
 *
 * Erkannt wird das an zwei Zeitstempeln, die es ohnehin gibt: `readAt` am
 * Template-Stand (gesetzt, wenn jemand einliest) und `system.lastImportAt`
 * (gesetzt vom Import). Beide stehen in der Datenbank und kommen bei einem
 * Import gemeinsam aus dem Archiv — aber der Import überschreibt
 * `system.lastImportAt` **danach**, mit der Uhr dieser Installation. Ein
 * präpariertes Archiv kann den Zustand deshalb nicht mitbringen.
 */
export function templateNeedsReview(deps: Deps): boolean {
  const state = activeTemplate(deps);
  // Ohne eingelesenes Template ist „ungeprüft“ der falsche Begriff: Es ist
  // keins da, und die Oberfläche sagt das ohnehin.
  if (!state) return false;
  const lastImportAt = readSetting<string | null>(deps, 'system.lastImportAt');
  if (!lastImportAt) return false;
  return state.readAt < lastImportAt;
}

/**
 * Was nicht zum Template gehört, sondern zur Installation: die Modulauflösung
 * und alles, was ein Bau erzeugt. Beides unterscheidet sich zwischen zwei
 * Installationen, ohne dass das Template ein anderes wäre.
 */
const NICHT_TEMPLATE = new Set(['node_modules', 'dist', '.astro', '.git']);

/**
 * Fingerabdruck über **alle** Dateien des Template-Verzeichnisses.
 *
 * Nicht nur über `kompass.template.ts`: Beim Publizieren baut `astro build`
 * das ganze Verzeichnis, also führt jede Komponente und jede Konfiguration
 * dort Code aus. Ein Vergleich, der nur die Deklaration ansieht, übersähe ein
 * Template, dessen Deklaration unverändert ist und dessen Komponente etwas
 * anderes tut.
 */
function templateDigest(dir: string): string | null {
  const dateien: string[] = [];
  const sammle = (rel: string): void => {
    let eintraege;
    try {
      eintraege = readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const eintrag of eintraege.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (NICHT_TEMPLATE.has(eintrag.name)) continue;
      const kind = rel ? path.join(rel, eintrag.name) : eintrag.name;
      if (eintrag.isDirectory()) sammle(kind);
      else if (eintrag.isFile()) dateien.push(kind);
    }
  };
  sammle('');
  if (dateien.length === 0) return null;
  const hash = createHash('sha256');
  for (const datei of dateien) {
    // Der Pfad geht mit ein, sonst fiele eine umbenannte Datei nicht auf.
    hash.update(datei).update('\0');
    try {
      hash.update(readFileSync(path.join(dir, datei)));
    } catch {
      return null;
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

export type SettleResult = 'notPending' | 'unchanged' | 'changed' | 'noPrevious';

/**
 * Gleicht nach einem Import ab, ob das eingespielte Template dasselbe ist wie
 * das, was vorher lief — und nimmt ihm in diesem Fall die Prüfpflicht ab.
 *
 * Das ist der Normalfall: Wer sein eigenes Backup einspielt, bringt sein
 * eigenes Template mit. Ihn zu fragen, ob er seinem eigenen Template traut,
 * wäre eine Rückfrage ohne Inhalt — und ein Dialog, den man wegklickt, ohne
 * zu lesen, macht den Fall, in dem es zählt, gefährlicher statt sicherer.
 *
 * Verglichen wird gegen den Stand **vor** dem Import (`.before-import-*`),
 * nicht gegen den Zustand aus dem Archiv. Ein präpariertes Archiv kann sich
 * damit nicht selbst freigeben: Es kennt den Stand nicht, den es ersetzt.
 */
export function settleTemplateAfterImport(
  deps: Deps,
  ctx: CallContext,
  dir: string,
  previousDir: string | null,
): Result<SettleResult> {
  if (!templateNeedsReview(deps)) return ok('notPending');
  if (!previousDir) return ok('noPrevious');
  const jetzt = templateDigest(dir);
  const vorher = templateDigest(previousDir);
  if (!jetzt || !vorher || jetzt !== vorher) return ok('changed');

  // Nicht einfach `jetzt`: Geht die Uhr der Installation nach — auf einer NAS
  // ohne Zeitabgleich keine Seltenheit —, läge der Vermerk vor dem Import und
  // die Prüfpflicht bliebe für immer stehen. Der Import-Zeitpunkt ist die
  // Untergrenze; geprüft ist es mindestens seitdem.
  const lastImportAt = readSetting<string | null>(deps, 'system.lastImportAt');
  const jetztIso = isoNow(deps.clock);
  const now = lastImportAt && lastImportAt > jetztIso ? lastImportAt : jetztIso;
  deps.db.transaction((tx) => {
    tx.update(siteTemplateState).set({ readAt: now }).run();
    recordAudit(tx, deps, ctx, {
      action: 'site.template.settled',
      entityType: 'siteTemplate',
      entityId: 'current',
      after: { digest: jetzt },
      summary: 'Template nach Import unverändert übernommen',
    });
  });
  return ok('unchanged');
}
