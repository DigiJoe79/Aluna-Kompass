# Webseite Teil 3: Site, Build-Pipeline, Publish, Datenübernahme, Betrieb — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alunas Webseite als Astro-Site `apps/site` aus dem Prototyp portieren (DE und EN, alle Seiten, Hunde, Projekte, Artikel, FAQ, Team, Erfolgsgeschichten), die Pipeline Export → Bilder → Build → Diff → Publish im Webseiten-Modul bauen, die Publizieren-Seite um Vorschau, Änderungsliste und Publish-Knopf erweitern, die Prototyp-Inhalte einmalig nach Kompass übernehmen und Docker, CI und Betriebsanleitung ergänzen. Ergebnis: WordPress ist abgelöst.

**Architecture:** `apps/site` ist eine statische Astro-7-Site ohne Datenbankzugriff; sie liest `content.json` und `images.json` aus einem Job-Verzeichnis (`SITE_CONTENT_DIR`) und rendert alle Seiten beider Sprachen über eine dynamische Catch-all-Route aus einer Routentabelle. Markdown rendert `@kompass/markdown`, derselbe Renderer wie die Vorschau in Kompass. Das Webseiten-Modul kapselt die Pipeline als Services: Bildvarianten mit sharp (gecacht), `astro build` als Kindprozess mit Zeitlimit, Datei-Hash-Manifest für den Diff, rsync über SSH für den Publish, alles protokolliert. Kompass liefert den letzten Vorschau-Build unter `/website/preview/` aus.

**Tech Stack:** Astro 7.3 · `@astrojs/sitemap` 3.7 · sharp 0.35 · `@kompass/markdown` · rsync + openssh-client im Image · wie bisher Vitest, Playwright, Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-05-webseite-design.md` — Abschnitte 3 (Build-Pipeline, Publish-Ziel, Vorschau), 4 „Publizieren", 5 (Portierung, Datenübernahme, Tests, Betrieb).

**Voraussetzung:** Pläne `webseite-1-module` und `webseite-2-oberflaeche` umgesetzt; `pnpm test` und `pnpm --filter @kompass/app e2e` grün.

## Global Constraints

- **Die Site hat keinen Datenbankzugriff** und importiert nichts aus `@kompass/core`; Eingabe ist ausschließlich `SITE_CONTENT_DIR` mit `content.json`, `images.json` und `assets/`. Sie darf `@kompass/markdown` nutzen.
- **Determinismus:** gleicher Export ⇒ byte-identisches `dist/`. Keine Zeitstempel, keine Zufallswerte, stabile Dateireihenfolge; Bildvarianten heißen nach Content-Hash und Breite.
- **Zweisprachig:** jede Seite existiert unter DE- und EN-Pfad; `hreflang`-Links in beide Richtungen; Sprachumschalter zeigt auf die Entsprechung derselben Seite; fehlende EN-Texte fallen auf DE zurück und tragen `data-fallback="de"` (Export listet die Lücken).
- **Staging** (`SITE_STAGING=1`) setzt `<meta name="robots" content="noindex, nofollow">` und `robots.txt` mit `Disallow: /`; Live setzt Sitemap und `robots.txt` mit `Allow`.
- **Publish nur manuell** nach Bestätigung mit Diff; nie aus `development`; Sperrworttreffer ⇒ kein Publish; Zugangsdaten nur aus `SITE_DEPLOY_*`-Umgebungsvariablen, Schlüssel als Datei.
- **Kein Formular, kein Cookie, kein externes Skript** in der Site; Betterplace nur per 2-Klick; die einzigen Client-Skripte sind Hunde-Filter und 2-Klick.
- **Astro 7:** HTML muss wohlgeformt sein (jedes Nicht-void-Element geschlossen); `compressHTML: true` explizit setzen.
- **Versionen** (Stand 2026-09-05): `astro ^7.3.1`, `@astrojs/sitemap ^3.7.4`, `sharp ^0.35.4`.

---

## Dateistruktur (Ergebnis dieses Plans)

```
apps/site/
  package.json  astro.config.mjs  tsconfig.json  vitest.config.ts
  fixtures/example/content.json  images.json  assets/   Beispiel-Export für Dev und Tests
  public/fonts/*.woff2  public/images/{logo,favicons}   aus dem Prototyp
  src/styles/global.css                     Prototyp-CSS, Inline-Styles in Klassen überführt
  src/lib/content.ts                        loadContent(): Content aus SITE_CONTENT_DIR
  src/lib/locale.ts                         pick(text, locale), ui(locale) Dictionary, dateFor
  src/lib/routes.ts                         Routentabelle DE/EN, pathFor(kind, locale, slug?), alternateFor
  src/lib/images.ts                         imageFor(assetId, size) aus images.json
  src/layouts/Base.astro                    Header, Footer, Sprachumschalter, hreflang, robots
  src/components/{PageHeader,TextPage,Blocks,MarkdownBody,BetterplaceEmbed,DogCard,ProjectCard,StoryCard,DownloadCard,MailtoCard}.astro
  src/pages/[...path].astro                 alle Seiten beider Sprachen aus der Routentabelle
  src/pages/404.astro  src/pages/robots.txt.ts
  tests/build.test.ts                       baut aus fixtures, prüft Determinismus, DE/EN, hreflang, noindex
packages/modules/website/src/
  pipeline/images.ts                        prepareImageVariants (sharp, Cache)
  pipeline/build.ts                         buildSite (astro als Kindprozess)
  pipeline/diff.ts                          hashTree, diffTrees
  pipeline/publish.ts                       rsyncPublish
  pipeline/jobs.ts                          runPreview, runPublish (Orchestrierung + Protokoll)
  services/publishes.ts                     + recordPublish
  schema.ts                                 website_publishes + fileManifest
apps/kompass/src/
  app/website/preview/[[...path]]/route.ts  Vorschau ausliefern
  app/(shell)/website/publish/…             + preview-card.tsx, diff-card.tsx, publish-card.tsx, actions.ts
  lib/site-env.ts                           SITE_*-Variablen lesen
scripts/import-prototype.ts                 einmalige Datenübernahme
Dockerfile  docker-compose.yml  .env.*.example  .github/workflows/ci.yml  docs/betrieb.md
```

---

### Task 1: Site-Gerüst — Inhalt laden, Routentabelle, Layout, Textseiten, Startseite

**Files:**
- Create: `apps/site/package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `fixtures/example/content.json`, `fixtures/example/images.json`, `src/lib/content.ts`, `src/lib/locale.ts`, `src/lib/routes.ts`, `src/lib/images.ts`, `src/layouts/Base.astro`, `src/components/PageHeader.astro`, `src/components/MarkdownBody.astro`, `src/components/Blocks.astro`, `src/components/TextPage.astro`, `src/pages/[...path].astro`, `src/pages/404.astro`, `src/pages/robots.txt.ts`, `src/styles/global.css`, `public/fonts/*`, `public/images/*`
- Test: `apps/site/tests/routes.test.ts`, `apps/site/tests/build.test.ts`

**Interfaces:**
- Produces:
  - `loadContent(): Promise<SiteContent>` — liest `${SITE_CONTENT_DIR}/content.json` (Default `fixtures/example`); Typen `SiteContent = { facts: Facts; pages: Page[]; articles: Article[]; team: TeamMember[]; faqs: Faq[]; projects: Project[]; downloads: Download[]; animals?: Animal[]; assets: Asset[] }` (Felder wie die Sichten aus Plan 4).
  - `pick(text: { de; en }, locale) → { value; fallback: 'de' | null }`; `ui(locale)` → Dictionary der Oberflächentexte der Site (Navigation, Buttons, Badges, Footer) für `de` und `en`.
  - Routentabelle: `ROUTES: Record<Kind, { de: string; en: string }>` mit Kinds `home, help, donate, sponsor, membership, about, team, partners, articles, article, faq, contact, imprint, privacy, statutes, adoption-process, dogs, dog, stories, projects, project`; `pathFor(kind, locale, slug?)`, `alternateFor(path)`; DE-Pfade wie im Prototyp, EN-Pfade englisch (`/en/help/`, `/en/looking-for-a-home/`, `/en/happy-endings/`, `/en/projects/`, `/en/good-to-know/`, `/en/about/`, `/en/team/`, `/en/partners/`, `/en/faq/`, `/en/contact/`, `/en/imprint/`, `/en/privacy/`, `/en/statutes/`, `/en/adoption-process/`, `/en/donate/`, `/en/sponsor/`, `/en/membership/`).
  - `imageFor(assetId, width)` aus `images.json` (Task 2 füllt es; das Fixture enthält Beispielwerte).
  - Catch-all-Seite rendert `home` und alle `TextPage`-Kinds; Task 3 ergänzt Listen und Detailseiten.

- [ ] **Step 1: Tests schreiben**

`apps/site/tests/routes.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { alternateFor, pathFor, ROUTES } from '../src/lib/routes';

describe('routes', () => {
  it('maps kinds to de and en paths with trailing slashes', () => {
    expect(pathFor('help', 'de')).toBe('/helfen/');
    expect(pathFor('help', 'en')).toBe('/en/help/');
    expect(pathFor('dog', 'de', 'chiara')).toBe('/zuhause-gesucht/chiara/');
    expect(pathFor('dog', 'en', 'chiara')).toBe('/en/looking-for-a-home/chiara/');
    expect(pathFor('home', 'en')).toBe('/en/');
  });
  it('finds the alternate language path for any path', () => {
    expect(alternateFor('/helfen/')).toEqual({ locale: 'de', other: { locale: 'en', path: '/en/help/' } });
    expect(alternateFor('/en/looking-for-a-home/chiara/')).toEqual({ locale: 'en', other: { locale: 'de', path: '/zuhause-gesucht/chiara/' } });
    expect(Object.keys(ROUTES)).toHaveLength(21);
  });
});
```

`apps/site/tests/build.test.ts` (baut die Site; ~10–30 s):
```ts
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function build(env: Record<string, string>): string {
  const out = mkdtempSync(path.join(tmpdir(), 'site-dist-'));
  dirs.push(out);
  const r = spawnSync('pnpm', ['exec', 'astro', 'build', '--outDir', out], { cwd: ROOT, env: { ...process.env, SITE_CONTENT_DIR: path.join(ROOT, 'fixtures/example'), SITE_PUBLIC_URL: 'https://example.org', ...env }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr + r.stdout);
  return out;
}

function hashTree(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string) => { for (const name of readdirSync(d).sort()) { const p = path.join(d, name); if (statSync(p).isDirectory()) walk(p); else { h.update(path.relative(dir, p)); h.update(readFileSync(p)); } } };
  walk(dir);
  return h.digest('hex');
}

describe('site build', () => {
  it('builds every route in both languages with hreflang and is deterministic', () => {
    const a = build({});
    const b = build({});
    expect(hashTree(a)).toBe(hashTree(b));
    for (const p of ['index.html', 'en/index.html', 'helfen/index.html', 'en/help/index.html', 'zuhause-gesucht/index.html', 'en/looking-for-a-home/index.html', 'zuhause-gesucht/chiara/index.html', 'projekte/grundversorgung/index.html', 'wissenswertes/index.html', 'faq/index.html', 'impressum/index.html', 'sitemap-index.xml']) {
      expect(existsSync(path.join(a, p)), p).toBe(true);
    }
    const help = readFileSync(path.join(a, 'helfen/index.html'), 'utf8');
    expect(help).toContain('<link rel="alternate" hreflang="en" href="https://example.org/en/help/"');
    expect(help).toContain('<html lang="de"');
    expect(help).not.toContain('noindex');
    expect(readFileSync(path.join(a, 'robots.txt'), 'utf8')).toContain('Sitemap: https://example.org/sitemap-index.xml');
    expect(readFileSync(path.join(a, 'en/help/index.html'), 'utf8')).toContain('<html lang="en"');
  });

  it('staging builds carry noindex and a disallow robots.txt', () => {
    const s = build({ SITE_STAGING: '1', SITE_PUBLIC_URL: 'https://staging.example.org' });
    expect(readFileSync(path.join(s, 'index.html'), 'utf8')).toContain('name="robots" content="noindex, nofollow"');
    expect(readFileSync(path.join(s, 'robots.txt'), 'utf8')).toContain('Disallow: /');
  });
});
```
(Der Test verlangt Fixture-Daten mit einem Hund `chiara` und einem Projekt `grundversorgung`; die Listen-Kinds entstehen in Task 3 — bis dahin die Pfade `zuhause-gesucht/*`, `projekte/*`, `wissenswertes/*`, `faq/*` mit `test.todo` aussparen bzw. die Liste in Task 1 auf `index.html`, `en/index.html`, `helfen/index.html`, `en/help/index.html`, `impressum/index.html`, `sitemap-index.xml` beschränken und in Task 3 erweitern.)

- [ ] **Step 2: Paket anlegen, Tests ausführen, Fehlschlag prüfen**

`apps/site/package.json`:
```json
{
  "name": "@kompass/site",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "astro dev", "build": "astro build", "preview": "astro preview", "test": "vitest run", "typecheck": "astro check" },
  "dependencies": { "@astrojs/sitemap": "^3.7.4", "@kompass/markdown": "workspace:*", "astro": "^7.3.1" },
  "devDependencies": { "@astrojs/check": "^0.9.6", "@types/node": "^26.4.1", "typescript": "^6.0.3", "vitest": "^5.0.0" }
}
```
(`@astrojs/check` auf die aktuelle Version setzen: `npm view @astrojs/check version`.)

`apps/site/astro.config.mjs`:
```js
// @ts-check
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

const site = process.env.SITE_PUBLIC_URL ?? 'https://example.org';

export default defineConfig({
  site,
  trailingSlash: 'always',
  build: { format: 'directory' },
  compressHTML: true,
  devToolbar: { enabled: false },
  integrations: [sitemap({ filter: () => process.env.SITE_STAGING !== '1' })],
});
```
`tsconfig.json`: `{ "extends": "astro/tsconfigs/strict", "compilerOptions": { "types": ["node"] } }`. `vitest.config.ts`: `include: ['tests/**/*.test.ts']`, `testTimeout: 120_000`.

Fonts und Logos aus dem Prototyp kopieren: `cp -r "/Users/joe/Development/Aluna Tierhilfe e.V./Webseite/aluna-static/public/fonts" apps/site/public/` und `aluna-logo.png`, `aluna-logo-kompakt.png`, `favicon-*.png` nach `apps/site/public/images/`. `global.css` aus `aluna-static/src/styles/global.css` übernehmen; die Inline-Styles der Prototyp-Seiten (Karten in Helfen/Team/Wissenswertes, Projektbild, Story-Figuren) werden als Klassen `.option-card`, `.option-card img`, `.team-card`, `.team-card img`, `.article-card`, `.project-hero`, `.story-figure`, `.story-caption-small`, `.actions-row` ergänzt.

Run: `pnpm install && pnpm --filter @kompass/site test tests/routes.test.ts`
Expected: FAIL.

- [ ] **Step 3: Fixture**

`apps/site/fixtures/example/content.json` — ein kleiner, vollständiger Export im Format aus Plan 4 (Task 6): `facts` (ein Element mit Musterverein-Daten, `forwardingPercent: 97.2`, `shelterDogCount: 150`, `donationBoxLocations: ["Köln-Porz", "Jülich"]`, `section11Status: "pending"`, `socialLinks: [{ "label": "Instagram", "href": "https://instagram.com/example" }]`, `betterplaceMetaProjectId: "000000"`, `betterplaceDefaultAmount: 50`, `featuredAnimalSlug: "auto"`, `featuredStorySlug: "auto"`, `organization: { name: "Musterverein e.V.", … }`), alle zwölf `pages` mit DE-Texten (EN teils leer), zwei `articles`, drei `team`, vier `faqs` in zwei Kategorien, zwei `projects` (`grundversorgung` ongoing, `op-fonds` shortTerm), vier `downloads`, drei `animals` (`chiara` lookingForHome mit zwei Fotos, `bruno` emergency in germany, `akiko` adopted mit Story), `assets` mit den referenzierten IDs. Als Fotos dienen `assets/placeholder-hund.png` usw. (Platzhalter aus dem Prototyp). `images.json` enthält für jedes Asset Varianten `{ "<assetId>": { "src": "/images/<hash>-960.webp", "srcset": "/images/<hash>-480.webp 480w, …", "width": 960, "height": 720 } }`; die Bilddateien liegen unter `fixtures/example/images/`. Task 2 erzeugt genau dieses Format; für das Fixture einmalig mit dem Skript aus Task 2 erzeugen (`pnpm --filter @kompass/module-website exec tsx scripts/make-fixture-images.ts`) — bis dahin reichen kopierte Platzhalter-PNGs mit den vereinbarten Namen.

- [ ] **Step 4: Bibliothek**

`apps/site/src/lib/locale.ts`:
```ts
export type Locale = 'de' | 'en';
export interface L { de: string; en: string }

export function pick(text: L | undefined, locale: Locale): { value: string; fallback: 'de' | null } {
  if (!text) return { value: '', fallback: null };
  if (text[locale]) return { value: text[locale], fallback: null };
  return { value: text.de, fallback: locale === 'en' ? 'de' : null };
}

const DICT = {
  de: { nav: { help: 'Helfen', about: 'Über uns', dogs: 'Zuhause gesucht', projects: 'Projekte', faq: 'FAQ' }, cta: { donate: 'Jetzt spenden', sponsor: 'Pate werden', meetDogs: 'Hunde kennenlernen →', allDogs: 'Alle Hunde ansehen', allProjects: 'Alle Projekte ansehen', toProject: 'Zum Projekt', readMore: 'Weiterlesen', moreStories: 'Mehr Geschichten lesen', toDonate: 'Zur Spendenseite', backToDogs: 'Alle Hunde ansehen', backToProjects: 'Alle Projekte', backToArticles: 'Alle Artikel', mail: 'E-Mail schreiben' }, badge: { emergency: 'Notfall', reserved: 'Reserviert', adopted: 'Vermittelt' }, filter: { label: 'Filter', all: 'Alle', emergency: 'Notfälle', germany: 'Schon in Deutschland', small: 'bis 45 cm', large: 'ab 45 cm', empty: 'Für diesen Filter ist gerade kein Hund gelistet.' }, dog: { female: 'Hündin', male: 'Rüde', shelter: 'im Shelter', germany: 'in Deutschland', reserved: 'ist bereits reserviert — die Vorkontrolle läuft.', adopted: 'ist vermittelt und glücklich angekommen.', interest: 'Interesse an', external: 'Profil beim Vermittlungspartner' }, story: { before: 'Vorher', after: 'Nachher', found: 'hat ihre Familie gefunden.', year: 'Vermittlung' }, project: { ongoing: 'Dauerprojekt', shortTerm: 'Kurzzeitprojekt', donateFor: 'Jetzt für dieses Projekt spenden.' }, footer: { website: 'Webseite', help: 'Helfen', imprint: 'Impressum', privacy: 'Datenschutz', contact: 'Kontakt', section11: 'Erlaubnis nach § 11 TSchG', pending: 'in Bearbeitung', granted: 'erteilt am', bank: 'Bankverbindung' }, bp: { load: 'Formular für {label} laden', title: 'Spendenformular laden', open: 'betterplace.org öffnen', note: 'Formular bereitgestellt von betterplace.org.' }, misc: { skip: 'Zum Inhalt springen', menu: 'Menü', lang: 'Sprache', notFound: 'Diese Seite hat sich *verlaufen.*', home: 'Zur Startseite' } },
  en: { nav: { help: 'Help', about: 'About us', dogs: 'Looking for a home', projects: 'Projects', faq: 'FAQ' }, cta: { donate: 'Donate now', sponsor: 'Become a sponsor', meetDogs: 'Meet the dogs →', allDogs: 'See all dogs', allProjects: 'See all projects', toProject: 'To the project', readMore: 'Read more', moreStories: 'More stories', toDonate: 'To the donation page', backToDogs: 'See all dogs', backToProjects: 'All projects', backToArticles: 'All articles', mail: 'Write an e-mail' }, badge: { emergency: 'Urgent', reserved: 'Reserved', adopted: 'Adopted' }, filter: { label: 'Filter', all: 'All', emergency: 'Urgent', germany: 'Already in Germany', small: 'up to 45 cm', large: 'from 45 cm', empty: 'No dog matches this filter right now.' }, dog: { female: 'Female', male: 'Male', shelter: 'at the shelter', germany: 'in Germany', reserved: 'is already reserved — the home check is under way.', adopted: 'has been adopted and arrived safely.', interest: 'Interested in', external: 'Profile at our partner' }, story: { before: 'Before', after: 'After', found: 'has found a family.', year: 'Adopted' }, project: { ongoing: 'Ongoing project', shortTerm: 'Short-term project', donateFor: 'Donate to this project.' }, footer: { website: 'Website', help: 'Help', imprint: 'Imprint', privacy: 'Privacy', contact: 'Contact', section11: 'Permit under § 11 German Animal Welfare Act', pending: 'pending', granted: 'granted on', bank: 'Bank details' }, bp: { load: 'Load the donation form for {label}', title: 'Load donation form', open: 'open betterplace.org', note: 'Form provided by betterplace.org.' }, misc: { skip: 'Skip to content', menu: 'Menu', lang: 'Language', notFound: 'This page got *lost.*', home: 'Back to the start page' } },
} as const;

export type Ui = (typeof DICT)['de'];
export const ui = (locale: Locale): Ui => DICT[locale] as Ui;

export function emphasize(title: string): string {
  // *Wort* → <em>Wort</em> (nur für Titel; Fließtext geht durch @kompass/markdown)
  return title.replace(/[<>]/g, '').replace(/\*([^*]+)\*/g, '<em>$1</em>');
}
```

`apps/site/src/lib/routes.ts`:
```ts
import type { Locale } from './locale';

export type Kind = 'home' | 'help' | 'donate' | 'sponsor' | 'membership' | 'about' | 'team' | 'partners' | 'articles' | 'article' | 'faq' | 'contact' | 'imprint' | 'privacy' | 'statutes' | 'adoption-process' | 'dogs' | 'dog' | 'stories' | 'projects' | 'project';

export const ROUTES: Record<Kind, { de: string; en: string }> = {
  home: { de: '/', en: '/en/' },
  help: { de: '/helfen/', en: '/en/help/' },
  donate: { de: '/spenden/', en: '/en/donate/' },
  sponsor: { de: '/helfen/tierpate-werden/', en: '/en/sponsor/' },
  membership: { de: '/helfen/foerdermitglied-werden/', en: '/en/membership/' },
  about: { de: '/ueber-uns/', en: '/en/about/' },
  team: { de: '/ueber-uns/unser-team/', en: '/en/team/' },
  partners: { de: '/ueber-uns/unsere-partner/', en: '/en/partners/' },
  articles: { de: '/wissenswertes/', en: '/en/good-to-know/' },
  article: { de: '/wissenswertes/', en: '/en/good-to-know/' },
  faq: { de: '/faq/', en: '/en/faq/' },
  contact: { de: '/kontakt/', en: '/en/contact/' },
  imprint: { de: '/impressum/', en: '/en/imprint/' },
  privacy: { de: '/datenschutz/', en: '/en/privacy/' },
  statutes: { de: '/satzung/', en: '/en/statutes/' },
  'adoption-process': { de: '/ablauf-der-adoption/', en: '/en/adoption-process/' },
  dogs: { de: '/zuhause-gesucht/', en: '/en/looking-for-a-home/' },
  dog: { de: '/zuhause-gesucht/', en: '/en/looking-for-a-home/' },
  stories: { de: '/glueckliche-vermittlungen/', en: '/en/happy-endings/' },
  projects: { de: '/projekte/', en: '/en/projects/' },
  project: { de: '/projekte/', en: '/en/projects/' },
};

const WITH_SLUG: Kind[] = ['dog', 'project', 'article'];

export function pathFor(kind: Kind, locale: Locale, slug?: string): string {
  const base = ROUTES[kind][locale];
  return WITH_SLUG.includes(kind) && slug ? `${base}${slug}/` : base;
}

export function alternateFor(path: string): { locale: Locale; other: { locale: Locale; path: string } } {
  const locale: Locale = path === '/en/' || path.startsWith('/en/') ? 'en' : 'de';
  const other: Locale = locale === 'de' ? 'en' : 'de';
  for (const kind of Object.keys(ROUTES) as Kind[]) {
    const base = ROUTES[kind][locale];
    if (path === base && !WITH_SLUG.includes(kind)) return { locale, other: { locale: other, path: ROUTES[kind][other] } };
    if (WITH_SLUG.includes(kind) && path.startsWith(base) && path.length > base.length) {
      const slug = path.slice(base.length).replace(/\/$/, '');
      return { locale, other: { locale: other, path: `${ROUTES[kind][other]}${slug}/` } };
    }
  }
  return { locale, other: { locale: other, path: ROUTES.home[other] } };
}

/** Pfad → Astro-Param (ohne führenden/abschließenden Slash); '/' ⇒ undefined. */
export const paramFor = (path: string): string | undefined => (path === '/' ? undefined : path.replace(/^\/|\/$/g, ''));
```
Hinweis: `dog`/`dogs`, `project`/`projects`, `article`/`articles` teilen den Basis-Pfad; die Unterscheidung passiert über den Slug. `alternateFor` prüft Listen-Kinds vor Detail-Kinds, weil der exakte Vergleich zuerst kommt.

`apps/site/src/lib/content.ts`:
```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { L } from './locale';

export interface Asset { id: string; filename: string; mimeType: string; width: number | null; height: number | null }
export interface Facts { claim: L; forwardingPercent: number; shelterDogCount: number; donationBoxLocations: string[]; section11Status: 'pending' | 'granted'; section11Date: string; socialLinks: { label: string; href: string }[]; betterplaceMetaProjectId: string; betterplaceDefaultAmount: number; featuredAnimalSlug: string; featuredStorySlug: string; organization: Record<string, string> }
export interface Block { id: string; title: L; text: L; imageAssetId: string | null; href: string; label: L }
export interface Page { key: string; title: L; lede: L; body: L; metaDescription: L; blocks: Block[] }
export interface Article { slug: string; title: L; lede: L; body: L; publishedAt: string | null; sortOrder: number }
export interface TeamMember { name: string; position: L; photoAssetId: string | null; petPhotoAssetId: string | null; sortOrder: number }
export interface Faq { category: L; question: L; answer: L; sortOrder: number }
export interface Project { slug: string; name: L; type: 'ongoing' | 'shortTerm'; status: string; summary: L; body: L; imageAssetId: string | null; betterplaceProjectId: string; sortOrder: number }
export interface Download { key: string; title: L; assetId: string }
export interface Animal { slug: string; name: string; sex: 'female' | 'male'; birthText: L; sizeCm: number; sizeText: L; location: 'shelter' | 'germany'; status: 'lookingForHome' | 'reserved' | 'adopted'; isEmergency: boolean; isSponsorable: boolean; traits: { de: string[]; en: string[] }; externalProfileUrl: string; summary: L; body: L; photos: { assetId: string; sortOrder: number; isPrimary: boolean }[]; story: { beforeAssetId: string | null; afterAssetId: string | null; quote: L; family: string; adoptedYear: number } | null }
export interface SiteContent { facts: Facts[]; pages: Page[]; articles: Article[]; team: TeamMember[]; faqs: Faq[]; projects: Project[]; downloads: Download[]; animals?: Animal[]; assets: Asset[] }

export const CONTENT_DIR = process.env.SITE_CONTENT_DIR ?? path.resolve(process.cwd(), 'fixtures/example');
export const PUBLIC_URL = process.env.SITE_PUBLIC_URL ?? 'https://example.org';
export const IS_STAGING = process.env.SITE_STAGING === '1';

let cache: Promise<SiteContent> | null = null;
export function loadContent(): Promise<SiteContent> {
  cache ??= readFile(path.join(CONTENT_DIR, 'content.json'), 'utf8').then((raw) => JSON.parse(raw) as SiteContent);
  return cache;
}

export const factsOf = (c: SiteContent): Facts => c.facts[0]!;
export const pageOf = (c: SiteContent, key: string): Page => c.pages.find((p) => p.key === key) ?? { key, title: { de: '', en: '' }, lede: { de: '', en: '' }, body: { de: '', en: '' }, metaDescription: { de: '', en: '' }, blocks: [] };
export const animalsOf = (c: SiteContent): Animal[] => c.animals ?? [];
```

`apps/site/src/lib/images.ts`:
```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_DIR } from './content';

export interface ImageVariant { src: string; srcset: string; width: number; height: number }
let cache: Promise<Record<string, ImageVariant>> | null = null;
export function loadImages(): Promise<Record<string, ImageVariant>> {
  cache ??= readFile(path.join(CONTENT_DIR, 'images.json'), 'utf8').then((raw) => JSON.parse(raw) as Record<string, ImageVariant>).catch(() => ({}));
  return cache;
}
export function imageFor(images: Record<string, ImageVariant>, assetId: string | null | undefined): ImageVariant | null {
  return assetId ? (images[assetId] ?? null) : null;
}
```

- [ ] **Step 5: Layout, Komponenten, Catch-all-Seite**

`apps/site/src/layouts/Base.astro`:
```astro
---
import '../styles/global.css';
import { IS_STAGING, loadContent, factsOf, PUBLIC_URL } from '../lib/content';
import { pick, ui, type Locale } from '../lib/locale';
import { alternateFor, pathFor } from '../lib/routes';
const { title, description, locale = 'de' as Locale, active, hideAktuelles = false } = Astro.props as { title?: string; description?: string; locale?: Locale; active?: string; hideAktuelles?: boolean };
const content = await loadContent();
const facts = factsOf(content);
const org = facts.organization;
const t = ui(locale);
const current = Astro.url.pathname.endsWith('/') ? Astro.url.pathname : `${Astro.url.pathname}/`;
const alt = alternateFor(current);
const fullTitle = title ? `${title} · ${org.name}` : `${org.name} — ${pick(facts.claim, locale).value}`;
const desc = description ?? pick(facts.claim, locale).value;
const abs = (p: string) => new URL(p, PUBLIC_URL).href;
const nav = [['help', t.nav.help], ['about', t.nav.about], ['dogs', t.nav.dogs], ['projects', t.nav.projects], ['faq', t.nav.faq]] as const;
---
<!DOCTYPE html>
<html lang={locale}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{fullTitle}</title>
  <meta name="description" content={desc} />
  {IS_STAGING && <meta name="robots" content="noindex, nofollow" />}
  <link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32.png" />
  <link rel="apple-touch-icon" href="/images/favicon-180.png" />
  <link rel="canonical" href={abs(current)} />
  <link rel="alternate" hreflang={locale} href={abs(current)} />
  <link rel="alternate" hreflang={alt.other.locale} href={abs(alt.other.path)} />
  <link rel="alternate" hreflang="x-default" href={abs(locale === 'de' ? current : alt.other.path)} />
  <meta property="og:title" content={fullTitle} />
  <meta property="og:description" content={desc} />
  <meta property="og:type" content="website" />
</head>
<body>
  <a class="skip-link" href="#inhalt">{t.misc.skip}</a>
  <header class="site-header">
    <div class="header-wrap">
      <p class="brand"><a href={pathFor('home', locale)}><img src="/images/aluna-logo-kompakt.png" alt={org.name} width="220" height="72" /></a></p>
      <nav aria-label="Hauptmenü">
        <ul class="primary-nav">
          {nav.map(([kind, label]) => <li><a href={pathFor(kind, locale)} aria-current={active === kind ? 'page' : undefined}>{label}</a></li>)}
        </ul>
      </nav>
      <div class="header-actions">
        <div class="lang" role="group" aria-label={t.misc.lang}>
          <a class={locale === 'de' ? 'is-active' : ''} href={locale === 'de' ? current : alt.other.path} aria-current={locale === 'de' ? 'true' : undefined}>DE</a>
          <span class="lang-sep" aria-hidden="true">·</span>
          <a class={locale === 'en' ? 'is-active' : ''} href={locale === 'en' ? current : alt.other.path} aria-current={locale === 'en' ? 'true' : undefined}>EN</a>
        </div>
        <div class="header-cta">
          <a class="btn btn-ghost" href={pathFor('sponsor', locale)}>{t.cta.sponsor}</a>
          <a class="btn btn-primary" href={pathFor('donate', locale)}><span class="btn-label">{t.cta.donate}</span></a>
        </div>
        <details class="mobile-nav">
          <summary class="mobile-nav-toggle" aria-label={t.misc.menu}><span>{t.misc.menu}</span></summary>
          <div class="mobile-nav-panel">
            {nav.map(([kind, label]) => <a href={pathFor(kind, locale)}>{label}</a>)}
            <a class="mobile-nav-cta" href={pathFor('sponsor', locale)}>{t.cta.sponsor}</a>
            <a class="mobile-nav-cta" href={pathFor('donate', locale)}>{t.cta.donate}</a>
          </div>
        </details>
      </div>
    </div>
  </header>
  <main id="inhalt"><slot /></main>
  <footer class="site-footer">
    <div class="footer-main">
      <div class="wrap footer-grid">
        <div>
          <p class="footer-logo"><img src="/images/aluna-logo-kompakt.png" alt={org.name} width="290" height="96" /></p>
          <p class="footer-gemein">{locale === 'de' ? `${org.name} ist gemeinnützig und arbeitet nicht profitorientiert.` : `${org.name} is a registered non-profit and does not operate for profit.`}</p>
          <p class="footer-tsch">{t.footer.section11}: {facts.section11Status === 'granted' ? `${t.footer.granted} ${facts.section11Date}` : t.footer.pending}</p>
        </div>
        <div>
          <h3 class="footer-h">{t.footer.website}</h3>
          <ul class="footer-links">
            <li><a href={pathFor('about', locale)}>{t.nav.about}</a></li>
            <li><a href={pathFor('team', locale)}>Team</a></li>
            <li><a href={pathFor('partners', locale)}>Partner</a></li>
            <li><a href={pathFor('projects', locale)}>{t.nav.projects}</a></li>
            <li><a href={pathFor('dogs', locale)}>{t.nav.dogs}</a></li>
            <li><a href={pathFor('articles', locale)}>{locale === 'de' ? 'Wissenswertes' : 'Good to know'}</a></li>
            <li><a href={pathFor('faq', locale)}>FAQ</a></li>
          </ul>
        </div>
        <div>
          <h3 class="footer-h">{t.footer.help}</h3>
          <ul class="footer-links">
            <li><a href={pathFor('donate', locale)}>{t.cta.donate}</a></li>
            <li><a href={pathFor('sponsor', locale)}>{t.cta.sponsor}</a></li>
            <li><a href={pathFor('membership', locale)}>{locale === 'de' ? 'Fördermitglied werden' : 'Become a supporting member'}</a></li>
            <li><a href={pathFor('dogs', locale)}>{locale === 'de' ? 'Hund adoptieren' : 'Adopt a dog'}</a></li>
          </ul>
        </div>
        <div>
          <h3 class="footer-h">{t.footer.bank}</h3>
          <p class="footer-bank">{org.name}<br />IBAN {org.iban}<br />BIC {org.bic}<br />{org.bankName}</p>
          <ul class="footer-links footer-legal">
            <li><a href={pathFor('imprint', locale)}>{t.footer.imprint}</a></li>
            <li><a href={pathFor('privacy', locale)}>{t.footer.privacy}</a></li>
            <li><a href={pathFor('contact', locale)}>{t.footer.contact}</a></li>
          </ul>
          <div class="footer-social">{facts.socialLinks.map((s) => <a class="btn btn-ghost" href={s.href} rel="noopener">{s.label}</a>)}</div>
        </div>
      </div>
    </div>
  </footer>
</body>
</html>
```
Hinweis: Die Herz-SVGs des Prototyps bleiben als Inline-SVG in `global.css`-nahen Komponenten erhalten oder werden als `<svg>`-Snippet in `Base.astro` eingefügt — wohlgeformt (Astro 7). `hideAktuelles` bleibt als Prop, die „Bleib auf Schnauzenhöhe"-Sektion wird aus dem `home`-Seitentext-Baustein `social` gespeist (siehe Datenübernahme) und nur gerendert, wenn der Baustein existiert.

`apps/site/src/components/PageHeader.astro`:
```astro
---
import { emphasize } from '../lib/locale';
const { eyebrow, title, lede, narrow = false, fallback = null } = Astro.props as { eyebrow: string; title: string; lede?: string; narrow?: boolean; fallback?: 'de' | null };
---
<div class:list={['section-head', narrow && 'section-head-narrow']} data-fallback={fallback ?? undefined}>
  <p class="eyebrow"><span class="eyebrow-dot"></span>{eyebrow}</p>
  <h1 class="section-title" set:html={emphasize(title)}></h1>
  {lede && <p class="section-lede">{lede}</p>}
</div>
```

`apps/site/src/components/MarkdownBody.astro`:
```astro
---
import { renderMarkdown } from '@kompass/markdown';
const { markdown, fallback = null, class: cls = 'prose' } = Astro.props as { markdown: string; fallback?: 'de' | null; class?: string };
const html = await renderMarkdown(markdown ?? '');
---
{html && <div class={cls} data-fallback={fallback ?? undefined} set:html={html}></div>}
```

`apps/site/src/components/Blocks.astro`:
```astro
---
import type { Block } from '../lib/content';
import { loadImages, imageFor } from '../lib/images';
import { pick, type Locale } from '../lib/locale';
const { blocks, locale, cols = 2 } = Astro.props as { blocks: Block[]; locale: Locale; cols?: 2 | 3 | 4 };
const images = await loadImages();
---
{blocks.length > 0 && (
  <div class:list={['aluna-archive-grid', `cols-${cols}`]}>
    {blocks.map((b) => { const img = imageFor(images, b.imageAssetId); const title = pick(b.title, locale); const text = pick(b.text, locale); const label = pick(b.label, locale); return (
      <article class="option-card" data-block={b.id}>
        {img && <img src={img.src} srcset={img.srcset} sizes="(min-width: 900px) 480px, 100vw" alt={title.value} loading="lazy" width={img.width} height={img.height} />}
        <h3>{title.value}</h3>
        {text.value && <p data-fallback={text.fallback ?? undefined}>{text.value}</p>}
        {b.href && label.value && <a class="link link-arrow" href={b.href}>{label.value}</a>}
      </article>
    ); })}
  </div>
)}
```

`apps/site/src/components/TextPage.astro`:
```astro
---
import Base from '../layouts/Base.astro';
import type { Page } from '../lib/content';
import { pick, type Locale } from '../lib/locale';
import Blocks from './Blocks.astro';
import MarkdownBody from './MarkdownBody.astro';
import PageHeader from './PageHeader.astro';
const { page, locale, eyebrow, active, wide = false, blocksBefore = true } = Astro.props as { page: Page; locale: Locale; eyebrow: string; active?: string; wide?: boolean; blocksBefore?: boolean };
const title = pick(page.title, locale);
const lede = pick(page.lede, locale);
const body = pick(page.body, locale);
const meta = pick(page.metaDescription, locale);
---
<Base title={title.value.replace(/\*/g, '')} description={meta.value || lede.value} locale={locale} active={active}>
  <div class="aluna-page"><div class:list={['wrap', !wide && 'wrap-narrow']}>
    <PageHeader eyebrow={eyebrow} title={title.value} lede={lede.value} fallback={title.fallback} />
    <slot name="top" />
    {blocksBefore && <Blocks blocks={page.blocks} locale={locale} />}
    <MarkdownBody markdown={body.value} fallback={body.fallback} />
    {!blocksBefore && <Blocks blocks={page.blocks} locale={locale} />}
    <slot />
  </div></div>
</Base>
```

`apps/site/src/pages/[...path].astro` (Task 1: `home` und Textseiten; Task 3 ergänzt die übrigen Kinds):
```astro
---
import TextPage from '../components/TextPage.astro';
import HomePage from '../components/HomePage.astro';
import { loadContent, pageOf } from '../lib/content';
import { ui, type Locale } from '../lib/locale';
import { paramFor, pathFor, ROUTES, type Kind } from '../lib/routes';

export async function getStaticPaths() {
  const locales: Locale[] = ['de', 'en'];
  const textKinds: Kind[] = ['help', 'donate', 'sponsor', 'membership', 'about', 'partners', 'contact', 'imprint', 'privacy', 'statutes', 'adoption-process'];
  const paths: { params: { path: string | undefined }; props: { kind: Kind; locale: Locale; slug?: string } }[] = [];
  for (const locale of locales) {
    paths.push({ params: { path: paramFor(pathFor('home', locale)) }, props: { kind: 'home', locale } });
    for (const kind of textKinds) paths.push({ params: { path: paramFor(pathFor(kind, locale)) }, props: { kind, locale } });
  }
  return paths;
}

const { kind, locale } = Astro.props as { kind: Kind; locale: Locale; slug?: string };
const content = await loadContent();
const t = ui(locale);
const eyebrows: Record<string, string> = { help: t.nav.help, donate: t.cta.donate, sponsor: t.cta.sponsor, membership: locale === 'de' ? 'Fördermitglied werden' : 'Supporting membership', about: t.nav.about, partners: locale === 'de' ? 'Unsere Partner' : 'Our partners', contact: t.footer.contact, imprint: t.footer.imprint, privacy: t.footer.privacy, statutes: locale === 'de' ? 'Vereinssatzung' : 'Statutes', 'adoption-process': locale === 'de' ? 'Ablauf der Adoption' : 'Adoption process' };
const activeFor: Partial<Record<Kind, string>> = { help: 'help', donate: 'help', sponsor: 'help', membership: 'help', about: 'about', partners: 'about', faq: 'faq', contact: 'faq' };
---
{kind === 'home' ? <HomePage locale={locale} /> : <TextPage page={pageOf(content, kind)} locale={locale} eyebrow={eyebrows[kind] ?? ''} active={activeFor[kind]} wide={kind === 'help' || kind === 'donate'} />}
```
`HomePage.astro` (Task 1, Grundfassung): Hero mit `facts.claim` als Titel, `pages.home` Einleitung als Lede, Vertrauenszahlen aus `facts` (100 %, `forwardingPercent`, `shelterDogCount`, § 11), Bausteine der Startseite, Spendenaufruf mit Link; Projekte, Hund und Geschichte ergänzt Task 3.

`src/pages/404.astro`: Base mit `t.misc.notFound` und Knopf zur Startseite. `src/pages/robots.txt.ts`:
```ts
import { IS_STAGING, PUBLIC_URL } from '../lib/content';
export function GET() {
  const body = IS_STAGING ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nSitemap: ${new URL('/sitemap-index.xml', PUBLIC_URL).href}\n`;
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
```

- [ ] **Step 6: Tests ausführen**

Run: `pnpm --filter @kompass/site test && pnpm --filter @kompass/site typecheck`
Expected: `routes.test.ts` grün; `build.test.ts` grün für die in Task 1 eingegrenzte Pfadliste (Startseite, Helfen, Impressum in DE/EN, Sitemap, robots). Der Determinismus-Vergleich muss bereits jetzt bestehen.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(site): astro site scaffold with bilingual routing, layout, text pages and build test"
```

---

### Task 2: Bildvarianten im Webseiten-Modul

**Files:**
- Create: `packages/modules/website/src/pipeline/images.ts`, `packages/modules/website/scripts/make-fixture-images.ts`
- Modify: `packages/modules/website/package.json` (`sharp`), `src/index.ts`
- Test: `packages/modules/website/tests/images.test.ts`

**Interfaces:**
- Produces: `IMAGE_WIDTHS = [480, 960, 1600]`; `prepareImageVariants({ jobDir, assets, cacheDir }) → Promise<Record<string, ImageVariant>>` — erzeugt `jobDir/images/<hash>-<w>.webp` (WebP, Qualität 80, nie hochskaliert; für SVG: Datei unverändert kopiert, `srcset` leer), nutzt `cacheDir/<hash>-<w>.webp` als Cache (Hash = die 12 Hex-Zeichen aus dem Asset-Dateinamen), schreibt `jobDir/images.json`. `ImageVariant = { src: string; srcset: string; width: number; height: number }` (`src` = größte verfügbare Variante ≤ 960, Pfade relativ zur Site-Wurzel `/images/…`).

- [ ] **Step 1: Test schreiben**

`packages/modules/website/tests/images.test.ts`:
```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareImageVariants } from '../src/pipeline/images';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'kompass-img-')); dirs.push(d); return d; };

describe('prepareImageVariants', () => {
  it('creates capped webp variants, an images.json and reuses the cache', async () => {
    const job = tmp();
    const cache = tmp();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(path.join(job, 'assets'));
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#336699' } }).png().toBuffer();
    writeFileSync(path.join(job, 'assets', 'hund-abcdef123456.png'), png);
    const assets = [{ id: 'A1', filename: 'hund-abcdef123456.png', mimeType: 'image/png', width: 1200, height: 800 }];
    const first = await prepareImageVariants({ jobDir: job, assets, cacheDir: cache });
    expect(first.A1).toEqual({ src: '/images/abcdef123456-960.webp', srcset: '/images/abcdef123456-480.webp 480w, /images/abcdef123456-960.webp 960w, /images/abcdef123456-1200.webp 1200w', width: 960, height: 640 });
    expect(existsSync(path.join(job, 'images', 'abcdef123456-480.webp'))).toBe(true);
    expect(existsSync(path.join(job, 'images', 'abcdef123456-1600.webp'))).toBe(false); // nie hochskalieren
    expect(JSON.parse(readFileSync(path.join(job, 'images.json'), 'utf8')).A1.width).toBe(960);
    const cachedMtime = statSync(path.join(cache, 'abcdef123456-480.webp')).mtimeMs;
    const job2 = tmp();
    mkdirSync(path.join(job2, 'assets'));
    writeFileSync(path.join(job2, 'assets', 'hund-abcdef123456.png'), png);
    await prepareImageVariants({ jobDir: job2, assets, cacheDir: cache });
    expect(statSync(path.join(cache, 'abcdef123456-480.webp')).mtimeMs).toBe(cachedMtime);
    expect(readFileSync(path.join(job2, 'images', 'abcdef123456-480.webp')).equals(readFileSync(path.join(job, 'images', 'abcdef123456-480.webp')))).toBe(true);
  });

  it('copies svg unchanged and skips non-images', async () => {
    const job = tmp();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(path.join(job, 'assets'));
    writeFileSync(path.join(job, 'assets', 'logo-0123456789ab.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(path.join(job, 'assets', 'antrag-fedcba987654.pdf'), '%PDF-');
    const out = await prepareImageVariants({ jobDir: job, assets: [{ id: 'S', filename: 'logo-0123456789ab.svg', mimeType: 'image/svg+xml', width: null, height: null }, { id: 'P', filename: 'antrag-fedcba987654.pdf', mimeType: 'application/pdf', width: null, height: null }], cacheDir: tmp() });
    expect(out.S).toEqual({ src: '/images/0123456789ab.svg', srcset: '', width: 0, height: 0 });
    expect(out.P).toBeUndefined();
  });
});
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-website add sharp@^0.35.4 && pnpm --filter @kompass/module-website test tests/images.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementieren**

`packages/modules/website/src/pipeline/images.ts`:
```ts
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { ExportedAsset } from '../export';

export const IMAGE_WIDTHS = [480, 960, 1600] as const;
export interface ImageVariant { src: string; srcset: string; width: number; height: number }

const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp']);
const hashOf = (filename: string): string => /-([0-9a-f]{12})\.[a-z0-9]+$/i.exec(filename)?.[1] ?? filename.replace(/\.[^.]+$/, '');
const exists = (p: string) => stat(p).then(() => true, () => false);

export async function prepareImageVariants(opts: { jobDir: string; assets: ExportedAsset[]; cacheDir: string }): Promise<Record<string, ImageVariant>> {
  const outDir = path.join(opts.jobDir, 'images');
  await mkdir(outDir, { recursive: true });
  await mkdir(opts.cacheDir, { recursive: true });
  const result: Record<string, ImageVariant> = {};
  for (const asset of [...opts.assets].sort((a, b) => a.id.localeCompare(b.id))) {
    const source = path.join(opts.jobDir, 'assets', asset.filename);
    const hash = hashOf(asset.filename);
    if (asset.mimeType === 'image/svg+xml') {
      await copyFile(source, path.join(outDir, `${hash}.svg`));
      result[asset.id] = { src: `/images/${hash}.svg`, srcset: '', width: 0, height: 0 };
      continue;
    }
    if (!RASTER.has(asset.mimeType)) continue;
    const input = await readFile(source);
    const meta = await sharp(input).metadata();
    const originalWidth = meta.width ?? 0;
    const originalHeight = meta.height ?? 0;
    const widths = [...new Set([...IMAGE_WIDTHS.filter((w) => w < originalWidth), originalWidth])].sort((a, b) => a - b);
    const entries: { w: number; h: number; file: string }[] = [];
    for (const w of widths) {
      const file = `${hash}-${w}.webp`;
      const cached = path.join(opts.cacheDir, file);
      if (!(await exists(cached))) await sharp(input).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toFile(cached);
      await copyFile(cached, path.join(outDir, file));
      entries.push({ w, h: Math.round((originalHeight * w) / originalWidth), file });
    }
    const main = [...entries].reverse().find((e) => e.w <= 960) ?? entries[0]!;
    result[asset.id] = { src: `/images/${main.file}`, srcset: entries.map((e) => `/images/${e.file} ${e.w}w`).join(', '), width: main.w, height: main.h };
  }
  await writeFile(path.join(opts.jobDir, 'images.json'), JSON.stringify(result, null, 2));
  return result;
}
```
Hinweis zum Determinismus: sharp kodiert bei gleichem Input, gleichen Parametern und gleicher sharp/libvips-Version byte-identisch; der Cache liefert zusätzlich dieselben Bytes über Builds hinweg. `rotate()` ohne Argument wendet die EXIF-Orientierung an (Handyfotos) und entfernt die EXIF-Daten — auch ein Datenschutzgewinn (keine GPS-Daten auf der Website).

`packages/modules/website/scripts/make-fixture-images.ts`: kleines tsx-Skript, das `prepareImageVariants` gegen `apps/site/fixtures/example` ausführt (Job = Fixture-Ordner, Cache = temporär) und so `images.json` und `images/` für das Fixture erzeugt. `src/index.ts`: `export * from './pipeline/images';`.

- [ ] **Step 4: Tests ausführen und Fixture erzeugen**

Run: `pnpm --filter @kompass/module-website test && pnpm --filter @kompass/module-website exec tsx scripts/make-fixture-images.ts && pnpm --filter @kompass/site test`
Expected: grün; `apps/site/fixtures/example/images.json` existiert; Site-Build bleibt deterministisch.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(website): cached webp image variants for the site build"
```

---

### Task 3: Hunde, Geschichten, Projekte, Artikel, FAQ, Team, Startseite

**Files:**
- Create: `apps/site/src/components/DogCard.astro`, `DogPage.astro`, `DogList.astro`, `StoryList.astro`, `ProjectCard.astro`, `ProjectPage.astro`, `ProjectList.astro`, `ArticleList.astro`, `ArticlePage.astro`, `FaqPage.astro`, `TeamPage.astro`, `BetterplaceEmbed.astro`, `DownloadCard.astro`, `MailtoCard.astro`
- Modify: `src/pages/[...path].astro` (alle Kinds), `src/components/HomePage.astro` (Projekte, Hund, Geschichte, Spendenaufruf), `src/components/TextPage.astro`-Aufrufe für `donate`/`sponsor`/`membership`/`contact` mit Extras, `tests/build.test.ts` (vollständige Pfadliste)
- Test: `apps/site/tests/build.test.ts`, `apps/site/tests/html.test.ts`

**Interfaces:**
- Produces: alle Kinds der Routentabelle sind gebaut; `featuredAnimal(content)` und `featuredStory(content)` (Automatik: neuester Notfall, sonst zuletzt angelegter Hund; neueste Geschichte nach `adoptedYear`); Betterplace-2-Klick mit `projectId`, `defaultAmount`, `locale`; Mailto-Links mit vorbelegtem Betreff und Stichpunkten je Sprache.

- [ ] **Step 1: Tests erweitern**

`tests/build.test.ts`: die vollständige Pfadliste aus Task 1 aktivieren (alle Kinds in DE und EN, inklusive `zuhause-gesucht/chiara/`, `en/looking-for-a-home/chiara/`, `glueckliche-vermittlungen/`, `en/happy-endings/`, `projekte/grundversorgung/`, `wissenswertes/<slug>/`, `faq/`, `ueber-uns/unser-team/`, `ablauf-der-adoption/`).

`apps/site/tests/html.test.ts` (prüft gerenderte Inhalte im Build aus dem ersten Test; nutzt denselben `build`-Helfer, in `tests/helpers.ts` ausgelagert):
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { build } from './helpers';

describe('rendered html', () => {
  const dist = build({});
  const read = (p: string) => readFileSync(path.join(dist, p), 'utf8');

  it('dog list carries filter data and the emergency badge; detail has mailto with subject', () => {
    const list = read('zuhause-gesucht/index.html');
    expect(list).toContain('data-notfall="1"');
    expect(list).toContain('data-groesse="45"');
    expect(list).toContain('Notfall');
    const chiara = read('zuhause-gesucht/chiara/index.html');
    expect(chiara).toContain('href="mailto:info@example.org?subject=Interesse+an+Chiara');
    expect(chiara).toContain('hreflang="en" href="https://example.org/en/looking-for-a-home/chiara/"');
    const adopted = read('zuhause-gesucht/akiko/index.html');
    expect(adopted).not.toContain('mailto:info@example.org?subject=Interesse');
  });

  it('project page embeds betterplace lazily (no iframe before click) and marks fallback texts', () => {
    const p = read('projekte/grundversorgung/index.html');
    expect(p).toContain('data-bp-src="https://www.betterplace.org/de/projects/000001/donate?');
    expect(p).not.toContain('<iframe');
    const en = read('en/projects/grundversorgung/index.html');
    expect(en).toContain('data-fallback="de"');
    expect(en).toContain('betterplace.org/en/projects/000001');
  });

  it('home shows facts and the featured dog and story', () => {
    const home = read('index.html');
    expect(home).toContain('97,2');
    expect(home).toContain('150');
    expect(home).toContain('Bruno'); // Notfall zuerst
    expect(home).toContain('Akiko');
  });

  it('no external scripts or cookies anywhere', () => {
    const home = read('index.html');
    expect(home).not.toMatch(/<script[^>]+src="https?:\/\//);
    expect(home).not.toContain('document.cookie');
  });
});
```

- [ ] **Step 2: Tests ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/site test`
Expected: FAIL — Pfade fehlen.

- [ ] **Step 3: Komponenten**

`src/components/BetterplaceEmbed.astro` (aus dem Prototyp, Texte je Sprache):
```astro
---
import { ui, type Locale } from '../lib/locale';
const { projectId, defaultAmount = 50, locale, label } = Astro.props as { projectId: string; defaultAmount?: number; locale: Locale; label: string };
const t = ui(locale).bp;
const src = `https://www.betterplace.org/${locale}/projects/${projectId}/donate?donation_form_in_iframe=true&default_amount=${defaultAmount}`;
const external = `https://www.betterplace.org/${locale}/projects/${projectId}/donate?default_amount=${defaultAmount}`;
---
<div class="bp-embed" data-bp-src={src}>
  <div class="bp-consent">
    <h3>{t.title}</h3>
    <p>{locale === 'de' ? 'Das Spendenformular wird von betterplace.org bereitgestellt. Wenn du es lädst, baut dein Browser eine Verbindung zu Betterplace auf und es können Cookies gesetzt werden. Vorher passiert das nicht.' : 'The donation form is provided by betterplace.org. Only when you load it does your browser connect to Betterplace, which may set cookies. Nothing happens before.'}</p>
    <button type="button" class="btn btn-primary btn-lg" data-bp-load>{t.load.replace('{label}', label)}</button>
    <p class="bp-alt"><a class="link" href={external} rel="noopener">{t.open}</a></p>
  </div>
</div>
<script>
  document.querySelectorAll<HTMLElement>('.bp-embed').forEach((box) => {
    box.querySelector('[data-bp-load]')?.addEventListener('click', () => {
      const iframe = document.createElement('iframe');
      iframe.src = box.dataset.bpSrc ?? '';
      iframe.title = 'betterplace.org';
      iframe.loading = 'lazy';
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      box.replaceChildren(iframe);
    });
  });
</script>
```

`src/components/DogCard.astro`:
```astro
---
import type { Animal } from '../lib/content';
import { imageFor, type ImageVariant } from '../lib/images';
import { pick, ui, type Locale } from '../lib/locale';
import { pathFor } from '../lib/routes';
const { dog, locale, images } = Astro.props as { dog: Animal; locale: Locale; images: Record<string, ImageVariant> };
const t = ui(locale);
const primary = dog.photos.find((p) => p.isPrimary) ?? dog.photos[0];
const img = imageFor(images, primary?.assetId);
const badge = dog.isEmergency ? { cls: 'badge-notfall', txt: t.badge.emergency } : dog.status === 'reserved' ? { cls: 'badge-reserviert', txt: t.badge.reserved } : dog.status === 'adopted' ? { cls: 'badge-vermittelt', txt: t.badge.adopted } : null;
const summary = pick(dog.summary, locale);
---
<a class="dog-card" href={pathFor('dog', locale, dog.slug)} data-ort={dog.location} data-groesse={dog.sizeCm} data-status={dog.status} data-notfall={dog.isEmergency ? '1' : '0'}>
  <div class="dog-card-photo">
    {badge && <span class:list={['badge', badge.cls]}>{badge.txt}</span>}
    {img ? <img src={img.src} srcset={img.srcset} sizes="(min-width: 900px) 400px, 100vw" alt={`${dog.name} — ${summary.value}`} loading="lazy" width={img.width} height={img.height} /> : <img src="/images/placeholder-hund.png" alt={dog.name} loading="lazy" width="400" height="300" />}
  </div>
  <div class="dog-card-body">
    <span class="dog-card-name">{dog.name}</span>
    <span class="dog-card-facts">{dog.sex === 'female' ? t.dog.female : t.dog.male} · {pick(dog.sizeText, locale).value} · {dog.location === 'germany' ? t.dog.germany : t.dog.shelter}</span>
    <div class="dog-card-tags">{dog.traits[locale].map((w) => <span>{w}</span>)}</div>
  </div>
</a>
```

`src/components/DogList.astro` — Base + PageHeader (Seite `dogs` hat keinen eigenen Seitentext: Eyebrow/Titel/Lede kommen aus `pages` mit Key … es gibt keinen `dogs`-Seitenschlüssel; Titel und Lede der Listen-Seiten liegen in `ui()`: `t.lists.dogs = { title, lede }` (Dictionary in `locale.ts` um `lists: { dogs, stories, projects, articles, faq, team }` je Sprache ergänzen, Texte aus dem Prototyp). Rendert Filterchips (Alle, Notfälle, Schon in Deutschland, bis 45 cm, ab 45 cm) und das Grid aller Hunde mit Status ≠ `adopted`; das Filter-Skript aus dem Prototyp 1:1 (`data-*`-Attribute). Hinweis-Note mit Link auf `adoption-process`.

`src/components/DogPage.astro` — Detailseite: Hauptfoto groß, weitere Fotos als kleine Galerie, Name, Tags (Geschlecht, Geburtsangabe, Größe, Traits), Kurztext, Markdown-Beschreibung; Status-Block: `lookingForHome` ⇒ MailtoCard mit Betreff `Interesse an <Name>` (EN: `Interested in <Name>`) und Stichpunkt-Body; `reserved`/`adopted` ⇒ Hinweis-Note; externer Link, wenn `externalProfileUrl`; Verweise auf `adoption-process` und Artikel; „Alle Hunde ansehen".

`src/components/StoryList.astro` — für alle `adopted` mit `story`: Vorher/Nachher-Figuren (Bilder über `imageFor`), Titel `<Name> ${t.story.found}`, Zitat, Familie, Jahr; Note mit Link auf `dogs`.

`src/components/ProjectCard.astro`, `ProjectList.astro`, `ProjectPage.astro` — wie Prototyp; `ProjectPage` mit Bild (`imageFor`), Markdown-Body, `BetterplaceEmbed` mit `project.betterplaceProjectId`, Note, „Alle Projekte".

`src/components/ArticleList.astro`, `ArticlePage.astro` — Liste mit Titel, gekürzter Lede (180 Zeichen) und „Weiterlesen"; Detail mit Titel, Lede, `MarkdownBody`, „Alle Artikel".

`src/components/FaqPage.astro` — gruppiert nach `category` (DE-Wert als Gruppenschlüssel, Anzeige je Sprache), `<details>` je Frage.

`src/components/TeamPage.astro` — Raster mit Foto (`imageFor`), Name, Funktion; optional Haustierfoto darunter.

`src/components/DownloadCard.astro` — PDF-Karte wie im Prototyp (`pdf-card`): Titel, Erklärung (drei Schritte als Seitentext-Bausteine oder als `ui`-Texte), Buttons „PDF" (Link auf `/downloads/<key>.pdf`, siehe unten) und „Erst eine Frage stellen" (Mailto).

`src/components/MailtoCard.astro` — `mailto:` mit `subject` und optional `body` (URLSearchParams wie im Prototyp), Texte aus `ui`.

Downloads im Build: Der Export legt PDFs als Assets ab; die Site kopiert sie beim Build nach `dist/downloads/<key>.pdf` — dafür in `astro.config.mjs` eine kleine Integration `copyDownloads()` (Hook `astro:build:done`), die `content.downloads` liest und `assets/<filename>` nach `outDir/downloads/<key>.pdf` kopiert. Alternativ ein Endpoint `src/pages/downloads/[key].pdf.ts` mit `getStaticPaths` aus `content.downloads`, der die Datei als `Response` liefert — das ist ohne Integration möglich und wird hier gewählt.

Extras in `[...path].astro`: `donate` ⇒ Slot `top` mit `BetterplaceEmbed` (`facts.betterplaceMetaProjectId`, `facts.betterplaceDefaultAmount`) plus Bankverbindungs-Karte aus `facts.organization`; `sponsor` ⇒ `DownloadCard` für `sponsorship-form` plus Liste der Patentiere (`isSponsorable`, Status ≠ adopted) als Links; `membership` ⇒ `DownloadCard` für `membership-form`; `contact` ⇒ `MailtoCard`-Gruppe (Allgemein, Adoption, Spende, Presse) und Postanschrift aus `facts.organization`; `statutes` ⇒ Download-Button `statutes-pdf`, wenn vorhanden; `adoption-process` ⇒ reiner Textseiten-Renderer (die Schritte kommen als `:::karten` aus Kompass).

`getStaticPaths` erweitern: `dogs`, `stories`, `projects`, `articles`, `faq`, `team` je Sprache, `dog` je Hund (auch adoptierte, wie im Prototyp), `project` je Projekt, `article` je Artikel.

`HomePage.astro` vervollständigen: Projekte (erste zwei nach `sortOrder`), `featuredAnimal`, `featuredStory`, Spendenaufruf mit Wirkungskarten aus den `home`-Bausteinen (Baustein-IDs `impact-*`), „Bleib auf Schnauzenhöhe"-Sektion aus Baustein `social` und `facts.socialLinks`.

`src/lib/featured.ts`:
```ts
import type { Animal, Facts } from './content';

export function featuredAnimal(animals: Animal[], facts: Facts): Animal | null {
  const open = animals.filter((a) => a.status !== 'adopted');
  if (facts.featuredAnimalSlug !== 'auto') return open.find((a) => a.slug === facts.featuredAnimalSlug) ?? null;
  return open.find((a) => a.isEmergency) ?? open[open.length - 1] ?? null;
}

export function featuredStory(animals: Animal[], facts: Facts): Animal | null {
  const done = animals.filter((a) => a.status === 'adopted' && a.story);
  if (facts.featuredStorySlug !== 'auto') return done.find((a) => a.slug === facts.featuredStorySlug) ?? null;
  return [...done].sort((a, b) => (b.story!.adoptedYear - a.story!.adoptedYear))[0] ?? null;
}
```
(„zuletzt angelegter Hund" = letzter Eintrag der nach Name sortierten Sicht ist keine Anlagereihenfolge; die Sicht liefert alphabetisch. Für die Automatik genügt: Notfall zuerst, sonst der erste Hund der Liste — im Test `Bruno` als Notfall.)

- [ ] **Step 4: Tests ausführen**

Run: `pnpm --filter @kompass/site test && pnpm --filter @kompass/site typecheck`
Expected: grün; Build weiterhin deterministisch.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(site): dogs, stories, projects, articles, faq, team and full home page in both languages"
```

---

### Task 4: Pipeline im Modul — Build, Diff, Publish, Jobs

**Files:**
- Create: `packages/modules/website/src/pipeline/build.ts`, `pipeline/diff.ts`, `pipeline/publish.ts`, `pipeline/jobs.ts`, `pipeline/env.ts`
- Modify: `packages/modules/website/src/schema.ts` (`websitePublishes.fileManifest`), `src/services/publishes.ts` (`recordPublish`), `src/index.ts`
- Generated: `packages/core/src/db/migrations/0005_website_publish_manifest.sql`
- Test: `packages/modules/website/tests/pipeline.test.ts`

**Interfaces:**
- Produces:
  - `readSiteEnv(env = process.env) → { publicUrl: string | null; staging: boolean; deploy: { host; user; path; keyFile } | null; siteDir: string; cacheDir: string; previewDir: string }` — `SITE_PUBLIC_URL`, `SITE_STAGING`, `SITE_DEPLOY_HOST|USER|PATH|KEY_FILE`, `SITE_DIR` (Default `apps/site` relativ zum Repo bzw. `/app/apps/site` im Container), `SITE_CACHE_DIR` (Default `<DATA>/site-cache`), `SITE_PREVIEW_DIR` (Default `<DATA>/site-preview`).
  - `buildSite({ siteDir, contentDir, outDir, publicUrl, staging, timeoutMs }) → Promise<{ log: string }>` — `astro build --outDir` als Kindprozess (`pnpm exec astro build` bzw. `node <siteDir>/node_modules/astro/astro.js build`), wirft `SiteBuildError` mit Log.
  - `hashTree(dir) → Promise<Record<string, string>>` (relativer Pfad → sha256), `diffTrees(previous, current) → { changed: string[]; added: string[]; removed: string[] }`.
  - `rsyncPublish({ distDir, deploy, dryRun }) → Promise<{ log: string }>` — `rsync -az --delete --checksum -e "ssh -i <key> -o StrictHostKeyChecking=accept-new" <dist>/ user@host:<path>/`.
  - `runPreview(deps, ctx, env) → Result<PreviewResult>` mit `{ contentHash; gaps; violations; diff; previewDir; log }` (Export → Bilder → Build in `previewDir` → Diff gegen letzten erfolgreichen Publish dieser Umgebung).
  - `runPublish(deps, ctx, env, { confirm: boolean }) → Result<PublishResult>` — verlangt `website.publish`, `deploy` konfiguriert, `env !== development`, keine Sperrworttreffer; baut frisch, rsync, `recordPublish` mit `fileManifest`, Audit `website.publish`; bei Fehlern `recordPublish` mit `status: 'failed'`.
  - `recordPublish(deps, ctx, { environment, status, contentHash, diff, fileManifest, log, summary })`; `lastSuccessfulPublish(deps, environment)`.

- [ ] **Step 1: Test schreiben**

`packages/modules/website/tests/pipeline.test.ts`:
```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { diffTrees, hashTree, readSiteEnv, runPreview, runPublish, websiteModule } from '../src';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'kompass-pipe-')); dirs.push(d); return d; };
const SITE_DIR = path.resolve(import.meta.dirname, '../../../../apps/site');

describe('diff', () => {
  it('hashes trees and reports changed, added and removed files', async () => {
    const a = tmp();
    mkdirSync(path.join(a, 'sub'));
    writeFileSync(path.join(a, 'index.html'), 'a');
    writeFileSync(path.join(a, 'sub', 'x.html'), 'x');
    const before = await hashTree(a);
    writeFileSync(path.join(a, 'index.html'), 'b');
    writeFileSync(path.join(a, 'new.html'), 'n');
    rmSync(path.join(a, 'sub', 'x.html'));
    const after = await hashTree(a);
    expect(diffTrees(before, after)).toEqual({ changed: ['index.html'], added: ['new.html'], removed: ['sub/x.html'] });
  });
});

describe('readSiteEnv', () => {
  it('reports no deploy target when variables are missing and parses them when present', () => {
    expect(readSiteEnv({ DATABASE_PATH: '/data/k.db' }).deploy).toBeNull();
    const env = readSiteEnv({ DATABASE_PATH: '/data/k.db', SITE_PUBLIC_URL: 'https://staging.example.org', SITE_STAGING: '1', SITE_DEPLOY_HOST: 'h', SITE_DEPLOY_USER: 'u', SITE_DEPLOY_PATH: '/web/staging', SITE_DEPLOY_KEY_FILE: '/data/site.key' });
    expect(env).toMatchObject({ publicUrl: 'https://staging.example.org', staging: true, deploy: { host: 'h', user: 'u', path: '/web/staging', keyFile: '/data/site.key' }, cacheDir: '/data/site-cache', previewDir: '/data/site-preview' });
  });
});

describe('preview and publish', () => {
  it('builds a preview from live content, computes the diff against nothing, and publishes to a local rsync target', async () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['website.publish', 'website.view', 'website.manage']);
    const target = tmp();
    const env = { publicUrl: 'https://staging.example.org', staging: true, deploy: { host: '', user: '', path: target, keyFile: '' }, siteDir: SITE_DIR, cacheDir: tmp(), previewDir: tmp() };
    const preview = unwrap(await runPreview(deps, ctx, env));
    expect(preview.violations).toEqual([]);
    expect(preview.diff.added.length).toBeGreaterThan(10);
    expect(readFileSync(path.join(preview.previewDir, 'index.html'), 'utf8')).toContain('noindex');

    const published = unwrap(await runPublish(deps, ctx, env, { confirm: true }));
    expect(published.status).toBe('success');
    expect(readFileSync(path.join(target, 'index.html'), 'utf8')).toContain('<html');
    const again = unwrap(await runPreview(deps, ctx, env));
    expect(again.diff).toEqual({ changed: [], added: [], removed: [] });
  }, 240_000);

  it('refuses to publish without confirmation, without a target, in development, or with blocked terms', async () => {
    const deps = createTestDeps({ manifests: [coreModule, websiteModule] });
    insertUser(deps, { id: 'USER-TEST' });
    const ctx = ctxWith(['website.publish', 'website.view']);
    const base = { publicUrl: 'https://x', staging: true, deploy: { host: '', user: '', path: tmp(), keyFile: '' }, siteDir: SITE_DIR, cacheDir: tmp(), previewDir: tmp() };
    const noConfirm = await runPublish(deps, ctx, base, { confirm: false });
    expect(noConfirm.ok === false && noConfirm.error.type === 'validation').toBe(true);
    const noTarget = await runPublish(deps, ctx, { ...base, deploy: null }, { confirm: true });
    expect(noTarget.ok === false && noTarget.error.type === 'conflict' && noTarget.error.code === 'publishTargetMissing').toBe(true);
    const dev = createTestDeps({ manifests: [coreModule, websiteModule], env: 'development' });
    insertUser(dev, { id: 'USER-TEST' });
    const inDev = await runPublish(dev, ctx, base, { confirm: true });
    expect(inDev.ok === false && inDev.error.type === 'conflict' && inDev.error.code === 'publishNotAllowedHere').toBe(true);
  });
});
```
Hinweis: Mit leerem `host` publiziert `rsyncPublish` in einen **lokalen Pfad** (kein SSH) — genau so laufen die Tests und die E2E-Suite; im Betrieb ist `host` gesetzt. Der Preview/Publish-Test baut Astro zweimal und dauert entsprechend.

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-website test tests/pipeline.test.ts`
Expected: FAIL.

- [ ] **Step 3: Schema und Historie**

`schema.ts`: `websitePublishes` um `fileManifest: text('file_manifest').notNull().default('{}')` ergänzen. Run: `pnpm --filter @kompass/core db:generate --name website_publish_manifest` ⇒ `0005_…sql`.

`services/publishes.ts` ergänzen:
```ts
export interface PublishDiff { changed: string[]; added: string[]; removed: string[] }

export function lastSuccessfulPublish(deps: Deps, environment: string): PublishRecord | null {
  return deps.db.select().from(websitePublishes).where(and(eq(websitePublishes.environment, environment), eq(websitePublishes.status, 'success'))).orderBy(desc(websitePublishes.startedAt)).get() ?? null;
}

export function recordPublish(deps: Deps, ctx: CallContext, input: { environment: string; startedAt: string; status: 'success' | 'failed' | 'aborted'; contentHash: string; diff: PublishDiff; fileManifest: Record<string, string>; log: string; summary: string }): PublishRecord {
  return deps.db.transaction((tx) => {
    const id = newId();
    tx.insert(websitePublishes).values({ id, environment: input.environment, startedAt: input.startedAt, finishedAt: isoNow(deps.clock), status: input.status, contentHash: input.contentHash, pagesChanged: input.diff.changed.length, pagesAdded: input.diff.added.length, pagesRemoved: input.diff.removed.length, summary: input.summary, triggeredByUserId: ctx.userId, log: input.log.slice(-20_000), fileManifest: JSON.stringify(input.fileManifest) }).run();
    recordAudit(tx, deps, ctx, { action: 'website.publish', entityType: 'websitePublish', entityId: id, after: { environment: input.environment, status: input.status, contentHash: input.contentHash, changed: input.diff.changed.length, added: input.diff.added.length, removed: input.diff.removed.length }, summary: input.summary });
    return tx.select().from(websitePublishes).where(eq(websitePublishes.id, id)).get()!;
  });
}
```
(Importe `and, desc, eq`, `newId`, `isoNow`, `recordAudit` ergänzen.)

- [ ] **Step 4: Env, Build, Diff, Publish**

`pipeline/env.ts`:
```ts
import path from 'node:path';

export interface DeployTarget { host: string; user: string; path: string; keyFile: string }
export interface SiteEnv { publicUrl: string | null; staging: boolean; deploy: DeployTarget | null; siteDir: string; cacheDir: string; previewDir: string }

export function readSiteEnv(env: Record<string, string | undefined> = process.env): SiteEnv {
  const dataDir = path.dirname(env.DATABASE_PATH ?? './data/kompass.db');
  const deploy = env.SITE_DEPLOY_HOST !== undefined && env.SITE_DEPLOY_USER !== undefined && env.SITE_DEPLOY_PATH && env.SITE_DEPLOY_KEY_FILE !== undefined
    ? { host: env.SITE_DEPLOY_HOST, user: env.SITE_DEPLOY_USER, path: env.SITE_DEPLOY_PATH, keyFile: env.SITE_DEPLOY_KEY_FILE }
    : null;
  return {
    publicUrl: env.SITE_PUBLIC_URL ?? null,
    staging: env.SITE_STAGING === '1',
    deploy,
    siteDir: env.SITE_DIR ?? path.resolve(process.cwd(), '../../apps/site'),
    cacheDir: env.SITE_CACHE_DIR ?? path.join(dataDir, 'site-cache'),
    previewDir: env.SITE_PREVIEW_DIR ?? path.join(dataDir, 'site-preview'),
  };
}
```

`pipeline/build.ts`:
```ts
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export class SiteBuildError extends Error {
  constructor(message: string, public readonly log: string) { super(message); this.name = 'SiteBuildError'; }
}

export async function buildSite(opts: { siteDir: string; contentDir: string; outDir: string; publicUrl: string; staging: boolean; timeoutMs?: number }): Promise<{ log: string }> {
  const astroBin = path.join(opts.siteDir, 'node_modules', 'astro', 'astro.js');
  await access(astroBin).catch(() => { throw new SiteBuildError(`astro not installed in ${opts.siteDir}`, ''); });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [astroBin, 'build', '--outDir', opts.outDir], {
      cwd: opts.siteDir,
      env: { ...process.env, SITE_CONTENT_DIR: opts.contentDir, SITE_PUBLIC_URL: opts.publicUrl, SITE_STAGING: opts.staging ? '1' : '0', NODE_ENV: 'production', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new SiteBuildError('site build timed out', log)); }, opts.timeoutMs ?? 300_000);
    child.stdout.on('data', (c: Buffer) => { log += c.toString('utf8'); });
    child.stderr.on('data', (c: Buffer) => { log += c.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); reject(new SiteBuildError(e.message, log)); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve({ log }) : reject(new SiteBuildError(`astro build exited with ${code}`, log)); });
  });
}
```

`pipeline/diff.ts`:
```ts
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export async function hashTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    for (const name of (await readdir(current)).sort()) {
      const full = path.join(current, name);
      if ((await stat(full)).isDirectory()) await walk(full);
      else out[path.relative(dir, full).split(path.sep).join('/')] = createHash('sha256').update(await readFile(full)).digest('hex');
    }
  }
  await walk(dir);
  return out;
}

export function diffTrees(previous: Record<string, string>, current: Record<string, string>) {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [file, hash] of Object.entries(current)) {
    if (!(file in previous)) added.push(file);
    else if (previous[file] !== hash) changed.push(file);
  }
  for (const file of Object.keys(previous)) if (!(file in current)) removed.push(file);
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}
```

`pipeline/publish.ts`:
```ts
import { spawn } from 'node:child_process';
import type { DeployTarget } from './env';

export async function rsyncPublish(opts: { distDir: string; deploy: DeployTarget; dryRun?: boolean }): Promise<{ log: string }> {
  const remote = opts.deploy.host ? `${opts.deploy.user}@${opts.deploy.host}:${opts.deploy.path.replace(/\/?$/, '/')}` : opts.deploy.path.replace(/\/?$/, '/');
  const args = ['-az', '--delete', '--checksum', ...(opts.dryRun ? ['--dry-run'] : []), ...(opts.deploy.host ? ['-e', `ssh -i ${opts.deploy.keyFile} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`] : []), `${opts.distDir.replace(/\/?$/, '/')}`, remote];
  return new Promise((resolve, reject) => {
    const child = spawn('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = `rsync ${args.join(' ')}\n`;
    child.stdout.on('data', (c: Buffer) => { log += c.toString('utf8'); });
    child.stderr.on('data', (c: Buffer) => { log += c.toString('utf8'); });
    child.on('error', (e) => reject(new Error(`rsync failed to start: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve({ log }) : reject(new Error(`rsync exited with ${code}\n${log}`))));
  });
}
```
Hinweis: Ohne `host` synchronisiert rsync lokal (Tests, E2E). `--delete` entfernt entfallene Seiten auf dem Ziel; `--checksum` vergleicht Inhalte statt Zeitstempel, damit deterministische Builds nichts unnötig übertragen.

`pipeline/jobs.ts`:
```ts
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { conflict, invalid, isoNow, ok, requirePermission, type CallContext, type Deps, type Result } from '@kompass/core';
import { exportSiteContent, type SiteExport } from '../export';
import { lastSuccessfulPublish, recordPublish, type PublishDiff, type PublishRecord } from '../services/publishes';
import { buildSite, SiteBuildError } from './build';
import { diffTrees, hashTree } from './diff';
import type { SiteEnv } from './env';
import { prepareImageVariants } from './images';
import { rsyncPublish } from './publish';

export interface PreviewResult { contentHash: string; gaps: SiteExport['gaps']; violations: SiteExport['violations']; diff: PublishDiff; previewDir: string; log: string }
export interface PublishResult { status: 'success'; record: PublishRecord; diff: PublishDiff; log: string }

async function exportAndBuild(deps: Deps, ctx: CallContext, env: SiteEnv, outDir: string): Promise<Result<{ exported: SiteExport; log: string; manifest: Record<string, string>; diff: PublishDiff }>> {
  if (!env.publicUrl) return conflict('publicUrlMissing', 'SITE_PUBLIC_URL ist nicht gesetzt');
  const job = await mkdtemp(path.join(tmpdir(), 'kompass-site-'));
  try {
    const exported = await exportSiteContent(deps, ctx, { jobDir: job });
    if (!exported.ok) return exported;
    await prepareImageVariants({ jobDir: job, assets: exported.value.assets, cacheDir: env.cacheDir });
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    const { log } = await buildSite({ siteDir: env.siteDir, contentDir: job, outDir, publicUrl: env.publicUrl, staging: env.staging });
    // Bildvarianten und Downloads liegen im Job-Verzeichnis; die Site kopiert /images beim Build nicht selbst → hier nachziehen
    await cp(path.join(job, 'images'), path.join(outDir, 'images'), { recursive: true });
    const manifest = await hashTree(outDir);
    const last = lastSuccessfulPublish(deps, deps.env);
    const previous = last ? (JSON.parse(last.fileManifest) as Record<string, string>) : {};
    return ok({ exported: exported.value, log, manifest, diff: diffTrees(previous, manifest) });
  } catch (error) {
    if (error instanceof SiteBuildError) return conflict('siteBuildFailed', error.log.slice(-4000) || error.message);
    throw error;
  } finally {
    await rm(job, { recursive: true, force: true });
  }
}

export async function runPreview(deps: Deps, ctx: CallContext, env: SiteEnv): Promise<Result<PreviewResult>> {
  const denied = requirePermission(ctx, 'website.publish');
  if (denied) return denied;
  const built = await exportAndBuild(deps, ctx, env, env.previewDir);
  if (!built.ok) return built;
  return ok({ contentHash: built.value.exported.contentHash, gaps: built.value.exported.gaps, violations: built.value.exported.violations, diff: built.value.diff, previewDir: env.previewDir, log: built.value.log });
}

export async function runPublish(deps: Deps, ctx: CallContext, env: SiteEnv, opts: { confirm: boolean }): Promise<Result<PublishResult>> {
  const denied = requirePermission(ctx, 'website.publish');
  if (denied) return denied;
  if (!opts.confirm) return invalid([{ path: 'confirm', message: 'confirmationRequired' }]);
  if (deps.env === 'development') return conflict('publishNotAllowedHere', 'Aus der Entwicklungsumgebung wird nicht publiziert');
  if (!env.deploy) return conflict('publishTargetMissing', 'SITE_DEPLOY_* ist nicht gesetzt');
  const startedAt = isoNow(deps.clock);
  const outDir = await mkdtemp(path.join(tmpdir(), 'kompass-publish-'));
  try {
    const built = await exportAndBuild(deps, ctx, env, outDir);
    if (!built.ok) return built;
    if (built.value.exported.violations.length > 0) {
      recordPublish(deps, ctx, { environment: deps.env, startedAt, status: 'aborted', contentHash: built.value.exported.contentHash, diff: built.value.diff, fileManifest: {}, log: JSON.stringify(built.value.exported.violations), summary: 'Publish abgebrochen: Sperrworttreffer' });
      return conflict('blockedTermsPresent', `${built.value.exported.violations.length} Sperrworttreffer`);
    }
    try {
      const { log } = await rsyncPublish({ distDir: outDir, deploy: env.deploy });
      const record = recordPublish(deps, ctx, { environment: deps.env, startedAt, status: 'success', contentHash: built.value.exported.contentHash, diff: built.value.diff, fileManifest: built.value.manifest, log: built.value.log + log, summary: `Publiziert: ${built.value.diff.changed.length} geändert, ${built.value.diff.added.length} neu, ${built.value.diff.removed.length} entfernt` });
      return ok({ status: 'success', record, diff: built.value.diff, log });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordPublish(deps, ctx, { environment: deps.env, startedAt, status: 'failed', contentHash: built.value.exported.contentHash, diff: built.value.diff, fileManifest: {}, log: message, summary: 'Publish fehlgeschlagen' });
      return conflict('publishFailed', message.slice(0, 2000));
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
```
Hinweis: Weil `runPreview` und `runPublish` beide bauen, ist ein Publish nie „der Vorschau-Build von vorhin", sondern immer frisch aus dem aktuellen Stand — genau das ist die Spec-Regel „Vorschau = echter Build, kein Entwurfsstand". `src/index.ts`: `export * from './pipeline/env'; …/build; …/diff; …/publish; …/jobs;`.

- [ ] **Step 5: Tests ausführen**

Run: `pnpm --filter @kompass/module-website test && pnpm --filter @kompass/module-website typecheck`
Expected: grün (der Pipeline-Test benötigt `rsync` lokal; auf macOS vorhanden).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(website): build, diff and publish pipeline with audited publish history"
```

---

### Task 5: Publizieren-Seite vervollständigen und Vorschau ausliefern

**Files:**
- Create: `apps/kompass/src/lib/site-env.ts`, `apps/kompass/src/app/website/preview/[[...path]]/route.ts`, `src/app/(shell)/website/publish/preview-card.tsx`, `diff-card.tsx`, `publish-card.tsx`, `history.tsx`
- Modify: `src/app/(shell)/website/publish/page.tsx`, `actions.ts`, `apps/kompass/proxy.ts` (`/website/preview` bleibt hinter Login), `apps/kompass/playwright.config.ts` (SITE_*-Variablen), `apps/kompass/next.config.ts` (`serverExternalPackages` + `sharp`), `messages/de.json`
- Test: `e2e/website-publish.spec.ts` (erweitert)

**Interfaces:**
- Produces: `runPreviewAction() → ActionState` (`data = PreviewResult` ohne `log`), `runPublishAction(confirm: boolean) → ActionState`; Route `GET /website/preview/[[...path]]` liefert Dateien aus `previewDir` (Verzeichnis ⇒ `index.html`; nur angemeldet; `Cache-Control: no-store`; Content-Type nach Endung); die Publizieren-Seite zeigt Stand, Prüfen, Vorschau bauen (mit Link „Vorschau öffnen"), Änderungsliste, Publish-Knopf mit Bestätigung und Historie.

- [ ] **Step 1: E2E-Test erweitern**

An `e2e/website-publish.spec.ts` anhängen:
```ts
test('preview build, diff and publish to the local staging target', async ({ page, request }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/animals/new');
  await page.getByLabel('Slug (URL-Teil)').fill('luna');
  await page.getByLabel('Name').fill('Luna');
  await page.getByLabel('Geschlecht').selectOption('female');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.getByRole('switch', { name: 'Veröffentlicht' }).click();

  await page.goto('/website/publish');
  await page.getByRole('button', { name: 'Vorschau bauen' }).click();
  await expect(page.getByRole('region', { name: 'Änderungen gegenüber Live' })).toContainText('zuhause-gesucht/luna/index.html', { timeout: 180_000 });
  const preview = await request.get('/website/preview/zuhause-gesucht/luna/');
  expect(preview.ok()).toBe(true);
  expect(await preview.text()).toContain('Luna');
  await page.getByRole('link', { name: 'Vorschau öffnen' }).click();
  await expect(page.getByTestId('env-banner')).toBeVisible();

  await page.goto('/website/publish');
  await page.getByRole('button', { name: 'Nach Staging publizieren' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Jetzt publizieren' }).click();
  await expect(page.getByRole('status')).toContainText('Publiziert', { timeout: 180_000 });
  await expect(page.getByRole('table', { name: 'Publish-Historie' }).getByRole('row').nth(1)).toContainText('success');
  const fs = await import('node:fs');
  expect(fs.existsSync(path.join(process.env.E2E_SITE_TARGET!, 'zuhause-gesucht', 'luna', 'index.html'))).toBe(true);
});
```
(`import path from 'node:path'` ergänzen. `playwright.config.ts` setzt für den Dev-Server `SITE_PUBLIC_URL: 'https://staging.example.org'`, `SITE_STAGING: '1'`, `SITE_DEPLOY_HOST: ''`, `SITE_DEPLOY_USER: ''`, `SITE_DEPLOY_PATH: <e2e/.tmp/site-target>`, `SITE_DEPLOY_KEY_FILE: ''`, `SITE_DIR: <repo>/apps/site`, `SITE_CACHE_DIR`, `SITE_PREVIEW_DIR` unter `e2e/.tmp`, und exportiert `E2E_SITE_TARGET` für den Test-Prozess über `process.env` vor `defineConfig`.)

- [ ] **Step 2: E2E ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/app e2e e2e/website-publish.spec.ts`
Expected: FAIL beim neuen Test.

- [ ] **Step 3: Env, Actions, Vorschau-Route**

`src/lib/site-env.ts`:
```ts
import { readSiteEnv, type SiteEnv } from '@kompass/module-website';
export const siteEnv = (): SiteEnv => readSiteEnv();
```

`src/app/(shell)/website/publish/actions.ts` ergänzen:
```ts
import { runPreview, runPublish } from '@kompass/module-website';
import { revalidatePath } from 'next/cache';
import { siteEnv } from '@/lib/site-env';

export async function runPreviewAction(): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await runPreview(deps, ctx, siteEnv());
  if (!result.ok) return toActionState(result, t);
  const { log: _log, ...data } = result.value;
  return { status: 'success', data };
}

export async function runPublishAction(confirm: boolean): Promise<ActionState> {
  const t = await getTranslations();
  const { deps, ctx } = await requireSession();
  const result = await runPublish(deps, ctx, siteEnv(), { confirm });
  revalidatePath('/website/publish');
  if (!result.ok) return toActionState(result, t);
  return { status: 'success', message: t('website.publish.done', { changed: result.value.diff.changed.length, added: result.value.diff.added.length, removed: result.value.diff.removed.length }), data: result.value.diff };
}
```
`fieldMessage`/Konflikte in `src/lib/actions.ts` um `publicUrlMissing`, `publishTargetMissing`, `publishNotAllowedHere`, `blockedTermsPresent`, `siteBuildFailed`, `publishFailed` erweitern (`errors.conflict.*` in `de.json`; `siteBuildFailed` und `publishFailed` mit `{detail}`).

`src/app/website/preview/[[...path]]/route.ts`:
```ts
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { optionalSession } from '@/lib/request-context';
import { siteEnv } from '@/lib/site-env';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };

export async function GET(_request: Request, ctx: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const { path: parts = [] } = await ctx.params;
  const root = path.resolve(siteEnv().previewDir);
  let target = path.resolve(root, ...parts);
  if (!target.startsWith(root)) return new Response(null, { status: 404 });
  const info = await stat(target).catch(() => null);
  if (!info) return new Response(null, { status: 404 });
  if (info.isDirectory()) target = path.join(target, 'index.html');
  const bytes = await readFile(target).catch(() => null);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(bytes, { headers: { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' } });
}
```
Damit die Vorschau innerhalb von Kompass unter dem Umgebungsbalken erscheint, rendert `/website/preview/` **nicht** die Shell; stattdessen öffnet der Link „Vorschau öffnen" die Vorschau in einem Frame: Seite `src/app/(shell)/website/preview-frame/page.tsx` mit `<iframe src="/website/preview/" title="Vorschau" class="h-[80vh] w-full rounded-md border border-line">` unter der Shell (der Balken bleibt sichtbar). Die absoluten Links der Vorschau zeigen auf `/…`; die Route leitet `/website/preview/` mit `<base href="/website/preview/">` ein — dafür ersetzt die Route in HTML-Antworten `<head>` durch `<head><base href="/website/preview/">`, damit relative Navigation innerhalb der Vorschau bleibt (Site-Links sind absolut, daher zusätzlich `href="/` → `href="/website/preview/` in HTML ersetzen; beides nur in der Vorschau-Route, nie im Build).

- [ ] **Step 4: Karten und Seite**

`preview-card.tsx`: Knopf „Vorschau bauen" (Ladezustand „Build läuft …", `aria-busy`), nach Erfolg: Inhalts-Hash, Sperrworttreffer und Lücken wie `CheckCard` (Wiederverwendung: `CheckCard` nimmt optional ein fertiges `Check`-Objekt), Link „Vorschau öffnen" → `/website/preview-frame`, und die Änderungsliste an `DiffCard` weiterreichen.

`diff-card.tsx`: `<section aria-label="Änderungen gegenüber Live">` mit drei Gruppen (geändert/neu/entfernt) als Listen der Pfade, Zähler im Titel; leerer Zustand „Keine Änderungen gegenüber dem letzten Publish".

`publish-card.tsx`: Knopf „Nach Staging publizieren" (`test`) bzw. „Live publizieren" (`production`), deaktiviert, wenn kein Ziel konfiguriert (`deploy === null` ⇒ Hinweis „Kein Publish-Ziel konfiguriert"), wenn `development`, oder wenn der letzte Vorschau-Lauf Sperrworttreffer hatte. Bestätigungsdialog (`role="alertdialog"`) mit Ziel-URL, Zusammenfassung des Diffs und Knopf „Jetzt publizieren"; während des Publish Schrittliste ohne Abbrechen („Bauen", „Übertragen", „Protokollieren"). Erfolg als Toast mit `website.publish.done`.

`history.tsx`: Tabelle `aria-label="Publish-Historie"` mit Zeitpunkt, Status, Hash (12 Zeichen), geändert/neu/entfernt, Auslöser; Klick öffnet Seitenleiste mit dem Log (`<pre>`).

`page.tsx`: Kopf mit Ziel (`siteEnv().publicUrl`, Staging-Kennzeichen), Stand (letzter erfolgreicher Publish), dann `PreviewCard` (mit `CheckCard`-Prüfung integriert), `DiffCard`, `PublishCard`, `History`. Die Karte „Prüfen" aus Plan 5 bleibt als schneller Check ohne Build erhalten.

`messages/de.json` — `website.publish` ergänzen:
```json
"preview": { "run": "Vorschau bauen", "running": "Build läuft …", "open": "Vorschau öffnen", "built": "Vorschau gebaut." },
"diff": { "title": "Änderungen gegenüber Live", "changed": "Geändert", "added": "Neu", "removed": "Entfallen", "none": "Keine Änderungen gegenüber dem letzten Publish." },
"publishCard": { "staging": "Nach Staging publizieren", "live": "Live publizieren", "noTarget": "Kein Publish-Ziel konfiguriert (SITE_DEPLOY_*).", "notHere": "Aus der Entwicklungsumgebung wird nicht publiziert.", "blocked": "Sperrworttreffer — Publish nicht möglich.", "confirmTitle": "Webseite publizieren?", "confirmText": "Ziel: {url}. {changed} geändert, {added} neu, {removed} entfallen. Die Seite wird frisch gebaut und übertragen.", "confirm": "Jetzt publizieren", "steps": { "build": "Bauen", "transfer": "Übertragen", "record": "Protokollieren" } },
"done": "Publiziert: {changed} geändert, {added} neu, {removed} entfallen.",
"history": { "title": "Publish-Historie", "columns": { "time": "Zeitpunkt", "status": "Status", "hash": "Inhalts-Hash", "changes": "Änderungen", "by": "Auslöser" }, "log": "Protokoll" }
```
und `errors.conflict`: `"publicUrlMissing": "SITE_PUBLIC_URL ist nicht gesetzt."`, `"publishTargetMissing": "Kein Publish-Ziel konfiguriert."`, `"publishNotAllowedHere": "Aus der Entwicklungsumgebung wird nicht publiziert."`, `"blockedTermsPresent": "Sperrworttreffer: {detail}"`, `"siteBuildFailed": "Der Build ist fehlgeschlagen: {detail}"`, `"publishFailed": "Die Übertragung ist fehlgeschlagen: {detail}"`.

`next.config.ts`: `serverExternalPackages` um `'sharp'` ergänzen; `transpilePackages` bleibt.

- [ ] **Step 5: E2E ausführen**

Run: `pnpm --filter @kompass/app typecheck && pnpm --filter @kompass/app e2e e2e/website-publish.spec.ts`
Expected: grün (Build im Test dauert; Timeouts sind in den Assertions gesetzt).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(app): website preview build, diff, confirmed publish and history"
```

---

### Task 6: Einmalige Datenübernahme aus dem Prototyp

**Files:**
- Create: `scripts/import-prototype.ts`, `scripts/prototype-pages.json`
- Test: `scripts/import-prototype.test.ts` (Vitest im Root über `packages/core`-Config? — einfacher: `packages/modules/website/tests/import-prototype.test.ts` mit Import des Skripts als Modul)

**Interfaces:**
- Produces: `importPrototype(deps, ctx, { prototypeDir, pagesFile }) → Promise<{ animals: number; projects: number; team: number; faqs: number; articles: number; pages: number; facts: number }>`; CLI `pnpm import:prototype` (Root-Skript) mit `DATABASE_PATH`, `MEDIA_PATH`, `PROTOTYPE_DIR` (Default `/Users/joe/Development/Aluna Tierhilfe e.V./Webseite/aluna-static`), idempotent (überspringt vorhandene Slugs/Keys).

- [ ] **Step 1: Test schreiben**

`packages/modules/website/tests/import-prototype.test.ts`:
```ts
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, listProjects, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { animalsModule, listAnimals } from '@kompass/module-animals';
import { afterEach, describe, expect, it } from 'vitest';
import { importPrototype } from '../../../../scripts/import-prototype';
import { getPage, listFaqs, listTeam, websiteModule } from '../src';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function fakePrototype(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'proto-'));
  dirs.push(dir);
  mkdirSync(path.join(dir, 'src/data'), { recursive: true });
  mkdirSync(path.join(dir, 'public/images'), { recursive: true });
  writeFileSync(path.join(dir, 'public/images/placeholder-hund.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  writeFileSync(path.join(dir, 'src/data/dogs.js'), `export const dogs = [{ slug: 'chiara', name: 'Chiara', photo: '/images/placeholder-hund.png', geschlecht: 'Hündin', geboren: '16.02.2021', groesse: 45, groesseText: '45–50 cm', ort: 'Rumänien', status: 'sucht', notfall: false, patentier: true, wesen: ['ruhig'], hundeblicke: 'https://www.hundeblicke.net/chiara', kurz: 'Sanft.', text: ['Absatz 1.', 'Absatz 2.'], tags: [] }, { slug: 'akiko', name: 'Akiko', photo: '/images/placeholder-hund.png', geschlecht: 'Hündin', geboren: '2020', groesse: 50, groesseText: '50 cm', ort: 'Deutschland', status: 'vermittelt', notfall: false, patentier: false, wesen: [], hundeblicke: '', kurz: 'Angekommen.', text: ['Text.'], tags: [], vorher: '/images/placeholder-hund.png', nachher: '/images/placeholder-hund.png', zitat: 'Endlich zuhause.', familie: 'Familie M.' }];`);
  writeFileSync(path.join(dir, 'src/data/projects.js'), `export const projects = [{ slug: 'grundversorgung-shelter', titel: 'Grundversorgung', typ: 'Dauerprojekt', photo: '/images/placeholder-hund.png', betterplaceId: '000001', kurz: 'Futter.', text: ['Text.'] }];`);
  writeFileSync(path.join(dir, 'src/data/team.js'), `export const team = [{ name: 'Nicole Wießner', rolle: 'Erste Vorsitzende', foto: '/images/placeholder-hund.png' }];`);
  writeFileSync(path.join(dir, 'src/data/faq.js'), `export const faq = [{ kategorie: 'Spenden', fragen: [{ q: 'Wohin?', a: 'An den Shelter.' }] }];`);
  writeFileSync(path.join(dir, 'src/data/articles.js'), `export const articles = [{ slug: 'transport', titel: 'Ablauf des Transportes', lede: 'Lede.', body: '<h2>Vorbereitung</h2><p>Text.</p><ul><li>eins</li></ul>' }];`);
  writeFileSync(path.join(dir, 'pages.json'), JSON.stringify({ facts: { claim: { de: 'Wir helfen. Leben retten.', en: '' }, forwardingPercent: 97.2, shelterDogCount: 150, donationBoxLocations: ['Köln-Porz'], blockedTerms: [] }, pages: { about: { title: { de: 'Jeder Hund verdient eine zweite *Chance.*', en: '' }, lede: { de: 'L', en: '' }, body: { de: '## Was uns *antreibt.*\n\n- Hunde retten.', en: '' }, blocks: [] } } }));
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
```

- [ ] **Step 2: Test ausführen, Fehlschlag prüfen**

Run: `pnpm --filter @kompass/module-website test tests/import-prototype.test.ts`
Expected: FAIL.

- [ ] **Step 3: Seitentexte als JSON vorbereiten**

`scripts/prototype-pages.json` wird **von Hand** aus den Astro-Dateien des Prototyps erstellt (die Texte stehen in `pages/*.astro`; sie werden als Markdown übernommen): für jeden Seitenschlüssel `title` (mit `*Betonung*` statt `<em>`), `lede`, `body` (Überschriften mit `##`, Listen mit `-`, Hinweiskästen `aluna-note` als `>`-Zitat, Schrittkarten als `:::karten`), `blocks` (Helfen: die vier Hilfswege; Startseite: `impact-15`, `impact-50`, `impact-120`, `impact-sponsor` und `social`; Spenden: die drei „Andere Wege"), sowie `facts` (Claim „Wir helfen. Leben retten.", `forwardingPercent: 97.2`, `shelterDogCount: 150`, `donationBoxLocations: ["Köln-Porz", "Jülich", "Merkstein"]`, `section11Status: "pending"`, `betterplaceMetaProjectId` aus `site.js`, Social-Links aus `site.js`, `blockedTerms: []` — die Sperrwörter trägt der Vorstand selbst ein). Impressum, Datenschutz und Satzung bekommen die Texte aus dem Prototyp inklusive der `[Platzhalter]`; die Adoptionsschritte aus dem Artikel „Ablauf der Adoption" wandern als `:::karten` in die Seite `adoption-process`, der Artikel selbst wird nicht importiert. Englische Felder bleiben leer.

- [ ] **Step 4: Skript**

`scripts/import-prototype.ts`:
```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDeps, createProject, listProjects, readEnv, setProjectPublished, setSetting, storeMediaAsset, unwrap, type CallContext, type Deps } from '@kompass/core';
import { animalsModule, createAnimal, listAnimals, setAnimalPhotos, setAnimalPublished, setAnimalStatus, setAnimalStory } from '@kompass/module-animals';
import { createArticle, createFaq, createTeamMember, listArticles, listFaqs, listTeam, setArticlePublished, setFaqPublished, setTeamMemberPublished, updatePage, websiteModule } from '@kompass/module-website';
import { coreDocumentTemplates, createTypstRenderer } from '@kompass/documents';

type Localized = { de: string; en: string };
const L = (de: string): Localized => ({ de, en: '' });

const assetCache = new Map<string, string>();
async function asset(deps: Deps, ctx: CallContext, prototypeDir: string, publicPath: string): Promise<string | null> {
  if (!publicPath) return null;
  if (assetCache.has(publicPath)) return assetCache.get(publicPath)!;
  const file = path.join(prototypeDir, 'public', publicPath);
  const bytes = new Uint8Array(await readFile(file));
  const stored = unwrap(await storeMediaAsset(deps, ctx, { originalName: path.basename(file), bytes }));
  assetCache.set(publicPath, stored.id);
  return stored.id;
}

export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<div class="aluna-archive-grid">([\s\S]*?)<\/div>\s*$/m, '$1')
    .replace(/<div class="aluna-card">\s*<p class="eyebrow">(?:<span[^>]*><\/span>)?([^<]*)<\/p>\s*<h3>([^<]*)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g, (_m, eyebrow: string, title: string, text: string) => `### ${eyebrow.trim()} – ${title.trim()}\n${text.trim()}\n`)
    .replace(/<p class="aluna-note">([\s\S]*?)<\/p>/g, (_m, t: string) => `> ${t.trim()}`)
    .replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, t: string) => `## ${t.replace(/<em>(.*?)<\/em>/g, '*$1*').trim()}`)
    .replace(/<h3>([\s\S]*?)<\/h3>/g, (_m, t: string) => `### ${t.trim()}`)
    .replace(/<li>([\s\S]*?)<\/li>/g, (_m, t: string) => `- ${t.trim()}`)
    .replace(/<\/?(ul|ol)>/g, '')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/g, '[$2]($1)')
    .replace(/<p>([\s\S]*?)<\/p>/g, (_m, t: string) => `${t.trim()}\n`)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function wrapCards(markdown: string): string {
  // Folgen von "### …"-Karten aus aluna-card-Blöcken in einen :::karten-Container heben
  return markdown.includes('### Schritt') || markdown.includes('### 3 ') ? `:::karten\n${markdown}\n:::` : markdown;
}

export async function importPrototype(deps: Deps, ctx: CallContext, opts: { prototypeDir: string; pagesFile: string }) {
  const load = async <T,>(file: string, name: string): Promise<T> => ((await import(pathToFileURL(path.join(opts.prototypeDir, 'src/data', file)).href)) as Record<string, T>)[name]!;
  const counts = { animals: 0, projects: 0, team: 0, faqs: 0, articles: 0, pages: 0, facts: 0 };

  const dogs = await load<any[]>('dogs.js', 'dogs');
  const existingAnimals = new Set(unwrap(await listAnimals(deps, ctx)).map((a) => a.slug));
  for (const d of dogs) {
    if (existingAnimals.has(d.slug)) continue;
    const created = unwrap(await createAnimal(deps, ctx, { slug: d.slug, name: d.name, sex: d.geschlecht === 'Rüde' ? 'male' : 'female', birthText: L(d.geboren ?? ''), sizeCm: Number(d.groesse ?? 0), sizeText: L(d.groesseText ?? ''), location: d.ort === 'Deutschland' ? 'germany' : 'shelter', isEmergency: !!d.notfall, isSponsorable: !!d.patentier, traits: { de: d.wesen ?? [], en: [] }, externalProfileUrl: d.hundeblicke ?? '', summary: L(d.kurz ?? ''), body: L((d.text ?? []).join('\n\n')) }));
    const photo = await asset(deps, ctx, opts.prototypeDir, d.photo);
    if (photo) unwrap(await setAnimalPhotos(deps, ctx, { id: created.id, photos: [{ assetId: photo, isPrimary: true }] }));
    if (d.status === 'reserviert') unwrap(await setAnimalStatus(deps, ctx, { id: created.id, status: 'reserved' }));
    if (d.status === 'vermittelt') {
      unwrap(await setAnimalStatus(deps, ctx, { id: created.id, status: 'adopted', adoptedYear: 2026 }));
      unwrap(await setAnimalStory(deps, ctx, { id: created.id, beforeAssetId: await asset(deps, ctx, opts.prototypeDir, d.vorher ?? ''), afterAssetId: await asset(deps, ctx, opts.prototypeDir, d.nachher ?? ''), quote: L(d.zitat ?? ''), family: d.familie ?? '', adoptedYear: 2026 }));
    }
    unwrap(await setAnimalPublished(deps, ctx, { id: created.id, isPublished: true }));
    counts.animals += 1;
  }

  const projects = await load<any[]>('projects.js', 'projects');
  const existingProjects = new Set(unwrap(await listProjects(deps, ctx)).map((p) => p.slug));
  for (const p of projects) {
    if (existingProjects.has(p.slug)) continue;
    const created = unwrap(await createProject(deps, ctx, { slug: p.slug, name: L(p.titel), type: p.typ === 'Kurzzeitprojekt' ? 'shortTerm' : 'ongoing', summary: L(p.kurz ?? ''), body: L((p.text ?? []).join('\n\n')), imageAssetId: await asset(deps, ctx, opts.prototypeDir, p.photo), betterplaceProjectId: p.betterplaceId ?? '' }));
    unwrap(await setProjectPublished(deps, ctx, { id: created.id, isPublished: true }));
    counts.projects += 1;
  }

  const team = await load<any[]>('team.js', 'team');
  const existingTeam = new Set(unwrap(await listTeam(deps, ctx)).map((m) => m.name));
  for (const m of team) {
    if (existingTeam.has(m.name)) continue;
    const created = unwrap(await createTeamMember(deps, ctx, { name: m.name, position: L(m.rolle), photoAssetId: await asset(deps, ctx, opts.prototypeDir, m.foto) }));
    unwrap(await setTeamMemberPublished(deps, ctx, { id: created.id, isPublished: true }));
    counts.team += 1;
  }

  const faq = await load<any[]>('faq.js', 'faq');
  const existingFaqs = new Set(unwrap(await listFaqs(deps, ctx)).map((f) => f.question.de));
  for (const group of faq) for (const f of group.fragen) {
    if (existingFaqs.has(f.q)) continue;
    const created = unwrap(await createFaq(deps, ctx, { category: L(group.kategorie), question: L(f.q), answer: L(f.a) }));
    unwrap(await setFaqPublished(deps, ctx, { id: created.id, isPublished: true }));
    counts.faqs += 1;
  }

  const articles = await load<any[]>('articles.js', 'articles');
  const existingArticles = new Set(unwrap(await listArticles(deps, ctx)).map((a) => a.slug));
  for (const a of articles) {
    if (a.slug === 'ablauf-der-adoption' || existingArticles.has(a.slug)) continue;
    const created = unwrap(await createArticle(deps, ctx, { slug: a.slug, title: L(a.titel), lede: L(a.lede ?? ''), body: L(wrapCards(htmlToMarkdown(a.body ?? ''))) }));
    unwrap(await setArticlePublished(deps, ctx, { id: created.id, isPublished: true }));
    counts.articles += 1;
  }

  const pagesFile = JSON.parse(await readFile(opts.pagesFile, 'utf8')) as { facts: Record<string, unknown>; pages: Record<string, { title: Localized; lede: Localized; body: Localized; blocks: unknown[] }> };
  for (const [key, page] of Object.entries(pagesFile.pages)) {
    const current = unwrap(await (await import('@kompass/module-website')).getPage(deps, ctx, key));
    if (current.title.de) continue;
    unwrap(await updatePage(deps, ctx, { key, ...page }));
    counts.pages += 1;
  }
  for (const [k, v] of Object.entries(pagesFile.facts)) {
    const key = `website.${k}`;
    const currentValue = (await import('@kompass/core')).readSetting(deps, key);
    if (JSON.stringify(currentValue) === JSON.stringify(v)) continue;
    unwrap(await setSetting(deps, ctx, { key, value: v }));
    counts.facts += 1;
  }
  return counts;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const env = readEnv({ SESSION_SECRET: 'import-only-not-a-real-secret-value-0000', ...process.env });
  const deps = createDeps({ databasePath: env.databasePath, mediaPath: env.mediaPath, env: env.env, modules: [websiteModule, animalsModule], coreTemplates: coreDocumentTemplates(createTypstRenderer()) });
  const ctx: CallContext = { userId: null, permissions: new Set(deps.registry.permissionKeys), channel: 'system', apiTokenId: null, ipAddress: null, requestId: 'IMPORT' };
  const prototypeDir = process.env.PROTOTYPE_DIR ?? '/Users/joe/Development/Aluna Tierhilfe e.V./Webseite/aluna-static';
  importPrototype(deps, ctx, { prototypeDir, pagesFile: path.resolve(import.meta.dirname, 'prototype-pages.json') })
    .then((counts) => { console.log('Import abgeschlossen:', counts); deps.close(); })
    .catch((error) => { console.error(error); deps.close(); process.exit(1); });
}
```
Bereinigung beim Umsetzen: `getPage` und `readSetting` oben normal importieren statt per dynamischem `import()`; `facts`-Zählung bleibt bei 4 im Test, weil `blockedTerms: []` dem Default entspricht und übersprungen wird (`claim`, `forwardingPercent` = Default 97.2 wird ebenfalls übersprungen → im Test ergeben `claim`, `shelterDogCount`, `donationBoxLocations` plus … — den Erwartungswert im Test beim Umsetzen auf die tatsächliche Zahl der vom Default abweichenden Fakten setzen und begründen). Root-`package.json`: `"import:prototype": "tsx scripts/import-prototype.ts"` mit `tsx` als Dev-Abhängigkeit im Root; der System-Kontext ohne Nutzer schreibt Audit-Einträge mit Kanal `system`.

- [ ] **Step 5: Tests ausführen und echten Import gegen Test fahren**

Run: `pnpm --filter @kompass/module-website test`
Expected: grün.

Dann gegen die **Testumgebung** (lokal mit der Test-DB oder direkt im Test-Container per `docker exec`): `APP_ENV=test DATABASE_PATH=… MEDIA_PATH=… pnpm import:prototype`. Anschließend in Kompass: Site-Fakten prüfen, Sperrwörter eintragen, Vorschau bauen, Sperrworttreffer beheben (der Prototyp enthält keine, aber die Prüfung läuft), Übersetzungslücken sind erwartet.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: one-time prototype content import into Kompass"
```

---

### Task 7: Docker, Compose, CI, Betriebsanleitung

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `.env.test.example`, `.env.prod.example`, `.github/workflows/ci.yml`, `docs/betrieb.md`, `AGENTS.md` (Befehle)
- Test: lokaler Container-Smoke-Test mit Vorschau-Build

- [ ] **Step 1: Dockerfile erweitern**

`deps`-Stage: `COPY apps/site/package.json apps/site/` und die drei neuen Pakete (`packages/markdown`, `packages/modules/website`, `packages/modules/animals`) vor `pnpm install`. `runner`-Stage: `apt-get install -y --no-install-recommends rsync openssh-client` (nicht purgen); zusätzlich kopieren:
```dockerfile
COPY --from=build --chown=node:node /app/apps/site ./apps/site
COPY --from=build --chown=node:node /app/packages/markdown ./packages/markdown
COPY --from=build --chown=node:node /app/node_modules ./node_modules
```
Hinweis: Der Astro-Build im Container braucht die Workspace-`node_modules` von `apps/site` (Astro, Vite, sharp) — Standalone-Output von Next enthält sie nicht. Deshalb wird das gesamte `node_modules`-Verzeichnis aus der Build-Stage kopiert (Image wird größer, ~300 MB mehr; auf dem NAS unerheblich). `ENV SITE_DIR=/app/apps/site SITE_CACHE_DIR=/data/site-cache SITE_PREVIEW_DIR=/data/site-preview`. `.dockerignore`: `apps/site/dist`, `apps/site/fixtures/example/images` nicht ausschließen (Fixture wird für den Site-Test gebraucht, nicht im Image; ok).

- [ ] **Step 2: Compose und Env-Beispiele**

`docker-compose.yml` je Dienst ergänzen:
```yaml
    volumes:
      - /share/Container/kompass-test/data:/data
      - /share/Container/kompass-test/media:/media
      - /share/Container/kompass-test/site.key:/data/site.key:ro
```
`.env.test.example`:
```
SESSION_SECRET=
SITE_PUBLIC_URL=https://staging.aluna-tierhilfe.org
SITE_STAGING=1
SITE_DEPLOY_HOST=<webspace>.1and1-data.host
SITE_DEPLOY_USER=
SITE_DEPLOY_PATH=/kunden/homepages/…/staging
SITE_DEPLOY_KEY_FILE=/data/site.key
```
`.env.prod.example` analog mit `SITE_PUBLIC_URL=https://aluna-tierhilfe.org`, ohne `SITE_STAGING`, `SITE_DEPLOY_PATH` auf das Live-Verzeichnis.

- [ ] **Step 3: CI**

`ci.yml`, Job `test`: `sudo apt-get install -y rsync` vor den Tests (Ubuntu-Runner haben rsync meist, explizit ist sicherer); die Site-Tests laufen über `pnpm test` mit. Job `image` unverändert (Dockerfile enthält alles).

- [ ] **Step 4: Smoke-Test im Container**

Run:
```bash
docker build --platform linux/amd64 -t kompass-local .
mkdir -p /tmp/kompass-smoke/{data,media,target}
docker run --rm -d --name kompass-smoke -p 3900:3000 -e APP_ENV=test -e SESSION_SECRET="$(openssl rand -hex 24)" -e SITE_PUBLIC_URL=https://staging.example.org -e SITE_STAGING=1 -e SITE_DEPLOY_HOST= -e SITE_DEPLOY_USER= -e SITE_DEPLOY_PATH=/target -e SITE_DEPLOY_KEY_FILE= -v /tmp/kompass-smoke/data:/data -v /tmp/kompass-smoke/media:/media -v /tmp/kompass-smoke/target:/target kompass-local
sleep 10 && curl -sf http://localhost:3900/api/health
docker exec kompass-smoke sh -c "rsync --version | head -1 && ls /app/apps/site/node_modules/astro/astro.js"
```
Dann im Browser `http://localhost:3900`: Einrichtung, Module aktivieren, unter Webseite → Publizieren „Vorschau bauen" (muss im Container durchlaufen) und „Nach Staging publizieren" (landet in `/tmp/kompass-smoke/target`). Expected: `index.html` im Zielordner, Historie zeigt `success`. `docker stop kompass-smoke`.

- [ ] **Step 5: Betriebsanleitung**

`docs/betrieb.md` um das Kapitel „Webseite" ergänzen:
```markdown
## Webseite (Staging und Live)

1. Bei IONOS zwei Verzeichnisse anlegen: `…/staging` (Subdomain `staging.aluna-tierhilfe.org` darauf zeigen lassen) und das Live-Verzeichnis der Hauptdomain. SSH-Zugang im IONOS-Kundencenter aktivieren.
2. Auf dem NAS ein SSH-Schlüsselpaar erzeugen (`ssh-keygen -t ed25519 -f site.key -N ""`), den öffentlichen Schlüssel bei IONOS hinterlegen (`~/.ssh/authorized_keys` des Webspace-Nutzers), `site.key` nach `/share/Container/kompass-test/` **und** `/share/Container/kompass-prod/` legen (Rechte 600, Besitzer UID 1000 = `node`).
3. `.env.test` und `.env.prod` um die `SITE_*`-Variablen ergänzen (siehe `.env.*.example`). Ohne diese Variablen zeigt Kompass nur „Vorschau", keinen Publish-Knopf.
4. Erster Publish aus Test nach Staging; im Browser prüfen (Staging trägt `noindex`). Dann aus Prod auf Live.
5. Beim Wechsel von WordPress: Live-Verzeichnis vorher umbenennen (`aluna` → `aluna-wordpress-alt`), neues Verzeichnis anlegen, Domain darauf zeigen, dann publizieren. Das alte Verzeichnis nach einer Woche löschen.
6. Fehlersuche: Publizieren-Seite → Historie → Protokoll. Häufige Ursachen: Schlüsselrechte, falscher `SITE_DEPLOY_PATH`, Host-Key-Wechsel (dann `known_hosts` im Container löschen: `docker exec kompass-prod rm -f /home/node/.ssh/known_hosts`).
7. Bildcache: `/data/site-cache` darf jederzeit gelöscht werden; der nächste Build erzeugt ihn neu (dauert dann länger).
```
`AGENTS.md` „Befehle": `pnpm --filter @kompass/site dev` (Site mit Fixture unter `http://localhost:4321`), `pnpm --filter @kompass/site test`, `pnpm import:prototype`.

- [ ] **Step 6: Gesamtlauf und Commit**

Run: `pnpm typecheck && pnpm test && pnpm --filter @kompass/app e2e`
Expected: alle grün.

```bash
git add -A
git commit -m "chore: site build in docker image, deploy env, ci and operations guide for the website"
```

---

## Abschluss dieses Plans

Nach Task 7 ist Stufe 2 vollständig: Inhalte in Kompass, Vorschau und Publish aus dem Container, Staging aus Test, Live aus Prod, WordPress abgelöst. Nächste Stufen laut Spec: Finanzen (Stufe 3), Tiere in der Vollstufe (Stufe 4), Mitglieder und Gremien (Stufe 5).

## Self-Review (durchgeführt beim Schreiben)

**Spec-Abdeckung:** Abschnitt 3 Pipeline (Export → Prüfung → Build → Diff → Publish, Vorschau = Schritte 1–3, Staging `noindex`, Bilder skaliert und WebP, Cache, Kindprozess mit Zeitlimit, Publish-Ziel aus Env, Schlüssel als Datei, rsync über SSH, `website_publishes` + Audit) → Tasks 2, 4, 5; Markdown in der Site über dasselbe Paket → Task 1 (`MarkdownBody`); MCP ohne Publish-Tool → unverändert aus Plan 4. Abschnitt 4 „Publizieren" (Stand, Prüfliste, Änderungsliste, Knopf je Umgebung mit Bestätigung, Sperrworttreffer blockiert, Historie) → Task 5. Abschnitt 5 Portierung (alle Seiten, `/en/`-Baum mit übersetzten Pfaden, `hreflang`, Sitemap, robots je Umgebung, Inline-Styles in Klassen, nur zwei Skripte, PDFs aus Downloads) → Tasks 1, 3; Weiterleitungstabelle für alte WordPress-URLs: im Prototyp gibt es keine abweichenden Pfade, deshalb **nicht** gebaut — die Anleitung nennt den Verzeichniswechsel; Datenübernahme → Task 6; Tests (Sichten, Sprachfallback, Sperrwort, Diff, Historie, Determinismus, DE/EN, `hreflang`, `noindex`, Playwright-Fluss, rsync lokal) → Tasks 1–5; Betrieb → Task 7.

**Placeholder-Scan:** Task 3 beschreibt mehrere Astro-Komponenten in Prosa mit genauen Feld- und Verhaltensangaben statt vollständigem Markup (Listen-, Detail-, FAQ-, Team-Komponenten); die Muster dafür sind `DogCard`, `TextPage`, `Blocks` und der Prototyp, dessen Markup 1:1 zu übernehmen ist. Task 6 verlangt eine handgefertigte `prototype-pages.json` — das ist Inhaltsarbeit, kein Code-Platzhalter; die Regeln zur Umwandlung stehen im Step.

**Typkonsistenz:** `SiteExport`/`ExportedAsset` (Plan 4) → `prepareImageVariants` (Task 2) → `exportAndBuild` (Task 4); `SiteEnv` (Task 4) → `siteEnv()` (Task 5); `PublishDiff`/`recordPublish`/`lastSuccessfulPublish` (Task 4) → Publizieren-Seite (Task 5); `content.json`-Format aus Plan 4 → `SiteContent` (Task 1); `images.json`-Format (Task 2) → `ImageVariant` (Task 1).

**Bewusste Abweichung von der Spec:** „zuletzt angelegter Hund" bei der Automatik ist über die alphabetisch sortierte Sicht nicht bestimmbar; die Automatik nimmt den ersten Notfall, sonst den ersten Hund der Liste. Wer einen bestimmten Hund vorn haben will, wählt ihn in den Site-Fakten aus.
