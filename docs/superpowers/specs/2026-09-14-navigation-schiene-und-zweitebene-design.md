# Aluna Kompass — Navigation: Schiene und Zweitebene (Design)

Stand 2026-09-14. Säule „Fundament". Ersetzt den Aufbau der Sidebar aus
`2026-09-05-fundament-design.md` und greift den Designer-Handoff vom
2026-09-14 („Navigation — Module in der Schiene, Einstellungen hinter einem
Eintrag", Artboard 4a in `docs/design/fundament/…/Aluna Kompass Fundament.dc.html`)
auf. Die Spec übernimmt sein Zielbild und weicht an drei Stellen ab, die in
§ 2 begründet sind. Kein Roadmap-Schritt: Das ist der Handoff-Abgleich
außerhalb der Akte, den Schritt 1 des Nordsterns offen gelassen hat.

**Umfang: nur die Navigationsschale.** Keine neuen Seiten, keine Änderung an
Modulseiten, keine Seed- oder Testdaten. Am Kern ändert sich ein optionales
Feld.

## 1. Ausgangslage

`buildNavigation()` liefert `[admin, config, ...modules]`, und die Sidebar
zeichnet alle Gruppen untereinander als Akkordeons. Auf einem Bildschirm mit
Alunas Modulen stehen damit die elf Einträge, die man ein- bis zweimal im
Vereinsleben anfasst (Nutzer, Rollen, Themes, Backup …), **über** dem
Tagesgeschäft; die Webseite beginnt erst unterhalb der Bildkante, Tiere,
Kontakte und Akte sind nur als eingeklappte Köpfe zu sehen. Konfiguration und
Arbeit stehen gleichrangig nebeneinander — gleiche Schrift, gleiches Icon.

Im Vollausbau des Nordsterns wird es nicht besser: Finanzen bringt zehn bis
zwölf Seiten, Mitglieder und Gremien etwa acht, Tiere Vollstufe sieben. Eine
einspaltige Liste hätte dann rund 50 Zeilen.

Was die Navigation im Vollausbau leisten muss:

| Ebene | Vollausbau |
|---|---|
| Bereiche | Startseite, Webseite, Kontakte, Akte, Finanzen, Mitglieder, Tiere, Projekte, Einstellungen — neun |
| Seiten je Bereich | 1 (heute Kontakte) bis ~12 (Finanzen); Einstellungen ~20 in Gruppen |

Die Leiste darf nur wachsen, wenn ein **Modul** dazukommt, nicht wenn ein
Modul eine **Seite** dazubekommt.

## 2. Entscheidungen (Brainstorming 2026-09-14)

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | **Zwei Ebenen:** eine Schiene mit einer Zeile je Bereich, daneben eine Zweitebene mit den Seiten des aktiven Bereichs. | Akkordeon mit nur einem offenen Modul (löst die Länge, nicht die Gleichrangigkeit). Module als Reiter in der Kopfleiste (neun beschriftete Reiter passen bei 1180 px nicht neben Logo, Suche und Nutzermenü; kein Drawer-Bild). |
| 2 | **Schiene mit Icon und Wort, 88 px, fest.** Kein Klappzustand, keine Präferenz, kein `[`, keine Tooltips. Schiene 88 + Zweitebene 208 = 296 px, knapp über der Breite der heutigen Sidebar (248). | Handoff: Schiene 56 ↔ 248 px mit Knopf, Präferenz und Tooltips. Eine ganze Zustandsachse für ein Problem, das Beschriftungen unter den Icons lösen; der ausgeklappte Fall (456 px neben dem Inhalt, Handoff § 8) entfällt. Vor dem ersten Release billig, danach wegen gespeicherter Präferenzen nicht mehr. |
| 3 | **Einstellungen sind ein Bereich** am Fuß der Schiene, hinter einer Trennlinie; ihre Zweitebene zeigt `admin` und `config` als zwei Abschnitte VERWALTUNG und EINRICHTUNG. | Einstellungen im Nutzermenü verstecken (zu weit weg; der Vorstand pflegt Stammdaten regelmäßig). |
| 4 | **Eine Ortsbestimmung** `locate()` liefert Bereich, Gruppe und Eintrag zum Pfad; Schiene, Zweitebene und Brotkrume leiten sich alle daraus ab. | Handoff: drei getrennte Regeln (`active` über `startsWith(href)` des Rail-Eintrags, `moduleNavFor`, `crumbsFor`). Sie liefen auseinander: auf `/site/c/artikel` war „Webseite" nicht markiert, auf `/admin/themes` nicht „Einstellungen", weil der Rail-`href` nur der erste Eintrag ist. |
| 5 | **Die Zweitebene ist eine Liste von Abschnitten**, eine Render-Regel für Module und Einstellungen. Ein Modul hat heute einen Abschnitt ohne Überschrift; wenn ein Modul mehrere braucht (Finanzen: BUCHEN, BERICHTE), bekommt `NavigationItem` ein Feld `section`. | Zwei Sonderfälle (Module flach, Einstellungen mit Gruppenköpfen). |
| 6 | **Ein Eintrag der Zweitebene ist ein Link mit eigener URL.** Wohin — Seite, Sammlung, gespeicherte Sicht — entscheidet das Modul über `navigation` und `navigationFor`. Was ein Eintrag nicht ist: eine Fläche mit eigenem Verhalten. | Die Ordner der Akte in der Zweitebene. Die Ordnerspalte der Akte nimmt Ablagen per Drag-and-drop an und zählt; das kann eine von der Schale gerenderte Linkliste nicht. Die Spalte bleibt in der Seite. |
| 7 | **Die Zweitebene steht, sobald ein Bereich zwei sichtbare Einträge hat.** Mit einem Eintrag wiederholte sie nur die Schiene („Hunde“ unter „Tiere“) und kostete 208 px; die Spalte erscheint, wenn ein Bereich wächst. Auf Startseite und Profil entfällt sie ohnehin. Gilt auch für Einstellungen. (Geändert am 2026-09-14 nach der Umsetzung; vorher „immer, sobald ein Bereich aktiv ist“.) | Spalte immer bei aktivem Bereich — das Argument „springendes Layout“ zog nicht, weil der Sprung Startseite → Modul denselben Effekt hat und nie störte. Heute hätten vier von fünf Modulen eine Spalte mit einer Zeile, die Akte dazu ihre eigene Ordnerspalte daneben. |
| 8 | `buildNavigation()` bleibt unverändert und liefert weiter `NavGroup[]`. | Umbau des Datenflusses. Befehlspalette (`buildCommandIndex`) und Palette-Filter hängen daran und sollen nichts merken. |
| 9 | Schiene und Zweitebene sind zwei `<nav>` mit eigenem `aria-label`. | Eine Rolle für beide (Screenreader und E2E-Selektoren können sie nicht unterscheiden). |
| 10 | Am Kern: `moduleIcon?: string` an `ModuleManifest`, gesetzt nur bei `site` (`globe`). | Icon aus dem ersten Eintrag ableiten (bei `site` ist das `layout-template` — das Symbol der Seite „Template", nicht des Moduls). |

## 3. Rahmen

```
┌────────────────────────────────────────────────────────────────────┐
│ [Logo] Verein │ Brotkrume …                 [ Suchen ⌘K ] (J) Name ▾ │  56 px, volle Breite
├──────┬────────────┬────────────────────────────────────────────────┤
│      │            │                                                │
│ Schi │ Zweitebene │ Inhalt                                         │
│ ene  │  208 px    │ (main, scrollt)                                │
│ 88px │            │                                                │
│      │            │                                                │
└──────┴────────────┴────────────────────────────────────────────────┘
```

`ShellFrame` baut: `<div class="flex h-full flex-col">` → `<Topbar/>` →
`<div class="flex min-h-0 flex-1">` → `<Rail/>`, `<SectionNav/>` (nur mit
Abschnitten), `<main class="min-h-0 flex-1 overflow-auto p-6">`. Die Topbar
ist Teil des festen Rahmens, ihr heutiges `sticky top-0` entfällt. Der Rahmen
schiebt den Inhalt; nichts überlagert.

Unter 1180 px (`DRAWER_BREAKPOINT`, unverändert) verschwinden beide Spalten,
und der `Menu`-Knopf in der Topbar öffnet das `Sheet` (280 px, links): oben
die Schiene als beschriftete **Liste** (eine Zeile je Bereich, Icon links,
Wort rechts), darunter die Zweitebene des aktiven Bereichs, beide ohne
`border-r`, mit `onClose` auf jedem Link.

## 4. Ortsbestimmung: `locate()`

`apps/kompass/src/lib/navigation.ts`, neben dem unveränderten `buildNavigation`.

```ts
export interface Location {
  /** Modul-Key, 'settings' für admin/config. */
  area: string;
  group: NavGroup;
  item: NavItem;
}

/** Der längste sichtbare Eintrag, der auf den Pfad passt; null auf '/', '/profile' und ohne Treffer. */
export function locate(groups: NavGroup[], pathname: string): Location | null;
```

Regeln:

- Kandidaten sind nur **sichtbare** Einträge aller Gruppen. Ein Modul ohne
  sichtbaren Eintrag ist nirgends aktiv — es steht auch nicht in der Schiene.
- Ein `href` ist ein Pfad. Er passt, wenn `pathname === href` oder
  `pathname.startsWith(href + '/')` — an der Segmentgrenze, nicht per rohem
  `startsWith` (`/dms` darf `/dmsx` nicht treffen). Query-Strings kennt die
  Navigation nicht; kommt der erste Eintrag mit einem, bekommt diese Regel
  einen Satz dazu und `locate` einen Vergleich.
- Der längste passende `href` gewinnt. Bei Gleichstand der erste in
  Gruppenreihenfolge.
- `area` ist `group.key`, außer `admin`/`config` → `'settings'`.

Daraus, alle in derselben Datei, alle rein:

```ts
export interface RailEntry {
  key: string;      // Modul-Key, 'home' oder 'settings'
  href: string;
  icon: string;     // Key aus der ICONS-Whitelist
  labelKey: string; // 'nav.home' | 'nav.groups.<key>' | 'nav.settingsArea'
}
export function buildRail(groups: NavGroup[]): RailEntry[];

/** Welcher Rail-Eintrag aktiv ist: 'home' auf '/', sonst locate().area, sonst null. */
export function activeRailKey(groups: NavGroup[], pathname: string): string | null;

export interface NavSection {
  key: string;
  /** Überschrift; fehlt bei einem Modul mit einem Abschnitt. */
  labelKey?: string;
  items: NavItem[]; // nur sichtbare
}
export function sectionsFor(groups: NavGroup[], pathname: string): NavSection[];

export function crumbsFor(groups: NavGroup[], pathname: string, t: (k: string) => string): string[];
```

**`buildRail`**, in dieser Reihenfolge:

1. `{ key: 'home', href: '/', icon: 'home', labelKey: 'nav.home' }`.
2. Je Gruppe außer `admin`/`config` mit mindestens einem sichtbaren Eintrag:
   `href` des ersten sichtbaren Eintrags, `labelKey: nav.groups.<key>`,
   `icon` aus `moduleIcon` des Manifests, sonst das Icon des ersten sichtbaren
   Eintrags. Damit `buildRail` ans Manifest kommt, trägt `NavGroup` neu ein
   optionales `icon?: string`, das `buildNavigation` aus `moduleIcon`
   übernimmt — die einzige Änderung an `buildNavigation`, additiv.
3. `settings`, wenn `admin` oder `config` einen sichtbaren Eintrag hat:
   `href` = der erste sichtbare aus `admin`, sonst aus `config`; `icon:
   'settings'`, `labelKey: 'nav.settingsArea'`. Kein festes `/admin` — wer nur
   `media.upload` hat, landete sonst auf einer verbotenen Seite.

**`sectionsFor`**: `locate()`; null → `[]`. `area === 'settings'` →
`[{ key: 'admin', labelKey: 'nav.groups.admin', items }, { key: 'config',
labelKey: 'nav.groups.config', items }]`, leere Abschnitte weggelassen. Sonst
`[{ key: group.key, items }]` ohne `labelKey`. `items` sind die sichtbaren
Einträge der Gruppe. **Zählen alle Abschnitte zusammen weniger als zwei
Einträge, ist das Ergebnis `[]`** — die Spalte entfällt (Entscheidung 7).

**`crumbsFor`**:

| Pfad | Krumen |
|---|---|
| `/` | `[Startseite]` |
| `/profile…` | `[Profil]` |
| unter einem Modul | `[Modulname, Eintrag]` — **ein** Segment, wenn beide gleich lauten (Kontakte / Kontakte, Akte / Akte, Projekte / Projekte) |
| unter Einstellungen | `[Einstellungen, Gruppenname, Eintrag]` |
| kein Treffer | `[]` |

`Eintrag` ist `item.label ?? t(item.labelKey)`, `Modulname` ist `t(group.labelKey)`.

## 5. Schiene (`Rail`)

`apps/kompass/src/components/shell/rail.tsx` ersetzt `sidebar.tsx`. Props
`{ entries: RailEntry[]; active: string | null; variant: 'rail' | 'list';
onClose?: () => void }`.

- `<nav aria-label={t('nav.aria')}>`, `w-[88px] shrink-0 border-r border-line
  bg-sidebar`, `flex flex-col gap-0.5 py-2`.
- Zeile (`variant: 'rail'`): `<Link>` als `flex flex-col items-center
  justify-center gap-1 rounded-md`, Breite `w-[76px] mx-auto`, Höhe
  `h-[52px]`, Icon `size-5`, Wort `text-[11px] leading-none`, Wort truncate.
  Trefferfläche ≥ 40 × 40 px.
- Zeile (`variant: 'list'`, im Sheet): wie die heutige Sidebar-Zeile,
  `h-[34px] px-2.5 gap-2.5`, Icon `size-4`, Wort `text-[14px]`.
- Ruhe `text-ink-2 hover:bg-hover hover:text-ink`; aktiv `bg-brand-soft
  font-semibold text-brand-ink shadow-[inset_2px_0_0_var(--color-primary)]`,
  `aria-current="page"`.
- Vor `settings`: `mt-auto` plus Trennlinie `mx-auto h-px w-10 bg-line`
  (`list`: `mx-2.5 h-px bg-line`).
- `ICONS`-Whitelist zieht aus `sidebar.tsx` um und bekommt `globe: Globe` und
  `settings: Settings` (beide in `lucide-react` vorhanden, geprüft).

## 6. Zweitebene (`SectionNav`)

`apps/kompass/src/components/shell/section-nav.tsx`, neu. Props
`{ sections: NavSection[]; onClose?: () => void }`. Rendert `null`, wenn
`sections` leer ist.

- `<nav aria-label={t('nav.sectionAria')}>`, `w-52 shrink-0 border-r
  border-line bg-bg`, `flex flex-col gap-0.5 p-2 overflow-y-auto`.
- Überschrift (nur mit `labelKey`): `flex h-7 items-center px-2.5 text-[11px]
  font-bold uppercase tracking-[.09em] text-muted-ink`. Kein Chevron, kein
  Button — die Zweitebene klappt nicht.
- Eintrag: `<Link>` `h-8 px-2.5 rounded-md text-[14px]`, Ruhe `text-ink-2`,
  Hover `bg-hover text-ink`, aktiv `bg-selected font-semibold
  text-selected-ink` mit `aria-current="page"`. Aktiv ist `locate().item`.
  **Kein Icon** — Symbole tragen die Bereiche, nicht die Seiten.
- `sectionBreak` → `mx-2.5 my-1 h-px bg-line` oberhalb des Eintrags.
- Zwischen zwei Abschnitten `mt-3`.
- Keine Zähler (§ 12).

## 7. Kopfleiste und Nutzermenü

`topbar.tsx` nimmt auf, was die Sidebar abgibt. Props: `{ organization,
logoUrl, crumbs: string[], user, build, drawer, onOpenDrawer, onSearch }`.
Reihenfolge im 56-px-Balken, `px-4 gap-3.5`:

1. Nur im Drawer-Modus: der `Menu`-Knopf (`aria-label` `shell.topbar.openNav`).
   Sonst kein Knopf — es gibt nichts zu klappen.
2. Logo 26 px (ohne Logo der gestrichelte Platzhalter wie heute) +
   Vereinsname `text-[14px] font-semibold`, dahinter `border-r border-line
   h-[30px] pr-3.5`.
3. Brotkrume, `flex-1 min-w-0 text-[14px]`: Segmente durch `/` in
   `text-muted-ink-2` getrennt, alle außer dem letzten `text-muted-ink`; das
   letzte ist das `<h1 class="truncate text-[14px] font-semibold">`. Die
   Topbar liefert heute das einzige `<h1>` der Schale (geprüft: sonst nur
   `auth-card.tsx` und `global-error.tsx`, beide außerhalb); das bleibt so,
   ohne eine Modulseite anzufassen.
4. Suchknopf, unverändert (`h-8 w-60`, ⌘K).
5. `UserMenu` mit Trigger-Chevron `ChevronDown`, Dropdown `side="bottom"
   align="end"`. Letzte Zeile, nicht klickbar: `text-[10px] text-muted-ink`
   mit `t('shell.build', { id: build })`. `UserMenu` verliert die Prop
   `collapsed`.

## 8. Kern: `moduleIcon`

`packages/core/src/modules/manifest.ts`, an `ModuleManifest`:

```ts
/**
 * Symbol des Moduls in der Schiene. Fehlt es, nimmt die Schale das Icon des
 * ersten sichtbaren Navigationseintrags. Muss wie `NavigationItem.icon` in
 * der ICONS-Whitelist von `apps/kompass/src/components/shell/rail.tsx` stehen.
 */
moduleIcon?: string;
```

Gesetzt nur in `packages/modules/site/src/manifest.ts`: `moduleIcon:
'globe'`, mit demselben Kommentarhinweis wie in `contacts/manifest.ts`.
`animals` (`paw-print`), `contacts` (`contact`), `dms` (`file`), `projects`
(`folder`) bleiben ohne — ihr erstes Icon passt.

## 9. Präferenzen und Texte

`apps/kompass/src/lib/preferences.ts`: `sidebarCollapsed` und
`navCollapsedGroups` fallen aus `Prefs` und `DEFAULTS`. Bereits gespeicherte
Schlüssel `kompass.sidebarCollapsed` / `kompass.navCollapsedGroups` bleiben
liegen und stören nicht; keine Migration.

`apps/kompass/messages/de.json`:

| Schlüssel | Änderung |
|---|---|
| `nav.settingsArea` | neu: „Einstellungen" |
| `nav.sectionAria` | neu: „Unternavigation" |
| `nav.collapse`, `shell.topbar.expandNav` | entfallen |
| `nav.settings` | bleibt „Verein" (war schon so; Handoff § 6 ist damit erledigt) |
| `nav.groups.*` | unverändert, ab jetzt die Bereichsnamen in der Schiene — alle tragen („Akte", „Webseite", „Tiere" …) |

Die Beschriftung unter dem Zahnrad ist „Einstellungen" — mit rund 70 px bei
11 px das längste Wort der Schiene und der Grund für die 76-px-Zeile. Ein
längerer Bereichsname aus `nav.groups.*` wird abgeschnitten (`truncate`);
das ist ein Hinweis, den Namen zu kürzen, nicht die Schiene zu verbreitern.

## 10. Tests

TDD: erst die Tests, dann der Umbau.

**Unit, `apps/kompass/tests/navigation.test.ts`** (die bestehenden Fälle für
`buildNavigation` bleiben):

- `locate`: Segmentgrenze (`/dms` trifft `/dms/abc`, nicht `/dmsx`); längster
  Treffer (`/site/c/artikel` → Sammlung, nicht Template); unsichtbarer
  Eintrag zählt nicht;
  `admin`/`config` → `area: 'settings'`; `/` und `/profile` → null.
- `buildRail`: Reihenfolge home, Module, settings; Modul ohne sichtbaren
  Eintrag fehlt; `moduleIcon` vor Item-Icon; settings-`href` ist der erste
  sichtbare Eintrag (mit nur `media.upload` → `/admin/media`); ohne Recht in
  `admin` und `config` kein settings-Eintrag.
- `activeRailKey`: `/site/c/artikel` → `site`; `/admin/themes` → `settings`;
  `/` → `home`; `/profile` → null.
- `sectionsFor`: Modul → ein Abschnitt ohne `labelKey`; settings → zwei mit
  Überschrift, leerer Abschnitt weggelassen; `/` → `[]`; weniger als zwei
  sichtbare Einträge insgesamt → `[]` (Modul, Webseite ohne Sammlung, ein
  einzelnes Verwaltungsrecht).
- `crumbsFor`: die fünf Zeilen der Tabelle in § 4, dazu die Dedup-Regel.

**E2E, `apps/kompass/e2e/shell.spec.ts`** — neu geschrieben entlang § 14:

1. Schiene: genau eine Zeile je aktivem Modul (Webseite, Kontakte, Akte,
   Tiere, Projekte), „Startseite" oben, „Einstellungen" unten; keine
   Modulseite („Nutzer", „Hunde") darin.
2. Kopfleiste: Vereinsname und Nutzermenü in der Kopfleiste; Build-Zeile im
   geöffneten Nutzermenü.
3. Modul: auf `/animals` ist „Tiere" in der Schiene `aria-current`, die
   Zweitebene (`Unternavigation`) zeigt „Hunde" als `aria-current`; genau ein
   `<h1>`, Text „Hunde".
4. Einstellungen: Klick auf „Einstellungen" führt auf `/admin/users`; die
   Zweitebene zeigt VERWALTUNG und EINRICHTUNG mit allen bisherigen Einträgen
   inklusive „Akte einrichten"; Brotkrume „Einstellungen / Einrichtung /
   Themes" auf `/admin/themes`.
5. Recht: als Nutzer ohne `animals.view` fehlt „Tiere" in der Schiene
   (Helfer für eine Rolle mit eingeschränkten Rechten liegt in `helpers.ts`
   oder wird dort ergänzt — Testdaten, kein Seed).
6. Palette: ⌘K findet „Themes" und „Hunde" wie zuvor.
7. Drawer unter 1180 px: Schiene beschriftet als Liste, darunter die
   Zweitebene; Escape schließt.
8. Nutzermenü: dunkles Design und Abmelden, wie heute.

Entfallen: „collapses a navigation group" und „collapses the sidebar with [".

**Anpassungen:** `modules.spec.ts:19` prüft „Tiere" in der Schiene statt
„Hunde" in der Hauptnavigation; `dms.spec.ts:429` erreicht „Akte einrichten"
über Schiene → Einstellungen → Zweitebene. `palette-and-errors.spec.ts:28`
bleibt gültig (die Schiene heißt weiter „Hauptnavigation").

## 11. Dateien

| Datei | Änderung |
|---|---|
| `apps/kompass/src/lib/navigation.ts` | `NavGroup.icon`, `Location`, `locate`, `RailEntry`, `buildRail`, `activeRailKey`, `NavSection`, `sectionsFor`, `crumbsFor`; `buildNavigation` übernimmt `moduleIcon` |
| `apps/kompass/src/components/shell/rail.tsx` | neu, ersetzt `sidebar.tsx`; ICONS-Whitelist zieht um, plus `globe`, `settings` |
| `apps/kompass/src/components/shell/sidebar.tsx` | gelöscht |
| `apps/kompass/src/components/shell/section-nav.tsx` | neu |
| `apps/kompass/src/components/shell/topbar.tsx` | Logo, Vereinsname, Brotkrume mit `<h1>`, Nutzermenü; Klappknopf weg |
| `apps/kompass/src/components/shell/user-menu.tsx` | Dropdown nach unten, Build-Zeile, `collapsed` weg |
| `apps/kompass/src/components/shell/shell-frame.tsx` | Rahmen, `useMemo` für rail/active/sections/crumbs, Drawer; `[`-Kürzel und Gruppen-Zustand weg |
| `apps/kompass/src/lib/preferences.ts` | `sidebarCollapsed`, `navCollapsedGroups` weg |
| `packages/core/src/modules/manifest.ts` | `moduleIcon?` |
| `packages/modules/site/src/manifest.ts` | `moduleIcon: 'globe'` |
| `apps/kompass/messages/de.json` | § 9 |
| `apps/kompass/tests/navigation.test.ts` | § 10 |
| `apps/kompass/e2e/shell.spec.ts`, `modules.spec.ts`, `dms.spec.ts` | § 10 |
| `docs/superpowers/specs/2026-09-05-fundament-design.md` | Hinweis am Sidebar-Abschnitt: abgelöst durch diese Spec |

## 12. Bewusst nicht

- **Zähler in der Zweitebene** (24, 3 im Entwurf). Bräuchte ein Feld an
  `NavigationItem` und je Eintrag eine Abfrage bei jedem Request. Kommt,
  wenn der Querschnitt „Fristen und Wiedervorlagen" eine Zahl an der Schale
  braucht — dann als eigene Entscheidung.
- **Modul-eigene Zweitebene (Slot).** Wenn ein Modul seine Spalte selbst
  rendern soll (die Ordnerspalte der Akte als Zweitebene, mit Ablage und
  Zählern), ist der Next-eigene Weg ein Parallel-Route-Slot `@subnav` im
  Shell-Layout: `@subnav/default.tsx` rendert `SectionNav`, eine Route wie
  `@subnav/dms/page.tsx` übersteuert. Bekannte Falle: bei weicher Navigation
  behält ein Slot ohne passende Route seinen **alten** Inhalt; ein Catch-all
  `@subnav/[...path]/page.tsx` fängt das. Heute bräuchte es genau ein Modul,
  und dessen Spalte ist am 2026-09-12 fertig geworden — nicht bauen.
- **Ordner der Akte in der Navigation** (Entscheidung 6).
- **Neue Module.** Die Schiene füllt sich, sobald ein Manifest da ist.
- **`NavigationItem.section`.** Die Zweitebene kann Abschnitte; das Feld
  kommt mit dem ersten Modul, das mehr als einen braucht.
- **Die Seiten hinter `/admin` inhaltlich.** Gleiche Routen, gleicher Inhalt,
  anderer Weg dorthin.

## 13. Betroffene Regeln

- `NavigationItem.group` ist heute redundant zum Modul-Key und wird von
  `buildNavigation` nicht gelesen. Bleibt, wird nicht angefasst.
- Das Ergebnis muss über `pnpm verify` grün sein, inklusive der E2E-Suite
  gegen das Image (`docs/superpowers/specs/2026-09-08-pruefringe-design.md`).

## 14. Abnahme

- [ ] Die Schiene zeigt je aktivem Modul genau eine Zeile mit Icon und Wort,
      „Startseite" oben, „Einstellungen" unten hinter einer Trennlinie. Kein
      Klappknopf, kein `[`.
- [ ] Schiene 88 px und Zweitebene 208 px stehen fest; der Inhalt beginnt bei
      296 px — bei 88 px auf Startseite und Profil und in jedem Bereich mit
      nur einem sichtbaren Eintrag.
- [ ] Die Kopfleiste läuft über die volle Breite mit Logo, Vereinsname,
      Brotkrume, Suche und Nutzermenü; die Build-Zeile steht im Nutzermenü.
- [ ] In einem Modul ist der Bereich in der Schiene markiert und die Seite in
      der Zweitebene — auch unter einer Sammlung der Webseite und unter jeder
      Einstellungsseite.
- [ ] Unter „Einstellungen" zeigt die Zweitebene VERWALTUNG und EINRICHTUNG
      mit ihren bisherigen Einträgen, `dms.admin` eingeschlossen.
- [ ] Wer ein Recht nicht hat, sieht den Eintrag nicht; ein Modul ohne
      sichtbaren Eintrag fehlt in der Schiene; Einstellungen fehlt ohne
      sichtbaren Eintrag in `admin` und `config`.
- [ ] Die Befehlspalette findet jeden Eintrag, den sie vorher fand.
- [ ] Unter 1180 px öffnet der Menüknopf ein Sheet mit beschrifteter Schiene
      und darunter der Zweitebene des aktiven Bereichs.
- [ ] Genau ein `<h1>` je Seite; es nennt die aktuelle Seite. Die Brotkrume
      wiederholt keinen Namen.
- [ ] Kein Modul-, Seed- oder Testdatensatz wurde angefasst; am Kern nur
      `moduleIcon`.

## 15. Self-Review

- Platzhalter: keine. Die Schienenbreite ist mit 88 px entschieden (§ 2, § 5,
  § 14); die Query-Regel für `locate` wurde gestrichen, weil kein Eintrag
  einen Query-String hat (§ 4).
- Konsistenz: `locate` ist die einzige Ortsbestimmung; § 4, § 5 (`active`),
  § 6 (aktiver Eintrag) und § 7 (Krumen) verweisen darauf. Die Breite 296
  steht in § 2, § 3 und § 14 gleich. Aria-Namen: Schiene `nav.aria`
  („Hauptnavigation", unverändert), Zweitebene `nav.sectionAria` — § 5, § 6,
  § 9, § 10 stimmen überein.
- Umfang: ein Plan. Zehn Quelldateien, zwei Test-Dateien, eine Doku-Notiz.
- Ambiguität: „passt" ist in § 4 für Pfade und Queries definiert; „sichtbar"
  ist `NavItem.visible`; `area` ist mit den drei Werten aufgezählt.
