import { unwrap } from '@kompass/core';
import { auditEntry, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { removeAuditor } from '../src/auditing/auditors';
import { answerAuditRemark, createAuditRemark, followUpAuditRemark, listAuditRemarks, resolveAuditRemark } from '../src/auditing/remarks';
import { getEntryAuditState } from '../src/auditing/samples';
import { getAuditSection } from '../src/auditing/sections';
import { getAuditStatus } from '../src/auditing/status';
import { bookEntry } from '../src/ledger/finalize';
import { uploadVoucher } from '../src/ledger/vouchers';
import { auditFixture } from './auditing-fixture';
import { pdfBytes } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));

async function setup() {
  const a = await auditFixture({ close: false });
  const { f } = a;
  const entry = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2025-02-01', text: 'Rechnung Futter', moneyLines: [{ accountId: f.bank.id, amountCents: -4500 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -4500 }] }));
  const voucher = unwrap(await uploadVoucher(f.deps, f.ctx, { entryId: entry.id, bytes: pdfBytes(), typeKey: 'voucher-invoice', documentDate: '2025-02-01' }));
  const later = unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Später', moneyLines: [{ accountId: f.bank.id, amountCents: 100 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 100 }] }));
  f.closeYear(a.y2025);
  return { ...a, entry, voucher, later };
}

describe('Vermerke', () => {
  it('runs open → answered → open → resolved, with posts and audit; text never in the log', async () => {
    const { f, y2025, mira, miraAuditor, entry } = await setup();
    const remark = unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'entry', targetId: entry.id, text: 'Wofür war das Futter?' }));
    expect(remark).toMatchObject({ kind: 'question', target: { type: 'entry', id: entry.id }, authorAuditorId: miraAuditor.id, enteredByUserId: mira.userId, state: 'open', posts: [] });
    const created = auditEntry(f.deps, 'finance.audit.remark.create');
    expect(JSON.parse(created.params!)).toEqual({ kind: 'question' });
    expect(JSON.stringify(created)).not.toContain('Futter');

    const answered = unwrap(await answerAuditRemark(f.deps, f.ctx, { remarkId: remark.id, text: 'Für die Pflegestelle Nord.' }));
    expect(answered).toMatchObject({ state: 'answered', posts: [{ kind: 'answer', byUserId: f.userId }] });
    expect(code(await answerAuditRemark(f.deps, { ...f.ctx, channel: 'mcp' }, { remarkId: remark.id, text: 'x' }))).toBe('humanOnly');
    expect(code(await answerAuditRemark(f.deps, mira.ctx, { remarkId: remark.id, text: 'x' }))).toBe('forbidden');

    expect(unwrap(await followUpAuditRemark(f.deps, mira.ctx, { remarkId: remark.id, text: 'Beleg dazu?' })).state).toBe('open');
    expect(unwrap(await resolveAuditRemark(f.deps, mira.ctx, { remarkId: remark.id })).state).toBe('resolved');
    expect(code(await resolveAuditRemark(f.deps, mira.ctx, { remarkId: remark.id }))).toBe('remarkResolved');
    for (const action of ['answer', 'followUp', 'resolve']) expect(JSON.parse(auditEntry(f.deps, `finance.audit.remark.${action}`).params!)).toEqual({ kind: 'question' });
    expect(code(await removeAuditor(f.deps, f.ctx, { id: miraAuditor.id }))).toBe('auditorHasWork');
  });

  it('checks the target against the year, the text length, the paper auditor and the channel', async () => {
    const { f, y2025, mira, paperAuditor, miraAuditor, entry, voucher, later } = await setup();
    const make = (input: Record<string, unknown>, ctx = mira.ctx) => createAuditRemark(f.deps, ctx, { fiscalYearId: y2025, kind: 'finding', targetType: 'entry', targetId: entry.id, text: 'Beleg fehlt', ...input });
    expect(code(await make({ targetId: later.id }))).toBe('remarkTargetNotInYear');
    expect(code(await make({ targetType: 'document', targetId: voucher.documentId }))).toBe('ok');
    expect(code(await make({ targetType: 'document', targetId: 'fremd' }))).toBe('remarkTargetNotInYear');
    expect(code(await make({ targetType: 'report', targetId: 'cashReport' }))).toBe('ok');
    // Seit M2 ist die Mittelverwendungsrechnung verfügbar (im Paket über der Grenze); abgelehnt wird ein unbekannter Bericht.
    expect(code(await make({ targetType: 'report', targetId: 'fundsUse' }))).toBe('ok');
    expect(code(await make({ targetType: 'report', targetId: 'nope' }))).toBe('remarkTargetNotInYear');
    expect(code(await make({ targetType: 'year', targetId: y2025 }))).toBe('ok');
    expect(code(await make({ text: '' }))).toBe('validation');
    expect(code(await make({ text: 'x'.repeat(2001) }))).toBe('validation');
    expect(code(await make({}, { ...mira.ctx, channel: 'mcp' }))).toBe('humanOnly');
    expect(code(await make({}, f.ctx))).toBe('auditorRequired');
    expect(code(await make({}, ctxWith(['finance.read'], mira.userId)))).toBe('forbidden');
    expect(code(await make({ onBehalfOfAuditorId: miraAuditor.id }))).toBe('remarkOnBehalfNotPaper');
    const forPaper = unwrap(await make({ onBehalfOfAuditorId: paperAuditor.id }));
    expect(forPaper).toMatchObject({ authorAuditorId: paperAuditor.id, enteredByUserId: mira.userId });
  });

  it('lists with filters and counts open ones per entry, in sections, status and on the entry page', async () => {
    const { f, y2025, mira, entry } = await setup();
    const one = unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'entry', targetId: entry.id, text: 'Eins?' }));
    unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'finding', targetType: 'entry', targetId: entry.id, text: 'Zwei.' }));
    unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'year', targetId: y2025, text: 'Drei?' }));
    unwrap(await resolveAuditRemark(f.deps, mira.ctx, { remarkId: one.id }));
    const all = unwrap(await listAuditRemarks(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(all.remarks).toHaveLength(3);
    expect(all.openByEntry).toEqual({ [entry.id]: 1 });
    expect(unwrap(await listAuditRemarks(f.deps, f.ctx, { fiscalYearId: y2025, state: 'resolved' })).remarks.map((r) => r.id)).toEqual([one.id]);
    expect(unwrap(await listAuditRemarks(f.deps, ctxWith(['finance.audit']), { fiscalYearId: y2025, targetType: 'year' })).remarks).toHaveLength(1);
    expect(unwrap(await getAuditSection(f.deps, f.ctx, { fiscalYearId: y2025, section: 'journal' })).rows[0]!.remarksOpen).toBe(1);
    expect(unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 })).remarksUnresolved).toBe(2);
    expect(unwrap(await getEntryAuditState(f.deps, f.ctx, { entryId: entry.id }))!.remarks).toHaveLength(2);
    // Designer Runde 8, 281: Abschnitt 1 zählt nur Vermerke an Buchungen, nach Zustand — ein beantworteter ist nicht offen.
    expect(all.remarksOnEntries).toEqual({ open: 1, answered: 0 });
    const two = all.remarks.find((r) => r.text === 'Zwei.')!;
    unwrap(await answerAuditRemark(f.deps, f.ctx, { remarkId: two.id, text: 'Erledigt.' }));
    expect(unwrap(await listAuditRemarks(f.deps, f.ctx, { fiscalYearId: y2025 })).remarksOnEntries).toEqual({ open: 0, answered: 1 });
  });

  it('cannot be deleted or rewritten', async () => {
    const { f, y2025, mira, entry } = await setup();
    const remark = unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'entry', targetId: entry.id, text: 'Eins?' }));
    expect(() => f.deps.sqlite.prepare('delete from finance_audit_remarks where id = ?').run(remark.id)).toThrow(/permanent/);
    expect(() => f.deps.sqlite.prepare('update finance_audit_remarks set text = ? where id = ?').run('anders', remark.id)).toThrow(/immutable/);
  });
});
