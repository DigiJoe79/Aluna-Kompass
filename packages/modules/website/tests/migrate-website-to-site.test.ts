import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, emptyLocalized, isoNow, setSetting, unwrap, type LocalizedText } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { applyTemplateSync, siteEntries, siteModule, siteValues } from '@kompass/module-site';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { websiteArticles, websiteDownloads, websiteFaqs, websiteModule, websitePages, websiteTeam } from '../src';
import { migrateWebsiteToSite } from '../../../../scripts/migrate-website-to-site';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Ein eigenes Template-Fixture mit denselben Variablen und Sammlungen wie
 * Alunas Template, aber ohne Abhängigkeit auf das Repo ausserhalb dieses
 * Projekts (das Vereins-Repo). Locale bewusst nur 'de', wie im
 * Basis-Template — hält die LocalizedText-Werte einfach.
 */
function fixtureTemplateDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'site-template-fixture-'));
  dirs.push(dir);
  writeFileSync(
    path.join(dir, 'kompass.template.ts'),
    `import { asset, defineTemplate, markdown, number, text } from '@kompass/site-template';

export default defineTemplate({
  name: 'Fixture Verein',
  locales: ['de'],
  variables: {
    homeLede: text({ max: 600, localized: true, label: 'Einleitung' }),
    helpText: markdown({ max: 40_000, localized: true, label: 'Helfen' }),
    donateText: markdown({ max: 40_000, localized: true, label: 'Spenden' }),
    sponsorText: markdown({ max: 40_000, localized: true, label: 'Tierpate' }),
    membershipText: markdown({ max: 40_000, localized: true, label: 'Mitglied' }),
    aboutText: markdown({ max: 40_000, localized: true, label: 'Über uns' }),
    partnersText: markdown({ max: 40_000, localized: true, label: 'Partner' }),
    forwardingPercent: number({ min: 0, max: 100, label: 'Weiterleitung' }),
    shelterDogCount: number({ min: 0, integer: true, label: 'Hunde' }),
    featuredAnimalSlug: text({ max: 80, label: 'Tier' }),
    featuredStorySlug: text({ max: 80, label: 'Geschichte' }),
  },
  collections: {
    articles: {
      label: 'Wissenswertes',
      slug: true,
      sortable: true,
      publishable: true,
      fields: {
        title: text({ max: 160, localized: true, label: 'Titel' }),
        lede: text({ max: 600, localized: true, label: 'Anriss' }),
        body: markdown({ max: 40_000, localized: true, label: 'Text' }),
      },
    },
    team: {
      label: 'Team',
      sortable: true,
      publishable: true,
      fields: {
        name: text({ max: 120, label: 'Name' }),
        position: text({ max: 120, localized: true, label: 'Aufgabe' }),
        photoAssetId: asset({ accept: 'image/*', label: 'Foto' }),
        petPhotoAssetId: asset({ accept: 'image/*', label: 'Tierfoto' }),
      },
    },
    faq: {
      label: 'Fragen und Antworten',
      sortable: true,
      publishable: true,
      fields: {
        category: text({ max: 60, localized: true, label: 'Bereich' }),
        question: text({ max: 200, localized: true, label: 'Frage' }),
        answer: markdown({ max: 2000, localized: true, label: 'Antwort' }),
      },
    },
    downloads: {
      label: 'Formulare',
      slug: true,
      max: 8,
      fields: {
        title: text({ max: 120, localized: true, label: 'Titel' }),
        fileAssetId: asset({ accept: 'application/pdf', label: 'PDF' }),
      },
    },
  },
});
`,
  );
  return dir;
}

const L = (de: string): LocalizedText => ({ de });

function makeDeps(env: 'test' | 'production' = 'test') {
  const deps = createTestDeps({ manifests: [coreModule, websiteModule, siteModule], env });
  insertUser(deps, { id: 'USER-TEST' });
  return deps;
}

async function readTemplate(deps: ReturnType<typeof makeDeps>) {
  const manageCtx = ctxWith(['site.manage', 'site.view']);
  unwrap(await applyTemplateSync(deps, manageCtx, { dir: fixtureTemplateDir(), confirm: true }));
}

function insertPage(deps: ReturnType<typeof makeDeps>, key: string, fields: Partial<{ lede: LocalizedText; body: LocalizedText }>) {
  const now = isoNow(deps.clock);
  const empty = emptyLocalized(deps.locales());
  deps.db
    .insert(websitePages)
    .values({ key, title: empty, lede: fields.lede ?? empty, body: fields.body ?? empty, metaDescription: empty, blocks: [], updatedAt: now })
    .onConflictDoUpdate({ target: websitePages.key, set: { lede: fields.lede ?? empty, body: fields.body ?? empty, updatedAt: now } })
    .run();
}

function insertArticle(deps: ReturnType<typeof makeDeps>, overrides: { id: string; slug: string; title: string; sortOrder: number; isPublished?: boolean }) {
  const now = isoNow(deps.clock);
  deps.db
    .insert(websiteArticles)
    .values({
      id: overrides.id,
      slug: overrides.slug,
      title: L(overrides.title),
      lede: L('Anriss'),
      body: L('Text'),
      publishedAt: null,
      sortOrder: overrides.sortOrder,
      isPublished: overrides.isPublished ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function insertTeamMember(deps: ReturnType<typeof makeDeps>, overrides: { id: string; name: string; sortOrder: number; isPublished?: boolean }) {
  const now = isoNow(deps.clock);
  deps.db
    .insert(websiteTeam)
    .values({
      id: overrides.id,
      name: overrides.name,
      position: L('Vorstand'),
      photoAssetId: null,
      petPhotoAssetId: null,
      sortOrder: overrides.sortOrder,
      isPublished: overrides.isPublished ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function insertFaq(deps: ReturnType<typeof makeDeps>, overrides: { id: string; question: string; sortOrder: number; isPublished?: boolean }) {
  const now = isoNow(deps.clock);
  deps.db
    .insert(websiteFaqs)
    .values({
      id: overrides.id,
      category: L('Spenden'),
      question: L(overrides.question),
      answer: L('Antwort'),
      sortOrder: overrides.sortOrder,
      isPublished: overrides.isPublished ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function insertDownload(deps: ReturnType<typeof makeDeps>, overrides: { key: string; title: string }) {
  deps.db
    .insert(websiteDownloads)
    .values({ key: overrides.key, title: L(overrides.title), assetId: null, updatedAt: isoNow(deps.clock) })
    .run();
}

describe('migrate website to site', () => {
  it('carries page texts into variables named after their page and field', async () => {
    const deps = makeDeps();
    await readTemplate(deps);
    insertPage(deps, 'home', { lede: L('Willkommen bei Aluna') });
    insertPage(deps, 'help', { body: L('So helft ihr uns.') });
    insertPage(deps, 'about', { body: L('Wir sind ein Team.') });

    const ctx = ctxWith(['site.manage', 'site.view', 'settings.manage']);
    const report = unwrap(await migrateWebsiteToSite(deps, ctx, {}));

    const values = Object.fromEntries(deps.db.select().from(siteValues).all().map((r) => [r.key, r.value]));
    expect(values.homeLede).toEqual(L('Willkommen bei Aluna'));
    expect(values.helpText).toEqual(L('So helft ihr uns.'));
    expect(values.aboutText).toEqual(L('Wir sind ein Team.'));
    expect(report.lines.find((l) => l.table === 'website_pages')?.count).toBe(7);
  });

  it('carries articles, team, faqs and downloads into entries with their slug and order', async () => {
    const deps = makeDeps();
    await readTemplate(deps);
    insertArticle(deps, { id: 'A2', slug: 'zweiter', title: 'Zweiter', sortOrder: 1 });
    insertArticle(deps, { id: 'A1', slug: 'erster', title: 'Erster', sortOrder: 0 });
    insertTeamMember(deps, { id: 'T1', name: 'Nicole', sortOrder: 0 });
    insertFaq(deps, { id: 'F1', question: 'Wohin geht mein Geld?', sortOrder: 0 });
    insertDownload(deps, { key: 'sponsorship-form', title: 'Patenschaftsvertrag' });

    const ctx = ctxWith(['site.manage', 'site.view', 'settings.manage']);
    unwrap(await migrateWebsiteToSite(deps, ctx, {}));

    const articles = deps.db.select().from(siteEntries).where(eq(siteEntries.collection, 'articles')).all().sort((a, b) => a.sortOrder - b.sortOrder);
    expect(articles.map((a) => a.slug)).toEqual(['erster', 'zweiter']);
    expect((articles[0]!.data as { title: LocalizedText }).title).toEqual(L('Erster'));

    const team = deps.db.select().from(siteEntries).where(eq(siteEntries.collection, 'team')).all();
    expect(team).toHaveLength(1);
    expect((team[0]!.data as { name: string }).name).toBe('Nicole');
    expect(team[0]!.slug).toBeNull();

    const faq = deps.db.select().from(siteEntries).where(eq(siteEntries.collection, 'faq')).all();
    expect(faq).toHaveLength(1);

    const downloads = deps.db.select().from(siteEntries).where(eq(siteEntries.collection, 'downloads')).all();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]!.slug).toBe('sponsorship-form');
    expect((downloads[0]!.data as { fileAssetId: string | null }).fileAssetId).toBeNull();
  });

  it('keeps the published flag where the collection is publishable', async () => {
    const deps = makeDeps();
    await readTemplate(deps);
    insertArticle(deps, { id: 'A1', slug: 'erster', title: 'Erster', sortOrder: 0, isPublished: true });
    insertArticle(deps, { id: 'A2', slug: 'zweiter', title: 'Zweiter', sortOrder: 1, isPublished: false });
    insertTeamMember(deps, { id: 'T1', name: 'Nicole', sortOrder: 0, isPublished: true });
    insertFaq(deps, { id: 'F1', question: 'Frage', sortOrder: 0, isPublished: false });

    const ctx = ctxWith(['site.manage', 'site.view', 'settings.manage']);
    unwrap(await migrateWebsiteToSite(deps, ctx, {}));

    const byId = (id: string) => deps.db.select().from(siteEntries).all().find((e) => e.data && (e as { id: string }).id === id);
    const articles = deps.db.select().from(siteEntries).where(eq(siteEntries.collection, 'articles')).all();
    expect(articles.find((a) => a.slug === 'erster')!.isPublished).toBe(true);
    expect(articles.find((a) => a.slug === 'zweiter')!.isPublished).toBe(false);
    const team = deps.db.select().from(siteEntries).where(eq(siteEntries.collection, 'team')).all();
    expect(team[0]!.isPublished).toBe(true);
    const faq = deps.db.select().from(siteEntries).where(eq(siteEntries.collection, 'faq')).all();
    expect(faq[0]!.isPublished).toBe(false);
  });

  it('reports one line per source table with counts', async () => {
    const deps = makeDeps();
    await readTemplate(deps);
    insertArticle(deps, { id: 'A1', slug: 'erster', title: 'Erster', sortOrder: 0 });
    insertTeamMember(deps, { id: 'T1', name: 'Nicole', sortOrder: 0 });
    insertTeamMember(deps, { id: 'T2', name: 'Jonas', sortOrder: 1 });
    insertFaq(deps, { id: 'F1', question: 'Frage 1', sortOrder: 0 });
    insertFaq(deps, { id: 'F2', question: 'Frage 2', sortOrder: 1 });
    insertFaq(deps, { id: 'F3', question: 'Frage 3', sortOrder: 2 });
    insertDownload(deps, { key: 'sponsorship-form', title: 'Formular' });

    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'website.forwardingPercent', value: 96.5 }));

    const ctx = ctxWith(['site.manage', 'site.view', 'settings.manage']);
    const report = unwrap(await migrateWebsiteToSite(deps, ctx, {}));

    const line = (table: string) => report.lines.find((l) => l.table === table)?.count;
    expect(line('website_pages')).toBe(7);
    expect(line('website_articles')).toBe(1);
    expect(line('website_team')).toBe(2);
    expect(line('website_faqs')).toBe(3);
    expect(line('website_downloads')).toBe(1);
    expect(line('settings')).toBe(5);
    expect(report.leftBehind.length).toBeGreaterThan(0);
  });

  it('refuses to run twice and leaves the second attempt untouched', async () => {
    const deps = makeDeps();
    await readTemplate(deps);
    insertArticle(deps, { id: 'A1', slug: 'erster', title: 'Erster', sortOrder: 0 });

    const ctx = ctxWith(['site.manage', 'site.view', 'settings.manage']);
    unwrap(await migrateWebsiteToSite(deps, ctx, {}));
    const before = deps.db.select().from(siteEntries).all();

    const second = await migrateWebsiteToSite(deps, ctx, {});
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error.type === 'conflict' && second.error.code === 'alreadyMigrated').toBe(true);

    const after = deps.db.select().from(siteEntries).all();
    expect(after).toEqual(before);
  });

  it('refuses to run in production', async () => {
    const deps = makeDeps('production');
    await readTemplate(deps);
    const ctx = ctxWith(['site.manage', 'site.view', 'settings.manage']);
    const result = await migrateWebsiteToSite(deps, ctx, {});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.type === 'conflict').toBe(true);
  });

  it('aborts with an understandable message when no template has been read yet', async () => {
    const deps = makeDeps();
    const ctx = ctxWith(['site.manage', 'site.view', 'settings.manage']);
    const result = await migrateWebsiteToSite(deps, ctx, {});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.type === 'conflict' && result.error.code === 'noTemplate').toBe(true);
  });

  it('a title over the template limit aborts the run before anything is written', async () => {
    const deps = makeDeps();
    await readTemplate(deps);
    insertArticle(deps, { id: 'A1', slug: 'erster', title: 'x'.repeat(200), sortOrder: 0 });
    insertTeamMember(deps, { id: 'T1', name: 'Nicole', sortOrder: 0 });

    const ctx = ctxWith(['site.manage', 'site.view', 'settings.manage']);
    const result = await migrateWebsiteToSite(deps, ctx, {});

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.type === 'validation').toBe(true);
    if (!result.ok && result.error.type === 'validation') {
      expect(result.error.issues.some((i) => i.path.includes('articles') && i.path.includes('title'))).toBe(true);
    }
    expect(deps.db.select().from(siteEntries).all()).toEqual([]);
    expect(deps.db.select().from(siteValues).all()).toEqual([]);
  });

  it('dry-run reports without writing anything', async () => {
    const deps = makeDeps();
    await readTemplate(deps);
    insertPage(deps, 'home', { lede: L('Willkommen') });
    insertArticle(deps, { id: 'A1', slug: 'erster', title: 'Erster', sortOrder: 0 });

    const ctx = ctxWith(['site.manage', 'site.view', 'settings.manage']);
    const report = unwrap(await migrateWebsiteToSite(deps, ctx, { dryRun: true }));

    expect(report.lines.find((l) => l.table === 'website_articles')?.count).toBe(1);
    expect(deps.db.select().from(siteEntries).all()).toEqual([]);
    expect(deps.db.select().from(siteValues).all()).toEqual([]);
  });
});
