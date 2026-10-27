import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { currentAuditYear, previewAuditor } from '../src/auditing/auditors';
import { getEntryAuditState } from '../src/auditing/samples';
import { getAuditSection } from '../src/auditing/sections';
import { bookEntry } from '../src/ledger/finalize';
import { auditFixture } from './auditing-fixture';

async function withEntries() {
  const a = await auditFixture({ close: false });
  const { f } = a;
  const book = async (date: string, cents: number, accountId: string, text: string) =>
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: date, text, moneyLines: [{ accountId, amountCents: cents }], allocationLines: [{ categoryId: f.donations.id, amountCents: cents }] }));
  const first = await book('2025-02-01', 1250, f.bank.id, 'Spende Sommerfest');
  const second = await book('2025-03-01', 4000, f.cash.id, 'Spendendose');
  const third = await book('2025-04-01', 9900, f.bank.id, 'Mitgliedsbeitrag');
  f.closeYear(a.y2025);
  return { ...a, first, second, third };
}

describe('Lesedienste für die Oberfläche', () => {
  it('currentAuditYear names the running audit with its auditors, or null', async () => {
    const { f, y2025, miraAuditor, paperAuditor } = await auditFixture();
    const current = unwrap(await currentAuditYear(f.deps, f.ctx, {}));
    expect(current).toEqual({ fiscalYearId: y2025, designation: '2025', auditors: [{ id: miraAuditor.id, contactId: miraAuditor.contactId, contactName: 'Testa Prüferin', mode: 'kompass' }, { id: paperAuditor.id, contactId: paperAuditor.contactId, contactName: 'Paul Papierprüfer', mode: 'paper' }] });
    const empty = await auditFixture({ close: false });
    expect(unwrap(await currentAuditYear(empty.f.deps, empty.f.ctx, {}))).toBeNull();
    expect(await currentAuditYear(f.deps, ctxWith(['finance.overview']), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('previewAuditor shows access and independence without saving', async () => {
    const { f, y2025, linkedUser } = await auditFixture();
    const candidate = await linkedUser('Kandidatin');
    const preview = unwrap(await previewAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: candidate.contact.id, mode: 'kompass' }));
    expect(preview).toEqual({ access: expect.objectContaining({ userId: candidate.userId, hasRole: true }), independence: { boardRole: null, involvedEntryIds: [] } });
    expect(await previewAuditor(f.deps, candidate.ctx, { fiscalYearId: y2025, contactId: candidate.contact.id, mode: 'kompass' })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.periodClose' } });
  });

  it('getEntryAuditState gives the own auditor entry and nothing for drafts', async () => {
    const { f, mira, miraAuditor, first, y2025 } = await withEntries();
    expect(unwrap(await getEntryAuditState(f.deps, mira.ctx, { entryId: first.id }))).toEqual({ fiscalYearId: y2025, myAuditorId: miraAuditor.id, mySample: false, sampleState: 'none', remarks: [] });
    expect(unwrap(await getEntryAuditState(f.deps, f.ctx, { entryId: first.id }))!.myAuditorId).toBeNull();
    expect(unwrap(await getEntryAuditState(f.deps, f.ctx, { entryId: 'gibt-es-nicht' }))).toBeNull();
  });

  it('getAuditSection filters by text, amount, account and entries, and pages with a default of 50', async () => {
    const { f, mira, y2025, first, second, third } = await withEntries();
    const ids = async (input: Record<string, unknown>) => unwrap(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'journal', ...input })).rows.map((r) => r.entryId);
    expect(await ids({ text: 'sommerfest' })).toEqual([first.id]);
    expect(await ids({ text: 'DOSE' })).toEqual([second.id]);
    expect(await ids({ text: '12,50' })).toEqual([first.id]);
    expect(await ids({ text: first.number! })).toEqual([first.id]);
    expect(await ids({ accountId: f.cash.id })).toEqual([second.id]);
    expect(await ids({ entryIds: [third.id] })).toEqual([third.id]);
    expect(await ids({ sample: 'sampled' })).toEqual([]);
    expect(await ids({ sample: 'open' })).toEqual([first.id, second.id, third.id]);
    const rows = unwrap(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'journal' })).rows;
    expect(rows[0]).toMatchObject({ sample: 'none', samplesByAll: 0 });
    expect(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'journal', limit: 201 })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});
