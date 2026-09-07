# Verein Basis — das mitgelieferte Template

Ein schlichtes, vereinsunabhängiges Astro-Template. Kompass kopiert es beim
ersten Start nach `/data/site-template`; ein neuer Verein hat damit sofort eine
laufende Seite und zugleich eine Vorlage, an der er sieht, wie ein Template
aufgebaut ist.

## Was Kompass verwaltet

`kompass.template.ts` deklariert es:

- **Variablen** (eine Konfigurationsmaske): Claim, Startseitentext, Startbild,
  Hinweis zur Bankverbindung, Mitgliedsbeitrag.
- **Sammlungen** (eigene Listenpflege): Aktuelles (mit Slug und
  Veröffentlicht-Schalter), Team (sortierbar), Fragen und Antworten
  (sortierbar), Dokumente.

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
