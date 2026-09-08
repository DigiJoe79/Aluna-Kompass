import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { coreModule, readSetting, schema as core, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { z } from 'zod';
import { asset, number, text } from '@kompass/site-template';
import { siteModule } from '../src/manifest';
import { siteEntries, siteTemplateState, siteValues } from '../src/schema';
import { applySeed, readSeed } from '../src/seed';
import type { FieldSchema } from '../src/load';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.SITE_TEMPLATE_DIR;
});

const FIXTURE = path.resolve(import.meta.dirname, 'fixtures');

/** Legt ein Template-Verzeichnis mit einem seed/ an; `content` überschreibt die Fixture. */
function templateWithSeed(content?: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-seed-tpl-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'seed', 'assets'), { recursive: true });
  const json = content ?? JSON.parse(readFileSync(path.join(FIXTURE, 'seed', 'content.json'), 'utf8'));
  writeFileSync(path.join(dir, 'seed', 'content.json'), JSON.stringify(json));
  return dir;
}

const asJson = (s: unknown) => z.toJSONSchema(s as z.ZodType, { io: 'input' }) as FieldSchema;

/** deps mit registriertem site-Modul (für die Einstellung) und eingelesenem Schema. */
function seededDeps(opts?: { locales?: string[] }) {
  const deps = createTestDeps({ locales: opts?.locales ?? ['de'], manifests: [coreModule, siteModule] });
  insertUser(deps, { id: 'USER-TEST' });
  deps.db
    .insert(siteTemplateState)
    .values({
      id: 'current',
      name: 'T',
      checksum: 'a'.repeat(64),
      readAt: 't',
      readByUserId: null,
      schemaJson: {
        name: 'T',
        locales: opts?.locales ?? ['de'],
        uses: [],
        variables: { claim: asJson(text({ localized: true })), pct: asJson(number({ min: 0, max: 100 })) },
        collections: {
          notes: { label: 'Notizen', slug: false, sortable: true, publishable: false, fields: { body: asJson(text()) } },
          posts: { label: 'Beiträge', slug: true, sortable: false, publishable: true, fields: { title: asJson(text()) } },
          team: { label: 'Team', slug: false, sortable: true, publishable: false, fields: { photoAssetId: asJson(asset()) } },
        },
      },
    })
    .run();
  return deps;
}

const manage = ctxWith(['site.manage']);

describe('readSeed', () => {
  it('reads variables and collections from seed/content.json', async () => {
    const r = await readSeed(templateWithSeed());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.variables).toEqual({ claim: { de: 'Wir helfen.' }, pct: 97.2 });
    expect(r.value.collections.notes).toHaveLength(2);
    expect(r.value.assets).toEqual([]);
  });

  it('reads an assets array when present', async () => {
    const r = await readSeed(templateWithSeed({
      variables: {},
      assets: [{ id: 'logo', filename: 'logo.png', mimeType: 'image/png' }],
    }));
    expect(r.ok && r.value.assets).toEqual([{ id: 'logo', filename: 'logo.png', mimeType: 'image/png' }]);
  });

  it('defaults missing sections to empty', async () => {
    const r = await readSeed(templateWithSeed({ variables: { a: 1 } }));
    expect(r.ok && r.value.collections).toEqual({});
    expect(r.ok && r.value.assets).toEqual([]);
  });

  it('returns conflict noSeed when seed/content.json is absent', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-seed-none-'));
    dirs.push(dir);
    const r = await readSeed(dir);
    expect(r.ok === false && r.error.type === 'conflict' && r.error.code === 'noSeed').toBe(true);
  });

  it('returns validation error on malformed json', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-seed-bad-'));
    dirs.push(dir);
    mkdirSync(path.join(dir, 'seed'), { recursive: true });
    writeFileSync(path.join(dir, 'seed', 'content.json'), '{ not json');
    const r = await readSeed(dir);
    expect(r.ok === false && r.error.type === 'validation').toBe(true);
  });

  it('returns validation error when a collection is not an array', async () => {
    const r = await readSeed(templateWithSeed({ collections: { notes: { body: 'x' } } }));
    expect(r.ok === false && r.error.type === 'validation').toBe(true);
  });
});

describe('applySeed', () => {
  it('dry run (confirm:false) reports counts and writes nothing', async () => {
    const deps = seededDeps();
    process.env.SITE_TEMPLATE_DIR = templateWithSeed();
    const r = unwrap(await applySeed(deps, manage, { confirm: false }));
    expect(r).toEqual({ applied: false, variables: 2, entries: 4, byCollection: { notes: 2, posts: 2 }, assets: 0 });
    expect(deps.db.select().from(siteValues).all()).toHaveLength(0);
    expect(deps.db.select().from(siteEntries).all()).toHaveLength(0);
    expect(readSetting(deps, 'site.seedAppliedAt')).toBe(null);
  });

  it('applies variables and entries, honours isPublished and order', async () => {
    const deps = seededDeps();
    process.env.SITE_TEMPLATE_DIR = templateWithSeed();
    const r = unwrap(await applySeed(deps, manage, { confirm: true }));
    expect(r.applied).toBe(true);
    const vals = Object.fromEntries(deps.db.select().from(siteValues).all().map((v) => [v.key, v.value]));
    expect(vals).toEqual({ claim: { de: 'Wir helfen.' }, pct: 97.2 });
    const notes = deps.db.select().from(siteEntries).all().filter((e) => e.collection === 'notes');
    expect(notes.map((n) => (n.data as { body: string }).body)).toEqual(['Erste Notiz', 'Zweite Notiz']);
    expect(notes.map((n) => n.sortOrder)).toEqual([0, 1]);
    const posts = deps.db.select().from(siteEntries).all().filter((e) => e.collection === 'posts');
    expect(posts.find((p) => p.slug === 'hallo')?.isPublished).toBe(true);
    expect(posts.find((p) => p.slug === 'entwurf')?.isPublished).toBe(false);
    expect(typeof readSetting(deps, 'site.seedAppliedAt')).toBe('string');
  });

  it('writes exactly one site.seed.apply audit entry', async () => {
    const deps = seededDeps();
    process.env.SITE_TEMPLATE_DIR = templateWithSeed();
    unwrap(await applySeed(deps, manage, { confirm: true }));
    const entries = deps.db.select().from(core.auditLog).all().filter((e) => e.action === 'site.seed.apply');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.summary).toContain('2 Variablen');
  });

  it('uploads seed assets and rewrites the asset field to the media id', async () => {
    const deps = seededDeps();
    process.env.SITE_TEMPLATE_DIR = templateWithSeed({
      collections: { team: [{ photoAssetId: 'logo' }] },
      assets: [{ id: 'logo', filename: 'logo.png', mimeType: 'image/png' }],
    });
    // logo.png in das Template-seed/assets/ kopieren
    const dir = process.env.SITE_TEMPLATE_DIR!;
    writeFileSync(path.join(dir, 'seed', 'assets', 'logo.png'), readFileSync(path.join(FIXTURE, 'seed', 'assets', 'logo.png')));
    unwrap(await applySeed(deps, manage, { confirm: true }));
    const team = deps.db.select().from(siteEntries).all().filter((e) => e.collection === 'team');
    const mediaId = (team[0]?.data as { photoAssetId: string }).photoAssetId;
    expect(mediaId).toMatch(/^[0-9A-Za-z]/);
    const media = deps.db.select().from(core.mediaAssets).all();
    expect(media).toHaveLength(1);
    expect(media[0]?.id).toBe(mediaId);
  });

  it('refuses when a referenced asset file is missing, writing nothing', async () => {
    const deps = seededDeps();
    process.env.SITE_TEMPLATE_DIR = templateWithSeed({
      collections: { team: [{ photoAssetId: 'logo' }] },
      assets: [{ id: 'logo', filename: 'fehlt.png', mimeType: 'image/png' }],
    });
    const r = await applySeed(deps, manage, { confirm: true });
    expect(r.ok === false && r.error.type === 'conflict' && r.error.code === 'seedAssetsMissing').toBe(true);
    expect(deps.db.select().from(core.mediaAssets).all()).toHaveLength(0);
    expect(deps.db.select().from(siteEntries).all()).toHaveLength(0);
  });

  it('refuses a second run', async () => {
    const deps = seededDeps();
    process.env.SITE_TEMPLATE_DIR = templateWithSeed();
    unwrap(await applySeed(deps, manage, { confirm: true }));
    const r = await applySeed(deps, manage, { confirm: true });
    expect(r.ok === false && r.error.type === 'conflict' && r.error.code === 'alreadySeeded').toBe(true);
  });

  it('refuses when the site already has content', async () => {
    const deps = seededDeps();
    process.env.SITE_TEMPLATE_DIR = templateWithSeed();
    deps.db.insert(siteValues).values({ key: 'pct', value: 1, updatedAt: 't' }).run();
    const r = await applySeed(deps, manage, { confirm: true });
    expect(r.ok === false && r.error.type === 'conflict' && r.error.code === 'siteNotEmpty').toBe(true);
  });

  it('refuses without a template read', async () => {
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    process.env.SITE_TEMPLATE_DIR = templateWithSeed();
    const r = await applySeed(deps, manage, { confirm: true });
    expect(r.ok === false && r.error.type === 'conflict' && r.error.code === 'noTemplate').toBe(true);
  });

  it('refuses without seed/content.json', async () => {
    const deps = seededDeps();
    const dir = mkdtempSync(path.join(tmpdir(), 'kompass-seed-empty-'));
    dirs.push(dir);
    process.env.SITE_TEMPLATE_DIR = dir;
    const r = await applySeed(deps, manage, { confirm: true });
    expect(r.ok === false && r.error.type === 'conflict' && r.error.code === 'noSeed').toBe(true);
  });

  it('needs site.manage', async () => {
    const deps = seededDeps();
    process.env.SITE_TEMPLATE_DIR = templateWithSeed();
    const r = await applySeed(deps, ctxWith([]), { confirm: true });
    expect(r.ok === false && r.error.type === 'forbidden').toBe(true);
  });

  it('rejects a seed value the schema does not allow', async () => {
    const deps = seededDeps();
    process.env.SITE_TEMPLATE_DIR = templateWithSeed({ variables: { pct: 500 } });
    const r = await applySeed(deps, manage, { confirm: true });
    expect(r.ok === false && r.error.type === 'validation').toBe(true);
  });

  it('rejects a seed key the template does not declare', async () => {
    const deps = seededDeps();
    process.env.SITE_TEMPLATE_DIR = templateWithSeed({ variables: { nope: 1 } });
    const r = await applySeed(deps, manage, { confirm: true });
    expect(r.ok === false && r.error.type === 'validation').toBe(true);
  });
});
