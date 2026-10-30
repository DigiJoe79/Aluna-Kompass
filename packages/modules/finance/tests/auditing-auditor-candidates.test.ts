import { unwrap, type CallContext } from '@kompass/core';
import { ctxWith, systemContext } from '@kompass/core/testing';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { auditorCandidates } from '../src/auditing/auditor-candidates';
import { saveAuditor } from '../src/auditing/auditors';
import { registerAuditorCandidateSource, type AuditorCandidate } from '../src/sources';
import { ledgerFixture } from './helpers';

/** Die Testquelle liefert, was `current` sagt — leer heißt „Gremien aus“ oder „niemand gewählt“. */
let current: AuditorCandidate[] = [];
registerAuditorCandidateSource(() => current);

const code = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : ((r.error as { code?: string; type: string }).code ?? (r.error as { type: string }).type));

async function setup() {
  current = [];
  const f = await ledgerFixture({ years: ['2025', '2026'] });
  const y2025 = f.years['2025']!.id;
  const contactCtx: CallContext = { ...systemContext(), permissions: new Set(['contacts.manage']) };
  const irmgard = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Irmgard', lastName: 'Prüfend' }));
  const kasimir = unwrap(await createContact(f.deps, contactCtx, { kind: 'person', firstName: 'Kasimir', lastName: 'Prüfend' }));
  const candidate = (contactId: string, name: string): AuditorCandidate => ({ contactId, name, electedOn: '2025-03-20', minutesDocumentId: null, source: { label: 'Beschluss B-2025-002', href: '/governance/resolutions/R1' } });
  return { f, y2025, irmgard, kasimir, candidate };
}

describe('auditorCandidates (G7)', () => {
  it('suggests the auditors the source names, without those already listed for the year', async () => {
    const { f, y2025, irmgard, kasimir, candidate } = await setup();
    current = [candidate(irmgard.id, 'Irmgard Prüfend'), candidate(kasimir.id, 'Kasimir Prüfend')];
    unwrap(await saveAuditor(f.deps, f.ctx, { fiscalYearId: y2025, contactId: irmgard.id, mode: 'paper' }));
    expect(unwrap(await auditorCandidates(f.deps, f.ctx, { fiscalYearId: y2025 }))).toEqual([candidate(kasimir.id, 'Kasimir Prüfend')]);
  });

  it('without a source delivering anything (Gremien off): an empty list', async () => {
    const { f, y2025 } = await setup();
    expect(unwrap(await auditorCandidates(f.deps, f.ctx, { fiscalYearId: y2025 }))).toEqual([]);
  });

  it('refuses without finance.periodClose, an unknown year and invalid input', async () => {
    const { f, y2025 } = await setup();
    expect(code(await auditorCandidates(f.deps, ctxWith(['finance.read'], f.userId), { fiscalYearId: y2025 }))).toBe('forbidden');
    expect(code(await auditorCandidates(f.deps, f.ctx, { fiscalYearId: 'nope' }))).toBe('notFound');
    expect(code(await auditorCandidates(f.deps, f.ctx, {}))).toBe('validation');
  });
});
