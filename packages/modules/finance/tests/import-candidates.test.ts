import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unwrap } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { decideCandidate, listCandidates } from '../src/import/candidates';
import { importStatement } from '../src/import/runs';
import { createAccount } from '../src/ledger/accounts';
import { bookEntry } from '../src/ledger/finalize';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { installFinance } from '../src/install';
import { financeCategories, financeImportCandidates, financeImportRuns } from '../src/schema';
import { setupFinance } from './helpers';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/camt');
const bytes = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const VEREIN_IBAN = 'DE60999999990201051234';

const code = (r: { ok: boolean; error?: { type: string; code?: string; permission?: string } }) => (r.ok ? 'ok' : r.error!.type === 'conflict' ? r.error!.code : r.error!.type);

async function candidateFixture() {
  const { deps, ctx, userId } = setupFinance();
  deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
  const account = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: VEREIN_IBAN, isMain: true }));
  unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
  const donations = deps.db.select().from(financeCategories).where(eq(financeCategories.key, 'donations')).get()!;

  unwrap(await importStatement(deps, ctx, { accountId: account.id, fileName: 'juni.xml', bytes: bytes('ohne-referenz.xml') }));
  const secondRun = unwrap(await importStatement(deps, ctx, { accountId: account.id, fileName: 'september.xml', bytes: bytes('ohne-referenz-nicht-ueberlappend.xml') }));
  const candidateRow = deps.db.select().from(financeImportCandidates).all()[0]!;

  return { deps, ctx, userId, account, donations, candidateId: candidateRow.id, matchesRawTransactionId: candidateRow.matchesRawTransactionId!, heldRunId: secondRun.runs[0]!.id };
}

describe('listCandidates', () => {
  it('shows both sides of a candidate, the existing one with its entry number and state', async () => {
    const f = await candidateFixture();
    const before = unwrap(await listCandidates(f.deps, f.ctx, {}));
    expect(before.candidates).toHaveLength(1);
    expect(before.candidates[0]).toMatchObject({ id: f.candidateId, line: { amountCents: 7500, counterpartyName: 'Erika Beispiel' }, existing: { id: f.matchesRawTransactionId, state: 'open', entryNumber: null } });

    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-06-06', text: 'Spende Juni gebucht', moneyLines: [{ accountId: f.account.id, amountCents: 7500, rawTransactionId: f.matchesRawTransactionId }], allocationLines: [{ categoryId: f.donations.id, amountCents: 7500 }] }));

    const after = unwrap(await listCandidates(f.deps, f.ctx, {}));
    expect(after.candidates[0]!.existing).toMatchObject({ state: 'booked', entryId: entry.id, entryNumber: entry.number, entryStatus: 'final' });
  });

  it('requires finance.read', async () => {
    const f = await candidateFixture();
    const denied = await listCandidates(f.deps, ctxWith(['finance.overview']), {});
    expect(denied.ok ? null : denied.error).toEqual({ type: 'forbidden', permission: 'finance.read' });
  });

  it('filters by run and by open decisions', async () => {
    const f = await candidateFixture();
    expect(unwrap(await listCandidates(f.deps, f.ctx, { runId: f.heldRunId })).candidates).toHaveLength(1);
    expect(unwrap(await listCandidates(f.deps, f.ctx, { runId: 'NOPE' })).candidates).toHaveLength(0);
    unwrap(await decideCandidate(f.deps, f.ctx, { id: f.candidateId, decision: 'same' }));
    expect(unwrap(await listCandidates(f.deps, f.ctx, { open: true })).candidates).toHaveLength(0);
  });
});

describe('decideCandidate', () => {
  it('turns a candidate into a raw transaction on "own" and leaves nothing on "same", recording who decided and when', async () => {
    const f = await candidateFixture();
    const before = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.id, f.heldRunId)).get()!;

    const decided = unwrap(await decideCandidate(f.deps, f.ctx, { id: f.candidateId, decision: 'own' }));
    expect(decided.decision).toBe('own');
    expect(decided.decidedByUserId).toBe(f.userId);
    expect(decided.decidedAt).not.toBeNull();
    expect(decided.rawTransactionId).not.toBeNull();

    // Die Zaehler des Laufs bleiben Tatsache — die Entscheidung steht nur am Kandidaten.
    const after = f.deps.db.select().from(financeImportRuns).where(eq(financeImportRuns.id, f.heldRunId)).get()!;
    expect(after).toMatchObject({ countNew: before.countNew, countHeld: before.countHeld });
  });

  it('leaves nothing behind on "same"', async () => {
    const f = await candidateFixture();
    const decided = unwrap(await decideCandidate(f.deps, f.ctx, { id: f.candidateId, decision: 'same' }));
    expect(decided.decision).toBe('same');
    expect(decided.rawTransactionId).toBeNull();
  });

  it('refuses to decide twice', async () => {
    const f = await candidateFixture();
    unwrap(await decideCandidate(f.deps, f.ctx, { id: f.candidateId, decision: 'same' }));
    const again = await decideCandidate(f.deps, f.ctx, { id: f.candidateId, decision: 'own' });
    expect(code(again)).toBe('candidateAlreadyDecided');
  });

  it('requires finance.entriesWrite', async () => {
    const f = await candidateFixture();
    const denied = await decideCandidate(f.deps, ctxWith(['finance.read']), { id: f.candidateId, decision: 'same' });
    expect(denied.ok ? null : denied.error).toEqual({ type: 'forbidden', permission: 'finance.entriesWrite' });
  });
});
