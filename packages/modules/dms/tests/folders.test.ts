import { auditEntry, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createDocumentFolder, createDocumentRule, createDocumentType, deleteDocumentFolder, listDocumentFolders, moveDocumentFolder } from '../src/catalog';
import { receiveDocument } from '../src/incoming';
import { listDocuments, moveDocument, moveDocuments } from '../src/service';
import { documentFolders, documents, documentRules, documentTypes } from '../src/schema';
import { ALL_DMS, auditActions, pdfBytes, setupWithArea, setupWithTypes } from './helpers';
import { eq } from 'drizzle-orm';
import type { CallContext, Deps } from '@kompass/core';

describe('folders', () => {
  it('legt einen Ordner an und normalisiert den Pfad', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDocumentFolder(deps, ctx, { path: 'Behoerden' });
    const created = await createDocumentFolder(deps, ctx, { path: '/Behoerden/Finanzamt/' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.path).toBe('Behoerden/Finanzamt');
    const entry = auditEntry(deps, 'dms.folder.create');
    // Im Protokoll steht der normalisierte Pfad, nicht die Eingabe.
    expect(entry).toMatchObject({ entityType: 'documentFolder', entityId: 'Behoerden/Finanzamt' });
    expect(JSON.parse(entry.after!)).toEqual({ path: 'Behoerden/Finanzamt' });
  });

  it('listet Ordner auf', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDocumentFolder(deps, ctx, { path: 'behoerden' });
    await createDocumentFolder(deps, ctx, { path: 'vertraege' });
    const list = await listDocumentFolders(deps, ctx);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.map((f) => f.path)).toEqual(['behoerden', 'vertraege']);
  });

  it('löscht einen Ordner nur, wenn er leer ist', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDocumentFolder(deps, ctx, { path: 'behoerden' });
    const received = await receiveDocument(deps, ctx, {
      filename: 'x.pdf',
      bytes: pdfBytes(),
      typeKey: 'authority',
      subject: 'X',
      documentDate: '2026-03-14',
      folder: 'behoerden',
    });
    if (!received.ok) throw new Error('setup');
    const blocked = await deleteDocumentFolder(deps, ctx, { path: 'behoerden' });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.type).toBe('conflict');

    // Ordner ohne Inhalt lässt sich löschen
    await createDocumentFolder(deps, ctx, { path: 'leer' });
    const deleted = await deleteDocumentFolder(deps, ctx, { path: 'leer' });
    expect(deleted.ok).toBe(true);
    expect(auditActions(deps)).toContain('dms.folder.delete');
  });

  it('verlangt dms.manage', async () => {
    const { deps } = setupWithTypes();
    const denied = await createDocumentFolder(
      deps,
      ctxWith(ALL_DMS.filter((p) => p !== 'dms.manage')),
      { path: 'x' },
    );
    expect(denied.ok).toBe(false);
  });
});

describe('moveDocument', () => {
  it('holt ein Dokument aus dem Eingangskorb', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDocumentFolder(deps, ctx, { path: 'behoerden' });
    const received = await receiveDocument(deps, ctx, {
      filename: 'x.pdf',
      bytes: pdfBytes(),
      typeKey: 'authority',
      subject: 'X',
      documentDate: '2026-03-14',
    });
    if (!received.ok) throw new Error('setup');
    const moved = await moveDocument(deps, ctx, { id: received.value.id, folder: 'behoerden' });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.folder).toBe('behoerden');
    expect(auditActions(deps)).toContain('dms.move');
  });

  it('lehnt einen unbekannten Ordner ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const received = await receiveDocument(deps, ctx, {
      filename: 'x.pdf',
      bytes: pdfBytes(),
      typeKey: 'authority',
      subject: 'X',
      documentDate: '2026-03-14',
    });
    if (!received.ok) throw new Error('setup');
    const result = await moveDocument(deps, ctx, { id: received.value.id, folder: 'gibtsnicht' });
    expect(result.ok).toBe(false);
  });
});

async function file(deps: Deps, ctx: CallContext, folder: string, typeKey = 'authority', subject = 'X') {
  const r = await receiveDocument(deps, ctx, { filename: 'x.pdf', bytes: pdfBytes(), typeKey, subject, documentDate: '2026-03-14', folder });
  if (!r.ok) throw new Error('setup');
  return r.value;
}

async function folders(deps: Deps, ctx: CallContext, paths: string[]) {
  for (const path of paths) {
    const r = await createDocumentFolder(deps, ctx, { path });
    if (!r.ok) throw new Error(`setup ${path}`);
  }
}

const folderPaths = (deps: Deps) => deps.db.select().from(documentFolders).all().map((f) => f.path).sort();

describe('Elternordner beim Anlegen', () => {
  it('lehnt einen Unterordner ohne vorhandenen Elternordner ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const r = await createDocumentFolder(deps, ctx, { path: 'neu/unter' });
    expect(r).toMatchObject({ ok: false, error: { type: 'conflict', code: 'folderParentMissing', messageKey: 'errors.folder.parentMissing', params: { name: 'neu' } } });
    await folders(deps, ctx, ['neu']);
    expect((await createDocumentFolder(deps, ctx, { path: 'neu/unter' })).ok).toBe(true);
  });
});

describe('deleteDocumentFolder und Nachbarn', () => {
  it('löscht vertraege trotz vertraege_alt/x und vertraege%x/y (kein echtes Kind)', async () => {
    const { deps, ctx } = setupWithTypes();
    // Elternprüfung greift nur beim Anlegen; Nachbarn direkt eintragen.
    await folders(deps, ctx, ['vertraege', 'vertraege_alt', 'vertraege%x']);
    await folders(deps, ctx, ['vertraege_alt/x', 'vertraege%x/y']);
    expect((await deleteDocumentFolder(deps, ctx, { path: 'vertraege' })).ok).toBe(true);
  });

  it('behandelt behoerden_alt und behoerden%x nicht als Teil von behoerden', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['behoerden', 'behoerden_alt', 'behoerden%x', 'archiv']);
    await file(deps, ctx, 'behoerden_alt', 'authority', 'Alt');
    await file(deps, ctx, 'behoerden%x', 'authority', 'Prozent');
    const moved = await moveDocumentFolder(deps, ctx, { from: 'behoerden', to: 'archiv/behoerden' });
    expect(moved).toMatchObject({ ok: true, value: { folders: 1, documents: 0 } });
    expect(folderPaths(deps)).toEqual(['archiv', 'archiv/behoerden', 'behoerden%x', 'behoerden_alt']);
    expect(deps.db.select().from(documents).all().map((d) => d.folder).sort()).toEqual(['behoerden%x', 'behoerden_alt']);
  });
});

describe('moveDocumentFolder', () => {
  async function tree() {
    const s = setupWithTypes();
    await folders(s.deps, s.ctx, ['archiv', 'behoerden', 'behoerden/finanzamt']);
    const doc = await file(s.deps, s.ctx, 'behoerden/finanzamt');
    const type = await createDocumentType(s.deps, s.ctx, { key: 'steuer', label: 'Steuer', prefix: 'STU', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: 'behoerden/finanzamt' });
    if (!type.ok) throw new Error('setup type');
    const rule = await createDocumentRule(s.deps, s.ctx, { matchField: 'filename', matchContains: 'Finanzamt', thenFolder: 'behoerden/finanzamt' });
    if (!rule.ok) throw new Error(`setup rule ${JSON.stringify(rule.error)}`);
    return { ...s, doc };
  }

  it('verschiebt den Teilbaum samt Dokumenten, Arten und Regeln und schreibt einen Audit-Eintrag', async () => {
    const { deps, ctx, doc } = await tree();
    const r = await moveDocumentFolder(deps, ctx, { from: 'behoerden', to: 'archiv/behoerden' });
    expect(r).toMatchObject({ ok: true, value: { from: 'behoerden', to: 'archiv/behoerden', folders: 2, documents: 1, types: 1, rules: 1 } });
    expect(folderPaths(deps)).toEqual(['archiv', 'archiv/behoerden', 'archiv/behoerden/finanzamt']);
    expect(deps.db.select().from(documents).where(eq(documents.id, doc.id)).get()!.folder).toBe('archiv/behoerden/finanzamt');
    expect(deps.db.select().from(documentTypes).where(eq(documentTypes.key, 'steuer')).get()!.defaultFolder).toBe('archiv/behoerden/finanzamt');
    expect(deps.db.select().from(documentRules).all().map((x) => x.thenFolder)).toEqual(['archiv/behoerden/finanzamt']);
    const entry = auditEntry(deps, 'dms.folder.move');
    expect(JSON.parse(entry.before!)).toEqual({ path: 'behoerden' });
    expect(JSON.parse(entry.after!)).toEqual({ path: 'archiv/behoerden', folders: 2, documents: 1, types: 1, rules: 1 });
  });

  it('verlangt dms.manage', async () => {
    const { deps } = await tree();
    const denied = await moveDocumentFolder(deps, ctxWith(ALL_DMS.filter((p) => p !== 'dms.manage')), { from: 'behoerden', to: 'archiv/behoerden' });
    expect(denied).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('weist unzulässige Ziele ab', async () => {
    const { deps, ctx } = await tree();
    const code = async (from: string, to: string) => {
      const r = await moveDocumentFolder(deps, ctx, { from, to });
      return r.ok ? 'ok' : (r.error.type === 'conflict' ? r.error.code : r.error.type);
    };
    expect(await code('behoerden', 'behoerden/finanzamt/neu')).toBe('folderInsideItself');
    expect(await code('behoerden', 'archiv')).toBe('folderExists');
    expect(await code('behoerden', 'fehlt/behoerden')).toBe('folderParentMissing');
    expect(await code('unbekannt', 'archiv/x')).toBe('notFound');
  });

  it('verschiebt auch, wenn ein Dokument einer geschützten Art, die der Handelnde nicht lesen kann, im Teilbaum liegt', async () => {
    const { deps, all, viewer, secretId } = await setupWithArea();
    await folders(deps, all, ['archiv', 'sachen']);
    const m = await deps.db.update(documents).set({ folder: 'sachen' }).where(eq(documents.id, secretId)).run();
    expect(m.changes).toBe(1);
    const r = await moveDocumentFolder(deps, viewer, { from: 'sachen', to: 'archiv/sachen' });
    expect(r).toMatchObject({ ok: true, value: { documents: 1 } });
    expect(deps.db.select().from(documents).where(eq(documents.id, secretId)).get()!.folder).toBe('archiv/sachen');
  });

  it('lässt behoerden_alt unberührt', async () => {
    const { deps, ctx } = await tree();
    await folders(deps, ctx, ['behoerden_alt']);
    const alt = await file(deps, ctx, 'behoerden_alt', 'authority', 'Alt');
    await moveDocumentFolder(deps, ctx, { from: 'behoerden', to: 'archiv/behoerden' });
    expect(deps.db.select().from(documents).where(eq(documents.id, alt.id)).get()!.folder).toBe('behoerden_alt');
    expect(folderPaths(deps)).toContain('behoerden_alt');
  });
});

describe('listDocumentFolders: count', () => {
  it('zählt direkt je Ordner', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['a', 'a/b']);
    await file(deps, ctx, 'a');
    await file(deps, ctx, 'a');
    await file(deps, ctx, 'a/b');
    const list = await listDocumentFolders(deps, ctx);
    if (!list.ok) throw new Error('list');
    expect(list.value.map((f) => [f.path, f.count])).toEqual([['a', 2], ['a/b', 1]]);
  });

  it('zählt leere Ordner mit 0', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['leer']);
    const list = await listDocumentFolders(deps, ctx);
    if (!list.ok) throw new Error('list');
    expect(list.value.map((f) => [f.path, f.count])).toEqual([['leer', 0]]);
  });

  it('zählt mit Bereichsrecht nur Lesbares', async () => {
    const { deps, all, auditor, viewer } = await setupWithArea();
    await folders(deps, all, ['g']);
    await file(deps, all, 'g', 'secret', 'Geheim');
    await file(deps, all, 'g', 'authority', 'Offen');
    const asViewer = await listDocumentFolders(deps, viewer);
    if (!asViewer.ok) throw new Error('viewer');
    expect(asViewer.value.find((f) => f.path === 'g')!.count).toBe(1);
    const asAuditor = await listDocumentFolders(deps, auditor);
    if (!asAuditor.ok) throw new Error('auditor');
    expect(asAuditor.value.find((f) => f.path === 'g')!.count).toBe(1);
  });
});

describe('erwarteter Ort beim Verschieben', () => {
  const conflictCode = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : (r.error as { type: string; code?: string }));

  it('moveDocument mit falschem expectedFolder: movedInBetween, nichts geändert', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['vertraege', 'protokolle', 'behoerden']);
    const doc = await file(deps, ctx, 'protokolle');
    const r = await moveDocument(deps, ctx, { id: doc.id, folder: 'behoerden', expectedFolder: 'vertraege' });
    expect(conflictCode(r)).toMatchObject({ type: 'conflict', code: 'movedInBetween' });
    expect(deps.db.select().from(documents).where(eq(documents.id, doc.id)).get()!.folder).toBe('protokolle');
    expect(auditActions(deps)).not.toContain('dms.move');
  });

  it('moveDocuments: eines liegt schon im Ziel, wird übersprungen und nicht protokolliert', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['behoerden', 'vertraege']);
    const a = await file(deps, ctx, 'vertraege', 'authority', 'A');
    const b = await file(deps, ctx, 'vertraege', 'authority', 'B');
    const c = await file(deps, ctx, 'behoerden', 'authority', 'C');
    const r = await moveDocuments(deps, ctx, { moves: [a, b, c].map((d) => ({ id: d.id, folder: 'behoerden' })) });
    expect(r.ok && r.value).toEqual({ moved: [a.id, b.id], skipped: [c.id] });
    expect(auditActions(deps).filter((x) => x === 'dms.move')).toHaveLength(2);
  });

  it('moveDocuments: alles übersprungen ist ok mit moved []', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['behoerden']);
    const c = await file(deps, ctx, 'behoerden');
    const r = await moveDocuments(deps, ctx, { moves: [{ id: c.id, folder: 'behoerden' }] });
    expect(r.ok && r.value).toEqual({ moved: [], skipped: [c.id] });
  });

  it('moveDocuments: ein nicht lesbares Dokument stoppt alles', async () => {
    const { deps, all, viewer, secretId, openId } = await setupWithArea();
    await folders(deps, all, ['offen']);
    await moveDocument(deps, all, { id: openId, folder: 'offen' });
    const auditBefore = auditActions(deps).filter((x) => x === 'dms.move').length;
    const r = await moveDocuments(deps, viewer, { moves: [{ id: openId, folder: null }, { id: secretId, folder: null }] });
    expect(r.ok ? 'ok' : r.error).toEqual({ type: 'forbidden', permission: 'probe.read' });
    expect(deps.db.select().from(documents).where(eq(documents.id, openId)).get()!.folder).toBe('offen');
    expect(auditActions(deps).filter((x) => x === 'dms.move')).toHaveLength(auditBefore);
  });

  it('moveDocuments als Rückgängig stellt beide Ursprünge her', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['vertraege', 'behoerden']);
    const a = await file(deps, ctx, 'behoerden', 'authority', 'A');
    const b = await file(deps, ctx, 'behoerden', 'authority', 'B');
    const r = await moveDocuments(deps, ctx, { moves: [{ id: a.id, folder: 'vertraege', expectedFolder: 'behoerden' }, { id: b.id, folder: null, expectedFolder: 'behoerden' }] });
    expect(r.ok && r.value).toEqual({ moved: [a.id, b.id], skipped: [] });
    const rows = (id: string) => deps.db.select().from(documents).where(eq(documents.id, id)).get()!.folder;
    expect([rows(a.id), rows(b.id)]).toEqual(['vertraege', null]);
  });

  it('moveDocuments als Rückgängig: inzwischen woanders → movedInBetween, auch a bleibt', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['vertraege', 'behoerden', 'protokolle']);
    const a = await file(deps, ctx, 'behoerden', 'authority', 'A');
    const b = await file(deps, ctx, 'protokolle', 'authority', 'B');
    const r = await moveDocuments(deps, ctx, { moves: [{ id: a.id, folder: 'vertraege', expectedFolder: 'behoerden' }, { id: b.id, folder: null, expectedFolder: 'behoerden' }] });
    expect(conflictCode(r)).toMatchObject({ type: 'conflict', code: 'movedInBetween' });
    expect(deps.db.select().from(documents).where(eq(documents.id, a.id)).get()!.folder).toBe('behoerden');
  });
});

describe('Nachbesserungen nach der Abschlussprüfung', () => {
  it('Ordner mit Emoji und Kind ist nicht leer', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['🐶x', '🐶x/y']);
    const r = await deleteDocumentFolder(deps, ctx, { path: '🐶x' });
    expect(r).toMatchObject({ ok: false, error: { type: 'conflict', code: 'folderNotEmpty' } });
  });

  it('doppelte IDs in moveDocuments werden abgelehnt', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['a', 'b']);
    const d = await file(deps, ctx, 'a');
    const r = await moveDocuments(deps, ctx, { moves: [{ id: d.id, folder: 'b' }, { id: d.id, folder: null }] });
    expect(r).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'moves', message: 'duplicateIds' }] } });
    expect(deps.db.select().from(documents).where(eq(documents.id, d.id)).get()!.folder).toBe('a');
  });

  it('Ordnerzug lässt updatedAt der Dokumente unverändert', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['archiv', 'a', 'a/b']);
    const d = await file(deps, ctx, 'a/b');
    const before = deps.db.select().from(documents).where(eq(documents.id, d.id)).get()!.updatedAt;
    deps.clock.advance(3_600_000);
    const r = await moveDocumentFolder(deps, ctx, { from: 'a', to: 'archiv/a' });
    expect(r).toMatchObject({ ok: true, value: { documents: 1 } });
    expect(deps.db.select().from(documents).where(eq(documents.id, d.id)).get()!.updatedAt).toBe(before);
  });

  it('moveDocumentFolder: fehlender Elternordner ist lokalisiert', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['a']);
    const r = await moveDocumentFolder(deps, ctx, { from: 'a', to: 'fehlt/a' });
    expect(r).toMatchObject({ ok: false, error: { code: 'folderParentMissing', messageKey: 'errors.folder.parentMissing', params: { name: 'fehlt' } } });
  });

  it('moveDocumentFolder lehnt ein Ziel ab, dessen Unterpfad schon existiert', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['a', 'a/b', 'x']);
    deps.db.insert(documentFolders).values({ path: 'x/a/b', createdAt: '2026-09-05T08:00:00.000Z' }).run();
    const r = await moveDocumentFolder(deps, ctx, { from: 'a', to: 'x/a' });
    expect(r).toMatchObject({ ok: false, error: { type: 'conflict', code: 'folderExists' } });
  });

  it('expectedFolder wird normalisiert; ungültig ist ein Feldfehler', async () => {
    const { deps, ctx } = setupWithTypes();
    await folders(deps, ctx, ['behoerden', 'vertraege']);
    const d = await file(deps, ctx, 'behoerden');
    const bad = await moveDocument(deps, ctx, { id: d.id, folder: 'vertraege', expectedFolder: 'a/../b' });
    expect(bad).toMatchObject({ ok: false, error: { type: 'validation', issues: [{ path: 'expectedFolder', message: 'invalidFolderPath' }] } });
    const r = await moveDocument(deps, ctx, { id: d.id, folder: 'vertraege', expectedFolder: 'behoerden/' });
    expect(r.ok).toBe(true);
  });
});

describe('listDocuments: includeSubfolders', () => {
  async function tree(deps: Deps, ctx: CallContext) {
    await folders(deps, ctx, ['behoerden', 'behoerden/finanzamt', 'behoerden/amtsgericht', 'behoerden/amtsgericht/vereinsregister-2026', 'behoerden_alt', 'behoerden%x']);
    await file(deps, ctx, 'behoerden', 'authority', 'Direkt');
    await file(deps, ctx, 'behoerden/finanzamt', 'authority', 'Finanzamt');
    await file(deps, ctx, 'behoerden/amtsgericht/vereinsregister-2026', 'authority', 'Register');
    await file(deps, ctx, 'behoerden_alt', 'authority', 'Alt');
    await file(deps, ctx, 'behoerden%x', 'authority', 'Prozent');
  }
  const subjects = (r: Awaited<ReturnType<typeof listDocuments>>) => {
    if (!r.ok) throw new Error('list');
    return r.value.documents.map((d) => d.subject).sort();
  };

  it('liefert mit Schalter den ganzen Teilbaum, ohne Nachbarn mit _ oder %', async () => {
    const { deps, ctx } = setupWithTypes();
    await tree(deps, ctx);
    const res = await listDocuments(deps, ctx, { folder: 'behoerden', includeSubfolders: true });
    expect(subjects(res)).toEqual(['Direkt', 'Finanzamt', 'Register']);
    expect(res.ok && res.value.total).toBe(3);
  });

  it('ohne Schalter bleibt es exakt der Ordner', async () => {
    const { deps, ctx } = setupWithTypes();
    await tree(deps, ctx);
    expect(subjects(await listDocuments(deps, ctx, { folder: 'behoerden' }))).toEqual(['Direkt']);
    expect(subjects(await listDocuments(deps, ctx, { folder: 'behoerden', includeSubfolders: false }))).toEqual(['Direkt']);
  });

  it('mit Bereichsrecht nur Lesbares aus dem Teilbaum', async () => {
    const { deps, all, viewer, auditor } = await setupWithArea();
    await folders(deps, all, ['g', 'g/tief']);
    await file(deps, all, 'g', 'authority', 'Offen');
    await file(deps, all, 'g/tief', 'secret', 'Geheim');
    expect(subjects(await listDocuments(deps, viewer, { folder: 'g', includeSubfolders: true }))).toEqual(['Offen']);
    expect(subjects(await listDocuments(deps, auditor, { folder: 'g', includeSubfolders: true }))).toEqual(['Geheim']);
  });
});
