import type { DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { describe, expect, it } from 'vitest';
import { buildPayload, coreDocumentTemplates, createTypstRenderer, firstFontFamily } from '../src';

const ctx: DocumentRenderContext = {
  number: 'BRF-2026-007',
  issuedAt: '2026-09-05T08:00:00.000Z',
  organization: { 'organization.name': 'Musterverein e.V.' },
  theme: DEFAULT_THEME,
  logo: null,
};

describe('core document templates', () => {
  it('firstFontFamily strips quotes and fallbacks', () => {
    expect(firstFontFamily('"Source Sans 3", system-ui, sans-serif')).toBe('Source Sans 3');
    expect(firstFontFamily('Georgia, serif')).toBe('Georgia');
  });

  it('buildPayload maps theme tokens and formats the issue date in German order', () => {
    const payload = buildPayload({ title: 't' }, ctx);
    expect(payload).toMatchObject({ number: 'BRF-2026-007', issuedDate: '05.09.2026', hasLogo: false, brand: { primary: '#2F5D68', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' } });
  });

  it('exposes letterhead (BRF) and audit-log-export (PRO) with schemas and renders both', async () => {
    const templates = coreDocumentTemplates(createTypstRenderer());
    expect(templates.map((t) => [t.key, t.prefix, t.permission ?? null])).toEqual([['letterhead', 'BRF', null], ['audit-log-export', 'PRO', 'audit.view']]);
    const letter = templates[0]!;
    expect(letter.schema.safeParse({ title: '', body: 'x' }).success).toBe(false);
    const pdf = await letter.render({ title: 'Einladung', body: 'Sehr geehrte Mitglieder,\n\nhiermit laden wir ein.', letterhead: true }, ctx);
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    const audit = templates[1]!;
    const pdf2 = await audit.render({ title: 'Änderungsprotokoll', filters: { Kanal: 'Alle' }, entries: [{ occurredAt: '2026-09-05T08:00:00.000Z', userName: 'Anna Berger', channel: 'ui', action: 'settings.update', entityType: 'setting', entityId: 'organization.name', summary: 'geändert' }] }, { ...ctx, number: 'PRO-2026-001' });
    expect(pdf2.byteLength).toBeGreaterThan(3000);
  });
});
