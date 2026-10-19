import { fixedClock, unwrap } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { savePledge } from '../src/direct-debit/pledges';
import { buildDirectDebitFile, createDirectDebitRun, markDirectDebitRunSubmitted } from '../src/direct-debit/runs';
import { bookFromTransaction } from '../src/import/book';
import { suggestForTransaction, type SuggestionView } from '../src/import/suggestions';
import { finalizeEntry } from '../src/ledger/finalize';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { financeCategories, financeOpenItems } from '../src/schema';
import { directDebitFixture } from './direct-debit-fixture';
import { insertRaw, insertRun } from './helpers';

/**
 * Plan L3: ein eingereichter Einzug zum 30.10.2026 (Uhr: Dienstag, 20.10.) mit einem Beitrag und einer Rate — für die
 * Gutschrift (Task 2), die Rückgaben (Task 3) und das Klären (Task 4).
 */
type Fixture = Awaited<ReturnType<typeof directDebitFixture>>;

const category = (f: Fixture, key: string) => f.deps.db.select().from(financeCategories).where(eq(financeCategories.key, key)).get()!.id;

/** Ein Beitrag (50,00 €, Beitragskategorie) und eine Rate (62,00 €, Spende mit Projekt) — Laufsumme 112,00 €. */
export async function creditScene(opts: { secondRun?: boolean } = {}) {
  const f = await directDebitFixture();
  unwrap(await createFirstFiscalYear(f.deps, f.ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
  const membership = category(f, 'membership-fees');
  const a = await f.payer('Beispiel');
  const feeId = await f.fee(a, 5000, '2026-10-30');
  f.deps.db.update(financeOpenItems).set({ lineTemplate: JSON.stringify([{ categoryId: membership, contactId: a.contactId }]) }).where(eq(financeOpenItems.id, feeId)).run();
  const b = await f.payer('Muster', { firstName: 'Max' });
  const pledge = unwrap(await savePledge(f.deps, f.ctx, { contactId: b.contactId, amountCents: 6200, interval: 'monthly', firstDueOn: '2026-10-30', paymentMethod: 'directDebit', mandateId: b.mandateId, projectId: null })).pledge;
  f.announce(a.mandateId, [{ dueOn: '2026-10-30', amountCents: 5000 }]);
  f.announce(b.mandateId, [{ dueOn: '2026-10-30', amountCents: 6200 }]);
  const submit = async () => {
    const run = unwrap(await createDirectDebitRun(f.deps, f.ctx, { collectionDate: '2026-10-30' }));
    unwrap(await buildDirectDebitFile(f.deps, f.ctx, { runId: run.id }));
    return unwrap(await markDirectDebitRunSubmitted(f.deps, f.ctx, { runId: run.id, submittedOn: '2026-10-20' }));
  };
  const run = await submit();
  let other: Awaited<ReturnType<typeof submit>> | null = null;
  if (opts.secondRun) {
    const c = await f.payer('Probe', { firstName: 'Paula' });
    await f.fee(c, 11200, '2026-10-30', 'Beitrag 2026 Mitglied 0003');
    f.announce(c.mandateId, [{ dueOn: '2026-10-30', amountCents: 11200 }]);
    other = await submit();
  }
  const statement = insertRun(f, f.bank.id);
  let line = 0;
  const raw = (amountCents: number, o: { endToEndId?: string; date?: string; returnCode?: string; mandateReference?: string; purpose?: string } = {}) =>
    insertRaw(f, statement, { accountId: f.bank.id, amountCents, date: o.date ?? '2026-10-30', name: null, iban: null, purpose: o.purpose ?? (o.returnCode ? 'Ruecklastschrift' : 'SEPA-Sammel-Gutschrift'), endToEndId: o.endToEndId ?? null, returnCode: o.returnCode ?? null, mandateReference: o.mandateReference ?? null, lineIndex: (line += 1) });
  const itemOf = (source: 'openItem' | 'pledge') => run.items.find((i) => i.source === source)!;
  return { ...f, membership, donations: category(f, 'donations'), bankFees: category(f, 'bank-fees'), a, b, feeId, pledge, run, other, raw, itemOf };
}

export type CreditScene = Awaited<ReturnType<typeof creditScene>>;

export const suggest = async (f: Fixture, rawTransactionId: string) => unwrap(await suggestForTransaction(f.deps, f.ctx, { rawTransactionId }));

export async function bookFromSuggestion(f: Fixture, rawTransactionId: string, s: SuggestionView) {
  return unwrap(await bookFromTransaction(f.deps, f.ctx, { rawTransactionId, text: s.draft!.text, allocationLines: s.draft!.allocationLines, settlements: s.draft!.moneyLines[0]!.settlements, reviewed: false }));
}

/** Den Vorschlag übernehmen und festschreiben, wie die Arbeitsliste es tut — mit der Uhr nach dem Buchungstag. */
export async function bookAndFinalize(f: Fixture, rawTransactionId: string, s: SuggestionView) {
  const draft = await bookFromSuggestion(f, rawTransactionId, s);
  return unwrap(await finalizeEntry({ ...f.deps, clock: fixedClock('2026-11-10T08:00:00.000Z') }, f.ctx, { id: draft.id }));
}
