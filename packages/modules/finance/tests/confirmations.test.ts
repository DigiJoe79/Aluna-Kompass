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
  recordConfirmationRecall,
  voidConfirmation,
} from '../src/donations/confirmations';
import { saveInKindDetails } from '../src/donations/in-kind';
import { bookEntry } from '../src/ledger/finalize';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { financeConfirmationLines, financeConfirmations } from '../src/schema';
import { allowHumanOnlyOverMcp, insertDocument, insertRaw, insertRun, pdfBytes } from './helpers';
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

  it('writes an audit entry with number, dates and amounts, never contact or name', async () => {
    const f = await donationFixture();
    const donation = await f.donate({ date: '2025-06-01', cents: 800 });
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [donation.line.id] }));
    const [entry] = auditOf(f, 'finance.confirmation.issue');
    expect(entry).toMatchObject({ entityType: 'financeConfirmation', entityId: confirmation.id });
    expect(JSON.parse(entry!.after as string)).toEqual({ kind: 'money', noticeId: f.notice!.id, documentId: confirmation.documentId, documentNumber: confirmation.documentNumber, issuedOn: '2026-03-20', machine: false, signerId: null, expenseWaiver: false, totalCents: 800, lineCount: 1, channel: 'ui' });
    const all = JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action.startsWith('finance.')));
    expect(all).not.toContain(f.erika.id);
    expect(all).not.toMatch(/Erika|Beispiel/);
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

  it('an expense waiver is always issued with a signature field, even with a complete machine procedure (R 10b.1 Abs. 4 S. 3 EStR)', async () => {
    const f = await donationFixture({ machine: true });
    const { line } = await f.waive();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    expect(confirmation).toMatchObject({ kind: 'money', expenseWaiver: true, machine: false, signatureState: 'needsSignature' });
    expect(snapshotOf(f, confirmation.documentId).input).toMatchObject({ expenseWaiver: true, machine: false });
  });

  it('an in-kind confirmation is issued with a signature field even with a complete machine procedure (R 10b.1 Abs. 4 S. 3 EStR)', async () => {
    const f = await donationFixture({ machine: true });
    const gift = await f.giveInKind();
    const proof = insertDocument(f, { subject: 'Rechnung der Transportbox' });
    unwrap(await saveInKindDetails(f.deps, f.ctx, { lineId: gift.line.id, item: 'Transportbox aus Kunststoff', condition: 'gebraucht, guter Zustand', valuation: 'Kaufpreis laut Rechnung, abzüglich Gebrauch', origin: 'private', proofDocumentId: proof }));
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [gift.line.id], kind: 'inKind' }));
    expect(confirmation).toMatchObject({ kind: 'inKind', machine: false, signerId: null, facsimileChecksum: null, signatureState: 'needsSignature' });
    expect(snapshotOf(f, confirmation.documentId).input).toMatchObject({ machine: false });
    expect(snapshotOf(f, confirmation.documentId).images).toBeUndefined();
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
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [early.line.id], issuedOn: '2025-04-01' }))).toMatchObject({ type: 'conflict', code: 'noNoticeValidAt' });
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

  it('refuses a donation before the start of the exemption (BMF 07.11.2013 Nr. 14)', async () => {
    const f = await donationFixture();
    const early = await f.donate({ date: '2025-03-01' });
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [early.line.id] }))).toMatchObject({ type: 'conflict', code: 'confirmationBeforeExemptionStart' });
    expect(confirmationDocuments(f)).toHaveLength(0);
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
    expect(err(await issueConfirmation(f.deps, f.ctx, { lineIds: [old.line.id, (await f.donate()).line.id] }))).toMatchObject({ type: 'validation' });
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
    // Dispatch ist kein humanOnly-Dienst (die unterschriebene Fassung vorher, Befund F).
    unwrap(await attachSignedConfirmation(f.deps, agent, { id: confirmation.id, bytes: pdfBytes(), fileName: 'unterschrieben.pdf' }));
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

describe('Befund E — Rücknahme einer versandten Bestätigung', () => {
  it('refuses "not sent" once a dispatch is recorded', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    unwrap(await attachSignedConfirmation(f.deps, f.ctx, { id: confirmation.id, bytes: pdfBytes(), fileName: 'unterschrieben.pdf' }));
    unwrap(await recordConfirmationDispatch(f.deps, f.ctx, { id: confirmation.id, sentAt: '2026-03-18', sentVia: 'post' }));
    expect(err(await voidConfirmation(f.deps, f.ctx, { id: confirmation.id, note: 'x', alreadySent: false }))).toMatchObject({ type: 'conflict', code: 'confirmationWasSent' });
    expect(unwrap(await voidConfirmation(f.deps, f.ctx, { id: confirmation.id, note: 'x', alreadySent: true }))).toMatchObject({ state: 'voided', sentBeforeVoid: true });
  });

  it('a voided, sent confirmation without the recall trail stays to correct until both dates are recorded — also over MCP', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));
    const voided = unwrap(await voidConfirmation(f.deps, f.ctx, { id: confirmation.id, note: 'x', alreadySent: true }));
    expect(voided.toCorrect).toEqual(['recallTrailMissing']);
    expect(unwrap(await listConfirmations(f.deps, f.ctx, { tab: 'toCorrect' })).items.map((i) => i.id)).toEqual([confirmation.id]);

    const agent = { ...f.ctx, channel: 'mcp' as const };
    const half = unwrap(await recordConfirmationRecall(f.deps, agent, { id: confirmation.id, originalReturnedOn: '2026-03-19' }));
    expect(half).toMatchObject({ originalReturnedOn: '2026-03-19', taxOfficeInformedOn: null, toCorrect: ['recallTrailMissing'] });
    expect(err(await recordConfirmationRecall(f.deps, f.ctx, { id: confirmation.id, originalReturnedOn: '2026-03-20' }))).toMatchObject({ type: 'conflict', code: 'recallTrailAlreadyRecorded' });
    expect(err(await recordConfirmationRecall(f.deps, f.ctx, { id: confirmation.id, taxOfficeInformedOn: '2099-01-01' }))).toMatchObject({ type: 'validation', issues: [{ path: 'taxOfficeInformedOn', message: 'inFuture' }] });
    expect(err(await recordConfirmationRecall(f.deps, ctxWith(['finance.read'], f.userId), { id: confirmation.id, taxOfficeInformedOn: '2026-03-20' }))).toEqual({ type: 'forbidden', permission: 'finance.donationsIssue' });
    const done = unwrap(await recordConfirmationRecall(f.deps, f.ctx, { id: confirmation.id, taxOfficeInformedOn: '2026-03-20' }));
    expect(done).toMatchObject({ originalReturnedOn: '2026-03-19', taxOfficeInformedOn: '2026-03-20', toCorrect: [] });
    expect(unwrap(await listConfirmations(f.deps, f.ctx, { tab: 'toCorrect' })).total).toBe(0);
    expect(auditOf(f, 'finance.confirmation.recall').map((a) => JSON.parse(a.after as string))).toEqual([{ originalReturned: true, taxOfficeInformed: false }, { originalReturned: true, taxOfficeInformed: true }]);
  });

  it('refuses the recall trail for a valid or a never-sent voided confirmation', async () => {
    const f = await donationFixture();
    const valid = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.donate()).line.id] }));
    expect(err(await recordConfirmationRecall(f.deps, f.ctx, { id: valid.id, originalReturnedOn: '2026-03-19' }))).toMatchObject({ type: 'conflict', code: 'confirmationNoRecall' });
    const unsent = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.donate({ cents: 2000 })).line.id] }));
    unwrap(await voidConfirmation(f.deps, f.ctx, { id: unsent.id, note: 'x', alreadySent: false }));
    expect(err(await recordConfirmationRecall(f.deps, f.ctx, { id: unsent.id, originalReturnedOn: '2026-03-19' }))).toMatchObject({ type: 'conflict', code: 'confirmationNoRecall' });
    expect(unwrap(await listConfirmations(f.deps, f.ctx, { tab: 'toCorrect' })).total).toBe(0);
  });
});

describe('dispatch and signed version', () => {
  it('dispatch and signed version are one-time', async () => {
    const f = await donationFixture();
    const { line } = await f.donate();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));

    // Befund F: mit Unterschriftsfeld erst nach der unterschriebenen Fassung — wie im Serienlauf.
    expect(err(await recordConfirmationDispatch(f.deps, f.ctx, { id: confirmation.id, sentAt: '2026-03-20', sentVia: 'email' }))).toMatchObject({ type: 'conflict', code: 'confirmationSignedMissing' });
    const signed = unwrap(await attachSignedConfirmation(f.deps, f.ctx, { id: confirmation.id, bytes: pdfBytes(), fileName: 'unterschrieben.pdf' }));
    expect(signed.signatureState).toBe('signed');

    // Befund D: nicht in der Zukunft (heute ist der 20.03.).
    expect(err(await recordConfirmationDispatch(f.deps, f.ctx, { id: confirmation.id, sentAt: '2026-03-21', sentVia: 'email' }))).toMatchObject({ type: 'validation', issues: [{ path: 'sentAt', message: 'inFuture' }] });
    const sent = unwrap(await recordConfirmationDispatch(f.deps, f.ctx, { id: confirmation.id, sentAt: '2026-03-20', sentVia: 'email' }));
    expect(sent).toMatchObject({ sentAt: '2026-03-20', sentVia: 'email' });
    expect(err(await recordConfirmationDispatch(f.deps, f.ctx, { id: confirmation.id, sentAt: '2026-03-19', sentVia: 'post' }))).toMatchObject({ type: 'conflict', code: 'confirmationAlreadySent' });
    expect(JSON.parse(auditOf(f, 'finance.confirmation.dispatch')[0]!.after as string)).toEqual({ sentVia: 'email' });
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, signed.signedDocumentId!)).get()!;
    expect(doc).toMatchObject({ typeKey: 'finance-confirmation-signed', direction: 'incoming', subject: `Zuwendungsbestätigung ${confirmation.documentNumber} unterschrieben` });
    expect(doc.number).toMatch(/^ZWU-/);
    expect(f.deps.db.select().from(documentLinks).where(and(eq(documentLinks.documentId, doc.id), eq(documentLinks.entityType, 'financeConfirmation'))).get()!.entityId).toBe(confirmation.id);
    expect(err(await attachSignedConfirmation(f.deps, f.ctx, { id: confirmation.id, bytes: pdfBytes(), fileName: 'nochmal.pdf' }))).toMatchObject({ type: 'conflict', code: 'confirmationSignedAlready' });
    expect(f.deps.db.select().from(documents).where(eq(documents.typeKey, 'finance-confirmation-signed')).all()).toHaveLength(1);
    expect(JSON.parse(auditOf(f, 'finance.confirmation.signed')[0]!.after as string)).toEqual({ signedDocumentId: doc.id });
  });

  it('Befund F: a machine-made confirmation needs no signed version before dispatch', async () => {
    const f = await donationFixture({ machine: true });
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [(await f.donate()).line.id] }));
    expect(confirmation.machine).toBe(true);
    expect(unwrap(await recordConfirmationDispatch(f.deps, f.ctx, { id: confirmation.id, sentAt: '2026-03-20', sentVia: 'post' }))).toMatchObject({ sentAt: '2026-03-20' });
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
  it('kennzeichnet eine Zuwendung mit Datum nach heute als inFuture (Befund 59)', async () => {
    const f = await donationFixture();
    // Gebucht wurde sie an einem späteren Tag; die Uhr steht jetzt davor — so wie ein Datum nach heute aussieht.
    f.deps.clock.set('2026-03-25T10:00:00.000Z');
    const later = await f.donate({ cents: 2000, date: '2026-03-24' });
    f.deps.clock.set('2026-03-20T10:00:00.000Z');
    const now = await f.donate({ cents: 1000, date: '2026-03-20' });
    const lines = unwrap(await listUncertifiedDonations(f.deps, f.ctx, {})).groups.flatMap((g) => g.lines);
    expect(lines.find((l) => l.lineId === later.line.id)?.inFuture).toBe(true);
    expect(lines.find((l) => l.lineId === now.line.id)?.inFuture).toBeUndefined();
  });

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

  it('warns on an uncertified line that has a matching return-category line without origin (Befund 30b)', async () => {
    const f = await donationFixture();
    const gift = await f.donate({ cents: 5000 });
    const run = insertRun(f, f.bank.id);
    const raw = insertRaw(f, run, { accountId: f.bank.id, amountCents: -5000, date: '2026-03-12', purpose: 'Rückgabe', returnCode: 'AC04' });
    unwrap(
      await bookEntry(f.deps, f.ctx, {
        entryDate: '2026-03-12', text: 'Rücklastschrift, ohne Bezug gebucht',
        moneyLines: [{ accountId: f.bank.id, amountCents: -5000, rawTransactionId: raw }],
        allocationLines: [{ categoryId: f.categoryByKey('donations').id, amountCents: -5000, contactId: f.erika.id }],
      }),
    );

    const result = unwrap(await listUncertifiedDonations(f.deps, f.ctx, { year: 2026 }));
    const line = result.groups.find((g) => g.contactId === f.erika.id)!.lines.find((l) => l.lineId === gift.line.id)!;
    // Bleibt bescheinigbar (kein `originLineId`, also nicht verrechnet) — aber mit der Warnung, statt still zu widersprechen.
    expect(line.netCents).toBe(5000);
    expect(line.warnings).toEqual(['possibleReturnWithoutOrigin']);

    // Mit `originLineId` verrechnet — die vertraute Rückläufer-Kürzung greift, keine Warnung mehr nötig.
    const g2 = await f.donate({ cents: 3000, date: '2026-03-13' });
    await f.giveBack(g2.line.id, 3000, '2026-03-14');
    const result2 = unwrap(await listUncertifiedDonations(f.deps, f.ctx, { year: 2026 }));
    expect(result2.groups.find((g) => g.contactId === f.erika.id)!.lines.find((l) => l.lineId === g2.line.id)).toBeUndefined();
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
