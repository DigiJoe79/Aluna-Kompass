# Aluna Kompass — Stufe 2 „Webseite" (Design)

Status: freigegeben im Brainstorming, zur Umsetzung
Datum: 2026-09-05
Voraussetzung: Stufe 1 „Fundament" (`2026-09-05-fundament-design.md`) ist umgesetzt und validiert.

## 1. Ziel, Zuschnitt, Nicht-Ziele

**Ziel.** WordPress ist abgelöst. Die Webseite von Aluna Tierhilfe e.V. wird vollständig in Kompass gepflegt, in Deutsch und Englisch, und als statischer Build aus dem Container auf dem NAS zu IONOS publiziert — aus der Testumgebung nach Staging, aus Prod auf die Live-Domain. Im Internet existiert weder Datenbank noch Login noch Cookie.

**Drei Bausteine:**

1. **Webseiten-Modul `website`** in Kompass, generisch: Site-Fakten als Einstellungen, Seiten mit Markdown, Team, FAQ, Artikel, Projekte (öffentliche Felder), Downloads, Startseiten-Auswahl, Vorschau, Publish mit Änderungsliste und Sperrwortprüfung.
2. **Tiermodul `animals`** in der Minimalstufe: Hundeprofil mit Fotos, Status, Notfall, Patentier, externem Profil-Link, Erfolgsgeschichte. Liefert die veröffentlichte Sicht für die Hundeseiten. Bestandsbuch, Verträge, Patenschaftsverwaltung folgen in Stufe 4.
3. **`apps/site`**, Alunas Astro-Seite, portiert aus dem Prototyp `Aluna Tierhilfe e.V./Webseite/aluna-static` mit allen Seiten und dem bestehenden Design. Liest ausschließlich veröffentlichte Sichten. Dazu `packages/markdown` als gemeinsamer Renderer für Vorschau und Build.

**Entscheidungen aus dem Brainstorming (2026-09-05):**

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | Inhalte (Texte, Listen, Fakten) werden in Kompass gepflegt; Seitenstruktur, Design, Navigation und Mechanik bleiben im Repo (`apps/site`). | Nur Listen in Kompass; komplettes CMS mit Seitenbaum |
| 2 | `apps/site` ist ausdrücklich Alunas Seite und darf Aluna-spezifisch sein; der Vertrag zu Kompass sind die veröffentlichten Sichten. Das Webseiten-Modul selbst bleibt generisch. Das Modul wird vorerst nicht als eigenständiges Produkt veröffentlicht. | Generischer Seitengenerator mit neutralen Templates; austauschbare Site-Themes als Pakete |
| 3 | Fließtexte als Markdown mit drei Konventionen (siehe Abschnitt 3), gerendert von einem gemeinsamen Paket für Vorschau und Build. | Rich-Text-Editor; HTML in Feldern |
| 4 | Zweisprachig DE/EN ab dem ersten Publish; jedes Textfeld ist ein DE/EN-Paar. | Erst Deutsch mit vorbereitetem Modell |
| 5 | Test publiziert nach Staging bei IONOS, Prod auf die Live-Domain; Ziel je Container aus Umgebungsvariablen. | Nur Vorschau in Kompass |
| 6 | Publish nur manuell nach Bestätigung mit Anzeige des Diffs; kein Entwurfsstand, Vorschau = echter Build. | Draft/Freigabe-Workflow; automatischer Publish |

**Unverändert aus dem Prototyp:** keine Formulare, Mailto-Links mit vorbelegtem Betreff, ausfüllbare PDFs zum Download, Betterplace nur per 2-Klick, kein Newsletter, keine Cookies, kein Analytics, Fonts selbst gehostet.

**Nicht-Ziele:** Bestandsbuch/Verträge/Patenschaften im Tiermodul; Finanzdaten an Projekten; Kontaktformulare oder Newsletter; Publish ohne Bestätigung; Entwurfsstände; zweite Site oder Theme-System; Suchfunktion; Bild-Editor.

## 2. Inhaltsmodell

**Sprachtyp.** Jedes übersetzbare Feld ist ein `LocalizedText = { de: string; en: string }`, gespeichert als JSON. Slugs sind sprachneutral; die Pfadpräfixe übersetzt das Template (`/zuhause-gesucht/chiara/` ↔ `/en/looking-for-a-home/chiara/`).

**Webseiten-Modul, Tabellen mit Präfix `website_`:**

- `website_pages` — feste Seitenschlüssel, die die Site deklariert (`home`, `help`, `donate`, `sponsor`, `membership`, `about`, `partners`, `contact`, `imprint`, `privacy`, `statutes`, `adoption-process`); Kompass zeigt genau diese Seiten, kein Anlegen/Löschen. Felder: `key`, `title` (L, mit Betonungskonvention), `lede` (L), `body` (L, Markdown), `metaDescription` (L), `blocks` (JSON-Liste: `{ id, title(L), text(L), imageAssetId, href, label(L) }`), `updatedAt`.
- `website_articles` — `id, slug, title(L), lede(L), body(L), publishedAt, sortOrder, isPublished`.
- `website_team` — `id, name, position(L), photoAssetId, petPhotoAssetId, sortOrder, isPublished`.
- `website_faqs` — `id, category(L), question(L), answer(L), sortOrder, isPublished`.
- `website_downloads` — feste Schlüssel (`sponsorship-form`, `membership-form`, `self-disclosure-form`, `statutes-pdf`), `title(L)`, `assetId` (PDF aus dem Medienspeicher).
- `website_publishes` — `id, environment, startedAt, finishedAt, status (success|failed|aborted), contentHash, pagesChanged, pagesAdded, pagesRemoved, summary, triggeredByUserId, log`.

**Kern-Tabelle `projects`** (geteilt mit Stufe 3): `id, slug, name(L), type (ongoing|shortTerm), status (active|completed), summary(L), body(L, Markdown), imageAssetId, betterplaceProjectId, isPublished, sortOrder, createdAt, updatedAt`. Finanzen ergänzt später Spalten per Migration.

**Site-Fakten als Einstellungen `website.*`:** `claim(L)`, `forwardingPercent`, `shelterDogCount`, `donationBoxLocations[]`, `section11Status (pending|granted)`, `section11Date`, `socialLinks[{label, href}]`, `betterplaceMetaProjectId`, `betterplaceDefaultAmount`, `blockedTerms[]` (Sperrwortliste, als Daten — der Hilfetext nennt den Zweck, nie den Namen), `featuredAnimalSlug (auto|slug)`, `featuredStorySlug (auto|slug)`. Bankverbindung, Anschrift, Registerdaten kommen aus `organization.*`. Die öffentliche Basisadresse kommt aus der Umgebung (`SITE_PUBLIC_URL`), nicht aus den Einstellungen.

**Tiermodul, Tabelle `animals`:** `id, slug, name, species (Default 'dog'), sex, birthText(L), sizeCm, sizeText(L), location (shelter|germany), status (lookingForHome|reserved|adopted), isEmergency, isSponsorable, traits(L[]), externalProfileUrl, summary(L), body(L, Markdown), isPublished, createdAt, updatedAt`; Fotos in `animal_photos` (`animalId, assetId, sortOrder, isPrimary`); Erfolgsgeschichte in `animal_stories` (`animalId, beforeAssetId, afterAssetId, quote(L), family, adoptedYear`), aktiv nur bei Status `adopted`.

**Veröffentlichte Sichten:** `publishedSiteFacts`, `publishedPages`, `publishedArticles`, `publishedTeam`, `publishedFaqs`, `publishedProjects`, `publishedDownloads` (Webseiten-Modul) und `publishedAnimals` (Tiermodul). Sie liefern nur veröffentlichte Datensätze und nur deklarierte Felder; Fotos als Asset-Verweis, die Site skaliert beim Build.

**Sprachregel:** Fehlt `en`, liefert die Sicht `de` mit Markierung `fallback: ['en']`; der Publish listet die Lücken; die englische Seite wird gebaut. Fehlen beide Sprachen bei einem Pflichtfeld, ist der Datensatz unvollständig und wird nicht gebaut; der Publish meldet ihn.

**Modulregeln:** Tabellen aller installierten Module existieren immer (eine lineare Migrationskette im Kern, drizzle-kit liest Kern- und Modul-Schemas zusammen); der Modulschalter steuert nur Navigation, Routen, Tools, Sichten. Fremdschlüssel nur in Richtung Kern, nie zwischen optionalen Modulen; die Site verbindet Hunde und Seiten über die Sichten.

## 3. Architektur

**Pakete:**
```
packages/modules/website/   Manifest, Schema, Services, Sichten, Settings, Export/Prüfung/Build/Diff/Publish
packages/modules/animals/   Manifest, Schema, Services, Sicht publishedAnimals
packages/markdown/          remark-Renderer mit drei Konventionen, sanitisiertes HTML
apps/site/                  Astro-Seite von Aluna (Prototyp portiert)
apps/kompass/src/modules.ts installierte Module → createDeps
```

**Rechte:** `website.view`, `website.manage`, `website.publish`, `animals.view`, `animals.manage`.

**Build-Pipeline (Service im Webseiten-Modul, läuft im Container):**
1. **Export** — alle Sichten nach `content.json` plus referenzierte Originalbilder in ein Job-Verzeichnis. Die Site hat nie Datenbankzugriff.
2. **Prüfung** — Sperrwortliste gegen alle Texte und Dateinamen (Treffer ⇒ Abbruch), Pflichtfelder, Übersetzungslücken (gelistet).
3. **Build** — `astro build` in `apps/site` mit Job-Verzeichnis und `SITE_PUBLIC_URL`; Bilder skaliert und WebP; Staging mit `noindex`. Kindprozess mit Zeitlimit und Protokollauszug; skalierte Bilder werden zwischen Builds gecacht.
4. **Diff** — Content-Hash und Hash je Datei gegen den letzten erfolgreichen Publish dieser Umgebung ⇒ geändert/neu/entfallen.
5. **Publish** — rsync über SSH auf das Ziel der Umgebung, nur nach Bestätigung; Eintrag in `website_publishes` und im Änderungsprotokoll.

Vorschau = Schritte 1–3; Kompass liefert den Build unter `/website/preview/` mit Umgebungsbalken aus.

**Publish-Ziel aus der Umgebung:** `SITE_PUBLIC_URL`, `SITE_DEPLOY_HOST`, `SITE_DEPLOY_USER`, `SITE_DEPLOY_PATH`, `SITE_DEPLOY_KEY_FILE`. Fehlt eine Variable ⇒ kein Publish-Knopf, nur Vorschau. Der Schlüssel liegt als Datei im Volume, nie in der Datenbank oder im Backup.

**Markdown-Paket:** remark + remark-directive; Konventionen: (1) kursiv in Überschriften ⇒ Betonung (`em`), (2) Zitatblock ⇒ Hinweiskasten, (3) `:::karten` mit `###`-Karten ⇒ Kartenraster. Ausgabe sanitisiert; rohes HTML wird entfernt. Dieselbe Funktion rendert Vorschau (Kompass) und Seiten (Astro).

**MCP-Tools:** Hunde/Seiten/Artikel lesen und schreiben, Vorschau-Build starten, Diff abfragen. Kein Tool für den Publish nach Prod.

## 4. Oberfläche in Kompass

Navigationsgruppen **Webseite** (Seiten, Artikel, Team, FAQ, Projekte, Downloads, Site-Fakten, Publizieren) und **Tiere** (Hunde), aus den Manifesten.

- **Zweisprachige Felder:** DE links, EN rechts, gleiche Höhe; Markdown-Felder mit gerenderter Vorschau (DE/EN umschaltbar); fehlendes EN als Hinweis „unübersetzt"; Zähler offener Übersetzungen je Datensatz.
- **Seiten:** feste Liste; Formular mit Titel, Einleitung, Markdown, Meta-Beschreibung, sortierbare Bausteine; Speicherleiste; „Vorschau" springt in den letzten Vorschau-Build.
- **Artikel, Team, FAQ, Downloads, Projekte:** Listen mit Anlegen, Bearbeiten, Reihenfolge, Schalter „veröffentlicht". Kein Löschen; unveröffentlicht = weg von der Seite. Projekte zeigen nur öffentliche Felder; Reiter-Struktur für Finanzen vorbereitet.
- **Site-Fakten:** Gruppen Auftritt, Zahlen, Spendenboxen, § 11, Betterplace, Startseiten-Auswahl (Automatik oder Dropdown), Sperrwortliste.
- **Hunde:** Liste mit Foto, Name, Status-Badge, Notfall/Patentier, Aufenthalt, Statusfilter. Formular mit Reitern Steckbrief, Texte, Fotos (Upload, Sortierung, Hauptfoto), Geschichte (aktiv ab Status „vermittelt"; Statuswechsel fragt Vermittlungsjahr ab).
- **Publizieren:** Stand (letzter Publish, Ziel), Karten „Vorschau bauen" (Ladezustand), Prüfliste (Lücken/Unvollständiges mit Links), „Änderungen gegenüber Live", Publish-Knopf („Nach Staging publizieren" / „Live publizieren" mit Bestätigung); Sperrworttreffer als Fehlerkarte mit Fundstelle, Knopf deaktiviert; Historie.
- **Kompass-Startseite:** vierte Karte „Webseite" (letzter Publish, offene Übersetzungen, unveröffentlichte Änderungen).

## 5. Portierung, Datenübernahme, Tests, Betrieb

**Portierung:** Astro aktuell; Layout, Komponenten, `global.css` übernommen; Seiten auf `content.json` umgestellt; `/en/` als vollständiger zweiter Baum mit übersetzten Präfixen, `hreflang`, Sitemap, `robots.txt` je Umgebung; Inline-Styles in Klassen; nur Hunde-Filter und 2-Klick als Skripte; Formular-PDFs aus den Downloads; Weiterleitungstabelle für alte WordPress-URLs als Datei im Repo.

**Einmalige Datenübernahme:** Import-Skript liest `aluna-static/src/data/*.js` und die Seitentexte aus den Astro-Dateien, legt Hunde, Projekte, Team, FAQ, Artikel, Seiten und Site-Fakten in Kompass an (EN leer ⇒ Lücken), mit Sperrwortprüfung. Läuft gegen Test; per Backup-Export nach Prod. Danach ist Kompass die Quelle.

**Tests:**
- Module: Sichten liefern nur veröffentlichte/deklarierte Felder; Sprachfallback mit Markierung; Sperrwortprüfung inkl. Dateinamen; Diff; Publish-Historie; Statuswechsel Hund.
- Markdown: drei Konventionen; Sanitizing gegen HTML/Skripte; identische Ausgabe Vorschau/Build.
- Site-Build: zweimal bauen aus festem Beispiel-Export ⇒ gleiche Hashes; jede Seite in DE und EN; `hreflang`; Staging trägt `noindex`.
- Playwright: Hund mit Foto anlegen → Vorschau bauen → Hund in der Vorschau; Übersetzungslücke gelistet; Sperrwort blockiert Publish. rsync im Test durch lokales Zielverzeichnis ersetzt.

**Betrieb:** Docker-Image um Astro, Site und Bild-Werkzeug erweitert; Publish-Variablen je Container in der Env-Datei; SSH-Schlüssel als Datei im Volume (nur Container-Nutzer); bei IONOS Staging-Verzeichnis mit Subdomain und Live-Verzeichnis, Schlüssel hinterlegt; Kapitel in `docs/betrieb.md`. Beim Wechsel wird das WordPress-Verzeichnis umbenannt, nicht gelöscht, und die Domain auf das neue Verzeichnis gelegt.

## 6. Offene Punkte (bewusst nicht hier entschieden)

- Vollstufe Tiermodul (Bestandsbuch, § 11-Nachweise, Verträge, Patenschaften mit Spendenbezug): Stufe 4.
- Finanzfelder an Projekten und Betterplace-Abrechnung: Stufe 3.
- Ob Übersetzungen später maschinell vorgeschlagen werden: nicht Teil dieser Stufe.
