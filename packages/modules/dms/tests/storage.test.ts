import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDraft, fileDocument } from '../src/drafts';
import { receiveDocument } from '../src/incoming';
import { deleteDocument, getDocument } from '../src/service';
import { DOCUMENT_MAX_BYTES } from '../src/storage';
import { pdfBytes, setupWithTypes } from './helpers';

describe('Eigener Dateispeicher der Akte', () => {
  it('legt das PDF im Speicher des Moduls ab, nicht in der Mediathek', async () => {
    const { deps, ctx } = setupWithTypes();
    const received = await receiveDocument(deps, ctx, {
      filename: 'bescheid.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'Bescheid', documentDate: '2026-03-14',
    });
    expect(received.ok).toBe(true);
    if (!received.ok) return;

    expect(received.value.fileName).toBeTruthy();
    expect(await deps.files('dms').exists(received.value.fileName!)).toBe(true);
    // Die Mediathek weiß nichts davon.
    expect(await deps.media.exists(received.value.fileName!)).toBe(false);
  });

  it('hält die Prüfsumme am Dokument fest', async () => {
    const { deps, ctx } = setupWithTypes();
    const bytes = pdfBytes();
    const received = await receiveDocument(deps, ctx, {
      filename: 'b.pdf', bytes, typeKey: 'authority', subject: 'B', documentDate: '2026-03-14',
    });
    if (!received.ok) return;
    expect(received.value.fileChecksum).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(received.value.fileBytes).toBe(bytes.byteLength);
  });

  it('legt zwei inhaltsgleiche Schreiben als zwei Dateien ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const same = { typeKey: 'authority', subject: 'Gleich', documentDate: '2026-03-14' } as const;
    const first = await receiveDocument(deps, ctx, { ...same, filename: 'a.pdf', bytes: pdfBytes() });
    const second = await receiveDocument(deps, ctx, { ...same, filename: 'b.pdf', bytes: pdfBytes() });
    if (!first.ok || !second.ok) throw new Error('setup');
    // Dedupe waere hier schaedlich: zwei Vorgaenge, zwei Dokumente, zwei Dateien.
    expect(second.value.fileName).not.toBe(first.value.fileName);
    expect(await deps.files('dms').exists(first.value.fileName!)).toBe(true);
    expect(await deps.files('dms').exists(second.value.fileName!)).toBe(true);
  });

  it('nimmt nur PDF an', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await receiveDocument(deps, ctx, {
      filename: 'notiz.txt',
      bytes: new TextEncoder().encode('Text, kein PDF.'),
      typeKey: 'authority', subject: 'Notiz', documentDate: '2026-03-14',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
    if (result.error.type !== 'validation') return;
    expect(result.error.issues[0]?.message).toBe('notAPdf');
    expect(result.error.issues[0]?.path).toBe('file');
  });

  it('liefert das festgeschriebene PDF wieder aus', async () => {
    const { deps, ctx } = setupWithTypes();
    const draft = await createDraft(deps, ctx, { typeKey: 'letter', subject: 'Brief', body: 'Text' });
    if (!draft.ok) throw new Error('setup');
    const filed = await fileDocument(deps, ctx, { id: draft.value.id });
    if (!filed.ok) throw new Error('setup');
    const read = await getDocument(deps, ctx, filed.value.id);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.bytes.byteLength).toBeGreaterThan(0);
    expect(read.value.filename).toBe(`${filed.value.number}.pdf`);
  });

  it('nimmt die Datei mit, wenn das Dokument nach Fristablauf geloescht wird', async () => {
    const { deps, ctx } = setupWithTypes();
    const doc = await receiveDocument(deps, ctx, {
      filename: 'alt.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Alt', documentDate: '2005-06-01',
    });
    if (!doc.ok) throw new Error('setup');
    const name = doc.value.fileName!;
    expect((await deleteDocument(deps, ctx, { id: doc.value.id })).ok).toBe(true);
    expect(await deps.files('dms').exists(name)).toBe(false);
  });

  it('loescht ohne ein Medienrecht im Kontext', async () => {
    const { deps, ctx } = setupWithTypes(['dms.view', 'dms.create', 'dms.manage']);
    const doc = await receiveDocument(deps, ctx, {
      filename: 'alt.pdf', bytes: pdfBytes(), typeKey: 'invoice', subject: 'Alt', documentDate: '2005-06-01',
    });
    if (!doc.ok) throw new Error('setup');
    // Der Kontext traegt kein media.upload mehr — die Akte braucht es nicht.
    expect(ctx.permissions.has('media.upload')).toBe(false);
    expect((await deleteDocument(deps, ctx, { id: doc.value.id })).ok).toBe(true);
  });
});

describe('Grenzen des Dateispeichers', () => {
  it('lehnt eine zu grosse Datei ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const huge = new Uint8Array(DOCUMENT_MAX_BYTES + 1);
    huge.set(pdfBytes().subarray(0, 8), 0);
    const result = await receiveDocument(deps, ctx, {
      filename: 'riesig.pdf', bytes: huge, typeKey: 'authority', subject: 'Riesig', documentDate: '2026-03-14',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
    if (result.error.type !== 'validation') return;
    expect(result.error.issues[0]?.message).toBe('fileTooLarge');
  });
});
