import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { buildDirectDebitFile, cancelDirectDebitRun, createDirectDebitRun, directDebitFileStream, getDirectDebitRun } from '../src/direct-debit/runs';
import { directDebitFixture } from './direct-debit-fixture';

// Plan R1 Task 4 (N2): die Datei in zwei Tabs zugleich erzeugen. Uhr: Dienstag, 20.10.2026.
async function scene() {
  const f = await directDebitFixture();
  const a = await f.payer('Beispiel');
  await f.fee(a, 1200, '2026-10-30');
  f.announce(a.mandateId, [{ dueOn: '2026-10-30', amountCents: 1200 }]);
  const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
  return { ...f, run };
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
});
