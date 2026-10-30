import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { createAuditRemark, listAuditRemarks } from '../src/auditing/remarks';
import { markSectionReviewed } from '../src/auditing/samples';
import { getAuditSection } from '../src/auditing/sections';
import { getAuditStatus } from '../src/auditing/status';
import { readAuditResolutionMinutes } from '../src/auditing/resolutions';
import { registerAuditResolutionSource, type AuditResolution } from '../src/sources';
import { auditFixture } from './auditing-fixture';
import { insertDocument } from './helpers';

/** Eine Quelle wie Gremien (G-30): `null`, solange das Modul „aus“ ist. */
let delivered: AuditResolution[] | null = null;
registerAuditResolutionSource(() => delivered);

const resolution = (o: Partial<AuditResolution> & Pick<AuditResolution, 'id' | 'number' | 'kind'>): AuditResolution => ({ decidedOn: '2025-03-14', outcome: 'adopted', organ: 'Mitgliederversammlung', viaCircular: false, minutesDocumentId: null, facts: {}, ...o });

async function world() {
  const a = await auditFixture();
  const minutes = insertDocument(a.f, { subject: 'Protokoll', typeKey: 'letter' });
  delivered = [
    resolution({ id: 'R1', number: 'B-2025-001', kind: 'remuneration', minutesDocumentId: minutes, facts: { amountCents: 84000, remunerationMode: 'flat', organs: 'Vorstand', validFrom: '2025-01-01' } }),
    resolution({ id: 'R2', number: 'B-2025-004', kind: 'reserve', decidedOn: '2025-08-03', outcome: 'rejected', organ: 'Vorstand', viaCircular: true, facts: { amountCents: 500000, reserveType: 'nr1', fiscalYear: '2025' } }),
  ];
  return { ...a, minutes };
}

describe('Kassenprüfung, Abschnitt 9 „Beschlüsse“ (G-30)', () => {
  it('without a source that delivers (Gremien off): eight sections, and section 9 does not exist', async () => {
    const { f, y2025, mira } = await world();
    delivered = null;
    expect(unwrap(await getAuditStatus(f.deps, mira.ctx, { fiscalYearId: y2025 })).sections).toHaveLength(8);
    expect(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'resolutions' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
    expect(await markSectionReviewed(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'resolutions' })).toMatchObject({ ok: false, error: { type: 'notFound' } });
  });

  it('with Gremien: the ninth section lists the resolutions by date with codes and values, the minutes by number', async () => {
    const { f, y2025, mira, minutes } = await world();
    expect(unwrap(await getAuditStatus(f.deps, mira.ctx, { fiscalYearId: y2025 })).sections.at(-1)).toBe('resolutions');
    const section = unwrap(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'resolutions' }));
    expect(section.rows.map((r) => [r.key, r.kind, r.date, r.amountCents])).toEqual([
      ['resolution:R1', 'resolution', '2025-03-14', 84000],
      ['resolution:R2', 'resolution', '2025-08-03', 500000],
    ]);
    expect(section.rows[0]!.labelParams).toMatchObject({ number: 'B-2025-001', resolutionKind: 'remuneration', outcome: 'adopted', organ: 'Mitgliederversammlung', viaCircular: false, minutesDocumentId: minutes, minutesNumber: expect.stringMatching(/^DOC-/), remunerationMode: 'flat', organs: 'Vorstand', validFrom: '2025-01-01' });
    expect(section.rows[1]!.labelParams).toMatchObject({ outcome: 'rejected', viaCircular: true, minutesDocumentId: null, minutesNumber: null, reserveType: 'nr1', fiscalYear: '2025' });
    // Suche über Nummer und Betrag wie in den anderen Abschnitten.
    expect(unwrap(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'resolutions', text: 'B-2025-004' })).rows.map((r) => r.key)).toEqual(['resolution:R2']);
    expect(unwrap(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'resolutions', text: '840,00' })).rows.map((r) => r.key)).toEqual(['resolution:R1']);
  });

  it('a remark at a resolution of the year counts at its row; one at an unknown resolution is refused; the section can be reviewed', async () => {
    const { f, y2025, mira } = await world();
    const remark = unwrap(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'resolution', targetId: 'R2', text: 'Warum abgelehnt?' }));
    expect(remark.target).toEqual({ type: 'resolution', id: 'R2' });
    expect(await createAuditRemark(f.deps, mira.ctx, { fiscalYearId: y2025, kind: 'question', targetType: 'resolution', targetId: 'R9', text: 'x' })).toMatchObject({ ok: false, error: { code: 'remarkTargetNotInYear' } });
    const rows = unwrap(await getAuditSection(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'resolutions' })).rows;
    expect(rows.map((r) => r.remarksOpen)).toEqual([0, 1]);
    expect(unwrap(await listAuditRemarks(f.deps, mira.ctx, { fiscalYearId: y2025, targetType: 'resolution' })).remarks).toHaveLength(1);
    unwrap(await markSectionReviewed(f.deps, mira.ctx, { fiscalYearId: y2025, section: 'resolutions' }));
    expect(unwrap(await getAuditStatus(f.deps, mira.ctx, { fiscalYearId: y2025 })).sectionsReviewed.map((s) => s.section)).toContain('resolutions');
  });

  it('the minutes of a listed resolution are read under finance.audit; an unlisted one or no minutes: not found; without the right: forbidden', async () => {
    const { f, y2025, mira } = await world();
    // Die Datei des Beispieldokuments fehlt — `notFound` der Datei heißt: Recht und Bezug haben gepasst.
    expect(await readAuditResolutionMinutes(f.deps, mira.ctx, { fiscalYearId: y2025, resolutionId: 'R1' })).toMatchObject({ ok: false, error: { type: 'notFound', entity: 'documentFile' } });
    expect(await readAuditResolutionMinutes(f.deps, mira.ctx, { fiscalYearId: y2025, resolutionId: 'R2' })).toMatchObject({ ok: false, error: { type: 'notFound', entity: 'linkedDocument' } });
    expect(await readAuditResolutionMinutes(f.deps, mira.ctx, { fiscalYearId: y2025, resolutionId: 'R9' })).toMatchObject({ ok: false, error: { type: 'notFound', entity: 'linkedDocument' } });
    expect(await readAuditResolutionMinutes(f.deps, ctxWith(['finance.read']), { fiscalYearId: y2025, resolutionId: 'R1' })).toMatchObject({ ok: false, error: { type: 'forbidden', permission: 'finance.audit' } });
    expect(await readAuditResolutionMinutes(f.deps, mira.ctx, { fiscalYearId: y2025 })).toMatchObject({ ok: false, error: { type: 'validation' } });
  });
});
