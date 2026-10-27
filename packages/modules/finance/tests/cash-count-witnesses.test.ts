import { unwrap } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { removeAuditor } from '../src/auditing/auditors';
import { getAuditReport, createAuditReportDraft, saveAuditReportExamination } from '../src/auditing/report';
import { getAuditStatus } from '../src/auditing/status';
import { countCash } from '../src/ledger/cash';
import { auditFixture } from './auditing-fixture';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string; issues?: { message: string }[] }).code ?? (r.error as { issues?: { message: string }[] }).issues?.[0]?.message ?? (r.error as { type: string }).type));

async function setup() {
  const a = await auditFixture();
  const bodies: string[] = [];
  const original = a.f.deps.documents.render;
  a.f.deps.documents.render = async (args) => {
    bodies.push(args.bodyTypst);
    return original(args);
  };
  a.f.deps.clock.advance(60_000);
  const count = (input: Record<string, unknown> = {}, ctx = a.f.ctx) => countCash(a.f.deps, ctx, { accountId: a.f.cash.id, countedOn: '2026-09-05', countedCents: 0, counterOneContactId: a.f.donor.id, counterTwoContactId: a.f.rightDonor.id, ...input });
  return { ...a, bodies, count };
}

describe('Kassenzählung im Beisein der Prüfer', () => {
  it('takes auditors of the year under audit as witnesses, prints the line and shows the count in status and report', async () => {
    const { f, y2025, mira, miraAuditor, paperAuditor, bodies, count } = await setup();
    const counted = unwrap(await count({ witnessAuditorIds: [miraAuditor.id, paperAuditor.id] }));
    expect(bodies.at(-1)).toContain('Im Beisein von');
    expect(bodies.at(-1)).toContain('Testa Prüferin, Paul Papierprüfer');
    const status = unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(status.cashCount).toEqual({ countId: counted.count.id, countedOn: '2026-09-05', countedCents: 0, witnessAuditorIds: [miraAuditor.id, paperAuditor.id] });
    expect(status.cashCounts).toHaveLength(1);
    // Ohne Zeugen zählt sie nicht als Zählung der Prüfung.
    unwrap(await count());
    expect(unwrap(await getAuditStatus(f.deps, f.ctx, { fiscalYearId: y2025 })).cashCounts).toHaveLength(1);
    const draft = unwrap(await createAuditReportDraft(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'report' }));
    expect(draft.subject.cash?.countId).toBe(counted.count.id);
    f.deps.clock.advance(60_000);
    const second = unwrap(await count({ witnessAuditorIds: [miraAuditor.id] }));
    expect(unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: y2025 }))!.subject.cash?.countId).toBe(second.count.id);
    unwrap(await saveAuditReportExamination(f.deps, mira.ctx, { reportId: draft.id, dates: ['2026-09-05'], cashCountId: counted.count.id }));
    expect(unwrap(await getAuditReport(f.deps, f.ctx, { fiscalYearId: y2025 }))!.subject.cash?.countId).toBe(counted.count.id);
    expect(await removeAuditor(f.deps, f.ctx, { id: paperAuditor.id })).toMatchObject({ ok: false, error: { code: 'auditorHasWork' } });
  });

  it('refuses witnesses who are no auditors of the year under audit, and any witness without a running audit', async () => {
    const { f, count, linkedUser, y2025 } = await setup();
    const other = await linkedUser('Fremd');
    void other;
    expect(code(await count({ witnessAuditorIds: ['gibt-es-nicht'] }))).toBe('witnessNotAuditor');
    const empty = await auditFixture({ close: false });
    expect(code(await countCash(empty.f.deps, empty.f.ctx, { accountId: empty.f.cash.id, countedOn: '2026-09-05', countedCents: 0, counterOneContactId: empty.f.donor.id, counterTwoContactId: empty.f.rightDonor.id, witnessAuditorIds: [empty.miraAuditor.id] }))).toBe('witnessNoAudit');
    void y2025;
  });

  it('counting stays finance.entriesFinalize', async () => {
    const { mira, miraAuditor, count } = await setup();
    expect(code(await count({ witnessAuditorIds: [miraAuditor.id] }, mira.ctx))).toBe('forbidden');
  });

  it('witnesses cannot be changed or deleted', async () => {
    const { f, miraAuditor, count } = await setup();
    const counted = unwrap(await count({ witnessAuditorIds: [miraAuditor.id] }));
    expect(() => f.deps.sqlite.prepare('delete from finance_cash_count_witnesses where count_id = ?').run(counted.count.id)).toThrow(/permanent/);
    expect(() => f.deps.sqlite.prepare('update finance_cash_count_witnesses set name = ? where count_id = ?').run('x', counted.count.id)).toThrow(/immutable/);
  });
});

describe('Kassenzählung im Beisein eines Kontakts (Rechenschaft C, Amtsübergabe)', () => {
  it('stores a contact witness with the name and prints it; no contact id in the log', async () => {
    const { f, person, bodies, count } = await setup();
    const successor = await person('Nachfolgerin');
    const counted = unwrap(await count({ witnessContactIds: [successor.id] }));
    expect(f.deps.sqlite.prepare('select contact_id as contactId, name from finance_cash_count_contact_witnesses where count_id = ?').all(counted.count.id)).toEqual([{ contactId: successor.id, name: 'Testa Nachfolgerin' }]);
    expect(bodies.at(-1)).toContain('Im Beisein von');
    expect(bodies.at(-1)).toContain('Testa Nachfolgerin');
    const audit = f.deps.sqlite.prepare("select params, after from audit_log where action = 'finance.cashCount.record' order by rowid desc limit 1").get() as { params: string; after: string };
    expect(`${audit.params}${audit.after}`).not.toContain(successor.id);
    expect(JSON.parse(audit.after)).toMatchObject({ witnessCount: 1 });
    expect(() => f.deps.sqlite.prepare('delete from finance_cash_count_contact_witnesses').run()).toThrow();
  });

  it('refuses an organisation, a counter and more than two', async () => {
    const { f, count, person } = await setup();
    const org = unwrap(await createContact(f.deps, { ...systemContext(), permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Verein Beispiel' }));
    expect(code(await count({ witnessContactIds: [org.id] }))).toBe('notAPerson');
    expect(code(await count({ witnessContactIds: [f.donor.id] }))).toBe('witnessIsCounter');
    const a = await person('Eins');
    const b = await person('Zwei');
    const c = await person('Drei');
    expect(code(await count({ witnessContactIds: [a.id, b.id, c.id] }))).toBe('tooManyItems');
  });

  it('keeps the auditor witnesses as before next to a contact', async () => {
    const { miraAuditor, person, bodies, count } = await setup();
    const successor = await person('Nachfolgerin');
    unwrap(await count({ witnessAuditorIds: [miraAuditor.id], witnessContactIds: [successor.id] }));
    expect(bodies.at(-1)).toContain('Testa Prüferin, Testa Nachfolgerin');
  });
});
