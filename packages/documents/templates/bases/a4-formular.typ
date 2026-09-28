// Generische Basis: Formular mit Vereinskopf (z. B. Bescheinigungen nach
// amtlichem Muster). Die Basis zeichnet den Kopf — Logo oder Vereinsname,
// darunter klein die Absenderzeile — und die Fußzeile mit Nummer und
// „Seite n von m“. Betreff, Titel, Ort und Datum zeichnet der Körper der
// Modul-Vorlage; ein Verein darf den Kopf überschreiben, nie den Körper.
// Selbstständig — kein Import. Farben/Schriften aus payload.brand.*.
//
// Optionale Anschriftzone (Fensterumschlag DIN lang), nur auf Seite 1 und nur,
// wenn die Vorlage `slots.recipient` liefert — sonst bleibt die Seite
// byte-gleich wie ohne Zone. Lage nach DIN 5008 Form B (Maße unten als
// Konstanten, gemessen von der oberen und linken Blattkante):
//   slots.recipient       Klartext, Zeilen mit \n; Anschriftzone ab 62,7 mm, Text 25 mm von links
//   slots.recipientLabel  Klartext, klein als Rücksendezeile unten in der Vermerkzone (45–62,7 mm)
//   slots.infoBlock       Typst-Markup (eval, mode: "markup"), Informationsblock ab 125 mm / 50 mm; leer erlaubt
// Die Zone hat eine feste Höhe: Der Körper beginnt immer 94 mm von oben,
// unter dem Anschriftfeld (Ende 90 mm).
// Wer diese Zone zeichnet, trägt im Manifest `bases.json` das Kennzeichen
// `"slots": ["recipient", "recipientLabel", "infoBlock"]`; ohne Kennzeichen
// setzt die Vorlage Anschrift und Aussteller selbst in den Körper.

// DIN 5008 Form B — Anschriftfeld 85 × 45 mm, 20 mm von links, 45 mm von oben.
#let din-field-left = 20mm
#let din-field-top = 45mm
#let din-field-width = 85mm
#let din-field-bottom = 90mm
// Zusatz- und Vermerkzone 17,7 mm (45–62,7 mm), darunter die Anschriftzone 27,3 mm.
#let din-note-zone-height = 17.7mm
#let din-address-top = 62.7mm
// Text im Feld 5 mm eingerückt (Satzkante 25 mm).
#let din-text-indent = 5mm
// Informationsblock rechts: 125 mm von links, 50 mm von oben, bis zum rechten Rand.
#let din-info-left = 125mm
#let din-info-top = 50mm
// Körperbeginn mit Zone: nicht vor 94 mm (Feldende 90 mm plus Luft).
#let body-top = 94mm

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

  let margin = (top: 32mm, bottom: 22mm, left: 22mm, right: 20mm)
  set page(
    paper: "a4",
    margin: margin,
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

  // Anschriftzone: `place` rechnet vom Satzspiegel; die Maße oben von der Blattkante.
  if slots.at("recipient", default: "") != "" {
    let label = slots.at("recipientLabel", default: "")
    let info = slots.at("infoBlock", default: "")
    let x = din-field-left + din-text-indent - margin.left
    let text-width = din-field-width - din-text-indent
    place(top + left, dx: x, dy: din-field-top - margin.top,
      block(width: text-width, height: din-note-zone-height)[
        #align(bottom)[#text(size: 7pt, fill: rgb(b.muted))[#label]]
      ])
    place(top + left, dx: x, dy: din-address-top - margin.top,
      block(width: text-width, height: din-field-bottom - din-address-top)[#set par(leading: 0.5em); #slots.recipient])
    if info != "" {
      place(top + left, dx: din-info-left - margin.left, dy: din-info-top - margin.top,
        block(width: 210mm - margin.right - din-info-left)[#set par(leading: 0.5em); #eval(info, mode: "markup")])
    }
    v(body-top - margin.top)
  }

  body
}
