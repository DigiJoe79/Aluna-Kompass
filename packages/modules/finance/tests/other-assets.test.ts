import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { endOtherAsset, listOtherAssets, otherAssetsAtInternal, revalueOtherAsset, saveOtherAsset } from '../src/reporting/other-assets';
import { ledgerFixture } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const boxes = { kind: 'asset', label: 'Transportboxen', valueCents: 30000, basis: 'Rechnung', recordedFrom: '2026-03-01' } as const;

describe('sonstige Vermögensgegenstände und Verpflichtungen (Rechenschaft A2 Task 1)', () => {
  it('creates, edits and validates an entry', async () => {
    const f = await ledgerFixture();
    const created = unwrap(await saveOtherAsset(f.deps, f.ctx, boxes));
    expect(created).toMatchObject({ kind: 'asset', label: 'Transportboxen', valueCents: 30000, basis: 'Rechnung', recordedFrom: '2026-03-01', recordedUntil: null, endReason: null, replacedById: null, replacesId: null, documentId: null });
    const edited = unwrap(await saveOtherAsset(f.deps, f.ctx, { ...boxes, id: created.id, valueCents: 28000 }));
    expect(edited).toMatchObject({ id: created.id, valueCents: 28000 });
    expect(err(await saveOtherAsset(f.deps, f.ctx, { ...boxes, id: created.id, expectedVersion: 'stale' }))).toMatchObject({ code: 'staleVersion' });

    for (const bad of [{ label: '' }, { label: 'x'.repeat(121) }, { valueCents: -1 }, { valueCents: 1.5 }, { basis: '' }, { basis: 'x'.repeat(501) }, { recordedFrom: '01.03.2026' }, { kind: 'loan' }]) {
      expect(err(await saveOtherAsset(f.deps, f.ctx, { ...boxes, ...bad }))).toMatchObject({ type: 'validation' });
    }
  });

  it('ends an entry with an optional reason that never reaches the log', async () => {
    const f = await ledgerFixture();
    const created = unwrap(await saveOtherAsset(f.deps, f.ctx, boxes));
    expect(err(await endOtherAsset(f.deps, f.ctx, { id: created.id, until: '2026-02-28' }))).toMatchObject({ type: 'validation' });
    expect(err(await endOtherAsset(f.deps, f.ctx, { id: created.id, until: '2026-06-30', reason: 'x'.repeat(501) }))).toMatchObject({ type: 'validation' });
    const ended = unwrap(await endOtherAsset(f.deps, f.ctx, { id: created.id, until: '2026-06-30', reason: 'Verkauft an den Nachbarverein' }));
    expect(ended).toMatchObject({ recordedUntil: '2026-06-30', endReason: 'Verkauft an den Nachbarverein' });
    // Beendet ist beendet: kein zweites Ende, keine Bearbeitung.
    expect(err(await endOtherAsset(f.deps, f.ctx, { id: created.id, until: '2026-07-31' }))).toMatchObject({ code: 'otherAssetEnded' });
    expect(err(await saveOtherAsset(f.deps, f.ctx, { ...boxes, id: created.id }))).toMatchObject({ code: 'otherAssetEnded' });

    const log = f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action.startsWith('finance.otherAsset.'));
    expect(log.map((a) => a.action)).toEqual(['finance.otherAsset.save', 'finance.otherAsset.end']);
    expect(log.every((a) => JSON.parse(a.params ?? '{}').kind === 'asset')).toBe(true);
    const text = JSON.stringify(log);
    expect(text).not.toContain('Transportboxen');
    expect(text).not.toContain('Nachbarverein');
    expect(text).not.toContain('Rechnung');
  });

  it('revalues from a day: the old entry ends the day before, a successor carries on', async () => {
    const f = await ledgerFixture();
    const created = unwrap(await saveOtherAsset(f.deps, f.ctx, boxes));
    expect(err(await revalueOtherAsset(f.deps, f.ctx, { id: created.id, from: '2026-03-01', valueCents: 20000, basis: 'Schätzung' }))).toMatchObject({ type: 'validation' });
    const { ended, successor } = unwrap(await revalueOtherAsset(f.deps, f.ctx, { id: created.id, from: '2026-07-01', valueCents: 20000, basis: 'Schätzung' }));
    expect(ended).toMatchObject({ id: created.id, recordedUntil: '2026-06-30', replacedById: successor.id });
    expect(successor).toMatchObject({ kind: 'asset', label: 'Transportboxen', valueCents: 20000, basis: 'Schätzung', recordedFrom: '2026-07-01', recordedUntil: null, replacesId: created.id });
    // Jeder Tag hat genau einen gültigen Eintrag — kein Loch am Vortag.
    expect(otherAssetsAtInternal(f.deps.db, '2026-06-30').map((a) => a.valueCents)).toEqual([30000]);
    expect(otherAssetsAtInternal(f.deps.db, '2026-07-01').map((a) => a.valueCents)).toEqual([20000]);
    expect(err(await revalueOtherAsset(f.deps, f.ctx, { id: created.id, from: '2026-08-01', valueCents: 1, basis: 'x' }))).toMatchObject({ code: 'otherAssetEnded' });
    expect(f.deps.db.select().from(schema.auditLog).all().some((a) => a.action === 'finance.otherAsset.revalue')).toBe(true);
  });

  it('reads the entries valid on a day', async () => {
    const f = await ledgerFixture();
    const before = unwrap(await saveOtherAsset(f.deps, f.ctx, { ...boxes, recordedFrom: '2025-05-01' }));
    const deposit = unwrap(await saveOtherAsset(f.deps, f.ctx, { kind: 'liability', label: 'Kaution Lagerraum', valueCents: 50000, basis: 'Vertrag', recordedFrom: '2026-01-15' }));
    const later = unwrap(await saveOtherAsset(f.deps, f.ctx, { ...boxes, label: 'Zelt', recordedFrom: '2027-01-01' }));
    unwrap(await endOtherAsset(f.deps, f.ctx, { id: before.id, until: '2026-12-30' }));
    expect(otherAssetsAtInternal(f.deps.db, '2026-12-31').map((a) => a.id)).toEqual([deposit.id]);
    expect(otherAssetsAtInternal(f.deps.db, '2026-12-30').map((a) => a.id).sort()).toEqual([before.id, deposit.id].sort());

    expect(unwrap(await listOtherAssets(f.deps, f.ctx, { date: '2026-12-31' })).items.map((a) => a.id)).toEqual([deposit.id]);
    expect(unwrap(await listOtherAssets(f.deps, f.ctx, { ended: true })).items.map((a) => a.id)).toEqual([before.id]);
    expect(unwrap(await listOtherAssets(f.deps, f.ctx, {})).items).toHaveLength(3);
    expect(later.recordedFrom).toBe('2027-01-01');
  });

  it('needs finance.entriesWrite to write and finance.overview to read', async () => {
    const f = await ledgerFixture();
    const reader = ctxWith(['finance.overview'], f.userId);
    expect(err(await saveOtherAsset(f.deps, reader, boxes))).toMatchObject({ type: 'forbidden' });
    const created = unwrap(await saveOtherAsset(f.deps, f.ctx, boxes));
    expect(err(await endOtherAsset(f.deps, reader, { id: created.id, until: '2026-06-30' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await revalueOtherAsset(f.deps, reader, { id: created.id, from: '2026-07-01', valueCents: 1, basis: 'x' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await listOtherAssets(f.deps, reader, {}))).toBe('ok');
    expect(err(await listOtherAssets(f.deps, ctxWith([], f.userId), {}))).toMatchObject({ type: 'forbidden' });
  });
});
