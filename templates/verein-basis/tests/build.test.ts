import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import template from '../kompass.template';
import { build, buildMonolingual, cleanupDirs, fixtureWithout } from './helpers';

afterAll(() => {
  cleanupDirs();
});

function hashTree(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        h.update(path.relative(dir, p));
        h.update(readFileSync(p));
      }
    }
  };
  walk(dir);
  return h.digest('hex');
}

describe('verein-basis', () => {
  it('declares only fields any club could fill', () => {
    const keys = Object.keys(template.variables).concat(Object.keys(template.collections));
    expect(keys).not.toContain('shelterDogCount');
    for (const key of keys) expect(key).not.toMatch(/dog|animal|shelter|tier|spendenplattform/i);

    for (const [, col] of Object.entries(template.collections)) {
      expect(col.label).not.toMatch(/tier|hund|shelter|spendenplattform/i);
      for (const field of Object.keys(col.fields)) {
        expect(field).not.toMatch(/dog|animal|shelter|tier|spendenplattform/i);
      }
    }
  });

  it('names two languages and the four club collections', () => {
    expect(Object.keys(template.collections).sort()).toEqual(['documents', 'faq', 'news', 'team']);
    expect(template.locales).toEqual(['de', 'en']);
  });

  it('builds against the fixture and renders every declared collection', () => {
    const out = build();

    for (const p of [
      'index.html',
      'ueber-uns/index.html',
      'team/index.html',
      'aktuelles/index.html',
      'aktuelles/jahresrueckblick/index.html',
      'fragen-und-antworten/index.html',
      'spenden/index.html',
      'mitglied-werden/index.html',
      'kontakt/index.html',
      'impressum/index.html',
      'datenschutz/index.html',
      'satzung/index.html',
      'dokumente/satzung.pdf',
      '404.html',
      'robots.txt',
      'sitemap-index.xml',
    ]) {
      expect(existsSync(path.join(out, p)), p).toBe(true);
    }

    const home = readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(home).toContain('Gemeinsam für unsere Sache.');
    expect(home).toContain('<html lang="de"');
    expect(home).not.toContain('noindex');

    const news = readFileSync(path.join(out, 'aktuelles/index.html'), 'utf8');
    expect(news).toContain('Unser Jahresrückblick');
    expect(news).toContain('Wir haben neue Räume');
    const article = readFileSync(path.join(out, 'aktuelles/jahresrueckblick/index.html'), 'utf8');
    expect(article).toContain('Was ansteht');

    const team = readFileSync(path.join(out, 'team/index.html'), 'utf8');
    expect(team).toContain('Alex Beispiel');
    expect(team).toContain('Vorsitz');

    const faq = readFileSync(path.join(out, 'fragen-und-antworten/index.html'), 'utf8');
    expect(faq).toContain('Wie kann ich mithelfen?');

    const statutes = readFileSync(path.join(out, 'satzung/index.html'), 'utf8');
    expect(statutes).toContain('/dokumente/satzung.pdf');

    expect(readFileSync(path.join(out, 'spenden/index.html'), 'utf8')).toContain('IBAN DE23 9999 9999 0000 2020 51');
    const join = readFileSync(path.join(out, 'mitglied-werden/index.html'), 'utf8');
    expect(join).toContain('Jahresbeitrag');
    expect(join).toContain('60');
  });

  /**
   * Die Vereinsstammdaten liefert Kompass jedem Template von sich aus
   * (`views.organization`) — kein Template soll sie als Variable oder als
   * Konstante im Code verdoppeln. Bis zum 2026-09-15 stand hier
   * „Musterverein, Musterstraße 1, VR 0000“ fest im Template: Wer es als
   * Vorlage nahm und publizierte, hatte ein falsches Impressum im Netz.
   *
   * Die Fixture nennt den Verein bewusst anders als jede Konstante im
   * Template. Käme der Name noch aus dem Code, fiele dieser Test durch.
   */
  it('takes name, address, bank details and register entry from the club data', () => {
    const out = build();

    const home = readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(home).toContain('Beispielverein für Gutes e.V.');
    expect(home).not.toContain('Musterverein');
    expect(home).not.toContain('Musterstraße');

    const imprint = readFileSync(path.join(out, 'impressum/index.html'), 'utf8');
    expect(imprint).toContain('Beispielstraße 3');
    expect(imprint).toContain('12345 Beispielstadt');
    expect(imprint).toContain('Amtsgericht Beispielstadt');
    expect(imprint).toContain('VR 4711');
    expect(imprint).toContain('kontakt@beispielverein.example');
    expect(imprint).not.toContain('VR 0000');

    const donate = readFileSync(path.join(out, 'spenden/index.html'), 'utf8');
    expect(donate).toContain('DE23 9999 9999 0000 2020 51');
    expect(donate).toContain('Beispielbank');
  });

  /**
   * Ein Verein, dessen Eintragung noch läuft, hat keine Registernummer. Eine
   * leere Zeile „Registernummer:“ wäre schlechter als der ehrliche Hinweis.
   */
  it('says the registration is pending when there is no register number yet', () => {
    const out = build({ SITE_CONTENT_DIR: fixtureWithout({ registerNumber: '' }) });
    const imprint = readFileSync(path.join(out, 'impressum/index.html'), 'utf8');
    expect(imprint).toContain('in Eintragung');
    expect(imprint).not.toMatch(/Registernummer:\s*</);
  });

  /** Ohne Telefon bleibt die Zeile weg, statt als „Telefon:“ ohne Wert zu stehen. */
  it('leaves out the phone line when no number is set', () => {
    const out = build({ SITE_CONTENT_DIR: fixtureWithout({ phone: '' }) });
    const imprint = readFileSync(path.join(out, 'impressum/index.html'), 'utf8');
    expect(imprint).not.toContain('Telefon');
    expect(imprint).toContain('kontakt@beispielverein.example');
  });

  /**
   * Kompass führt beliebig viele Sprachen; bis zum 2026-09-15 zeigte das
   * mitgelieferte Beispiel keine einzige davon. Wer ein zweisprachiges
   * Template bauen wollte, fand im Repo keine Vorlage.
   *
   * Die zweite Sprache liegt unter `/en/`, die erste bleibt an der Wurzel —
   * so ändern sich bestehende Adressen nicht, wenn ein Verein später eine
   * Sprache ergänzt.
   */
  it('builds every page in both languages', () => {
    const out = build();

    for (const p of [
      'en/index.html',
      'en/about-us/index.html',
      'en/team/index.html',
      'en/news/index.html',
      'en/news/jahresrueckblick/index.html',
      'en/questions-and-answers/index.html',
      'en/donate/index.html',
      'en/become-a-member/index.html',
      'en/contact/index.html',
      'en/legal-notice/index.html',
      'en/privacy/index.html',
      'en/statutes/index.html',
      // Astro baut nur die Fehlerseite an der Wurzel als `404.html`; jede
      // weitere liegt als Verzeichnis. Ein Hoster liefert bei einem unbekannten
      // Pfad üblicherweise `/404.html` aus — die englische Fassung erreicht nur,
      // wer sprachabhängige Fehlerseiten einrichtet.
      'en/404/index.html',
    ]) {
      expect(existsSync(path.join(out, p)), p).toBe(true);
    }

    const en = readFileSync(path.join(out, 'en/index.html'), 'utf8');
    expect(en).toContain('<html lang="en"');
    expect(en).toContain('Together for our cause.');
    expect(en).not.toContain('Zum Inhalt springen');
  });

  /**
   * Suchmaschinen sollen die Übersetzung finden, und wer die Sprache wechselt,
   * will auf derselben Seite bleiben — nicht auf der Startseite landen.
   */
  it('links both languages to each other on every page', () => {
    const out = build();

    const de = readFileSync(path.join(out, 'spenden/index.html'), 'utf8');
    expect(de).toContain('hreflang="de"');
    expect(de).toContain('hreflang="en"');
    expect(de).toContain('href="https://example.org/en/donate/"');

    const en = readFileSync(path.join(out, 'en/donate/index.html'), 'utf8');
    expect(en).toContain('href="https://example.org/spenden/"');
    // Der Umschalter zeigt auf die Übersetzung derselben Seite, nicht auf „/“.
    expect(en).toMatch(/<a[^>]+href="\/spenden\/"[^>]*>\s*Deutsch/);
  });

  /**
   * Ein Feld, das nur auf Deutsch gepflegt ist, soll die englische Seite nicht
   * leer lassen: Der deutsche Text ist besser als nichts, muss aber als
   * Rückfall erkennbar sein.
   */
  it('falls back to the first language when a field has no translation', () => {
    const out = build();
    const news = readFileSync(path.join(out, 'en/news/index.html'), 'utf8');
    // „Wir haben neue Räume“ ist in der Fixture nur deutsch gepflegt. Der Text
    // erscheint, trägt aber seine Sprache — sonst liest ein Screenreader ihn
    // mit englischer Aussprache vor, und Suchmaschinen halten die Seite für
    // englisch. Auf `lang="de"` allein zu prüfen genügt nicht: Das Attribut
    // steht auch im Sprachumschalter und im hreflang-Verweis.
    expect(news).toMatch(/<h2 lang="de"><a [^>]*>Wir haben neue Räume/);
    expect(news).toMatch(/<div class="prose card-excerpt" lang="de">/);
  });

  /**
   * Die Zusage aus `lib/locale.ts`: Ein einsprachiger Verein streicht `'en'` in
   * der Deklaration, und sonst nichts. Ohne diesen Test wäre das eine
   * Behauptung — die Sprachen stehen an genau einer Stelle, aber ob das
   * Template ohne zweite Sprache auch baut, sagt erst der Build.
   */
  it('builds a single-language site when the declaration names one locale', () => {
    const out = buildMonolingual();

    expect(existsSync(path.join(out, 'index.html'))).toBe(true);
    expect(existsSync(path.join(out, 'spenden/index.html'))).toBe(true);
    expect(existsSync(path.join(out, 'en'))).toBe(false);

    const home = readFileSync(path.join(out, 'index.html'), 'utf8');
    expect(home).toContain('<html lang="de"');
    // Kein Umschalter und kein hreflang, wenn es nichts zu wechseln gibt.
    expect(home).not.toContain('lang-switch');
    expect(home).not.toContain('hreflang');
  });

  it('is deterministic and resolves every asset the built pages reference', () => {
    const a = build();
    const b = build();
    expect(hashTree(a)).toBe(hashTree(b));

    const missing = new Set<string>();
    const walk = (d: string) => {
      for (const name of readdirSync(d).sort()) {
        const file = path.join(d, name);
        if (statSync(file).isDirectory()) {
          walk(file);
          continue;
        }
        if (!file.endsWith('.html')) continue;
        const html = readFileSync(file, 'utf8');
        for (const m of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
          const url = m[1].split(/[?#]/)[0];
          if (url.endsWith('/') || url.endsWith('.html')) continue;
          if (!existsSync(path.join(a, url))) missing.add(`${path.relative(a, file)} -> ${url}`);
        }
      }
    };
    walk(a);
    expect([...missing].sort()).toEqual([]);
  });

  it('carries noindex and a disallow robots.txt in a staging build', () => {
    const s = build({ SITE_STAGING: '1', SITE_PUBLIC_URL: 'https://staging.example.org' });
    expect(readFileSync(path.join(s, 'index.html'), 'utf8')).toContain('name="robots" content="noindex, nofollow"');
    expect(readFileSync(path.join(s, 'robots.txt'), 'utf8')).toContain('Disallow: /');
  });
});
