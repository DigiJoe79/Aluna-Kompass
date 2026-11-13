import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { amendMandate } from '../src/direct-debit/mandates';
import { buildDirectDebitFile, cancelDirectDebitRun, createDirectDebitRun, directDebitFileStream, getDirectDebitRun } from '../src/direct-debit/runs';
import { directDebitFixture, IBANS } from './direct-debit-fixture';

// Plan R1 Task 4 (N2): die Datei in zwei Tabs zugleich erzeugen. Uhr: Dienstag, 20.10.2026.
async function scene() {
  const f = await directDebitFixture();
  const a = await f.payer('Beispiel');
  await f.fee(a, 1200, '2026-10-30');
  f.announce(a.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }]);
  const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
  return { ...f, a, run };
}

describe('buildDirectDebitFile twice at once (N2)', () => {
  it('the loser does not delete the files of the winner', async () => {
    const f = await scene();
    const results = await Promise.all([buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }), buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, error: { code: 'runFileCreated' } });
    expect(unwrap(await getDirectDebitRun(f.deps, f.ctx, { id: f.run.id })).status).toBe('fileCreated');
    const xml = unwrap(await directDebitFileStream(f.deps, f.ctx, { runId: f.run.id, kind: 'xml' }));
    expect(new TextDecoder().decode(xml.bytes)).toContain(unwrap(await getDirectDebitRun(f.deps, f.ctx, { id: f.run.id })).messageId);
    expect(unwrap(await directDebitFileStream(f.deps, f.ctx, { runId: f.run.id, kind: 'csv' })).bytes.length).toBeGreaterThan(0);
  });

  it('cancelling removes the files of the attempt that won', async () => {
    const f = await scene();
    const built = unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id }));
    const keys = [built.fileName!, built.fileName!.replace(/\.xml$/, '.csv')];
    for (const key of keys) expect(await f.deps.files('finance').exists(key)).toBe(true);
    unwrap(await cancelDirectDebitRun(f.deps, f.ctx, { runId: f.run.id }));
    for (const key of keys) expect(await f.deps.files('finance').exists(key)).toBe(false);
  });

  it('an outdated file (M15) rebuilt in two tabs leaves only the files of the winner', async () => {
    const f = await scene();
    const old = unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id })).fileName!;
    unwrap(await amendMandate(f.deps, f.ctx, { mandateId: f.a.mandateId, iban: IBANS[6], validFrom: '2026-10-20' }));
    // Der erste Tab setzt die veraltete Datei zurück, schreibt aber langsam: der zweite überholt ihn und gewinnt.
    const store0 = f.deps.files('finance');
    const slow = { ...f.deps, files: (key: string) => (key === 'finance' ? { ...store0, write: async (name: string, bytes: Uint8Array) => { await new Promise((r) => setTimeout(r, 30)); await store0.write(name, bytes); } } : f.deps.files(key)) };
    const results = await Promise.all([buildDirectDebitFile(slow, f.ctx, { runId: f.run.id }), buildDirectDebitFile(f.deps, f.ctx, { runId: f.run.id })]);
    expect(results.map((r) => r.ok)).toEqual([false, true]);
    const store = f.deps.files('finance');
    for (const key of [old, old.replace(/\.xml$/, '.csv')]) expect(await store.exists(key)).toBe(false);
    const current = unwrap(await getDirectDebitRun(f.deps, f.ctx, { id: f.run.id })).fileName!;
    for (const key of [current, current.replace(/\.xml$/, '.csv')]) expect(await store.exists(key)).toBe(true);
  });
});
