import { newId, schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { previewDatedValueRemoval, setDatedValue } from '../src/ledger/dated-values';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { TAX_CODES } from '../src/ledger/codes';
import { reverseEntry } from '../src/ledger/reverse';
import { getVatSettings, isValidVatId, previewVatSettingsRemoval, removeVatSettings, saveVatSettings, taxCodeOptionsInternal, vatLineContextInternal, vatProfileAt } from '../src/ledger/vat-settings';
import { financeCategories } from '../src/schema';
import { ledgerFixture, setupFinance } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));

function addCategory(deps: ReturnType<typeof setupFinance>['deps'], key: string, sphere: 'business' | 'purposeOperation' | 'ideal', isActive = true, name = key): string {
  const id = newId();
  deps.db.insert(financeCategories).values({ id, key, name, direction: 'income', sphere, incomeKind: sphere === 'ideal' ? 'donation' : 'sales', isActive, createdAt: 't', updatedAt: 't' }).run();
  return id;
}

type F = Awaited<ReturnType<typeof ledgerFixture>>;
const income = (f: F, categoryId: string, entryDate: string, cents: number) =>
  bookEntry(f.deps, f.ctx, { entryDate, text: 'Einnahme', moneyLines: [{ accountId: f.bank.id, amountCents: cents }], allocationLines: [{ categoryId, amountCents: cents }] }).then(unwrap);

/** Plan E6a Task 2 — Einstellung „Umsatzsteuer“ als datierte Werte. */
describe('VAT settings', () => {
  it('defaults to a legal person that owes VAT only under section 13b (Befund 37)', async () => {
    const { deps, ctx } = setupFinance();
    expect(vatProfileAt(deps.db, '2026-05-01')).toEqual({ on: '2026-05-01', taxation: 'smallBusiness', entrepreneur: false, vatId: null, advancePeriod: 'auto', advanceExempt: false, permanentExtension: false, taxOfficeState: null, obligations: 'section18_4aLegalPerson' });
    const view = unwrap(await getVatSettings(deps, ctx, { on: '2026-05-01' }));
    expect(view.hints).toEqual([{ code: 'notEntrepreneur' }]);
    expect(view.confirmedAt).toBeNull();
  });

  it('saves dated settings', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await saveVatSettings(deps, ctx, { validFrom: '2026-01-01', vatEntrepreneur: true, vatId: 'de 123456788' }));
    expect(vatProfileAt(deps.db, '2026-06-01')).toMatchObject({ entrepreneur: true, vatId: 'DE123456788', obligations: 'section18_4a' });
    expect(vatProfileAt(deps.db, '2025-12-31')).toMatchObject({ entrepreneur: false, vatId: null });
    const audits = deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'finance.datedValue.set')).all();
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => JSON.parse(a.params!))).toEqual(expect.arrayContaining([{ key: 'vatEntrepreneur', fromOn: '2026-01-01' }, { key: 'vatId', fromOn: '2026-01-01' }]));
    expect(unwrap(await getVatSettings(deps, ctx, {})).confirmedAt).not.toBeNull();
    expect(err(await saveVatSettings(deps, ctxWith(['finance.read']), { validFrom: '2026-01-01', vatEntrepreneur: true }))).toMatchObject({ type: 'forbidden' });
    expect(fields(await saveVatSettings(deps, ctx, { validFrom: '2026-01-01', vatId: 'DE123456789' }))).toEqual(['vatId:invalidVatId']);
    expect(fields(await saveVatSettings(deps, ctx, { validFrom: '2026-01-01' }))).toEqual(['validFrom:nothingToSave']);
  });

  it('treats regular taxation as entrepreneur and allows exemption only there', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await setDatedValue(deps, ctx, { key: 'taxation', validFrom: '2026-01-01', value: 'regular' }));
    expect(vatProfileAt(deps.db, '2026-02-01')).toMatchObject({ taxation: 'regular', entrepreneur: true, obligations: 'regular' });
    expect(fields(await saveVatSettings(deps, ctx, { validFrom: '2026-03-01', vatEntrepreneur: false }))).toEqual(['vatEntrepreneur:regularImpliesEntrepreneur']);
    expect(fields(await saveVatSettings(deps, ctx, { validFrom: '2025-03-01', vatAdvanceExempt: true }))).toEqual(['vatAdvanceExempt:regularOnly']);
    unwrap(await setDatedValue(deps, ctx, { key: 'vatAdvanceExempt', validFrom: '2025-03-01', value: true }));
    expect(vatProfileAt(deps.db, '2025-06-01').advanceExempt).toBe(false);
    expect(vatProfileAt(deps.db, '2026-06-01').advanceExempt).toBe(true);
  });

  it('suggests entrepreneur status only from booked income (Befund 27 a)', async () => {
    const f = await ledgerFixture();
    // Der Startplan hat aktive Einnahme-Kategorien im Zweckbetrieb und wGB — das allein ist kein Grund.
    expect(unwrap(await getVatSettings(f.deps, f.ctx, { on: '2026-05-01' })).hints).toEqual([{ code: 'notEntrepreneur' }]);
    const fees = addCategory(f.deps, 'protection-fees', 'purposeOperation', true, 'Schutzgebühren');
    await income(f, fees, '2026-03-02', 124000);
    expect(unwrap(await getVatSettings(f.deps, f.ctx, { on: '2026-05-01' })).hints).toEqual([{ code: 'notEntrepreneur' }, { code: 'entrepreneurSuggested', categories: 1, names: ['Schutzgebühren'], year: 2026, incomeCents: 124000 }]);
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2026-01-01', vatEntrepreneur: true }));
    expect(unwrap(await getVatSettings(f.deps, f.ctx, { on: '2026-05-01' })).hints).toEqual([{ code: 'vatIdRecommended' }]);
  });

  it('explains the entrepreneur suggestion with names and income', async () => {
    const f = await ledgerFixture({ years: ['2025', '2026'] });
    const fees = addCategory(f.deps, 'protection-fees', 'purposeOperation', true, 'Schutzgebühren');
    const ideal = addCategory(f.deps, 'collections', 'ideal', true, 'Sammlungen');
    await income(f, fees, '2025-03-02', 50000);
    await income(f, ideal, '2026-03-02', 9000);
    const reversed = await income(f, fees, '2026-04-02', 7000);
    unwrap(await reverseEntry(f.deps, f.ctx, { id: reversed.id }));
    expect(unwrap(await getVatSettings(f.deps, f.ctx, { on: '2026-05-01' })).hints).toContainEqual({ code: 'entrepreneurSuggested', categories: 1, names: ['Schutzgebühren'], year: 2025, incomeCents: 50000 });
  });

  it('lists stands and the decision state', async () => {
    const { deps, ctx } = setupFinance();
    deps.clock.set('2026-10-25T10:00:00.000Z');
    expect(unwrap(await getVatSettings(deps, ctx, {}))).toMatchObject({ entrepreneurDecided: false, history: [], advancePeriodKind: 'quarter', taxationSince: null });
    unwrap(await saveVatSettings(deps, ctx, { validFrom: '2026-01-01', vatEntrepreneur: true, vatPermanentExtension: true }));
    const view = unwrap(await getVatSettings(deps, ctx, {}));
    expect(view.entrepreneurDecided).toBe(true);
    expect(view.history).toEqual([{ validFrom: '2026-01-01', values: { vatEntrepreneur: true, vatPermanentExtension: true }, effective: { entrepreneur: true, vatId: null, advancePeriod: 'auto', permanentExtension: true }, removal: { validFrom: '2026-01-01', nextFrom: null, finalizedEntries: 0 } }]);
    unwrap(await saveVatSettings(deps, ctx, { validFrom: '2026-07-01', taxOfficeState: 'NI' }));
    expect(unwrap(await getVatSettings(deps, ctx, {})).history.map((s) => s.validFrom)).toEqual(['2026-07-01', '2026-01-01']);
    unwrap(await setDatedValue(deps, ctx, { key: 'taxation', validFrom: '2024-01-01', value: 'smallBusiness' }));
    unwrap(await setDatedValue(deps, ctx, { key: 'taxation', validFrom: '2026-03-01', value: 'regular' }));
    expect(unwrap(await getVatSettings(deps, ctx, {})).taxationSince).toBe('2026-03-01');
    expect(unwrap(await getVatSettings(deps, ctx, { on: '2025-06-01' })).taxationSince).toBe('2024-01-01');
  });

  it('gives each stand the values in force from its day — unset ones from the stand before or the default (Befund 30 g)', async () => {
    const { deps, ctx } = setupFinance();
    deps.clock.set('2026-10-25T10:00:00.000Z');
    unwrap(await saveVatSettings(deps, ctx, { validFrom: '2025-01-01', vatEntrepreneur: true, vatId: 'DE136695976' }));
    unwrap(await saveVatSettings(deps, ctx, { validFrom: '2026-07-01', vatAdvancePeriod: 'month' }));
    const [later, earlier] = unwrap(await getVatSettings(deps, ctx, {})).history;
    expect(earlier!.effective).toEqual({ entrepreneur: true, vatId: 'DE136695976', advancePeriod: 'auto', permanentExtension: false });
    expect(later!.effective).toEqual({ entrepreneur: true, vatId: 'DE136695976', advancePeriod: 'month', permanentExtension: false });
  });

  it('builds the line context', async () => {
    const { deps } = setupFinance();
    expect(vatLineContextInternal(deps.db, '2026-10-25')).toEqual({ taxation: 'smallBusiness', rates: { standard: 19, reduced: 7 }, periodKinds: { 2025: 'quarter', 2026: 'quarter', 2027: 'quarter' } });
  });

  it('removes a stand', async () => {
    const { deps, ctx } = setupFinance();
    deps.clock.set('2026-10-25T10:00:00.000Z');
    unwrap(await saveVatSettings(deps, ctx, { validFrom: '2026-01-01', vatEntrepreneur: true }));
    unwrap(await saveVatSettings(deps, ctx, { validFrom: '2026-07-01', vatPermanentExtension: true, taxOfficeState: 'NI' }));
    const before = vatProfileAt(deps.db, '2026-06-30');
    expect(err(await removeVatSettings(deps, ctxWith(['finance.read']), { validFrom: '2026-07-01' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await removeVatSettings(deps, ctx, { validFrom: '2026-03-01' }))).toMatchObject({ type: 'notFound' });
    expect(err(await removeVatSettings(deps, ctx, { validFrom: 'gestern' }))).toMatchObject({ type: 'validation' });
    const view = unwrap(await removeVatSettings(deps, ctx, { validFrom: '2026-07-01' }));
    expect(view.history.map((s) => s.validFrom)).toEqual(['2026-01-01']);
    expect({ ...vatProfileAt(deps.db, '2026-08-01'), on: '2026-06-30' }).toEqual(before);
    const audits = deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'finance.datedValue.remove')).all();
    expect(audits.map((a) => JSON.parse(a.params!))).toEqual(expect.arrayContaining([{ key: 'vatPermanentExtension', fromOn: '2026-07-01' }, { key: 'taxOfficeState', fromOn: '2026-07-01' }]));
    expect(audits).toHaveLength(2);
  });

  it('tells a legal person with a VAT id that EU services are placed at its seat', async () => {
    const { deps, ctx } = setupFinance();
    unwrap(await saveVatSettings(deps, ctx, { validFrom: '2026-01-01', vatEntrepreneur: false, vatId: 'DE123456788' }));
    expect(vatProfileAt(deps.db, '2026-05-01')).toMatchObject({ entrepreneur: false, vatId: 'DE123456788', obligations: 'section18_4aLegalPerson' });
    expect(unwrap(await getVatSettings(deps, ctx, { on: '2026-05-01' })).hints).toEqual([{ code: 'notEntrepreneur' }, { code: 'vatIdPlacesEuServices' }, { code: 'acquisitionThreshold' }]);
  });

  it('checks the VAT id with its check digit', () => {
    expect(isValidVatId('DE136695976')).toBe(true);
    expect(isValidVatId('DE123456788')).toBe(true);
    expect(isValidVatId('DE123456789')).toBe(false);
    expect(isValidVatId('DE12345678')).toBe(false);
    expect(isValidVatId('AT123456789')).toBe(false);
  });

  it('offers all tax codes for an entrepreneur, else only what a legal person owes — with a VAT id also § 13b EU (Befund 37, 39)', async () => {
    const { deps, ctx } = setupFinance();
    expect(taxCodeOptionsInternal(deps.db, '2026-05-01')).toEqual(['rc13bOther', 'icAcquisition']);
    unwrap(await saveVatSettings(deps, ctx, { validFrom: '2026-01-01', vatId: 'DE123456788' }));
    expect(taxCodeOptionsInternal(deps.db, '2026-05-01')).toEqual(['rc13bEu', 'rc13bOther', 'icAcquisition']);
    const other = setupFinance();
    unwrap(await saveVatSettings(other.deps, other.ctx, { validFrom: '2026-01-01', vatEntrepreneur: true }));
    expect(taxCodeOptionsInternal(other.deps.db, '2026-05-01')).toEqual([...TAX_CODES]);
  });
});

// N11 c (Nachttest 0.4.0, Joe 2026-10-27): Wer einen Stand entfernt, ändert rückwirkend die Lage der Tage, für die er
// galt. Die Vorschau nennt, wie viele festgeschriebene Buchungen dort liegen; Entfernen bleibt möglich.
describe('preview before removing a stand', () => {
  it('counts the finalized entries from the stand to the next one', async () => {
    const f = await ledgerFixture();
    f.deps.clock.set('2026-10-25T09:00:00.000Z');
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2026-01-01', vatEntrepreneur: true }));
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2026-03-01', vatEntrepreneur: false }));
    unwrap(await saveVatSettings(f.deps, f.ctx, { validFrom: '2026-12-01', vatEntrepreneur: true }));
    await income(f, f.programCosts.id, '2026-02-03', 1000);
    await income(f, f.programCosts.id, '2026-02-27', 1000);
    await income(f, f.programCosts.id, '2026-03-02', 1000);
    unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-02-10', text: 'Entwurf', moneyLines: [{ accountId: f.bank.id, amountCents: 500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: 500 }] }));

    expect(unwrap(await previewVatSettingsRemoval(f.deps, f.ctx, { validFrom: '2026-01-01' }))).toEqual({ validFrom: '2026-01-01', nextFrom: '2026-03-01', finalizedEntries: 2 });
    expect(unwrap(await previewVatSettingsRemoval(f.deps, f.ctx, { validFrom: '2026-03-01' }))).toEqual({ validFrom: '2026-03-01', nextFrom: '2026-12-01', finalizedEntries: 1 });
    expect(unwrap(await previewVatSettingsRemoval(f.deps, f.ctx, { validFrom: '2026-12-01' }))).toEqual({ validFrom: '2026-12-01', nextFrom: null, finalizedEntries: 0 });
    expect(unwrap(await previewDatedValueRemoval(f.deps, f.ctx, { key: 'vatEntrepreneur', validFrom: '2026-01-01' }))).toEqual({ validFrom: '2026-01-01', nextFrom: '2026-03-01', finalizedEntries: 2 });
    expect(unwrap(await getVatSettings(f.deps, f.ctx, {})).history.find((s) => s.validFrom === '2026-01-01')!.removal).toEqual({ validFrom: '2026-01-01', nextFrom: '2026-03-01', finalizedEntries: 2 });

    expect(err(await previewVatSettingsRemoval(f.deps, f.ctx, { validFrom: '2026-02-01' }))).toMatchObject({ type: 'notFound' });
    expect(err(await previewDatedValueRemoval(f.deps, f.ctx, { key: 'vatEntrepreneur', validFrom: '2026-02-01' }))).toMatchObject({ type: 'notFound' });
    expect(err(await previewVatSettingsRemoval(f.deps, ctxWith(['finance.read'], f.userId), { validFrom: '2026-01-01' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await previewDatedValueRemoval(f.deps, ctxWith(['finance.read'], f.userId), { key: 'vatEntrepreneur', validFrom: '2026-01-01' }))).toMatchObject({ type: 'forbidden' });
    // Ein späterer Stand eines anderen Schlüssels beendet die Lage nicht: „Unternehmer“ gilt über die USt-IdNr. hinweg.
    unwrap(await setDatedValue(f.deps, f.ctx, { key: 'vatId', validFrom: '2026-02-15', value: 'DE136695976' }));
    expect(unwrap(await previewVatSettingsRemoval(f.deps, f.ctx, { validFrom: '2026-01-01' }))).toMatchObject({ nextFrom: '2026-03-01', finalizedEntries: 2 });
  });
});

