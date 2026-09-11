import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { receiveDocument, receiveDocumentSchema, receiveSchema } from '../src/incoming';
import { ALL_DMS, auditActions, pdfBytes, setupWithTypes } from './helpers';

describe('receiveDocument', () => {
  it('legt die Datei ab und schreibt sofort fest', async () => {
    const { deps, ctx } = setupWithTypes();
    const received = await receiveDocument(deps, ctx, {
      filename: 'bescheid.pdf',
      bytes: pdfBytes(),
      typeKey: 'authority',
      subject: 'Freistellungsbescheid',
      documentDate: '2026-03-14',
    });
    expect(received.ok).toBe(true);
    if (!received.ok) return;
    expect(received.value.phase).toBe('issued');
    expect(received.value.direction).toBe('incoming');
    expect(received.value.sourceKind).toBe('uploaded');
    expect(received.value.number).toMatch(/^BEH-\d{4}-\d{3}$/);
    expect(received.value.fileName).not.toBeNull();
    expect(received.value.draftBody).toBeNull();
    expect(received.value.templateKey).toBeNull();
  });

  it('landet ohne Ordner im Eingangskorb', async () => {
    const { deps, ctx } = setupWithTypes();
    const received = await receiveDocument(deps, ctx, {
      filename: 'x.pdf',
      bytes: pdfBytes(),
      typeKey: 'authority',
      subject: 'X',
      documentDate: '2026-03-14',
    });
    if (!received.ok) return;
    expect(received.value.folder).toBeNull();
  });

  it('nimmt das Datum auf dem Dokument, nicht das von heute', async () => {
    const { deps, ctx } = setupWithTypes();
    const received = await receiveDocument(deps, ctx, {
      filename: 'x.pdf',
      bytes: pdfBytes(),
      typeKey: 'authority',
      subject: 'X',
      documentDate: '2024-01-02',
    });
    if (!received.ok) return;
    expect(received.value.documentDate).toBe('2024-01-02');
  });

  it('verlangt ein gültiges Datum', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await receiveDocument(deps, ctx, {
      filename: 'x.pdf',
      bytes: pdfBytes(),
      typeKey: 'authority',
      subject: 'X',
      documentDate: '14.03.2026',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
  });

  it('verlangt dms.create', async () => {
    const { deps } = setupWithTypes();
    const denied = await receiveDocument(
      deps,
      ctxWith(ALL_DMS.filter((p) => p !== 'dms.create')),
      { filename: 'x.pdf', bytes: pdfBytes(), typeKey: 'authority', subject: 'X', documentDate: '2026-03-14' },
    );
    expect(denied.ok).toBe(false);
  });

  it('schreibt einen Eintrag ins Änderungsprotokoll', async () => {
    const { deps, ctx } = setupWithTypes();
    await receiveDocument(deps, ctx, {
      filename: 'x.pdf',
      bytes: pdfBytes(),
      typeKey: 'authority',
      subject: 'X',
      documentDate: '2026-03-14',
    });
    expect(auditActions(deps)).toContain('dms.receive');
  });
});

describe('Eingangsschemata', () => {
  /**
   * Zwei Schemata, ein Feldbestand: Der Service nimmt zusätzlich rohe `bytes`
   * aus der Oberfläche, MCP darf nur JSON-Fähiges zeigen. Läuft der Feldbestand
   * auseinander, nimmt ein Werkzeug etwas an, das der Service verwirft.
   */
  const keys = (schema: { def: { shape: Record<string, unknown> } }) => Object.keys(schema.def.shape);

  it('zeigt über MCP dieselben Felder wie der Service, nur ohne bytes', () => {
    expect(keys(receiveSchema).sort()).toEqual(keys(receiveDocumentSchema).filter((k) => k !== 'bytes').sort());
  });

  it('verlangt über MCP genau eine Quelle', () => {
    const base = { filename: 'a.pdf', typeKey: 'authority', subject: 'A', documentDate: '2026-03-14' };
    expect(receiveSchema.safeParse({ ...base }).success).toBe(false);
    expect(receiveSchema.safeParse({ ...base, contentBase64: 'x', assetId: 'y' }).success).toBe(false);
    expect(receiveSchema.safeParse({ ...base, contentBase64: 'x' }).success).toBe(true);
  });

  it('begrenzt den Dateinamen auf beiden Wegen gleich', () => {
    const long = { filename: 'a'.repeat(256), typeKey: 'authority', subject: 'A', documentDate: '2026-03-14', contentBase64: 'x' };
    expect(receiveSchema.safeParse(long).success).toBe(false);
    expect(receiveDocumentSchema.safeParse(long).success).toBe(false);
  });
});
