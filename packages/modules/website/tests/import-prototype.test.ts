import path from 'node:path';
import { coreModule, listProjects, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { animalsModule, listAnimals } from '@kompass/module-animals';
import { afterEach, describe, expect, it } from 'vitest';
import { importPrototype } from '../../../../scripts/import-prototype';
import { getPage, listFaqs, listTeam, websiteModule } from '../src';
import { cleanupPrototypes, fakePrototype } from './prototype-fixture';

afterEach(() => {
  cleanupPrototypes();
});

describe('importPrototype', () => {
  it('imports dogs (with story), projects, team, faqs, articles (html→markdown), pages and facts; idempotent', async () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule, animalsModule], env: 'test' });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['website.manage', 'website.view', 'animals.manage', 'animals.view', 'media.upload', 'settings.manage']);
    const dir = fakePrototype();
    const first = await importPrototype(deps, ctx, { prototypeDir: dir, pagesFile: path.join(dir, 'pages.json') });
    expect(first).toEqual({ animals: 2, projects: 1, team: 1, faqs: 1, articles: 1, pages: 1, facts: 4 });
    const animals = unwrap(await listAnimals(deps, ctx));
    const akiko = animals.find((a) => a.slug === 'akiko')!;
    expect(akiko.status).toBe('adopted');
    expect(akiko.story?.quote.de).toBe('Endlich zuhause.');
    expect(animals.find((a) => a.slug === 'chiara')?.photos).toHaveLength(1);
    expect(unwrap(await listProjects(deps, ctx))[0]?.type).toBe('ongoing');
    expect(unwrap(await listTeam(deps, ctx))[0]?.photoAssetId).toBeTruthy();
    expect(unwrap(await listFaqs(deps, ctx))[0]?.category.de).toBe('Spenden');
    expect(unwrap(await getPage(deps, ctx, 'about')).title.de).toContain('*Chance.*');
    const second = await importPrototype(deps, ctx, { prototypeDir: dir, pagesFile: path.join(dir, 'pages.json') });
    expect(second).toEqual({ animals: 0, projects: 0, team: 0, faqs: 0, articles: 0, pages: 0, facts: 0 });
  });
});
