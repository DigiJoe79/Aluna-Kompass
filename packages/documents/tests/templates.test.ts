import type { DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { describe, expect, it } from 'vitest';
import { buildPayload, coreDocumentTemplates, firstFontFamily } from '../src';

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

  it('buildPayload maps theme tokens including the soft accent, and formats the date in German order', () => {
    const payload = buildPayload(ctx);
    expect(payload).toMatchObject({
      number: 'BRF-2026-007',
      issuedDate: '05.09.2026',
      brand: { primary: '#2F5D68', primarySoft: '#E3EEF0', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' },
    });
  });

  it('exposes audit-log-export (type audit-export) as build() on a default base', () => {
    const templates = coreDocumentTemplates();
    expect(templates).toHaveLength(1);
    const audit = templates[0]!;
    expect([audit.key, audit.type, audit.permission, audit.base]).toEqual(['audit-log-export', 'audit-export', 'audit.view', 'a4-plain-slim']);
    // Der Protokollauszug wird nur gezogen — keine Nummer, keine Ablage.
    expect(audit.filed).toBe(false);

    const a = audit.build({ title: 'Protokoll', filters: { Kanal: 'Alle' }, entries: [] }, { ...ctx, number: 'PRO-2026-001' });
    expect(a.slots).toMatchObject({ kind: 'report', title: 'Protokoll' });
    expect('typst' in a.body && a.body.typst).toContain('table(');
  });
  /**
   * Befund 5 (0.2.2): Der Auszug war auf der Basis eines Vereins unbrauchbar – Spaltenköpfe unsichtbar, die
   * inhaltstragende Spalte wenige Zeichen schmal, Silbentrennung in jedem Wort.
   */
  it('audit-log-export gives the content column the width and leaves styling of the header to the base', () => {
    const [audit] = coreDocumentTemplates();
    const built = audit!.build(
      {
        title: 'Protokoll',
        filters: {},
        entries: [
          { occurredAt: '28.09.2026 21:49:27', userName: 'Anna Berger', channel: 'Oberfläche', action: 'finance.notice.save', entityType: 'financeNotice', entityId: '01M3MQP000000000000000000', entityLabel: 'GRD-2026-003', summary: 'Bescheid geändert' },
          { occurredAt: '28.09.2026 21:50:01', userName: null, channel: 'System', action: 'document.textExtracted', entityType: 'document', entityId: '01M3MRY000000000000000000', summary: 'Text erkannt' },
        ],
      },
      ctx,
    );
    const typst = 'typst' in built.body ? built.body.typst : '';
    // Kein Fettdruck in der Kopfzeile: Die Basis setzt sie selbst fett und hell. Eine Basis, die Fettes in ihrer
    // Hauptfarbe setzt, machte die Köpfe sonst unsichtbar (dunkel auf dunkel).
    expect(typst).toContain('table.header([Zeitpunkt], [Nutzer / Kanal], [Aktion], [Objekt / Zusammenfassung])');
    // Feste Breiten für die Metadaten, der Rest gehört dem Inhalt.
    expect(typst).toMatch(/columns: \(\d+mm, \d+mm, \d+mm, 1fr\)/);
    expect(typst).toContain('hyphenate: false');
    // Der Aktionsschlüssel darf an den Punkten umbrechen.
    expect(typst).toContain('finance.\\u{200B}notice.\\u{200B}save');
    // Der Name des Datensatzes statt seiner ID, wo es einen gibt.
    expect(typst).toContain('financeNotice · GRD-2026-003');
    expect(typst).not.toContain('01M3MQP');
    expect(typst).toContain('document · 01M3MRY000000000000000000');
    expect(typst).toContain('28.09.2026 21:49:27');
    expect(typst).toContain('Oberfläche');
  });
});
