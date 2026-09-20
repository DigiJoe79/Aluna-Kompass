import { schema, unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { installFinance } from '../src/install';
import { listAccounts } from '../src/ledger/accounts';
import { listCategories } from '../src/ledger/categories';
import { listFiscalYears } from '../src/ledger/fiscal-years';
import { listPurposes } from '../src/ledger/purposes';
import { seedFinance } from '../src/seed';
import { setupFinance } from './helpers';

describe('seedFinance', () => {
  it('builds an invented association year and is idempotent', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);
    const accounts = unwrap(await listAccounts(deps, ctx, { includeInactive: true }));
    expect(accounts.map((a) => a.kind).sort()).toEqual(['bank', 'bank', 'cash', 'paymentService']);
    expect(accounts.filter((a) => a.isMain)).toHaveLength(1);
    expect(accounts.some((a) => !a.isActive)).toBe(true);
    expect(unwrap(await listFiscalYears(deps, ctx))).toHaveLength(2);
    const purposes = unwrap(await listPurposes(deps, ctx, { includeInactive: true }));
    expect(purposes).toHaveLength(4);
    expect(purposes.some((p) => p.abroad) && purposes.some((p) => p.fulfilledAt !== null)).toBe(true);
    expect(unwrap(await listCategories(deps, ctx, {})).map((c) => c.key)).toContain('room-rental');
  });

  it('uses no animal and no association-specific wording', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    const all = JSON.stringify([unwrap(await listAccounts(deps, ctx, { includeInactive: true })), unwrap(await listPurposes(deps, ctx, { includeInactive: true }))]);
    expect(all).not.toMatch(/tier|hund|katze|aluna|futter/i);
  });

  it('leaves no name, no IBAN and no free text in the audit log — the log cannot be deleted', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    const log = JSON.stringify(deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.')));
    expect(log.length).toBeGreaterThan(100);
    for (const secret of ['Vereinskonto', 'Barkasse', 'Spendenplattform', 'Sparbuch', 'Beispielbank', 'DE0212', 'AT6119', 'Dachsanierung', 'Jugendfreizeit', 'Flutlicht', 'Erika', 'Beispiel über', 'Raumvermietung']) expect(log, secret).not.toContain(secret);
  });
});
