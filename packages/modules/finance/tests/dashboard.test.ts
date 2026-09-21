import { roleIdByOrigin, schema, unwrap } from '@kompass/core';
import { ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { createContact, linkUserToContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { FINANCE_DASHBOARD_TILES } from '../src/dashboard';
import { createAccount } from '../src/ledger/accounts';
import { saveDraft, setReviewed } from '../src/ledger/entries';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { createOpenItem } from '../src/ledger/open-items';
import { applyTaxDefaults, confirmSetupStep } from '../src/ledger/setup';
import { installFinance } from '../src/install';
import { ledgerFixture, setupFinance } from './helpers';

const FINANCE_ROLE_ORIGIN_KEYS = ['finance:treasurer', 'finance:approver', 'finance:clerk', 'finance:auditor', 'finance:agent'];

function tileByKey(key: string) {
  const tile = FINANCE_DASHBOARD_TILES.find((t) => t.key === key);
  if (!tile) throw new Error(`unknown dashboard tile: ${key}`);
  return tile;
}

describe('finance dashboard tiles', () => {
  it('registers six tiles, two of them on by default, each under exactly one permission', () => {
    expect(FINANCE_DASHBOARD_TILES).toHaveLength(6);
    expect(FINANCE_DASHBOARD_TILES.map((t) => t.key).sort()).toEqual(['overdueItems', 'purposesNegative', 'setupIncomplete', 'staleDrafts', 'todo', 'withoutVoucher']);
    expect(FINANCE_DASHBOARD_TILES.filter((t) => t.defaultOn).map((t) => t.key).sort()).toEqual(['setupIncomplete', 'todo']);
    for (const tile of FINANCE_DASHBOARD_TILES) expect(typeof tile.permission).toBe('string');
  });

  it('lists only lines that have something to do, each with the link to its filter', async () => {
    const f = await ledgerFixture();
    const tile = tileByKey('todo');

    const empty = await tile.load(f.deps, f.ctx, {});
    expect(empty).toMatchObject({ kind: 'list', lines: [], total: 0 });

    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Gebühr', moneyLines: [{ accountId: f.bank.id, amountCents: -1000 }], allocationLines: [{ categoryId: f.fees.id, amountCents: -1000 }] }));
    unwrap(await setReviewed(f.deps, f.ctx, { id: draft.id, reviewed: true, expectedVersion: draft.updatedAt }));

    const withVoucherMissing = await f.finalEntry(); // festgeschrieben, kein Beleg
    void withVoucherMissing;

    unwrap(
      await createOpenItem(f.deps, f.ctx, {
        kind: 'payable',
        itemDate: '2026-01-01',
        amountCents: 4000,
        dueOn: '2026-01-15',
      }),
    );

    const result = await tile.load(f.deps, f.ctx, {});
    expect(result.kind).toBe('list');
    if (result.kind !== 'list') throw new Error('expected list');
    expect(result.lines).toHaveLength(3);
    expect(result.lines.map((l) => l.titleKey).sort()).toEqual(['overdueItems', 'reviewedNotFinal', 'withoutVoucher'].sort());
    const reviewedLine = result.lines.find((l) => l.titleKey === 'reviewedNotFinal')!;
    expect(reviewedLine.href).toBe('/finance/entries?state=reviewed');
    expect(reviewedLine.values).toMatchObject({ count: 1 });
    const voucherLine = result.lines.find((l) => l.titleKey === 'withoutVoucher')!;
    expect(voucherLine.href).toBe('/finance/entries?novoucher=1');
    const overdueLine = result.lines.find((l) => l.titleKey === 'overdueItems')!;
    expect(overdueLine.href).toBe('/finance/open-items?tab=payable');
    expect(overdueLine.values).toMatchObject({ count: 1 });
  });

  it('never names a contact in the to-do tile', async () => {
    const f = await ledgerFixture();
    await f.finalDonation({ date: '2026-03-01', cents: 2000, contactId: f.donor.id });
    unwrap(
      await createOpenItem(f.deps, f.ctx, {
        kind: 'payable',
        itemDate: '2026-01-01',
        contactId: f.donor.id,
        amountCents: 1500,
        dueOn: '2026-01-10',
      }),
    );

    const tile = tileByKey('todo');
    const result = await tile.load(f.deps, f.ctx, {});
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/Musterspenderin/);
  });

  it('counts stale drafts from day 15 on', async () => {
    const f = await ledgerFixture();
    const tile = tileByKey('staleDrafts');
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Alter Entwurf', moneyLines: [{ accountId: f.bank.id, amountCents: -500 }], allocationLines: [{ categoryId: f.fees.id, amountCents: -500 }] }));

    expect(await tile.load(f.deps, f.ctx, {})).toMatchObject({ kind: 'count', count: 0 });

    f.deps.clock.advance(14 * 86_400_000);
    expect(await tile.load(f.deps, f.ctx, {})).toMatchObject({ count: 0 }); // Tag 14: noch nicht zu alt

    f.deps.clock.advance(1 * 86_400_000);
    expect(await tile.load(f.deps, f.ctx, {})).toMatchObject({ count: 1 }); // Tag 15: zu alt
  });

  it('shows overdue items under finance.overview as a number only', async () => {
    const f = await ledgerFixture();
    unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-01-01', amountCents: 3000, dueOn: '2026-01-15' })); // überfällig (vor TEST_NOW 2026-09-05)
    unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'payable', itemDate: '2026-08-01', amountCents: 1000, dueOn: '2026-12-01' })); // nicht überfällig (nach TEST_NOW)

    const overviewCtx = ctxWith(['finance.overview'], f.userId);
    const tile = tileByKey('overdueItems');
    const result = await tile.load(f.deps, overviewCtx, {});
    expect(result).toEqual({ kind: 'count', count: 1, href: '/finance/open-items' });
    expect(JSON.stringify(result)).not.toMatch(/[A-Za-z]{4,}spenderin/);
  });

  it('warns about open setup steps and falls silent when setup is complete', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const tile = tileByKey('setupIncomplete');

    const incomplete = await tile.load(deps, ctx, {});
    expect(incomplete).toMatchObject({ kind: 'status', tone: 'warning', messageKey: 'incomplete' });
    if (incomplete.kind === 'status') expect((incomplete.values as { count: number }).count).toBeGreaterThan(0);

    unwrap(await createFirstFiscalYear(deps, ctx, { startsOn: '2026-01-01', endsOn: '2026-12-31' }));
    unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE02120300000000202051', isMain: true, openingBalanceCents: 10000, openingDate: '2026-01-01' }));

    const holderId = insertUser(deps, { name: 'Rollen-Halterin' });
    for (const originKey of FINANCE_ROLE_ORIGIN_KEYS) {
      const roleId = roleIdByOrigin(deps.db, originKey)!;
      deps.db.insert(schema.userRoles).values({ userId: holderId, roleId }).run();
    }
    const adminCtx = ctxWith(['users.manage', 'contacts.manage'], 'ADMIN-USER');
    const contact = unwrap(await createContact(deps, adminCtx, { kind: 'person', lastName: 'Musterhalterin' }));
    unwrap(await linkUserToContact(deps, adminCtx, { userId: holderId, contactId: contact.id }));

    unwrap(await confirmSetupStep(deps, ctx, { step: 'categories' }));
    unwrap(await applyTaxDefaults(deps, ctx));

    const complete = await tile.load(deps, ctx, {});
    expect(complete).toMatchObject({ kind: 'status', tone: 'neutral', messageKey: 'complete' });
  });
});
