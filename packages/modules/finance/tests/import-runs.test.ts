import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createAccount, setAccountActive } from '../src/ledger/accounts';
import { getImportRun, importStatement, listImportRuns } from '../src/import/runs';
import { financeAccounts, financeImportRuns, financeRawTransactions, financeImportCandidates } from '../src/schema';
import { setupFinance } from './helpers';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/camt');
const bytes = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const VEREIN_IBAN = 'DE60999999990201051234';

const code = (r: { ok: boolean; error?: { type: string; code?: string; permission?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

async function importFixture() {
  const { deps, ctx, userId } = setupFinance();
  const account = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: VEREIN_IBAN, isMain: true }));
  const cash = unwrap(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash' }));
  return { deps, ctx, userId, account, cash };
}

describe('importStatement', () => {
  it('imports a statement in one transaction: run, raw transactions, counters, file stored under its checksum', async () => {
    const f = await importFixture();
    const res = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'auszug-maerz.xml', bytes: bytes('einfach-001-02.xml') }));
    expect(res.runs).toHaveLength(1);
    const run = res.runs[0]!;
    expect(run).toMatchObject({ accountId: f.account.id, format: 'camt053', periodFrom: '2026-03-01', periodTo: '2026-03-31', openingCents: 100000, closingCents: 115300, state: 'finished', gap: null, counts: { new: 3, known: 0, held: 0, pendingSkipped: 0 } });

    const raws = f.deps.db.select().from(financeRawTransactions).where(eq(financeRawTransactions.runId, run.id)).all();
    expect(raws).toHaveLength(3);
    expect(raws.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([-3200, -1500, 20000]);

    const runRow = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.id, run.id)).get()!;
    expect(runRow.fileKey).not.toBeNull();
    expect(runRow.fileSha256).toHaveLength(64);
    const stored = await f.deps.files('finance').read(runRow.fileKey!);
    expect(new TextDecoder().decode(stored)).toContain('DE60999999990201051234');
  });

  it('sets the account format to camt053 on the first import and asks for confirmation when the account was csv', async () => {
    const f = await importFixture();
    expect((f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, f.account.id)).get()!).importFormat).toBeNull();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.xml', bytes: bytes('einfach-001-02.xml') }));
    expect((f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, f.account.id)).get()!).importFormat).toBe('camt053');

    const csvAccount = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zweitkonto', kind: 'bank', iban: VEREIN_IBAN, importFormat: 'csv' }));
    const refused = await importStatement(f.deps, f.ctx, { accountId: csvAccount.id, fileName: 'b.xml', bytes: bytes('folgeauszug.xml') });
    expect(code(refused)).toBe('statementFormatChange');

    const confirmed = await importStatement(f.deps, f.ctx, { accountId: csvAccount.id, fileName: 'b.xml', bytes: bytes('folgeauszug.xml'), confirmFormatChange: true });
    expect(code(confirmed)).toBe('ok');
    expect((f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, csvAccount.id)).get()!).importFormat).toBe('camt053');
  });

  it('refuses a statement whose iban is not the account’s, and an account without iban, each naming the remedy', async () => {
    const f = await importFixture();
    const other = unwrap(await createAccount(f.deps, f.ctx, { name: 'Anderes Konto', kind: 'bank', iban: 'DE12999999990000112233' }));
    const mismatch = await importStatement(f.deps, f.ctx, { accountId: other.id, fileName: 'a.xml', bytes: bytes('einfach-001-02.xml') });
    expect(code(mismatch)).toBe('statementIbanMismatch');
    if (!mismatch.ok) expect(mismatch.error).toMatchObject({ message: expect.stringMatching(/IBAN.+Konto/) });

    const withoutIban = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zahlungsdienst', kind: 'paymentService' }));
    const noIban = await importStatement(f.deps, f.ctx, { accountId: withoutIban.id, fileName: 'a.xml', bytes: bytes('einfach-001-02.xml') });
    expect(code(noIban)).toBe('statementIbanMismatch');
  });

  it('refuses the same file twice, but accepts it again after its run was discarded', async () => {
    const f = await importFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.xml', bytes: bytes('einfach-001-02.xml') }));
    const again = await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a-erneut.xml', bytes: bytes('einfach-001-02.xml') });
    expect(code(again)).toBe('statementAlreadyImported');

    // Nach dem Verwerfen (Task 5) waere der Lauf discarded — hier direkt am Datenbestand nachgestellt, weil discardRun erst in Lauf 3 entsteht.
    const run = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.accountId, f.account.id)).get()!;
    f.deps.db.update(financeImportRuns).set({ discardedAt: '2026-04-01T00:00:00.000Z', discardedByUserId: f.userId, discardNote: 'Test' }).where(eq(financeImportRuns.id, run.id)).run();
    const afterDiscard = await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a-nochmal.xml', bytes: bytes('einfach-001-02.xml') });
    expect(code(afterDiscard)).toBe('ok');
  });

  it('skips what it surely knows by bank reference and counts it as known', async () => {
    const f = await importFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'maerz.xml', bytes: bytes('einfach-001-02.xml') }));
    expect(f.deps.db.select().from(financeRawTransactions).all()).toHaveLength(3);

    // Ein zweiter, weiterer Export (andere Datei, andere Prüfsumme) trägt dieselben drei Referenzen erneut plus eine neue.
    const second = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'weiter.xml', bytes: bytes('wiederholte-referenzen.xml') }));
    expect(second.runs[0]!.counts).toMatchObject({ new: 1, known: 3, held: 0, pendingSkipped: 0 });
    expect(f.deps.db.select().from(financeRawTransactions).all()).toHaveLength(4);
  });

  it('skips a line without reference only when key and period overlap; otherwise holds it back as a candidate', async () => {
    const f = await importFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'juni.xml', bytes: bytes('ohne-referenz.xml') }));
    expect(f.deps.db.select().from(financeRawTransactions).all()).toHaveLength(1);

    const overlapping = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'juni-weiter.xml', bytes: bytes('ohne-referenz-ueberlappend.xml') }));
    expect(overlapping.runs[0]!.counts).toMatchObject({ new: 1, known: 1, held: 0 });
    expect(f.deps.db.select().from(financeRawTransactions).all()).toHaveLength(2); // die bekannte Zeile wurde nicht doppelt angelegt

    const notOverlapping = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'september.xml', bytes: bytes('ohne-referenz-nicht-ueberlappend.xml') }));
    expect(notOverlapping.runs[0]!.counts).toMatchObject({ new: 0, known: 0, held: 1 });
    const candidates = f.deps.db.select().from(financeImportCandidates).all();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.decision).toBeNull();
  });

  it('holds back a candidate when the core data matches but the purpose differs, even inside the same period', async () => {
    const f = await importFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'juni.xml', bytes: bytes('ohne-referenz.xml') }));
    const differing = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'juni-beitrag.xml', bytes: bytes('abweichender-zweck.xml') }));
    expect(differing.runs[0]!.counts).toMatchObject({ new: 0, known: 0, held: 1 });
  });

  it('reports the gap between the last closing and this opening balance, and imports anyway', async () => {
    const f = await importFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'maerz.xml', bytes: bytes('einfach-001-02.xml') }));
    const gapped = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'mai.xml', bytes: bytes('luecke.xml') }));
    expect(gapped.runs[0]!.gap).toEqual({ from: '2026-03-31', to: '2026-05-01' });
    expect(gapped.runs[0]!.state).toBe('finished');
  });

  it('writes nothing but a failed run as a fact when a line is unreadable, and never touches the file store', async () => {
    const f = await importFixture();
    const writeSpy = vi.fn();
    const realFiles = f.deps.files('finance');
    f.deps.files = () => ({ ...realFiles, write: writeSpy });

    const res = await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'kaputt.xml', bytes: bytes('kaputte-zeile.xml') });
    expect(code(res)).toBe('statementUnreadable');
    if (!res.ok) expect(res.error).toMatchObject({ message: expect.stringMatching(/Zeile 2/) });
    expect(writeSpy).not.toHaveBeenCalled();

    const runs = f.deps.db.select().from(financeImportRuns).all();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ failureCode: 'lineUnreadable', failureLine: 2, finishedAt: null, fileKey: null });
    expect(f.deps.db.select().from(financeRawTransactions).all()).toHaveLength(0);
    expect(f.deps.db.select().from(financeImportCandidates).all()).toHaveLength(0);
  });

  it('rolls back everything and removes the file when the transaction throws', async () => {
    const f = await importFixture();
    const realFiles = f.deps.files('finance');
    const writeSpy = vi.fn(realFiles.write.bind(realFiles));
    const deleteSpy = vi.fn(realFiles.delete.bind(realFiles));
    f.deps.files = () => ({
      ...realFiles,
      write: async (filename: string, data: Uint8Array) => {
        await writeSpy(filename, data);
        // Spion: nach dem Schreiben verschwindet das Konto, damit der Fremdschluessel in der Transaktion wirft (Race-Simulation).
        f.deps.db.delete(financeAccounts).where(eq(financeAccounts.id, f.account.id)).run();
      },
      delete: deleteSpy,
    });

    await expect(importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.xml', bytes: bytes('einfach-001-02.xml') })).rejects.toThrow();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(f.deps.db.select().from(financeImportRuns).all()).toHaveLength(0);
    expect(f.deps.db.select().from(financeRawTransactions).all()).toHaveLength(0);
    await expect(realFiles.read(writeSpy.mock.calls[0]![0] as string)).rejects.toThrow();
  });

  it('skips pending entries and counts them', async () => {
    const f = await importFixture();
    const res = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.xml', bytes: bytes('vorgemerkt.xml') }));
    expect(res.runs[0]!.counts).toMatchObject({ new: 1, pendingSkipped: 1 });
  });

  it('creates one run per statement of a multi-day file', async () => {
    const f = await importFixture();
    const res = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'zwei-tage.xml', bytes: bytes('zwei-tage.xml') }));
    expect(res.runs).toHaveLength(2);
    expect(res.runs[0]).toMatchObject({ periodFrom: '2026-03-01', periodTo: '2026-03-15', gap: null });
    expect(res.runs[1]).toMatchObject({ periodFrom: '2026-03-16', periodTo: '2026-03-31', gap: null });
  });

  it('lets an agent import (entriesWrite over mcp) and refuses without the permission', async () => {
    const f = await importFixture();
    const agentCtx = { ...ctxWith(['finance.entriesWrite']), channel: 'mcp' as const };
    const ok = unwrap(await importStatement(f.deps, agentCtx, { accountId: f.account.id, fileName: 'a.xml', bytes: bytes('einfach-001-02.xml') }));
    expect(f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.id, ok.runs[0]!.id)).get()!.createdChannel).toBe('mcp');

    const denied = await importStatement(f.deps, ctxWith(['finance.read']), { accountId: f.account.id, fileName: 'b.xml', bytes: bytes('folgeauszug.xml') });
    expect(denied.ok ? null : denied.error).toEqual({ type: 'forbidden', permission: 'finance.entriesWrite' });
  });

  it('never writes counterparty, iban or purpose into the audit log', async () => {
    const f = await importFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.xml', bytes: bytes('einfach-001-02.xml') }));
    const entry = auditEntry(f.deps, 'finance.import.run');
    const text = `${entry.summary}${entry.after ?? ''}`;
    expect(text).not.toContain('Erika');
    expect(text).not.toContain('Beispiel');
    expect(text).not.toContain('DE66999999991234567890');
    expect(text).not.toContain('Spende');
  });

  it('refuses cash accounts', async () => {
    const f = await importFixture();
    const res = await importStatement(f.deps, f.ctx, { accountId: f.cash.id, fileName: 'a.xml', bytes: bytes('einfach-001-02.xml') });
    expect(code(res)).toBe('statementAccountNotBank');
  });

  it('refuses an inactive account', async () => {
    const f = await importFixture();
    const other = unwrap(await createAccount(f.deps, f.ctx, { name: 'Stillgelegtes Konto', kind: 'bank', iban: VEREIN_IBAN }));
    unwrap(await setAccountActive(f.deps, f.ctx, { id: other.id, isActive: false, expectedVersion: other.updatedAt }));
    const res = await importStatement(f.deps, f.ctx, { accountId: other.id, fileName: 'a.xml', bytes: bytes('einfach-001-02.xml') });
    expect(code(res)).toBe('accountInactive');
  });
});

describe('listImportRuns / getImportRun', () => {
  it('lists runs and reads one with its raw transactions, requiring finance.read', async () => {
    const f = await importFixture();
    const created = unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'a.xml', bytes: bytes('einfach-001-02.xml') }));
    const runId = created.runs[0]!.id;

    const denied = await listImportRuns(f.deps, ctxWith(['finance.overview']), {});
    expect(denied.ok ? null : denied.error).toEqual({ type: 'forbidden', permission: 'finance.read' });

    const list = unwrap(await listImportRuns(f.deps, f.ctx, {}));
    expect(list.total).toBe(1);
    expect(list.runs[0]!.id).toBe(runId);

    const single = unwrap(await getImportRun(f.deps, f.ctx, { id: runId }));
    expect(single.rawTransactions).toHaveLength(3);
    expect(single.rawTransactions[0]).toMatchObject({ counterpartyName: expect.any(String) });
  });
});
