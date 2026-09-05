// Basis-Layout für alle Kompass-Dokumente. Alle Vereinsdaten und Farben kommen aus /data.json.
#let org(p, key) = p.organization.at("organization." + key, default: "")

#let kompass-document(p, letterhead: true, body) = {
  let b = p.brand
  set document(title: p.data.at("title", default: ""), author: org(p, "name"), date: none)
  set text(font: b.fontBody, size: 10.5pt, fill: rgb(b.ink), lang: "de")
  set par(justify: false, leading: 0.65em)
  show heading: set text(font: b.fontHeading, fill: rgb(b.primary), weight: "semibold")
  show heading.where(level: 1): set text(size: 18pt)
  show raw: set text(font: b.fontMono, size: 9.5pt)

  let footer = context [
    #set text(size: 8pt, fill: rgb(b.muted))
    #line(length: 100%, stroke: 0.5pt + rgb(b.line))
    #v(2pt)
    #grid(columns: (1fr, auto),
      [#org(p, "name") · #org(p, "street") · #org(p, "postalCode") #org(p, "city") #if org(p, "registerNumber") != "" [· #org(p, "registerCourt") #org(p, "registerNumber")]],
      [#p.number · Seite #counter(page).display() von #counter(page).final().first()])
  ]

  let head-compact = [
    #set text(size: 8pt, fill: rgb(b.muted))
    #grid(columns: (1fr, auto), [#org(p, "name")], [#p.number])
    #line(length: 100%, stroke: 0.5pt + rgb(b.accent))
  ]

  set page(paper: "a4", margin: (top: 28mm, bottom: 24mm, left: 22mm, right: 20mm), footer: footer,
    header: if letterhead { context { if counter(page).get().first() > 1 { head-compact } } } else { head-compact })

  if letterhead {
    grid(columns: (1fr, auto), align: (left + top, right + top),
      [#text(size: 8pt, fill: rgb(b.muted))[#org(p, "name") · #org(p, "street") · #org(p, "postalCode") #org(p, "city")]],
      [#if p.logoFile != none { image(p.logoFile, height: 16mm) } else { text(font: b.fontHeading, size: 16pt, fill: rgb(b.primary))[#org(p, "name")] }])
    v(14mm)
    grid(columns: (1fr, auto), [], [#text(size: 9.5pt)[#org(p, "city"), #p.issuedDate]])
    v(6mm)
  }
  body
}
