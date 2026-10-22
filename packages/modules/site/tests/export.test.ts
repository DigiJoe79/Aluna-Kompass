import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AI_LABELING_ENABLED_KEY, coreModule, defineModule, definePublishedView, setMediaAiKind, setModuleEnabled, setSetting, storeMediaAsset, unwrap, writeSettingInternal } from '@kompass/core';
import { animalsModule, createAnimal, setAnimalPublished, setAnimalStatus } from '@kompass/module-animals';
import { createProject, projectsModule, setProjectPublished } from '@kompass/module-projects';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createEntry, setEntryPublished } from '../src/entries';
import { exportSiteContent, gatherAssets, siteContentHash } from '../src/export';
import { siteModule } from '../src/manifest';
import { siteValues } from '../src/schema';
import { applyTemplateSync } from '../src/service';
import { setValues } from '../src/values';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tmp = (prefix: string) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const templateDir = (source: string) => {
  const dir = tmp('kompass-exp-tpl-');
  writeFileSync(path.join(dir, 'kompass.template.ts'), source);
  return dir;
};

const GOOD = `
import { defineTemplate, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'X', locales: ['de'],
  variables: { claim: text({ localized: true, label: 'Claim' }) },
  collections: {
    notes: { label: 'Notizen', fields: { body: text({ label: 'Text' }) } },
    posts: { label: 'Beiträge', slug: true, publishable: true, fields: { title: text({ label: 'Titel' }) } },
  },
});`;

const manage = ctxWith(['site.manage', 'site.view']);
const publish = ctxWith(['site.publish']);

const setup = async (source = GOOD, locales = ['de']) => {
  const deps = createTestDeps({ locales, manifests: [coreModule, siteModule] });
  insertUser(deps, { id: 'USER-TEST' });
  const dir = templateDir(source);
  unwrap(await applyTemplateSync(deps, ctxWith(['site.manage']), { dir, confirm: true }));
  return { deps, dir };
};

const readContent = async (deps: Awaited<ReturnType<typeof setup>>['deps'], dir: string) => {
  const jobDir = tmp('kompass-exp-job-');
  const result = unwrap(await exportSiteContent(deps, publish, { jobDir, templateDir: dir }));
  return { result, content: JSON.parse(readFileSync(path.join(jobDir, 'content.json'), 'utf8')) };
};

describe('site export', () => {
  it('writes variables, collections and used views into one content.json', async () => {
    const { deps, dir } = await setup();
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Hallo' } } }));
    unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'Notiz' } }));
    const { content } = await readContent(deps, dir);
    expect(content.variables).toEqual({ claim: { de: 'Hallo' } });
    expect(content.collections.notes).toEqual([{ body: 'Notiz' }]);
    // Ohne `uses` bleiben nur die Sichten des Kerns; Projekte sind seit dem
    // 2026-09-12 ein Modul und kommen nur auf Anforderung.
    expect(Object.keys(content.views).sort()).toEqual(['aiLabeling', 'organization']);
    expect(content.assets).toEqual([]);
  });

  it('leaves out entries that are not published where the collection is publishable', async () => {
    const { deps, dir } = await setup();
    const a = unwrap(await createEntry(deps, manage, { collection: 'posts', slug: 'a', data: { title: 'A' } })).id;
    unwrap(await createEntry(deps, manage, { collection: 'posts', slug: 'b', data: { title: 'B' } }));
    unwrap(await setEntryPublished(deps, manage, { id: a, isPublished: true }));
    const { content } = await readContent(deps, dir);
    expect(content.collections.posts).toEqual([{ slug: 'a', title: 'A' }]);
  });

  it('keeps only the locales the installation configured', async () => {
    const { deps, dir } = await setup();
    deps.db.insert(siteValues).values({ key: 'claim', value: { de: 'Hallo', en: 'leftover' }, updatedAt: 't' }).run();
    const { content } = await readContent(deps, dir);
    expect(content.variables.claim).toEqual({ de: 'Hallo' });
  });

  it('brings the projects view when the template asks for the module', async () => {
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, projectsModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const admin = ctxWith(['site.manage', 'modules.manage', 'projects.manage', 'projects.view']);
    unwrap(await setModuleEnabled(deps, admin, { key: 'projects', enabled: true }));
    const dir = templateDir(GOOD.replace('collections: {', "uses: ['projects'],\n  collections: {"));
    unwrap(await applyTemplateSync(deps, admin, { dir, confirm: true }));
    const project = unwrap(await createProject(deps, admin, { slug: 'hof', name: { de: 'Hof' }, type: 'ongoing', summary: { de: '' }, body: { de: '' }, externalLinks: [{ label: 'Spenden', url: 'https://example.org/s' }] }));
    unwrap(await setProjectPublished(deps, admin, { id: project.id, isPublished: true }));
    const { content } = await readContent(deps, dir);
    expect(content.views.projects).toEqual([expect.objectContaining({ slug: 'hof', externalLinks: [{ label: 'Spenden', url: 'https://example.org/s' }] })]);
  });

  it('links a blocked term in a view row to the record, and leaves file names without a link', async () => {
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, projectsModule, animalsModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const admin = ctxWith(['site.manage', 'modules.manage', 'projects.manage', 'projects.view', 'animals.manage', 'animals.view', 'settings.manage']);
    unwrap(await setModuleEnabled(deps, admin, { key: 'projects', enabled: true }));
    unwrap(await setModuleEnabled(deps, admin, { key: 'animals', enabled: true }));
    const dir = templateDir(GOOD.replace('collections: {', "uses: ['projects', 'animals'],\n  collections: {"));
    unwrap(await applyTemplateSync(deps, admin, { dir, confirm: true }));
    unwrap(await setSetting(deps, admin, { key: 'site.blockedTerms', value: ['popescu'] }));
    const project = unwrap(await createProject(deps, admin, { slug: 'hof', name: { de: 'Der Hof' }, type: 'ongoing', summary: { de: 'Frau Popescu' }, body: { de: '' } }));
    unwrap(await setProjectPublished(deps, admin, { id: project.id, isPublished: true }));
    const dog = unwrap(await createAnimal(deps, admin, { name: 'Bruno', sex: 'male', birthText: {}, sizeText: {}, summary: { de: 'Herr Popescu' }, body: {} }));
    unwrap(await setAnimalPublished(deps, admin, { id: dog.id, isPublished: true }));
    const { result } = await readContent(deps, dir);
    const edit = (prefix: string) => result.violations.find((v) => v.path.startsWith(prefix))?.edit;
    expect(edit('views.projects[0].summary')).toEqual({ kind: 'view', href: `/projects/${project.id}`, title: 'Der Hof' });
    expect(edit('views.animals[0].summary')).toEqual({ kind: 'view', href: `/animals/${dog.id}`, title: 'Bruno' });
  });

  /**
   * Das Template kommt mit dem Backup zurueck — verlieren soll es niemand.
   * Ausgefuehrt wird es aber erst, wenn ein Mensch es eingelesen hat: Der
   * Publish laedt es sonst (`astro build` baut das ganze Verzeichnis), und
   * damit liefe Code aus einem Archiv, das jemand eingespielt hat.
   */
  it('refuses to publish a template that came with a backup and was not read since', async () => {
    const { deps, dir } = await setup(GOOD);
    deps.db.transaction((tx) =>
      writeSettingInternal(tx, deps, ctxWith([]), 'system.lastImportAt', '2099-01-01T00:00:00.000Z', 'backup.import.mark'),
    );
    const result = await exportSiteContent(deps, publish, { jobDir: tmp('kompass-exp-job-'), templateDir: dir });
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'templateNeedsReview').toBe(true);
  });

  it('reports a used view whose module is disabled instead of writing an empty list', async () => {
    const source = GOOD.replace('collections: {', "uses: ['ghost'],\n  collections: {");
    const { deps, dir } = await setup(source);
    const jobDir = tmp('kompass-exp-job-');
    const result = await exportSiteContent(deps, publish, { jobDir, templateDir: dir });
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'moduleDisabled').toBe(true);
  });

  it('refuses to export while the template file differs from the read state', async () => {
    const { deps, dir } = await setup();
    writeFileSync(path.join(dir, 'kompass.template.ts'), GOOD.replace("name: 'X'", "name: 'X2'"));
    const jobDir = tmp('kompass-exp-job-');
    const result = await exportSiteContent(deps, publish, { jobDir, templateDir: dir });
    expect(result.ok === false && result.error.type === 'conflict' && result.error.code === 'templateStale').toBe(true);
  });

  /**
   * Assets wurden am Feldnamen erkannt (`/assetid$/i`) — ein Erbe des alten
   * Moduls, wo sie fest `photoAssetId` hiessen. Im Template wählt der Autor den
   * Namen; erkennbar ist ein Asset nur an seiner Markierung im Schema.
   */
  it('collects assets from fields whatever they are called', async () => {
    const source = `
import { defineTemplate, asset, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'X', locales: ['de'],
  variables: { heroImage: asset({ label: 'Titelbild' }) },
  collections: {
    team: { label: 'Team', fields: { name: text({ label: 'Name' }), photo: asset({ label: 'Foto' }) } },
  },
});`;
    const { deps, dir } = await setup(source);
    const manage = ctxWith(['site.manage', 'site.view', 'media.upload']);
    // Zwei echte, verschiedenfarbige 1x1-PNGs, damit die Assets echte Medien-Datensätze
    // haben und nicht per Dedup zusammenfallen; sharp liest sie beim Rendern der Vorschau.
    const heroPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWMQFBQEAABqADTs/917AAAAAElFTkSuQmCC', 'base64');
    const photoPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNQUlICAADQAGcWts3AAAAAAElFTkSuQmCC', 'base64');
    const hero = unwrap(await storeMediaAsset(deps, manage, { originalName: 'hero.png', bytes: heroPng }));
    const photo = unwrap(await storeMediaAsset(deps, manage, { originalName: 'photo.png', bytes: photoPng }));

    unwrap(await setValues(deps, manage, { values: { heroImage: hero.id } }));
    unwrap(await createEntry(deps, manage, { collection: 'team', data: { name: 'Anna', photo: photo.id } }));

    const { content } = await readContent(deps, dir);
    expect((content as { assets: { id: string }[] }).assets.map((a) => a.id).sort()).toEqual([hero.id, photo.id].sort());
  });

  /** Stammdaten pflegt ein Verein einmal unter Einrichtung → Stammdaten — kein Template
   *  soll sie als eigene Variablen verdoppeln müssen. */
  it('always ships the organization view, without the template asking for it', async () => {
    const { deps, dir } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'organization.city', value: 'Musterstadt' }));
    const { content } = await readContent(deps, dir);
    const views = (content as { views: Record<string, { city: string }[]> }).views;
    expect(views.organization?.[0]?.city).toBe('Musterstadt');
  });

  it('runs without findings when there are no blocked terms or gaps', async () => {
    const { deps, dir } = await setup();
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Sauberer Text' } } }));
    unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'Kein Fund' } }));
    const { result } = await readContent(deps, dir);
    expect(result.violations).toEqual([]);
    expect(result.gaps).toEqual([]);
  });

  it('detects a blocked term in a variable', async () => {
    const { deps, dir } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'site.blockedTerms', value: ['geheim'] }));
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Streng geheim' } } }));
    const { result } = await readContent(deps, dir);
    expect(result.violations).toEqual([
      { path: 'variables.claim.de', term: 'geheim', excerpt: expect.stringContaining('geheim'), edit: { kind: 'variables' } },
    ]);
  });

  it('detects a blocked term in a collection entry', async () => {
    const { deps, dir } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'site.blockedTerms', value: ['maria popescu'] }));
    const noteId = unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'Shelter von Maria Popescu vor Ort' } })).id;
    const { result } = await readContent(deps, dir);
    expect(result.violations).toEqual([
      { path: 'collections.notes[0].body', term: 'maria popescu', excerpt: expect.stringContaining('Maria Popescu'), edit: { kind: 'entry', collection: 'notes', id: noteId, title: expect.any(String) } },
    ]);
  });

  it('tells where a hit can be edited: variable page, collection entry, nothing for views and files', async () => {
    const { deps, dir } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: 'site.blockedTerms', value: ['popescu', 'sommerfest'] }));
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Frau Popescu' } } }));
    const id = unwrap(await createEntry(deps, manage, { collection: 'posts', slug: 'fest', data: { title: 'Sommerfest bei Popescu' } })).id;
    unwrap(await setEntryPublished(deps, manage, { id, isPublished: true }));
    const { result } = await readContent(deps, dir);
    const edit = (path: string) => result.violations.find((v) => v.path.startsWith(path))?.edit;
    expect(edit('variables.claim')).toEqual({ kind: 'variables' });
    expect(edit('collections.posts[0].title')).toEqual({ kind: 'entry', collection: 'posts', id, title: expect.stringContaining('Sommerfest') });
  });

  it('reports a translation gap in a nested field', async () => {
    const sourceWithNested = `
import { defineTemplate, text } from '@kompass/site-template';
export default defineTemplate({
  name: 'X', locales: ['de', 'en'],
  variables: { claim: text({ localized: true }) },
  collections: {
    articles: { label: 'Artikel', fields: { author: text({ localized: true }) } },
  },
});`;
    const { deps, dir } = await setup(sourceWithNested, ['de', 'en']);
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Hallo', en: 'Hello' } } }));
    unwrap(await createEntry(deps, manage, { collection: 'articles', data: { author: { de: 'Johann', en: '' } } }));
    const { result } = await readContent(deps, dir);
    expect(result.gaps).toEqual([
      { path: 'collections.articles[0].author', locale: 'en' },
    ]);
  });
});


describe('locales the template renders', () => {
  /**
   * Das Template fordert Sprachen, es bekommt nicht alle: Pflegt der Verein
   * mehr, als das Template rendert, werden die überzähligen nicht
   * ausgeliefert und nicht als Lücke gemeldet (Spec § 6 und § 8).
   */
  it('delivers only the locales the template declares and reports no gaps for the rest', async () => {
    const { deps, dir } = await setup(GOOD, ['de', 'en']);
    unwrap(await setValues(deps, manage, { values: { claim: { de: 'Hallo', en: 'Hello' } } }));
    unwrap(await createEntry(deps, manage, { collection: 'notes', data: { body: 'Notiz' } }));
    const { result, content } = await readContent(deps, dir);
    expect(content.variables.claim).toEqual({ de: 'Hallo' });
    expect(result.gaps).toEqual([]);
  });
});

describe('reference variables in the export', () => {
  const REFS = `
import { defineTemplate, reference, references } from '@kompass/site-template';
export default defineTemplate({
  name: 'X', locales: ['de'],
  variables: {
    dog: reference({ view: 'animals', where: { status: 'lookingForHome' }, label: 'Hund' }),
    dogs: references({ view: 'animals', max: 2, label: 'Hunde' }),
  },
  collections: {},
  uses: ['animals'],
});`;

  const setup = async () => {
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, animalsModule, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const admin = ctxWith(['site.manage', 'modules.manage', 'animals.manage', 'animals.view']);
    unwrap(await setModuleEnabled(deps, admin, { key: 'animals', enabled: true }));
    const dog = async (name: string) => {
      const a = unwrap(await createAnimal(deps, admin, { name, sex: 'male', birthText: {}, sizeText: {}, summary: {}, body: {} }));
      unwrap(await setAnimalPublished(deps, admin, { id: a.id, isPublished: true }));
      return a;
    };
    const bruno = await dog('bruno');
    const rex = await dog('rex');
    const dir = templateDir(REFS);
    unwrap(await applyTemplateSync(deps, manage, { dir, confirm: true }));
    unwrap(await setValues(deps, manage, { values: { dog: bruno.slug, dogs: [bruno.slug, rex.slug] } }));
    return { deps, dir, bruno, rex, admin };
  };

  it('writes chosen references as they are when they still hold', async () => {
    const { deps, dir, bruno, rex } = await setup();
    const out = unwrap(await exportSiteContent(deps, publish, { jobDir: tmp('kompass-exp-'), templateDir: dir }));
    const content = JSON.parse(readFileSync(out.contentPath, 'utf8')) as { variables: Record<string, unknown> };
    expect(content.variables).toMatchObject({ dog: bruno.slug, dogs: [bruno.slug, rex.slug] });
    expect(out.stale).toEqual([]);
  });

  it('writes null for a reference that no longer holds, drops it from a list, and reports it as stale', async () => {
    const { deps, dir, bruno, rex, admin } = await setup();
    unwrap(await setAnimalStatus(deps, admin, { id: bruno.id, status: 'adopted', adoptedYear: 2026 }));
    const out = unwrap(await exportSiteContent(deps, publish, { jobDir: tmp('kompass-exp-'), templateDir: dir }));
    const content = JSON.parse(readFileSync(out.contentPath, 'utf8')) as { variables: Record<string, unknown> };
    expect(content.variables.dog).toBe(null);
    expect(content.variables.dogs).toEqual([bruno.slug, rex.slug]);
    expect(out.stale).toEqual([{ path: 'variables.dog', value: bruno.slug }]);
    expect(out.violations).toEqual([]);
  });

  it('drops a withdrawn record from a references list and reports it as stale', async () => {
    const { deps, dir, bruno, rex, admin } = await setup();
    unwrap(await setAnimalPublished(deps, admin, { id: rex.id, isPublished: false }));
    const out = unwrap(await exportSiteContent(deps, publish, { jobDir: tmp('kompass-exp-'), templateDir: dir }));
    const content = JSON.parse(readFileSync(out.contentPath, 'utf8')) as { variables: Record<string, unknown> };
    expect(content.variables.dogs).toEqual([bruno.slug]);
    expect(out.stale).toEqual([{ path: 'variables.dogs', value: rex.slug }]);
  });
});

describe('pending reviews in the export', () => {
  const view = (name: string, pendingReview?: () => { label: string; href: string }[]) =>
    definePublishedView({ name, schema: z.object({ slug: z.string() }), load: () => [], ...(pendingReview ? { pendingReview } : {}) });
  const setup = async (enabled: boolean) => {
    const waiting = defineModule({ key: 'waiting', version: '0', permissions: [], publishedViews: [view('things', () => [{ label: 'Ding', href: '/things/1' }])] });
    const silent = defineModule({ key: 'silent', version: '0', permissions: [], publishedViews: [view('others')] });
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, waiting, silent, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const admin = ctxWith(['modules.manage']);
    unwrap(await setModuleEnabled(deps, admin, { key: 'silent', enabled: true }));
    if (enabled) unwrap(await setModuleEnabled(deps, admin, { key: 'waiting', enabled: true }));
    const dir = templateDir(GOOD);
    unwrap(await applyTemplateSync(deps, manage, { dir, confirm: true }));
    return { deps, dir };
  };

  it('collects what enabled modules report, whether or not the template uses them', async () => {
    const { deps, dir } = await setup(true);
    const out = unwrap(await exportSiteContent(deps, publish, { jobDir: tmp('kompass-exp-'), templateDir: dir }));
    expect(out.pendingReview).toEqual([{ view: 'things', label: 'Ding', href: '/things/1' }]);
    // Eine Warnung, keine Sperre: Der Inhalt ist derselbe.
    expect(out.violations).toEqual([]);
  });

  it('is empty where no view reports anything or the module is off', async () => {
    const { deps, dir } = await setup(false);
    const out = unwrap(await exportSiteContent(deps, publish, { jobDir: tmp('kompass-exp-'), templateDir: dir }));
    expect(out.pendingReview).toEqual([]);
  });
});

describe('siteContentHash', () => {
  const HERO_TEMPLATE = `
import { defineTemplate, asset } from '@kompass/site-template';
export default defineTemplate({
  name: 'X', locales: ['de'],
  variables: { heroImage: asset({ label: 'Titelbild' }) },
  collections: {},
});`;
  const heroPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWMQFBQEAABqADTs/917AAAAAElFTkSuQmCC', 'base64');

  it('gives the same hash as the full export without writing a file or reading media', async () => {
    const { deps, dir } = await setup(HERO_TEMPLATE);
    const media = ctxWith(['site.manage', 'site.view', 'media.upload']);
    const hero = unwrap(await storeMediaAsset(deps, media, { originalName: 'hero.png', bytes: heroPng }));
    unwrap(await setValues(deps, media, { values: { heroImage: hero.id } }));
    const full = await readContent(deps, dir);
    const read = vi.spyOn(deps.media, 'read');
    const cheap = unwrap(await siteContentHash(deps, publish, { templateDir: dir }));
    expect(cheap.contentHash).toBe(full.result.contentHash);
    expect(cheap.assets).toBe(1);
    expect(read).not.toHaveBeenCalled();
  });

  it('ignores the e2e brake and needs site.publish', async () => {
    const { deps, dir } = await setup();
    const g = globalThis as { __kompassSiteTestBrakeMs?: number };
    g.__kompassSiteTestBrakeMs = 60_000;
    try {
      const started = Date.now();
      unwrap(await siteContentHash({ ...deps, env: 'test' }, publish, { templateDir: dir }));
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      g.__kompassSiteTestBrakeMs = 0;
    }
    const denied = await siteContentHash(deps, manage, { templateDir: dir });
    expect(denied.ok === false && denied.error.type === 'forbidden').toBe(true);
  });
});

/** Spec Bildausschnitt § 2: Export und Einzelvorschau lösen abgeleitete IDs auf. */
describe('assets with a crop in the export', () => {
  const PICS = `
import { defineTemplate } from '@kompass/site-template';
export default defineTemplate({ name: 'X', locales: ['de'], uses: ['pics'], variables: {}, collections: {} });`;
  const rows: { slug: string; photoAssetId: string; otherAssetId?: string }[] = [];
  const pics = defineModule({
    key: 'pics',
    version: '0',
    permissions: [],
    publishedViews: [definePublishedView({ name: 'pics', schema: z.object({ slug: z.string(), photoAssetId: z.string(), otherAssetId: z.string().optional() }), load: () => rows })],
  });
  const setup = async () => {
    rows.length = 0;
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, pics, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await setModuleEnabled(deps, ctxWith(['modules.manage']), { key: 'pics', enabled: true }));
    const dir = templateDir(PICS);
    unwrap(await applyTemplateSync(deps, manage, { dir, confirm: true }));
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#c00' } }).png().toBuffer();
    const m = unwrap(await storeMediaAsset(deps, ctxWith(['media.upload']), { originalName: 'pic.png', bytes: png }));
    return { deps, dir, m };
  };
  const exportTo = async (deps: Awaited<ReturnType<typeof setup>>['deps'], dir: string) => {
    const jobDir = tmp('kompass-exp-job-');
    const result = unwrap(await exportSiteContent(deps, publish, { jobDir, templateDir: dir }));
    return { result, jobDir, files: readdirSync(path.join(jobDir, 'assets')) };
  };

  it('lists the derived ID with crop and the size of the cut, the original once', async () => {
    const { deps, dir, m } = await setup();
    rows.push({ slug: 'a', photoAssetId: `${m.id}~5000_0_5000_10000` });
    const { result, files } = await exportTo(deps, dir);
    expect(result.assets).toEqual([{ id: `${m.id}~5000_0_5000_10000`, filename: m.filename, mimeType: 'image/png', width: 100, height: 100, crop: { x: 0.5, y: 0, w: 0.5, h: 1 } }]);
    expect(files).toEqual([m.filename]);
  });

  it('gives the plain photo and the cut two entries but one file', async () => {
    const { deps, dir, m } = await setup();
    rows.push({ slug: 'a', photoAssetId: `${m.id}~5000_0_5000_10000`, otherAssetId: m.id });
    const { result, files } = await exportTo(deps, dir);
    expect(result.assets.map((a) => a.id).sort()).toEqual([m.id, `${m.id}~5000_0_5000_10000`].sort());
    expect(result.assets.find((a) => a.id === m.id)).toEqual({ id: m.id, filename: m.filename, mimeType: 'image/png', width: 200, height: 100 });
    expect(files).toEqual([m.filename]);
  });

  it('skips a cut whose base is missing and an unreadable rest', async () => {
    const { deps, dir, m } = await setup();
    rows.push({ slug: 'a', photoAssetId: '01NOTTHERE0000000000000000~0_0_5000_5000', otherAssetId: `${m.id}~x` });
    const { result, files } = await exportTo(deps, dir);
    expect(result.assets).toEqual([]);
    expect(files).toEqual([]);
  });

  it('changes the content hash when the crop changes', async () => {
    const { deps, dir, m } = await setup();
    rows.push({ slug: 'a', photoAssetId: `${m.id}~5000_0_5000_10000` });
    const first = unwrap(await siteContentHash(deps, publish, { templateDir: dir })).contentHash;
    rows[0]!.photoAssetId = `${m.id}~0_0_5000_10000`;
    expect(unwrap(await siteContentHash(deps, publish, { templateDir: dir })).contentHash).not.toBe(first);
  });

  it('reports a blocked term in a file name once, though the file serves two entries', async () => {
    const { deps, dir, m } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage', 'site.manage']), { key: 'site.blockedTerms', value: [m.filename.slice(0, 3)] }));
    rows.push({ slug: 'a', photoAssetId: `${m.id}~5000_0_5000_10000`, otherAssetId: m.id });
    const { result } = await exportTo(deps, dir);
    expect(result.violations.filter((v) => v.path.startsWith('files/'))).toHaveLength(1);
  });

  it('resolves a cut of an image from the clipboard of a proposal and leaves the size open without the base size', async () => {
    const dir = tmp('kompass-exp-gather-');
    const read = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const extra = { id: 'proposal-image-I1', filename: 'proposal-image-I1.png', mimeType: 'image/png', width: null, height: null, read };
    const assets = await gatherAssets(new Set(['proposal-image-I1~0_0_5000_5000', 'proposal-image-I1']), (id) => (id === extra.id ? extra : null), dir);
    expect(assets).toEqual([
      { id: 'proposal-image-I1', filename: 'proposal-image-I1.png', mimeType: 'image/png', width: null, height: null },
      { id: 'proposal-image-I1~0_0_5000_5000', filename: 'proposal-image-I1.png', mimeType: 'image/png', width: null, height: null, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    ]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir)).toEqual(['proposal-image-I1.png']);
  });
});

describe('AI kind in the export', () => {
  const PICS = `
import { defineTemplate } from '@kompass/site-template';
export default defineTemplate({ name: 'X', locales: ['de'], uses: ['pics'], variables: {}, collections: {} });`;
  const rows: { slug: string; photoAssetId: string; otherAssetId?: string }[] = [];
  const pics = defineModule({
    key: 'pics',
    version: '0',
    permissions: [],
    publishedViews: [definePublishedView({ name: 'pics', schema: z.object({ slug: z.string(), photoAssetId: z.string(), otherAssetId: z.string().optional() }), load: () => rows })],
  });
  const setup = async () => {
    rows.length = 0;
    const deps = createTestDeps({ locales: ['de'], manifests: [coreModule, pics, siteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    unwrap(await setModuleEnabled(deps, ctxWith(['modules.manage']), { key: 'pics', enabled: true }));
    const dir = templateDir(PICS);
    unwrap(await applyTemplateSync(deps, manage, { dir, confirm: true }));
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#c00' } }).png().toBuffer();
    const m = unwrap(await storeMediaAsset(deps, ctxWith(['media.upload']), { originalName: 'pic.png', bytes: png }));
    return { deps, dir, m };
  };
  const exportTo = async (deps: Awaited<ReturnType<typeof setup>>['deps'], dir: string) => {
    const jobDir = tmp('kompass-exp-job-');
    const result = unwrap(await exportSiteContent(deps, publish, { jobDir, templateDir: dir }));
    return { result, jobDir, files: readdirSync(path.join(jobDir, 'assets')) };
  };

  it('exports the kind of an edited asset', async () => {
    const { deps, dir, m } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: AI_LABELING_ENABLED_KEY, value: true }));
    unwrap(await setMediaAiKind(deps, ctxWith(['media.upload']), { id: m.id, aiKind: 'edited' }));
    rows.push({ slug: 'a', photoAssetId: m.id });
    const { result } = await exportTo(deps, dir);
    expect(result.assets[0]?.aiKind).toBe('edited');
  });

  it('exports the kind of the original for a derived id', async () => {
    const { deps, dir, m } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: AI_LABELING_ENABLED_KEY, value: true }));
    unwrap(await setMediaAiKind(deps, ctxWith(['media.upload']), { id: m.id, aiKind: 'edited' }));
    rows.push({ slug: 'a', photoAssetId: `${m.id}~5000_0_5000_10000` });
    const { result } = await exportTo(deps, dir);
    expect(result.assets[0]?.aiKind).toBe('edited');
  });

  it('omits the field for none', async () => {
    const { deps, dir, m } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: AI_LABELING_ENABLED_KEY, value: true }));
    rows.push({ slug: 'a', photoAssetId: m.id });
    const { result } = await exportTo(deps, dir);
    expect(result.assets[0]).not.toHaveProperty('aiKind');
  });

  it('omits the field while switched off, though kinds are stored', async () => {
    const { deps, dir, m } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: AI_LABELING_ENABLED_KEY, value: true }));
    unwrap(await setMediaAiKind(deps, ctxWith(['media.upload']), { id: m.id, aiKind: 'edited' }));
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: AI_LABELING_ENABLED_KEY, value: false }));
    rows.push({ slug: 'a', photoAssetId: m.id });
    const { result } = await exportTo(deps, dir);
    expect(result.assets[0]).not.toHaveProperty('aiKind');
  });

  it('keeps the content hash when switched on and every asset is none', async () => {
    const { deps, dir, m } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: AI_LABELING_ENABLED_KEY, value: true }));
    rows.push({ slug: 'a', photoAssetId: m.id });
    const hash1 = unwrap(await siteContentHash(deps, publish, { templateDir: dir })).contentHash;
    unwrap(await setMediaAiKind(deps, ctxWith(['media.upload']), { id: m.id, aiKind: 'none' }));
    const hash2 = unwrap(await siteContentHash(deps, publish, { templateDir: dir })).contentHash;
    expect(hash2).toBe(hash1);
  });

  it('changes the content hash when a kind changes', async () => {
    const { deps, dir, m } = await setup();
    unwrap(await setSetting(deps, ctxWith(['settings.manage']), { key: AI_LABELING_ENABLED_KEY, value: true }));
    rows.push({ slug: 'a', photoAssetId: m.id });
    const before = unwrap(await siteContentHash(deps, publish, { templateDir: dir })).contentHash;
    unwrap(await setMediaAiKind(deps, ctxWith(['media.upload']), { id: m.id, aiKind: 'edited' }));
    const after = unwrap(await siteContentHash(deps, publish, { templateDir: dir })).contentHash;
    expect(after).not.toBe(before);
  });
});
