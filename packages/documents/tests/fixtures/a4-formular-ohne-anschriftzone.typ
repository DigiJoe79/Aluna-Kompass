// Generische Basis: Formular mit Vereinskopf (z. B. Bescheinigungen nach
// amtlichem Muster). Die Basis zeichnet NUR den Kopf — Logo oder Vereinsname,
// darunter klein die Absenderzeile — und die Fußzeile mit Nummer und
// „Seite n von m“. Anschrift, Betreff, Titel, Ort und Datum zeichnet der
// Körper der Modul-Vorlage; ein Verein darf den Kopf überschreiben, nie den
// Körper. Selbstständig — kein Import. Farben/Schriften aus payload.brand.*.

#let base(payload, slots, body) = {
  let b = payload.brand
  let org(k) = payload.organization.at("organization." + k, default: "")

  set document(title: slots.at("title", default: ""), author: org("name"), date: none)
  set text(font: b.fontBody, size: 10pt, fill: rgb(b.ink), lang: "de")
  set par(justify: false, leading: 0.58em, spacing: 0.9em)
  set list(indent: 0.4em, body-indent: 0.5em)
  set enum(indent: 0.4em, body-indent: 0.5em)

  show heading: set text(font: b.fontHeading, fill: rgb(b.ink), weight: "semibold")
  show heading: set block(above: 1em, below: 0.5em)
  show heading.where(level: 1): set text(size: 13pt)
  show heading.where(level: 2): set text(size: 11pt)
  show raw: set text(font: b.fontMono, size: 9pt)
  show link: set text(fill: rgb(b.primary))

  set page(
    paper: "a4",
    margin: (top: 32mm, bottom: 22mm, left: 22mm, right: 20mm),
    header: context [
      #grid(
        columns: (1fr, auto),
        align: (left + bottom, right + bottom),
        [
          #text(font: b.fontHeading, size: 12pt, fill: rgb(b.primary), weight: "semibold")[#org("name")]
          #linebreak()
          #text(size: 7pt, fill: rgb(b.muted))[#org("name")#if org("street") != "" [ · #org("street")]#if org("city") != "" [ · #org("postalCode") #org("city")]]
        ],
        [#if payload.logoFile != none { image(payload.logoFile, height: 13mm) }],
      )
      #v(-2pt)
      #line(length: 100%, stroke: 0.5pt + rgb(b.line))
    ],
    footer: context [
      #set text(size: 8pt, fill: rgb(b.muted))
      #line(length: 100%, stroke: 0.5pt + rgb(b.line))
      #v(2pt)
      #grid(
        columns: (1fr, auto),
        [#if payload.number != "" [#payload.number]],
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

  body
}
