import { newId, roleIdByOrigin, schema, unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { contactRoles, createContact } from '@kompass/module-contacts';
import { documents, listDocuments, readLinkedDocument } from '@kompass/module-dms';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditorOfInternal, currentAuditYearInternal, isReportEditorInternal } from '../src/auditing/access';
import { endAuditorAccess, fileConfidentialityDeclaration, listAuditors, listMyAuditYears, removeAuditor, saveAuditor } from '../src/auditing/auditors';
import { AUDITOR_PERMISSIONS, auditFixture } from './auditing-fixture';
import { bookEntry } from '../src/ledger/finalize';
import { financeExpenseClaims } from '../src/schema';
import { insertDocument, pdfBytes } from './helpers';

/** Eine Aufwandsspende, freigegeben von `approverUserId`: Die Buchung ist `claim.entryId` (wie `originOfLine` sie findet). */
async function approveExpenseClaimInternalForTest(f: Awaited<ReturnType<typeof auditFixture>>['f'], approverUserId: string, date: string): Promise<string> {
  const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: date, text: 'Aufwandsspende', moneyLines: [{ accountId: f.bank.id, amountCents: -800 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -800 }] }));
  f.deps.db.insert(financeExpenseClaims).values({ id: newId(), number: 'KE-2025-0001', contactId: f.donor.id, submittedByUserId: f.userId, state: 'approved', approvedAt: `${date}T10:00:00.000Z`, approvedByUserId: approverUserId, entryId: entry.id, createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z` }).run();
  return entry.id;
}

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : (r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type);

describe('saveAuditor', () => {
  it('lists a person once per year, refuses organisations, future elections, stale versions and missing rights; audits the mode only', async () => {
    const { f, y2025, mira, miraAuditor, paperAuditor } = await auditFixture();
    expect(miraAuditor).toMatchObject({ fiscalYearId: y2025, contactId: mira.contact.id, contactName: 'Testa Prüferin', mode: 'kompass', confidential: true });
    const saved = auditEntry(f.deps, 'finance.audit.auditor.save');
    expect(saved).toMatchObject({ entityType: 'financeAuditAuditor', entityId: paperAuditor.id });
    expect(JSON.parse(saved.params!)).toEqual({ mode: 'paper' });
    expect(saved.after).not.toContain(mira.contact.id);

    expect(code(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: mira.contact.id, mode: 'paper' }))).toBe('auditorAlreadyListed');
    const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Prüf GmbH' }));
    expect(code(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: org.id, mode: 'paper' }))).toBe('auditorNotPerson');
    expect(err(await saveAuditor(f.deps, f.ctx, { id: miraAuditor.id, fiscalYearId: y2025, contactId: mira.contact.id, mode: 'kompass', electedOn: '2026-12-01' }))).toMatchObject({ type: 'validation' });
    expect(code(await saveAuditor(f.deps, f.ctx, { id: miraAuditor.id, expectedVersion: 'alt', fiscalYearId: y2025, contactId: mira.contact.id, mode: 'kompass' }))).toBe('staleVersion');
    expect(err(await saveAuditor(f.deps, mira.ctx, { fiscalYearId: y2025, contactId: mira.contact.id, mode: 'kompass' }))).toEqual({ type: 'forbidden', permission: 'finance.periodClose' });

    f.deps.clock.advance(1000);
    const edited = unwrap(await saveAuditor(f.deps, f.ctx, { id: miraAuditor.id, expectedVersion: miraAuditor.version, fiscalYearId: y2025, contactId: mira.contact.id, mode: 'kompass', confidential: true, electedOn: '2025-04-12' }));
    expect(edited).toMatchObject({ electedOn: '2025-04-12' });
    expect(edited.version).not.toBe(miraAuditor.version);
  });
});

describe('listAuditors', () => {
  it('computes access from link, user and the auditor role, and independence notes without blocking', async () => {
    const { f, y2025, person, linkedUser } = await auditFixture({ close: false });
    const { auditors } = unwrap(await listAuditors(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(auditors.map((a) => a.mode)).toEqual(['kompass', 'paper']);
    expect(auditors[0]!.access).toMatchObject({ userActive: true, hasRole: true, endedAt: null, roleMissingOrigin: false });
    expect(auditors[1]!.access).toEqual({ userId: null, userActive: false, hasRole: false, lastLoginAt: null, endedAt: null, roleMissingOrigin: false });

    // Ohne Rolle; mit Vorstandsrolle im Jahr; Kontakt an einer Buchung des Jahres.
    const board = await linkedUser('Vorständin', AUDITOR_PERMISSIONS, false);
    f.deps.db.insert(contactRoles).values({ id: newId(), contactId: board.contact.id, role: 'board-member', since: '2024-01-01', until: '2025-06-30', note: null }).run();
    const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-03-01', text: 'Erstattung', moneyLines: [{ accountId: f.bank.id, amountCents: -1200 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -1200, contactId: board.contact.id }] }));
    f.closeYear(y2025);
    const view = unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: board.contact.id, mode: 'kompass' }));
    expect(view.access).toMatchObject({ hasRole: false, userActive: true });
    expect(view.independence).toEqual({ boardRole: { since: '2024-01-01', until: '2025-06-30' }, involvedEntryIds: [entry.id] });

    // Readers: finance.read or finance.audit.
    const other = await person('Niemand');
    void other;
    expect((await listAuditors(f.deps, ctxWith(['finance.audit']), { fiscalYearId: y2025 })).ok).toBe(true);
    expect(err(await listAuditors(f.deps, ctxWith(['finance.overview']), { fiscalYearId: y2025 }))).toEqual({ type: 'forbidden', permission: 'finance.read' });
  });

  it('names the approver of an expense claim as involved', async () => {
    const { f, y2025, linkedUser } = await auditFixture({ close: false });
    const approver = await linkedUser('Freigeberin', AUDITOR_PERMISSIONS, false);
    const entryId = await approveExpenseClaimInternalForTest(f, approver.userId, '2025-05-10');
    f.closeYear(y2025);
    const view = unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: approver.contact.id, mode: 'kompass' }));
    expect(view.independence.involvedEntryIds).toEqual([entryId]);
  });
});

describe('listMyAuditYears and access helpers', () => {
  it('lists the own years in Kompass, newest first, and knows who edits the report', async () => {
    const { f, y2025, y2026, mira } = await auditFixture();
    unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2026, contactId: mira.contact.id, mode: 'kompass' }));
    const { years } = unwrap(await listMyAuditYears(f.deps, mira.ctx, {}));
    expect(years.map((y) => y.designation)).toEqual(['2026', '2025']);
    expect(unwrap(await listMyAuditYears(f.deps, f.ctx, {})).years).toEqual([]);

    expect(auditorOfInternal(f.deps.db, mira.userId, y2025)?.contactId).toBe(mira.contact.id);
    expect(isReportEditorInternal(f.deps.db, mira.ctx, y2025)).toBe(true);
    // Mit einem Schreibrecht nie Bearbeiter (die Schatzmeisterin ist nie Prüferin ihres Berichts).
    expect(isReportEditorInternal(f.deps.db, ctxWith([...AUDITOR_PERMISSIONS, 'finance.entriesWrite'], mira.userId), y2025)).toBe(false);
    expect(isReportEditorInternal(f.deps.db, f.ctx, y2025)).toBe(false);
    // Laufende Prüfung: das jüngste abgeschlossene Jahr mit Prüfern.
    expect(currentAuditYearInternal(f.deps.db)).toBe(y2025);
  });
});

describe('removeAuditor and endAuditorAccess', () => {
  it('removes an auditor without work, with audit', async () => {
    const { f, paperAuditor, y2025 } = await auditFixture();
    unwrap(await removeAuditor(f.deps, f.ctx, { id: paperAuditor.id }));
    expect(auditEntry(f.deps, 'finance.audit.auditor.remove')).toMatchObject({ entityId: paperAuditor.id });
    expect(unwrap(await listAuditors(f.deps, f.ctx, { fiscalYearId: y2025 })).auditors).toHaveLength(1);
  });

  it('takes only the auditor role, records who ended it, humanOnly over MCP', async () => {
    const { f, mira, miraAuditor, paperAuditor } = await auditFixture();
    const otherRole = roleIdByOrigin(f.deps.db, 'finance:approver')!;
    f.deps.db.insert(schema.userRoles).values({ userId: mira.userId, roleId: otherRole }).run();
    expect(code(await endAuditorAccess(f.deps, { ...f.ctx, channel: 'mcp' }, { id: miraAuditor.id }))).toBe('humanOnly');
    expect(code(await endAuditorAccess(f.deps, f.ctx, { id: paperAuditor.id }))).toBe('auditorNotLinked');
    const ended = unwrap(await endAuditorAccess(f.deps, f.ctx, { id: miraAuditor.id }));
    expect(ended.access).toMatchObject({ hasRole: false, endedAt: '2026-09-05T08:00:00.000Z' });
    const left = f.deps.db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, mira.userId)).all().map((r) => r.roleId);
    expect(left).toEqual([otherRole]);
    expect(auditEntry(f.deps, 'finance.audit.auditor.accessEnd')).toMatchObject({ entityId: miraAuditor.id });
    expect(auditEntry(f.deps, 'users.removeRole')).toMatchObject({ entityId: mira.userId });
    expect(code(await endAuditorAccess(f.deps, f.ctx, { id: miraAuditor.id }))).toBe('auditorAccessAlreadyEnded');
    expect(err(await endAuditorAccess(f.deps, mira.ctx, { id: miraAuditor.id }))).toEqual({ type: 'forbidden', permission: 'finance.periodClose' });
  });
});

describe('Vertraulichkeitserklärung und Akte (V13)', () => {
  it('files the declaration at the auditor; the auditor role reads finance documents but no other area', async () => {
    const { f, mira, miraAuditor } = await auditFixture();
    const view = unwrap(await fileConfidentialityDeclaration(f.deps, f.ctx, { auditorId: miraAuditor.id, bytes: pdfBytes(), fileName: 'erklaerung.pdf' }));
    expect(view.confidentialityDocumentId).not.toBeNull();
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, view.confidentialityDocumentId!)).get()!;
    expect(doc).toMatchObject({ typeKey: 'finance-audit-confidentiality' });
    expect(auditEntry(f.deps, 'finance.audit.auditor.confidentiality')).toMatchObject({ entityId: miraAuditor.id });
    expect(err(await fileConfidentialityDeclaration(f.deps, mira.ctx, { auditorId: miraAuditor.id, bytes: pdfBytes() }))).toEqual({ type: 'forbidden', permission: 'finance.periodClose' });

    insertDocument(f, { subject: 'Rechnung Futter' });
    insertDocument(f, { subject: 'Brief an die Gemeinde', typeKey: 'letter' });
    const listed = unwrap(await listDocuments(f.deps, mira.ctx, {})).documents.map((d) => d.subject).sort();
    expect(listed).toContain('Rechnung Futter');
    expect(listed).not.toContain('Brief an die Gemeinde');
    const read = unwrap(await readLinkedDocument(f.deps, mira.ctx, { documentId: doc.id, entityType: 'financeAuditor', entityId: miraAuditor.id }));
    expect(read.record.typeKey).toBe('finance-audit-confidentiality');
    expect(f.deps.db.select().from(documents).where(and(eq(documents.typeKey, 'letter'))).all()).toHaveLength(1);
  });
});

describe('wer Fragen beantwortet (Designer Runde 7, 281)', () => {
  it('names the contact with the role treasurer today, the one source of handover and audit; null without one', async () => {
    const { f, y2025, person } = await auditFixture();
    expect(unwrap(await listAuditors(f.deps, f.ctx, { fiscalYearId: y2025 })).treasurerName).toBeNull();
    const anna = await person('Schatz', 'Anna');
    f.deps.db.insert(contactRoles).values({ id: newId(), contactId: anna.id, role: 'treasurer', since: '2025-01-01', until: null } as never).run();
    expect(unwrap(await listAuditors(f.deps, f.ctx, { fiscalYearId: y2025 })).treasurerName).toBe('Anna Schatz');
  });
});
