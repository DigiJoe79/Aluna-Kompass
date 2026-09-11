import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createDocumentFolder, createDocumentRule } from '../src/catalog';
import { dateFromFilename, suggestClassification } from '../src/classification';
import { receiveDocument } from '../src/incoming';
import { documents } from '../src/schema';
import { ALL_DMS, pdfBytes, setupWithTypes } from './helpers';

describe('dateFromFilename', () => {
  it('erkennt ein ISO-Datum am Anfang', () => {
    expect(dateFromFilename('2026-03-14 Finanzamt.pdf')).toBe('2026-03-14');
  });

  it('erkennt ein deutsches Datum', () => {
    expect(dateFromFilename('Bescheid 14.03.2026.pdf')).toBe('2026-03-14');
  });

  it('gibt null zurück, wenn keins drinsteht', () => {
    expect(dateFromFilename('scan001.pdf')).toBeNull();
  });

  it('erfindet kein Datum aus einer Zahlenkette', () => {
    expect(dateFromFilename('IMG_20260314_120000.jpg')).toBeNull();
  });
});

describe('suggestClassification', () => {
  it('wendet die erste passende Regel an', async () => {
    const { deps, ctx } = setupWithTypes();
    await createDocumentFolder(deps, ctx, { path: 'behoerden' });
    const rule = await createDocumentRule(deps, ctx, {
      matchField: 'filename',
      matchContains: 'Finanzamt',
      thenTypeKey: 'authority',
      thenFolder: 'behoerden',
    });
    if (!rule.ok) throw new Error('setup');
    const suggestion = await suggestClassification(deps, ctx, {
      filename: '2026-03-14 Finanzamt Bescheid.pdf',
    });
    expect(suggestion.ok).toBe(true);
    if (!suggestion.ok) return;
    expect(suggestion.value.typeKey).toBe('authority');
    expect(suggestion.value.folder).toBe('behoerden');
    expect(suggestion.value.documentDate).toBe('2026-03-14');
    expect(suggestion.value.matchedRuleId).toBe(rule.value.id);
    // Woher der Vorschlag kommt, gehört zum Vorschlag: Die Oberfläche soll es
    // am Feld sagen können, ohne die Regeln noch einmal zu lesen.
    expect(suggestion.value.matchedRuleField).toBe('filename');
    expect(suggestion.value.matchedRuleContains).toBe('Finanzamt');
  });

  it('schlägt die zuletzt für diesen Absender benutzte Art vor', async () => {
    const { deps, ctx } = setupWithTypes();
    const earlier = await receiveDocument(deps, ctx, {
      filename: 'alt.pdf',
      bytes: pdfBytes(),
      typeKey: 'invoice',
      subject: 'Alt',
      documentDate: '2026-01-01',
      links: [{ entityType: 'contact', entityId: 'c-9', role: 'sender' }],
    });
    if (!earlier.ok) throw new Error('setup');
    const suggestion = await suggestClassification(deps, ctx, {
      filename: 'neu.pdf',
      senderEntityType: 'contact',
      senderEntityId: 'c-9',
    });
    expect(suggestion.ok).toBe(true);
    if (!suggestion.ok) return;
    expect(suggestion.value.typeKey).toBe('invoice');
  });

  it('legt nichts ab', async () => {
    const { deps, ctx } = setupWithTypes();
    const before = deps.db.select().from(documents).all().length;
    await suggestClassification(deps, ctx, { filename: 'x.pdf' });
    expect(deps.db.select().from(documents).all().length).toBe(before);
  });

  it('verlangt dms.view', async () => {
    const { deps } = setupWithTypes();
    const denied = await suggestClassification(
      deps,
      ctxWith(ALL_DMS.filter((p) => p !== 'dms.view')),
      { filename: 'x.pdf' },
    );
    expect(denied.ok).toBe(false);
  });
});
