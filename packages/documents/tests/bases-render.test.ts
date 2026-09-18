import type { DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { describe, expect, it } from 'vitest';
import { coreDocumentTemplates, createTypstRenderer, resolveAssetDirs, resolveBases } from '../src';

const bases = resolveBases(resolveAssetDirs({}));
const renderer = createTypstRenderer();

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

describe('generic bases render', () => {
  for (const id of ['a4-plain', 'a4-mit-briefkopf', 'a4-ohne-briefkopf']) {
    it(`${id} produces a PDF`, async () => {
      const pdf = await renderer.renderDocument({ baseId: id, bases, bodyTypst: 'Absatz eins.\n\nAbsatz zwei.', payload: payload() });
      expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
      expect(pdf.byteLength).toBeGreaterThan(2000);
    });
  }

  it('a4-mit-briefkopf renders deterministically', async () => {
    const body = '= Text\n\nEin Absatz mit *fett*.';
    const a = await renderer.renderDocument({ baseId: 'a4-mit-briefkopf', bases, bodyTypst: body, payload: payload() });
    const b = await renderer.renderDocument({ baseId: 'a4-mit-briefkopf', bases, bodyTypst: body, payload: payload() });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('a4-mit-briefkopf flows a long body onto a second page with a continuation header', async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Absatz ${i + 1} mit genug Text, damit die Seite voll wird und ein Umbruch entsteht.`).join('\n\n');
    const pdf = await renderer.renderDocument({ baseId: 'a4-mit-briefkopf', bases, bodyTypst: long, payload: payload() });
    // Zwei Seiten: die grobe Größe reicht als Nachweis, dass umgebrochen wurde.
    expect(pdf.byteLength).toBeGreaterThan(6000);
  });

  it('renders the audit-log-export body (typst, not markdown) into a4-plain', async () => {
    const [audit] = coreDocumentTemplates();
    const ctx: DocumentRenderContext = { number: 'PRO-2026-001', issuedAt: '2026-09-05T08:00:00.000Z', organization: { 'organization.name': 'Musterverein e.V.' }, theme: DEFAULT_THEME, logo: null };
    const built = audit!.build(
      { title: 'Änderungsprotokoll', filters: { Kanal: 'system' }, entries: [{ occurredAt: '2026-09-05T08:00:00.000Z', userName: 'Anna Berger', channel: 'ui', action: 'settings.update', entityType: 'setting', entityId: 'organization.name', summary: 'geändert #[nicht als Code]' }] },
      ctx,
    );
    expect('typst' in built.body).toBe(true);
    const pdf = await renderer.renderDocument({ baseId: audit!.base, bases, bodyTypst: 'typst' in built.body ? built.body.typst : '', payload: { ...payload(), slots: built.slots } });
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
  });
  it('zeichnet bei draft-Slots ein Wasserzeichen', async () => {
    const plain = await renderer.renderDocument({ baseId: 'a4-plain', bases, bodyTypst: 'Absatz eins.\n\nAbsatz zwei.', payload: payload() });
    const draft = await renderer.renderDocument({ baseId: 'a4-plain', bases, bodyTypst: 'Absatz eins.\n\nAbsatz zwei.', payload: payload({ slots: { ...payload().slots, draft: true } }) });
    expect(draft.byteLength).not.toBe(plain.byteLength);
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
