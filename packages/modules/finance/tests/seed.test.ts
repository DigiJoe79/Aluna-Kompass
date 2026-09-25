import { fakeTextExtraction, getEffectivePermissions, schema, unwrap } from '@kompass/core';
import { insertUser, systemContext } from '@kompass/core/testing';
import { contactRoles, contacts } from '@kompass/module-contacts';
import { projects } from '@kompass/module-projects';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { installFinance } from '../src/install';
import { listAccounts } from '../src/ledger/accounts';
import { listCategories } from '../src/ledger/categories';
import { listAllocationCorrections } from '../src/ledger/corrections';
import { getEntry } from '../src/ledger/entries';
import { listFiscalYears } from '../src/ledger/fiscal-years';
import { listCandidates } from '../src/import/candidates';
import { listImportProfiles } from '../src/import/profiles';
import { listImportRuns } from '../src/import/runs';
import { listImportRules } from '../src/import/rules';
import { listContactIbans } from '../src/import/contact-ibans';
import { listForeignMoney } from '../src/import/transit';
import { listVouchersWithoutEntry } from '../src/ledger/vouchers';
import { listWorkItems } from '../src/import/work';
import { suggestForTransaction } from '../src/import/suggestions';
import { listRawTransactions } from '../src/import/queries';
import { buildInvoiceXml, OFFICE_INVOICE, VET_INVOICE } from '../src/import/zugferd-fixture';
import { invoiceProposal } from '../src/import/zugferd/read';
import { listOpenItems } from '../src/ledger/open-items';
import { getBalances } from '../src/ledger/overview';
import { getProjectFinance } from '../src/ledger/project-settings';
import { listPurposes } from '../src/ledger/purposes';
import { financeEntries, financeEntryDocuments } from '../src/schema';
import { seedFinance } from '../src/seed';
import { setupFinance } from './helpers';

describe('seedFinance', () => {
  it('builds an invented association year and is idempotent', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);
    const accounts = unwrap(await listAccounts(deps, ctx, { includeInactive: true }));
    // F4 Task 8: „Importkonto“ kommt als drittes Bankkonto dazu (eigens für die Kontoauszug-Fixtures);
    // F4b: „Zweitbank CSV“ als viertes, mit selbst eingerichtetem CSV-Format.
    expect(accounts.map((a) => a.kind).sort()).toEqual(['bank', 'bank', 'bank', 'bank', 'cash', 'cash', 'paymentService']);
    expect(accounts.filter((a) => a.isMain)).toHaveLength(1);
    expect(accounts.some((a) => !a.isActive)).toBe(true);
    expect(unwrap(await listFiscalYears(deps, ctx))).toHaveLength(2);
    const purposes = unwrap(await listPurposes(deps, ctx, { includeInactive: true }));
    expect(purposes).toHaveLength(5);
    expect(purposes.some((p) => p.abroad) && purposes.some((p) => p.fulfilledAt !== null)).toBe(true);
    expect(unwrap(await listCategories(deps, ctx, {})).map((c) => c.key)).toContain('room-rental');
  });

  it('carries no real bank code — only the invented DE (99999999/00000000) and AT (99999/00000) ones', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    const accounts = unwrap(await listAccounts(deps, ctx, { includeInactive: true }));
    const ibans = accounts.map((a) => a.iban).filter((iban): iban is string => iban !== null);
    expect(ibans.length).toBeGreaterThan(0);
    for (const iban of ibans) {
      if (iban.startsWith('DE')) expect(['99999999', '00000000'], iban).toContain(iban.slice(4, 12));
      else if (iban.startsWith('AT')) expect(['99999', '00000'], iban).toContain(iban.slice(4, 9));
      else throw new Error(`unerwartetes IBAN-Länderkennzeichen: ${iban}`);
    }
  });

  it('closes the previous fiscal year — a booking without a voucher is justified, not blocking', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);
    const years = unwrap(await listFiscalYears(deps, ctx));
    const previous = years.find((y) => y.designation !== years.reduce((a, b) => (a.designation > b.designation ? a : b)).designation)!;
    expect(previous.status).toBe('closed');
  });

  it('flags a purpose in the red and a purpose fulfilled with rest', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    const balances = unwrap(await getBalances(deps, ctx, {}));
    const sommerfest = balances.purposes.find((p) => p.negative);
    expect(sommerfest).toBeTruthy();
    const floodlight = balances.purposes.find((p) => p.fulfilledWithRest);
    expect(floodlight).toBeTruthy();
  });

  it('gives an existing project finance fields', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    const existingProject = deps.db.select({ id: projects.id }).from(projects).limit(1).get();
    if (!existingProject) return; // Kein Projekte-Seed installiert — nichts zu prüfen.
    const read = unwrap(await getProjectFinance(deps, ctx, { projectId: existingProject.id }));
    expect(read.settings.targetCents).toBe(250000);
    expect(read.settings.defaultPurposeId).not.toBeNull();
  });

  it('seeds two CSV accounts, each with its format and one finished CSV run, idempotently (F4b)', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);
    const accounts = unwrap(await listAccounts(deps, ctx, { includeInactive: true }));
    const { profiles } = unwrap(await listImportProfiles(deps, ctx, {}));
    for (const [name, formatName] of [['Spendenplattform', 'Spendenplattform CSV'], ['Zweitbank CSV', 'Zweitbank CSV']] as const) {
      const account = accounts.find((a) => a.name === name)!;
      expect(account, name).toMatchObject({ importFormat: 'csv' });
      expect(profiles.find((p) => p.id === account.importProfileId), name).toMatchObject({ name: formatName, runCount: 1 });
      const { runs } = unwrap(await listImportRuns(deps, ctx, { accountId: account.id }));
      expect(runs, name).toHaveLength(1);
      expect(runs[0], name).toMatchObject({ format: 'csv', formatName, state: 'finished' });
    }
    const service = unwrap(await listImportRuns(deps, ctx, { accountId: accounts.find((a) => a.name === 'Spendenplattform')!.id })).runs[0]!;
    expect(service).toMatchObject({ openingCents: 10000, closingCents: 785, counts: { new: 5, known: 0, held: 0, pendingSkipped: 2 } });
  });

  it('seeds "Importkonto" with two finished runs (one with a gap), an open candidate, a discarded and a failed run, one booked and several open raw transactions', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx); // idempotent: kein zweiter Satz Läufe.

    const accounts = unwrap(await listAccounts(deps, ctx, { includeInactive: true }));
    const importkonto = accounts.find((a) => a.name === 'Importkonto')!;
    expect(importkonto).toBeTruthy();
    expect(importkonto.iban).toBe('DE60999999990201051234');

    const runs = unwrap(await listImportRuns(deps, ctx, { accountId: importkonto.id }));
    expect(runs.total).toBe(7); // A, B, C fertig; D verworfen; E fehlgeschlagen; dazu der Juli- und der August-Auszug (F5).
    expect(runs.runs.filter((r) => r.state === 'finished')).toHaveLength(5);
    expect(runs.runs.filter((r) => r.state === 'discarded')).toHaveLength(1);
    expect(runs.runs.some((r) => r.gap !== null)).toBe(true);

    const failed = runs.runs.filter((r) => r.state === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.failure?.code).toBe('sumMismatch');

    const candidates = unwrap(await listCandidates(deps, ctx, { open: true }));
    expect(candidates.candidates.filter((c) => c.accountId === importkonto.id)).toHaveLength(1);

    const raws = unwrap(await listRawTransactions(deps, ctx, { accountId: importkonto.id }));
    // Gebucht: die Spende aus Lauf A; gebunden an den Agenten-Entwurf (F5): „Spende April“; das fremde Geld aus dem Juli;
    // der Mitgliedsbeitrag aus dem August, dessen Lastschrift zurückkommt (F5 Task 9).
    expect(raws.items.filter((r) => r.state === 'booked')).toHaveLength(4);
    expect(raws.items.filter((r) => r.state === 'open').length).toBeGreaterThanOrEqual(2);

    // Zweiter Seed-Lauf legt nichts doppelt an (idempotent).
    const runsAfterSecondSeed = unwrap(await listImportRuns(deps, ctx, { accountId: importkonto.id }));
    // Fünf aus F4, dazu der Juli-Auszug mit dem fremden Geld (F5 Task 8) und der August-Auszug (F5 Task 9).
    expect(runsAfterSecondSeed.total).toBe(7);
  });

  it('seeds the work list on "Importkonto": two rules (one with an inactive category), a contact iban, a hand draft without a transaction and an agent draft (F5, idempotent)', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx); // idempotent

    const importkonto = unwrap(await listAccounts(deps, ctx, { includeInactive: true })).find((a) => a.name === 'Importkonto')!;
    const { rules } = unwrap(await listImportRules(deps, ctx, {}));
    expect(rules).toHaveLength(2);
    // Zuerst die enge Regel mit stillgelegter Kategorie (Review Focus 2) — sie trifft nur den Dezember-Auszug der E2E.
    expect(rules[0]).toMatchObject({ name: 'Bürobedarf Dezember', accountId: importkonto.id, textContains: 'dezember', categoryInactive: true });
    expect(rules[1]).toMatchObject({ name: 'Büromaterial', accountId: importkonto.id, textContains: 'bueromaterial', categoryInactive: false });

    const erika = deps.db.select().from(contacts).where(eq(contacts.lastName, 'Beispiel')).all();
    expect(erika).toHaveLength(1);
    const ibans = unwrap(await listContactIbans(deps, ctx, { contactId: erika[0]!.id }));
    expect(ibans.items.map((i) => i.iban)).toEqual(['DE66999999991234567890']);

    // Die Handbuchung ohne Kontoumsatz: Entwurf, auf den der Zuschuss aus Lauf B passt (Vorschlag 0).
    const work = unwrap(await listWorkItems(deps, ctx, { tab: 'open', accountId: importkonto.id, limit: 50, offset: 0 }));
    const kinds = work.items.map((i) => (i.type === 'transaction' ? [i.transaction.purpose, i.suggestion.kind] : null));
    expect(kinds).toEqual([
      ['Bueromaterial', 'rule'],
      ['Zuschuss', 'linkEntry'],
      ['Bareinzahlung Spendendose', 'cashTransfer'],
      ['Mitgliedsbeitrag August, Lastschrift zurueckgegeben', 'return'],
    ]);
    const handDrafts = deps.db.select().from(financeEntries).where(eq(financeEntries.text, 'Zuschuss')).all();
    expect(handDrafts).toHaveLength(1);
    expect(handDrafts[0]!.status).toBe('draft');

    // Der Agenten-Entwurf: über MCP angelegt, bindet „Spende April“, ungeprüft.
    const agent = unwrap(await listWorkItems(deps, ctx, { tab: 'agent', accountId: importkonto.id, limit: 50, offset: 0 }));
    expect(agent.items).toHaveLength(1);
    expect(agent.items[0]).toMatchObject({ type: 'entry', entry: { text: 'Spende April', createdChannel: 'mcp', reviewedAt: null } });
  });

  it('seeds money that does not belong to the association and a voucher without an entry (F5 Task 8, idempotent)', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx); // idempotent

    // Ein Eingang über 120,00 € für den Nachbarverein, noch nicht weitergegeben.
    const foreign = unwrap(await listForeignMoney(deps, ctx));
    expect(foreign.items).toHaveLength(1);
    expect(foreign.items[0]).toMatchObject({ amountCents: 12000, holderText: 'Nachbarverein Beispielstadt', entryDate: '2026-07-06' });
    const importkonto = unwrap(await listAccounts(deps, ctx, { includeInactive: true })).find((a) => a.name === 'Importkonto')!;
    const raws = unwrap(await listRawTransactions(deps, ctx, { accountId: importkonto.id, limit: 200 }));
    expect(raws.items.find((r) => r.purpose === 'Sammelbestellung Futter, für Nachbarverein')).toMatchObject({ amountCents: 12000, state: 'booked' });

    // Eine Eingangsrechnung ohne Buchung — „Beleg suchen“ findet sie über den Betrag der Büromaterial-Zeile (−35,00 €).
    const vouchers = unwrap(await listVouchersWithoutEntry(deps, ctx, {}));
    expect(vouchers.documents.map((d) => [d.subject, d.typeKey])).toContainEqual(['Rechnung Büromaterial über 35,00 €', 'voucher-invoice']);
  });

  it('seeds two ZUGFeRD invoices without an entry — the vet invoice unpaid, the office invoice paid by the office-supply line on "Importkonto" (F5b, idempotent)', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx); // idempotent

    const vouchers = unwrap(await listVouchersWithoutEntry(deps, ctx, {})).documents;
    const vet = vouchers.filter((d) => d.subject === 'Rechnung TM-2026-0042 Tierarztpraxis Muster');
    const office = vouchers.filter((d) => d.subject === 'Rechnung BM-7781 Bürobedarf Muster GmbH');
    expect(vet).toHaveLength(1);
    expect(office).toHaveLength(1);
    expect(vet[0]).toMatchObject({ typeKey: 'voucher-invoice', documentDate: '2026-04-01' });

    // Die Anhänge liest in Unit-Tests eine Attrappe — sie liefert das XML, das im PDF steckt.
    const withAttachment = (xml: string) => {
      deps.textExtraction = fakeTextExtraction({ embedded: [{ name: 'factur-x.xml', bytes: new TextEncoder().encode(xml), mimeType: 'text/xml' }] });
    };
    withAttachment(buildInvoiceXml({ ...VET_INVOICE, taxes: [...VET_INVOICE.taxes] }));
    expect(unwrap(await invoiceProposal(deps, ctx, { documentId: vet[0]!.id }))).toMatchObject({ kind: 'unpaid', existingOpenItemId: null, invoice: { grandTotalCents: 11900, dueDate: '2026-04-30' } });

    withAttachment(buildInvoiceXml({ ...OFFICE_INVOICE, taxes: [...OFFICE_INVOICE.taxes] }));
    const importkonto = unwrap(await listAccounts(deps, ctx, { includeInactive: true })).find((a) => a.name === 'Importkonto')!;
    const officeLine = unwrap(await listRawTransactions(deps, ctx, { accountId: importkonto.id, limit: 200 })).items.find((r) => r.bankReference === 'IMP-0002')!;
    expect(officeLine).toMatchObject({ amountCents: -3500, state: 'open' });
    expect(unwrap(await invoiceProposal(deps, ctx, { documentId: office[0]!.id }))).toMatchObject({ kind: 'paid', rawTransactionId: officeLine.id, bookingDate: '2026-01-10' });
  });

  it('seeds an August statement with a cash deposit and a returned payment on "Importkonto" (F5 Task 9, idempotent)', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx); // idempotent

    const accounts = unwrap(await listAccounts(deps, ctx, { includeInactive: true }));
    const importkonto = accounts.find((a) => a.name === 'Importkonto')!;
    const cash = accounts.find((a) => a.name === 'Barkasse')!;
    const runs = unwrap(await listImportRuns(deps, ctx, { accountId: importkonto.id }));
    const august = runs.runs.filter((r) => r.fileName === 'kontoauszug-2026-08.xml');
    expect(august).toHaveLength(1);
    // Schließt an den Juli-Auszug an — keine Lücke.
    expect(august[0]).toMatchObject({ state: 'finished', gap: null });

    const raws = unwrap(await listRawTransactions(deps, ctx, { accountId: importkonto.id, limit: 200 }));
    const deposit = raws.items.find((r) => r.purpose === 'Bareinzahlung Spendendose')!;
    expect(deposit).toMatchObject({ amountCents: 20000, state: 'open' });
    const fee = raws.items.find((r) => r.purpose === 'Mitgliedsbeitrag August')!;
    expect(fee).toMatchObject({ amountCents: 2500, state: 'booked' });
    const returned = raws.items.find((r) => r.purpose === 'Mitgliedsbeitrag August, Lastschrift zurueckgegeben')!;
    expect(returned).toMatchObject({ amountCents: -2500, state: 'open', returnCode: 'AC04' });

    // Die Bar-Kennung schlägt die Umbuchung gegen die Barkasse vor, der Rückgabe-Code die zurückgegebene Zahlung.
    const deposited = unwrap(await suggestForTransaction(deps, ctx, { rawTransactionId: deposit.id }));
    expect(deposited).toMatchObject({ kind: 'cashTransfer', confidence: 'sure', reasons: [{ kind: 'cashKeyword', otherAccountId: cash.id }] });
    expect(deposited.draft!.moneyLines).toEqual([
      expect.objectContaining({ accountId: importkonto.id, amountCents: 20000, rawTransactionId: deposit.id }),
      expect.objectContaining({ accountId: cash.id, amountCents: -20000 }),
    ]);
    const back = unwrap(await suggestForTransaction(deps, ctx, { rawTransactionId: returned.id }));
    expect(back).toMatchObject({ kind: 'return', confidence: 'sure', reasons: [{ kind: 'returnCode' }] });
    expect(back.draft!.allocationLines).toEqual([expect.objectContaining({ amountCents: -2500, originLineId: expect.any(String) })]);
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
    for (const secret of [
      'Vereinskonto', 'Barkasse', 'Zählkasse', 'Spendenplattform', 'Sparbuch', 'Beispielbank', 'DE0212', 'AT9399', 'Dachsanierung', 'Jugendfreizeit', 'Flutlicht', 'Erika', 'Beispiel über', 'Raumvermietung',
      'Spende Altjahr', 'Bankgebühr Altjahr', 'Büromaterial Altjahr', 'Spende mit Zweck', 'Auszahlung Spendenplattform', 'Abhebung Barkasse', 'Bar-Ausgabe Fahrtkosten', 'Sachspende Werkzeug', 'Fehlerhafte Spendenbuchung', 'Entwurf geprüft', 'Entwurf ungeprüft', 'Entwurf ungeprüft zwei', 'Entwurf vom Agenten',
      'Wagner', 'Kruse',
      // F2b: Belege, offene Posten, Zuordnungskorrektur.
      'Rechnung Büromaterial', 'Falscher Anhang hochgeladen, richtige Quittung liegt vor',
      'RE-2026-041', 'RE-2026-055', 'SP-2026-003', 'RE-2026-060', 'ANT-2026-014', 'Doppelt erfasst, storniert vor Zahlung',
      'Teilzahlung Lieferant', 'Ausgleich Forderung',
      'Auslandsbezug bei der Erfassung übersehen', 'Spenderin nachträglich zugeordnet',
      // F2c: Begründung zum Periodenabschluss, neue Buchungstexte und Zwecke.
      'Kleinbetrag bar erhalten, kein Beleg ausgestellt',
      'Spende Flutlicht', 'Ausgabe Sommerfest', 'Sommerfest',
      // F3a-N Task 1: geteilte Buchung im Vorjahr mit einer wartenden Korrektur.
      'Sponsoring Altjahr', 'Sponsoringzusage ohne Rechnung erhalten', 'Projektzuordnung nachträglich korrigieren',
    ]) {
      expect(log, secret).not.toContain(secret);
    }
  });

  it('files a voucher on three entries, revokes and replaces one, and leaves one deliberately without', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);

    const byText = (text: string) => deps.db.select().from(financeEntries).where(eq(financeEntries.text, text)).get()!;
    const linksFor = (entryId: string) => deps.db.select().from(financeEntryDocuments).where(eq(financeEntryDocuments.entryId, entryId)).all();

    expect(linksFor(byText('Büromaterial Altjahr').id)).toHaveLength(1);
    expect(linksFor(byText('Bar-Ausgabe Fahrtkosten').id)).toHaveLength(1);
    const bankgebuehrLinks = linksFor(byText('Bankgebühr Altjahr').id);
    expect(bankgebuehrLinks).toHaveLength(2);
    expect(bankgebuehrLinks.some((l) => l.revokedAt !== null && l.replacedByLinkId !== null)).toBe(true);
    expect(linksFor(byText('Spende Altjahr').id)).toHaveLength(0);
  });

  it('seeds open items in every state: open, partially paid, settled, and cancelled without payment', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);

    const items = unwrap(await listOpenItems(deps, ctx, { state: 'all' })).items;
    const byRef = new Map(items.map((i) => [i.paymentReference, i]));
    expect(byRef.get('RE-2026-041')).toMatchObject({ state: 'open', settledCents: 0 });
    expect(byRef.get('RE-2026-055')?.state).toBe('open');
    expect(byRef.get('RE-2026-055')?.settledCents).toBeGreaterThan(0);
    expect(byRef.get('SP-2026-003')).toMatchObject({ state: 'settled' });
    expect(byRef.get('RE-2026-060')).toMatchObject({ state: 'cancelled' });
  });

  it('seeds an open item with an origin — F3b Task 3, A6 does not offer it "erledigt ohne Zahlung"', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx); // idempotent

    const items = unwrap(await listOpenItems(deps, ctx, { state: 'all' })).items;
    const withOrigin = items.find((i) => i.paymentReference === 'ANT-2026-014');
    expect(withOrigin).toMatchObject({ originType: 'demoProcess', originId: 'demo-1', state: 'open' });
  });

  it('seeds an applied correction in the running year and a pending one in the closed previous year, and is idempotent', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);

    const corrections = unwrap(await listAllocationCorrections(deps, ctx, {})).items;
    expect(corrections.filter((c) => c.state === 'applied').length).toBe(1);
    expect(corrections.filter((c) => c.state === 'pending').length).toBe(1);
  });

  it('books an entry in every state of a booking year, and is idempotent', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);

    const entries = deps.db.select().from(financeEntries).all();
    const byText = new Map(entries.map((e) => [e.text, e]));

    // Vorjahr: vier festgeschriebene Buchungen — kein Duplikat beim zweiten Lauf.
    for (const text of ['Spende Altjahr', 'Bankgebühr Altjahr', 'Büromaterial Altjahr', 'Sponsoring Altjahr']) {
      expect(entries.filter((e) => e.text === text), text).toHaveLength(1);
      expect(byText.get(text), text).toMatchObject({ status: 'final' });
    }

    // Laufendes Jahr: Split, Umbuchung, Barausgabe, Sachspende — alle festgeschrieben.
    for (const text of ['Spende mit Zweck', 'Auszahlung Spendenplattform', 'Abhebung Barkasse', 'Bar-Ausgabe Fahrtkosten', 'Sachspende Werkzeug']) {
      expect(byText.get(text), text).toMatchObject({ status: 'final' });
    }

    // Eine stornierte Buchung mit ihrem Storno.
    const original = byText.get('Fehlerhafte Spendenbuchung')!;
    expect(original).toMatchObject({ status: 'final' });
    expect(original.reversedByEntryId).not.toBeNull();
    const reversal = entries.find((e) => e.id === original.reversedByEntryId);
    expect(reversal).toMatchObject({ status: 'final', reversesEntryId: original.id });

    // Ein geprüfter, ein ungeprüfter, ein Entwurf vom Agenten — einer davon unausgeglichen.
    expect(byText.get('Entwurf geprüft')).toMatchObject({ status: 'draft' });
    expect(byText.get('Entwurf geprüft')!.reviewedAt).not.toBeNull();
    expect(byText.get('Entwurf ungeprüft')).toMatchObject({ status: 'draft', reviewedAt: null });
    // F3a: ein zweiter ausgeglichener, ungeprüfter Entwurf — die Mehrfachauswahl des Journals braucht zwei.
    expect(byText.get('Entwurf ungeprüft zwei')).toMatchObject({ status: 'draft', reviewedAt: null });
    const secondDraft = byText.get('Entwurf ungeprüft zwei')!;
    expect(unwrap(await getEntry(deps, ctx, { id: secondDraft.id })).remainderCents).toBe(0);
    const agentDraft = byText.get('Entwurf vom Agenten')!;
    expect(agentDraft).toMatchObject({ status: 'draft', createdChannel: 'mcp' });
    expect(unwrap(await getEntry(deps, ctx, { id: agentDraft.id })).remainderCents).not.toBe(0);

    // Zwei erfundene Spender-Kontakte mit Rolle donor.
    const donors = deps.db.select().from(contactRoles).where(eq(contactRoles.role, 'donor')).all();
    expect(donors.length).toBeGreaterThanOrEqual(2);
  });

  it('seeds a finalized purpose-bound income in the open year for the proof case (F3a-N Task 2)', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    const entry = deps.db.select().from(financeEntries).where(eq(financeEntries.text, 'Spende mit Zweck')).get()!;
    expect(entry.status).toBe('final');
    const view = unwrap(await getEntry(deps, ctx, { id: entry.id }));
    expect(view.allocationLines).toHaveLength(1);
    expect(view.allocationLines[0]!.purposeId).not.toBeNull();
    expect(view.allocationLines[0]!.contactId).not.toBeNull();
    const years = unwrap(await listFiscalYears(deps, ctx));
    const openYear = years.find((y) => y.id === entry.fiscalYearId);
    expect(openYear?.status).toBe('open');
  });

  it('seeds a closed year with a filed tax return and an entry in it for the section 153 case (F3a-N Task 2)', async () => {
    const { deps, ctx } = setupFinance();
    await seedFinance(deps, ctx);
    const years = unwrap(await listFiscalYears(deps, ctx));
    const closed = years.find((y) => y.status === 'closed')!;
    expect(closed.taxReturnFiledOn).not.toBeNull();
    const entriesInYear = deps.db.select().from(financeEntries).where(eq(financeEntries.fiscalYearId, closed.id)).all();
    expect(entriesInYear.some((e) => e.status === 'final')).toBe(true);
  });

  it('gives an existing „Mira Klein“ (Kernseed) finance.read without finance.entriesFinalize — for the missing „Korrigieren“ button', async () => {
    const { deps, ctx } = setupFinance();
    insertUser(deps, { name: 'Mira Klein', email: 'mira@kompass.local' });
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);

    const mira = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'mira@kompass.local')).get()!;
    const permissions = getEffectivePermissions(deps.db, deps.registry, mira.id);
    expect(permissions.has('finance.read')).toBe(true);
    expect(permissions.has('finance.entriesFinalize')).toBe(false);
  });

  it('gives an existing „Jonas Feld“ (Kernseed) finance.approve — so a waiting correction names someone besides the administration (F3a-N Task 2)', async () => {
    const { deps, ctx } = setupFinance();
    insertUser(deps, { name: 'Jonas Feld', email: 'jonas@kompass.local' });
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx);

    const jonas = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'jonas@kompass.local')).get()!;
    const permissions = getEffectivePermissions(deps.db, deps.registry, jonas.id);
    expect(permissions.has('finance.approve')).toBe(true);
  });

  it('invents a cash-only person with finance.entriesFinalize but no contacts.view (F3b Schritt 0)', async () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => installFinance(tx, deps, systemContext()));
    await seedFinance(deps, ctx);
    await seedFinance(deps, ctx); // idempotent

    const ines = deps.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, 'ines@kompass.local')).get()!;
    expect(ines).toBeDefined();
    const permissions = getEffectivePermissions(deps.db, deps.registry, ines.id);
    expect(permissions.has('finance.read')).toBe(true);
    expect(permissions.has('finance.entriesFinalize')).toBe(true);
    expect(permissions.has('contacts.view')).toBe(false);

    // Die Rolle ist ad hoc angelegt, nicht Teil der fünf Rollenvorschläge aus `installFinance`.
    const role = deps.db.select().from(schema.roles).where(eq(schema.roles.name, 'Kassenassistenz')).get()!;
    expect(role.originKey).toBeNull();
  });
});
