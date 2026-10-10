import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { apiTokens, mediaAssets, mediaFolders } from '../src/db/schema';
import { resolveRecordLabel } from '../src/modules/record-hooks';
import { createTestDeps, ctxWith, insertRole, insertUser } from '../src/testing';

/**
 * Die Spalte „Objekt“ im Protokoll nennt Datensätze des Kerns mit Namen statt ID (Joe 2026-10-09): Nutzer, Rolle,
 * Zugangsschlüssel, Datei und Ordner der Mediathek. Wer `audit.view` hat, sieht Nutzernamen ohnehin in der Spalte
 * „Nutzer“ — eine strengere Rechteprüfung braucht es nicht. Gelöschte sagen `missing`.
 */
describe('recordLabels des Kerns', () => {
  const ctx = ctxWith(['audit.view']);

  it('nennt Nutzer, Rolle, Zugangsschlüssel, Datei und Ordner mit Namen', () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    const user = insertUser(deps, { name: 'Anna Berger' });
    const role = insertRole(deps, { name: 'Vorstand' });
    deps.db.insert(apiTokens).values({ id: 'TOK1', userId: user, name: 'Claude Desktop', prefix: 'kmp_1', tokenHash: 'h', createdAt: 'now' }).run();
    deps.db.insert(mediaAssets).values({ id: 'MED1', filename: 'hof-3f2a1b9c0d4e.jpg', mimeType: 'image/jpeg', bytes: 1, createdAt: 'now' }).run();
    deps.db.insert(mediaFolders).values({ path: 'Bilder/Hof', createdAt: 'now' }).run();

    const label = (type: string, id: string) => resolveRecordLabel(deps, ctx, type, id);
    expect(label('user', user)).toMatchObject({ label: 'Anna Berger', state: 'ok' });
    expect(label('role', role)).toMatchObject({ label: 'Vorstand', state: 'ok' });
    expect(label('apiToken', 'TOK1')).toMatchObject({ label: 'Claude Desktop', state: 'ok' });
    expect(label('mediaAsset', 'MED1')).toMatchObject({ label: 'hof-3f2a1b9c0d4e.jpg', state: 'ok' });
    expect(label('mediaFolder', 'Bilder/Hof')).toMatchObject({ label: 'Bilder/Hof', state: 'ok' });
  });

  it('sagt missing für Gelöschtes und schweigt zu fremden Typen', () => {
    const deps = createTestDeps({ manifests: [coreModule] });
    for (const type of ['user', 'role', 'apiToken', 'mediaAsset', 'mediaFolder']) expect(resolveRecordLabel(deps, ctx, type, 'WEG')).toEqual({ label: '', href: null, state: 'missing' });
    expect(resolveRecordLabel(deps, ctx, 'animal', 'A1')).toBeNull();
  });
});
