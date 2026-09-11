import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { countDocumentsByFolder, createDocumentFolder, deleteDocumentFolder, listDocumentFolders } from '../src/catalog';
import { receiveDocument } from '../src/incoming';
import { moveDocument } from '../src/service';
import { ALL_DMS, auditActions, pdfBytes, setupWithTypes } from './helpers';

describe('folders', () => {
  it('legt einen Ordner an und normalisiert den Pfad', async () => {
    const { deps, ctx } = setupWithTypes();
    const created = await createDocumentFolder(deps, ctx, { path: '/Behoerden/Finanzamt/' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.path).toBe('Behoerden/Finanzamt');
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

  it('zählt, was in jedem Ordner liegt', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDocumentFolder(deps, ctx, { path: 'behoerden' });
    await createDocumentFolder(deps, ctx, { path: 'vertraege' });
    for (const subject of ['Erstes', 'Zweites']) {
      const received = await receiveDocument(deps, ctx, {
        filename: `${subject}.pdf`,
        bytes: pdfBytes(),
        typeKey: 'authority',
        subject,
        documentDate: '2026-03-14',
        folder: 'behoerden',
      });
      if (!received.ok) throw new Error('setup');
    }

    const counts = await countDocumentsByFolder(deps, ctx);
    expect(counts.ok).toBe(true);
    if (!counts.ok) return;
    expect(counts.value['behoerden']).toBe(2);
    // Leere Ordner tauchen nicht auf; die Spalte zeigt dort keine Zahl.
    expect(counts.value['vertraege']).toBeUndefined();
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
