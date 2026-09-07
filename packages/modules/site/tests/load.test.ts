import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureModuleResolution, loadTemplate } from '../src/load';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const withTemplate = async (source: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-tpl-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'kompass.template.ts'), source);
  // Ohne Modulauflösung findet Node @kompass/site-template nicht.
  await ensureModuleResolution(dir);
  return dir;
};

const GOOD = `
import { defineTemplate, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'Probe', locales: ['de'],
  variables: { claim: text({ max: 40, localized: true, label: 'Claim' }) },
  collections: { notes: { label: 'Notizen', fields: { body: text({ label: 'Text' }) } } },
});`;

describe('loadTemplate', () => {
  it('reads the declaration and derives a checksum', async () => {
    const result = await loadTemplate(await withTemplate(GOOD));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.definition.name).toBe('Probe');
    expect(result.value.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.value.schema.variables.claim!.widget).toBe('localized');
  });

  it('gives the same checksum for the same file and a different one after an edit', async () => {
    const dir = await withTemplate(GOOD);
    const first = await loadTemplate(dir);
    const again = await loadTemplate(dir);
    expect(first.ok && again.ok && first.value.checksum === again.value.checksum).toBe(true);
  });

  it('reports a directory without module resolution as its own conflict', async () => {
    const bare = mkdtempSync(path.join(tmpdir(), 'kompass-bare-'));
    dirs.push(bare);
    writeFileSync(path.join(bare, 'kompass.template.ts'), GOOD);
    const result = await loadTemplate(bare);
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'templateResolutionMissing').toBe(true);
  });

  it('reports a missing file, a broken file and a wrong export as conflicts', async () => {
    const missing = await loadTemplate(mkdtempSync(path.join(tmpdir(), 'kompass-empty-')));
    expect(missing.ok === false && missing.error.type === 'conflict' && missing.error.code === 'templateMissing').toBe(true);
    const broken = await loadTemplate(await withTemplate('export default {'));
    expect(broken.ok === false && broken.error.type === 'conflict' && broken.error.code === 'templateUnreadable').toBe(true);
    const wrong = await loadTemplate(await withTemplate('export default { hallo: 1 };'));
    expect(wrong.ok === false && wrong.error.type === 'conflict' && wrong.error.code === 'templateInvalid').toBe(true);
  });
});
