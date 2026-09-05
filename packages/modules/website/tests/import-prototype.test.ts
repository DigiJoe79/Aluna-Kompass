import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, listProjects, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { animalsModule, listAnimals } from '@kompass/module-animals';
import { afterEach, describe, expect, it } from 'vitest';
import { importPrototype } from '../../../../scripts/import-prototype';
import { getPage, listFaqs, listTeam, websiteModule } from '../src';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fakePrototype(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'proto-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'src/data'), { recursive: true });
  mkdirSync(path.join(dir, 'public/images'), { recursive: true });
  writeFileSync(
    path.join(dir, 'public/images/placeholder-hund.png'),
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
  );
  writeFileSync(
    path.join(dir, 'src/data/dogs.js'),
    `export const dogs = [
      { slug: 'chiara', name: 'Chiara', photo: '/images/placeholder-hund.png', geschlecht: 'Hündin', geboren: '16.02.2021', groesse: 45, groesseText: '45–50 cm', ort: 'Rumänien', status: 'sucht', notfall: false, patentier: true, wesen: ['ruhig'], hundeblicke: 'https://www.hundeblicke.net/chiara', kurz: 'Sanft.', text: ['Absatz 1.', 'Absatz 2.'], tags: [] },
      { slug: 'akiko', name: 'Akiko', photo: '/images/placeholder-hund.png', geschlecht: 'Hündin', geboren: '2020', groesse: 50, groesseText: '50 cm', ort: 'Deutschland', status: 'vermittelt', notfall: false, patentier: false, wesen: [], hundeblicke: '', kurz: 'Angekommen.', text: ['Text.'], tags: [], vorher: '/images/placeholder-hund.png', nachher: '/images/placeholder-hund.png', zitat: 'Endlich zuhause.', familie: 'Familie M.' }
    ];`,
  );
  writeFileSync(
    path.join(dir, 'src/data/projects.js'),
    `export const projects = [{ slug: 'grundversorgung-shelter', titel: 'Grundversorgung', typ: 'Dauerprojekt', photo: '/images/placeholder-hund.png', betterplaceId: '000001', kurz: 'Futter.', text: ['Text.'] }];`,
  );
  writeFileSync(
    path.join(dir, 'src/data/team.js'),
    `export const team = [{ name: 'Nicole Wießner', rolle: 'Erste Vorsitzende', foto: '/images/placeholder-hund.png' }];`,
  );
  writeFileSync(
    path.join(dir, 'src/data/faq.js'),
    `export const faq = [{ kategorie: 'Spenden', fragen: [{ q: 'Wohin?', a: 'An den Shelter.' }] }];`,
  );
  writeFileSync(
    path.join(dir, 'src/data/articles.js'),
    `export const articles = [{ slug: 'transport', titel: 'Ablauf des Transportes', lede: 'Lede.', body: '<h2>Vorbereitung</h2><p>Text.</p><ul><li>eins</li></ul>' }];`,
  );
  writeFileSync(
    path.join(dir, 'pages.json'),
    JSON.stringify({
      facts: {
        claim: { de: 'Wir helfen. Leben retten.', en: '' },
        forwardingPercent: 97.2,
        shelterDogCount: 150,
        donationBoxLocations: ['Köln-Porz'],
        betterplaceMetaProjectId: '000000',
        blockedTerms: [],
      },
      pages: {
        about: {
          title: { de: 'Jeder Hund verdient eine zweite *Chance.*', en: '' },
          lede: { de: 'L', en: '' },
          body: { de: '## Was uns *antreibt.*\n\n- Hunde retten.', en: '' },
          blocks: [],
        },
      },
    }),
  );
  return dir;
}

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
