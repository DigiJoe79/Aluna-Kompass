import { unwrap } from '@kompass/core';
import { createAuditRemark, listAuditRemarks, listAuditors, registerAuditResolutionSource } from '@kompass/module-finance';
import { createTranslator } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';
import { auditFixture } from '../../../packages/modules/finance/tests/auditing-fixture';

vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({ getTranslations: async (ns?: string) => createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin', ...(ns ? { namespace: ns as never } : {}) }) }));
const { remarkViews } = await import('@/lib/finance/audit-remarks');

/**
 * Schlussdurchsicht D1e (I2): Ein Vermerk zum Jahr springt in der Liste der Übersicht auf den Verlauf derselben Seite;
 * andere Seiten (Prüfbericht: Feststellungen, offene Fragen) brauchen den Weg zur Übersicht.
 */
describe('remarkViews: Ziel eines Vermerks zum Jahr', () => {
  it('carries the way to the overview for other pages and the in-page jump for the list', async () => {
    const a = await auditFixture();
    unwrap(await createAuditRemark(a.f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'question', targetType: 'year', targetId: a.y2025, text: 'Wo liegt das Kassenbuch?' }));
    const remarks = unwrap(await listAuditRemarks(a.f.deps, a.f.ctx, { fiscalYearId: a.y2025 })).remarks;
    const auditors = unwrap(await listAuditors(a.f.deps, a.f.ctx, { fiscalYearId: a.y2025 })).auditors;
    const { rows } = await remarkViews(a.f.deps as never, a.f.ctx, remarks, { auditors, fiscalYearId: a.y2025, designation: '2025' });
    expect(rows[0]!.targetHref).toBe(`/finance/audit?year=${encodeURIComponent(a.y2025)}#vermerke-jahr`);
    expect(rows[0]!.inPageHref).toBe('#vermerke-jahr');
  });
});

describe('remarkViews: Ziel eines Vermerks an einem Beschluss (G-30)', () => {
  it('names the resolution by its number and leads to section 9', async () => {
    registerAuditResolutionSource(() => [{ id: 'R1', number: 'B-2025-003', decidedOn: '2025-03-14', kind: 'reserve', outcome: 'adopted', organ: 'Mitgliederversammlung', viaCircular: false, minutesDocumentId: null, facts: {} }]);
    const a = await auditFixture();
    unwrap(await createAuditRemark(a.f.deps, a.mira.ctx, { fiscalYearId: a.y2025, kind: 'question', targetType: 'resolution', targetId: 'R1', text: 'Wofür?' }));
    const remarks = unwrap(await listAuditRemarks(a.f.deps, a.f.ctx, { fiscalYearId: a.y2025 })).remarks;
    const { rows } = await remarkViews(a.f.deps as never, a.f.ctx, remarks, { auditors: [], fiscalYearId: a.y2025, designation: '2025' });
    expect(rows[0]!.targetLabel).toContain('B-2025-003');
    expect(rows[0]!.targetHref).toBe(`/finance/audit/resolutions?year=${encodeURIComponent(a.y2025)}#vermerke-beschluesse`);
  });
});
