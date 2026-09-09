// Generische Basis ohne Briefkopf: Bericht, Bescheinigung, Auszug.
// Selbstständig — kein Import. Alle Farben/Schriften aus payload.brand.*
// (aktives Theme). Kein Vereinsspezifikum.

#let base(payload, slots, body) = {
  let b = payload.brand
  let org(k) = payload.organization.at("organization." + k, default: "")

  set document(title: slots.at("title", default: ""), author: org("name"), date: none)
  set text(font: b.fontBody, size: 10.5pt, fill: rgb(b.ink), lang: "de")
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
    inset: (x: 8pt, y: 6pt),
    stroke: (_, y) => (bottom: 0.5pt + rgb(b.line)),
    fill: (_, y) => if y == 0 { rgb(b.primary) } else { none },
  )

  set page(
    paper: "a4",
    margin: (top: 26mm, bottom: 24mm, left: 22mm, right: 20mm),
    header: context [
      #set text(size: 8pt, fill: rgb(b.muted))
      #grid(columns: (1fr, auto), [#org("name")], [#payload.number])
      #line(length: 100%, stroke: 0.5pt + rgb(b.line))
    ],
    footer: context [
      #set text(size: 8pt, fill: rgb(b.muted))
      #line(length: 100%, stroke: 0.5pt + rgb(b.line))
      #v(2pt)
      #grid(
        columns: (1fr, auto),
        [#org("name")#if org("street") != "" [ · #org("street")]#if org("city") != "" [ · #org("postalCode") #org("city")]],
        [Seite #counter(page).display() von #counter(page).final().first()],
      )
    ],
  )

  if slots.at("title", default: "") != "" {
    text(font: b.fontHeading, size: 20pt, weight: "bold", fill: rgb(b.primary))[#slots.title]
    if slots.at("subtitle", default: "") != "" {
      linebreak()
      text(size: 12pt, style: "italic", fill: rgb(b.muted))[#slots.subtitle]
    }
    v(3pt)
    line(length: 100%, stroke: 0.8pt + rgb(b.accent))
    v(6mm)
  }

  body
}
