# Handoff: Aluna Kompass — Stufe 1 „Fundament" (Shell, Login, Administration)

## Overview

Aluna Kompass ist ein Open-Source-Vereinsverwaltungstool, das im lokalen Netz eines Vereins (NAS) läuft und von wenigen Vorstandsmitgliedern am Laptop bedient wird. Stufe 1 umfasst nur das Fundament: App-Shell, Erstinbetriebnahme, Login und die Administrationsseiten (Nutzer, Rollen, Einstellungen, Themes, Module, Änderungsprotokoll, Dokumente, Backup, Profil). Fachmodule (Finanzen, Mitglieder, Tiere, Webseite) folgen später und sind hier nur als deaktivierte Navigationsgruppe und als Modul-Liste sichtbar.

Zwei Eigenschaften prägen die Umsetzung:

1. **Vollständige Theme-Fähigkeit.** Es gibt im Produktionscode keinen statischen Farbwert. Jede Farbe, Schrift und Rundung ist ein Token; jedes Theme liefert für jedes Token einen Wert für `light` und `dark`. Einzige Ausnahme: der Umgebungsbalken (siehe unten).
2. **Rechenschaft statt Löschen.** Es gibt nirgends einen Löschen-Knopf für protokollierte Daten. Stattdessen: Deaktivieren (Nutzer, Module), Widerrufen (API-Tokens), Stornieren (Dokumente). Themes dürfen gelöscht werden — außer dem aktiven und dem Default.

**Sprache:** Oberflächentexte Deutsch (Sie-Form). Bezeichner im Code (Token-Namen, Komponenten, Permission-Keys) Englisch.

## About the Design Files

Die Datei in diesem Bundle ist eine **Design-Referenz in HTML** — ein Prototyp, der Aussehen und Verhalten zeigt, **kein Produktionscode zum Kopieren**. Aufgabe ist es, die Designs in der Umgebung des Zielprojekts nachzubauen (React, Vue, Svelte, o. Ä.) und dabei dessen etablierte Muster und Bibliotheken zu verwenden. Existiert noch keine Umgebung, wählen Sie den passenden Stack; das Design ist am Vokabular von **shadcn/ui** orientiert (Table, Dialog, Sheet, Tabs, Badge, Switch, Checkbox, Select, Toast, Command), lässt sich damit also nahezu 1:1 abbilden.

Der Prototyp ist ein **Design-Board**: alle Screens liegen als Artboards nebeneinander auf einer Canvas-Fläche, mit sichtbaren IDs (`1a`, `1b`, … `2f`) und Anmerkungen unter jeder Überschrift. Die Board-Chrome (grauer Hintergrund `#E8E8E4`, ID-Badges, Anmerkungstexte, die Artboard-Rahmen) ist **nicht Teil des Produkts**. Ebenso sind Prototyp-Interna nicht zu übernehmen: Overlay-Zustände sind als Ausschnitte in denselben Rahmen gezeichnet, Dialoge stehen sichtbar untereinander, und `--row-h` / `--note-display` werden im Prototyp per Tweak-Panel gesetzt.

## Fidelity

**High-fidelity.** Farben, Typografie, Abstände, Zeilenhöhen, Radien und Copy sind final und exakt umzusetzen. Alle Werte stehen unten in „Design Tokens" und „Components". Ausnahmen, die bewusst offen sind:

- Das Logo ist überall ein gestrichelter Platzhalter (Vereinslogo kommt als Daten).
- Icons sind schlanke 1,8-px-Stroke-Icons im 24er-Grid; das Design nutzt Lucide-Pfade. Verwenden Sie die Icon-Bibliothek des Zielprojekts, wenn eine existiert.
- Die PDF-Vorschau in `1n` ist eine Andeutung des Briefbogens, kein Layout-Spec für das PDF.

## Screens / Views

Runde 1 (`1a`–`1q`) deckt das Briefing ab, Runde 2 (`2a`–`2f`) die nachgereichten Zustände. Screens `1h`–`1p` sind als **Inhaltsbereich ohne Sidebar** gezeichnet (1160 px), weil die Shell in `1e`/`1f`/`1g` vollständig steht — beim Bau umgeben sie natürlich die Shell.

### App-Shell (`1e` hell, `1f` dunkel, `1g` Umgebungsbalken, `2a` eingeklappt, `2b` Tablet)

**Aufbau:** Sidebar links (fix), rechts Spalte aus sticky Topbar (56 px) und scrollendem Inhaltsbereich. Gesamtbreite Zielbereich 1280–1440 px, muss bis 1024 px funktionieren.

**Sidebar, aufgeklappt: 248 px**, `background: var(--sidebar-bg)`, `border-right: 1px solid var(--line)`.
- Kopf, 56 px hoch, `border-bottom: 1px solid var(--line)`, `padding: 0 12px 0 16px`, `gap: 10px`: Logo-Platzhalter 28×28 (`--radius-sm`, `1px dashed var(--line-strong)`, Text „LOGO" 9 px `--muted-2`), zweizeilig Vereinsname (14 px/600, Ellipsis) über „Aluna Kompass" (11 px `--muted`), rechts Einklapp-Knopf 26×26 (ghost, Hover `--hover-surface`).
- Navigation, `padding: 10px 8px`, `gap: 2px`. Einträge 34 px hoch, `padding: 0 10px`, `border-radius: var(--radius-md)`, 14 px, Icon 16 px in `--muted`, Label `--ink-2`. Hover: `background: var(--hover-surface)`, Text `--ink`.
- **Aktiver Eintrag:** `background: var(--color-primary-soft)`, Text und Icon `var(--color-primary-ink)`, `font-weight: 600`, plus linker Balken `box-shadow: inset 2px 0 0 var(--color-primary)`. Der Balken ist wichtig — Farbe allein ist nicht ausreichend unterscheidbar.
- Gruppentitel: `padding: 14px 10px 6px`, 11 px/700, `letter-spacing: .09em`, `--muted`, Uppercase-Text („VERWALTUNG").
- Erster Eintrag ohne Gruppe: „Startseite" (Home-Icon).
- Gruppe „Verwaltung": Nutzer, Rollen, Einstellungen, Themes, Module, Änderungsprotokoll, Dokumente, Backup.
- **Deaktivierte Modulgruppe** („FINANZEN"): Gruppentitel in `--disabled-ink` plus Badge „Modul nicht aktiv" (10 px/600, `padding: 2px 6px`, `--radius-sm`, `background: var(--disabled-bg)`, Text `--disabled-ink`, `1px solid var(--line)`). Einträge 32 px, `--disabled-ink`, `aria-disabled="true"`, nicht fokussierbar, kein Hover. Darunter Hinweistext 11 px `--muted`: „Module werden unter Verwaltung → Module aktiviert."
- Fuß, `border-top: 1px solid var(--line)`, `padding: 8px`: Zeile 44 px mit Avatar 28×28 (`--radius-full`, `--color-primary` / `--on-primary`, Initialen 12 px/700), Name 13 px/600 über Rolle 11 px `--muted`, Chevron-up 14 px. Öffnet Menü nach oben mit: Profil · Hell/Dunkel (Switch im Eintrag) · Trenner · Abmelden. Menü: `--surface`, `1px solid var(--line)`, `--radius-md`, `box-shadow: var(--shadow-md)`, `padding: 5px`, Einträge `padding: 7px 10px`, `--radius-sm`, Hover `--hover-surface`.

**Sidebar, eingeklappt: 56 px** (`2a`) — reine Icons, Zustand **pro Nutzer im Browser gemerkt** (localStorage). Logo-Platzhalter zentriert im 56-px-Kopf. Icon-Buttons 36×34, zentriert, `--radius-md`, Icon 17 px. Gruppentitel werden zu Trennern: `width: 24px; height: 1px; background: var(--line-strong); margin: 6px 0`. Deaktivierte Modul-Icons bleiben ausgegraut sichtbar. Fuß: nur Avatar 28×28. In der Topbar erscheint links ein Aufklapp-Knopf 28×28 (`1px solid var(--line-strong)`, `--radius-sm`). Tastenkürzel `[`. **Tooltip** nach 400 ms rechts vom Icon: `background: var(--tooltip-bg)`, Text `var(--tooltip-ink)`, `padding: 7px 11px`, `--radius-md`, `box-shadow: var(--shadow-md)`, Label 13 px/600 plus Gruppenname 11 px mit `opacity: .72`, links ein 8×8-Quadrat um 45° gedreht als Pfeil.

**Topbar: 56 px**, `background: var(--topbar-bg)`, `border-bottom: 1px solid var(--line)`, `padding: 0 20px`, `gap: 16px`.
- Links zweizeilig: Breadcrumb 11 px `--muted` („Musterverein e.V. / Verwaltung"), darunter Seitentitel `h1` 18 px in `--font-heading`.
- Rechts: Suchfeld-Platzhalter 32 px hoch, 240 px breit, `1px solid var(--line-strong)`, `--radius-md`, `background: var(--input-bg)`, Lupe 14 px, Text „Suchen" in `--input-placeholder`, rechts Tastenkürzel-Chip „⌘K" (11 px `--font-mono`, `1px solid var(--line)`, `border-radius: 3px`, `padding: 1px 4px`). Öffnet die Befehlspalette (`2c`).
- Ganz rechts Avatar 30×30.

**Inhaltsbereich:** `background: var(--bg)`, `padding: 28px 32px` auf der Startseite, `24px` auf Listenseiten.

**Umgebungsbalken (`1g`) — die einzige Ausnahme vom Token-System.** 28 px hoch, ganz oben, schiebt die gesamte App nach unten (nicht überlagernd), nicht wegklickbar, in Hell und Dunkel identisch, in Produktion **nicht vorhanden** (kein Ersatzhinweis — die Abwesenheit ist das Signal).
- Test: `background: #1A1A1A`, Text `#F2C200`. Label „TESTUMGEBUNG" 12 px/700, `letter-spacing: .18em`, daneben 11 px Kontext: „Daten vom 02.09.2026 · Änderungen hier haben keine Wirkung".
- Entwicklung: `background: #B3261E`, Text `#FFFFFF`, Label „ENTWICKLUNG", Kontext „localhost · Migrationsstand 41".
- Beide mit Warnschraffur an beiden Enden: `repeating-linear-gradient(135deg, <fg> 0 8px, <bg> 8px 16px)` links (45deg rechts), Breite 120 px (Test) bzw. 80 px (Dev), `opacity: .85`–`.9`; Textinhalte mit `z-index: 1` darüber.

**Tablet 1024 px (`2b`):** Unter 1180 px liegt die Sidebar als **Drawer** über dem Inhalt: 280 px breit, `box-shadow: var(--shadow-md)`, dahinter `background: var(--overlay)`; Esc und Klick daneben schließen, Fokus bleibt im Drawer (Focus-Trap), Schließen-× im Drawer-Kopf. Nav-Einträge im Drawer 38 px hoch (Fingerbedienung). In der Topbar erscheint links ein Burger-Knopf 28×28. Formulare brechen auf **eine Spalte**; Feldgruppen wie PLZ/Ort bleiben zusammen (`grid-template-columns: 120px minmax(0,1fr)`). Reiterleisten scrollen waagerecht mit `white-space: nowrap`. **Tabellen behalten alle Spalten** und scrollen waagerecht — kein Umbau zu Karten.

### `1c` Erste Einrichtung

Leerer Zustand beim allerersten Start, zentriert auf `--bg`, Karte 520 px. Über der Karte Marke: 34×34 Quadrat (`--radius-md`, `--color-primary-soft`, `1px solid var(--color-primary)`, „AK" 15 px/700 in `--font-heading`, `--color-primary-ink`) plus „Aluna Kompass" 18 px `--font-heading`.

Karte: `--surface`, `1px solid var(--line)`, `--radius-lg`, `padding: 28px`, `gap: 20px`. `h1` „Erste Einrichtung" 26 px `--font-heading`; Fließtext 14 px/1.55 `--ink-2`: „Legen Sie das erste Vorstandskonto an. Danach werden weitere Nutzer in der Verwaltung angelegt — dieser Schritt erscheint nicht wieder."

Felder (38 px hoch): Vereinsname (voll), dann Ihr Name / E-Mail zweispaltig, dann Passwort mit Hilfetext „Mindestens 12 Zeichen. Ein Merksatz ist besser als ein kurzes Sonderzeichen-Passwort." Primärbutton 40 px, volle Breite: „Konto anlegen und starten". Unter der Karte 13 px `--muted`: „Dieses Konto erhält die Rolle „Administration" mit allen Rechten. Weitere Rollen legen Sie später unter Verwaltung → Rollen an."

Der Screen existiert genau einmal; danach greift die Route nicht mehr.

### `1d` Login (Normal- und Fehlerzustand)

Karte 400 px auf `--bg`, gleiche Marke oben, aber mit Vereinsname (15 px/600) über „Aluna Kompass" (12 px `--muted`). `h1` „Anmelden" 22 px. Felder E-Mail und Passwort (38 px), Primärbutton 40 px „Anmelden". **Kein Self-Signup, kein „Passwort vergessen"-Link.** Darunter 13 px `--muted`: „Zugänge werden vom Vorstand angelegt. Bei Problemen wendet man sich an die Administration des Vereins."

**Fehlerzustand:** Alert oben in der Karte (`role="alert"`): `background: var(--color-error-bg)`, `1px solid var(--color-error)`, `--radius-md`, `padding: 10px 12px`, Info-Icon 16 px in `--color-error`, Titel 13 px/600 in `--color-error` „E-Mail oder Passwort stimmt nicht.", darunter 13 px `--ink-2` „Noch 3 Versuche, danach ist das Konto für 15 Minuten gesperrt." Beide Felder erhalten `aria-invalid="true"` und `border-color: var(--color-error)`. Die Meldung verrät bewusst nicht, ob die E-Mail existiert.

**Regel:** 5 Fehlversuche → 15 Minuten Sperre; die Sperre wird als Systemeintrag protokolliert. Es gibt keinen Reset-Weg per E-Mail; ein Admin setzt bei Bedarf ein neues Startpasswort.

### `1e` Startseite

`h2` „Guten Tag, Anna." 26 px `--font-heading`; darunter 15 px/1.55 `--ink-2`: „Der Verein ist angelegt. Drei Dinge fehlen noch, bevor Sie mit der Verwaltung arbeiten können."

Drei Hinweiskarten, `grid-template-columns: repeat(3, minmax(0,1fr))`, `gap: 16px`. Karte: `--surface`, `1px solid var(--line)`, `--radius-lg`, `padding: 18px`, `gap: 12px`. Aufbau: Titel 17 px `--font-heading` + rechts Zähler 12 px `--font-mono` `--muted`; Text 14 px/1.5 `--ink-2` (`min-height: 63px`, damit die drei Karten gleich hoch bleiben); Fortschrittsbalken 6 px (`--radius-full`, Spur `--surface-2`, Füllung `--color-primary`) plus Hinweis 12 px `--muted`; Sekundärbutton 34 px, linksbündig.

Inhalte:
1. „Einstellungen vervollständigen" · 4 von 9 · 44 % · „5 Felder offen" · Button „Zu den Einstellungen" — „Steuernummer, Finanzamt und Freistellungsbescheid fehlen. Ohne diese Angaben lassen sich keine Zuwendungsbestätigungen erzeugen."
2. „Rollen anlegen" · 1 von 3 · 33 % · „Empfohlen: Schatzmeisterin, Kassenprüfer" · Button „Rollen öffnen" — „Es gibt nur die Rolle „Administration". Für Kassenprüfung und Schriftführung sind eigene Rollen mit weniger Rechten sinnvoll."
3. „Module aktivieren" · 0 von 4 · 0 % · „Kern ist immer aktiv" · Button „Module öffnen" — „Finanzen, Mitglieder, Tiere und Webseite sind installiert, aber inaktiv. Aktivieren Sie nur, was der Verein wirklich führt."

Darunter Info-Banner (max. 820 px): `--color-info-bg`, `1px solid var(--color-info)`, Icon 16 px, 13 px/1.55 `--ink-2`: „Diese Installation läuft im Vereinsnetz. Ein Backup wurde noch nicht erstellt — der erste Export dauert unter einer Minute."

Kein Dashboard, keine Kennzahlen — Stufe 1 hat keine Daten, die einen Zahlenblock rechtfertigen.

### `1h` Nutzer

**Filterleiste** (`gap: 12px`, 34 px hohe Kontrollen): Suchfeld 260 px („Name oder E-Mail"), Select „Alle Rollen", Switch-Label „Inaktive anzeigen" (an), Spacer, Zählung 13 px `--muted` („5 Nutzer, davon 1 inaktiv"), Primärbutton „Nutzer anlegen" mit Plus-Icon 14 px.

**Tabelle** in `--surface`, `1px solid var(--line)`, `--radius-md`, `overflow: hidden`. Kopf 38 px, `background: var(--table-head-bg)`, `border-bottom: 1px solid var(--line)`, Labels 12 px/600, `letter-spacing: .04em`, `--muted`; die sortierte Spalte in `--ink-2` mit Chevron 12 px. Spalten: Name 230 px · E-Mail 280 px · Rollen (flex) · Status 120 px · Letzte Anmeldung 150 px · Aktionsspalte 44 px. Zeilen `height: var(--row-h)` (Default 44 px), `padding: 0 16px`, `border-bottom: 1px solid var(--line-2)`, Zebra: ungerade Zeilen `--table-zebra`, Hover `--table-row-hover`. Name 14 px/600, restliche Zellen 14 px `--ink-2`, Datumsangaben in `--font-mono`. Zeilenmenü „···" rechts.

Rollen als Badges: 12 px/600, `padding: 2px 8px`, `--radius-sm`, `--color-primary-soft` / `--color-primary-ink`, mehrere mit `gap: 6px` und Umbruch.

Status als Punkt-Badge: `padding: 3px 9px 3px 7px`, `--radius-sm`, Punkt 7×7 `--radius-full` in der Textfarbe. Aktiv → `--color-success-bg`/`--color-success`; Erstlogin offen → `--color-warning-bg`/`--color-warning`; Inaktiv → `--neutral-badge-bg`/`--muted`. Inaktive Zeilen: Name und Sekundärtext in `--disabled-ink`.

Beispieldaten (5 Zeilen): Anna Berger / Administration / Aktiv / 05.09.2026, 08:12 · Jonas Feld / Schatzmeisterin / Aktiv / 04.09.2026, 19:40 · Mira Klein / Kassenprüfer + Schriftführung / Aktiv / 28.08.2026, 11:03 · Peter Lang / Kassenprüfer / **Erstlogin offen** / — · Rita Sommer / Schriftführung / Inaktiv / 12.03.2026, 17:22.

Zeilenaktionen: Bearbeiten, Rollen ändern, **Deaktivieren** (kein Löschen). Bestätigungsdialog siehe `1b`: „Nutzer deaktivieren?" — „Jonas Feld kann sich danach nicht mehr anmelden. Bereits protokollierte Vorgänge bleiben erhalten und bleiben ihm zugeordnet."

**Dialog „Nutzer anlegen"** 560 px, `--radius-lg`, `box-shadow: var(--shadow-md)`, dahinter `--overlay`. Kopf: Titel 19 px `--font-heading`, Untertitel 13 px `--muted` „Nach dem Anlegen zeigt das System einmalig ein Startpasswort. Der Nutzer muss es beim ersten Login ändern.", Schließen-× rechts. Körper zweispaltig (`gap: 14px`): Name, E-Mail; darüber volle Breite die Rollen-Auswahl als Checkbox-Reihe in einem Kasten (`--surface-2`, `1px solid var(--line)`, `--radius-md`, `padding: 10px 12px`, `gap: 16px`). Fuß: `--surface-2`, `border-top: 1px solid var(--line)`, links 12 px `--muted` „Anlegen wird protokolliert.", rechts Abbrechen + „Nutzer anlegen". Nach dem Anlegen erscheint der Startpasswort-Dialog aus `2f`.

### `1i` Rollen mit Rechte-Matrix

Zwei Spalten: `grid-template-columns: 280px minmax(0,1fr)`, links Rollenliste (`--surface`, `border-right: 1px solid var(--line)`, `padding: 12px`), rechts Bearbeitung. Kein Seitenwechsel — Rechte werden im Vergleich gelesen.

Listeneintrag: `padding: 10px 12px`, `--radius-md`, Name 14 px/600, Meta 12 px („6 Rechte · 1 Nutzer"). Ausgewählt: `background: var(--selected-bg)`, Text `var(--selected-ink)`, `box-shadow: inset 2px 0 0 var(--color-primary)`. Hover `--hover-surface`. Die Rolle „Administration" trägt ein Schloss-Icon 12 px und die Meta „Alle Rechte · 1 Nutzer · gesperrt" — sie ist nicht editierbar, damit sich niemand selbst aussperrt. Unter der Liste Hinweis 12 px `--muted`: „Rollennamen sind freier Text. Löschen gibt es nicht — eine nicht mehr benötigte Rolle wird von allen Nutzern entfernt und bleibt leer stehen." Oben rechts in der Topbar Primärbutton „Rolle anlegen".

Kopfbereich der Bearbeitung: `--surface`, `border-bottom: 1px solid var(--line)`, `padding: 20px 24px 16px` — Rollenname (280 px) und Beschreibung (Rest), beide 36 px.

**Matrix**, gruppiert nach Modul. Gruppenkopf: `padding: 10px 24px`, `background: var(--table-head-bg)`, `border-bottom: 1px solid var(--line)`, Gruppen-Checkbox mit Teilzustand (16×16, gefüllt `--color-primary`, innen 8×2-Strich in `--on-primary`), Titel 12 px/700 uppercase `letter-spacing: .08em` `--ink-2`, dahinter Zähler 12 px `--muted` („3 von 4 aktiv").

Zeile: `grid-template-columns: 26px 260px minmax(0,1fr)`, `gap: 12px`, `padding: 10px 24px`, `border-bottom: 1px solid var(--line-2)`, ganze Zeile als `<label>` klickbar, Hover `--table-row-hover`. Checkbox 18×18, `--radius-sm`; aus: `background: var(--input-bg)`, `1px solid var(--line-strong)`; an: `background`/`border` `--color-primary` mit Häkchen in `--on-primary` (Stroke 3.5). Mitte: Bezeichnung 14 px/600 über Permission-Key 11 px `--font-mono` `--muted`. Rechts Beschreibung 13 px `--ink-2`. Der Key muss sichtbar bleiben — er erscheint identisch im MCP-Zugang und im Protokoll.

Gruppen und Zeilen (Stufe 1, nur Kern):

| Gruppe | Key | Bezeichnung | Beschreibung |
|---|---|---|---|
| Kern — Verwaltung | `users.manage` | Nutzer verwalten | Nutzer anlegen, bearbeiten, deaktivieren und Rollen zuweisen. |
| | `roles.manage` | Rollen verwalten | Rollen anlegen und deren Rechte ändern. |
| | `settings.manage` | Einstellungen verwalten | Vereinsdaten, Steuerangaben, Bankverbindung und Branding ändern. |
| | `modules.manage` | Module verwalten | Module aktivieren und deaktivieren. |
| Kern — Rechenschaft | `audit.view` | Änderungsprotokoll einsehen | Alle protokollierten Vorgänge lesen und als PDF exportieren. |
| | `documents.view` | Dokumente ansehen | Erzeugte PDFs öffnen und herunterladen. |
| Kern — Erzeugen und Daten | `documents.create` | Dokumente erzeugen | PDFs aus Vorlagen erstellen; das Ergebnis wird protokolliert. |
| | `media.upload` | Dateien hochladen | Logo, Anhänge und Belege in die Mediathek legen. |
| | `backup.export` | Backup exportieren | Vollständigen Datenexport herunterladen. |
| | `backup.import` | Backup importieren | Bestand überschreiben. Nur für die Administration sinnvoll. |

Speicherleiste unten (sticky): `--surface-2`, `border-top: 1px solid var(--line)`, `padding: 12px 24px` — links 13 px/600 in `--color-warning` „2 Änderungen noch nicht gespeichert", rechts Ghost „Verwerfen" und Primär „Rolle speichern".

### `1j` Einstellungen

Reiter unter der Topbar: `--surface`, `border-bottom: 1px solid var(--line)`, `padding: 0 24px`. Reiter `padding: 12px 14px`, 14 px; aktiv `font-weight: 600`, `--ink`, `box-shadow: inset 0 -2px 0 var(--color-primary)`; inaktiv `--ink-2`. **Reiter mit Validierungsfehlern tragen einen Punkt** 7×7 `--radius-full` in `--color-error` — sonst speichert man einen Reiter und übersieht den anderen. Reiter: Verein · Steuer & Bescheide · Bank · Branding.

Formularkarten: `--surface`, `1px solid var(--line)`, `--radius-lg`, `padding: 22px 24px`, `gap: 18px`. Zweispaltig (`repeat(2, minmax(0,1fr))`, `gap: 16px 24px`) nur bei kurzen Feldern; Straße und Satzungszweck spannen `grid-column: 1 / -1`. Feldhöhe 36 px, Label 13 px/600 `--ink-2`, Hilfetext 12 px `--muted`. Trenner innerhalb einer Karte: `height: 1px; background: var(--line-2)`. Zahlenfelder (PLZ, Registernummer, Telefon, Steuernummer, Datum) in `--font-mono`.

- **Verein:** Name · Rechtsform (Select: „Eingetragener Verein (e.V.)", „Nicht eingetragener Verein"; steuert Pflichtfelder) · Straße und Hausnummer · PLZ (120 px) + Ort · Land · Trenner · Registergericht · Registernummer (Hilfetext „Erscheint im Briefbogen-Fuß.") · Kontakt-E-Mail · Telefon.
- **Steuer & Bescheide:** Zusammenfassender Alert oben („2 Angaben sind unvollständig." / „Ohne Steuernummer und Freistellungsbescheid lassen sich keine Zuwendungsbestätigungen erzeugen."), dann Steuernummer (Fehler: „Format 000/000/00000 — es fehlen 5 Stellen.") · Finanzamt · Art des Bescheids (Freistellungsbescheid / Anlage zum Körperschaftsteuerbescheid / Feststellung nach § 60a AO) · Datum des Bescheids (Fehler: „Pflichtangabe, sobald eine Bescheidart gewählt ist.") · Satzungszweck als Textarea (4 Zeilen, Zähler „168 von 500 Zeichen", Hinweis „Wird wörtlich in Zuwendungsbestätigungen übernommen.").
- **Bank:** IBAN, BIC, Bankname (IBAN und BIC in `--font-mono`).
- **Branding:** Logo-Upload als gestrichelte Dropzone (`1px dashed var(--line-strong)`, `--surface-2`, Vorschau 44×44, „PNG oder SVG, mind. 256 px") · Schrift Fließtext (Source Sans 3 (Standard) / Public Sans / Atkinson Hyperlegible) · Schrift Überschriften (Source Serif 4 (Standard) / Wie Fließtext) · Aktives Theme (Default / Vereinsfarben) mit Verweis auf den Theme-Editor.

**Fehlerzustand eines Feldes:** `border-color: var(--color-error)`, `background: var(--color-error-bg)`, `aria-invalid="true"`, Meldung darunter 12 px/600 in `--color-error`.

**Speicherleiste** unten, erscheint bei Änderungen, bleibt sticky: links 13 px `--ink-2` „3 Felder geändert · zuletzt gespeichert am 21.08.2026 von Anna Berger", rechts Ghost „Verwerfen" + Primär „Speichern".

### `1k` Theme-Editor

Drei Spalten: `grid-template-columns: 220px minmax(0,1fr) 400px`.

**Liste (links).** Eintrag: `padding: 9px 11px`, `--radius-md`, Name 14 px/600, vier Farb-Chips 14×14 (`border-radius: 3px`; helle Chips mit `1px solid var(--line-strong)`), Meta 11 px. Default trägt Badge „Aktiv" (10 px/600, `--color-success-bg`/`--color-success`) und die Meta „Schreibgeschützt"; ausgewählt wie in `1i` (`--selected-bg` + inset-Balken), Meta „Entwurf · 4 Tokens abweichend". Darunter gestrichelter Button „Theme anlegen" (34 px, `1px dashed var(--line-strong)`) und Hinweis 11 px `--muted`: „Themes dürfen gelöscht werden — außer dem aktiven und dem Default. Module werden nie gelöscht, nur deaktiviert."

Topbar-Aktionen: „Duplizieren" (sekundär) · „Löschen" (destruktiv-outline, entfällt bei aktivem und Default-Theme) · „Aktivieren" (primär).

**Token-Tabelle (Mitte).** Kopfzeile `grid-template-columns: minmax(0,1fr) 128px 128px`, `padding: 10px 20px`, `--table-head-bg`, Labels TOKEN / HELL / DUNKEL. Zeile: `padding: 8px 20px`, `border-bottom: 1px solid var(--line-2)`; links Token-Name 12 px `--font-mono` über Verwendungszweck 11 px `--muted`; rechts zwei Farbfelder 30 px hoch (`1px solid var(--line-strong)`, `--radius-sm`, `--input-bg`) mit Swatch 16×16 und Hex 11 px `--font-mono`. **Hell und Dunkel stehen nebeneinander, nicht hinter einem Umschalter** — sonst wird Dunkel nie gepflegt.

**Kontrastwarnung** als Kasten in der Tabelle: `--color-warning-bg`, `1px solid var(--color-warning)`, `--radius-md`, Warn-Icon, Titel 13 px/600 in `--color-warning` mit **Zahl** („Kontrast unter AA: 3,1:1"), Erklärung mit betroffenem Tokenpaar und Modus, konkreter Vorschlag und Button „Vorschlag übernehmen" (30 px, outline in `--color-warning`). Fußnote: „Jedes Theme enthält alle Tokens vollständig — keine Vererbung, damit eine Änderung am Default kein anderes Theme verschiebt. „Duplizieren" füllt die Werte des Ausgangsthemes vor."

**Live-Vorschau (rechts).** `--surface-2`, `border-left: 1px solid var(--line)`, `padding: 16px`. Kopf: „Live-Vorschau" 13 px/600 plus Segmented Hell/Dunkel (28 px, `1px solid var(--line-strong)`, `--radius-md`, aktiv `--color-primary`/`--on-primary`, inaktiv `--surface`/`--ink-2`). Der Vorschaukasten setzt die Theme-Werte lokal (im Prototyp `data-theme`) und zeigt: Sidebar-Ausschnitt mit Gruppentitel und aktivem Eintrag · drei Buttons (primär, sekundär, destruktiv) · vier Badges (Aktiv, Offen, Fehler, Inaktiv) · ein Eingabefeld · eine Mini-Tabelle mit Kopf, Zebra- und Hover-Zeile. Genau diese Kombination deckt Kontrastfehler auf. Darunter Kontrastprüfung als Liste: Tokenpaar links, Verhältnis rechts in `--font-mono` (`--color-success` mit ✓ bzw. `--color-warning` mit ⚠).

Das Default-Theme ist schreibgeschützt: „Bearbeiten" legt automatisch eine Kopie an.

### `1l` Module

Karten statt Tabelle, weil jedes Modul einen Satz Erklärung braucht. Oben ein Hinweiskasten (`--surface-2`, `1px solid var(--line)`): „Beim Deaktivieren bleiben alle Daten des Moduls erhalten. Die Navigationsgruppe verschwindet, Berichte und protokollierte Vorgänge bleiben lesbar. Aktivieren stellt den Zustand unverändert wieder her."

Karte: `--radius-lg`, `padding: 16px 18px`, `grid-template-columns: minmax(0,1fr) 190px`. Links: Titel 17 px `--font-heading`, Zustands-Badge, Modulschlüssel 11 px `--font-mono`; darunter Beschreibung 14 px/1.5 `--ink-2` (max. 640 px) und Meta 12 px `--muted` (Version, Abhängigkeiten). Rechts: Zustandstext 13 px/600 + Switch (38×22, `--radius-full`; an `--color-primary` mit Knopf `--on-primary` bei `left: 19px`, aus `--line-strong` mit Knopf `--surface` bei `left: 3px`), darunter Notiz 11 px `--muted` rechtsbündig.

- **Kern** (`core`) — Badge „Immer aktiv" (`--color-primary-soft`/`--color-primary-ink`), Switch gesperrt (`--disabled-bg`/`--disabled-ink`), Zustand „Gesperrt", Notiz „Ein Verein ohne Kern hätte keine Anmeldung."
- **Finanzen** (`finance`) — inaktiv, Meta „benötigt Steuerangaben in den Einstellungen", Notiz „Voraussetzung für Zuwendungsbestätigungen."
- **Mitglieder** (`members`), **Tiere** (`animals`), **Webseite** (`website`) — inaktiv, mit Beschreibung und Version.

Zählung in der Topbar: „1 von 5 aktiv". Module werden nie gelöscht.

### `1m` Änderungsprotokoll

**Filterleiste** (`--surface`, `border-bottom: 1px solid var(--line)`, `padding: 16px 20px`, 32 px Kontrollen): Suchfeld 200 px („Objekt oder Wert"), Select Nutzer, Select Kanal (Alle / Oberfläche / MCP / System), Select Aktion, Datumsbereich in `--font-mono`, rechts Zählung „248 Einträge". Topbar rechts: Sekundärbutton „Als PDF exportieren" mit Download-Icon.

**Tabelle:** `grid-template-columns: 150px 130px 110px 140px 190px minmax(0,1fr)` — Zeitpunkt · Nutzer · Kanal · Aktion · Objekt · Zusammenfassung. Kopf 36 px, Zeilen `var(--row-h)`, Zebra und Hover wie in `1h`, ausgewählte Zeile `--selected-bg`. Zeitstempel 12 px `--font-mono` **mit Sekunden**. Zusammenfassung mit Ellipsis. Klick öffnet die Seitenleiste.

**Kanal-Badge** (11 px/600, `padding: 2px 7px`, `--radius-sm`): Oberfläche → `--color-info-bg`/`--color-info`; MCP → `--color-accent-soft`/`--color-accent-deep`; System → `--neutral-badge-bg`/`--neutral-badge-ink`. **Systemeinträge tragen keinen Nutzer** (Spalte „—") und entstehen bei Migration, Seed, Import und automatischen Sperren.

**Seitenleiste (420 px)**, `border-left: 1px solid var(--line)`, `--surface`, `box-shadow: var(--shadow-md)`; öffnet von rechts, Fokus wandert hinein, Esc schließt. Kopf: Aktionstitel 17 px `--font-heading` über Zeitstempel 12 px `--font-mono` `--muted`, Schließen-×.

**Feld-Diff**, nicht Textblock-Diff: pro geändertem Feld ein Kasten (`--surface-2`, `1px solid var(--line)`, `--radius-md`, `padding: 10px 12px`) mit Bezeichnung 13 px/600 über Key 11 px `--font-mono`, darunter zwei Zeilen mit 38 px breiten Labels „vorher" / „nachher": alter Wert in `--code-bg`/`--muted` mit `text-decoration: line-through`, neuer Wert in `--color-success-bg`/`--color-success` und `font-weight: 600`, beide `--font-mono` 12 px.

**Kontextblock** darunter (`grid-template-columns: 110px minmax(0,1fr)`, 13 px): Nutzer · Kanal (inkl. Token-Name bei MCP) · Herkunft (IP, `--font-mono`) · Vorgang (ID, `--font-mono`) · Umgebung. Fuß: „Einträge können nicht geändert werden." plus Button „Eintrag als PDF".

### `1n` Dokumente

`grid-template-columns: minmax(0,1fr) 400px` — links Liste, rechts Dialog/Vorschau-Panel (`--surface-2`).

**Liste:** Spalten Vorlage/Titel · Bezug (170 px) · Erstellt von (140 px) · Datum (120 px, `--font-mono`) · Aktion (90 px, Download-Icon). Zeile 52 px: Titel 14 px/600 mit optionalem Badge, darunter „Vorlage · Nummer" 12 px `--muted` (Nummer in `--font-mono`).

**Nummerierung:** lückenlos **je Vorlage und Jahr** — `BRF-2026-004`, `PRO-2026-002`. **Storno statt Löschen:** stornierte Dokumente behalten ihre Nummer, Titel in `--muted`, Badge „Storniert" (`--neutral-badge-bg`/`--neutral-badge-ink`); ein Ersatz erhält eine neue Nummer. Die PDF bleibt erhalten. Fußnote: „Dokumente werden nicht gelöscht. Ein fehlerhaftes Dokument wird storniert; es bleibt mit dem Vermerk „storniert" in der Liste."

**Dialog „Dokument erzeugen":** Vorlage (Select; Vorlagen inaktiver Module sind `disabled` — „Zuwendungsbestätigung (Modul Finanzen)"), Titel, Text (Textarea 4 Zeilen), Checkbox „Briefkopf und Vereinsangaben einsetzen" (aktiv), Fuß mit Abbrechen + „Erzeugen".

**Vorschau-Panel:** Kopf „Vorschau · `BRF-2026-004`" plus „1 von 2 Seiten". Blattandeutung: `--surface`, `1px solid var(--line-strong)`, `--radius-sm`, `box-shadow: var(--shadow-sm)`, oben links Logo-Platzhalter, oben rechts dreizeilige Vereinsangaben 8 px `--muted`, Trennlinie, Ort/Datum, Titel 13 px `--font-heading`, Fließtext 9 px/1.65, darunter Fülllinien. Aktionen: „Herunterladen" und „Neu erzeugen" (kein Bearbeiten — erzeugte Dokumente sind unveränderlich).

### `1o` Backup

**Export-Karte:** `grid-template-columns: minmax(0,1fr) 220px`. Links Titel 18 px, Text „Vollständiger Datenbestand samt Dokumenten, Protokoll und Einstellungen als eine Datei. Themes und Module sind enthalten, Zugangsdaten und API-Tokens nicht.", darunter drei Kennzahlen (Label 13 px `--muted` über Wert 13 px/600, Datum und Größe in `--font-mono`): Letzter Export 02.09.2026, 11:22 · Größe 24,8 MB · Von Anna Berger. Rechts Primärbutton 38 px „Export erstellen" mit Download-Icon, darunter „Dauert etwa 40 Sekunden."

**Import-Karte:** `1px solid var(--color-warning)`. Titel plus Badge „Überschreibt alles" (`--color-warning-bg`/`--color-warning`). Warnkasten: „Der Import ersetzt den gesamten Bestand dieser Umgebung, einschließlich Änderungsprotokoll. Erstellen Sie vorher einen Export. Der Vorgang selbst wird im neuen Bestand als erster Eintrag protokolliert." Datei-Dropzone (gestrichelt, `--surface-2`) mit Dateiname 13 px/600 und Metadaten 12 px `--muted` („24,8 MB · erstellt mit Version 1.0.0 · 5 Nutzer, 248 Protokolleinträge, 14 Dokumente") plus Button „Andere Datei". Fuß mit `border-top: 1px solid var(--color-warning)`: Abbrechen + „Import vorbereiten" (`--color-warning` als Fläche, Text `#FFFFFF`).

**Warnfarbe statt Rot ist Absicht:** Rot bleibt Validierungsfehlern und destruktiven Aktionen vorbehalten; ein Import ist beabsichtigt, aber gefährlich.

**Bestätigungsdialog (520 px):** Warn-Icon 20 px, Titel „Bestand der Umgebung „test" überschreiben?", Text mit konkreten Zahlen („5 Nutzer, 248 Protokolleinträge und 14 Dokumente werden durch den Inhalt der Datei ersetzt. Dieser Schritt lässt sich nicht rückgängig machen."). Darunter Label „Tippen Sie zur Bestätigung den Umgebungsnamen", Eingabefeld 38 px in `--font-mono` und **daneben sichtbar der erwartete Wert** als Code-Chip (`--code-bg`) — in Test `test`, in Produktion `produktion`. Der Bestätigungsknopf bleibt deaktiviert (`--disabled-bg`/`--disabled-ink`), bis der Text exakt übereinstimmt; Fußnote links „Noch nicht bestätigt."

**Nach dem Import:** Alle Sitzungen sind ungültig, der Nutzer landet auf der Login-Seite mit dem Hinweis „Import abgeschlossen" (siehe `2f`).

### `1p` Profil und API-Tokens

`grid-template-columns: 340px minmax(0,1fr)`.

**Links:** Identitätskarte (Avatar 44×44, Name 15 px/600, E-Mail 13 px `--muted`, Rollen-Badges, Hinweis „Name und E-Mail ändert die Administration unter Verwaltung → Nutzer."). Darunter Karte „Passwort ändern": Aktuelles Passwort · Neues Passwort mit vierteiliger Stärkeanzeige (4 px hohe Segmente, `gap: 4px`, gefüllt `--color-success`, leer `--line-strong`) und Text „16 Zeichen — gut. Mindestens 12 sind nötig." · Wiederholen · Primärbutton „Passwort ändern" · Fußnote „Alle anderen Sitzungen werden abgemeldet, API-Tokens bleiben gültig."

**Rechts:** Karte „API-Tokens (MCP-Zugang)" mit Erklärsatz „Ein Token wirkt mit *Ihren* Rechten. Vorgänge über MCP erscheinen im Änderungsprotokoll mit dem Kanal „MCP" und dem Namen des Tokens." und Primärbutton „Token erstellen".

Tabelle `grid-template-columns: minmax(0,1fr) 120px 150px 110px`, Zeilen 52 px: Name 14 px/600 über Präfix 11 px `--font-mono` (`akx_live_7f3c…`) · Erstellt (`--font-mono`) · Zuletzt genutzt (`--font-mono`; **ungenutzte Tokens in `--color-warning`**, z. B. „seit 100 Tagen nicht") · Aktion „Widerrufen" (30 px, outline `--color-error`). Widerrufene Zeilen: Name in `--disabled-ink`, Spalte zeigt „widerrufen 12.08.2026", Aktionschip deaktiviert. Fußnote: „Widerrufene Tokens bleiben mit Datum in der Liste, damit Protokolleinträge zuordenbar bleiben."

**Dialog nach dem Erstellen (520 px):** Titel „Token „Buchhaltung Skript" erstellt", Text „Kopieren Sie das Token jetzt. Es wird nach dem Schließen dieses Dialogs nicht mehr angezeigt und kann nur widerrufen und neu erstellt werden." Klartext in `--code-bg`-Kasten (`1px solid var(--line-strong)`, `--radius-md`, 13 px `--font-mono`, `word-break: break-all`) mit Button „Kopieren". Info-Kasten: „Gültig ohne Ablauf, Rechte wie Ihr Konto. Bei Verdacht auf Weitergabe sofort widerrufen." **Kein ×**; der Dialog wird nur über „Ich habe das Token gespeichert" verlassen.

### `1a` Token-Sheet und `1b` Komponenten-Sheet

Referenz-Artboards für die Implementierung, kein Produkt-Screen. `1a` listet alle Tokens mit Hell/Dunkel-Wert und Verwendungszweck sowie die 27 Ergänzungsvorschläge (unten vollständig als Tabellen). `1b` zeigt Buttons, Felder mit Fehler, Select, Checkbox, Switch, Badges, Tabelle mit Sortierung und Zebra, leeren Zustand, Toasts, Menü, Bestätigungsdialog und Seitenleiste — inklusive Fokus- und Deaktiviert-Zustand.

### `1q` Entscheidungen und offene Punkte

Dokumentation der Design-Entscheidungen; enthält die vom Architekten bestätigten Regeln und die verbleibende offene Frage (siehe „Open questions").

### `2c` Befehlspalette (⌘K)

Overlay `--overlay`, Palette 600 px, `top: 96px`, `--radius-lg`, `box-shadow: var(--shadow-md)`. Eingabezeile 50 px mit Lupe 17 px, Eingabetext 15 px, `border-bottom: 1px solid var(--line)`. Ergebnisliste `padding: 6px`, Gruppenüberschriften 11 px/700 `letter-spacing: .08em` `--muted` („NAVIGATION", „EINSTELLUNGEN", „AKTIONEN"). Eintrag `padding: 9px 10px`, `--radius-sm`, Icon 16 px, Label 14 px, rechts der Ort als Pfad 12 px `--muted` („Verwaltung", „Einstellungen / Verein"). Markierter Eintrag: `--selected-bg`/`--selected-ink` plus „↵"-Chip. Aktionen nennen ihr Recht (`benötigt roles.manage`). **Einträge inaktiver Module erscheinen ausgegraut mit Grund** („Modul Finanzen nicht aktiv") statt zu fehlen. Fußzeile `--surface-2`: ↑↓ wählen · ↵ öffnen · esc schließen · rechts „Nur Einträge, für die Sie Rechte haben."

Umfang in Stufe 1: Navigationsziele, Einstellungsfelder und die vorhandenen Aktionen. Module hängen später ihre Entitäten an.

### `2d` Fehlerseiten (403, 404, 500)

Alle drei **innerhalb der Shell**, nicht als leere Vollbildseite — der Nutzer soll weiterklicken können. Karte `--radius-lg`, `padding: 28px 24px`, `min-height: 320px`. Kopf: Code-Chip 12 px `--font-mono`/600 plus Kurzbezeichnung 12 px `--muted`. Titel 20 px `--font-heading`, Erklärung 14 px/1.55 `--ink-2`, Aktionen unten (`margin-top: auto`). Keine Illustrationen.

- **403** — Chip `--color-warning-bg`/`--color-warning`, „Kein Recht". „Diese Seite ist für Ihre Rolle nicht freigegeben." Der fehlende Permission-Key steht im Klartext als Code-Chip; das beantwortet die Frage an die Administration. Button „Zurück zur Startseite", Fußnote „Rechte ändert die Administration unter Rollen."
- **404** — Chip `--neutral-badge-bg`/`--neutral-badge-ink`, „Nicht gefunden". „Diesen Eintrag gibt es nicht mehr." Verweis darauf, dass protokollierte Daten nicht gelöscht werden. Buttons „Startseite" und „Protokoll öffnen".
- **500** — Karte mit `1px solid var(--color-error)`, Chip `--color-error-bg`/`--color-error`, „Technischer Fehler". „Der Vorgang wurde abgebrochen." plus „Es wurde nichts gespeichert." Kopierbare Vorgangsnummer in `--code-bg` (erscheint identisch im Serverprotokoll). Buttons „Erneut versuchen" (primär) und „Startseite".

### `2e` Ladezustände

Drei Muster nach Dauer:

- **Export (~1 min):** Titel „Export läuft", Schrittangabe „Schritt 2 von 4 · Dokumente werden gepackt", Balken 8 px (`--radius-full`, Spur `--surface-2`, Füllung `--color-primary`), darunter „11,4 von 24,8 MB" und „46 %" (`--font-mono`). Hinweis „Sie können weiterarbeiten. Der Download startet, sobald die Datei fertig ist." Abbrechen möglich.
- **Import (Minuten, unumkehrbar):** Karte mit `1px solid var(--color-warning)`. Schrittliste: erledigte Schritte mit Häkchen in `--color-success`, aktueller Schritt fett mit Spinner (15×15, `border: 2px solid var(--color-primary)`, `border-top-color: transparent`) und Zähler („Daten werden geschrieben (248 von 1.412)"), offene Schritte in `--muted-2` mit leerem Kreis. Warnkasten: „Fenster nicht schließen. Ab hier lässt sich der Vorgang nicht mehr abbrechen; danach werden alle Sitzungen abgemeldet." **Kein Abbrechen-Knopf ab dem Schreibschritt.**
- **Rendering (< 2 s):** Skelett in der Vorschau statt Prozentwert (Flächen in `--surface-2`), Hinweis „Erst ab vier Sekunden erscheint zusätzlich ein Textstatus. Buttons, die etwas auslösen, bleiben währenddessen deaktiviert."

Fortschrittsbalken nutzen `--color-primary`, nicht Grün — fertig ist erst fertig.

### `2f` Passwort-Wege

- **Startpasswort-Dialog** (nach „Nutzer anlegen"): Titel „Nutzer „Peter Lang" angelegt", Text „Geben Sie diese Zugangsdaten weiter. Das Startpasswort wird nach dem Schließen nicht mehr angezeigt; ein neues können Sie jederzeit setzen." Kopierbarer Block in `--code-bg` mit zwei Feldern (Label 11 px/600 `letter-spacing: .06em` `--muted`): E-MAIL (13 px `--font-mono`) und STARTPASSWORT (15 px/500 `--font-mono`, Format wie `wiese-kanu-73-lampe` — sprechbare Wortkette, weil das Passwort mündlich weitergegeben wird). Buttons „Beides kopieren" und „Als PDF drucken". Info-Kasten: „Beim ersten Login muss Peter Lang ein eigenes Passwort setzen. Bis dahin steht in der Liste „Erstlogin offen"." Abschluss nur über „Ich habe die Daten notiert" — **kein ×**.
- **Pflichtwechsel beim ersten Login:** eigene Seite ohne Navigation (Shell erscheint erst danach), Karte 360 px. Titel „Neues Passwort festlegen", Text „Sie haben sich mit einem Startpasswort angemeldet. Legen Sie ein eigenes fest, um fortzufahren." Neues Passwort mit Stärkeanzeige, Wiederholen, Primärbutton „Passwort setzen und fortfahren". Fußnote: „Kein Überspringen, kein Abmelden-Knopf: ohne eigenes Passwort gibt es keinen Zugang. Der Wechsel wird protokolliert."
- **Login nach Import:** Login-Karte mit Status-Kasten (`role="status"`, `--color-info-bg`, Häkchen-Icon): „Import abgeschlossen" / „Alle Sitzungen wurden beendet. Melden Sie sich mit den Zugangsdaten aus dem eingelesenen Bestand an." Neutral als Info, nicht als Fehler — es ist nichts schiefgegangen. Fußnote: „Nach fünf Fehlversuchen 15 Minuten Sperre; die Sperre steht als Systemeintrag im Protokoll. Ein Admin kann ein neues Startpasswort setzen."

## Interactions & Behavior

**Navigation.** Sidebar-Eintrag → Route; aktiver Zustand aus der Route. Einklappen/Aufklappen über Kopfknopf, Topbar-Knopf oder `[`; Zustand **pro Nutzer im Browser** (localStorage). Unter 1180 px wird die Sidebar zum Drawer (Overlay, Focus-Trap, Esc schließt).

**Befehlspalette.** `⌘K` / `Strg+K` öffnet, `Esc` schließt, `↑↓` wählt, `↵` öffnet. Ergebnisse werden nach Rechten gefiltert; Einträge inaktiver Module erscheinen deaktiviert mit Grund.

**Dialoge.** `--overlay` dahinter, Fokus wandert in den Dialog, `Esc` und Klick daneben schließen — **außer** bei den Einmal-Anzeigen (API-Token, Startpasswort) und ab dem Schreibschritt des Imports; dort gibt es nur den bestätigenden Ausgang.

**Seitenleiste.** Öffnet von rechts (420 px), überlagert den Inhalt, Fokus wandert hinein, `Esc` schließt.

**Formulare.** Validierung beim Verlassen des Feldes und beim Speichern. Fehlerzustand: Rahmen `--color-error`, Fläche `--color-error-bg`, `aria-invalid`, Meldung darunter; zusätzlich Punktmarkierung am betroffenen Reiter und ein zusammenfassender Alert oben. Die Speicherleiste erscheint bei Änderungen, nennt die Anzahl geänderter Felder und bleibt sticky; „Verwerfen" setzt auf den geladenen Stand zurück.

**Tabellen.** Sortierung per Klick auf den Spaltenkopf (Chevron zeigt die Richtung; sortierte Spalte in `--ink-2`). Zeilenklick öffnet Detail (Protokoll, Dokumente). Zebra plus Hover plus Auswahl müssen drei unterscheidbare Werte bleiben (`--table-zebra`, `--table-row-hover`, `--selected-bg`).

**Toasts.** Rechts unten, `--surface`, `1px solid var(--line)`, links 3 px Statuskante (`--color-success` bzw. `--color-error`), `box-shadow: var(--shadow-md)`, Titel 14 px/600, Text 13 px `--muted`, Schließen-×. Beispiele: „Einstellungen gespeichert" / „Änderungen sind im Protokoll vermerkt." und „Import abgebrochen" / „Die Datei stammt aus einer neueren Version."

**Theme-Umschaltung.** Hell/Dunkel im Nutzermenü (Switch im Menüeintrag), gemerkt pro Nutzer. Der Theme-Editor schaltet nur seine eigene Vorschau um.

**Barrierefreiheit.** Kontrast mindestens WCAG AA (Werte siehe Tokens), Fokus überall sichtbar: `outline: 2px solid var(--focus-ring); outline-offset: 2px`. Vollständige Tastaturbedienbarkeit; deaktivierte Navigationseinträge tragen `aria-disabled="true"` und sind nicht fokussierbar. Statusinformationen nie nur über Farbe (Punkt-Badges, Icons, Text). Alerts mit `role="alert"`, neutrale Meldungen mit `role="status"`.

**Umgebungsbalken.** Aus der Server-Umgebung gelesen, in Dev und Test immer sichtbar, nicht schließbar, nicht theme-abhängig; in Produktion nicht gerendert.

## State Management

- `theme: 'light' | 'dark'` — pro Nutzer, im Browser gemerkt; setzt das `dark`-Wertset der Tokens.
- `activeTheme: themeId` — vereinsweit, aus den Einstellungen; liefert die Token-Werte.
- `sidebarCollapsed: boolean` — pro Nutzer im Browser.
- `sidebarDrawerOpen: boolean` — nur unter 1180 px, transient.
- `commandPaletteOpen: boolean`, `commandQuery: string`.
- `rowDensity` → `--row-h` (36 / 44 / 56 px). **Offene Frage:** pro Verein oder pro Nutzer (siehe unten).
- Formularseiten: `values`, `initialValues`, `errors`, `isDirty`, `dirtyCount`, `saving` — die Speicherleiste hängt an `isDirty`.
- Rollen: `selectedRoleId`, `permissions: Record<permissionKey, boolean>`, `pendingChangeCount`; Gruppen-Checkbox berechnet `all | some | none`.
- Theme-Editor: `selectedThemeId`, `draftTokens: Record<token, {light, dark}>`, `previewMode: 'light' | 'dark'`, `contrastFindings: Array<{pair, mode, ratio, suggestion}>`.
- Protokoll: `filters {query, userId, channel, action, dateRange}`, `selectedEntryId`, `entry.diff: Array<{key, label, before, after}>`.
- Backup: `exportJob {step, of, bytesDone, bytesTotal}`, `importJob {steps[], currentStep, written, total}`, `confirmText` (Freigabe nur bei exakter Übereinstimmung mit dem Umgebungsnamen).
- Einmal-Anzeigen: `oneTimeSecret: string | null` — wird ausschließlich im Dialog gehalten, nie erneut vom Server abrufbar (Token wie Startpasswort nur als Hash gespeichert).
- Auth: `session`, `mustChangePassword: boolean` (blockt alle Routen außer der Wechselseite), `failedAttempts`, `lockedUntil`.

**Datenanforderungen:** Alle schreibenden Vorgänge erzeugen einen Protokolleintrag mit Kanal (`ui` | `mcp` | `system`), Nutzer (bei `system` leer), Objekt, Aktion, Feld-Diff, IP, Vorgangs-ID und Umgebung. Dokumentnummern werden je Vorlage und Jahr lückenlos vergeben.

## Design Tokens

Alle Werte als CSS-Variablen; ein Theme liefert für jedes Token einen `light`- und einen `dark`-Wert. Keine Vererbung zwischen Themes: jedes Theme ist vollständig, „Duplizieren" füllt vor.

### Marke

| Token | Light | Dark | Verwendung |
|---|---|---|---|
| `--color-primary` | `#2F5D68` | `#74B4C0` | Primäre Aktion, aktiver Navigationseintrag |
| `--color-primary-ink` | `#20454E` | `#A9D5DC` | Hover/Pressed auf Primary, Text auf `-soft` |
| `--color-primary-soft` | `#E3EEF0` | `#1C3A40` | Aktive Nav-Fläche, Rollen-Badge, Auswahl |
| `--color-accent` | `#9C5637` | `#D98B6A` | Zweitakzent: MCP-Badge, Akzentflächen |
| `--color-accent-deep` | `#7A3F27` | `#EFB79D` | Text auf `--color-accent-soft` |
| `--color-accent-soft` | `#F6E8E0` | `#38241B` | Hintergrund für Akzentflächen |

### Status

| Token | Light | Dark | Verwendung |
|---|---|---|---|
| `--color-success` | `#2E6B47` | `#72C093` | Aktiv, gespeichert, erfolgreicher Export |
| `--color-success-bg` | `#E5F1EA` | `#153020` | Fläche hinter Erfolg |
| `--color-warning` | `#8A5A05` | `#DFB45F` | Unvollständig, Kontrast unter AA, Import |
| `--color-warning-bg` | `#FAF0DA` | `#33270F` | Fläche hinter Warnung |
| `--color-error` | `#A32B2B` | `#E88C86` | Validierungsfehler, destruktive Aktion |
| `--color-error-bg` | `#F9E7E6` | `#3A1D1C` | Fläche hinter Fehler, fehlerhaftes Feld |
| `--color-info` | `#2B5488` | `#8FB6E8` | Neutrale Hinweise, Kanal „Oberfläche" |
| `--color-info-bg` | `#E6EDF7` | `#17253A` | Fläche hinter Hinweis |

### Flächen

| Token | Light | Dark | Verwendung |
|---|---|---|---|
| `--bg` | `#F6F6F4` | `#14161A` | Fensterhintergrund, Login, Inhaltsbereich |
| `--surface` | `#FFFFFF` | `#1B1E23` | Karte, Tabelle, Dialog |
| `--surface-2` | `#F1F1EE` | `#22262C` | Speicherleiste, eingebettete Blöcke |
| `--sidebar-bg` | `#F1F1EE` | `#101216` | Sidebar (im Dunkel tiefer als `--surface`) |
| `--topbar-bg` | `#FFFFFF` | `#1B1E23` | Topbar |

### Schrift und Linien

| Token | Light | Dark | Verwendung |
|---|---|---|---|
| `--ink` | `#191C1F` | `#ECEDEE` | Primärtext, Titel (13,9:1 / 13,1:1) |
| `--ink-2` | `#3C4249` | `#C7CACE` | Labels, Sekundärtext |
| `--muted` | `#666D75` | `#9AA1A9` | Hilfetext, Tabellenkopf (AA bei 14 px) |
| `--muted-2` | `#8B9199` | `#6F767E` | Nur Icons, Trennzeichen — **nicht für Text** |
| `--on-primary` | `#FFFFFF` | `#0D1A1D` | Text/Icon auf `--color-primary` |
| `--on-primary-muted` | `#C6DDE2` | `#2C4A50` | Sekundärtext auf Primary-Flächen |
| `--line` | `#E4E4E0` | `#2C3138` | Standardrahmen |
| `--line-2` | `#EEEEEA` | `#22262C` | Zeilentrenner |
| `--line-strong` | `#C8C8C2` | `#414851` | Feldrahmen, sekundärer Button, Switch aus |

### Ergänzungsvorschläge (im Design bereits verwendet, im Schema des Briefings nicht enthalten)

| Token | Light | Dark | Begründung |
|---|---|---|---|
| `--focus-ring` | `#2F5D68` | `#74B4C0` | Getrennt von Primary, damit Vereine mit hellem Primary einen dunklen Ring setzen können |
| `--hover-surface` | `#EDEDE9` | `#262B31` | Hover auf Nav, Menü, sekundärem Button |
| `--active-surface` | `#E4E4DF` | `#2E343B` | Gedrückter Zustand |
| `--selected-bg` | `#E3EEF0` | `#1C3A40` | Ausgewählter Listeneintrag/Zeile |
| `--selected-ink` | `#20454E` | `#A9D5DC` | Text in der Auswahl |
| `--table-head-bg` | `#F1F1EE` | `#22262C` | Tabellenkopf, eigenständig von `--surface-2` |
| `--table-zebra` | `#FAFAF8` | `#1E2227` | Zebrastreifen, subtiler als `--surface-2` |
| `--table-row-hover` | `#F3F3F0` | `#262B31` | Zeilen-Hover, muss von Zebra und Auswahl unterscheidbar sein |
| `--input-bg` | `#FFFFFF` | `#14161A` | Feldfläche; im Dunkel tiefer als `--surface` |
| `--input-placeholder` | `#8B9199` | `#6F767E` | Platzhaltertext |
| `--disabled-ink` | `#A3A8AE` | `#5C636B` | Deaktivierte Texte und Steuerelemente |
| `--disabled-bg` | `#F1F1EE` | `#22262C` | Fläche deaktivierter Steuerelemente |
| `--overlay` | `rgba(25,28,31,.42)` | `rgba(5,6,8,.62)` | Abdunklung hinter Dialog und Drawer |
| `--shadow-sm` | `0 1px 2px rgba(25,28,31,.07)` | `0 1px 2px rgba(0,0,0,.4)` | Schatten muss im Dunkel anders sein |
| `--shadow-md` | `0 6px 18px -4px rgba(25,28,31,.14)` | `0 8px 22px -4px rgba(0,0,0,.55)` | Dialog, Toast, Menü, Seitenleiste |
| `--link` | `#2F5D68` | `#74B4C0` | Inline-Link; sonst erbt der Browser Blau |
| `--link-hover` | `#20454E` | `#A9D5DC` | Link-Hover |
| `--neutral-badge-bg` | `#EEEEEA` | `#22262C` | Neutrales Badge |
| `--neutral-badge-ink` | `#3C4249` | `#C7CACE` | Text im neutralen Badge |
| `--tooltip-bg` | `#191C1F` | `#ECEDEE` | Tooltip invertiert die Fläche |
| `--tooltip-ink` | `#FFFFFF` | `#14161A` | Tooltip-Text |
| `--code-bg` | `#F1F1EE` | `#22262C` | Permission-Keys, IBAN, Token-Klartext, Diff-Werte |
| `--font-mono` | `IBM Plex Mono` | `IBM Plex Mono` | Beträge, IBAN, Keys, Zeitstempel brauchen Tabellenziffern |
| `--radius-full` | `999px` | `999px` | Switch, Avatar, Fortschrittsbalken |
| `--row-h` | `44px` | `44px` | Zeilenhöhe als Token (Datendichte einstellbar) |

### Typografie und Form

| Token | Wert |
|---|---|
| `--font-body` | `"Source Sans 3", system-ui, sans-serif` |
| `--font-heading` | `"Source Serif 4", Georgia, serif` |
| `--font-mono` | `"IBM Plex Mono", ui-monospace, monospace` |
| `--radius-sm` | `4px` — Badge, Checkbox, Farbfeld |
| `--radius-md` | `6px` — Feld, Button, Tabellenrahmen |
| `--radius-lg` | `10px` — Karte, Dialog, Artboard |
| `--radius-full` | `999px` — Switch, Avatar, Balken |

**Typografie-Skala.** 11 px (Breadcrumb, Meta, Gruppentitel) · 12 px (Badges, Tabellenkopf, Hilfetext) · 13 px (Labels, Sekundärtext, dichte Zellen) · 14 px (Fließtext, Tabellenzellen, Buttons) · 15 px (Login-/Startseiten-Fließtext) · 17–20 px (Kartentitel, `--font-heading`) · 22–26 px (Seiten- und Screen-Titel, `--font-heading`). Zeilenhöhe 1.45–1.6 im Text, 1.15–1.2 in Titeln. Gewichte: 400 Fließtext, 600 Labels/Titel/Buttons, 700 nur Uppercase-Gruppentitel und Avatar-Initialen. `--font-heading` erscheint nur in Seitentiteln, Kartentiteln und Dialogtiteln — nicht in Labels, nie in Tabellenzellen.

**Abstandsskala:** 2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 28 · 32 px. Kartenpadding 18–28 px, Seitenpadding 24 px (Startseite 28/32 px), Tabellenzellen `padding: 0 16px` (Sheets 24 px).

**Feste Höhen:** Topbar 56 px · Sidebar-Kopf 56 px · Nav-Eintrag 34 px (Drawer 38 px) · Kontrollen 34 px in Leisten, 36 px in Formularen, 38–40 px in Login und Einrichtung · Tabellenkopf 36–38 px · Tabellenzeile `var(--row-h)` · Umgebungsbalken 28 px · Sidebar eingeklappt 56 px breit.

**Umgebungsbalken (nicht themebar):** Test `#1A1A1A` mit `#F2C200`; Entwicklung `#B3261E` mit `#FFFFFF`. Diese vier Werte sind die einzigen Farben im Code, die kein Theme überschreiben darf.

## Assets

- **Fonts:** Source Sans 3 (300–800), Source Serif 4 (400–700), IBM Plex Mono (400, 500) — alle SIL Open Font License, im Prototyp über Google Fonts geladen. Für eine NAS-Installation ohne Internetzugang **lokal ausliefern** (self-hosted `@font-face`), nicht per CDN.
- **Icons:** 24er-Grid, `stroke-width: 1.8` in der Navigation, `2`–`2.4` in Buttons und Alerts, `3`–`3.5` in Häkchen; `stroke-linecap`/`-linejoin: round`. Die Pfade im Prototyp entsprechen Lucide (users, shield, sliders, droplet, grid, clock, file-text, database, euro, home, search, plus, download, copy, alert-triangle, info, lock, panel-left, menu, x, chevron).
- **Logo:** überall Platzhalter. Das Vereinslogo kommt als Upload (PNG/SVG, mind. 256 px) und wird in Sidebar-Kopf (28×28), Dokumentkopf und Login-Marke eingesetzt.
- Keine Bilder, keine Illustrationen. Der Prototyp verwendet nichts, was nicht als Text, Token oder Icon vorliegt.

## Files

- `Aluna Kompass Fundament.dc.html` — das komplette Design-Board mit allen Artboards, Tokens und Anmerkungen. Öffnet direkt im Browser. Aufbau: Token-Definitionen im `<style>`-Block im Kopf (`:root, [data-theme="light"]` und `[data-theme="dark"]`), darunter zwei `<section>`-Blöcke (Runde 2 oben, Runde 1 darunter), Beispieldaten und Tabellenzeilen in der Logikklasse am Dateiende (`tokenGroups`, `proposed`, `users`, `permGroups`, `modules`, `auditRows`, `diffRows`, `docs`, `tokens`, `editorRows`, `homeCards`, `navAdmin`).
- `support.js` — Laufzeit des Prototyps. **Nicht Teil des Designs**, nur nötig, damit die HTML-Datei rendert.

Artboard-IDs zum Nachschlagen: `1a` Token-Sheet · `1b` Komponenten-Sheet · `1c` Erste Einrichtung · `1d` Login · `1e` Shell hell · `1f` Shell dunkel · `1g` Umgebungsbalken · `1h` Nutzer · `1i` Rollen · `1j` Einstellungen · `1k` Theme-Editor · `1l` Module · `1m` Änderungsprotokoll · `1n` Dokumente · `1o` Backup · `1p` Profil · `1q` Entscheidungen · `2a` Sidebar eingeklappt · `2b` Tablet 1024 px · `2c` Befehlspalette · `2d` Fehlerseiten · `2e` Ladezustände · `2f` Passwort-Wege.

## Open questions

1. **`--row-h`:** vereinsweite Einstellung oder pro Nutzer im Browser gemerkt (wie der Sidebar-Zustand)? Das Design nutzt 44 px als Default und 36/56 px als Varianten.
2. **Startpasswort-Format:** Der Prototyp zeigt eine sprechbare Wortkette (`wiese-kanu-73-lampe`), weil das Passwort mündlich weitergegeben wird. Wenn die Passwortregeln etwas anderes verlangen, muss das Format angeglichen werden.
3. **Befehlspalette:** Umfang in Stufe 1 ist Navigation, Einstellungsfelder und vorhandene Aktionen. Ob Nutzer- und Rollennamen bereits durchsuchbar sein sollen, ist nicht festgelegt.
