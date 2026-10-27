// Generische Basis ohne Briefkopf, schlanke Fassung: Auszüge, Listen und
// Arbeitspapiere, bei denen die Breite dem Inhalt gehört. Wie `a4-plain.typ`
// (dieselben Stile, derselbe Vertrag), aber mit schmalen Rändern und einem
// kleinen Titel ohne Schmuckabstand. Der Auszug des Änderungsprotokolls
// erscheint auf ihr.
//
// Ausgabestufen (Slots, alle optional — fehlt einer, zeichnet die Basis nichts;
// derselbe Vertrag wie `a4-quer-plain-slim`, auch bei `preliminary` — kein
// Schrägstempel mehr, nur die Marke in der Kopfzeile, Designer Runde 7, 268):
//   `stage`      "preliminary" | "review" | "final"; das Produkt leitet sie aus
//                dem Zustand des Jahres ab.
//   `stageText`  der Text dazu, vom Produkt. Die Basis kennt keinen Inhalt.
//     preliminary → Hinweiszeile mit `stageText` oben rechts in der Kopfzeile
//                   jeder Seite, wie im Querformat.
//     review      → Hinweiszeile in der Kopfzeile jeder Seite, damit auch ein
//                   einzelnes Blatt als Prüffassung kenntlich ist; nicht
//                   noch einmal unter dem Titel (Designer Runde 6).
//     final       → mit `stageText` Hinweiszeile in der Kopfzeile wie im
//                   Querformat (etwa „Ohne schriftlichen Prüfbericht
//                   festgeschrieben“), ohne nichts.
//   `footerNote` Vermerk klein vor der Seitenzahl; fehlt er, bleibt der Fuß wie
//                er war.
// Alle drei stehen als `slots` in `bases.json` („diese Basis zeichnet sie“).
// Selbstständig — kein Import. Alle Farben/Schriften aus payload.brand.*
// (aktives Theme). Kein Vereinsspezifikum.

#let base(payload, slots, body) = {
  let b = payload.brand
  let org(k) = payload.organization.at("organization." + k, default: "")

  set document(title: slots.at("title", default: ""), author: org("name"), date: none)
  set text(font: b.fontBody, size: 10pt, fill: rgb(b.ink), lang: "de")
  set par(justify: false, leading: 0.62em, spacing: 1.05em)
  set list(indent: 0.4em, body-indent: 0.5em)
  set enum(indent: 0.4em, body-indent: 0.5em)

  show heading: set text(font: b.fontHeading, fill: rgb(b.primary), weight: "semibold")
  show heading: set block(above: 1.2em, below: 0.6em)
  show heading.where(level: 1): set text(size: 17pt)
  show heading.where(level: 2): set text(size: 13pt)
  show heading.where(level: 3): set text(size: 11.5pt)
  show raw: set text(font: b.fontMono, size: 9pt)
  show link: set text(fill: rgb(b.primary))
  show quote.where(block: true): it => block(
    width: 100%,
    inset: (x: 12pt, y: 9pt),
    fill: rgb(b.primarySoft),
    stroke: (left: 2pt + rgb(b.primary)),
    radius: 2pt,
  )[#set text(size: 9.5pt); #it.body]
  show table.cell.where(y: 0): set text(fill: white, weight: "bold")
  set table(
    inset: (x: 6pt, y: 5pt),
    stroke: (_, y) => (bottom: 0.5pt + rgb(b.line)),
    fill: (_, y) => if y == 0 { rgb(b.primary) } else { none },
  )

  // Slot `footerNote`: Vermerk des Produkts (Erzeugungszeit und Kurz-Hash eines Berichts), klein vor der Seitenzahl.
  let footer-note = slots.at("footerNote", default: "")
  let stage = slots.at("stage", default: "")
  let stage-text = slots.at("stageText", default: "")
  let review-note = stage == "review" and stage-text != ""
  let head-note = stage in ("preliminary", "final") and stage-text != ""
  let stage-line = text(weight: "semibold", tracking: 0.08em, fill: rgb(b.accent))[#upper(stage-text)]

  set page(
    paper: "a4",
    margin: (top: 20mm, bottom: 18mm, left: 15mm, right: 15mm),
    header: context [
      #set text(size: 8pt, fill: rgb(b.muted))
      // Akteneintrag: die Nummer. Ad-hoc-Auszug: kein Nummernkreis, deshalb das Ausgabedatum.
      // Hinweis der Stufe (final mit Text) als eigene Spalte rechts; review hängt ihn an den Namen.
      #grid(
        columns: if head-note { (1fr, auto, auto) } else { (1fr, auto) },
        column-gutter: 8mm,
        [#org("name")#if review-note [ · #stage-line]],
        ..if head-note { ([#text(size: 9pt)[#stage-line]],) },
        [#if payload.number != "" [#payload.number] else [#payload.issuedDate]],
      )
      #line(length: 100%, stroke: 0.5pt + rgb(b.line))
    ],
    footer: context [
      #set text(size: 8pt, fill: rgb(b.muted))
      #line(length: 100%, stroke: 0.5pt + rgb(b.line))
      #v(2pt)
      #grid(
        columns: (1fr, auto),
        [#org("name")#if org("street") != "" [ · #org("street")]#if org("city") != "" [ · #org("postalCode") #org("city")]],
        [#if footer-note != "" [#text(size: 7pt)[#footer-note]#h(1.2em)]Seite #counter(page).display() von #counter(page).final().first()],
      )
    ],
  )

  if slots.at("draft", default: false) [
    #place(
      center + horizon,
      dx: 0pt, dy: 0pt,
      rotate(-30deg, text(size: 96pt, fill: rgb(0, 0, 0, 12%), weight: "bold")[ENTWURF]),
    )
  ]

  if slots.at("title", default: "") != "" {
    text(font: b.fontHeading, size: 14pt, weight: "bold", fill: rgb(b.primary))[#slots.title]
    if slots.at("subtitle", default: "") != "" {
      linebreak()
      text(size: 10pt, style: "italic", fill: rgb(b.muted))[#slots.subtitle]
    }
    v(1pt)
    line(length: 100%, stroke: 0.8pt + rgb(b.accent))
    v(3mm)
  }

  body
}
