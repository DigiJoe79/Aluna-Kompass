import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { schema, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { losesContent } from '../src/resync/plan';
import { siteEntries, siteTemplateState } from '../src/schema';
import { applyTemplateSync, previewTemplateSync, templateIsCurrent } from '../src/service';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const templateDir = (source: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-svc-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'kompass.template.ts'), source);
  return dir;
};

const GOOD = `
import { defineTemplate, number, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'Basis', locales: ['de'],
  variables: { claim: text({ localized: true, label: 'Claim' }), members: number({ min: 0, label: 'Mitglieder' }) },
  collections: { notes: { label: 'Notizen', max: 2, fields: { body: text({ label: 'Text' }) } } },
});`;

const withUser = (locales?: string[]) => {
  const deps = createTestDeps(locales ? { locales } : {});
  insertUser(deps, { id: 'USER-TEST' });
  return deps;
};

describe('template sync', () => {
  it('needs site.manage', async () => {
    const deps = withUser();
    const dir = templateDir(GOOD);
    const preview = await previewTemplateSync(deps, ctxWith([]), dir);
    expect(preview.ok === false && preview.error.type === 'forbidden').toBe(true);
    const applied = await applyTemplateSync(deps, ctxWith([]), { dir, confirm: true });
    expect(applied.ok === false && applied.error.type === 'forbidden').toBe(true);
  });

  it('reads a template into an empty installation without findings that cost content', async () => {
    const deps = withUser();
    const ctx = ctxWith(['site.manage']);
    const dir = templateDir(GOOD);
    const preview = unwrap(await previewTemplateSync(deps, ctx, dir));
    expect(preview.name).toBe('Basis');
    expect(preview.findings.some(losesContent)).toBe(false);
    unwrap(await applyTemplateSync(deps, ctx, { dir, confirm: true }));
  });

  it('refuses to apply without confirmation', async () => {
    const deps = withUser();
    const applied = await applyTemplateSync(deps, ctxWith(['site.manage']), { dir: templateDir(GOOD), confirm: false });
    expect(applied.ok === false && applied.error.type === 'validation' && applied.error.issues[0]?.message === 'confirmationRequired').toBe(true);
  });

  it('refuses to apply while a limit is exceeded', async () => {
    const deps = withUser();
    const ctx = ctxWith(['site.manage']);
    unwrap(await applyTemplateSync(deps, ctx, { dir: templateDir(GOOD), confirm: true }));
    deps.db.insert(siteEntries).values([
      { id: 'E1', collection: 'notes', data: { body: 'a' }, createdAt: 't', updatedAt: 't' },
      { id: 'E2', collection: 'notes', data: { body: 'b' }, createdAt: 't', updatedAt: 't' },
      { id: 'E3', collection: 'notes', data: { body: 'c' }, createdAt: 't', updatedAt: 't' },
    ]).run();
    const tighter = templateDir(GOOD.replace('max: 2', 'max: 1'));
    const applied = await applyTemplateSync(deps, ctx, { dir: tighter, confirm: true });
    expect(applied.ok === false && applied.error.type === 'conflict' && applied.error.code === 'overLimit').toBe(true);
  });

  it('refuses a template that demands a locale the installation does not keep', async () => {
    const deps = withUser();
    const dir = templateDir(GOOD.replace("locales: ['de']", "locales: ['de', 'fr']"));
    const applied = await applyTemplateSync(deps, ctxWith(['site.manage']), { dir, confirm: true });
    expect(applied.ok === false && applied.error.type === 'conflict' && applied.error.code === 'localeMissing' && applied.error.message.includes('fr')).toBe(true);
  });

  it('stores schema and checksum and writes an audit entry with the plan', async () => {
    const deps = withUser();
    const ctx = ctxWith(['site.manage']);
    unwrap(await applyTemplateSync(deps, ctx, { dir: templateDir(GOOD), confirm: true }));
    const state = deps.db.select().from(siteTemplateState).get();
    expect(state?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect((state?.schemaJson as { name: string }).name).toBe('Basis');
    const entry = deps.db.select().from(schema.auditLog).all().at(-1);
    expect(entry?.action).toBe('site.template.read');
    expect(JSON.parse(entry?.after ?? '{}')).toHaveProperty('findings');
  });

  it('leaves everything untouched when the file cannot be read', async () => {
    const deps = withUser();
    const ctx = ctxWith(['site.manage']);
    unwrap(await applyTemplateSync(deps, ctx, { dir: templateDir(GOOD), confirm: true }));
    const before = deps.db.select().from(siteTemplateState).get();
    const applied = await applyTemplateSync(deps, ctx, { dir: templateDir('export default {'), confirm: true });
    expect(applied.ok === false && applied.error.type === 'conflict' && applied.error.code === 'templateUnreadable').toBe(true);
    expect(deps.db.select().from(siteTemplateState).get()).toEqual(before);
  });

  it('reports the template as stale once the file changed', async () => {
    const deps = withUser();
    const ctx = ctxWith(['site.manage']);
    const dir = templateDir(GOOD);
    unwrap(await applyTemplateSync(deps, ctx, { dir, confirm: true }));
    await expect(templateIsCurrent(deps, dir)).resolves.toBe(true);
    writeFileSync(path.join(dir, 'kompass.template.ts'), GOOD.replace("name: 'Basis'", "name: 'Basis 2'"));
    await expect(templateIsCurrent(deps, dir)).resolves.toBe(false);
  });
});
