import { coreModule, defineModule, schema, unwrap, writeSettingInternal } from '@kompass/core';
import { createTestDeps, systemContext } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry, finalizeEntry } from '../src/ledger/finalize';
import { cancelOpenItem, cancelOriginOpenItem, createOpenItem, createOriginOpenItem, reduceOriginOpenItem, rescheduleOriginOpenItem, saveOpenItem, updateOpenItem, type OriginOpenItemInput } from '../src/ledger/open-items';
import { registeredOpenItemOrigins } from '../src/ledger/origins';
import { financeModule } from '../src/manifest';
import { FINANCE_MCP_TOOLS } from '../src/mcp-tools';
import { ledgerFixture } from './helpers';

// Spec Mitglieder und Lastschrift § 6.1, Plan M2: offene Posten mit Herkunft aus einem anderen Modul.
const members = defineModule({ key: 'members', version: '0', permissions: [], dependsOn: ['finance'], openItemOrigins: [{ type: 'memberFeeCharge' }] });
const other = defineModule({ key: 'other', version: '0', permissions: [], openItemOrigins: [{ type: 'memberFeeCharge' }] });

function depsWith(manifests: Parameters<typeof defineModule>[0][], enabled: string[]) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, financeModule, ...manifests] });
  deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'finance', ...enabled]));
  return deps;
}

describe('registeredOpenItemOrigins', () => {
  it('maps the origin types of enabled modules to their module; finance keeps its own origins out', () => {
    const deps = depsWith([members], ['members']);
    expect(registeredOpenItemOrigins(deps)).toEqual(new Map([['memberFeeCharge', 'members']]));
    expect(registeredOpenItemOrigins(deps).has('financeExpenseClaim')).toBe(false);
    expect(registeredOpenItemOrigins(deps).has('financePartnerPayment')).toBe(false);
  });

  it('a disabled module counts only with includeDisabled', () => {
    const deps = depsWith([members], []);
    expect(registeredOpenItemOrigins(deps).size).toBe(0);
    expect(registeredOpenItemOrigins(deps, { includeDisabled: true })).toEqual(new Map([['memberFeeCharge', 'members']]));
  });

  it('two modules declaring the same type is a programming error', () => {
    const deps = depsWith([members, other], ['members', 'other']);
    expect(() => registeredOpenItemOrigins(deps)).toThrow('openItemOrigin memberFeeCharge declared by members and other');
  });
});

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const owned = { type: 'conflict', code: 'openItemOriginOwned' };

async function originFixture() {
  const f = await ledgerFixture({ extraModules: [members] });
  const input = (over: Partial<OriginOpenItemInput> = {}): OriginOpenItemInput => ({
    originType: 'memberFeeCharge', originId: 'FEE-1', contactId: f.donor.id, amountCents: 1200, itemDate: '2026-03-01', dueOn: '2026-03-31', paymentReference: 'MB-0007-2026',
    lineTemplate: [{ categoryId: f.donations.id, contactId: f.donor.id }], ...over,
  });
  const createOrigin = (over: Partial<OriginOpenItemInput> = {}) => f.deps.db.transaction((tx) => createOriginOpenItem(tx, f.deps, f.ctx, input(over)));
  const disable = (key: string) => f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'projects', 'finance'].filter((k) => k !== key)));
  return { ...f, input, createOrigin, disable };
}

describe('public open item services refuse a registered origin', () => {
  it('create and save refuse a registered origin type; an unregistered one stays allowed', async () => {
    const f = await originFixture();
    const base = { kind: 'receivable', itemDate: '2026-03-01', amountCents: 1200 };
    expect(err(await createOpenItem(f.deps, f.ctx, { ...base, originType: 'memberFeeCharge', originId: 'X' }))).toMatchObject(owned);
    expect(err(await saveOpenItem(f.deps, f.ctx, { ...base, originType: 'memberFeeCharge', originId: 'X' }))).toMatchObject(owned);
    expect(err(await createOpenItem(f.deps, f.ctx, { ...base, originType: 'somethingElse', originId: 'X' }))).toBe('ok');
  });

  it('update refuses an item with a registered origin, whatever the field, and refuses setting one', async () => {
    const f = await originFixture();
    const item = unwrap(f.createOrigin());
    expect(err(await updateOpenItem(f.deps, f.ctx, { id: item.id, dueOn: '2026-04-30' }))).toMatchObject(owned);
    expect(err(await updateOpenItem(f.deps, f.ctx, { id: item.id, originType: null }))).toMatchObject(owned);
    const plain = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 1200 }));
    expect(err(await updateOpenItem(f.deps, f.ctx, { id: plain.id, originType: 'memberFeeCharge', originId: 'X' }))).toMatchObject(owned);
    expect(err(await updateOpenItem(f.deps, f.ctx, { id: plain.id, dueOn: '2026-04-30' }))).toBe('ok');
  });

  it('locked while the owning module is disabled', async () => {
    const f = await originFixture();
    const item = unwrap(f.createOrigin());
    f.disable('members');
    expect(err(await updateOpenItem(f.deps, f.ctx, { id: item.id, dueOn: '2026-04-30' }))).toMatchObject(owned);
    expect(err(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 1200, originType: 'memberFeeCharge', originId: 'Y' }))).toMatchObject(owned);
  });

  it('cancelOpenItem stays refused for an item with origin', async () => {
    const f = await originFixture();
    const item = unwrap(f.createOrigin());
    expect(err(await cancelOpenItem(f.deps, f.ctx, { id: item.id, note: 'x' }))).toMatchObject({ type: 'conflict', code: 'openItemHasOrigin' });
  });

  it('MCP finance_open_item_save refuses a registered origin type', async () => {
    const f = await originFixture();
    const tool = FINANCE_MCP_TOOLS.find((t) => t.name === 'finance_open_item_save')!;
    expect(tool.description).toMatch(/openItemOriginOwned/);
    const res = await tool.handler(f.deps, { ...f.ctx, channel: 'mcp' }, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 1200, originType: 'memberFeeCharge', originId: 'X' });
    expect(err(res as { ok: boolean; error?: unknown })).toMatchObject(owned);
  });
});

describe('internal API for modules', () => {
  it('createOriginOpenItem creates a receivable and logs it', async () => {
    const f = await originFixture();
    const item = unwrap(f.createOrigin());
    expect(item).toMatchObject({ kind: 'receivable', originType: 'memberFeeCharge', originId: 'FEE-1', contactId: f.donor.id, amountCents: 1200, dueOn: '2026-03-31', state: 'open', openCents: 1200 });
    const log = f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, item.id)).all();
    expect(log.map((e) => e.action)).toEqual(['finance.openItem.create']);
  });

  it('createOriginOpenItem refuses an unregistered type and an unknown contact', async () => {
    const f = await originFixture();
    expect(err(f.createOrigin({ originType: 'somethingElse' }))).toMatchObject({ type: 'conflict', code: 'openItemOriginUnknown' });
    expect(err(f.createOrigin({ contactId: 'NOPE' }))).toMatchObject({ type: 'notFound' });
    f.disable('members');
    expect(err(f.createOrigin())).toMatchObject({ type: 'conflict', code: 'openItemOriginUnknown' });
  });

  it('rescheduleOriginOpenItem moves dueOn only for its own origin and logs before and after', async () => {
    const f = await originFixture();
    const item = unwrap(f.createOrigin());
    const moved = unwrap(f.deps.db.transaction((tx) => rescheduleOriginOpenItem(tx, f.deps, f.ctx, { openItemId: item.id, originType: 'memberFeeCharge', dueOn: '2026-05-15' })));
    expect(moved.dueOn).toBe('2026-05-15');
    const entry = f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'finance.openItem.reschedule')).get()!;
    expect(JSON.parse(entry.before!)).toEqual({ dueOn: '2026-03-31' });
    expect(JSON.parse(entry.after!)).toEqual({ dueOn: '2026-05-15' });
    expect(err(f.deps.db.transaction((tx) => rescheduleOriginOpenItem(tx, f.deps, f.ctx, { openItemId: item.id, originType: 'otherType', dueOn: '2026-06-01' })))).toMatchObject(owned);
    const plain = unwrap(await createOpenItem(f.deps, f.ctx, { kind: 'receivable', itemDate: '2026-03-01', amountCents: 1200 }));
    expect(err(f.deps.db.transaction((tx) => rescheduleOriginOpenItem(tx, f.deps, f.ctx, { openItemId: plain.id, originType: 'memberFeeCharge', dueOn: '2026-06-01' })))).toMatchObject(owned);
  });

  it('cancelOriginOpenItem cancels without payment, refuses with a finalized payment, allows a mere draft', async () => {
    const f = await originFixture();
    const cancel = (id: string, originType = 'memberFeeCharge') => f.deps.db.transaction((tx) => cancelOriginOpenItem(tx, f.deps, f.ctx, { openItemId: id, originType, note: 'Austritt' }));

    const free = unwrap(f.createOrigin({ originId: 'FEE-1' }));
    expect(err(cancel(free.id, 'otherType'))).toMatchObject(owned);
    expect(unwrap(cancel(free.id))).toMatchObject({ state: 'cancelled', cancelNote: 'Austritt' });
    expect(f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'finance.openItem.cancel')).all()).toHaveLength(1);
    expect(err(f.deps.db.transaction((tx) => rescheduleOriginOpenItem(tx, f.deps, f.ctx, { openItemId: free.id, originType: 'memberFeeCharge', dueOn: '2026-06-01' })))).toMatchObject({ type: 'conflict', code: 'openItemCancelled' });

    const paid = unwrap(f.createOrigin({ originId: 'FEE-2' }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Beitrag', moneyLines: [{ accountId: f.bank.id, amountCents: 1200, settlements: [{ openItemId: paid.id, amountCents: 1200 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1200 }] }));
    expect(err(cancel(paid.id))).toMatchObject({ type: 'conflict', code: 'openItemHasPayments' });

    const drafted = unwrap(f.createOrigin({ originId: 'FEE-3' }));
    const draft = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Beitrag', moneyLines: [{ accountId: f.bank.id, amountCents: 1200, settlements: [{ openItemId: drafted.id, amountCents: 1200 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1200 }] }));
    expect(err(cancel(drafted.id))).toBe('ok');
    expect(err(await finalizeEntry(f.deps, f.ctx, { id: draft.id }))).toMatchObject({ type: 'conflict', code: 'openItemCancelled' });
  });

  it('reduceOriginOpenItem lowers the amount to what is paid at least, only for its own origin, and logs the amount', async () => {
    const f = await originFixture();
    const reduce = (id: string, amountCents: number, originType = 'memberFeeCharge') => f.deps.db.transaction((tx) => reduceOriginOpenItem(tx, f.deps, f.ctx, { openItemId: id, originType, amountCents }));
    const item = unwrap(f.createOrigin());
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-05', text: 'Beitrag', moneyLines: [{ accountId: f.bank.id, amountCents: 600, settlements: [{ openItemId: item.id, amountCents: 600 }] }], allocationLines: [{ categoryId: f.donations.id, amountCents: 600 }] }));
    expect(err(reduce(item.id, 500))).toMatchObject({ type: 'conflict', code: 'openItemBelowSettled' });
    expect(err(reduce(item.id, 1200))).toMatchObject({ type: 'validation' });
    expect(err(reduce(item.id, 600, 'otherType'))).toMatchObject(owned);
    expect(unwrap(reduce(item.id, 600))).toMatchObject({ amountCents: 600, openCents: 0, state: 'settled' });
    const entry = f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'finance.openItem.reduce')).get()!;
    expect(JSON.parse(entry.params!)).toEqual({ amountCents: 600 });
    expect(JSON.parse(entry.before!)).toEqual({ amountCents: 1200 });
  });
});
