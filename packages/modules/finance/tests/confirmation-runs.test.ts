import { schema, unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { issueConfirmation, voidConfirmation } from '../src/donations/confirmations';
import { saveInKindDetails } from '../src/donations/in-kind';
import { previewConfirmationRun, type RunPreviewItem } from '../src/donations/runs';
import { bookEntry } from '../src/ledger/finalize';
import { reverseEntry } from '../src/ledger/reverse';
import { financeMoneyLines } from '../src/schema';
import { insertDocument } from './helpers';
import { donationFixture, err, type DonationFixture } from './donation-fixture';

const inKindDetails = { item: 'Transportbox aus Kunststoff', condition: 'gebraucht, guter Zustand', valuation: 'Kaufpreis laut Rechnung, abzüglich Gebrauch', origin: 'private' as const };

const setSetting = (f: DonationFixture, key: string, value: unknown) =>
  f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), key, value, 'test.confirmationRuns'));

const person = async (f: DonationFixture, firstName: string, lastName: string, address = true) =>
  unwrap(await createContact(f.deps, f.manage, { kind: 'person', firstName, lastName, ...(address ? { street: 'Probeweg 3', postalCode: '11111', city: 'Probestadt' } : {}) }));

const itemsOf = (items: readonly RunPreviewItem[], contactId: string) => items.filter((i) => i.contactId === contactId);

describe('previewConfirmationRun', () => {
  it('groups one collective per contact for money and fees, a separate waiver collective, and one in-kind item per line', async () => {
    const f = await donationFixture({ machine: true });
    const money = await f.donate({ date: '2026-01-15', cents: 5000 });
    const fee = await f.donate({ date: '2026-02-01', cents: 3600, categoryKey: 'membership-fees' });
    const waiver = await f.waive({ date: '2026-02-10', cents: 4200 });
    const described = await f.giveInKind({ date: '2026-02-20', cents: 25000 });
    const proof = insertDocument(f, { subject: 'Rechnung der Transportbox' });
    unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: described.line.id, ...inKindDetails, proofDocumentId: proof }));
    const undescribed = await f.giveInKind({ date: '2026-03-01', cents: 9000 });
    f.attachVoucher(undescribed.entry.id);

    const preview = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    expect(preview).toMatchObject({ year: 2026, minCents: 0, excludedContactIds: [], issuedOn: '2026-03-20', blockedRun: null, numberRange: { from: 'ZWB-2026-001', count: 3 } });
    expect(preview.counts).toEqual({ ready: 1, needsSignature: 2, addressMissing: 0, blocked: 1 });
    expect(preview.items).toEqual([
      { contactId: f.erika.id, contactName: 'Erika Beispiel', kind: 'collective', inKindLineId: null, lineIds: [money.line.id, fee.line.id], totalCents: 8600, lineCount: 2, alreadyConfirmedSingly: 0, group: 'ready', blockedBy: null, signatureReason: null },
      { contactId: f.erika.id, contactName: 'Erika Beispiel', kind: 'collectiveWaiver', inKindLineId: null, lineIds: [waiver.line.id], totalCents: 4200, lineCount: 1, alreadyConfirmedSingly: 0, group: 'needsSignature', blockedBy: null, signatureReason: 'expenseWaiver' },
      { contactId: f.erika.id, contactName: 'Erika Beispiel', kind: 'inKind', inKindLineId: described.line.id, lineIds: [described.line.id], totalCents: 25000, lineCount: 1, alreadyConfirmedSingly: 0, group: 'needsSignature', blockedBy: null, signatureReason: 'inKind' },
      { contactId: f.erika.id, contactName: 'Erika Beispiel', kind: 'inKind', inKindLineId: undescribed.line.id, lineIds: [undescribed.line.id], totalCents: 9000, lineCount: 1, alreadyConfirmedSingly: 0, group: 'blocked', blockedBy: 'inKindDetails', signatureReason: null },
    ]);
  });

  it('puts in-kind and expense-waiver items into needsSignature even with a complete machine procedure', async () => {
    // R 10b.1 Abs. 4 S. 3 EStR: Die Regelung gilt nicht für Sach- und Aufwandsspenden.
    const f = await donationFixture({ machine: true });
    const waiver = await f.waive({ date: '2026-02-10', cents: 4200 });
    const gift = await f.giveInKind({ date: '2026-02-20', cents: 25000 });
    const proof = insertDocument(f, { subject: 'Rechnung der Transportbox' });
    unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, ...inKindDetails, proofDocumentId: proof }));

    const preview = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    expect(preview.items.find((i) => i.lineIds.includes(waiver.line.id))).toMatchObject({ kind: 'collectiveWaiver', group: 'needsSignature', signatureReason: 'expenseWaiver' });
    expect(preview.items.find((i) => i.lineIds.includes(gift.line.id))).toMatchObject({ kind: 'inKind', group: 'needsSignature', signatureReason: 'inKind' });
  });

  it('counts lines already confirmed singly and leaves them out', async () => {
    const f = await donationFixture();
    const single = await f.donate({ date: '2026-01-10', cents: 1000 });
    const a = await f.donate({ date: '2026-02-10', cents: 2000 });
    const b = await f.donate({ date: '2026-03-10', cents: 3000 });
    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [single.line.id] }));

    // Max: zwei Zeilen in einer Sammelbestätigung zählen nicht als „einzeln bestätigt“.
    const max = await person(f, 'Max', 'Probe');
    const m1 = await f.donate({ date: '2026-01-05', cents: 1500, contactId: max.id });
    const m2 = await f.donate({ date: '2026-01-06', cents: 1500, contactId: max.id });
    const m3 = await f.donate({ date: '2026-01-07', cents: 700, contactId: max.id });
    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [m1.line.id, m2.line.id], kind: 'collective' }));

    const preview = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    // Ohne vollständiges maschinelles Verfahren braucht auch die Sammelbestätigung eine Unterschrift.
    expect(itemsOf(preview.items, f.erika.id)).toEqual([
      expect.objectContaining({ kind: 'collective', lineIds: [a.line.id, b.line.id], totalCents: 5000, lineCount: 2, alreadyConfirmedSingly: 1, group: 'needsSignature', signatureReason: 'machineIncomplete' }),
    ]);
    expect(itemsOf(preview.items, max.id)).toEqual([expect.objectContaining({ kind: 'collective', lineIds: [m3.line.id], totalCents: 700, lineCount: 1, alreadyConfirmedSingly: 0 })]);
    expect(preview.numberRange).toEqual({ from: 'ZWB-2026-003', count: 2 });
  });

  it('puts a contact without address into addressMissing and a contact under the minimum out', async () => {
    const f = await donationFixture();
    const nora = await person(f, 'Nora', 'Ohneort', false);
    await f.donate({ cents: 2000, contactId: nora.id });
    const paul = await person(f, 'Paul', 'Klein');
    await f.donate({ cents: 500, contactId: paul.id });
    await f.donate({ cents: 400, contactId: paul.id, categoryKey: 'membership-fees' });
    // Erika liegt nur mit beiden Arten zusammen über der Grenze — die Summe zählt je Kontakt.
    await f.donate({ cents: 800 });
    await f.waive({ cents: 300 });

    const preview = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026, minCents: 1000 }));
    expect(preview.minCents).toBe(1000);
    expect(itemsOf(preview.items, nora.id)).toEqual([expect.objectContaining({ kind: 'collective', group: 'addressMissing', blockedBy: 'contactComplete', totalCents: 2000 })]);
    expect(itemsOf(preview.items, paul.id)).toEqual([]);
    expect(itemsOf(preview.items, f.erika.id).map((i) => i.kind)).toEqual(['collective', 'collectiveWaiver']);
    expect(preview.counts).toEqual({ ready: 0, needsSignature: 2, addressMissing: 1, blocked: 0 });
    expect(preview.numberRange.count).toBe(2);

    // Ohne Angabe gilt der Mindestbetrag aus den Einstellungen.
    setSetting(f, 'finance.batchMinimumCents', 1000);
    expect(unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026 })).minCents).toBe(1000);
    expect(unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026, minCents: 0 })).items.filter((i) => i.contactId === paul.id)).toHaveLength(1);
  });

  it('excludes anonymous lines, reversed lines, excluded contacts and lines in a valid confirmation', async () => {
    const f = await donationFixture();
    const kept = await f.donate({ date: '2026-01-10', cents: 1000 });
    await f.donate({ date: '2026-01-11', cents: 9900, contactId: null });
    const reversed = await f.donate({ date: '2026-01-12', cents: 2200 });
    unwrap(await reverseEntry(f.deps, f.ctx, { id: reversed.entry.id }));
    const confirmed = await f.donate({ date: '2026-01-13', cents: 3300 });
    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [confirmed.line.id] }));
    const voided = await f.donate({ date: '2026-01-14', cents: 4400 });
    const gone = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [voided.line.id] }));
    unwrap(await voidConfirmation(f.deps, f.ctx, { id: gone.id, note: 'Betrag falsch', alreadySent: false }));
    const returned = await f.donate({ date: '2026-01-15', cents: 1200 });
    await f.giveBack(returned.line.id, 1200);
    const partly = await f.donate({ date: '2026-01-16', cents: 2500 });
    await f.giveBack(partly.line.id, 500);
    await f.donate({ date: '2025-12-30', cents: 7700 });
    const max = await person(f, 'Max', 'Probe');
    await f.donate({ date: '2026-01-17', cents: 6600, contactId: max.id });

    const preview = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026, excludedContactIds: [max.id] }));
    expect(preview.excludedContactIds).toEqual([max.id]);
    expect(preview.items).toEqual([
      expect.objectContaining({ contactId: f.erika.id, kind: 'collective', lineIds: [kept.line.id, voided.line.id, partly.line.id], totalCents: 1000 + 4400 + 2000, lineCount: 3, alreadyConfirmedSingly: 1 }),
    ]);
  });

  it('blocks the whole run without a valid notice, naming the remedy', async () => {
    const f = await donationFixture({ notice: false });
    await f.donate();
    const preview = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    expect(preview.blockedRun).toEqual({ reason: 'noNotice', remedy: { href: '/finance/donations/notices', labelKey: 'recordNotice' } });
    // Die Posten stehen trotzdem da — die Sperre gilt dem Lauf, nicht dem Spender.
    expect(preview.items).toEqual([expect.objectContaining({ contactId: f.erika.id, group: 'needsSignature', blockedBy: null })]);

    const g = await donationFixture();
    await g.donate();
    setSetting(g, 'organization.street', '');
    expect(unwrap(await previewConfirmationRun(g.deps, g.ctx, { year: 2026 })).blockedRun).toEqual({ reason: 'organizationIncomplete', remedy: { href: '/admin/settings', labelKey: 'completeOrganization' } });
  });

  it('needs finance.read and validates the year', async () => {
    const f = await donationFixture();
    await f.donate();
    const before = f.deps.db.select().from(schema.auditLog).all().length;
    expect(err(await previewConfirmationRun(f.deps, ctxWith(['finance.overview'], f.userId), { year: 2026 }))).toEqual({ type: 'forbidden', permission: 'finance.read' });
    for (const input of [{}, { year: '2026' }, { year: 1999 }, { year: 2026.5 }, { year: 2026, minCents: -1 }, { year: 2026, excludedContactIds: [''] }]) {
      expect(err(await previewConfirmationRun(f.deps, f.ctx, input))).toMatchObject({ type: 'validation' });
    }
    // Ein Jahr in der Zukunft lässt sich heute nicht bestätigen.
    expect(err(await previewConfirmationRun(f.deps, f.ctx, { year: 2027 }))).toMatchObject({ type: 'validation', issues: [{ path: 'year', message: 'inFuture' }] });
    expect(err(await previewConfirmationRun(f.deps, f.ctx, { year: 2026, followUpOfRunId: 'fehlt' }))).toMatchObject({ type: 'notFound' });
    expect(unwrap(await previewConfirmationRun(f.deps, ctxWith(['finance.read'], f.userId), { year: 2026 })).items).toHaveLength(1);
    // Eine Vorschau schreibt nichts.
    expect(f.deps.db.select().from(schema.auditLog).all()).toHaveLength(before);
  });

  it('leaves out lines dated after the issue day', async () => {
    const f = await donationFixture();
    const early = await f.donate({ date: '2026-03-05', cents: 1000 });
    await f.donate({ date: '2026-03-15', cents: 2000 });
    // Gebucht ist schon, was erst nach dem Ausstellungstag liegt — es gehört nicht in eine Bestätigung von heute.
    f.deps.clock.set('2026-03-10T10:00:00.000Z');

    const preview = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    expect(preview.issuedOn).toBe('2026-03-10');
    expect(preview.items).toEqual([expect.objectContaining({ contactId: f.erika.id, lineIds: [early.line.id], totalCents: 1000, lineCount: 1 })]);
  });

  it('shows donations before the oldest notice as blocked by beforeOldestNotice', async () => {
    const f = await donationFixture();
    const early = await f.donate({ date: '2025-03-01', cents: 1000 });
    const max = await person(f, 'Max', 'Probe');
    await f.donate({ date: '2025-06-01', cents: 2000, contactId: max.id });

    const preview = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2025 }));
    expect(itemsOf(preview.items, f.erika.id)).toEqual([expect.objectContaining({ lineIds: [early.line.id], group: 'blocked', blockedBy: 'beforeOldestNotice', signatureReason: 'machineIncomplete' })]);
    expect(itemsOf(preview.items, max.id)).toEqual([expect.objectContaining({ group: 'needsSignature', blockedBy: null })]);
    expect(preview.counts).toEqual({ ready: 0, needsSignature: 1, addressMissing: 0, blocked: 1 });
  });

  it('Prüfstein 2: three donors in one payout become three items; the fee line is no donation', async () => {
    const f = await donationFixture({ machine: true });
    const anna = await person(f, 'Anna', 'Alpha');
    const bert = await person(f, 'Bert', 'Beta');
    const entry = unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-02-15',
        text: 'Auszahlung Zahlungsdienst',
        moneyLines: [{ accountId: f.bank.id, amountCents: 5820 }],
        allocationLines: [
          { categoryId: f.categoryByKey('donations').id, amountCents: 3000, contactId: anna.id },
          { categoryId: f.categoryByKey('donations').id, amountCents: 2000, contactId: bert.id },
          { categoryId: f.categoryByKey('donations').id, amountCents: 1000, contactId: f.erika.id },
          { categoryId: f.categoryByKey('payment-fees').id, amountCents: -180 },
        ],
      }),
    );
    f.deps.db.update(financeMoneyLines).set({ rawTransactionId: `R-${entry.id}` }).where(eq(financeMoneyLines.entryId, entry.id)).run();
    const donationLines = entry.allocationLines.filter((l) => l.amountCents > 0);

    const preview = unwrap(await previewConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    expect(preview.items.map((i) => [i.contactName, i.kind, i.lineIds, i.totalCents, i.group])).toEqual([
      ['Anna Alpha', 'collective', [donationLines[0]!.id], 3000, 'ready'],
      ['Bert Beta', 'collective', [donationLines[1]!.id], 2000, 'ready'],
      ['Erika Beispiel', 'collective', [donationLines[2]!.id], 1000, 'ready'],
    ]);
    expect(preview.items.flatMap((i) => i.lineIds)).not.toContain(entry.allocationLines.find((l) => l.amountCents < 0)!.id);
    expect(preview.numberRange).toEqual({ from: 'ZWB-2026-001', count: 3 });
  });
});
