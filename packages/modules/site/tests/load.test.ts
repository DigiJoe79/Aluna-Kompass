import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadTemplate } from '../src/load';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const withTemplate = (source: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-tpl-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'kompass.template.ts'), source);
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
    const result = await loadTemplate(withTemplate(GOOD));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.definition.name).toBe('Probe');
    expect(result.value.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.value.schema.variables.claim!.widget).toBe('localized');
  });

  it('gives the same checksum for the same file and a different one after an edit', async () => {
    const dir = withTemplate(GOOD);
    const first = await loadTemplate(dir);
    const again = await loadTemplate(dir);
    expect(first.ok && again.ok && first.value.checksum === again.value.checksum).toBe(true);
  });

  it('reports a missing file, a broken file and a wrong export as conflicts', async () => {
    const missing = await loadTemplate(mkdtempSync(path.join(tmpdir(), 'kompass-empty-')));
    expect(missing.ok === false && missing.error.type === 'conflict' && missing.error.code === 'templateMissing').toBe(true);
    const broken = await loadTemplate(withTemplate('export default {'));
    expect(broken.ok === false && broken.error.code === 'templateUnreadable').toBe(true);
    const wrong = await loadTemplate(withTemplate('export default { hallo: 1 };'));
    expect(wrong.ok === false && wrong.error.code === 'templateInvalid').toBe(true);
  });
});
