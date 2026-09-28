import { describe, expect, it } from 'vitest';
import { bundleCsv, bundleIndexMarkdown, bundleIndexTemplate, type BundleEntry } from '../src/bundle-index';

const ok: BundleEntry = { number: 'BRF-2026-001', documentDate: '2026-03-01', typeLabel: 'Brief', subject: 'Zusage; mit "Anführung" | und Strich', checksum: 'abc123', state: 'ok', fileName: 'BRF-2026-001.pdf' };
const hidden: BundleEntry = { number: 'GEH-2026-004', documentDate: null, typeLabel: null, subject: null, checksum: null, state: 'protected', fileName: null };

describe('bundle index', () => {
  it('writes a CSV that a German spreadsheet opens: BOM, semicolons, quoted fields, CRLF', () => {
    const csv = bundleCsv([ok, hidden]);
    expect(csv.startsWith('﻿Nummer;Datum;Art;Betreff;SHA-256;Status;Datei\r\n')).toBe(true);
    expect(csv).toContain('BRF-2026-001;2026-03-01;Brief;"Zusage; mit ""Anführung"" | und Strich";abc123;in Ordnung;BRF-2026-001.pdf\r\n');
    expect(csv).toContain('GEH-2026-004;;;;;geschützt;\r\n');
  });

  it('defuses a subject that a spreadsheet would run as a formula', () => {
    expect(bundleCsv([{ ...ok, subject: '=HYPERLINK("http://x")' }])).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it('renders a markdown table without letting a subject break it', () => {
    const md = bundleIndexMarkdown([ok, hidden]);
    expect(md).toContain('| Nummer | Datum | Art | Betreff | Status |');
    expect(md).toContain('| BRF-2026-001 | 2026-03-01 | Brief | Zusage; mit "Anführung" \\| und Strich | in Ordnung |');
    expect(md).toContain('| GEH-2026-004 |  |  |  | geschützt |');
    expect(md.split('\n').filter((l) => l.startsWith('| ')).length).toBe(3);
  });

  it('is a template that is never filed', () => {
    expect(bundleIndexTemplate).toMatchObject({ key: 'dms-bundle-index', filed: false, base: 'a4-mit-briefkopf' });
    const built = bundleIndexTemplate.build({ title: 'Ordner Finanzen', entries: [ok] }, {} as never);
    expect(built.slots.title).toBe('Ordner Finanzen');
    expect('markdown' in built.body && built.body.markdown).toContain('BRF-2026-001');
  });
});
