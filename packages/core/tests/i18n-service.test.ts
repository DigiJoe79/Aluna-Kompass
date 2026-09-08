import { describe, expect, it } from 'vitest';
import { coreModule, schema, unwrap } from '../src';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { addLocale, listLocales, previewLocaleRemoval, removeLocale, reorderLocales } from '../src/i18n/service';
import { createProject } from '../src/projects/service';
import { eq } from 'drizzle-orm';

const setup = () => {
  const deps = createTestDeps({ manifests: [coreModule] });
  insertUser(deps, { id: 'USER-TEST' });
  return deps;
};

describe('locale administration', () => {
  it('adds a locale and lists it after the leading one', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    expect(unwrap(await listLocales(deps, ctx))).toEqual(['de', 'en']);
  });

  it('refuses an unknown shape, a duplicate, and the eleventh locale', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage']);
    expect((await addLocale(deps, ctx, { code: 'DE' })).ok).toBe(false);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    const again = await addLocale(deps, ctx, { code: 'en' });
    expect(again.ok === false && again.error.type === 'conflict').toBe(true);

    for (const code of ['fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da']) {
      unwrap(await addLocale(deps, ctx, { code }));
    }
    const eleventh = await addLocale(deps, ctx, { code: 'no' });
    expect(eleventh.ok === false && eleventh.error.type === 'conflict' && eleventh.error.code === 'tooManyLocales').toBe(true);
  });

  it('needs settings.manage', async () => {
    const deps = setup();
    expect((await addLocale(deps, ctxWith([]), { code: 'en' })).ok).toBe(false);
  });

  it('counts the content a removal would cost, across modules', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage', 'projects.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    unwrap(await createProject(deps, ctx, { slug: 'a', name: { de: 'Hof', en: 'Yard' }, type: 'ongoing', summary: { de: 'x', en: '' }, body: { de: '', en: '' } }));
    const preview = unwrap(await previewLocaleRemoval(deps, ctx, { code: 'en' }));
    expect(preview.filled).toBeGreaterThan(0);
    expect(preview.tables.some((t) => t.table === 'projects' && t.filled > 0)).toBe(true);
  });

  it('removes a locale, strips it from stored text and keeps the leading one', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage', 'projects.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    const project = unwrap(await createProject(deps, ctx, { slug: 'a', name: { de: 'Hof', en: 'Yard' }, type: 'ongoing', summary: { de: 'x', en: '' }, body: { de: '', en: '' } }));
    unwrap(await removeLocale(deps, ctx, { code: 'en', confirm: true }));
    expect(unwrap(await listLocales(deps, ctx))).toEqual(['de']);
    const row = deps.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get()!;
    expect(row.name).toEqual({ de: 'Hof' });
    const last = await removeLocale(deps, ctx, { code: 'de', confirm: true });
    expect(last.ok === false && last.error.type === 'conflict' && last.error.code === 'lastLocale').toBe(true);
  });

  it('refuses removal without confirmation and writes an audit entry with the count', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    expect((await removeLocale(deps, ctx, { code: 'en', confirm: false })).ok).toBe(false);
    unwrap(await removeLocale(deps, ctx, { code: 'en', confirm: true }));
    const entry = deps.db.select().from(schema.auditLog).all().at(-1)!;
    expect(entry.action).toBe('locale.remove');
  });

  it('reorders locales while keeping the same set of locales', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    unwrap(await addLocale(deps, ctx, { code: 'fr' }));
    const reordered = unwrap(await reorderLocales(deps, ctx, { codes: ['en', 'de', 'fr'] }));
    expect(reordered).toEqual(['en', 'de', 'fr']);
    expect(unwrap(await listLocales(deps, ctx))).toEqual(['en', 'de', 'fr']);

    const bad = await reorderLocales(deps, ctx, { codes: ['en', 'de'] });
    expect(bad.ok === false && bad.error.type === 'conflict').toBe(true);
  });
});

describe('locale removal reaches beyond localized columns', () => {
  it('strips the locale from a setting and counts it in the preview', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    deps.sqlite
      .prepare("insert into settings (key, value, updated_at) values ('probe.localized', ?, '2026-09-07T00:00:00.000Z') on conflict(key) do update set value = excluded.value")
      .run(JSON.stringify({ de: 'Ein Verein', en: 'A club' }));

    const preview = unwrap(await previewLocaleRemoval(deps, ctx, { code: 'en' }));
    expect(preview.filled).toBeGreaterThan(0);
    expect(preview.tables.some((t) => t.table === 'settings')).toBe(true);

    unwrap(await removeLocale(deps, ctx, { code: 'en', confirm: true }));
    const row = deps.sqlite.prepare("select value from settings where key = 'probe.localized'").get() as { value: string };
    expect(JSON.parse(row.value)).toEqual({ de: 'Ein Verein' });
  });

  it('never rewrites the audit log, which records what was there', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage', 'projects.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    unwrap(await createProject(deps, ctx, { slug: 'a', name: { de: 'Hof', en: 'Yard' }, type: 'ongoing', summary: { de: 'x' }, body: { de: '' } }));
    unwrap(await removeLocale(deps, ctx, { code: 'en', confirm: true }));
    const entries = deps.db.select().from(schema.auditLog).all();
    const created = entries.find((e) => e.action === 'projects.create')!;
    expect(String(created.after)).toContain('Yard');
  });
});
