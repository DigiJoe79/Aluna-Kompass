import { newId, unwrap, type CallContext } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { contactRoles, createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { assemblyOfYearInternal, fileAssemblyMinutes, getAssemblyResult, saveAssemblyResult } from '../src/closing/assembly';
import { getClosingStatus } from '../src/closing/status';
import { registerAssemblyResultSource, type GovernedAssembly } from '../src/sources';
import { ledgerFixture, pdfBytes } from './helpers';

/** Die Testquelle liefert, was `current` gerade sagt — `null` heißt „Gremien aus“ oder „keine festgeschriebene MV“. */
let current: GovernedAssembly | null = null;
registerAssemblyResultSource(() => current);

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));

async function setup() {
  current = null;
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const contactCtx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const anna = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Testa', lastName: 'Amtsfrau' }));
  const bert = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Testa', lastName: 'Beisitzer' }));
  f.deps.db.insert(contactRoles).values({ id: newId(), contactId: anna.id, role: 'board-member', since: '2020-01-01', until: null, note: 'Vorsitzende' }).run();
  f.deps.db.insert(contactRoles).values({ id: newId(), contactId: bert.id, role: 'board-member', since: '2025-04-01', until: null, note: null }).run();
  return { f, y2025, anna, bert };
}

const governed = (discharges: GovernedAssembly['discharges'], over: Partial<GovernedAssembly> = {}): GovernedAssembly => ({
  source: { module: 'governance', meetingId: 'M1', label: 'Mitgliederversammlung 14.03.2026', href: '/governance/meetings/M1' },
  assemblyOn: '2026-03-14',
  minutesDocumentId: null,
  accountsApproved: 'yes',
  dischargeMode: 'individual',
  collectiveOutcome: null,
  discharges,
  ...over,
});

describe('Schritt 11 aus einer registrierten Quelle (G7)', () => {
  it('without anything from the source: as before, nothing managed', async () => {
    const { f, y2025 } = await setup();
    expect(assemblyOfYearInternal(f.deps, f.deps.db, y2025, 'Europe/Berlin')).toBeNull();
    f.closeYear(y2025);
    const saved = unwrap(await saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'granted' }));
    expect(saved.managed).toBeNull();
    expect(saved.complete).toBe(true);
  });

  it('shows what the source delivers, managed, with complete computed and step 11 done', async () => {
    const { f, y2025, anna, bert } = await setup();
    current = governed([
      { contactId: anna.id, outcome: 'granted', decidedOn: '2026-03-14' },
      { contactId: bert.id, outcome: 'postponed', decidedOn: '2026-03-14' },
    ]);
    const open = assemblyOfYearInternal(f.deps, f.deps.db, y2025, 'Europe/Berlin')!;
    expect(open).toMatchObject({ assemblyOn: '2026-03-14', accountsApproved: 'yes', granted: 1, total: 2, complete: false, updatedByUserId: null, managed: { module: 'governance', meetingId: 'M1', label: 'Mitgliederversammlung 14.03.2026', href: '/governance/meetings/M1' } });
    current = governed([
      { contactId: anna.id, outcome: 'granted', decidedOn: '2026-03-14' },
      { contactId: bert.id, outcome: 'granted', decidedOn: '2026-06-20' },
    ]);
    const res = unwrap(await getAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(res.result).toMatchObject({ complete: true, discharges: [{ contactId: anna.id, outcome: 'granted', decidedOn: '2026-03-14' }, { contactId: bert.id, outcome: 'granted', decidedOn: '2026-06-20' }] });
    f.closeYear(y2025);
    const status = unwrap(await getClosingStatus(f.deps, f.ctx, { fiscalYearId: y2025 }));
    expect(status.steps.find((s) => s.key === 'assembly')!.done).toBe(true);
  });

  it('a collective result from the source counts as one', async () => {
    const { f, y2025 } = await setup();
    current = governed([], { dischargeMode: 'collective', collectiveOutcome: 'refused' });
    expect(assemblyOfYearInternal(f.deps, f.deps.db, y2025, 'Europe/Berlin')).toMatchObject({ granted: 0, total: 1, complete: false, discharges: [] });
  });

  it('saving by hand is refused once the source delivers — in the open and in the closed year', async () => {
    const { f, y2025, anna } = await setup();
    current = governed([{ contactId: anna.id, outcome: 'granted', decidedOn: '2026-03-14' }]);
    const save = () => saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'granted' });
    const refused = await save();
    expect(code(refused)).toBe('assemblyManagedByGovernance');
    expect(refused.ok ? null : refused.error).toMatchObject({ messageKey: 'finance.errors.assemblyManagedByGovernance', params: { label: 'Mitgliederversammlung 14.03.2026' } });
    f.closeYear(y2025);
    expect(code(await save())).toBe('assemblyManagedByGovernance');
  });

  it('filing minutes in finance is refused as well — the minutes belong to the meeting in Gremien', async () => {
    const { f, y2025, anna } = await setup();
    current = governed([{ contactId: anna.id, outcome: 'granted', decidedOn: '2026-03-14' }]);
    expect(code(await fileAssemblyMinutes(f.deps, f.ctx, { fiscalYearId: y2025, bytes: pdfBytes() }))).toBe('assemblyManagedByGovernance');
  });

  it('once the source delivers nothing (Gremien off), saving by hand works as before', async () => {
    const { f, y2025 } = await setup();
    current = null;
    f.closeYear(y2025);
    expect(code(await saveAssemblyResult(f.deps, f.ctx, { fiscalYearId: y2025, assemblyOn: '2026-03-14', dischargeMode: 'collective', collectiveOutcome: 'granted' }))).toBe('ok');
  });
});
