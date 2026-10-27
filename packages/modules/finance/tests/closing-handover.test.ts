import { newId, unwrap, writeSettingInternal, type CallContext } from '@kompass/core';
import { auditEntry, ctxWith, systemContext } from '@kompass/core/testing';
import { contactRoles, createContact } from '@kompass/module-contacts';
import { documentLinks, documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getAssemblyResult } from '../src/closing/assembly';
import { cancelHandover, countCashForHandover, fileHandoverProtocol, getHandover, handoverDefaults, listHandovers, printHandoverProtocol, recordHandoverInterimReport, saveHandoverItems, startHandover, updateHandover } from '../src/closing/handover';
import { getClosingStatus } from '../src/closing/status';
import { createAccount, setAccountActive } from '../src/ledger/accounts';
import { bookEntry } from '../src/ledger/finalize';
import { runFinanceReport } from '../src/reporting/service';
import { financeHandovers, financeAccounts } from '../src/schema';
import { allowHumanOnlyOverMcp, ledgerFixture, pdfBytes } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));

async function setup() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2026 = f.years['2026']!.id;
  const contactCtx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const person = async (lastName: string) => unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Testa', lastName }));
  const carl = await person('Kassierer');
  const dana = await person('Nachfolgerin');
  f.deps.db.insert(contactRoles).values({ id: newId(), contactId: carl.id, role: 'treasurer', since: '2024-01-01', until: null, note: null }).run();
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000 }] }));
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-08-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 700 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 700 }] }));
  // Die Barkasse hat am Übergabetag Bestand: Sie muss gezählt werden (14c).
  unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'Spende bar', moneyLines: [{ accountId: f.cash.id, amountCents: 8500 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 8500 }] }));
  const start = () => startHandover(f.deps, f.ctx, { handoverOn: '2026-06-30', fromContactId: carl.id, toContactId: dana.id }).then(unwrap);
  const count = (id: string, input: Record<string, unknown> = {}) => countCashForHandover(f.deps, f.ctx, { id, accountId: f.cash.id, countedCents: 8500, counterOneContactId: carl.id, counterTwoContactId: dana.id, ...input });
  return { f, y2026, person, carl, dana, start, count };
}

describe('Amtsübergabe (Rechenschaft C)', () => {
  it('suggests the treasurer of the day as the one handing over', async () => {
    const { f, carl } = await setup();
    expect(unwrap(await handoverDefaults(f.deps, f.ctx, { handoverOn: '2026-06-30' }))).toEqual({ fromContactId: carl.id });
    expect(unwrap(await handoverDefaults(f.deps, f.ctx, { handoverOn: '2023-06-30' }))).toEqual({ fromContactId: null });
  });

  it('starts one open handover between two persons with the standard items', async () => {
    const { f, y2026, carl, dana, start } = await setup();
    expect(code(await startHandover(f.deps, f.ctx, { handoverOn: '2026-06-30', fromContactId: carl.id, toContactId: carl.id }))).toBe('handoverSamePerson');
    expect(code(await startHandover(f.deps, ctxWith(['finance.read', 'finance.periodClose'], f.userId), { handoverOn: '2026-06-30', fromContactId: carl.id, toContactId: dana.id }))).toBe('forbidden');
    const h = await start();
    expect(h).toMatchObject({ fiscalYearId: y2026, handoverOn: '2026-06-30', fromName: 'Testa Kassierer', toName: 'Testa Nachfolgerin', state: 'open', interimReport: null, cashAccounts: [{ accountId: f.cash.id, name: 'Barkasse', bookCents: 8500, count: null }], cashRequired: true, protocolDocumentId: null, doneCount: 0 });
    expect(h.items.map((i) => i.key)).toEqual(['cash', 'records', 'bankAccess', 'paymentServices', 'kompass']);
    expect(JSON.parse(auditEntry(f.deps, 'finance.handover.start').params!)).toEqual({ handoverOn: '2026-06-30' });
    expect(code(await startHandover(f.deps, f.ctx, { handoverOn: '2026-07-01', fromContactId: carl.id, toContactId: dana.id }))).toBe('handoverOpen');
    expect(unwrap(await listHandovers(f.deps, f.ctx, { fiscalYearId: y2026 })).map((x) => x.id)).toEqual([h.id]);
    expect(unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: y2026 })).handovers).toEqual([{ id: h.id, handoverOn: '2026-06-30', fromName: 'Testa Kassierer', toName: 'Testa Nachfolgerin', state: 'open' }]);
  });

  it('updates until the interim report and cancels until the protocol is filed', async () => {
    const { f, start } = await setup();
    const h = await start();
    f.deps.clock.advance(60_000);
    const updated = unwrap(await updateHandover(f.deps, f.ctx, { id: h.id, handoverOn: '2026-06-29', expectedVersion: h.version }));
    expect(updated.handoverOn).toBe('2026-06-29');
    expect(code(await updateHandover(f.deps, f.ctx, { id: h.id, handoverOn: '2026-06-28', expectedVersion: h.version }))).toBe('staleVersion');
    unwrap(await recordHandoverInterimReport(f.deps, f.ctx, { id: h.id }));
    expect(code(await updateHandover(f.deps, f.ctx, { id: h.id, handoverOn: '2026-06-30' }))).toBe('handoverInterimRecorded');
    expect(unwrap(await cancelHandover(f.deps, f.ctx, { id: h.id })).state).toBe('cancelled');
    expect(code(await cancelHandover(f.deps, f.ctx, { id: h.id }))).toBe('handoverNotOpen');
  });

  it('records the interim cash report up to the handover day with its hash', async () => {
    const { f, y2026, start } = await setup();
    const h = await start();
    const after = unwrap(await recordHandoverInterimReport(f.deps, f.ctx, { id: h.id }));
    const run = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: y2026, date: '2026-06-30' } }));
    expect(run.stage).toBe('preliminary');
    expect(after.interimReport).toEqual({ params: { fiscalYearId: y2026, date: '2026-06-30' }, hash: run.hash, shortHash: run.shortHash, at: expect.any(String) });
    const fullYear = unwrap(await runFinanceReport(f.deps, f.ctx, { report: 'cashReport', params: { fiscalYearId: y2026 } }));
    expect(fullYear.hash).not.toBe(run.hash);
    expect(JSON.parse(auditEntry(f.deps, 'finance.handover.interimReport').params!)).toEqual({ handoverOn: '2026-06-30', shortHash: run.shortHash });
  });

  it('refuses the interim report before the handover day', async () => {
    const { f, carl, dana } = await setup();
    const h = unwrap(await startHandover(f.deps, f.ctx, { handoverOn: '2026-12-01', fromContactId: carl.id, toContactId: dana.id }));
    expect(code(await recordHandoverInterimReport(f.deps, f.ctx, { id: h.id }))).toBe('handoverInFuture');
  });

  it('counts the cash on the handover day in the presence of the successor', async () => {
    const { f, start, person, count } = await setup();
    const h = await start();
    const witness = await person('Zeugin');
    const counted = unwrap(await count(h.id, { counterTwoContactId: witness.id }));
    expect(counted.cashAccounts).toEqual([{ accountId: f.cash.id, name: 'Barkasse', bookCents: 8500, count: { countId: expect.any(String), countedCents: 8500, differenceCents: 0 } }]);
    expect(counted.doneCount).toBe(1);
    // Neue Zählungen setzen die alte Einzelspalte nicht mehr.
    expect(f.deps.db.select().from(financeHandovers).where(eq(financeHandovers.id, h.id)).get()!.cashCountId).toBeNull();
    expect(code(await count(h.id, { counterTwoContactId: witness.id }))).toBe('handoverCashCounted');
    expect(f.deps.sqlite.prepare('select contact_id as contactId from finance_cash_count_contact_witnesses').all()).toEqual([{ contactId: h.toContactId }]);
    expect(code(await countCashForHandover(f.deps, { ...f.ctx, channel: 'mcp' }, { id: h.id, accountId: f.cash.id, countedCents: 0, counterOneContactId: h.fromContactId, counterTwoContactId: witness.id }))).toBe('humanOnly');
  });

  it('counts every cash box with a balance on the handover day; a box at zero needs no count (14c)', async () => {
    const { f, start, person, count } = await setup();
    const box = unwrap(await createAccount(f.deps, f.ctx, { name: 'Zählkasse', kind: 'cash' }));
    const empty = unwrap(await createAccount(f.deps, f.ctx, { name: 'Leere Kasse', kind: 'cash' }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-04-01', text: 'Sammeldose', moneyLines: [{ accountId: box.id, amountCents: 14000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 14000 }] }));
    const h = await start();
    expect(h.cashAccounts.map((a) => a.name)).toEqual(['Barkasse', 'Zählkasse']);
    const witness = await person('Zeugin');
    unwrap(await recordHandoverInterimReport(f.deps, f.ctx, { id: h.id }));
    let v = unwrap(await count(h.id, { counterTwoContactId: witness.id }));
    expect(v.doneCount).toBe(1);
    expect(code(await fileHandoverProtocol(f.deps, f.ctx, { id: h.id, bytes: pdfBytes() }))).toBe('handoverStepsOpen');
    expect(code(await count(h.id, { accountId: empty.id, countedCents: 0, counterTwoContactId: witness.id }))).toBe('handoverCashNotRequired');
    // Eine Differenz lässt den Schritt offen und nennt sie; neu zählen geht.
    v = unwrap(await count(h.id, { accountId: box.id, countedCents: 13000, counterTwoContactId: witness.id, note: 'Zehn Euro fehlen.' }));
    expect(v.cashAccounts.find((a) => a.accountId === box.id)!.count).toMatchObject({ countedCents: 13000, differenceCents: -1000 });
    expect(v.doneCount).toBe(1);
    // Die Zählung mit Differenz bucht sie aus; die neue Zählung stimmt mit dem Buchbestand.
    f.deps.clock.advance(60_000);
    v = unwrap(await count(h.id, { accountId: box.id, countedCents: 13000, counterTwoContactId: witness.id }));
    expect(v.doneCount).toBe(2);
  });

  it('without an active cash account the count is not needed', async () => {
    const { f, start, count } = await setup();
    unwrap(await setAccountActive(f.deps, f.ctx, { id: f.cash.id, isActive: false, expectedVersion: f.deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, f.cash.id)).get()!.updatedAt }));
    const h = await start();
    expect(h.cashRequired).toBe(false);
    expect(code(await count(h.id))).toBe('handoverNoCash');
  });

  it('saves the items: a custom one needs a label, the standard ones stay', async () => {
    const { f, start } = await setup();
    const h = await start();
    expect(fields(await saveHandoverItems(f.deps, f.ctx, { id: h.id, expectedVersion: h.version, items: [{ key: 'custom', checked: false }] }))).toEqual(['items.0.label:required']);
    const cash = h.items.find((i) => i.key === 'cash')!;
    f.deps.clock.advance(60_000);
    const saved = unwrap(await saveHandoverItems(f.deps, f.ctx, { id: h.id, expectedVersion: h.version, items: [{ id: cash.id, key: 'cash', checked: true, note: 'Schlüssel übergeben' }, { key: 'custom', label: 'Vereinsstempel', checked: true }] }));
    expect(saved.items.map((i) => [i.key, i.checked])).toEqual([['cash', true], ['records', false], ['bankAccess', false], ['paymentServices', false], ['kompass', false], ['custom', true]]);
    expect(saved.items.find((i) => i.key === 'custom')!.label).toBe('Vereinsstempel');
    expect(code(await saveHandoverItems(f.deps, f.ctx, { id: h.id, expectedVersion: h.version, items: [] }))).toBe('staleVersion');
  });

  it('prints the protocol without filing it', async () => {
    const { f, start } = await setup();
    const bodies: string[] = [];
    const slots: Record<string, unknown>[] = [];
    const original = f.deps.documents.render.bind(f.deps.documents);
    f.deps.documents.render = async (args) => {
      bodies.push(args.bodyTypst);
      slots.push(args.slots as unknown as Record<string, unknown>);
      return original(args);
    };
    const h = await start();
    const interim = unwrap(await recordHandoverInterimReport(f.deps, f.ctx, { id: h.id }));
    const before = f.deps.db.select().from(documents).all().length;
    const printed = unwrap(await printHandoverProtocol(f.deps, ctxWith(['finance.read'], f.userId), { id: h.id }));
    expect(new TextDecoder().decode(printed.bytes.subarray(0, 5))).toBe('%PDF-');
    expect(f.deps.db.select().from(documents).all()).toHaveLength(before);
    const body = bodies.at(-1)!;
    for (const text of ['Testa Kassierer', 'Testa Nachfolgerin', '30.06.2026', interim.interimReport!.shortHash, 'Kasse', '§ 67 BGB', 'Entlastet']) expect(body).toContain(text);
    expect(String(slots.at(-1)!.footerNote)).toContain(interim.interimReport!.shortHash);
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.reports.treasurerIsStatutoryBoard', false));
    unwrap(await printHandoverProtocol(f.deps, f.ctx, { id: h.id }));
    expect(bodies.at(-1)).not.toContain('§ 67 BGB');
  });

  it('files the signed protocol once the interim report and the count are there', async () => {
    const { f, y2026, start, person, count } = await setup();
    const h = await start();
    expect(code(await fileHandoverProtocol(f.deps, f.ctx, { id: h.id, bytes: pdfBytes() }))).toBe('handoverStepsOpen');
    unwrap(await recordHandoverInterimReport(f.deps, f.ctx, { id: h.id }));
    expect(code(await fileHandoverProtocol(f.deps, f.ctx, { id: h.id, bytes: pdfBytes() }))).toBe('handoverStepsOpen');
    unwrap(await count(h.id, { counterTwoContactId: (await person('Zeugin')).id }));
    expect(code(await fileHandoverProtocol(f.deps, { ...f.ctx, channel: 'mcp' }, { id: h.id, bytes: pdfBytes() }))).toBe('humanOnly');
    const done = unwrap(await fileHandoverProtocol(f.deps, f.ctx, { id: h.id, bytes: pdfBytes(), fileName: 'protokoll.pdf' }));
    expect(done.state).toBe('done');
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, done.protocolDocumentId!)).get()!;
    expect(doc.typeKey).toBe('finance-handover-protocol');
    const links = f.deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, doc.id)).all().map((l) => `${l.entityType}:${l.entityId}`);
    expect(links.sort()).toEqual([`financeFiscalYear:${y2026}`, `financeHandover:${h.id}`].sort());
    expect(JSON.parse(auditEntry(f.deps, 'finance.handover.protocolFile').params!)).toEqual({ handoverOn: '2026-06-30', documentNumber: doc.number });
    expect(code(await cancelHandover(f.deps, f.ctx, { id: h.id }))).toBe('handoverDone');
    expect(unwrap(await getHandover(f.deps, f.ctx, { id: h.id })).state).toBe('done');
    allowHumanOnlyOverMcp(f.deps);
  });

  it('a finished handover separates the discharge of the two in the assembly list', async () => {
    const { f, y2026, start, person, count, carl, dana } = await setup();
    const h = await start();
    unwrap(await recordHandoverInterimReport(f.deps, f.ctx, { id: h.id }));
    unwrap(await count(h.id, { counterTwoContactId: (await person('Zeugin')).id }));
    unwrap(await fileHandoverProtocol(f.deps, f.ctx, { id: h.id, bytes: pdfBytes() }));
    const persons = unwrap(await getAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2026 })).persons;
    expect(persons.find((p) => p.contactId === carl.id)).toMatchObject({ until: '2026-06-30' });
    expect(persons.find((p) => p.contactId === dana.id)).toMatchObject({ since: '2026-07-01', until: null });
  });
});
