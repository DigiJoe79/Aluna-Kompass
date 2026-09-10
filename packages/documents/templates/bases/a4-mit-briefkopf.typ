// Generische Basis: Geschäftsbrief (DIN 5008 angelehnt, nicht erzwungen).
// Seite 1: Logo oben rechts, Absenderzeile, Anschriftenfeld (Fensterkuvert),
// Ort/Datum, Betreff. Ab Seite 2: Fortsetzungskopf. Fußzeile durchgehend.
// Selbstständig — kein Import. Farben/Schriften aus payload.brand.*.

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
  show heading.where(level: 1): set text(size: 15pt)
  show heading.where(level: 2): set text(size: 12.5pt)
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
    margin: (top: 45mm, bottom: 24mm, left: 25mm, right: 20mm),
    header: context {
      if counter(page).get().first() > 1 {
        set text(size: 8pt, fill: rgb(b.muted))
        grid(columns: (1fr, auto), [#org("name")], [Seite #counter(page).display()])
        line(length: 100%, stroke: 0.5pt + rgb(b.line))
      }
    },
    footer: context [
      #set text(size: 8pt, fill: rgb(b.muted))
      #line(length: 100%, stroke: 0.5pt + rgb(b.line))
      #v(2pt)
      #grid(
        columns: (1fr, auto),
        [#org("name")#if org("iban") != "" [ · IBAN #org("iban")]],
        [Seite #counter(page).display() von #counter(page).final().first()],
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

  // Seite-1-Kopf: hängt am oberen Seitenrand (Rand 45mm, dy verrechnet ihn).
  place(top + right, dy: -29mm)[
    #if payload.logoFile != none {
      image(payload.logoFile, height: 16mm)
    } else {
      text(font: b.fontHeading, size: 14pt, fill: rgb(b.primary))[#org("name")]
    }
  ]
  place(top + left, dy: -6mm)[
    #text(size: 7pt, fill: rgb(b.muted))[
      #org("name")#if org("street") != "" [ · #org("street")]#if org("city") != "" [ · #org("postalCode") #org("city")]
    ]
  ]

  // Anschriftenfeld für das Fensterkuvert.
  if slots.at("recipient", default: "") != "" {
    block(spacing: 0pt, above: 6mm)[#slots.recipient]
    v(14mm)
  } else {
    v(4mm)
  }

  grid(columns: (1fr, auto), [], [#text(size: 9.5pt)[#if org("city") != "" [#org("city"), ]#payload.issuedDate]])
  v(6mm)

  if slots.at("subject", default: "") != "" {
    text(weight: "bold")[#slots.subject]
    v(4mm)
  }

  body
}
