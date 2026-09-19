import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, readSetting, setModuleEnabled, storeMediaAsset, unwrap, writeSettingInternal } from '@kompass/core';
import { projectsModule } from '@kompass/module-projects';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { siteModule } from '../src/manifest';
import { siteEntries, siteValues } from '../src/schema';
import { seedSiteDevelopment } from '../src/dev-seed';
import { NICHT_TEMPLATE } from '../src/review';
import { activeTemplate } from '../src/service';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  delete process.env.SITE_TEMPLATE_DIR;
});

/** Das mitgelieferte Beispiel-Template — dasselbe, das eine Entwicklungsinstallation vorfindet. */
const BASIS = path.resolve(import.meta.dirname, '../../../../templates/verein-basis');

/** Ein 1×1-PNG — der Seed soll ein echtes Bild aus der Mediathek wählen, kein erfundenes Kürzel. */
const PNG = Uint8Array.from(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
);

/**
 * `verein-basis` verweist mit `featuredProject` auf die Sicht `projects` —
 * ohne das Modul lehnt schon das Einlesen mit `unknownView` ab. `pnpm seed`
 * hat alle Module an Bord; der Test baut denselben Stand.
 */
const setup = async () => {
  const deps = createTestDeps({ manifests: [coreModule, projectsModule, siteModule], locales: ['de', 'en'] });
  const userId = insertUser(deps, { name: 'Seed', email: 'seed@kompass.local' });
  const ctx = ctxWith(['site.manage', 'site.view', 'media.upload', 'settings.manage', 'modules.manage'], userId);
  unwrap(await setModuleEnabled(deps, ctx, { key: 'projects', enabled: true }));
  return { deps, ctx };
};

describe('seedSiteDevelopment', () => {
  /**
   * Die Webseite war bis zum 2026-09-15 das einzige Modul ohne Entwicklungs-
   * daten: `pnpm seed` füllte Kontakte, Akte, Tiere und Projekte, und die
   * Webseite blieb leer. AGENTS.md verlangt für jedes Modul einen `seed`-Haken.
   *
   * Erschwerend: Ohne eingelesenes Template gibt es keine Sammlungen, die man
   * füllen könnte. Der Seed liest deshalb erst das Template ein, das im
   * Volume liegt — in der Entwicklung ist das `templates/verein-basis`.
   */
  it('reads the template that lies in the volume and fills every collection it declares', async () => {
    process.env.SITE_TEMPLATE_DIR = BASIS;
    const { deps, ctx } = await setup();

    await seedSiteDevelopment(deps, ctx);

    const template = activeTemplate(deps);
    expect(template?.name).toBe('Verein Basis');

    const entries = deps.db.select().from(siteEntries).all();
    const byCollection = new Set(entries.map((e) => e.collection));
    expect([...byCollection].sort()).toEqual(['documents', 'faq', 'news', 'team']);
  });

  /** Ohne Varianten zeigt die Oberfläche nur einen Zustand — verlangt AGENTS.md ausdrücklich. */
  it('covers the states that matter: published and draft, and a filled sort order', async () => {
    process.env.SITE_TEMPLATE_DIR = BASIS;
    const { deps, ctx } = await setup();

    await seedSiteDevelopment(deps, ctx);

    const news = deps.db.select().from(siteEntries).all().filter((e) => e.collection === 'news');
    expect(news.map((e) => e.isPublished)).toContain(true);
    expect(news.map((e) => e.isPublished)).toContain(false);
    // Eine sortierbare Sammlung bekommt aufsteigende Ränge, keine Nullen.
    const team = deps.db.select().from(siteEntries).all().filter((e) => e.collection === 'team');
    expect(team.map((e) => e.sortOrder)).toEqual([...team.map((e) => e.sortOrder)].sort((a, b) => a - b));
    expect(new Set(team.map((e) => e.sortOrder)).size).toBe(team.length);
  });

  /** Jede deklarierte Variable bekommt einen Wert, damit die Maske nicht leer aufgeht. */
  it('fills the declared variables in every language of the installation', async () => {
    process.env.SITE_TEMPLATE_DIR = BASIS;
    const { deps, ctx } = await setup();

    await seedSiteDevelopment(deps, ctx);

    const values = Object.fromEntries(deps.db.select().from(siteValues).all().map((v) => [v.key, v.value]));
    expect(Object.keys(values)).toContain('claim');
    expect(values.claim).toMatchObject({ de: expect.any(String), en: expect.any(String) });
    expect(values.memberFee).toEqual(expect.any(Number));
  });

  /** Zweimal laufen darf nichts verdoppeln — dieselbe Regel wie bei allen Modul-Seeds. */
  it('changes nothing on a second run', async () => {
    process.env.SITE_TEMPLATE_DIR = BASIS;
    const { deps, ctx } = await setup();

    await seedSiteDevelopment(deps, ctx);
    const first = deps.db.select().from(siteEntries).all();

    await seedSiteDevelopment(deps, ctx);
    expect(deps.db.select().from(siteEntries).all()).toEqual(first);
  });

  /**
   * Sperrwörter (Backlog 23) hängen nicht am Template: Auch ohne eines zeigt die
   * Publizieren-Seite in der Entwicklung eine gefüllte Liste. Eine gepflegte
   * Liste bleibt, wie sie ist.
   */
  it('legt Beispiel-Sperrwörter an, ohne eine gepflegte Liste zu überschreiben', async () => {
    process.env.SITE_TEMPLATE_DIR = path.join(tmpdir(), 'kein-template-hier');
    const { deps, ctx } = await setup();
    await seedSiteDevelopment(deps, ctx);
    const seeded = readSetting<string[]>(deps, 'site.blockedTerms');
    expect(seeded.length).toBeGreaterThan(0);

    writeSettingInternal(deps.db, deps, ctx, 'site.blockedTerms', ['Eigener Begriff']);
    await seedSiteDevelopment(deps, ctx);
    expect(readSetting(deps, 'site.blockedTerms')).toEqual(['Eigener Begriff']);
  });

  /** Ohne Template im Volume gibt es nichts zu füllen — und keinen Grund zu scheitern. */
  it('does nothing when no template lies in the volume', async () => {
    const leer = mkdtempSync(path.join(tmpdir(), 'kompass-ohne-template-'));
    dirs.push(leer);
    process.env.SITE_TEMPLATE_DIR = leer;
    const { deps, ctx } = await setup();

    await seedSiteDevelopment(deps, ctx);

    expect(activeTemplate(deps)).toBeNull();
    expect(deps.db.select().from(siteEntries).all()).toEqual([]);
  });

  /**
   * Bringt das Template eigene Startinhalte mit (`seed/content.json`), gehören
   * die auf die Seite — nicht erfundene. Der Entwicklungs-Seed tritt zurück,
   * damit die Karte „Startinhalte übernehmen“ erhalten bleibt.
   */
  it('stands back when the template brings its own starting content', async () => {
    const { deps, ctx } = await setup();
    const mitSeed = mkdtempSync(path.join(tmpdir(), 'kompass-mit-seed-'));
    dirs.push(mitSeed);
    const { cpSync, mkdirSync, writeFileSync } = await import('node:fs');
    // `BASIS` ist das echte, geteilte Verzeichnis, in dem andere Tests dieser
    // Datei parallel per `applyTemplateSync` Astro-Build-Artefakte unter
    // `.astro/` anlegen und wieder entfernen. Eine rekursive Kopie, die davon
    // nur `node_modules` ausnimmt, kann mitten im Kopieren auf eine Datei
    // treffen, die der andere Test gerade löscht (`ENOENT … .astro/out-…`,
    // unter CI-Last reproduziert, lokal isoliert nicht). Ausgenommen wird
    // deshalb alles, was `NICHT_TEMPLATE` (review.ts) ohnehin nicht als
    // Template-Inhalt zählt.
    cpSync(BASIS, mitSeed, {
      recursive: true,
      filter: (src) => ![...NICHT_TEMPLATE].some((name) => src.includes(`${path.sep}${name}`)),
    });
    expect(existsSync(path.join(mitSeed, '.astro'))).toBe(false);
    mkdirSync(path.join(mitSeed, 'seed'), { recursive: true });
    writeFileSync(path.join(mitSeed, 'seed', 'content.json'), JSON.stringify({ variables: {}, collections: {} }));
    process.env.SITE_TEMPLATE_DIR = mitSeed;

    await seedSiteDevelopment(deps, ctx);

    expect(deps.db.select().from(siteEntries).all()).toEqual([]);
    expect(deps.db.select().from(siteValues).all()).toEqual([]);
  });

  /**
   * Der Kern-Seed legt vorher eine Mediathek an. Ein Bildfeld leer zu lassen
   * hieße, dass in der Entwicklung nie ein Bild in einer Liste erscheint — und
   * gerade die Bildausgabe (Varianten, srcset) will man dort sehen.
   * Ein Eintrag je Sammlung bleibt ohne Bild: auch das ist ein Zustand.
   */
  it('puts a picture from the media library into image fields, but not into every entry', async () => {
    process.env.SITE_TEMPLATE_DIR = BASIS;
    const { deps, ctx } = await setup();
    const bild = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'beispiel.png', bytes: PNG }));

    await seedSiteDevelopment(deps, ctx);

    const news = deps.db.select().from(siteEntries).all().filter((e) => e.collection === 'news');
    const bilder = news.map((e) => (e.data as { image?: string | null }).image);
    expect(bilder).toContain(bild.id);
    expect(bilder).toContain(null);
  });

  /**
   * Ein PDF-Feld (`accept: 'application/pdf'`) darf kein Bild bekommen. Die
   * Sammlung „Dokumente“ von verein-basis verlangt genau das.
   */
  it('respects what a file field accepts', async () => {
    process.env.SITE_TEMPLATE_DIR = BASIS;
    const { deps, ctx } = await setup();
    const bild = unwrap(await storeMediaAsset(deps, ctx, { originalName: 'beispiel.png', bytes: PNG }));

    await seedSiteDevelopment(deps, ctx);

    const dokumente = deps.db.select().from(siteEntries).all().filter((e) => e.collection === 'documents');
    expect(dokumente.map((e) => (e.data as { file?: string | null }).file)).not.toContain(bild.id);
  });

  /**
   * Dass im Seed nichts steht, was einem echten Verein gehört, prüft der
   * Wächter `apps/kompass/tests/no-association-content.test.ts` für das ganze
   * Repo — und zwar gründlicher, als es hier ginge: Dieser Seed erfindet seine
   * Werte zur Laufzeit aus den Beschriftungen der Deklaration, es gibt gar
   * keine feste Textliste, in der ein Name stehen könnte.
   *
   * Der erste Anlauf dieses Tests nannte die Namen, nach denen er suchte —
   * und fiel prompt bei jenem Wächter durch. Er hatte recht.
   */
});
