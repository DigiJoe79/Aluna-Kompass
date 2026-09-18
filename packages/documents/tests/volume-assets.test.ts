import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTypstRenderer, resolveAssetDirs, resolveBases } from '../src';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-vol-'));
  dirs.push(d);
  return d;
};

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const payload = {
  brand: { primary: '#142E45', primarySoft: '#E9EEF3', accent: '#C6A07E', ink: '#22262B', muted: '#6B7280', line: '#E4E4E0', fontBody: 'Source Sans 3', fontHeading: 'Source Serif 4', fontMono: 'IBM Plex Mono' },
  organization: { 'organization.name': 'Musterverein e.V.' },
  number: 'BRF-2026-001',
  issuedDate: '09.09.2026',
  slots: { kind: 'letter', title: 'X' },
};

describe('volume fonts and assets', () => {
  it('renders a base that references a grafik from the volume via /assets/', async () => {
    const vol = tmp();
    mkdirSync(path.join(vol, 'assets'));
    writeFileSync(path.join(vol, 'assets', 'seal.png'), PNG);
    writeFileSync(
      path.join(vol, 'a4-seal.typ'),
      '#let base(payload, slots, body) = { set document(date: none); body; image("/assets/seal.png", width: 10mm) }',
    );
    const bases = resolveBases({ ...resolveAssetDirs({}), documentTemplatesDir: vol });
    const pdf = await createTypstRenderer().renderDocument({
      baseId: 'a4-seal',
      bases,
      bodyTypst: 'Text.',
      payload,
      assetsDir: path.join(vol, 'assets'),
      fontPaths: [path.join(vol, 'fonts')], // existiert nicht → wird ignoriert
    });
    expect(new TextDecoder().decode(pdf.subarray(0, 5))).toBe('%PDF-');
  });

  it('ignores a missing volume font path and still renders with the shipped fonts', async () => {
    const bases = resolveBases(resolveAssetDirs({}));
    const pdf = await createTypstRenderer().renderDocument({
      baseId: 'a4-plain',
      bases,
      bodyTypst: 'Text.',
      payload,
      fontPaths: ['/does/not/exist'],
    });
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
