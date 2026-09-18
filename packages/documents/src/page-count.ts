/**
 * Die Seitenzahl eines gerenderten PDF, ohne einen zweiten Lauf und ohne
 * fremdes Werkzeug: Typst schreibt sie zweimal in die Datei — als
 * `xmpTPg:NPages` in die Metadaten und als `/Count` in den Seitenbaum. Beides
 * steht im Klartext in den Bytes.
 *
 * Findet sich keins von beidem, kommt `null` zurück. Eine geratene Seitenzahl
 * wäre schlimmer als keine: „Seite 1 von 1“ über einem zweiseitigen Brief
 * bringt niemanden auf die Idee, weiterzublättern.
 */
export function pdfPageCount(bytes: Uint8Array): number | null {
  // `latin1` verändert keine Bytes und lässt die Marken lesbar, auch wenn
  // dazwischen komprimierte Ströme stehen.
  const text = Buffer.from(bytes).toString('latin1');

  const meta = /<xmpTPg:NPages>(\d+)<\/xmpTPg:NPages>/.exec(text);
  if (meta?.[1]) return Number.parseInt(meta[1], 10);

  // Der Seitenbaum darf Äste haben; die Wurzel trägt die grösste Zahl.
  let highest = 0;
  for (const match of text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)) {
    highest = Math.max(highest, Number.parseInt(match[1]!, 10));
  }
  for (const match of text.matchAll(/\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/g)) {
    highest = Math.max(highest, Number.parseInt(match[1]!, 10));
  }
  return highest > 0 ? highest : null;
}
