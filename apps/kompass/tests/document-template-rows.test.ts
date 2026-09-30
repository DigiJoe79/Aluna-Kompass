import { describe, expect, it } from 'vitest';
import { documentTemplateGroups } from '@/lib/document-template-rows';

const bases = [
  { id: 'a4-plain', label: 'Bericht', ok: true },
  { id: 'a4-plain-slim', label: 'Bericht (schlank)', ok: true },
  { id: 'a4-kaputt', label: 'Kaputt', ok: false },
];
const templates = [
  { key: 'audit-log-export', base: 'a4-plain-slim' },
  { key: 'letter', base: 'a4-plain' },
  { key: 'finance-cash-count', base: 'a4-plain' },
];
const manifests = [
  { key: 'core' },
  { key: 'dms', documentTemplates: [{ key: 'letter' }] },
  { key: 'finance', documentTemplates: [{ key: 'finance-cash-count' }] },
];

/**
 * Die Seite Dokumentvorlagen zeigte nicht, worauf ein Dokument tatsächlich erscheint: „Vorgabe der Vorlage“
 * ohne die Basis dahinter, und eine Übersteuerung sah aus wie jede andere Zeile (2026-09-30).
 */
describe('documentTemplateGroups', () => {
  it('groups by module, core first, and names default, override and effective base', () => {
    const groups = documentTemplateGroups(templates, manifests, { letter: 'a4-plain-slim' }, bases);
    expect(groups.map((g) => g.module)).toEqual(['core', 'dms', 'finance']);
    expect(groups[0]!.rows).toEqual([{ key: 'audit-log-export', defaultBase: 'a4-plain-slim', override: null, effectiveBase: 'a4-plain-slim', effectiveLabel: 'Bericht (schlank)', available: true }]);
    expect(groups[1]!.rows[0]).toEqual({ key: 'letter', defaultBase: 'a4-plain', override: 'a4-plain-slim', effectiveBase: 'a4-plain-slim', effectiveLabel: 'Bericht (schlank)', available: true });
  });

  it('flags a base that is missing or broken, for an override as well as for a default', () => {
    const groups = documentTemplateGroups(templates, manifests, { letter: 'a4-weg', 'finance-cash-count': 'a4-kaputt' }, bases);
    expect(groups[1]!.rows[0]).toMatchObject({ override: 'a4-weg', effectiveBase: 'a4-weg', effectiveLabel: 'a4-weg', available: false });
    expect(groups[2]!.rows[0]).toMatchObject({ override: 'a4-kaputt', effectiveLabel: 'Kaputt', available: false });
  });

  it('leaves out modules without templates and keeps a template of an unknown module under core', () => {
    const groups = documentTemplateGroups([{ key: 'x', base: 'a4-plain' }], [{ key: 'core' }, { key: 'animals' }], {}, bases);
    expect(groups).toEqual([{ module: 'core', rows: [expect.objectContaining({ key: 'x' })] }]);
  });
});
