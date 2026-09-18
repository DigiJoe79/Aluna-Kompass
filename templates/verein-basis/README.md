# Verein Basis — das mitgelieferte Template

Ein schlichtes, vereinsunabhängiges Astro-Template. Kompass kopiert es beim
ersten Start nach `/data/site-template`; ein neuer Verein hat damit sofort eine
laufende Seite und zugleich eine Vorlage, an der er sieht, wie ein Template
aufgebaut ist.

## Was Kompass verwaltet

`kompass.template.ts` deklariert es:

- **Variablen** (eine Konfigurationsmaske): Claim, Startseitentext, Startbild,
  Hinweis zur Bankverbindung, Mitgliedsbeitrag, ein Projekt auf der Startseite
  (Verweis auf eine Sicht des Projektmoduls, `uses: ['projects']`).
- **Sammlungen** (eigene Listenpflege): Aktuelles (mit Slug und
  Veröffentlicht-Schalter), Team (sortierbar), Fragen und Antworten
  (sortierbar), Dokumente.

Die Variable `featuredProject` zeigt, dass ein Template Datensätze aus Kompass
verweisen kann (Referenzfelder, `reference`/`references` aus
`@kompass/site-template`): Die Auswahl ist gepflegt und geprüft, gerendert wird
sie erst, sobald dieses Template selbst Projekte auf der Startseite zeigt —
das ist heute noch nicht der Fall.

## Was im Template steht

Struktur, Routen, Layout, Farben und die festen Seitentexte (Über uns, Spenden,
Mitglied werden, Kontakt, Impressum, Datenschutz, Satzung) sind Astro-Code.
Wer sie ändern will, bearbeitet das Template — das ist kein von Kompass
verwalteter Inhalt.

- Vereinsname und Kontaktdaten: `src/lib/site.ts`
- Feste Seitentexte: `src/content/pages.ts`
- Seitenbaum und Navigation: `src/lib/routes.ts`
- Gestaltung: `src/styles/global.css` (die Custom Properties in `:root` zuerst)

## Lokal entwickeln

```bash
pnpm --filter verein-basis dev     # Vorschau gegen fixtures/example
pnpm --filter verein-basis test    # Build-Test
```

Kompass liefert den Inhalt als `content.json` und die Bildvarianten als
`images.json` in `SITE_CONTENT_DIR`; `fixtures/example/` bildet diese Form nach.

## Startinhalte (optional)

Ein Template kann ein Verzeichnis `seed/` mitbringen — `seed/content.json` in
der Form des Kompass-Exports (`variables`, `collections`, `assets`) und die
Dateien unter `seed/assets/`. Kompass zeigt dann unter Webseite → Template den
Knopf „Startinhalte“, der sie **einmalig** in eine leere Webseite übernimmt.
Dieses Basis-Template hat bewusst kein `seed/`: ein neuer Verein startet mit
leerer Webseite.

Die Seed-Dateien landen in der Mediathek in einem eigenen Ordner — „Webseite“,
oder was `seed/content.json` unter dem Schlüssel `folder` angibt.
