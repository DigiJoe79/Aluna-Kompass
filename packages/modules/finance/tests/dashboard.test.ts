import { readFileSync } from 'node:fs';
import path from 'node:path';
import { roleIdByOrigin, schema, unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { createContact, linkUserToContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { FINANCE_DASHBOARD_TILES } from '../src/dashboard';
import { issueConfirmation } from '../src/donations/confirmations';
import { saveNotice, supersedeNotice } from '../src/donations/notices';
import { importStatement } from '../src/import/runs';
import { markTransactionForeign } from '../src/import/transit';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { createAccount } from '../src/ledger/accounts';
import { saveDraft, setReviewed } from '../src/ledger/entries';
import { createFirstFiscalYear } from '../src/ledger/fiscal-years';
import { createOpenItem } from '../src/ledger/open-items';
import { applyTaxDefaults, confirmSetupStep } from '../src/ledger/setup';
import { installFinance } from '../src/install';
import { insertDocument, insertRaw, insertRun, ledgerFixture, setupFinance } from './helpers';
import { donationFixture, EXEMPTION } from './donation-fixture';

const FIXTURES = path.resolve(import.meta.dirname, 'fixtures/camt');
const camtBytes = (name: string) => new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const VEREIN_IBAN = 'DE60999999990201051234';

const FINANCE_ROLE_ORIGIN_KEYS = ['finance:treasurer', 'finance:approver', 'finance:clerk', 'finance:auditor', 'finance:agent'];

function tileByKey(key: string) {
  const tile = FINANCE_DASHBOARD_TILES.find((t) => t.key === key);
  if (!tile) throw new Error(`unknown dashboard tile: ${key}`);
  return tile;
}

describe('finance dashboard tiles', () => {
  it('registers ten tiles, two of them on by default, each under exactly one permission', () => {
    expect(FINANCE_DASHBOARD_TILES).toHaveLength(10);
    expect(FINANCE_DASHBOARD_TILES.map((t) => t.key).sort()).toEqual([
      'balanceDifference', 'confirmationsToCorrect', 'lastStatement', 'overdueItems', 'purposesNegative', 'rawOpen', 'setupIncomplete', 'staleDrafts', 'todo', 'withoutVoucher',
    ]);
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
    unwrap(await createAccount(deps, ctx, { name: 'Vereinskonto', kind: 'bank', iban: 'DE23999999990000202051', isMain: true, openingBalanceCents: 10000, openingDate: '2026-01-01' }));

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

  /** Nur ein Bankkonto, mit passender IBAN für die CAMT-Fixtures — anders als `ledgerFixture` kein zweites, nie importiertes Konto, das die Tages-Kacheln unten stumm auf „stale“ zöge. */
  async function importDashboardFixture() {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    const account = unwrap(await createAccount(deps, ctx, { name: 'Auszugskonto', kind: 'bank', iban: VEREIN_IBAN, isMain: true }));
    return { deps, ctx, account };
  }

  it('counts open raw transactions, warns about a balance difference and about a stale statement from the configured day on', async () => {
    const f = await importDashboardFixture();
    f.deps.clock.set('2026-03-20T00:00:00.000Z'); // innerhalb des Auszugszeitraums (01.–31.03.)
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'maerz.xml', bytes: camtBytes('einfach-001-02.xml') }));

    const rawOpen = tileByKey('rawOpen');
    expect(await rawOpen.load(f.deps, f.ctx, {})).toMatchObject({ kind: 'count', count: 3, href: '/finance/imports' });

    // Kein Buchbestand gebucht — der Buchbestand (0) weicht vom Endsaldo des Auszugs (1153,00 €) ab.
    const balanceDifference = tileByKey('balanceDifference');
    expect(await balanceDifference.load(f.deps, f.ctx, {})).toMatchObject({ kind: 'status', tone: 'warning', messageKey: 'differs', values: { count: 1 } });

    const lastStatement = tileByKey('lastStatement');
    expect(await lastStatement.load(f.deps, f.ctx, {})).toMatchObject({ kind: 'status', tone: 'neutral', messageKey: 'ok' });

    f.deps.clock.set('2026-05-20T00:00:00.000Z'); // 50 Tage nach dem Auszugsende (31.03.) — ueber der Vorgabe von 35 Tagen
    expect(await lastStatement.load(f.deps, f.ctx, {})).toMatchObject({ kind: 'status', tone: 'warning', messageKey: 'stale', values: { count: 1 } });
  });

  it('adds the two import lines to the to-do tile without any name', async () => {
    const f = await importDashboardFixture();
    f.deps.clock.set('2026-04-05T00:00:00.000Z');
    unwrap(await importStatement(f.deps, f.ctx, { accountId: f.account.id, fileName: 'maerz.xml', bytes: camtBytes('einfach-001-02.xml') }));

    const todo = tileByKey('todo');
    const fresh = await todo.load(f.deps, f.ctx, {});
    if (fresh.kind !== 'list') throw new Error('expected list');
    // F5: Die Zeile führt in die Arbeitsliste, nicht mehr zu den hochgeladenen Auszügen.
    expect(fresh.lines.find((l) => l.titleKey === 'rawOpen')).toMatchObject({ values: { count: 3 }, href: '/finance/work' });
    expect(fresh.lines.find((l) => l.titleKey === 'lastStatement')).toBeUndefined(); // noch keine 35 Tage her

    f.deps.clock.set('2026-05-20T00:00:00.000Z');
    const later = await todo.load(f.deps, f.ctx, {});
    if (later.kind !== 'list') throw new Error('expected list');
    expect(later.lines.find((l) => l.titleKey === 'lastStatement')).toMatchObject({ values: { days: 50 }, href: '/finance/imports' });

    const serialized = JSON.stringify(later);
    expect(serialized).not.toMatch(/Erika|Beispiel|Musterspenderin/);
  });

  it('adds foreign money and vouchers without entry to the to-do tile without names', async () => {
    const f = await ledgerFixture();
    const ctx = ctxWith([...FINANCE_PERMISSIONS, 'dms.view'], f.userId);
    const rawId = insertRaw(f, insertRun(f, f.bank.id), { accountId: f.bank.id, amountCents: 12000, name: 'Erika Beispiel' });
    unwrap(await markTransactionForeign(f.deps, f.ctx, { rawTransactionId: rawId, holder: 'Nachbarverein Tierfreunde', reviewed: false }));
    insertDocument(f, { subject: 'Rechnung Futterhaus' });
    insertDocument(f, { subject: 'Quittung Futterhaus', typeKey: 'voucher-receipt' });

    const todo = tileByKey('todo');
    expect(todo.messageKeys).toEqual(expect.arrayContaining(['foreignMoney', 'vouchersWithoutEntry']));
    const result = await todo.load(f.deps, ctx, {});
    if (result.kind !== 'list') throw new Error('expected list');
    expect(result.lines.find((l) => l.titleKey === 'foreignMoney')).toEqual({ titleKey: 'foreignMoney', values: { count: 1 }, href: '/finance/work/foreign' });
    expect(result.lines.find((l) => l.titleKey === 'vouchersWithoutEntry')).toEqual({ titleKey: 'vouchersWithoutEntry', values: { count: 2 }, href: '/finance/work/vouchers' });
    expect(JSON.stringify(result)).not.toMatch(/Erika|Beispiel|Nachbarverein|Futterhaus/);
  });
});

describe('finance to-do tile — notices (F6a)', () => {
  it('warns about an expiring notice from the configured months on, and about a missing notice only once certifiable lines exist', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-03-01T10:00:00.000Z');
    const tile = tileByKey('todo');
    const noticeLines = async () => {
      const result = await tile.load(f.deps, f.ctx, {});
      if (result.kind !== 'list') throw new Error('expected list');
      return result.lines.filter((l) => l.titleKey === 'noticeExpiring' || l.titleKey === 'noNotice');
    };

    // Ohne bescheinigungsfähige Zeile fehlt kein Bescheid — der Verein bucht vielleicht nur Zweckbetrieb.
    expect(await noticeLines()).toEqual([]);
    await f.finalDonation({ date: '2026-02-01', cents: 5000, contactId: f.donor.id });
    expect(await noticeLines()).toEqual([{ titleKey: 'noNotice', values: {}, href: '/finance/donations/notices' }]);

    unwrap(await saveNotice(f.deps, f.ctx, { kind: 'section60a', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', noticeDate: '2023-09-15', purposesText: 'Tierschutz' }));
    expect(await noticeLines()).toEqual([]); // gültig bis 2026-09-15, sechs Monate Vorlauf beginnen am 2026-03-15

    f.deps.clock.set('2026-04-01T10:00:00.000Z');
    expect(await noticeLines()).toEqual([{ date: '2026-09-15', titleKey: 'noticeExpiring', values: { kind: 'section60a', months: 5 }, href: '/finance/donations/notices' }]);

    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.noticeExpiryWarnMonths', 3, 'test'));
    expect(await noticeLines()).toEqual([]);

    // Abgelaufen: dann fehlt wieder ein Bescheid.
    f.deps.clock.set('2026-09-16T10:00:00.000Z');
    expect((await noticeLines()).map((l) => l.titleKey)).toEqual(['noNotice']);
    expect(JSON.stringify(await tile.load(f.deps, f.ctx, {}))).not.toMatch(/Musterspenderin|Musterstadt/);
  });
});

describe('finance confirmations on the dashboard (F6a Task 5)', () => {
  it('counts confirmations to correct under finance.read, off by default, and adds both confirmation lines to the to-do tile without names', async () => {
    const f = await donationFixture({ machine: true });
    const tile = tileByKey('confirmationsToCorrect');
    expect(tile).toMatchObject({ permission: 'finance.read', kind: 'count', defaultOn: false });
    const todo = tileByKey('todo');
    expect(todo.messageKeys).toEqual(expect.arrayContaining(['confirmationsToCorrect', 'confirmationsNeedSignature']));
    const confirmationLines = async () => {
      const result = await todo.load(f.deps, f.ctx, {});
      if (result.kind !== 'list') throw new Error('expected list');
      return result.lines.filter((l) => l.titleKey === 'confirmationsToCorrect' || l.titleKey === 'confirmationsNeedSignature');
    };

    expect(await tile.load(f.deps, f.ctx, {})).toEqual({ kind: 'count', count: 0, href: '/finance/donations?tab=toCorrect' });
    expect(await confirmationLines()).toEqual([]);

    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.donate()).line.id] }));
    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.waive()).line.id] }));
    expect(await confirmationLines()).toEqual([{ titleKey: 'confirmationsNeedSignature', values: { count: 1 }, href: '/finance/donations?tab=needsSignature' }]);

    unwrap(await saveNotice(f.deps, f.ctx, { ...EXEMPTION, noticeDate: '2026-03-20', assessmentPeriod: '2024' }));
    unwrap(await supersedeNotice(f.deps, f.ctx, { id: f.notice!.id, supersededOn: '2026-03-20' }));
    expect(await tile.load(f.deps, f.ctx, {})).toEqual({ kind: 'count', count: 2, href: '/finance/donations?tab=toCorrect' });
    expect(await confirmationLines()).toEqual([
      { titleKey: 'confirmationsToCorrect', values: { count: 2 }, href: '/finance/donations?tab=toCorrect' },
      { titleKey: 'confirmationsNeedSignature', values: { count: 1 }, href: '/finance/donations?tab=needsSignature' },
    ]);
    expect(JSON.stringify(await todo.load(f.deps, f.ctx, {}))).not.toMatch(/Erika|Beispiel|Jonas/);
  });
});
