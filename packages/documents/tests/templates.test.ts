import { isoDay, type DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { describe, expect, it } from 'vitest';
import { buildPayload, coreDocumentTemplates, firstFontFamily } from '../src';

const ctx: DocumentRenderContext = {
  number: 'BRF-2026-007',
  issuedAt: '2026-09-05T08:00:00.000Z',
  issuedDay: isoDay('2026-09-05'),
  organization: { 'organization.name': 'Musterverein e.V.' },
  theme: DEFAULT_THEME,
  logo: null,
};

describe('core document templates', () => {
  it('firstFontFamily strips quotes and fallbacks', () => {
    expect(firstFontFamily('"Source Sans 3", system-ui, sans-serif')).toBe('Source Sans 3');
    expect(firstFontFamily('Georgia, serif')).toBe('Georgia');
  });

  it('buildPayload maps theme tokens including the soft accent, and formats the date in German order', () => {
    const payload = buildPayload(ctx);
    expect(payload).toMatchObject({
      number: 'BRF-2026-007',
      issuedDate: '05.09.2026',
      brand: { primary: '#2F5D68', primarySoft: '#E3EEF0', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' },
    });
  });

  it('buildPayload druckt den Tag aus dem Kontext, nicht den UTC-Tag des Zeitstempels (K10)', () => {
    const late = { ...ctx, issuedAt: '2026-09-12T22:30:00.000Z', issuedDay: isoDay('2026-09-13') };
    expect(buildPayload(late).issuedDate).toBe('13.09.2026');
  });

  it('exposes audit-log-export (type audit-export) as build() on a default base', () => {
    const audit = coreDocumentTemplates().find((t) => t.key === 'audit-log-export')!;
    expect([audit.type, audit.permission, audit.base]).toEqual(['audit-export', 'audit.view', 'a4-plain-slim']);
    // Der Protokollauszug wird nur gezogen — keine Nummer, keine Ablage.
    expect(audit.filed).toBe(false);

    const a = audit.build({ title: 'Protokoll', filters: { Kanal: 'Alle' }, entries: [] }, { ...ctx, number: 'PRO-2026-001' });
    expect(a.slots).toMatchObject({ kind: 'report', title: 'Protokoll' });
    expect('typst' in a.body && a.body.typst).toContain('table(');
  });
});
