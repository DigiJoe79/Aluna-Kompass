import { defineModule, isModuleEnabled, schema, unwrap, type Result } from '@kompass/core';
import { createContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { copyPartnerPayment, getPartnerPayment, savePartnerPaymentDraft } from '../src/allocation/partner-payments';
import { savePartnerProfile } from '../src/allocation/partners';
import { registerResolutionFactsSource, type ResolutionFacts } from '../src/sources';
import { ledgerFixture } from './helpers';
import { insertPartnerPayment } from './partner-fixture';

/**
 * Befund G7 (Joe 2026-10-29): eine Partnerzahlung verweist über ein eigenes Feld `resolutionId` auf den Beschluss, der
 * sie trägt — dieselbe Prüfung wie Rücklage und Beitragsordnung, aber jede Art außer den Beschlüssen über Personen und
 * Jahresrechnung. `P1` Zahlung (einfacher Beschluss), `P2` nicht festgeschrieben, `P3` Entlastung, `P4` abgelehnt,
 * `P5` Wahl, `P6` Rücklage.
 */
const FACTS: Record<string, ResolutionFacts> = {
  P1: { kind: 'simple', final: true, outcome: 'adopted', decidedOn: '2026-03-14' },
  P2: { kind: 'simple', final: false, outcome: 'adopted', decidedOn: '2026-07-15' },
  P3: { kind: 'discharge', final: true, outcome: 'adopted', decidedOn: '2026-03-14' },
  P4: { kind: 'simple', final: true, outcome: 'rejected', decidedOn: '2026-03-14' },
  P5: { kind: 'election', final: true, outcome: 'adopted', decidedOn: '2026-03-14' },
  P6: { kind: 'reserve', final: true, outcome: 'adopted', decidedOn: '2026-03-14' },
};
registerResolutionFactsSource((deps, _db, id) => (isModuleEnabled(deps, 'governance') ? (FACTS[id] ?? null) : null));
const resolutionsLike = defineModule({
  key: 'governance',
  version: '1',
  permissions: ['governance.read'],
  recordLabels: (_deps, _ctx, entityType, id) => (entityType !== 'governanceResolution' ? null : FACTS[id] ? { label: `Beschluss ${id}`, href: `/governance/resolutions/${id}`, state: 'ok' } : { label: '', href: null, state: 'missing' }),
});

async function fixture(withGovernance = true) {
  const f = await ledgerFixture(withGovernance ? { extraModules: [resolutionsLike] } : {});
  const org = unwrap(await createContact(f.deps, { ...f.ctx, permissions: new Set(['contacts.manage']) }, { kind: 'organization', name: 'Empfängerverein e.V.' }));
  const partner = unwrap(await savePartnerProfile(f.deps, f.ctx, { contactId: org.id, status: 'publicBody' }));
  const base = { partnerId: partner.id, basis: 'transfer58', purposeText: 'Futter', retroactive: false, positions: [{ kind: 'money', amountCents: 5000, categoryId: f.programCosts.id }] };
  return { ...f, partner, base };
}

const issues = (r: Result<unknown>) => (r.ok ? null : (r.error as { type: string; issues?: unknown[] }));

describe('partner payment cites a resolution (G7, resolutionId)', () => {
  it('stores the resolution with label and link, keeps it when the screen saves without the field, removes it with null', async () => {
    const f = await fixture();
    const draft = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { ...f.base, resolutionId: 'P1' }));
    expect(draft).toMatchObject({ resolutionId: 'P1', resolution: { label: 'Beschluss P1', href: '/governance/resolutions/P1' } });
    // Die Maske kennt das Feld nicht: Speichern ohne `resolutionId` lässt den Verweis stehen.
    const kept = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { ...f.base, id: draft.id, expectedVersion: draft.version, purposeText: 'Futter und Decken' }));
    expect(kept.resolutionId).toBe('P1');
    const audit = f.deps.db.select().from(schema.auditLog).all().filter((a) => a.action === 'finance.partnerPayment.saveDraft');
    expect(audit.map((a) => JSON.parse(a.after!).resolutionId)).toEqual(['P1', 'P1']);
    // Eine abgelehnte Zahlung neu ansetzen nimmt den Beschluss mit.
    const rejected = insertPartnerPayment(f.deps.db, f.partner.id, { state: 'rejected', resolutionId: 'P1', createdByUserId: f.userId });
    expect(unwrap(await copyPartnerPayment(f.deps, f.ctx, { id: rejected })).resolutionId).toBe('P1');
    const cleared = unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, { ...f.base, id: draft.id, expectedVersion: kept.version, resolutionId: null }));
    expect(cleared).toMatchObject({ resolutionId: null, resolution: null });
    expect(unwrap(await getPartnerPayment(f.deps, f.ctx, { id: draft.id })).resolution).toBeNull();
  });

  it('only a sealed, adopted resolution, of any kind but discharge, accounts, election and dismissal', async () => {
    const f = await fixture();
    const save = async (resolutionId: string) => savePartnerPaymentDraft(f.deps, f.ctx, { ...f.base, resolutionId });
    expect(issues(await save('P9'))).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionUnknown' }] });
    expect(issues(await save('P2'))).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionNotFinal' }] });
    expect(issues(await save('P4'))).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionNotFinal' }] });
    expect(issues(await save('P3'))).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionWrongKind', params: { expected: 'partnerPayment' } }] });
    expect(issues(await save('P5'))).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionWrongKind', params: { expected: 'partnerPayment' } }] });
    expect(unwrap(await save('P6')).resolutionId).toBe('P6');
  });

  it('without Gremien a resolution id is unknown and the payment shows none', async () => {
    const f = await fixture(false);
    expect(issues(await savePartnerPaymentDraft(f.deps, f.ctx, { ...f.base, resolutionId: 'P1' }))).toMatchObject({ type: 'validation', issues: [{ path: 'resolutionId', message: 'resolutionUnknown' }] });
    expect(unwrap(await savePartnerPaymentDraft(f.deps, f.ctx, f.base))).toMatchObject({ resolutionId: null, resolution: null });
  });
});
