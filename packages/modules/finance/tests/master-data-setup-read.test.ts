import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { listAccounts } from '../src/ledger/accounts';
import { listCategories } from '../src/ledger/categories';
import { listDatedValues } from '../src/ledger/dated-values';
import { listEntries } from '../src/ledger/entries';
import { listFiscalYears } from '../src/ledger/fiscal-years';
import { listPurposes } from '../src/ledger/purposes';
import { ledgerFixture } from './helpers';

/**
 * Befundliste 0.2.0, N3 (Joe, 2026-09-23): Wer nur `finance.setup` trägt,
 * pflegt die Stammdaten — und muss sie deshalb auch auflisten können, das
 * Konto samt IBAN. Buchungen bleiben ihm verschlossen.
 */
describe('finance.setup reads master data', () => {
  it('lists accounts with IBAN, categories, purposes, dated values and fiscal years', async () => {
    const f = await ledgerFixture();
    const setupOnly = ctxWith(['finance.setup']);
    const accounts = unwrap(await listAccounts(f.deps, setupOnly, {}));
    expect(accounts.find((a) => a.name === 'Vereinskonto')!.iban).toBe('DE23999999990000202051');
    expect(unwrap(await listCategories(f.deps, setupOnly, {})).length).toBeGreaterThan(0);
    expect(unwrap(await listPurposes(f.deps, setupOnly, {})).length).toBeGreaterThan(0);
    expect(Array.isArray(unwrap(await listDatedValues(f.deps, setupOnly)))).toBe(true);
    expect(unwrap(await listFiscalYears(f.deps, setupOnly)).length).toBeGreaterThan(0);
  });

  it('overview alone still sees accounts without bank details', async () => {
    const f = await ledgerFixture();
    const accounts = unwrap(await listAccounts(f.deps, ctxWith(['finance.overview']), {}));
    expect(accounts.find((a) => a.name === 'Vereinskonto')!.iban).toBeNull();
  });

  it('setup alone still cannot read entries', async () => {
    const f = await ledgerFixture();
    expect((await listEntries(f.deps, ctxWith(['finance.setup']), {})).ok).toBe(false);
  });
});
