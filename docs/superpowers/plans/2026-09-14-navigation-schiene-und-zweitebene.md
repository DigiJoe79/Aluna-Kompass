# Navigation: Schiene und Zweitebene — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Sidebar mit Akkordeons wird zu einer festen, beschrifteten Schiene (88 px, eine Zeile je Bereich) plus einer Zweitebene (208 px) mit den Seiten des aktiven Bereichs; Einstellungen sind ein Bereich am Fuß der Schiene; die Kopfleiste läuft über die volle Breite.

**Architecture:** `buildNavigation()` bleibt und liefert weiter `NavGroup[]` (Befehlspalette unverändert). Daneben entstehen in `apps/kompass/src/lib/navigation.ts` reine Funktionen: `locate()` als einzige Ortsbestimmung, daraus `activeRailKey()`, `buildRail()`, `sectionsFor()` und `crumbsFor()`. Drei Komponenten rendern das: `Rail` (ersetzt `Sidebar`), `SectionNav` (neu), `Topbar` (nimmt Logo, Vereinsname, Brotkrume mit `<h1>` und Nutzermenü auf). `ShellFrame` verdrahtet sie. Am Kern kommt ein optionales `moduleIcon` ans Manifest.

**Tech Stack:** Next 16 (App Router, Client-Komponenten), next-intl, Tailwind mit Theme-Tokens, lucide-react, Vitest (Unit, `environment: node`), Playwright (E2E, Port 3100).

**Spec:** `docs/superpowers/specs/2026-09-14-navigation-schiene-und-zweitebene-design.md` — der Plan setzt sie ganz um. § 4 (Funktionen), § 5–7 (Komponenten), § 10 (Tests), § 14 (Abnahme).

## Global Constraints

- **Umfang: nur die Navigationsschale.** Keine Modulseite, kein Seed, kein Testdatensatz wird geändert. Am Kern ausschließlich `moduleIcon?: string` an `ModuleManifest`; gesetzt nur in `packages/modules/site/src/manifest.ts`.
- `buildNavigation()` bleibt in Signatur und Ergebnis unverändert bis auf ein additives `icon?: string` an `NavGroup`. `apps/kompass/src/lib/command-index.ts` wird nicht angefasst.
- Maße aus der Spec: Schiene `w-[88px]`, Zeile `w-[76px] h-[52px]`, Zweitebene `w-52` (208 px), Topbar `h-14`. `DRAWER_BREAKPOINT = 1180` bleibt.
- Ein `href` ist ein Pfad; Treffer an der Segmentgrenze (`pathname === href || pathname.startsWith(href + '/')`), längster Treffer gewinnt, nur `visible`-Einträge zählen. Keine Query-Strings.
- Kein UI-Text im Code (AGENTS.md Prinzip 7; `tests/no-hardcoded-ui-text.test.ts` wacht). Neue Schlüssel in `apps/kompass/messages/de.json`; `tests/message-keys.test.ts` prüft, dass jeder fest aufgerufene Schlüssel existiert — deshalb kommen Schlüssel **vor** ihrer Verwendung hinein und alte erst **nach** dem Löschen der letzten Verwendung heraus.
- Keine Farbwerte im Code, nur Tokens (`bg-sidebar`, `bg-bg`, `bg-hover`, `bg-selected`, `text-selected-ink`, `bg-brand-soft`, `text-brand-ink`, `border-line`, `text-muted-ink`, `text-muted-ink-2`, `text-ink-2`).
- Aria: Schiene `nav.aria` („Hauptnavigation", unverändert), Zweitebene `nav.sectionAria` („Unternavigation"). Genau ein `<h1>` je Seite, in der Topbar.
- Unit-Tests: `cd apps/kompass && npx vitest run tests/navigation.test.ts`. Typecheck: `pnpm typecheck` (Repo-Wurzel). E2E einzeln: `cd apps/kompass && npx playwright test e2e/shell.spec.ts` (startet den Dev-Server auf 3100 selbst; `npx`, nicht `pnpm … e2e --`).
- Commit je Task, kein Push (Joe pusht). Nur eigene Dateien stagen, nie `git add -A`. Commit-Trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` und `Claude-Session: https://claude.ai/code/session_01DfrQsGAnTMrk8S37ytCtzB`.
- Vor dem letzten Commit `pnpm verify` (Typecheck, alle Tests, E2E kalt, Image, E2E gegen Image; braucht Docker, ~4 Minuten).

---

### Task 1: `moduleIcon` am Manifest, `icon` an `NavGroup`

**Files:**
- Modify: `packages/core/src/modules/manifest.ts` (Interface `ModuleManifest`, nach `navigation?:`)
- Modify: `packages/modules/site/src/manifest.ts` (Objekt `siteModule`, neben `navigation:`)
- Modify: `apps/kompass/src/lib/navigation.ts` (`NavGroup`, `buildNavigation` → Modul-Map)
- Test: `apps/kompass/tests/navigation.test.ts`

**Interfaces:**
- Consumes: `ModuleManifest`, `NavigationItem` aus `@kompass/core`; `defineModule`, `coreModule` (Tests).
- Produces: `ModuleManifest.moduleIcon?: string`; `NavGroup.icon?: string`, von `buildNavigation` aus `moduleIcon` befüllt (nur bei Modulgruppen; `admin`/`config` ohne).

- [x] **Step 1: Test schreiben**

In `apps/kompass/tests/navigation.test.ts` am Ende von `describe('buildNavigation', …)` einfügen:

```ts
  it('carries the module icon on the group so the rail can show it', () => {
    const site = defineModule({
      key: 'site',
      version: '0.1.0',
      permissions: ['site.manage'],
      moduleIcon: 'globe',
      navigation: [{ key: 'site.template', href: '/site/template', icon: 'layout-template', group: 'site', permission: 'site.manage' }],
    });
    const groups = buildNavigation({ manifests: [coreModule, site, finance], enabledKeys: new Set(['core', 'site', 'finance']), permissions: new Set(['site.manage', 'finance.view']) });
    expect(groups.find((g) => g.key === 'site')!.icon).toBe('globe');
    expect(groups.find((g) => g.key === 'finance')!.icon).toBeUndefined();
    expect(groups.find((g) => g.key === 'admin')!.icon).toBeUndefined();
  });
```

- [x] **Step 2: Test laufen lassen — er muss rot sein**

Run: `cd apps/kompass && npx vitest run tests/navigation.test.ts`
Expected: FAIL — Typfehler `moduleIcon` unbekannt bzw. `icon` ist `undefined` statt `'globe'`.

- [x] **Step 3: Manifest-Feld anlegen**

In `packages/core/src/modules/manifest.ts`, Interface `ModuleManifest`, direkt nach der Zeile `navigation?: readonly NavigationItem[];`:

```ts
  /**
   * Symbol des Moduls in der Schiene. Fehlt es, nimmt die Schale das Icon des
   * ersten sichtbaren Navigationseintrags. Muss wie `NavigationItem.icon` in
   * der ICONS-Whitelist von `apps/kompass/src/components/shell/rail.tsx` stehen.
   */
  moduleIcon?: string;
```

- [x] **Step 4: `site` setzt das Symbol**

In `packages/modules/site/src/manifest.ts` im `defineModule({ … })`-Objekt vor `navigation:`:

```ts
  // `moduleIcon` muss in der Whitelist in `apps/kompass/src/components/shell/rail.tsx`
  // stehen (`globe`). Das erste Item-Icon `layout-template` meint die Seite
  // „Template“, nicht das Modul „Webseite“.
  moduleIcon: 'globe',
```

- [x] **Step 5: `NavGroup.icon` und Übernahme in `buildNavigation`**

In `apps/kompass/src/lib/navigation.ts`:

`NavGroup` erweitern:

```ts
export interface NavGroup {
  key: string;
  labelKey: string;
  disabled: boolean;
  items: NavItem[];
  /** Symbol des Moduls in der Schiene (`moduleIcon` des Manifests); fehlt bei `admin`/`config`. */
  icon?: string;
}
```

Im `return`-Objekt der Modul-Map (`.map((m) => { … return { key: m.key, labelKey: …, disabled: false, items: […] }; })`) nach `labelKey` einfügen:

```ts
        icon: m.moduleIcon,
```

- [x] **Step 6: Test und Typecheck grün**

Run: `cd apps/kompass && npx vitest run tests/navigation.test.ts && cd ../.. && pnpm typecheck`
Expected: alle Tests PASS, Typecheck ohne Fehler.

- [x] **Step 7: Commit**

```bash
git add packages/core/src/modules/manifest.ts packages/modules/site/src/manifest.ts apps/kompass/src/lib/navigation.ts apps/kompass/tests/navigation.test.ts
git commit -m "feat(core): a module manifest may name its rail icon, and the navigation group carries it"
```

---

### Task 2: `locate()` und `activeRailKey()`

**Files:**
- Modify: `apps/kompass/src/lib/navigation.ts` (am Dateiende)
- Test: `apps/kompass/tests/navigation.test.ts`

**Interfaces:**
- Consumes: `NavGroup`, `NavItem` (Task 1).
- Produces:
  ```ts
  export interface Location { area: string; group: NavGroup; item: NavItem }
  export function locate(groups: NavGroup[], pathname: string): Location | null
  export function activeRailKey(groups: NavGroup[], pathname: string): string | null
  ```
  `area` ist `group.key`, für `admin`/`config` `'settings'`. `activeRailKey` liefert `'home'` auf `/`.

- [x] **Step 1: Test-Fixture und Tests schreiben**

In `apps/kompass/tests/navigation.test.ts` den Import erweitern:

```ts
import { activeRailKey, buildNavigation, locate, type NavGroup, type NavItem } from '@/lib/navigation';
```

Nach den Imports, vor `const finance = …`, eine Fixture, die alle folgenden Tasks benutzen:

```ts
/** Ein Eintrag, wie `buildNavigation` ihn baut — sichtbar, es sei denn, der Test sagt anders. */
const item = (key: string, href: string, icon = 'list', extra: Partial<NavItem> = {}): NavItem => ({
  key,
  href,
  icon,
  labelKey: `nav.${key}`,
  disabled: false,
  visible: true,
  ...extra,
});

/** Eine Installation mit Verwaltung, Einrichtung, Webseite (mit Sammlung) und Akte. */
const FIXTURE: NavGroup[] = [
  { key: 'admin', labelKey: 'nav.groups.admin', disabled: false, items: [item('users', '/admin/users', 'users'), item('media', '/admin/media', 'image')] },
  { key: 'config', labelKey: 'nav.groups.config', disabled: false, items: [item('settings', '/admin/settings', 'sliders'), item('themes', '/admin/themes', 'droplet'), item('dms.admin', '/admin/dms', 'folder')] },
  {
    key: 'site',
    labelKey: 'nav.groups.site',
    disabled: false,
    icon: 'globe',
    items: [item('site.template', '/site/template', 'layout-template'), item('site.c.artikel', '/site/c/artikel', 'list', { label: 'Artikel' })],
  },
  { key: 'dms', labelKey: 'nav.groups.dms', disabled: false, items: [item('dms.list', '/dms', 'file')] },
];
```

Am Dateiende einen neuen `describe`-Block:

```ts
describe('locate', () => {
  it('matches at a segment boundary, not by raw prefix', () => {
    expect(locate(FIXTURE, '/dms')!.item.key).toBe('dms.list');
    expect(locate(FIXTURE, '/dms/01J')!.item.key).toBe('dms.list');
    expect(locate(FIXTURE, '/dmsx')).toBeNull();
  });

  it('prefers the longest matching entry', () => {
    const hit = locate(FIXTURE, '/site/c/artikel/neu')!;
    expect(hit.item.key).toBe('site.c.artikel');
    expect(hit.area).toBe('site');
  });

  it('maps admin and config to the settings area', () => {
    expect(locate(FIXTURE, '/admin/themes')!.area).toBe('settings');
    expect(locate(FIXTURE, '/admin/dms')!.group.key).toBe('config');
  });

  it('ignores entries the user may not see', () => {
    const hidden: NavGroup[] = [{ ...FIXTURE[3]!, items: [item('dms.list', '/dms', 'file', { visible: false })] }];
    expect(locate(hidden, '/dms')).toBeNull();
  });

  it('finds nothing on the home page and the profile', () => {
    expect(locate(FIXTURE, '/')).toBeNull();
    expect(locate(FIXTURE, '/profile')).toBeNull();
  });
});

describe('activeRailKey', () => {
  it('names the rail entry for the path', () => {
    expect(activeRailKey(FIXTURE, '/')).toBe('home');
    expect(activeRailKey(FIXTURE, '/site/c/artikel')).toBe('site');
    expect(activeRailKey(FIXTURE, '/admin/themes')).toBe('settings');
    expect(activeRailKey(FIXTURE, '/profile')).toBeNull();
  });
});
```

- [x] **Step 2: Rot**

Run: `cd apps/kompass && npx vitest run tests/navigation.test.ts`
Expected: FAIL — `locate` / `activeRailKey` nicht exportiert.

- [x] **Step 3: Implementieren**

Am Ende von `apps/kompass/src/lib/navigation.ts`:

```ts
/** Die beiden Kerngruppen, die in der Schiene als ein Bereich „Einstellungen“ erscheinen. */
const SETTINGS_GROUPS: ReadonlySet<string> = new Set(['admin', 'config']);

export interface Location {
  /** Modul-Key, oder 'settings' für admin/config. */
  area: string;
  group: NavGroup;
  item: NavItem;
}

/** Ein `href` passt an der Segmentgrenze: `/dms` trifft `/dms` und `/dms/x`, nicht `/dmsx`. */
function matches(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Die eine Ortsbestimmung der Schale: der längste sichtbare Eintrag, der auf
 * den Pfad passt. Schiene, Zweitebene und Brotkrume leiten sich alle daraus ab,
 * damit sie nie auseinanderlaufen.
 */
export function locate(groups: NavGroup[], pathname: string): Location | null {
  let best: Location | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (!item.visible || !matches(item.href, pathname)) continue;
      if (best && item.href.length <= best.item.href.length) continue;
      best = { area: SETTINGS_GROUPS.has(group.key) ? 'settings' : group.key, group, item };
    }
  }
  return best;
}

/** Welcher Eintrag der Schiene markiert ist: 'home' auf '/', sonst der Bereich des Treffers. */
export function activeRailKey(groups: NavGroup[], pathname: string): string | null {
  if (pathname === '/') return 'home';
  return locate(groups, pathname)?.area ?? null;
}
```

- [x] **Step 4: Grün**

Run: `cd apps/kompass && npx vitest run tests/navigation.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/kompass/src/lib/navigation.ts apps/kompass/tests/navigation.test.ts
git commit -m "feat(shell): locate() finds the longest visible navigation entry for a path, and names the rail area"
```

---

### Task 3: `buildRail()`

**Files:**
- Modify: `apps/kompass/src/lib/navigation.ts`
- Test: `apps/kompass/tests/navigation.test.ts`

**Interfaces:**
- Consumes: `NavGroup` (mit `icon`), `SETTINGS_GROUPS` (Task 2).
- Produces:
  ```ts
  export interface RailEntry { key: string; href: string; icon: string; labelKey: string }
  export function buildRail(groups: NavGroup[]): RailEntry[]
  ```
  Reihenfolge: `home`, Modulgruppen mit sichtbarem Eintrag, `settings`. `icon` für Module: `group.icon ?? erstes sichtbares Item-Icon`; `settings` hat `icon: 'settings'`, `labelKey: 'nav.settingsArea'`.

- [x] **Step 1: Tests schreiben**

Import um `buildRail` ergänzen. Am Dateiende:

```ts
describe('buildRail', () => {
  it('lists home, one row per module, then settings behind them', () => {
    expect(buildRail(FIXTURE).map((e) => [e.key, e.href, e.icon, e.labelKey])).toEqual([
      ['home', '/', 'home', 'nav.home'],
      ['site', '/site/template', 'globe', 'nav.groups.site'],
      ['dms', '/dms', 'file', 'nav.groups.dms'],
      ['settings', '/admin/users', 'settings', 'nav.settingsArea'],
    ]);
  });

  it('falls back to the first visible item icon when the module names none', () => {
    const groups: NavGroup[] = [{ key: 'dms', labelKey: 'nav.groups.dms', disabled: false, items: [item('dms.list', '/dms', 'file')] }];
    expect(buildRail(groups).find((e) => e.key === 'dms')!.icon).toBe('file');
  });

  it('leaves out a module whose entries are all hidden, and points settings at the first visible entry', () => {
    const groups: NavGroup[] = [
      { key: 'admin', labelKey: 'nav.groups.admin', disabled: false, items: [item('users', '/admin/users', 'users', { visible: false }), item('media', '/admin/media', 'image')] },
      { key: 'config', labelKey: 'nav.groups.config', disabled: false, items: [item('themes', '/admin/themes', 'droplet', { visible: false })] },
      { key: 'dms', labelKey: 'nav.groups.dms', disabled: false, items: [item('dms.list', '/dms', 'file', { visible: false })] },
    ];
    expect(buildRail(groups).map((e) => [e.key, e.href])).toEqual([
      ['home', '/'],
      ['settings', '/admin/media'],
    ]);
  });

  it('has no settings entry when neither admin nor config shows anything', () => {
    const groups: NavGroup[] = [
      { key: 'admin', labelKey: 'nav.groups.admin', disabled: false, items: [item('users', '/admin/users', 'users', { visible: false })] },
      { key: 'config', labelKey: 'nav.groups.config', disabled: false, items: [] },
      { key: 'dms', labelKey: 'nav.groups.dms', disabled: false, items: [item('dms.list', '/dms', 'file')] },
    ];
    expect(buildRail(groups).map((e) => e.key)).toEqual(['home', 'dms']);
  });
});
```

- [x] **Step 2: Rot**

Run: `cd apps/kompass && npx vitest run tests/navigation.test.ts`
Expected: FAIL — `buildRail` nicht exportiert.

- [x] **Step 3: Implementieren**

Am Ende von `navigation.ts`:

```ts
/** Ein Eintrag der Schiene: ein Bereich, nicht eine Seite. */
export interface RailEntry {
  /** Modul-Key, 'home' oder 'settings'. */
  key: string;
  href: string;
  /** Key aus der ICONS-Whitelist in `rail.tsx`. */
  icon: string;
  /** 'nav.home' | 'nav.groups.<key>' | 'nav.settingsArea' */
  labelKey: string;
}

const firstVisible = (group: NavGroup): NavItem | undefined => group.items.find((i) => i.visible);

/**
 * Eine Zeile je Bereich: Startseite, dann jedes Modul mit mindestens einem
 * sichtbaren Eintrag, zuletzt Einstellungen — und die nur, wenn Verwaltung oder
 * Einrichtung etwas Sichtbares haben. Kein festes `/admin`: Wer nur
 * `media.upload` hat, landete sonst auf einer verbotenen Seite.
 */
export function buildRail(groups: NavGroup[]): RailEntry[] {
  const rail: RailEntry[] = [{ key: 'home', href: '/', icon: 'home', labelKey: 'nav.home' }];
  for (const group of groups) {
    if (SETTINGS_GROUPS.has(group.key)) continue;
    const first = firstVisible(group);
    if (!first) continue;
    rail.push({ key: group.key, href: first.href, icon: group.icon ?? first.icon, labelKey: group.labelKey });
  }
  const settingsTarget = ['admin', 'config']
    .map((key) => groups.find((g) => g.key === key))
    .map((group) => (group ? firstVisible(group) : undefined))
    .find((entry) => entry !== undefined);
  if (settingsTarget) rail.push({ key: 'settings', href: settingsTarget.href, icon: 'settings', labelKey: 'nav.settingsArea' });
  return rail;
}
```

- [x] **Step 4: Grün**

Run: `cd apps/kompass && npx vitest run tests/navigation.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/kompass/src/lib/navigation.ts apps/kompass/tests/navigation.test.ts
git commit -m "feat(shell): buildRail() turns the navigation groups into one rail row per area"
```

---

### Task 4: `sectionsFor()` und `crumbsFor()`

**Files:**
- Modify: `apps/kompass/src/lib/navigation.ts`
- Test: `apps/kompass/tests/navigation.test.ts`

**Interfaces:**
- Consumes: `locate` (Task 2).
- Produces:
  ```ts
  export interface NavSection { key: string; labelKey?: string; items: NavItem[] }
  export function sectionsFor(groups: NavGroup[], pathname: string): NavSection[]
  export function crumbsFor(groups: NavGroup[], pathname: string, t: (key: string) => string): string[]
  ```

- [x] **Step 1: Tests schreiben**

Import um `crumbsFor, sectionsFor` ergänzen. Am Dateiende:

```ts
describe('sectionsFor', () => {
  it('gives a module one section without heading, visible entries only', () => {
    const groups: NavGroup[] = [{ ...FIXTURE[2]!, items: [...FIXTURE[2]!.items, item('site.publish', '/site/publish', 'upload', { visible: false })] }];
    const sections = sectionsFor(groups, '/site/c/artikel');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.labelKey).toBeUndefined();
    expect(sections[0]!.items.map((i) => i.key)).toEqual(['site.template', 'site.c.artikel']);
  });

  it('gives settings two headed sections and drops an empty one', () => {
    expect(sectionsFor(FIXTURE, '/admin/themes').map((s) => [s.key, s.labelKey, s.items.length])).toEqual([
      ['admin', 'nav.groups.admin', 2],
      ['config', 'nav.groups.config', 3],
    ]);
    const onlyConfig: NavGroup[] = [{ ...FIXTURE[0]!, items: [item('users', '/admin/users', 'users', { visible: false })] }, FIXTURE[1]!];
    expect(sectionsFor(onlyConfig, '/admin/themes').map((s) => s.key)).toEqual(['config']);
  });

  it('is empty on the home page, the profile and unknown paths', () => {
    expect(sectionsFor(FIXTURE, '/')).toEqual([]);
    expect(sectionsFor(FIXTURE, '/profile')).toEqual([]);
    expect(sectionsFor(FIXTURE, '/nirgends')).toEqual([]);
  });
});

describe('crumbsFor', () => {
  const t = (key: string) =>
    ({
      'nav.home': 'Startseite',
      'nav.profile': 'Profil',
      'nav.settingsArea': 'Einstellungen',
      'nav.groups.admin': 'Verwaltung',
      'nav.groups.config': 'Einrichtung',
      'nav.groups.site': 'Webseite',
      'nav.groups.dms': 'Akte',
      'nav.themes': 'Themes',
      'nav.site.template': 'Template',
      'nav.dms.list': 'Akte',
    })[key] ?? key;

  it('names home and profile with one segment', () => {
    expect(crumbsFor(FIXTURE, '/', t)).toEqual(['Startseite']);
    expect(crumbsFor(FIXTURE, '/profile/tokens', t)).toEqual(['Profil']);
  });

  it('names module and page, using the data label when there is one', () => {
    expect(crumbsFor(FIXTURE, '/site/template', t)).toEqual(['Webseite', 'Template']);
    expect(crumbsFor(FIXTURE, '/site/c/artikel', t)).toEqual(['Webseite', 'Artikel']);
  });

  it('collapses module and page when they read the same', () => {
    expect(crumbsFor(FIXTURE, '/dms/01J', t)).toEqual(['Akte']);
  });

  it('gives settings three segments', () => {
    expect(crumbsFor(FIXTURE, '/admin/themes', t)).toEqual(['Einstellungen', 'Einrichtung', 'Themes']);
  });

  it('is empty when nothing matches', () => {
    expect(crumbsFor(FIXTURE, '/nirgends', t)).toEqual([]);
  });
});
```

- [x] **Step 2: Rot**

Run: `cd apps/kompass && npx vitest run tests/navigation.test.ts`
Expected: FAIL — `sectionsFor` / `crumbsFor` nicht exportiert.

- [x] **Step 3: Implementieren**

Am Ende von `navigation.ts`:

```ts
/** Ein Abschnitt der Zweitebene; die Überschrift fehlt, wenn ein Bereich nur einen hat. */
export interface NavSection {
  key: string;
  labelKey?: string;
  /** Nur sichtbare Einträge. */
  items: NavItem[];
}

const visibleItems = (group: NavGroup): NavItem[] => group.items.filter((i) => i.visible);

/**
 * Die Abschnitte der Zweitebene zum Pfad: Einstellungen zeigt Verwaltung und
 * Einrichtung mit Überschrift, ein Modul einen Abschnitt ohne. Leer heißt:
 * keine Zweitebene, die Spalte entfällt.
 */
export function sectionsFor(groups: NavGroup[], pathname: string): NavSection[] {
  const hit = locate(groups, pathname);
  if (!hit) return [];
  if (hit.area === 'settings') {
    return ['admin', 'config']
      .map((key) => groups.find((g) => g.key === key))
      .filter((group): group is NavGroup => group !== undefined && visibleItems(group).length > 0)
      .map((group) => ({ key: group.key, labelKey: group.labelKey, items: visibleItems(group) }));
  }
  return [{ key: hit.group.key, items: visibleItems(hit.group) }];
}

/**
 * Die Brotkrume der Kopfleiste. Das letzte Segment ist das `<h1>` der Seite.
 * Heißen Modul und Seite gleich (Kontakte / Kontakte), bleibt ein Segment.
 */
export function crumbsFor(groups: NavGroup[], pathname: string, t: (key: string) => string): string[] {
  if (pathname === '/') return [t('nav.home')];
  if (matches('/profile', pathname)) return [t('nav.profile')];
  const hit = locate(groups, pathname);
  if (!hit) return [];
  const page = hit.item.label ?? t(hit.item.labelKey);
  const area = t(hit.group.labelKey);
  if (hit.area === 'settings') return [t('nav.settingsArea'), area, page];
  return page === area ? [page] : [area, page];
}
```

- [x] **Step 4: Grün und Typecheck**

Run: `cd apps/kompass && npx vitest run tests/navigation.test.ts && cd ../.. && pnpm typecheck`
Expected: PASS, kein Typfehler.

- [x] **Step 5: Commit**

```bash
git add apps/kompass/src/lib/navigation.ts apps/kompass/tests/navigation.test.ts
git commit -m "feat(shell): sectionsFor() and crumbsFor() derive the second level and the breadcrumb from locate()"
```

---

### Task 5: Neue Texte und die neue Shell-E2E (rot bis Task 9)

**Files:**
- Modify: `apps/kompass/messages/de.json` (Objekt `nav`, um Zeile 244)
- Rewrite: `apps/kompass/e2e/shell.spec.ts`

**Interfaces:**
- Produces: Schlüssel `nav.settingsArea` = „Einstellungen", `nav.sectionAria` = „Unternavigation". Die E2E beschreibt den Zielzustand aus Spec § 14 und ist bis Task 9 rot — das ist gewollt; sie ist die Abnahme.

- [x] **Step 1: Schlüssel anlegen**

In `apps/kompass/messages/de.json`, im Objekt `"nav"`, direkt nach `"profile": "Profil",` einfügen:

```json
    "settingsArea": "Einstellungen",
    "sectionAria": "Unternavigation",
```

`"collapse": "Navigation einklappen"` bleibt vorerst stehen (Sidebar benutzt es bis Task 9).

- [x] **Step 2: `shell.spec.ts` ersetzen**

Gesamten Inhalt von `apps/kompass/e2e/shell.spec.ts` ersetzen durch:

```ts
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test.describe('app shell', () => {
  test.beforeEach(async ({ page }) => {
    await resetDatabase(page, 'seeded');
    await loginAsAdmin(page);
  });

  test('shows one rail row per area, home on top and settings behind a line', async ({ page }) => {
    await expect(page.getByTestId('env-banner')).toContainText('TESTUMGEBUNG');
    const rail = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(rail.getByRole('link')).toHaveText(['Startseite', 'Webseite', 'Projekte', 'Tiere', 'Kontakte', 'Akte', 'Einstellungen']);
    // Seiten stehen nicht in der Schiene — weder aus Verwaltung noch aus einem Modul.
    await expect(rail.getByRole('link', { name: 'Nutzer' })).toHaveCount(0);
    await expect(rail.getByRole('link', { name: 'Hunde' })).toHaveCount(0);
    await expect(rail).toHaveCSS('width', '88px');
    // Auf der Startseite gibt es keine Zweitebene.
    await expect(page.getByRole('navigation', { name: 'Unternavigation' })).toHaveCount(0);
  });

  test('puts organisation, user menu and build into the top bar', async ({ page }) => {
    const banner = page.getByRole('banner');
    await expect(banner.getByText('Musterverein e.V.')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).getByText('Musterverein e.V.')).toHaveCount(0);
    await banner.getByRole('button', { name: 'Nutzermenü' }).click();
    await expect(page.getByRole('menu').getByText(/^Build /)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('marks the area in the rail and the page in the second level', async ({ page }) => {
    await page.goto('/animals');
    const rail = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(rail.getByRole('link', { name: 'Tiere' })).toHaveAttribute('aria-current', 'page');
    await expect(rail.getByRole('link', { name: 'Startseite' })).not.toHaveAttribute('aria-current', 'page');
    const sections = page.getByRole('navigation', { name: 'Unternavigation' });
    await expect(sections).toHaveCSS('width', '208px');
    await expect(sections.getByRole('link', { name: 'Hunde' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hunde');
  });

  test('keeps the module marked under a website collection', async ({ page }) => {
    // Sammlungen gibt es erst mit eingelesenem Template — derselbe Weg wie in
    // `site-template.spec.ts`; das Basis-Template bringt die Sammlung „Aktuelles“ mit.
    await page.goto('/site/template');
    await page.getByRole('button', { name: 'Template einlesen' }).click();
    await expect(page.getByRole('region', { name: 'Befunde' })).toBeVisible();
    await page.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.getByRole('status')).toContainText('eingelesen');

    const sections = page.getByRole('navigation', { name: 'Unternavigation' });
    await sections.getByRole('link', { name: 'Aktuelles' }).click();
    await expect(page).toHaveURL('/site/c/news');
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Webseite' })).toHaveAttribute('aria-current', 'page');
    await expect(sections.getByRole('link', { name: 'Aktuelles' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aktuelles');
    await expect(page.getByRole('banner')).toContainText('Webseite');
  });

  test('opens settings as one area with two headed sections', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Einstellungen' }).click();
    await expect(page).toHaveURL('/admin/users');
    const sections = page.getByRole('navigation', { name: 'Unternavigation' });
    await expect(sections.getByText('Verwaltung')).toBeVisible();
    await expect(sections.getByText('Einrichtung')).toBeVisible();
    for (const label of ['Nutzer', 'Rollen', 'Änderungsprotokoll', 'Aufbewahrung', 'Mediathek', 'Backup', 'Verein', 'Sprachen', 'Themes', 'Module', 'Dokumente', 'Akte einrichten']) {
      await expect(sections.getByRole('link', { name: label })).toBeVisible();
    }
    await sections.getByRole('link', { name: 'Themes' }).click();
    await expect(page.getByRole('banner')).toContainText('Einstellungen');
    await expect(page.getByRole('banner')).toContainText('Einrichtung');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Themes');
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Einstellungen' })).toHaveAttribute('aria-current', 'page');
  });

  test('the command palette still finds pages of modules and settings', async ({ page }) => {
    await expect(page.locator('body[data-command-palette="ready"]')).toBeAttached();
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Befehlspalette' });
    await palette.getByRole('combobox').fill('Hunde');
    await expect(palette.getByRole('option', { name: /Hunde/ })).toBeVisible();
    await palette.getByRole('combobox').fill('Themes');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/admin/themes');
  });

  test('switches colour scheme from the user menu and logs out', async ({ page }) => {
    await page.getByRole('button', { name: 'Nutzermenü' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Dunkles Design' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-color-scheme', 'dark');
    await page.getByRole('button', { name: 'Nutzermenü' }).click();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL('/login');
  });

  test('turns into a drawer below 1180px with labelled areas and the second level beneath', async ({ page }) => {
    await page.goto('/animals');
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeHidden();
    await page.getByRole('button', { name: 'Navigation öffnen' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Tiere' })).toBeVisible();
    await expect(dialog.getByRole('navigation', { name: 'Unternavigation' }).getByRole('link', { name: 'Hunde' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
```

Hinweis zur Reihenfolge der Schiene im ersten Test: Sie folgt der Reihenfolge der Manifeste in der Registry (`deps.registry.manifests`). Weicht die tatsächliche Reihenfolge ab, die Erwartung an die Registry anpassen — nicht die Registry.

- [x] **Step 3: Unit-Tests bleiben grün (die Sprachdatei wird geprüft)**

Run: `cd apps/kompass && npx vitest run tests/message-keys.test.ts`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add apps/kompass/messages/de.json apps/kompass/e2e/shell.spec.ts
git commit -m "test(e2e): the shell spec describes the rail, the second level and the full-width top bar (red until the shell is rebuilt)"
```

---

### Task 6: `Rail` — die Schiene

**Files:**
- Create: `apps/kompass/src/components/shell/rail.tsx`

**Interfaces:**
- Consumes: `RailEntry` (Task 3), `cn` aus `@/lib/utils`, `useTranslations` aus `next-intl`.
- Produces:
  ```ts
  export const ICONS: Record<string, LucideIcon>
  export function Rail(props: { entries: RailEntry[]; active: string | null; variant: 'rail' | 'list'; onClose?: () => void }): JSX.Element
  ```
  `variant: 'rail'` = feste 88-px-Schiene mit Wort unter dem Icon; `'list'` = Zeilen mit Wort rechts (im Drawer).

- [x] **Step 1: Datei anlegen**

`apps/kompass/src/components/shell/rail.tsx`:

```tsx
'use client';

import { Clock, Contact, Database, Droplet, Euro, File, FileText, Folder, Globe, Grid2x2, Home, Hourglass, Image, LayoutTemplate, Languages, List, PawPrint, Settings, Shield, SlidersHorizontal, Upload, Users, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { RailEntry } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Die Whitelist der Symbole. Ein Manifest nennt einen Key von hier
 * (`NavigationItem.icon`, `ModuleManifest.moduleIcon`); ein unbekannter Key
 * fällt auf `Home` zurück, statt die Schale zu brechen.
 */
export const ICONS: Record<string, LucideIcon> = {
  users: Users,
  shield: Shield,
  sliders: SlidersHorizontal,
  languages: Languages,
  droplet: Droplet,
  grid: Grid2x2,
  clock: Clock,
  'file-text': FileText,
  file: File,
  image: Image,
  database: Database,
  euro: Euro,
  home: Home,
  folder: Folder,
  'paw-print': PawPrint,
  'layout-template': LayoutTemplate,
  upload: Upload,
  list: List,
  contact: Contact,
  hourglass: Hourglass,
  globe: Globe,
  settings: Settings,
};

export interface RailProps {
  entries: RailEntry[];
  /** Key des markierten Eintrags (`activeRailKey`). */
  active: string | null;
  /** `rail`: 88 px fest, Wort unter dem Icon. `list`: Zeilen im Drawer. */
  variant: 'rail' | 'list';
  onClose?: () => void;
}

/**
 * Eine Zeile je Bereich. Die Schiene trägt die Marke (Streifen links); die
 * Zweitebene trägt die Auswahl. Vor „Einstellungen“ eine Linie und `mt-auto`,
 * damit der Bereich unten steht, egal wie viele Module es gibt.
 */
export function Rail({ entries, active, variant, onClose }: RailProps) {
  const t = useTranslations();
  const rail = variant === 'rail';
  return (
    <nav
      aria-label={t('nav.aria')}
      className={cn('flex shrink-0 flex-col gap-0.5 overflow-y-auto py-2', rail ? 'w-[88px] border-r border-line bg-sidebar' : 'px-2')}
    >
      {entries.map((entry) => {
        const Icon = ICONS[entry.icon] ?? Home;
        const isActive = entry.key === active;
        const isSettings = entry.key === 'settings';
        return (
          <div key={entry.key} className={cn('flex flex-col gap-0.5', isSettings && rail && 'mt-auto')}>
            {isSettings ? <div className={cn('my-1 h-px bg-line', rail ? 'mx-auto w-10' : 'mx-2.5')} aria-hidden /> : null}
            <Link
              href={entry.href}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onClose?.()}
              className={cn(
                'flex items-center rounded-md',
                rail ? 'mx-auto h-[52px] w-[76px] flex-col justify-center gap-1' : 'h-[34px] gap-2.5 px-2.5',
                isActive ? 'bg-brand-soft font-semibold text-brand-ink shadow-[inset_2px_0_0_var(--color-primary)]' : 'text-ink-2 hover:bg-hover hover:text-ink',
              )}
            >
              <Icon className={cn('shrink-0', rail ? 'size-5' : 'size-4', isActive ? 'text-brand-ink' : 'text-muted-ink')} aria-hidden />
              <span className={cn('truncate', rail ? 'max-w-full px-1 text-[11px] leading-none' : 'text-[14px]')}>{t(entry.labelKey)}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
```

- [x] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: ohne Fehler. (`t(entry.labelKey)` ist ein dynamischer Schlüssel; `message-keys.test.ts` prüft nur feste.)

- [x] **Step 3: Commit**

```bash
git add apps/kompass/src/components/shell/rail.tsx
git commit -m "feat(shell): the rail — one labelled row per area, fixed at 88 px, settings behind a line"
```

---

### Task 7: `SectionNav` — die Zweitebene

**Files:**
- Create: `apps/kompass/src/components/shell/section-nav.tsx`

**Interfaces:**
- Consumes: `NavSection` (Task 4).
- Produces:
  ```ts
  export function SectionNav(props: { sections: NavSection[]; activeHref: string | null; variant: 'column' | 'list'; onClose?: () => void }): JSX.Element | null
  ```
  Rendert `null` bei leeren `sections`. `activeHref` ist `locate(...)?.item.href`.

- [x] **Step 1: Datei anlegen**

`apps/kompass/src/components/shell/section-nav.tsx`:

```tsx
'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { NavSection } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export interface SectionNavProps {
  sections: NavSection[];
  /** `href` des Eintrags, auf dem die Seite liegt (`locate().item.href`). */
  activeHref: string | null;
  /** `column`: 208 px neben der Schiene. `list`: unter der Schiene im Drawer. */
  variant: 'column' | 'list';
  onClose?: () => void;
}

/**
 * Die Seiten des aktiven Bereichs. Kein Icon (die Symbole tragen die
 * Bereiche), kein Aufklappen, keine Zähler. Aktiv ist die Auswahl
 * (`bg-selected`), nicht die Marke — die trägt die Schiene.
 */
export function SectionNav({ sections, activeHref, variant, onClose }: SectionNavProps) {
  const t = useTranslations();
  if (sections.length === 0) return null;
  return (
    <nav
      aria-label={t('nav.sectionAria')}
      className={cn('flex shrink-0 flex-col gap-0.5 p-2', variant === 'column' && 'w-52 overflow-y-auto border-r border-line bg-bg')}
    >
      {sections.map((section, index) => (
        <div key={section.key} className={cn('flex flex-col gap-0.5', index > 0 && 'mt-3')}>
          {section.labelKey ? (
            <div className="flex h-7 items-center px-2.5 text-[11px] font-bold uppercase tracking-[.09em] text-muted-ink">{t(section.labelKey)}</div>
          ) : null}
          {section.items.map((item) => {
            const isActive = item.href === activeHref;
            return (
              <div key={item.key} className="flex flex-col gap-0.5">
                {item.sectionBreak ? <div className="mx-2.5 my-1 h-px bg-line" aria-hidden /> : null}
                <Link
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onClose?.()}
                  className={cn(
                    'flex h-8 items-center rounded-md px-2.5 text-[14px]',
                    isActive ? 'bg-selected font-semibold text-selected-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
                  )}
                >
                  <span className="truncate">{item.label ?? t(item.labelKey)}</span>
                </Link>
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
```

- [x] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: ohne Fehler.

- [x] **Step 3: Commit**

```bash
git add apps/kompass/src/components/shell/section-nav.tsx
git commit -m "feat(shell): the second level — the pages of the active area as headed sections, no icons, no folding"
```

---

### Task 8: `Topbar` und `UserMenu`

**Files:**
- Rewrite: `apps/kompass/src/components/shell/topbar.tsx`
- Rewrite: `apps/kompass/src/components/shell/user-menu.tsx`

**Interfaces:**
- Consumes: `initials`, `cn` aus `@/lib/utils`; `usePreference` (für `colorScheme`, `density` — unverändert); Dropdown-Bausteine aus `@/components/ui/dropdown-menu`.
- Produces:
  ```ts
  export interface UserMenuProps { user: { name: string; roleNames: string[] }; build: string }
  export function UserMenu(props: UserMenuProps): JSX.Element
  export function Topbar(props: { organization: string; logoUrl: string | null; crumbs: string[]; user: UserMenuProps['user']; build: string; drawer: boolean; onOpenDrawer: () => void; onSearch: () => void }): JSX.Element
  ```
  Bis Task 9 verwendet `sidebar.tsx` noch das alte `UserMenu` mit `collapsed`/`trigger` — deshalb wird `sidebar.tsx` in **diesem** Task ebenfalls auf die neue Signatur gebracht, damit der Typecheck zwischen den Tasks grün bleibt.

- [x] **Step 1: `user-menu.tsx` ersetzen**

```tsx
'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { usePreference } from '@/lib/preferences';
import { initials } from '@/lib/utils';

export interface UserMenuProps {
  user: { name: string; roleNames: string[] };
  build: string;
}

/**
 * Sitzt rechts in der Kopfleiste und klappt nach unten. Die Build-Zeile steht
 * als letzte, nicht klickbare Zeile hier, weil der Sidebar-Fuß, der sie trug,
 * entfallen ist.
 */
export function UserMenu({ user, build }: UserMenuProps) {
  const t = useTranslations('shell.userMenu');
  const shell = useTranslations('shell');
  const [scheme, setScheme] = usePreference('colorScheme');
  const [density, setDensity] = usePreference('density');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" aria-label={t('aria')} className="flex h-[38px] max-w-60 items-center gap-2 rounded-md px-1.5 hover:bg-hover">
            <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-brand text-[12px] font-bold text-on-brand">{initials(user.name)}</span>
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className="block truncate text-[13px] font-semibold">{user.name}</span>
              <span className="block truncate text-[11px] text-muted-ink">{user.roleNames.join(', ') || t('noRole')}</span>
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-ink" aria-hidden />
          </button>
        }
      />
      <DropdownMenuContent side="bottom" align="end" className="w-56 bg-surface shadow-md">
        <DropdownMenuItem render={<Link href="/profile" />}>{t('profile')}</DropdownMenuItem>
        <DropdownMenuCheckboxItem checked={scheme === 'dark'} onCheckedChange={(checked) => setScheme(checked ? 'dark' : 'light')}>{t('dark')}</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={density} onValueChange={(v) => setDensity(v as typeof density)}>
          <DropdownMenuRadioItem value="compact">{t('densityCompact')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="default">{t('densityDefault')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">{t('densityComfortable')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <form action="/logout" method="post">
          <DropdownMenuItem nativeButton render={<button type="submit" className="w-full text-left" />}>{t('logout')}</DropdownMenuItem>
        </form>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[10px] text-muted-ink">{shell('build', { id: build })}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [x] **Step 2: `topbar.tsx` ersetzen**

```tsx
'use client';

import { Menu, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { UserMenu, type UserMenuProps } from './user-menu';

export interface TopbarProps {
  organization: string;
  logoUrl: string | null;
  /** Brotkrume; das letzte Segment ist das `<h1>` der Seite. */
  crumbs: string[];
  user: UserMenuProps['user'];
  build: string;
  drawer: boolean;
  onOpenDrawer: () => void;
  onSearch: () => void;
}

/**
 * Läuft über die volle Breite und trägt, was die Sidebar abgegeben hat: Logo,
 * Vereinsname, Nutzermenü. Der Menüknopf erscheint nur im Drawer-Modus — im
 * festen Rahmen gibt es nichts zu klappen.
 */
export function Topbar({ organization, logoUrl, crumbs, user, build, drawer, onOpenDrawer, onSearch }: TopbarProps) {
  const t = useTranslations();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3.5 border-b border-line bg-topbar px-4">
      {drawer ? (
        <button type="button" onClick={onOpenDrawer} aria-label={t('shell.topbar.openNav')} className="flex size-[30px] shrink-0 items-center justify-center rounded-sm hover:bg-hover">
          <Menu className="size-4" />
        </button>
      ) : null}
      <div className="flex h-[30px] shrink-0 items-center gap-2.5 border-r border-line pr-3.5">
        {logoUrl ? (
          <img src={logoUrl} alt={t('nav.logoAlt')} className="size-[26px] shrink-0 rounded-sm object-contain" />
        ) : (
          <div className="flex size-[26px] shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong text-[9px] text-muted-ink-2" aria-hidden>LOGO</div>
        )}
        <span className="max-w-60 truncate text-[14px] font-semibold">{organization}</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px]">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={`${index}-${crumb}`}>
              {index > 0 ? <span className="text-muted-ink-2" aria-hidden>/</span> : null}
              {last ? <h1 className="min-w-0 truncate text-[14px] font-semibold">{crumb}</h1> : <span className="min-w-0 truncate text-muted-ink">{crumb}</span>}
            </Fragment>
          );
        })}
      </div>
      <button type="button" onClick={onSearch} className="flex h-8 w-60 shrink-0 items-center gap-2 rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-placeholder">
        <Search className="size-3.5" aria-hidden />
        <span className="flex-1 text-left">{t('shell.topbar.search')}</span>
        <kbd className="rounded-[3px] border border-line px-1 font-mono text-[11px]">⌘K</kbd>
      </button>
      <UserMenu user={user} build={build} />
    </header>
  );
}
```

- [x] **Step 3: `sidebar.tsx` übergangsweise an die neue `UserMenu`-Signatur anpassen**

In `apps/kompass/src/components/shell/sidebar.tsx` den Fuß-Block ersetzen. Alt:

```tsx
      <div className="border-t border-line p-2">
        <UserMenu user={user} collapsed={collapsed} trigger={<ChevronUp className="size-3.5" aria-hidden />} />
        {collapsed ? null : (
          <p className="px-2 pt-1.5 text-[10px] text-muted-ink" title={t('app.name')}>
            {t('shell.build', { id: build })}
          </p>
        )}
      </div>
```

Neu:

```tsx
      <div className="border-t border-line p-2">
        <UserMenu user={user} build={build} />
      </div>
```

Und `ChevronUp` aus dem `lucide-react`-Import der Datei entfernen. (Die Datei wird in Task 9 gelöscht; das hier hält nur den Typecheck grün.)

- [x] **Step 4: Typecheck und Schlüsseltest**

Run: `pnpm typecheck && cd apps/kompass && npx vitest run tests/message-keys.test.ts tests/no-hardcoded-ui-text.test.ts`
Expected: ohne Fehler, beide PASS.

- [x] **Step 5: Commit**

```bash
git add apps/kompass/src/components/shell/topbar.tsx apps/kompass/src/components/shell/user-menu.tsx apps/kompass/src/components/shell/sidebar.tsx
git commit -m "feat(shell): the top bar carries logo, organisation, breadcrumb with the page h1 and the user menu, which drops down and shows the build"
```

---

### Task 9: `ShellFrame` verdrahten, Sidebar und Präferenzen entfernen — Shell-E2E grün

**Files:**
- Rewrite: `apps/kompass/src/components/shell/shell-frame.tsx`
- Delete: `apps/kompass/src/components/shell/sidebar.tsx`
- Modify: `apps/kompass/src/lib/preferences.ts` (`Prefs`, `DEFAULTS`)
- Modify: `apps/kompass/messages/de.json` (`nav.collapse`, `shell.topbar.expandNav` entfernen)
- Test: `apps/kompass/e2e/shell.spec.ts` (aus Task 5)

**Interfaces:**
- Consumes: `buildRail`, `activeRailKey`, `sectionsFor`, `crumbsFor`, `locate` (Tasks 2–4); `Rail` (6), `SectionNav` (7), `Topbar` (8).
- Produces: `ShellFrame` mit unveränderter Props-Signatur (`layout.tsx` bleibt unberührt).

- [x] **Step 1: `shell-frame.tsx` ersetzen**

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { activeRailKey, buildRail, crumbsFor, locate, sectionsFor, type NavGroup } from '@/lib/navigation';
import { CommandPalette } from './command-palette';
import { Rail } from './rail';
import { SectionNav } from './section-nav';
import { Topbar } from './topbar';

export const DRAWER_BREAKPOINT = 1180;

export function ShellFrame({ organization, logoUrl, groups, build, user, permissions, children }: { organization: string; logoUrl: string | null; groups: NavGroup[]; build: string; user: { name: string; roleNames: string[] }; permissions: string[]; children: ReactNode }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const media = matchMedia(`(max-width: ${DRAWER_BREAKPOINT - 1}px)`);
    const sync = () => setDrawer(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // Eine Ortsbestimmung, vier Ableitungen — damit Schiene, Zweitebene und
  // Brotkrume nie verschiedener Meinung sind, auf welcher Seite wir stehen.
  const rail = useMemo(() => buildRail(groups), [groups]);
  const active = useMemo(() => activeRailKey(groups, pathname), [groups, pathname]);
  const sections = useMemo(() => sectionsFor(groups, pathname), [groups, pathname]);
  const activeHref = useMemo(() => locate(groups, pathname)?.item.href ?? null, [groups, pathname]);
  const crumbs = useMemo(() => crumbsFor(groups, pathname, t), [groups, pathname, t]);
  const openPalette = () => window.dispatchEvent(new CustomEvent('kompass:command-palette'));
  const closeDrawer = () => setDrawerOpen(false);

  return (
    <>
      <CommandPalette groups={groups} permissions={permissions} />
      <div className="flex min-h-0 flex-1 flex-col">
        <Topbar organization={organization} logoUrl={logoUrl} crumbs={crumbs} user={user} build={build} drawer={drawer} onOpenDrawer={() => setDrawerOpen(true)} onSearch={openPalette} />
        <div className="flex min-h-0 flex-1">
          {drawer ? (
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetContent side="left" className="w-[280px] gap-0 overflow-y-auto p-0 pt-10 shadow-md">
                <SheetTitle className="sr-only">{t('nav.aria')}</SheetTitle>
                <Rail entries={rail} active={active} variant="list" onClose={closeDrawer} />
                <SectionNav sections={sections} activeHref={activeHref} variant="list" onClose={closeDrawer} />
              </SheetContent>
            </Sheet>
          ) : (
            <>
              <Rail entries={rail} active={active} variant="rail" />
              <SectionNav sections={sections} activeHref={activeHref} variant="column" />
            </>
          )}
          <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </>
  );
}
```

`TooltipProvider` entfällt: Die Schiene hat keine Tooltips mehr, und außerhalb der Shell benutzt niemand `@/components/ui/tooltip` (geprüft am 2026-09-14). Die Datei `tooltip.tsx` bleibt liegen.

- [x] **Step 2: `sidebar.tsx` löschen**

```bash
git rm apps/kompass/src/components/shell/sidebar.tsx
```

- [x] **Step 3: Präferenzen bereinigen**

In `apps/kompass/src/lib/preferences.ts` aus `type Prefs` die Zeilen `sidebarCollapsed: boolean;` und `navCollapsedGroups: string[];` entfernen, aus `DEFAULTS` die Zeilen `sidebarCollapsed: false,` und `navCollapsedGroups: [],`. Ergebnis:

```ts
type Prefs = {
  colorScheme: 'light' | 'dark';
  density: 'compact' | 'default' | 'comfortable';
  mediaView: 'list' | 'grid';
  /** Die Fälligkeitsliste der Startseite auf die eigenen beschränken. */
  dueOnlyMine: boolean;
  /** Der zuletzt im Auswahl-Dialog geöffnete Ordner; null = Alle Dateien. */
  mediaChooserFolder: string | null;
};
const DEFAULTS: Prefs = {
  colorScheme: 'light',
  density: 'default',
  mediaView: 'list',
  dueOnlyMine: false,
  mediaChooserFolder: null,
};
```

Bereits gespeicherte Schlüssel `kompass.sidebarCollapsed` / `kompass.navCollapsedGroups` im `localStorage` bleiben liegen und stören nicht.

- [x] **Step 4: Alte Schlüssel aus der Sprachdatei entfernen**

In `apps/kompass/messages/de.json`: die Zeile `"collapse": "Navigation einklappen",` im Objekt `nav` und die Zeile `"expandNav": "Navigation aufklappen"` im Objekt `shell.topbar` löschen. Achtung auf das Komma der vorangehenden Zeile in `shell.topbar` (`"openNav": "Navigation öffnen"` wird zur letzten Zeile — ohne Komma).

- [x] **Step 5: Typecheck und Unit-Tests**

Run: `pnpm typecheck && cd apps/kompass && npx vitest run`
Expected: ohne Fehler, alle Unit-Tests PASS (auch `message-keys`, `no-hardcoded-ui-text`).

- [x] **Step 6: Shell-E2E grün**

Run: `cd apps/kompass && npx playwright test e2e/shell.spec.ts`
Expected: alle acht Tests PASS. Schlägt der erste Test an der Reihenfolge der Schiene fehl, die Erwartung an die Registry-Reihenfolge anpassen (Hinweis in Task 5). Der Sammlungstest liest das Template selbst ein (wie `site-template.spec.ts`), weil der Seed das nicht tut.

- [x] **Step 7: Commit**

```bash
git add apps/kompass/src/components/shell/shell-frame.tsx apps/kompass/src/lib/preferences.ts apps/kompass/messages/de.json
git commit -m "feat(shell): the frame is top bar over rail, second level and content; the accordion sidebar and its preferences are gone"
```

(`git rm` aus Step 2 ist bereits gestaged.)

---

### Task 10: Übrige E2E anpassen und der Nutzer ohne Modulrechte

**Files:**
- Modify: `apps/kompass/e2e/modules.spec.ts` (Test „a deactivated module disappears from the sidebar", Zeilen 16–29)
- Modify: `apps/kompass/e2e/dms.spec.ts` (Test „verwaltet Dokumentarten und Regeln", um Zeile 425)
- Modify: `apps/kompass/e2e/shell.spec.ts` (ein Test dazu)

**Interfaces:**
- Consumes: Seed-Rolle „Kassenprüfer" (nur `backup.export`; `roles.spec.ts` verlässt sich darauf), den Nutzer-anlegen-Dialog (`/admin/users`, Muster aus `auth.spec.ts`).

- [x] **Step 1: `modules.spec.ts` — Schiene statt Sidebar-Link**

Den Test `a deactivated module disappears from the sidebar` ersetzen:

```ts
test('a deactivated module disappears from the rail', async ({ page }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  const rail = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await expect(rail.getByRole('link', { name: 'Tiere' })).toBeVisible();

  await page.goto('/admin/modules');
  await page.getByRole('switch', { name: 'Tiere aktivieren oder deaktivieren' }).click();
  await expect(page.getByText('5 von 6 aktiv')).toBeVisible();

  await page.goto('/');
  await expect(rail.getByRole('link', { name: 'Tiere' })).toHaveCount(0);
});
```

- [x] **Step 2: `dms.spec.ts` — „Akte einrichten" über Einstellungen**

Im Test `verwaltet Dokumentarten und Regeln` die Zeile

```ts
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Akte einrichten' }).click();
```

ersetzen durch:

```ts
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Einstellungen' }).click();
    await page.getByRole('navigation', { name: 'Unternavigation' }).getByRole('link', { name: 'Akte einrichten' }).click();
```

Der Kommentar darüber („Über die Navigation, nicht über die URL …") bleibt.

- [x] **Step 3: Nutzer ohne Modulrechte in `shell.spec.ts`**

Innerhalb von `test.describe('app shell', …)` als letzten Test einfügen:

```ts
  test('a user without module rights sees neither the modules nor an admin page she may not open', async ({ page }) => {
    // Kassenprüfer ist eine Seed-Rolle mit genau einem Recht: backup.export.
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Kassenprüfer').check();
    await dialog.getByLabel('Name').fill('Lea Prüfer');
    await dialog.getByLabel('E-Mail').fill('lea@example.org');
    await dialog.getByRole('button', { name: 'Nutzer anlegen' }).click();
    const startPassword = (await page.getByTestId('start-password').textContent())!.trim();
    await page.getByRole('button', { name: 'Ich habe die Daten notiert' }).click();
    await page.request.post('/logout');

    await page.goto('/login');
    await page.getByLabel('E-Mail').fill('lea@example.org');
    await page.getByLabel('Passwort').fill(startPassword);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL('/password');
    await page.getByLabel('Startpasswort').fill(startPassword);
    await page.getByLabel('Neues Passwort', { exact: true }).fill('lea-prueft-die-kasse-2026');
    await page.getByLabel('Passwort wiederholen').fill('lea-prueft-die-kasse-2026');
    await page.getByRole('button', { name: 'Passwort setzen und fortfahren' }).click();
    await expect(page).toHaveURL('/');

    const rail = page.getByRole('navigation', { name: 'Hauptnavigation' });
    await expect(rail.getByRole('link')).toHaveText(['Startseite', 'Einstellungen']);
    await expect(rail.getByRole('link', { name: 'Einstellungen' })).toHaveAttribute('href', '/admin/backup');
    await rail.getByRole('link', { name: 'Einstellungen' }).click();
    await expect(page).toHaveURL('/admin/backup');
    const sections = page.getByRole('navigation', { name: 'Unternavigation' });
    await expect(sections.getByRole('link')).toHaveText(['Backup']);
    await expect(sections.getByText('Einrichtung')).toHaveCount(0);
  });
```

Trägt die Seed-Rolle „Kassenprüfer" in der Testumgebung mehr als `backup.export` (`roles.spec.ts`, Test „lists roles …", zeigt den Stand), die Erwartungen an `sections` entsprechend erweitern — die Erwartung an die Schiene (`['Startseite', 'Einstellungen']`) bleibt, solange die Rolle kein Modulrecht hat.

- [x] **Step 4: Die drei Specs laufen lassen**

Run: `cd apps/kompass && npx playwright test e2e/shell.spec.ts e2e/modules.spec.ts e2e/dms.spec.ts e2e/palette-and-errors.spec.ts`
Expected: alle PASS.

- [x] **Step 5: Commit**

```bash
git add apps/kompass/e2e/shell.spec.ts apps/kompass/e2e/modules.spec.ts apps/kompass/e2e/dms.spec.ts
git commit -m "test(e2e): modules and the dms admin reach their pages through rail and second level; a user without module rights sees only home and settings"
```

---

### Task 11: Fundament-Spec nachziehen und `pnpm verify`

**Files:**
- Modify: `docs/superpowers/specs/2026-09-05-fundament-design.md` (Zeile 155 „App-Shell (Sidebar aus Manifesten …" und Zeile 188 „Shell-Maße (Sidebar 248/56 px …")

- [x] **Step 1: Ablösungsnotiz an beiden Stellen**

In Zeile 155 nach dem Klammerausdruck `… Module hängen später ihre Entitäten an)` einfügen:

```
 — **abgelöst am 2026-09-14** durch `2026-09-14-navigation-schiene-und-zweitebene-design.md`: feste Schiene 88 px mit Wort, Zweitebene 208 px, kein Klappzustand
```

In Zeile 188 nach `Shell-Maße (Sidebar 248/56 px, Topbar 56 px, Drawer unter 1180 px)` einfügen:

```
 — Sidebar-Maße abgelöst am 2026-09-14, siehe Navigations-Spec; Topbar und Drawer-Grenze gelten weiter
```

- [x] **Step 2: Volle Prüfung**

Run: `pnpm verify`
Expected: Typecheck, alle Tests, E2E kalt gegen `next dev`, Image-Build und E2E gegen das Image — alles grün. Braucht Docker; etwa vier Minuten. Ein roter Lauf wird lokal reproduziert (`pnpm e2e:cold` bzw. `pnpm e2e:image`), nicht über die CI erraten.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-05-fundament-design.md
git commit -m "docs(spec): the fundament spec points to the navigation spec where the sidebar is superseded"
```

- [x] **Step 4: Plan als erledigt markieren**

Alle `- [ ]` dieses Plans auf `- [x]` setzen und committen:

```bash
git add docs/superpowers/plans/2026-09-14-navigation-schiene-und-zweitebene.md
git commit -m "docs(plan): navigation rail and second level — all tasks done, pnpm verify green"
```

Kein Push — den löst Joe aus.

---

## Self-Review gegen die Spec

- **§ 3 Rahmen** → Task 9 (Aufbau, Drawer, `sticky` weg). **§ 4** → Tasks 1–4 (`NavGroup.icon`, `locate`, `activeRailKey`, `buildRail`, `sectionsFor`, `crumbsFor` samt Dedup-Regel). **§ 5 Schiene** → Task 6 (Maße, Marke, Linie, ICONS mit `globe`/`settings`). **§ 6 Zweitebene** → Task 7. **§ 7 Kopfleiste** → Task 8 (`<h1>` letztes Segment, Build im Menü, `ChevronDown`, `side="bottom" align="end"`). **§ 8 Kern** → Task 1. **§ 9 Präferenzen und Texte** → Tasks 5 und 9. **§ 10 Tests** → Unit in 1–4, E2E in 5, 9, 10; Palette-Test in 5. **§ 11 Dateien** → alle genannt, `sidebar.tsx` gelöscht in 9, Fundament-Notiz in 11. **§ 12 Bewusst nicht** → nirgends gebaut. **§ 14 Abnahme** → jede Zeile hat einen E2E-Test in Task 5 oder 10, außer „am Kern nur `moduleIcon`" (Task 1, per Diff prüfbar).
- **Platzhalter:** keine; jeder Codeschritt hat den Code, jeder Testschritt den Test.
- **Typen:** `RailEntry {key, href, icon, labelKey}` (Task 3) = `Rail`-Props (6); `NavSection {key, labelKey?, items}` (4) = `SectionNav` (7); `UserMenuProps {user, build}` (8) = `Topbar` (8) = `ShellFrame` (9); `activeHref` aus `locate(...)?.item.href` (9) = `SectionNav.activeHref` (7); `variant`-Werte `'rail' | 'list'` (6) und `'column' | 'list'` (7) stimmen mit Task 9 überein.
