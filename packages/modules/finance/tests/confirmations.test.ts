import { schema, unwrap, writeSettingInternal } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { contactRoles, createContact } from '@kompass/module-contacts';
import { documentLinks, documents } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  attachSignedConfirmation,
  issueConfirmation,
  listConfirmations,
  listUncertifiedDonations,
  readConfirmationCopy,
  recordConfirmationDispatch,
  voidConfirmation,
} from '../src/donations/confirmations';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeConfirmationLines, financeConfirmations } from '../src/schema';
import { allowHumanOnlyOverMcp, pdfBytes } from './helpers';
import { donationFixture, err, type DonationFixture } from './donation-fixture';

const auditOf = (f: DonationFixture, action: string) => f.deps.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action)).all();
const confirmationDocuments = (f: DonationFixture) => f.deps.db.select().from(documents).where(eq(documents.typeKey, 'finance-confirmation')).all();
const snapshotOf = (f: DonationFixture, documentId: string) => JSON.parse(f.deps.db.select().from(documents).where(eq(documents.id, documentId)).get()!.inputSnapshot!);

describe('issueConfirmation', () => {
  it('issues a money confirmation as a filed document ZWB with lines, sets the donor role and snapshots facsimile checksum', async () => {
    const f = await donationFixture({ machine: true });
    const { entry, line } = await f.donate({ cents: 11919 });
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));

    expect(confirmation).toMatchObject({
      kind: 'money', contactId: f.erika.id, noticeId: f.notice!.id, issuedOn: '2026-03-20', issuedChannel: 'ui', machine: true, signerId: f.signerId,
      expenseWaiver: false, totalCents: 11919, state: 'valid', signatureState: 'machine', toCorrect: [], contactName: 'Erika Beispiel', voidedAt: null,
    });
    expect(confirmation.documentNumber).toMatch(/^ZWB-2026-/);
    expect(confirmation.lines).toEqual([{ lineId: line.id, entryId: entry.id, entryNumber: entry.number, amountCents: 11919, releasedAt: null }]);

    const [doc] = confirmationDocuments(f);
    expect(doc).toMatchObject({ id: confirmation.documentId, number: confirmation.documentNumber, phase: 'issued', status: 'issued', templateKey: 'finance-confirmation-money', documentDate: '2026-03-20' });
    // Der Betreff nennt keinen Namen — er steht in Listen der Akte.
    expect(doc!.subject).toBe('Zuwendungsbestätigung Geldzuwendung 2026-03-20');
    const links = f.deps.db.select().from(documentLinks).where(eq(documentLinks.documentId, doc!.id)).all().map((l) => `${l.entityType}:${l.entityId}`).sort();
    expect(links).toEqual([`financeConfirmation:${confirmation.id}`, `financeEntry:${entry.id}`].sort());

    // Unser Exemplar: im Snapshot die Prüfsumme des Faksimiles, nie seine Bytes.
    const snapshot = snapshotOf(f, doc!.id);
    expect(snapshot.images).toEqual({ signature: confirmation.facsimileChecksum });
    expect(snapshot.input.facsimile).toEqual({ checksum: confirmation.facsimileChecksum, mimeType: 'image/png' });
    expect(snapshot.input).toMatchObject({ amountCents: 11919, donatedOn: '2026-03-05', machine: true, signerName: 'Jonas Feld', recipient: { name: 'Erika Beispiel', addressLines: ['Beispielstraße 7', '54321 Beispielstadt'] } });

    const roles = f.deps.db.select().from(contactRoles).where(and(eq(contactRoles.contactId, f.erika.id), eq(contactRoles.role, 'donor'))).all();
    expect(roles).toMatchObject([{ since: '2026-03-20', until: null }]);

    const lineRows = f.deps.db.select().from(financeConfirmationLines).where(eq(financeConfirmationLines.confirmationId, confirmation.id)).all();
    expect(lineRows).toMatchObject([{ lineId: line.id, amountCents: 11919, releasedAt: null }]);
  });

  it('writes an audit entry with number, dates and amounts, never contact, name or reason', async () => {
    const f = await donationFixture();
    const early = await f.donate({ date: '2025-03-01', cents: 800 });
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [early.line.id], preNoticeReason: 'Zuwendung aus der Gründungsphase, Bescheid gilt rückwirkend' }));
    const [entry] = auditOf(f, 'finance.confirmation.issue');
    expect(entry).toMatchObject({ entityType: 'financeConfirmation', entityId: confirmation.id });
    expect(JSON.parse(entry!.after as string)).toEqual({ kind: 'money', noticeId: f.notice!.id, documentId: confirmation.documentId, documentNumber: confirmation.documentNumber, issuedOn: '2026-03-20', machine: false, signerId: null, expenseWaiver: false, totalCents: 800, lineCount: 1, channel: 'ui' });
    const all = JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action.startsWith('finance.')));
    expect(all).not.toContain(f.erika.id);
    expect(all).not.toMatch(/Erika|Beispiel|Gründungsphase/);
    expect(confirmation.preNoticeReason).toBe('Zuwendung aus der Gründungsphase, Bescheid gilt rückwirkend');
  });

  it('falls back to a signature field when the machine procedure is incomplete', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    // Unterzeichner mit Anzeige, aber ohne Faksimile.
    const { saveSigner } = await import('../src/donations/machine');
    unwrap(await saveSigner(f.deps, f.ctx, { validFrom: '2026-01-01', signerName: 'Jonas Feld', notifiedOn: '2026-02-01' }));
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(confirmation).toMatchObject({ machine: false, signerId: null, facsimileChecksum: null, signatureState: 'needsSignature' });
    const snapshot = snapshotOf(f, confirmation.documentId);
    expect(snapshot.images).toBeUndefined();
    expect(snapshot.input).toMatchObject({ machine: false, machineNotifiedOn: null, signerName: 'Jonas Feld' });
    expect(snapshot.input.facsimile).toBeUndefined();
  });

  it('an expense waiver is always issued with a signature field, even with a complete machine procedure', async () => {
    const f = await donationFixture({ machine: true });
    const { line } = await f.waive();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(confirmation).toMatchObject({ kind: 'money', expenseWaiver: true, machine: false, signatureState: 'needsSignature' });
    expect(snapshotOf(f, confirmation.documentId).input).toMatchObject({ expenseWaiver: true, machine: false });
  });

  it('refuses a second confirmation on the same line inside afterIssue and leaves no document behind', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    // Doppelklick: beide Aufrufe bestehen die Vorprüfung, bevor einer von ihnen festschreibt.
    const results = await Promise.all([issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }), issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] })]);
    const issued = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok);
    expect(issued).toHaveLength(1);
    expect(err(refused[0]!)).toMatchObject({ type: 'conflict', code: 'confirmationLineAlreadyConfirmed' });
    expect(confirmationDocuments(f)).toHaveLength(1);
    expect(f.deps.db.select().from(financeConfirmations).all()).toHaveLength(1);
    expect(f.deps.db.select().from(financeConfirmationLines).all()).toHaveLength(1);

    // Keine Nummer verbrannt: Die nächste Bestätigung trägt die unmittelbar folgende.
    const first = unwrap(issued[0]! as Awaited<ReturnType<typeof issueConfirmation>>);
    const next = await f.donate();
    const second = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [next.line.id] }));
    const seq = (n: string) => Number(n.split('-').at(-1));
    expect(seq(second.documentNumber)).toBe(seq(first.documentNumber) + 1);
  });

  it('refuses with the first blocking check as reason and issues nothing', async () => {
    const f = await donationFixture();
    const { line } = await f.donate({ contactId: f.donor.id });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }))).toMatchObject({ type: 'conflict', code: 'confirmationContactIncomplete' });
    const noVoucher = await f.donate({ documented: false });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [noVoucher.line.id] }))).toMatchObject({ type: 'conflict', code: 'confirmationEntryUndocumented' });
    const early = await f.donate({ date: '2025-03-01' });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [early.line.id], issuedOn: '2025-04-01', preNoticeReason: 'x' }))).toMatchObject({ type: 'conflict', code: 'noNoticeValidAt' });
    expect(confirmationDocuments(f)).toHaveLength(0);
  });

  it('refuses in-kind lines in a money confirmation and vice versa', async () => {
    const f = await donationFixture();
    const gift = await f.giveInKind();
    const money = await f.donate();
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [gift.line.id], kind: 'money' }))).toMatchObject({ type: 'conflict', code: 'confirmationInKindMixed' });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [money.line.id], kind: 'inKind' }))).toMatchObject({ type: 'conflict', code: 'confirmationInKindMixed' });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [money.line.id, gift.line.id], kind: 'collective' }))).toMatchObject({ type: 'conflict', code: 'confirmationInKindMixed' });
  });

  it('requires a reason when the donation predates the oldest notice', async () => {
    const f = await donationFixture();
    const early = await f.donate({ date: '2025-03-01' });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [early.line.id] }))).toMatchObject({ type: 'conflict', code: 'confirmationPreNoticeNeedsReason' });
    expect(unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [early.line.id], preNoticeReason: 'Bescheid gilt für 2025 rückwirkend' })).preNoticeReason).toBe('Bescheid gilt für 2025 rückwirkend');
  });

  it('issues a collective confirmation over several lines of one contact and year', async () => {
    const f = await donationFixture();
    const a = await f.donate({ date: '2026-01-15', cents: 5000 });
    const b = await f.donate({ date: '2026-03-01', categoryKey: 'membership-fees', cents: 3600 });
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [a.line.id, b.line.id] }));
    expect(confirmation).toMatchObject({ kind: 'collective', totalCents: 8600, periodFrom: '2026-01-15', periodTo: '2026-03-01' });
    expect(snapshotOf(f, confirmation.documentId).input.lines).toEqual([
      { donatedOn: '2026-01-15', kind: 'donation', expenseWaiver: false, amountCents: 5000 },
      { donatedOn: '2026-03-01', kind: 'membershipFee', expenseWaiver: false, amountCents: 3600 },
    ]);
    const old = await f.donate({ date: '2025-12-01', cents: 100 });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [old.line.id, (await f.donate()).line.id], preNoticeReason: 'x' }))).toMatchObject({ type: 'validation' });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [a.line.id], kind: 'money' }))).toMatchObject({ type: 'conflict', code: 'confirmationLineAlreadyConfirmed' });
  });

  it('needs finance.donationsIssue, validates its input and never issues before the donation or in the future', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    expect(err(await issueConfirmation(f.deps, ctxWith(['finance.read'], f.userId), { lineIds: [line.id] }))).toEqual({ type: 'forbidden', permission: 'finance.donationsIssue' });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [] }))).toMatchObject({ type: 'validation' });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id], issuedOn: '2026-03-21' }))).toMatchObject({ type: 'validation' });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id], issuedOn: '2026-03-04' }))).toMatchObject({ type: 'validation' });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id], kind: 'money', periodFrom: 'x' }))).toMatchObject({ type: 'validation' });
  });
});

describe('humanOnly', () => {
  it('humanOnly over mcp for issue and void', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    const agent = { ...f.ctx, channel: 'mcp' as const };
    expect(err(await issueConfirmation(f.deps, agent, { lineIds: [line.id] }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(err(await voidConfirmation(f.deps, agent, { id: confirmation.id, note: 'x', alreadySent: false }))).toMatchObject({ type: 'conflict', code: 'humanOnly' });
    // Dispatch ist kein humanOnly-Dienst.
    unwrap(await recordConfirmationDispatch(f.deps, agent, { id: confirmation.id, sentAt: '2026-03-20', sentVia: 'post' }));
    allowHumanOnlyOverMcp(f.deps);
    unwrap(await voidConfirmation(f.deps, agent, { id: confirmation.id, note: 'x', alreadySent: true }));
    expect(unwrap(await issueConfirmation(f.deps, agent, { lineIds: [line.id] })).issuedChannel).toBe('mcp');
  });
});

describe('voidConfirmation', () => {
  it('voids with the retrieval trail, releases the lines, and the line can be confirmed again', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    const voided = unwrap(await voidConfirmation(f.deps, f.ctx, { id: confirmation.id, note: 'Falscher Betrag, Spenderin informiert', alreadySent: true, originalReturnedOn: '2026-03-19', taxOfficeInformedOn: '2026-03-20' }));
    expect(voided).toMatchObject({ state: 'voided', voidNote: 'Falscher Betrag, Spenderin informiert', sentBeforeVoid: true, originalReturnedOn: '2026-03-19', taxOfficeInformedOn: '2026-03-20', voidedByUserId: f.userId });
    expect(voided.voidedAt).not.toBeNull();
    expect(voided.lines[0]!.releasedAt).not.toBeNull();
    // Unser Exemplar bleibt als Beweis in der Akte, festgeschrieben und gültig.
    expect(f.deps.db.select().from(documents).where(eq(documents.id, confirmation.documentId)).get()).toMatchObject({ status: 'issued' });

    const [entry] = auditOf(f, 'finance.confirmation.void');
    expect(JSON.parse(entry!.after as string)).toEqual({ voided: true, sentBeforeVoid: true, originalReturned: true, taxOfficeInformed: true });
    expect(JSON.stringify(auditOf(f, 'finance.confirmation.void'))).not.toContain('Falscher Betrag');

    expect(err(await voidConfirmation(f.deps, f.ctx, { id: confirmation.id, note: 'nochmal', alreadySent: false }))).toMatchObject({ type: 'conflict', code: 'confirmationAlreadyVoided' });
    const again = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(again.documentNumber).not.toBe(confirmation.documentNumber);
  });

  it('needs finance.donationsIssue and a reason', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(err(await voidConfirmation(f.deps, ctxWith(['finance.read'], f.userId), { id: confirmation.id, note: 'x', alreadySent: false }))).toEqual({ type: 'forbidden', permission: 'finance.donationsIssue' });
    expect(err(await voidConfirmation(f.deps, f.ctx, { id: confirmation.id, note: ' ', alreadySent: false }))).toMatchObject({ type: 'validation' });
    expect(err(await voidConfirmation(f.deps, f.ctx, { id: 'nope', note: 'x', alreadySent: false }))).toMatchObject({ type: 'notFound' });
  });
});

describe('dispatch and signed version', () => {
  it('dispatch and signed version are one-time', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));

    const sent = unwrap(await recordConfirmationDispatch(f.deps, f.ctx, { id: confirmation.id, sentAt: '2026-03-20', sentVia: 'email' }));
    expect(sent).toMatchObject({ sentAt: '2026-03-20', sentVia: 'email' });
    expect(err(await recordConfirmationDispatch(f.deps, f.ctx, { id: confirmation.id, sentAt: '2026-03-21', sentVia: 'post' }))).toMatchObject({ type: 'conflict', code: 'confirmationAlreadySent' });
    expect(JSON.parse(auditOf(f, 'finance.confirmation.dispatch')[0]!.after as string)).toEqual({ sentVia: 'email' });

    const signed = unwrap(await attachSignedConfirmation(f.deps, f.ctx, { id: confirmation.id, bytes: pdfBytes(), fileName: 'unterschrieben.pdf' }));
    expect(signed.signatureState).toBe('signed');
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, signed.signedDocumentId!)).get()!;
    expect(doc).toMatchObject({ typeKey: 'finance-confirmation-signed', direction: 'incoming', subject: `Zuwendungsbestätigung ${confirmation.documentNumber} unterschrieben` });
    expect(doc.number).toMatch(/^ZWU-/);
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, doc.id), eq(documentLinks.entityType, 'financeConfirmation'))).get()!.entityId).toBe(confirmation.id);
    expect(err(await attachSignedConfirmation(f.deps, f.ctx, { id: confirmation.id, bytes: pdfBytes(), fileName: 'nochmal.pdf' }))).toMatchObject({ type: 'conflict', code: 'confirmationSignedAlready' });
    expect(f.deps.db.select().from(documents).where(eq(documents.typeKey, 'finance-confirmation-signed')).all()).toHaveLength(1);
    expect(JSON.parse(auditOf(f, 'finance.confirmation.signed')[0]!.after as string)).toEqual({ signedDocumentId: doc.id });
  });

  it('dispatch and signed version need finance.donationsIssue and a valid confirmation', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    const reader = ctxWith(['finance.read'], f.userId);
    expect(err(await recordConfirmationDispatch(f.deps, reader, { id: confirmation.id, sentAt: '2026-03-20', sentVia: 'post' }))).toEqual({ type: 'forbidden', permission: 'finance.donationsIssue' });
    expect(err(await attachSignedConfirmation(f.deps, reader, { id: confirmation.id, bytes: pdfBytes(), fileName: 'x.pdf' }))).toEqual({ type: 'forbidden', permission: 'finance.donationsIssue' });
    expect(err(await recordConfirmationDispatch(f.deps, f.ctx, { id: confirmation.id, sentAt: '2026-03-20', sentVia: 'pigeon' }))).toMatchObject({ type: 'validation' });
    unwrap(await voidConfirmation(f.deps, f.ctx, { id: confirmation.id, note: 'x', alreadySent: false }));
    expect(err(await recordConfirmationDispatch(f.deps, f.ctx, { id: confirmation.id, sentAt: '2026-03-20', sentVia: 'post' }))).toMatchObject({ type: 'conflict', code: 'confirmationAlreadyVoided' });
    expect(err(await attachSignedConfirmation(f.deps, f.ctx, { id: confirmation.id, bytes: pdfBytes(), fileName: 'x.pdf' }))).toMatchObject({ type: 'conflict', code: 'confirmationAlreadyVoided' });
  });
});

describe('listConfirmations', () => {
  it('lists issued, to-correct and needs-signature confirmations with counts', async () => {
    const f = await donationFixture({ machine: true });
    const a = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.donate({ cents: 1000 })).line.id] }));
    const b = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.waive()).line.id] }));
    const c = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.donate({ cents: 3000 })).line.id] }));
    unwrap(await voidConfirmation(f.deps, f.ctx, { id: c.id, note: 'x', alreadySent: false }));

    const issued = unwrap(await listConfirmations(f.deps, f.ctx, { tab: 'issued' }));
    expect(issued.total).toBe(3);
    expect(issued.items.map((i) => i.state).sort()).toEqual(['valid', 'valid', 'voided']);
    expect(issued.counts).toEqual({ issued: 3, toCorrect: 0, needsSignature: 1 });
    expect(unwrap(await listConfirmations(f.deps, f.ctx, { tab: 'needsSignature' })).items.map((i) => i.id)).toEqual([b.id]);
    expect(unwrap(await listConfirmations(f.deps, f.ctx, { tab: 'issued', contactId: f.donor.id })).total).toBe(0);
    expect(unwrap(await listConfirmations(f.deps, f.ctx, { tab: 'issued', year: 2025 })).total).toBe(0);
    expect(unwrap(await listConfirmations(f.deps, f.ctx, { tab: 'issued', limit: 1, offset: 0 })).items).toHaveLength(1);
    expect(a.signatureState).toBe('machine');

    expect(err(await listConfirmations(f.deps, ctxWith(['finance.overview'], f.userId), { tab: 'issued' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await listConfirmations(f.deps, f.ctx, { tab: 'other' }))).toMatchObject({ type: 'validation' });
  });
});

describe('listUncertifiedDonations', () => {
  it('lists uncertified donations grouped by contact with the minimum amount and completeness', async () => {
    const f = await donationFixture();
    const partial = unwrap(await createContact(f.deps, f.manage, { kind: 'person', lastName: 'Ohneanschrift' }));
    const e1 = await f.donate({ cents: 5000 });
    const e2 = await f.donate({ cents: 2500, date: '2026-03-06' });
    await f.donate({ cents: 1000, contactId: partial.id });
    await f.donate({ cents: 400, contactId: null }); // ohne Kontakt: nie bestätigbar
    const confirmed = await f.donate({ cents: 900 });
    unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [confirmed.line.id] }));
    const returned = await f.donate({ cents: 700 });
    await f.giveBack(returned.line.id, 700);
    await f.donate({ cents: 300, date: '2025-06-01' });

    const all = unwrap(await listUncertifiedDonations(f.deps, f.ctx, { year: 2026 }));
    expect(all.total).toBe(2);
    const erika = all.groups.find((g) => g.contactId === f.erika.id)!;
    expect(erika).toMatchObject({ contactName: 'Erika Beispiel', contactComplete: true, sumCents: 7500 });
    expect(erika.lines.map((l) => l.lineId)).toEqual([e1.line.id, e2.line.id]);
    expect(all.groups.find((g) => g.contactId === partial.id)).toMatchObject({ contactComplete: false, sumCents: 1000 });

    expect(unwrap(await listUncertifiedDonations(f.deps, f.ctx, { year: 2026, minCents: 5000 })).groups.map((g) => g.contactId)).toEqual([f.erika.id]);
    expect(unwrap(await listUncertifiedDonations(f.deps, f.ctx, {})).groups.find((g) => g.contactId === f.erika.id)!.sumCents).toBe(7800);
    expect(err(await listUncertifiedDonations(f.deps, ctxWith(['finance.overview'], f.userId), {}))).toMatchObject({ type: 'forbidden' });
    expect(err(await listUncertifiedDonations(f.deps, f.ctx, { minCents: -1 }))).toMatchObject({ type: 'validation' });
  });
});

describe('membership fees and the settings', () => {
  it('prints the membership sentence switch into the money confirmation', async () => {
    const f = await donationFixture();
    f.deps.db.transaction((tx) => writeSettingInternal(tx, f.deps, systemContext(), 'finance.membershipFeesCertifiable', false, 'test'));
    const confirmation = unwrap(await issueConfirmation(f.deps, ctxWith(FINANCE_PERMISSIONS, f.userId), { lineIds: [(await f.donate()).line.id] }));
    expect(snapshotOf(f, confirmation.documentId).input.membershipFeesCertifiable).toBe(false);
  });
});

describe('readConfirmationCopy', () => {
  it('delivers our copy through the link of the confirmation, with finance.read and without dms.view', async () => {
    const f = await donationFixture();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.donate()).line.id] }));
    const copy = unwrap(await readConfirmationCopy(f.deps, ctxWith(['finance.read'], f.userId), { id: confirmation.id }));
    expect(copy).toMatchObject({ filename: `${confirmation.documentNumber}.pdf`, number: confirmation.documentNumber });
    expect(new TextDecoder().decode(copy.bytes)).toMatch(/^%PDF/);

    expect(err(await readConfirmationCopy(f.deps, ctxWith(['finance.overview'], f.userId), { id: confirmation.id }))).toMatchObject({ type: 'forbidden' });
    expect(err(await readConfirmationCopy(f.deps, f.ctx, { id: 'nope' }))).toMatchObject({ type: 'notFound' });
    expect(err(await readConfirmationCopy(f.deps, f.ctx, {}))).toMatchObject({ type: 'validation' });
  });

  it('still delivers our copy after the confirmation was taken back', async () => {
    const f = await donationFixture();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.donate()).line.id] }));
    unwrap(await voidConfirmation(f.deps, f.ctx, { id: confirmation.id, note: 'Betrag falsch', alreadySent: false }));
    expect((await readConfirmationCopy(f.deps, f.ctx, { id: confirmation.id })).ok).toBe(true);
  });
});
