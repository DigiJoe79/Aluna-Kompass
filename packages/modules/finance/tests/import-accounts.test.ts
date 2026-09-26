import { readFileSync } from 'node:fs';
import path from 'node:path';
import { unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { getAccountStatements } from '../src/import/accounts';
import { importStatement } from '../src/import/runs';
import { createAccount } from '../src/ledger/accounts';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { installFinance } from '../src/install';
import { setupFinance } from './helpers';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/camt');
const bytes = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const VEREIN_IBAN = 'DE60999999990201051234';

/**
 * `getAccountStatements` (F4 Task 7, Vorbedingung): ein Lesedienst im
 * Import-Bereich, weil `ledger/` `import/` nicht kennen darf
 * (`tests/direction.test.ts`) — die Kontokarte braucht „importiert bis“,
 * „letzter Auszug vor N Tagen“ und den Abstimmstand trotzdem.
 */
async function statementsFixture() {
  const { deps, ctx, userId } = setupFinance();
  deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
  const bank = unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: VEREIN_IBAN, isMain: true, openingBalanceCents: 100000, openingDate: '2026-01-01' }));
  const cash = unwrap(await createAccount(deps, ctx, { name: 'Barkasse', kind: 'cash' }));
  unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
  return { deps, ctx, userId, bank, cash };
}

describe('getAccountStatements', () => {
  it('reports imported-through, days since and the reconciliation for bank and payment-service accounts only', async () => {
    const f = await statementsFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.bank.id, fileName: 'maerz.xml', bytes: bytes('einfach-001-02.xml') }));

    const res = unwrap(await getAccountStatements(f.deps, f.ctx, { date: '2026-04-10' }));
    expect(res.accounts.map((a) => a.accountId)).toEqual([f.bank.id]);
    const bankView = res.accounts[0]!;
    expect(bankView.importedThrough).toBe('2026-03-31');
    expect(bankView.lastStatementDaysAgo).toBe(10);
    expect(bankView.reconciliation?.state).toBe('noStatement');
  });

  it('never reports negative days when the statement reaches into the future (Befund 5)', async () => {
    const f = await statementsFixture();
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.bank.id, fileName: 'maerz.xml', bytes: bytes('einfach-001-02.xml') })); // periodTo 2026-03-31

    const res = unwrap(await getAccountStatements(f.deps, f.ctx, { date: '2026-03-27' })); // vier Tage vor dem Ende des Auszugs
    const bankView = res.accounts[0]!;
    expect(bankView.lastStatementDaysAgo).toBe(0);
    expect(bankView.lastStatementInFuture).toBe(true);
  });

  it('reports null imported-through and no days for an account never imported', async () => {
    const f = await statementsFixture();
    const res = unwrap(await getAccountStatements(f.deps, f.ctx, { date: '2026-04-10' }));
    const bankView = res.accounts.find((a) => a.accountId === f.bank.id)!;
    expect(bankView.importedThrough).toBeNull();
    expect(bankView.lastStatementDaysAgo).toBeNull();
  });

  it('refuses without finance.read or finance.overview', async () => {
    const f = await statementsFixture();
    const denied = { ...f.ctx, permissions: new Set<string>() };
    const res = await getAccountStatements(f.deps, denied, {});
    expect(res).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });
});
