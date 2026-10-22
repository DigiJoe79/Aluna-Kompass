import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isoDay, type DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { describe, expect, it } from 'vitest';
import { coreDocumentTemplates, createTypstRenderer, pdfPageCount, probeBase, resolveAssetDirs, resolveBases } from '../src';

const bases = resolveBases(resolveAssetDirs({}));
const renderer = createTypstRenderer();
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

/**
 * Der Text eines PDFs. `collapse`: Leerraum zu einem Leerzeichen gefaltet, so liest ihn ein Mensch. `lines`: Zeilen
 * wie gesetzt. `raw`: Reihenfolge des Inhaltsstroms, ohne dass pdftotext Trennstriche am Zeilenende wieder zusammenzieht.
 */
const pdfText = (pdf: Uint8Array, mode: 'collapse' | 'lines' | 'raw' = 'collapse'): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-pdftext-'));
  try {
    writeFileSync(path.join(dir, 'x.pdf'), pdf);
    const out = spawnSync('pdftotext', [...(mode === 'raw' ? ['-raw'] : []), path.join(dir, 'x.pdf'), '-'], { encoding: 'utf8' });
    if (out.status !== 0) throw new Error(`pdftotext: ${out.stderr}`);
    return mode === 'collapse' ? out.stdout.replace(/\s+/g, ' ') : out.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const payload = (over: Record<string, unknown> = {}) => ({
  brand: {
    primary: '#2F5D68',
    primarySoft: '#E3EEF0',
    accent: '#9C5637',
    ink: '#191C1F',
    muted: '#666D75',
    line: '#E4E4E0',
    fontBody: 'Source Sans 3',
    fontHeading: 'Source Serif 4',
    fontMono: 'IBM Plex Mono',
  },
  organization: {
    'organization.name': 'Musterverein e.V.',
    'organization.street': 'Musterweg 1',
    'organization.postalCode': '12345',
    'organization.city': 'Musterstadt',
    'organization.iban': 'DE00 0000 0000 0000 0000 00',
  },
  number: 'BRF-2026-001',
  issuedDate: '05.09.2026',
  slots: { kind: 'letter', title: 'Einladung', subject: 'Mitgliederversammlung', recipient: 'Max Mustermann\\\nWeg 1\\\n12345 Stadt' },
  ...over,
});

/**
 * Was jede ausgelieferte Basis zusagt, einmal je Basis: Sie rendert eine Seite, besteht die Probe beim Start,
 * rendert byte-gleich (Determinismus-Flags) und zeichnet bei Entwürfen ein Wasserzeichen.
 * Eine neue Basis unter `templates/bases` ist damit ohne weiteren Test geprüft.
 */
describe.each([...bases.keys()].sort())('base %s', (id) => {
  const body = '= Text\n\nEin Absatz mit *fett*.\n\nAbsatz zwei.';
  const render = (p = payload()) => renderer.renderDocument({ baseId: id, bases, bodyTypst: body, payload: p });

  it('renders one page, deterministically, and passes the probe', async () => {
    const a = await render();
    expect(new TextDecoder().decode(a.subarray(0, 5))).toBe('%PDF-');
    expect(pdfPageCount(a)).toBe(1);
    expect(same(a, await render())).toBe(true);
    expect(await probeBase({ renderer, baseId: id, bases })).toEqual({ ok: true });
  });

  it('marks a draft', async () => {
    expect(same(await render(), await render(payload({ slots: { ...payload().slots, draft: true } })))).toBe(false);
  });
});

describe('generic bases render', () => {
  it('a4-mit-briefkopf flows a long body onto a second page with a continuation header', async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Absatz ${i + 1} mit genug Text, damit die Seite voll wird und ein Umbruch entsteht.`).join('\n\n');
    const pdf = await renderer.renderDocument({ baseId: 'a4-mit-briefkopf', bases, bodyTypst: long, payload: payload() });
    expect(pdfPageCount(pdf)).toBeGreaterThanOrEqual(2);
  });

  /**
   * Befund 5 (0.2.2): Der Auszug war unbrauchbar — Spaltenköpfe unsichtbar, die inhaltstragende Spalte wenige Zeichen
   * schmal, Silbentrennung in jedem Wort. Geprüft am gelesenen PDF, nicht am erzeugten Typst.
   */
  it('renders the audit-log-export body into its base, readable: headers, whole sentences, no hyphenation', async () => {
    const [audit] = coreDocumentTemplates();
    const ctx: DocumentRenderContext = { number: 'PRO-2026-001', issuedAt: '2026-09-05T08:00:00.000Z', issuedDay: isoDay('2026-09-05'), organization: { 'organization.name': 'Musterverein e.V.' }, theme: DEFAULT_THEME, logo: null };
    const sentence = 'Bescheid zur Freistellung des Vereins von der Körperschaftsteuer und Gewerbesteuer geändert, mit Vereinsregistereintragungsbestätigungsschreiben';
    const built = audit!.build(
      {
        title: 'Änderungsprotokoll',
        filters: { Kanal: 'system' },
        entries: [
          { occurredAt: '05.09.2026 08:00:00', userName: 'Anna Berger', channel: 'Oberfläche', entity: 'Einstellung · Vereinsname', sentence: 'geändert #[nicht als Code]' },
          { occurredAt: '05.09.2026 08:01:00', userName: null, channel: 'System', entity: 'Bescheid · Finanzamt', sentence },
        ],
      },
      ctx,
    );
    expect('typst' in built.body).toBe(true);
    const pdf = await renderer.renderDocument({ baseId: audit!.base, bases, bodyTypst: 'typst' in built.body ? built.body.typst : '', payload: { ...payload(), slots: built.slots } });
    const text = pdfText(pdf);
    for (const header of ['Zeitpunkt', 'Nutzer / Kanal', 'Aktion', 'Objekt']) expect(text).toContain(header);
    expect(text).toContain('geändert #[nicht als Code]');
    expect(text).toContain(sentence);
    // Die Aktion hat Breite: mehrere Wörter je Zeile, nicht eins unter dem anderen.
    expect(pdfText(pdf, 'lines')).toMatch(/Bescheid zur Freistellung des/);
    // Keine Silbentrennung: Typst trennt mit weichem Trennstrich.
    expect(pdfText(pdf, 'raw')).not.toContain('\u00AD');
  });

  it('a4-mit-briefkopf gruppiert die IBAN im Fuß selbst, aus dem rohen Wert', async () => {
    // Stufe 1, Korrektur 2026-10-11: `org("iban")` bleibt roh (Vertrag mit den Basen der Vereine); die Basis gruppiert.
    const footer = async (iban: string) =>
      pdfText(await renderer.renderDocument({ baseId: 'a4-mit-briefkopf', bases, bodyTypst: 'Absatz.', payload: payload({ organization: { ...payload().organization, 'organization.iban': iban } }) }));
    expect(await footer('DE02999999990532013000')).toContain('IBAN DE02 9999 9999 0532 0130 00');
    expect(await footer('DE02 9999 9999 0532 0130 00')).toContain('IBAN DE02 9999 9999 0532 0130 00');
  });

  it('a4-plain shows the issue date in the header when a document has no number', async () => {
    const excerpt = (issuedDate: string) =>
      renderer.renderDocument({ baseId: 'a4-plain', bases, bodyTypst: 'Auszug.', payload: { ...payload(), number: '', issuedDate } });
    const a = await excerpt('05.09.2026');
    const b = await excerpt('06.09.2026');
    // Ein Ad-hoc-Auszug hat keine Nummer. Träge der Kopf dann nichts, wären beide Seiten byte-gleich.
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
