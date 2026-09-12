import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { receiveDocument } from '../src/incoming';
import { previewNextNumber } from '../src/service';
import { pdfBytes, setupWithTypes } from './helpers';

/**
 * Die Nummer, die ein Dokument beim Ablegen bekommt, vorher zeigen zu können,
 * nimmt dem Ablegen die Überraschung. Gezogen wird sie erst beim Ablegen —
 * angesehen wird hier also eine Vorschau, kein Anspruch.
 */
describe('previewNextNumber', () => {
  it('nennt die Nummer, die als Nächstes vergeben würde', async () => {
    const { deps, ctx } = setupWithTypes();
    const year = deps.clock.now().getUTCFullYear();

    const first = await previewNextNumber(deps, ctx, { typeKey: 'authority' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.number).toBe(`BEH-${year}-001`);

    const received = await receiveDocument(deps, ctx, {
      filename: 'x.pdf',
      bytes: pdfBytes(),
      typeKey: 'authority',
      subject: 'X',
      documentDate: '2026-03-14',
    });
    if (!received.ok) throw new Error('setup');

    // Und sie zählt weiter, sobald eine vergeben ist.
    const second = await previewNextNumber(deps, ctx, { typeKey: 'authority' });
    if (!second.ok) return;
    expect(second.value.number).toBe(`BEH-${year}-002`);
  });

  it('verbraucht nichts: zweimal gefragt, zweimal dieselbe Nummer', async () => {
    const { deps, ctx } = setupWithTypes();
    const once = await previewNextNumber(deps, ctx, { typeKey: 'authority' });
    const twice = await previewNextNumber(deps, ctx, { typeKey: 'authority' });
    if (!once.ok || !twice.ok) throw new Error('setup');
    expect(twice.value.number).toBe(once.value.number);
  });

  it('meldet eine unbekannte Dokumentart', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await previewNextNumber(deps, ctx, { typeKey: 'gibt-es-nicht' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('notFound');
  });

  it('verlangt eine Dokumentart', async () => {
    const { deps, ctx } = setupWithTypes();
    const result = await previewNextNumber(deps, ctx, { typeKey: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe('validation');
  });

  it('verlangt dms.view', async () => {
    const { deps } = setupWithTypes();
    const denied = await previewNextNumber(deps, ctxWith([]), { typeKey: 'authority' });
    expect(denied.ok).toBe(false);
    if (denied.ok) return;
    expect(denied.error.type).toBe('forbidden');
  });
});
