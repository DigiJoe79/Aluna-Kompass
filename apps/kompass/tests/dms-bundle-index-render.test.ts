import type { DocumentRenderContext } from '@kompass/core';
import { DEFAULT_THEME } from '@kompass/core/themes';
import { createDocumentEngine } from '@kompass/documents';
import { renderMarkdownTypst } from '@kompass/markdown';
import { dmsModule } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';

/**
 * Das Inhaltsverzeichnis des Aktenexports (VP5) war nur als Zeichenkette
 * geprüft. Ein Betreff mit Typst-Sonderzeichen oder eine geschützte Zeile ohne
 * Angaben darf den Bau nicht brechen — das sieht nur ein echter Lauf durch
 * dieselbe Engine wie in der Anwendung (Markdown → Typst → PDF).
 */
const context: DocumentRenderContext = {
  number: 'DMS-2026-001',
  issuedAt: '2026-09-23T08:00:00.000Z',
  organization: { 'organization.name': 'Musterverein e.V.', 'organization.street': 'Musterweg 1', 'organization.postalCode': '12345', 'organization.city': 'Musterstadt' },
  theme: DEFAULT_THEME,
  logo: null,
};

async function render(): Promise<Uint8Array> {
  const template = (dmsModule.documentTemplates ?? []).find((t) => t.key === 'dms-bundle-index')!;
  const built = template.build(
    {
      title: 'Ordner Finanzen #1 [2026]',
      entries: [
        { number: 'BRF-2026-001', documentDate: '2026-03-01', typeLabel: 'Brief', subject: 'Zusage; mit "Anführung" | Strich #panic("x") $x$ @label [box] ~ C:\\temp', checksum: 'abc', state: 'ok', fileName: 'BRF-2026-001.pdf' },
        { number: 'GEH-2026-004', documentDate: null, typeLabel: null, subject: null, checksum: null, state: 'protected', fileName: null },
      ],
    },
    context,
  );
  const bodyTypst = 'markdown' in built.body ? await renderMarkdownTypst(built.body.markdown) : built.body.typst;
  const { bytes } = await createDocumentEngine().render({ baseId: template.base, bodyTypst, slots: built.slots, context });
  return bytes;
}

describe('dms-bundle-index renders', () => {
  it('produces a PDF for normal, protected and hostile entries', async () => {
    const pdf = await render();
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(2000);
  });
});
