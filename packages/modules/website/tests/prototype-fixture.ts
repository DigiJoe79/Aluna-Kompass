import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dirs: string[] = [];

/** Entfernt alle von fakePrototype() erzeugten Verzeichnisse. */
export function cleanupPrototypes(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** Minimaler Prototyp-Baum mit denselben Dateien, die das Importskript liest. */
export function fakePrototype(): string {
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
    path.join(dir, 'src/data/site.js'),
    `export const site = { name: 'Beispielverein e.V.', email: 'info@beispiel.test' };`,
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
