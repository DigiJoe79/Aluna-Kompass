import { schema as core, unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { endContactRole } from '@kompass/module-contacts';
import { documentRelations, documents } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { attachSignedAnnualAccountsScan, requestAnnualAccountsSignature, signAnnualAccounts } from '../src/closing/annual-accounts-sign';
import { voidReportInternal } from '../src/reporting/finalize';
import { financeReportSignatures } from '../src/schema';
import { allowHumanOnlyOverMcp, pdfBytes } from './helpers';
import { boardMember, finalizedAnnualAccounts } from './annual-accounts-j2-fixture';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
type Setup = Awaited<ReturnType<typeof finalizedAnnualAccounts>>;
const docOf = (s: Setup, id: string) => s.f.deps.db.select().from(documents).where(eq(documents.id, id)).get()!;
const lastRender = (s: Setup) => s.renders.at(-1) ?? '';
const relationsTo = (s: Setup, documentId: string) => s.f.deps.db.select().from(documentRelations).where(and(eq(documentRelations.relatedDocumentId, documentId), eq(documentRelations.kind, 'signedCopyOf'))).all();
const openFollowUps = (s: Setup) => s.f.deps.db.select().from(core.followUps).all().filter((r) => r.doneAt === null);

describe('Jahresrechnung abzeichnen über das eigene Konto', () => {
  it('legt eine zweite, abgezeichnete Fassung mit gleichem Datenstand an; die festgeschriebene bleibt', async () => {
    const s = await finalizedAnnualAccounts();
    const finalBefore = docOf(s, s.report.documentId);
    const signed = unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }));
    expect(signed).toMatchObject({ reportId: s.report.id, contactId: s.board.contactId, name: 'Vera Vorstand', office: 'Vorsitzende', signedOn: '2026-09-05', via: 'account', scanDocumentId: null, scanDocumentNumber: null });
    expect(signed.documentId).not.toBe(s.report.documentId);
    expect(docOf(s, signed.documentId)).toMatchObject({ typeKey: 'finance-report', status: 'issued' });
    expect(relationsTo(s, s.report.documentId).map((r) => r.documentId)).toEqual([signed.documentId]);
    expect(docOf(s, s.report.documentId)).toEqual(finalBefore);
    const row = s.f.deps.db.select().from(financeReportSignatures).where(eq(financeReportSignatures.reportId, s.report.id)).get()!;
    expect(row).toMatchObject({ via: 'account', signerUserId: s.board.userId, documentId: signed.documentId });
    expect(JSON.parse(row.namedContactIds)).toEqual([s.donor.id]);
  });

  it('trägt Name, Amt und Tag auf dem Papier und denselben Kurz-Hash', async () => {
    const s = await finalizedAnnualAccounts();
    unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }));
    const snapshot = s.f.deps.db.select().from(documents).where(eq(documents.typeKey, 'finance-report')).all();
    expect(snapshot).toHaveLength(3);
    expect(lastRender(s)).toContain('Abgezeichnet von Vera Vorstand, Vorsitzende, am 05.09.2026.');
    expect(lastRender(s)).toContain(s.shortHash);
  });

  it('erledigt die Bitte um Abzeichnung und protokolliert ohne Kontakt', async () => {
    const s = await finalizedAnnualAccounts();
    unwrap(await requestAnnualAccountsSignature(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: s.board.contactId, dueAt: '2026-09-20' }));
    expect(openFollowUps(s)).toHaveLength(1);
    unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }));
    expect(openFollowUps(s)).toEqual([]);
    const entry = auditEntry(s.f.deps, 'finance.annualAccounts.sign');
    expect(JSON.parse(entry.params!)).toEqual({ documentNumber: expect.any(String), via: 'account', scanNumber: null });
    expect(JSON.parse(entry.after!)).toMatchObject({ signerUserId: s.board.userId });
    expect(JSON.stringify(entry)).not.toContain(s.board.contactId);
  });

  it('lehnt ab, wer nicht vertritt, dessen Vertretung endete oder wer kein verknüpftes Konto hat', async () => {
    const s = await finalizedAnnualAccounts();
    expect(err(await signAnnualAccounts(s.f.deps, ctxWith(['finance.overview'], s.f.userId), { reportId: s.report.id }))).toMatchObject({ code: 'annualAccountsNotRepresentative' });
    const plain = await boardMember(s.f, { firstName: 'Bernd', lastName: 'Beisitzer', represents: false });
    expect(err(await signAnnualAccounts(s.f.deps, plain.ctx, { reportId: s.report.id }))).toMatchObject({ code: 'annualAccountsNotRepresentative' });
    const ended = await boardMember(s.f, { firstName: 'Erika', lastName: 'Ehemalig' });
    unwrap(await endContactRole(s.f.deps, ctxWith(['contacts.manage']), { roleId: ended.roleId, until: '2026-09-04' }));
    expect(err(await signAnnualAccounts(s.f.deps, ended.ctx, { reportId: s.report.id }))).toMatchObject({ code: 'annualAccountsNotRepresentative' });
  });

  it('lehnt ein zweites Abzeichnen, eine stornierte Fassung und fehlendes Leserecht ab', async () => {
    const s = await finalizedAnnualAccounts();
    expect(err(await signAnnualAccounts(s.f.deps, ctxWith([], s.board.userId), { reportId: s.report.id }))).toMatchObject({ type: 'forbidden' });
    expect(err(await signAnnualAccounts(s.f.deps, s.board.ctx, {}))).toMatchObject({ type: 'validation' });
    const first = unwrap(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }));
    expect(err(await signAnnualAccounts(s.f.deps, s.board.ctx, { reportId: s.report.id }))).toMatchObject({ code: 'annualAccountsAlreadySigned', params: { documentNumber: first.documentNumber } });
    const t = await finalizedAnnualAccounts();
    t.f.deps.db.transaction((tx) => voidReportInternal(tx, t.f.deps, t.f.ctx, t.report.id, 'Test'));
    expect(err(await signAnnualAccounts(t.f.deps, t.board.ctx, { reportId: t.report.id }))).toMatchObject({ code: 'annualAccountsNotFinal' });
  });

  it('geht nie über einen Agenten, auch nicht mit Freigabe für menschliche Handlungen', async () => {
    const s = await finalizedAnnualAccounts();
    allowHumanOnlyOverMcp(s.f.deps);
    expect(err(await signAnnualAccounts(s.f.deps, { ...s.board.ctx, channel: 'mcp' }, { reportId: s.report.id }))).toMatchObject({ code: 'annualAccountsSignNotForAgents' });
  });
});

describe('Unterschriebenen Scan ablegen', () => {
  it('legt Scan und erzeugte Fassung ab; nur die erzeugte ist die abgezeichnete', async () => {
    const s = await finalizedAnnualAccounts();
    const signed = unwrap(await attachSignedAnnualAccountsScan(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: s.board.contactId, signedOn: '2026-09-05', bytes: pdfBytes() }));
    expect(signed).toMatchObject({ via: 'scan', signedOn: '2026-09-05', name: 'Vera Vorstand' });
    expect(signed.scanDocumentId).not.toBeNull();
    expect(signed.documentId).not.toBe(signed.scanDocumentId);
    expect(relationsTo(s, s.report.documentId).map((r) => r.documentId).sort()).toEqual([signed.documentId, signed.scanDocumentId].sort());
    expect(lastRender(s)).toContain(`unterschriebenes Exemplar ${signed.scanDocumentNumber}`);
    const entry = auditEntry(s.f.deps, 'finance.annualAccounts.sign');
    expect(JSON.parse(entry.params!)).toEqual({ documentNumber: signed.documentNumber, via: 'scan', scanNumber: signed.scanDocumentNumber });
    expect(JSON.stringify(entry)).not.toContain(s.board.contactId);
  });

  it('verlangt Vertretung am Tag, kein Datum in der Zukunft oder vor dem Festschreiben, und das Recht', async () => {
    const s = await finalizedAnnualAccounts();
    const plain = await boardMember(s.f, { firstName: 'Bernd', lastName: 'Beisitzer', represents: false, linked: false });
    expect(err(await attachSignedAnnualAccountsScan(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: plain.contactId, signedOn: '2026-09-05', bytes: pdfBytes() }))).toMatchObject({ code: 'annualAccountsNotRepresentative' });
    expect(err(await attachSignedAnnualAccountsScan(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: s.board.contactId, signedOn: '2026-09-06', bytes: pdfBytes() }))).toMatchObject({ type: 'validation' });
    expect(err(await attachSignedAnnualAccountsScan(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: s.board.contactId, signedOn: '2026-09-04', bytes: pdfBytes() }))).toMatchObject({ type: 'validation' });
    expect(err(await attachSignedAnnualAccountsScan(s.f.deps, ctxWith(['finance.read'], s.f.userId), { reportId: s.report.id, contactId: s.board.contactId, signedOn: '2026-09-05', bytes: pdfBytes() }))).toMatchObject({ type: 'forbidden' });
    expect(err(await attachSignedAnnualAccountsScan(s.f.deps, { ...s.f.ctx, channel: 'mcp' }, { reportId: s.report.id, contactId: s.board.contactId, signedOn: '2026-09-05', bytes: pdfBytes() }))).toMatchObject({ code: 'humanOnly' });
  });

  it('nimmt einen vertretenden Kontakt ohne Konto', async () => {
    const s = await finalizedAnnualAccounts();
    const unlinked = await boardMember(s.f, { firstName: 'Olga', lastName: 'Ohnekonto', linked: false });
    unwrap(await attachSignedAnnualAccountsScan(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: unlinked.contactId, signedOn: '2026-09-05', bytes: pdfBytes() }));
  });
});

describe('Um Abzeichnung bitten', () => {
  it('legt die Wiedervorlage beim Konto des Kontakts an und schickt eine Mail', async () => {
    const s = await finalizedAnnualAccounts();
    const res = unwrap(await requestAnnualAccountsSignature(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: s.board.contactId, dueAt: '2026-09-20' }));
    expect(res.notice).toEqual({ mail: 'sent' });
    expect(openFollowUps(s)).toMatchObject([{ id: res.followUpId, entityType: 'financeReport', entityId: s.report.id, assigneeUserId: s.board.userId, title: 'Jahresrechnung 2025 abzeichnen', dueAt: '2026-09-20' }]);
    expect(s.mail.sent).toHaveLength(1);
    expect(s.mail.sent[0]!.to).toBe('vera@example.org');
    expect(JSON.parse(auditEntry(s.f.deps, 'finance.annualAccounts.signatureRequest').params!)).toEqual({ documentNumber: s.report.documentNumber });
  });

  it('lehnt einen Kontakt ohne Konto, ohne Vertretung und ohne Recht ab', async () => {
    const s = await finalizedAnnualAccounts();
    const unlinked = await boardMember(s.f, { firstName: 'Olga', lastName: 'Ohnekonto', linked: false });
    expect(err(await requestAnnualAccountsSignature(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: unlinked.contactId, dueAt: '2026-09-20' }))).toMatchObject({ code: 'annualAccountsSignerWithoutAccount', params: {} });
    const plain = await boardMember(s.f, { firstName: 'Bernd', lastName: 'Beisitzer', represents: false });
    expect(err(await requestAnnualAccountsSignature(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: plain.contactId, dueAt: '2026-09-20' }))).toMatchObject({ code: 'annualAccountsNotRepresentative' });
    expect(err(await requestAnnualAccountsSignature(s.f.deps, ctxWith(['finance.read'], s.f.userId), { reportId: s.report.id, contactId: s.board.contactId, dueAt: '2026-09-20' }))).toMatchObject({ type: 'forbidden' });
    expect(err(await requestAnnualAccountsSignature(s.f.deps, s.f.ctx, { reportId: s.report.id, contactId: s.board.contactId, dueAt: 'morgen' }))).toMatchObject({ type: 'validation' });
  });
});
