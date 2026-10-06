/**
 * Die Seitenfunktion des Tierprofils in Typst (Spec 2026-10-05, § 7 und § 8).
 * Steht vor den Seiten im Körper. Farben und Schriften nur aus dem
 * Theme-Payload; einzige Ausnahme sind die schwarzen QR-Module.
 *
 * Eine Seite je Tier: Die rechte Spalte ist so hoch wie Foto samt
 * Vorschaureihe, der Kurztext schrumpft darin von 14 auf 11 pt und steht,
 * wenn er auch dann nicht passt, als Ganzes unter dem Foto. Der Langtext
 * füllt den Rest bis zum Fuß, schrumpft von 11 auf 9 pt und wird danach
 * nach ganzen Absätzen gekürzt, mit Hinweis (mit QR-Code) oder „…“.
 * Geprüft am Prototyp vom 2026-10-05; `print-render.test.ts` hält es fest.
 */
export const PROFILE_LIB = String.raw`
#let profile-brand = json("/data.json").brand

#let profile-chip(t) = box(
  inset: (x: 6pt, y: 3pt), radius: 8pt, stroke: 0.5pt + rgb(profile-brand.line),
  text(size: 8pt, t),
)

#let profile-cover(path, iw, ih, bw, bh, fx, fy, radius: 0pt) = {
  let wide = iw / ih > bw / bh
  let w = if wide { bh * (iw / ih) } else { bw }
  let h = if wide { bh } else { bw * (ih / iw) }
  box(width: bw, height: bh, clip: true, radius: radius,
    place(top + left, dx: -(w - bw) * fx / 100, dy: -(h - bh) * fy / 100,
      image(path, width: w, height: h)))
}

#let profile-qr(rows, size) = {
  let n = rows.len()
  let m = size / n
  box(width: size, height: size, {
    for (y, row) in rows.enumerate() {
      for (x, c) in row.clusters().enumerate() {
        if c == "1" { place(top + left, dx: x * m, dy: y * m, rect(width: m + 0.05pt, height: m + 0.05pt, fill: black, stroke: none)) }
      }
    }
  })
}

// Erste Größe aus sizes, bei der make(size) in width mal max-h passt; sonst none.
#let profile-fit(make, sizes, width, max-h) = {
  for s in sizes {
    if measure(block(width: width, make(s))).height <= max-h { return s }
  }
  none
}

#let profile-page(a) = layout(region => {
  let W = region.width
  let H = region.height
  let gap = 6mm
  let left-w = if a.photo == none { 0pt } else { W * 0.45 }
  let photo-h = if a.photo == none { 0pt } else { left-w * a.aspect.at(1) / a.aspect.at(0) }
  let tgap = 2.5mm
  let thumb = (left-w - 2 * tgap) / 3
  let left-h = photo-h + if a.thumbs.len() > 0 { tgap + thumb } else { 0pt }
  let right-w = if a.photo == none { W } else { W - left-w - gap }

  let head = {
    text(font: profile-brand.fontHeading, size: 26pt, weight: "bold", fill: rgb(profile-brand.primary), a.name)
    v(3mm)
    set par(leading: 0.9em)
    (a.facts + a.traits).map(profile-chip).join(h(4pt))
  }
  let summary(s) = { set text(font: profile-brand.fontHeading, size: s * 1pt); set par(leading: 0.55em); a.summary }
  let head-h = measure(block(width: right-w, head)).height
  let summary-sizes = range(28, 21, step: -1).map(x => x / 2)
  let s-size = if a.photo == none { 14 } else { profile-fit(summary, summary-sizes, right-w, left-h - head-h - 4mm) }
  let summary-below = s-size == none

  let footer-h = if a.qr == none { 0pt } else { 24mm }
  let top-h = if a.photo == none { head-h + 4mm + measure(block(width: right-w, summary(14))).height } else { left-h }
  let body-h = H - top-h - gap - footer-h

  let paras(list, s, tail) = {
    set text(size: s * 1pt)
    set par(justify: false, leading: 0.6em, spacing: 0.9em)
    if summary-below { summary(11); parbreak() }
    for p in list { p; parbreak() }
    if tail != none { text(style: "italic", fill: rgb(profile-brand.muted), tail) }
  }
  let body-sizes = range(22, 17, step: -1).map(x => x / 2)
  let b-size = profile-fit(s => paras(a.paragraphs, s, none), body-sizes, W, body-h)
  let kept = a.paragraphs
  let tail = none
  if b-size == none {
    b-size = 9
    tail = if a.qr == none { […] } else { a.continued }
    let k = a.paragraphs.len()
    while k > 0 and measure(block(width: W, paras(a.paragraphs.slice(0, k), 9, tail))).height > body-h { k -= 1 }
    kept = a.paragraphs.slice(0, k)
  }

  block(width: W, height: H, {
    grid(columns: if a.photo == none { (W,) } else { (left-w, right-w) }, column-gutter: gap,
      ..if a.photo != none {
        ({
          profile-cover(a.photo.path, a.photo.w, a.photo.h, left-w, photo-h, a.focus.at(0), a.focus.at(1), radius: 3pt)
          if a.thumbs.len() > 0 {
            v(tgap, weak: false)
            stack(dir: ltr, spacing: tgap, ..a.thumbs.map(t => profile-cover(t.path, t.w, t.h, thumb, thumb, 50, 50, radius: 2pt)))
          }
        },)
      },
      { head; v(4mm); if not summary-below { summary(s-size) } },
    )
    v(gap)
    block(width: W, height: body-h, clip: true, paras(kept, b-size, tail))
    if a.qr != none {
      place(bottom + left, grid(columns: (20mm, 1fr), column-gutter: 4mm, align: horizon,
        profile-qr(a.qr, 20mm),
        text(size: 9pt)[#a.more #linebreak() #text(fill: rgb(profile-brand.primary), a.url)]))
    }
  })
})
`;
