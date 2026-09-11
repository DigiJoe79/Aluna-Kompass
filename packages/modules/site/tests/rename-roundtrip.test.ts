import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureModuleResolution, loadTemplate } from '../src/load';
import { planResync } from '../src/resync/plan';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const withTemplate = async (source: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-rename-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'kompass.template.ts'), source);
  await ensureModuleResolution(dir);
  return dir;
};

const template = (variables: string) => `
import { defineTemplate, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'Probe', locales: ['de'],
  variables: { ${variables} },
  collections: {},
});`;

/**
 * Der Weg, den eine Umbenennung wirklich nimmt: ein Autor schreibt sie in sein
 * Template, der Loader trägt sie ins Schema, der Resync erkennt sie. Reisst die
 * Kette irgendwo, meldet der Plan „entfällt plus neu“ und der Text ist weg.
 */
describe('a rename declared in a template survives to the resync', () => {
  it('reports one rename that carries its content, not a removal and an addition', async () => {
    const before = await loadTemplate(await withTemplate(template(`subtitle: text({ label: 'Untertitel' })`)));
    const after = await loadTemplate(await withTemplate(template(`lede: text({ label: 'Einleitung', renamedFrom: 'subtitle' })`)));
    if (!before.ok) throw new Error('before: ' + JSON.stringify(before.error));
    if (!after.ok) throw new Error('after: ' + JSON.stringify(after.error));

    const data = { variables: { subtitle: 'Wer wir sind' }, collections: {} };
    const findings = planResync(before.value.schema, after.value.schema, data);

    expect(findings).toEqual([
      { kind: 'renamed', path: 'variables.lede', label: 'Einleitung', from: 'variables.subtitle', filled: 1 },
    ]);
  });

  it('without the declaration it is a loss, which is what makes the declaration matter', async () => {
    const before = await loadTemplate(await withTemplate(template(`subtitle: text({ label: 'Untertitel' })`)));
    const after = await loadTemplate(await withTemplate(template(`lede: text({ label: 'Einleitung' })`)));
    if (!before.ok || !after.ok) throw new Error('template did not load');
    const findings = planResync(before.value.schema, after.value.schema, { variables: { subtitle: 'Wer wir sind' }, collections: {} });
    expect(findings.map((f) => f.kind).sort()).toEqual(['added', 'removed']);
    expect(findings.find((f) => f.kind === 'removed')).toMatchObject({ filled: 1 });
  });
});
