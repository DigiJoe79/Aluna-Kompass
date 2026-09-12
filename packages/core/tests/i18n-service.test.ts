import { describe, expect, it } from 'vitest';
import { coreModule, schema, unwrap } from '../src';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { addLocale, listLocales, previewLocaleRemoval, removeLocale, reorderLocales } from '../src/i18n/service';
import { recordAudit } from '../src/audit/log';
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


/**
 * Der Sprachdienst kennt keine Spaltenliste; er liest jede Tabelle. Eine
 * Probetabelle zeigt das, ohne dass der Kern ein Fachmodul bräuchte.
 */
const probeTable = (deps: ReturnType<typeof setup>, name: Record<string, string>) => {
  deps.sqlite.exec('create table if not exists probe_texts (id text primary key, name text not null)');
  deps.sqlite.prepare('insert into probe_texts (id, name) values (?, ?)').run('P1', JSON.stringify(name));
};

  it('counts the content a removal would cost, in any table', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    probeTable(deps, { de: 'Hof', en: 'Yard' });
    const preview = unwrap(await previewLocaleRemoval(deps, ctx, { code: 'en' }));
    expect(preview.filled).toBeGreaterThan(0);
    expect(preview.tables.some((t) => t.table === 'probe_texts' && t.filled > 0)).toBe(true);
  });

  it('removes a locale, strips it from stored text and keeps the leading one', async () => {
    const deps = setup();
    const ctx = ctxWith(['settings.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    probeTable(deps, { de: 'Hof', en: 'Yard' });
    unwrap(await removeLocale(deps, ctx, { code: 'en', confirm: true }));
    expect(unwrap(await listLocales(deps, ctx))).toEqual(['de']);
    const row = deps.sqlite.prepare('select name from probe_texts where id = ?').get('P1') as { name: string };
    expect(JSON.parse(row.name)).toEqual({ de: 'Hof' });
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
    const ctx = ctxWith(['settings.manage']);
    unwrap(await addLocale(deps, ctx, { code: 'en' }));
    recordAudit(deps.db, deps, ctx, { action: 'probe.create', entityType: 'probe', entityId: 'P1', after: { name: { de: 'Hof', en: 'Yard' } }, summary: 'Probe' });
    unwrap(await removeLocale(deps, ctx, { code: 'en', confirm: true }));
    const entries = deps.db.select().from(schema.auditLog).all();
    const created = entries.find((e) => e.action === 'probe.create')!;
    expect(String(created.after)).toContain('Yard');
  });
});
