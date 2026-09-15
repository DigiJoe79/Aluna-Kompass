import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { siteTemplateState } from '../src/schema';
import { settleTemplateAfterImport, templateNeedsReview } from '../src/review';

/**
 * Ein Backup-Import ersetzt das ganze Datenvolume — und das Template liegt
 * darin. Weil es per `import()` geladen und beim Publish mit `astro build`
 * gebaut wird, ist es ausfuehrbarer Code: Wer ein Archiv einspielen darf,
 * legt damit Code im Container ab.
 *
 * Verloren gehen soll es trotzdem nicht — fuer einen Verein ist die Webseite
 * oft das Sichtbarste, was er hat, und ein Vollbackup, das sie nicht
 * zuruecknimmt, ist kaputt. Das Template kommt deshalb mit, gilt aber als
 * ungeprueft, bis ein Mensch es einliest. Der Zustand ergibt sich aus zwei
 * Zeitstempeln, die es ohnehin gibt: dem des Imports und dem des Einlesens.
 */
const setup = () => {
  const deps = createTestDeps();
  const userId = insertUser(deps, {});
  return { deps, ctx: ctxWith(['site.manage'], userId) };
};

const eingelesenAm = (deps: ReturnType<typeof setup>['deps'], when: string) => {
  deps.db
    .insert(siteTemplateState)
    .values({ id: 'current', name: 'T', schemaJson: { name: 'T', locales: ['de'], uses: [], variables: {}, collections: {} }, checksum: 'a'.repeat(64), readAt: when, readByUserId: null })
    .onConflictDoUpdate({ target: siteTemplateState.id, set: { readAt: when } })
    .run();
};

const importiertAm = (deps: ReturnType<typeof setup>['deps'], ctx: CallContext, when: string) => {
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, ctx, 'system.lastImportAt', when, 'backup.import.mark'));
};

describe('a template that arrived with a backup', () => {
  it('needs a look when it was never read since the import', () => {
    const { deps, ctx } = setup();
    eingelesenAm(deps, '2026-09-01T10:00:00.000Z');
    importiertAm(deps, ctx, '2026-09-10T10:00:00.000Z');
    expect(templateNeedsReview(deps)).toBe(true);
  });

  it('is settled once somebody read it after the import', () => {
    const { deps, ctx } = setup();
    importiertAm(deps, ctx, '2026-09-10T10:00:00.000Z');
    eingelesenAm(deps, '2026-09-10T11:00:00.000Z');
    expect(templateNeedsReview(deps)).toBe(false);
  });

  it('says nothing about an installation that never saw an import', () => {
    const { deps } = setup();
    eingelesenAm(deps, '2026-09-01T10:00:00.000Z');
    expect(templateNeedsReview(deps)).toBe(false);
  });

  /** Ohne eingelesenes Template ist „ungeprueft“ der falsche Begriff — es ist schlicht keins da. */
  it('says nothing when no template was ever read', () => {
    const { deps, ctx } = setup();
    importiertAm(deps, ctx, '2026-09-10T10:00:00.000Z');
    expect(templateNeedsReview(deps)).toBe(false);
  });
});

describe('settling a template after an import', () => {
  const schreibe = (dir: string, dateien: Record<string, string>) => {
    for (const [name, inhalt] of Object.entries(dateien)) {
      mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
      writeFileSync(path.join(dir, name), inhalt);
    }
  };
  const tmp = () => mkdtempSync(path.join(tmpdir(), 'kompass-review-'));

  const nachImport = () => {
    const { deps, ctx } = setup();
    eingelesenAm(deps, '2026-09-01T10:00:00.000Z');
    importiertAm(deps, ctx, '2026-09-10T10:00:00.000Z');
    return { deps, ctx };
  };

  /** Der Normalfall: eigenes Backup, dasselbe Template. Niemand soll gefragt werden. */
  it('settles itself when the template is byte-for-byte the one that ran before', () => {
    const { deps, ctx } = nachImport();
    const jetzt = tmp();
    const vorher = tmp();
    const inhalt = { 'kompass.template.ts': 'export default {}', 'src/seite.astro': '<h1>Hallo</h1>' };
    schreibe(jetzt, inhalt);
    schreibe(vorher, inhalt);

    expect(unwrap(settleTemplateAfterImport(deps, ctx, jetzt, vorher))).toBe('unchanged');
    expect(templateNeedsReview(deps)).toBe(false);
  });

  it('keeps asking when a single file differs', () => {
    const { deps, ctx } = nachImport();
    const jetzt = tmp();
    const vorher = tmp();
    schreibe(jetzt, { 'kompass.template.ts': 'export default {}', 'src/seite.astro': '<h1>Hallo</h1>' });
    schreibe(vorher, { 'kompass.template.ts': 'export default {}', 'src/seite.astro': '<h1>Anders</h1>' });

    expect(unwrap(settleTemplateAfterImport(deps, ctx, jetzt, vorher))).toBe('changed');
    expect(templateNeedsReview(deps)).toBe(true);
  });

  /** Eine Datei, die es vorher nicht gab, ist eine Änderung — auch wenn alle anderen stimmen. */
  it('counts an added file as a change', () => {
    const { deps, ctx } = nachImport();
    const jetzt = tmp();
    const vorher = tmp();
    schreibe(jetzt, { 'kompass.template.ts': 'export default {}', 'src/heimlich.ts': 'fetch("http://boese")' });
    schreibe(vorher, { 'kompass.template.ts': 'export default {}' });

    expect(unwrap(settleTemplateAfterImport(deps, ctx, jetzt, vorher))).toBe('changed');
    expect(templateNeedsReview(deps)).toBe(true);
  });

  /** Nach einem Setup-Import gibt es keinen Vorher-Stand — dann bleibt es beim Menschen. */
  it('keeps asking when there is nothing to compare against', () => {
    const { deps, ctx } = nachImport();
    const jetzt = tmp();
    schreibe(jetzt, { 'kompass.template.ts': 'export default {}' });

    expect(unwrap(settleTemplateAfterImport(deps, ctx, jetzt, null))).toBe('noPrevious');
    expect(templateNeedsReview(deps)).toBe(true);
  });

  /** `node_modules` ist Beiwerk der Modulauflösung, nicht Teil des Templates. */
  it('ignores the module resolution, which differs by installation anyway', () => {
    const { deps, ctx } = nachImport();
    const jetzt = tmp();
    const vorher = tmp();
    schreibe(jetzt, { 'kompass.template.ts': 'export default {}', 'node_modules/astro/x.js': 'a' });
    schreibe(vorher, { 'kompass.template.ts': 'export default {}', 'node_modules/astro/x.js': 'b' });

    expect(unwrap(settleTemplateAfterImport(deps, ctx, jetzt, vorher))).toBe('unchanged');
  });

  it('does nothing at all when no import is pending', () => {
    const { deps, ctx } = setup();
    eingelesenAm(deps, '2026-09-01T10:00:00.000Z');
    const jetzt = tmp();
    schreibe(jetzt, { 'kompass.template.ts': 'export default {}' });
    expect(unwrap(settleTemplateAfterImport(deps, ctx, jetzt, null))).toBe('notPending');
  });
});
