#import "base.typ": kompass-document
#let p = json("/data.json")
#show: kompass-document.with(p, letterhead: false)

= #p.data.title

#text(size: 9pt, fill: rgb(p.brand.muted))[
  Erstellt am #p.issuedDate · Dokument #p.number ·
  #for (k, v) in p.data.filters [#k: #v; ]
]
#v(4mm)

#table(
  columns: (auto, auto, auto, auto, 1fr),
  align: (left, left, left, left, left),
  stroke: (x, y) => if y == 0 { (bottom: 0.8pt + rgb(p.brand.primary)) } else { (bottom: 0.4pt + rgb(p.brand.line)) },
  inset: 5pt,
  table.header([*Zeitpunkt*], [*Nutzer*], [*Kanal*], [*Aktion*], [*Objekt / Zusammenfassung*]),
  ..p.data.entries.map(e => (
    text(font: p.brand.fontMono, size: 8pt)[#e.occurredAt],
    [#e.userName],
    [#e.channel],
    text(font: p.brand.fontMono, size: 8pt)[#e.action],
    [#e.entityType #if e.entityId != none [· #e.entityId] \ #text(size: 8.5pt, fill: rgb(p.brand.muted))[#e.summary]],
  )).flatten()
)
