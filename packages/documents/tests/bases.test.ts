import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTypstRenderer, probeBase, resolveAssetDirs, resolveBases } from '../src';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'kompass-bases-'));
  dirs.push(d);
  return d;
};

describe('document bases', () => {
  it('resolves the shipped bases and reports their checksum', () => {
    const bases = resolveBases(resolveAssetDirs({}));
    expect([...bases.keys()].sort()).toEqual(['a4-mit-briefkopf', 'a4-ohne-briefkopf', 'a4-plain']);
    expect(bases.get('a4-plain')!.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(bases.get('a4-mit-briefkopf')!.label).toBe('A4 mit Briefkopf');
  });

  it('lets a volume base override a shipped one', () => {
    const vol = tmp();
    writeFileSync(path.join(vol, 'a4-plain.typ'), '#let base(payload, slots, body) = { set document(date: none); body }');
    const bases = resolveBases(resolveAssetDirs({ KOMPASS_DOCUMENT_TEMPLATES_DIR: vol }));
    expect(bases.get('a4-plain')!.typst).toContain('set document(date: none); body');
    expect([...bases.keys()].length).toBe(3);
  });

  it('probes a base and reports a broken one', async () => {
    const renderer = createTypstRenderer();
    const shipped = resolveBases(resolveAssetDirs({}));
    expect(await probeBase({ renderer, baseId: 'a4-plain', bases: shipped })).toEqual({ ok: true });

    const vol = tmp();
    writeFileSync(path.join(vol, 'kaputt.typ'), '#let notbase() = 1');
    const bad = await probeBase({ renderer, baseId: 'kaputt', bases: resolveBases(resolveAssetDirs({ KOMPASS_DOCUMENT_TEMPLATES_DIR: vol })) });
    expect(bad.ok).toBe(false);
  });
});
