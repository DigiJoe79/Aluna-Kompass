import { schema } from '@kompass/core';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIT_FIELDS, financeAudit } from '../src/audit';
import { setupFinance } from './helpers';

const SRC = path.resolve(import.meta.dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = path.join(dir, n); return statSync(p).isDirectory() ? files(p) : [p]; });

describe('financeAudit', () => {
  it('writes only whitelisted fields — a name or an IBAN never reaches the log', () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => financeAudit(tx, deps, ctx, { action: 'finance.account.create', entity: 'financeAccount', id: 'A1', after: { kind: 'bank', isMain: true, name: 'Sparkasse Musterstadt', iban: 'DE23999999990000202051', openingBalanceCents: 5000 }, summary: 'Konto A1 angelegt' }));
    const entry = deps.db.select().from(schema.auditLog).all().at(-1)!;
    expect(JSON.parse(entry.after as string)).toEqual({ kind: 'bank', isMain: true, openingBalanceCents: 5000 });
    expect(`${entry.after}${entry.summary}`).not.toMatch(/Sparkasse|DE02/);
    expect(entry).toMatchObject({ action: 'finance.account.create', entityType: 'financeAccount', entityId: 'A1' });
  });

  it('never lets a rule name, text condition, iban or contact id into the audit log', () => {
    const { deps, ctx } = setupFinance();
    const rule = {
      name: 'Bürobedarf Erika Beispiel', textContains: 'bueromaterial', counterpartyIban: 'DE66999999991234567890', contactId: 'CONTACT-1', entryText: 'Büromaterial',
      accountId: 'A1', direction: 'out', categoryId: 'CAT1', projectId: null, purposeId: null, taxCode: 'none', isActive: true, sortOrder: 2,
      hasBankDetailsCondition: true, hasWordCondition: true, hasAmountCondition: false, partySet: true,
    };
    deps.db.transaction((tx) => financeAudit(tx, deps, ctx, { action: 'finance.importRule.save', entity: 'financeImportRule', id: 'R1', after: rule, summary: 'Regel R1 gespeichert' }));
    deps.db.transaction((tx) => financeAudit(tx, deps, ctx, { action: 'finance.contactIban.link', entity: 'financeContactBankAccount', id: 'CB1', after: { contactId: 'CONTACT-1', iban: 'DE66999999991234567890', learnedFrom: 'manual' }, summary: 'Zuordnung CB1 angelegt' }));
    const [ruleEntry, ibanEntry] = deps.db.select().from(schema.auditLog).all().slice(-2);
    expect(JSON.parse(ruleEntry!.after as string)).toEqual({
      accountId: 'A1', direction: 'out', categoryId: 'CAT1', projectId: null, purposeId: null, taxCode: 'none', isActive: true, sortOrder: 2,
      hasBankDetailsCondition: true, hasWordCondition: true, hasAmountCondition: false, partySet: true,
    });
    expect(JSON.parse(ibanEntry!.after as string)).toEqual({ learnedFrom: 'manual' });
    expect(JSON.stringify([ruleEntry, ibanEntry])).not.toMatch(/Erika|Büro|bueromaterial|DE66|CONTACT-1/);
  });

  it('never lets a signer name, tax office, tax number, purposes, an item or a contact id of the donations into the log (F6a)', () => {
    const { deps, ctx } = setupFinance();
    const secret = { signerName: 'Jonas Feld', taxOffice: 'Finanzamt Musterstadt', taxNumber: '99/999/99999', purposesText: 'Förderung des Tierschutzes', item: 'Kratzbaum', contactId: 'CONTACT-1', voidNote: 'Tippfehler' };
    deps.db.transaction((tx) => {
      financeAudit(tx, deps, ctx, { action: 'finance.notice.save', entity: 'financeNotice', id: 'N1', after: { ...secret, kind: 'exemptionNotice', noticeDate: '2025-05-02', assessmentPeriod: '2023', documentId: 'D1', supersededOn: null, supersededDocumentId: null, voided: false }, summary: 'Bescheid N1 gespeichert' });
      financeAudit(tx, deps, ctx, { action: 'finance.confirmation.issue', entity: 'financeConfirmation', id: 'C1', after: { ...secret, kind: 'money', noticeId: 'N1', documentId: 'D2', documentNumber: 'ZWB-2026-0001', issuedOn: '2026-03-10', machine: true, signerId: 'S1', expenseWaiver: false, totalCents: 5000, lineCount: 1, channel: 'ui' }, summary: 'Bestätigung ZWB-2026-0001 ausgestellt' });
      financeAudit(tx, deps, ctx, { action: 'finance.signer.save', entity: 'financeSigner', id: 'S1', after: { ...secret, validFrom: '2026-01-01', validTo: null, hasFacsimile: true, notifiedOn: '2026-02-01' }, summary: 'Unterzeichner S1 gespeichert' });
      financeAudit(tx, deps, ctx, { action: 'finance.inKind.save', entity: 'financeInKindDetails', id: 'L1', after: { ...secret, lineId: 'L1', origin: 'business', withdrawalValueCents: 1000, vatCents: 190, proofDocumentId: 'D3' }, summary: 'Sachspende an Zeile L1 beschrieben' });
    });
    const entries = deps.db.select().from(schema.auditLog).all().slice(-4);
    expect(entries.map((e) => e.entityType)).toEqual(['financeNotice', 'financeConfirmation', 'financeSigner', 'financeInKindDetails']);
    expect(JSON.stringify(entries)).not.toMatch(/Jonas|Musterstadt|99\/999|Tierschutz|Kratzbaum|CONTACT-1|Tippfehler|vorher/);
    expect(JSON.parse(entries[1]!.after as string)).toMatchObject({ documentNumber: 'ZWB-2026-0001', totalCents: 5000, lineCount: 1 });
  });

  it('logs a confirmation run by its counters and parameters, never a contact id or the sort key (F6b)', () => {
    const { deps, ctx } = setupFinance();
    deps.db.transaction((tx) => {
      financeAudit(tx, deps, ctx, {
        action: 'finance.confirmationRun.start', entity: 'financeConfirmationRun', id: 'R1',
        after: { excludedContactIds: ['CONTACT-1'], contactId: 'CONTACT-2', year: 2026, minCents: 0, excludedCount: 1, followUpOfRunId: null, startedOn: '2027-01-15', itemCount: 3, issuedCount: 0, failedCount: 0, finished: false, dispatchedVia: null, channel: 'ui' },
        summary: 'Serienlauf R1 gestartet',
      });
      financeAudit(tx, deps, ctx, {
        action: 'finance.confirmationRun.item', entity: 'financeConfirmationRunItem', id: 'I1',
        after: { contactId: 'CONTACT-2', sortKey: 'musterspenderin', lineIds: ['L1'], runId: 'R1', kind: 'collective', state: 'issued', confirmationId: 'C1', errorCode: null, totalCents: 5000, lineCount: 1 },
        summary: 'Posten I1 ausgestellt',
      });
    });
    const [run, item] = deps.db.select().from(schema.auditLog).all().slice(-2);
    expect(JSON.parse(run!.after as string)).toEqual({ year: 2026, minCents: 0, excludedCount: 1, followUpOfRunId: null, startedOn: '2027-01-15', itemCount: 3, issuedCount: 0, failedCount: 0, finished: false, dispatchedVia: null, channel: 'ui' });
    expect(JSON.parse(item!.after as string)).toEqual({ runId: 'R1', kind: 'collective', state: 'issued', confirmationId: 'C1', errorCode: null, totalCents: 5000, lineCount: 1 });
    expect(JSON.stringify([run, item])).not.toMatch(/CONTACT-|musterspenderin|"L1"/);
  });

  it('never lists a field that could carry a person, free text or a bank detail', () => {
    const forbidden = /name|label|title|description|note|text|reason|iban|bic|holder|purposeLine|contact|subject|email/i;
    const offenders = Object.entries(AUDIT_FIELDS).flatMap(([entity, fields]) => fields.filter((f) => forbidden.test(f)).map((f) => `${entity}.${f}`));
    expect(offenders).toEqual([]);
  });

  it('is the only place in the module that imports recordAudit', () => {
    const offenders = files(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith(`${path.sep}audit.ts`)).filter((f) => /\brecordAudit\b/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
