import { newId, schema, unwrap, type CallContext } from '@kompass/core';
import { auditEntry, ctxWith, systemContext } from '@kompass/core/testing';
import { contactRoles, createContact } from '@kompass/module-contacts';
import { documents } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getClosingStatus } from '../src/closing/status';
import { assemblyOfYearInternal, fileAssemblyMinutes, getAssemblyResult, saveAssemblyResult } from '../src/closing/assembly';
import { allowHumanOnlyOverMcp, insertDocument, ledgerFixture, pdfBytes } from './helpers';

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));
const fields = (r: { ok: boolean; error?: unknown }) => (r.ok ? [] : ((r.error as { issues?: { path: string; message: string }[] }).issues ?? []).map((i) => `${i.path}:${i.message}`));

async function setup() {
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const contactCtx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const person = async (lastName: string) => unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Testa', lastName }));
  const role = (contactId: string, role: string, since: string, until: string | null = null, note: string | null = null) => f.deps.db.insert(contactRoles).values({ id: newId(), contactId, role, since, until, note }).run();
  const anna = await person('Amtsfrau');
  const bert = await person('Beisitzer');
  const carl = await person('Kassierer');
  const old = await person('Ehemalig');
  role(anna.id, 'board-member', '2020-01-01', null, 'Vorsitzende');
  role(bert.id, 'board-member', '2025-04-01');
  role(carl.id, 'treasurer', '2024-01-01', '2025-09-30');
  role(old.id, 'board-member', '2018-01-01', '2024-12-31');
  return { f, y2025, anna, bert, carl, old };
}

describe('Ergebnis der Mitgliederversammlung (Rechenschaft C Schritt 11)', () => {
  it('lists the board and the treasurer of the year with their office and period', async () => {
    const { f, y2025, anna, bert, carl } = await setup();
    const res = unwrap(await getAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(res.result).toBeNull();
    expect(res.persons).toEqual([
      { contactId: anna.id, name: 'Testa Amtsfrau', office: 'Vorsitzende', since: null, until: null },
      { contactId: bert.id, name: 'Testa Beisitzer', office: null, since: '2025-04-01', until: null },
      { contactId: carl.id, name: 'Testa Kassierer', office: null, since: null, until: '2025-09-30' },
    ]);
    expect(code(await getAssemblyResult(f.deps, ctxWith(['finance.overview'], f.userId), { fiscalYearId: y2025 }))).toBe('forbidden');
  });

  it('saves the result in an ended, closed year — individual discharges of the board only, without a preselection', async () => {
    const { f, y2025, anna, bert, carl, old } = await setup();
    const save = (input: Record<string, unknown>) => saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2025, assemblyOn: '2026-03-14', dischargeMode: 'individual', ...input });
    expect(code(await save({}))).toBe('assemblyYearOpen');
    f.closeYear(y2025);
    expect(fields(await save({ assemblyOn: '2025-12-31' }))).toEqual(['assemblyOn:notAfterYearEnd']);
    expect(fields(await save({ assemblyOn: '2026-12-01' }))).toEqual(['assemblyOn:inFuture']);
    expect(fields(await save({ discharges: [{ contactId: old.id, outcome: 'granted' }] }))).toEqual(['discharges.0.contactId:notBoardOfYear']);
    const invoice = insertDocument(f, { subject: 'Rechnung' });
    expect(fields(await save({ minutesDocumentId: invoice }))).toEqual(['minutesDocumentId:notMinutes']);
    const first = unwrap(await save({ accountsApproved: 'yes', discharges: [{ contactId: anna.id, outcome: 'granted' }, { contactId: bert.id, outcome: 'refused' }] }));
    expect(first).toMatchObject({ assemblyOn: '2026-03-14', accountsApproved: 'yes', dischargeMode: 'individual', granted: 1, total: 3, complete: false });
    expect(first.discharges).toEqual([
      { contactId: anna.id, outcome: 'granted', decidedOn: '2026-03-14' },
      { contactId: bert.id, outcome: 'refused', decidedOn: '2026-03-14' },
      { contactId: carl.id, outcome: null, decidedOn: null },
    ]);
    expect(JSON.parse(auditEntry(f.deps, 'finance.assembly.save').params!)).toEqual({ designation: '2025', dischargeMode: 'individual', granted: 1, open: 1 });
    expect(code(await save({ expectedVersion: 'alt' }))).toBe('staleVersion');
    f.deps.clock.advance(60_000);
    // Nachtrag aus einer späteren MV: nur, wessen Ergebnis sich ändert, bekommt das neue Datum.
    const later = unwrap(await save({ assemblyOn: '2026-06-20', expectedVersion: first.version, discharges: [{ contactId: anna.id, outcome: 'granted' }, { contactId: bert.id, outcome: 'granted' }, { contactId: carl.id, outcome: 'granted' }] }));
    expect(later.discharges.map((d) => d.decidedOn)).toEqual(['2026-03-14', '2026-06-20', '2026-06-20']);
    expect(later).toMatchObject({ granted: 3, total: 3, complete: true });
    // V-7: das Protokoll nennt beim Überschreiben, was vorher galt; die erste Speicherung hat kein `before`.
    const saves = f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === 'finance.assembly.save');
    expect(saves[0]!.before).toBeNull();
    expect(JSON.parse(saves.at(-1)!.before!)).toEqual({ fiscalYearId: y2025, assemblyOn: '2026-03-14', dischargeMode: 'individual', accountsApproved: 'yes', granted: 1, total: 3, minutesDocumentId: null });
    expect(assemblyOfYearInternal(f.deps, f.deps.db, y2025, 'Europe/Berlin')?.complete).toBe(true);
  });

  it('a collective discharge is complete only when granted', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    const save = (collectiveOutcome: string) => saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome });
    expect(unwrap(await save('postponed'))).toMatchObject({ complete: false, discharges: [], granted: 0, total: 1 });
    f.deps.clock.advance(60_000);
    expect(unwrap(await save('granted'))).toMatchObject({ complete: true, granted: 1, total: 1 });
  });

  it('names the open discharges for the head of the closing (14b)', async () => {
    const { f, y2025, anna, bert, carl } = await setup();
    f.closeYear(y2025);
    unwrap(await saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2025, assemblyOn: '2026-03-14', dischargeMode: 'individual', discharges: [{ contactId: anna.id, outcome: 'granted' }, { contactId: bert.id, outcome: 'postponed' }, { contactId: carl.id, outcome: 'refused' }] }));
    const status = unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(status.steps.find((s) => s.key === 'assembly')!.facts).toMatchObject({ pending: [{ name: 'Testa Beisitzer', outcome: 'postponed' }, { name: 'Testa Kassierer', outcome: 'refused' }] });
  });

  it('is a personal declaration and needs finance.periodClose', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    const input = { fiscalYearId: y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'granted' };
    expect(code(await saveAssemblyResult(f.deps, { ...f.ctx, channel: 'mcp' }, input))).toBe('humanOnly');
    expect(code(await saveAssemblyResult(f.deps, ctxWith(['finance.read'], f.userId), input))).toBe('forbidden');
    allowHumanOnlyOverMcp(f.deps);
    expect(code(await saveAssemblyResult(f.deps, { ...f.ctx, channel: 'mcp' }, input))).toBe('ok');
  });

  it('files the minutes as a PDF at the fiscal year', async () => {
    const { f, y2025 } = await setup();
    f.closeYear(y2025);
    expect(code(await fileAssemblyMinutes(f.deps, f.ctx, { fiscalYearId: y2025, bytes: pdfBytes() }))).toBe('assemblyNotRecorded');
    unwrap(await saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'granted' }));
    expect(fields(await fileAssemblyMinutes(f.deps, f.ctx, { fiscalYearId: y2025, bytes: new TextEncoder().encode('kein pdf') }))).toEqual(['bytes:notPdf']);
    const filed = unwrap(await fileAssemblyMinutes(f.deps, f.ctx, { fiscalYearId: y2025, bytes: pdfBytes(), fileName: 'protokoll.pdf' }));
    const doc = f.deps.db.select().from(documents).where(eq(documents.id, filed.minutesDocumentId!)).get()!;
    expect(doc).toMatchObject({ typeKey: 'minutes', documentDate: '2026-03-14' });
    expect(JSON.parse(auditEntry(f.deps, 'finance.assembly.minutesFile').params!)).toEqual({ designation: '2025', documentNumber: doc.number });
    expect(code(await fileAssemblyMinutes(f.deps, { ...f.ctx, channel: 'mcp' }, { fiscalYearId: y2025, bytes: pdfBytes() }))).toBe('humanOnly');
  });
});
