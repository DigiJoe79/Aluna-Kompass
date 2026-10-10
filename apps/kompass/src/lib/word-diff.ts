/**
 * Wortunterschied für Langtexte der Gegenüberstellung (Board Vorschläge 2a): was gleich bleibt, was wegfällt, was
 * dazukommt — je Wort, Leerraum zählt zum Wort davor. Über eine LCS der Wörter; ab 250 000 Zellen (zwei Texte
 * mit je 500 Wörtern) ersetzt der Vorschlag den Text als Ganzes, statt den Rechner zu beschäftigen.
 */
export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string };
export type ExcerptPart = DiffPart | { kind: 'gap' };

const LIMIT = 250_000;
const tokens = (s: string): string[] => s.match(/\s+|[^\s]+/g) ?? [];
const blank = (s: string) => /^\s+$/.test(s);

function lcsOps(a: string[], b: string[]): DiffPart[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = Länge der LCS von a[i..] und b[j..]
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  }
  const ops: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) ops.push({ kind: 'removed', text: a[i++]! });
    else ops.push({ kind: 'added', text: b[j++]! });
  }
  while (i < n) ops.push({ kind: 'removed', text: a[i++]! });
  while (j < m) ops.push({ kind: 'added', text: b[j++]! });
  return ops;
}

/** Fasst Läufe von Änderungen zusammen (erst was wegfällt, dann was dazukommt) und gleiche Teile zu einem. */
function group(ops: readonly DiffPart[]): DiffPart[] {
  // Leerraum zwischen zwei Änderungen gehört zur Änderung: „noch unsicher“ ist eine Stelle, nicht zwei.
  const absorbed = ops.flatMap((op, i): DiffPart[] =>
    op.kind === 'same' && blank(op.text) && i > 0 && i < ops.length - 1 && ops[i - 1]!.kind !== 'same' && ops[i + 1]!.kind !== 'same'
      ? [{ kind: 'removed', text: op.text }, { kind: 'added', text: op.text }]
      : [op],
  );
  const out: DiffPart[] = [];
  let removed = '';
  let added = '';
  const flush = () => {
    if (removed) out.push({ kind: 'removed', text: removed });
    if (added) out.push({ kind: 'added', text: added });
    removed = '';
    added = '';
  };
  for (const op of absorbed) {
    if (op.kind === 'removed') removed += op.text;
    else if (op.kind === 'added') added += op.text;
    else {
      flush();
      const last = out.at(-1);
      if (last?.kind === 'same') last.text += op.text;
      else out.push({ ...op });
    }
  }
  flush();
  return out;
}

export function wordDiff(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ kind: 'same', text: before }] : [];
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > LIMIT) return [...(before ? [{ kind: 'removed' as const, text: before }] : []), ...(after ? [{ kind: 'added' as const, text: after }] : [])];
  return group(lcsOps(a, b));
}

/** Zahl der Stellen: Läufe aufeinanderfolgender Änderungen. */
export const changedPlaces = (parts: readonly DiffPart[]): number => parts.filter((p, i) => p.kind !== 'same' && (i === 0 || parts[i - 1]!.kind === 'same')).length;

/** Die ersten bzw. letzten `count` Wörter samt Leerraum. */
function words(text: string, count: number, from: 'start' | 'end'): { text: string; cut: boolean } {
  const tk = tokens(text);
  const wordIdx = tk.flatMap((t, i) => (blank(t) ? [] : [i]));
  if (wordIdx.length <= count) return { text, cut: false };
  if (from === 'start') return { text: tk.slice(0, wordIdx[count - 1]! + 1).join('') + (blank(tk[wordIdx[count - 1]! + 1] ?? '') ? tk[wordIdx[count - 1]! + 1]! : ''), cut: true };
  const startIdx = wordIdx[wordIdx.length - count]!;
  const lead = startIdx > 0 && blank(tk[startIdx - 1]!) ? tk[startIdx - 1]! : '';
  return { text: lead + tk.slice(startIdx).join(''), cut: true };
}

/** Kürzt lange unveränderte Strecken auf `context` Wörter um die Stellen, dazwischen eine Lücke („…“). */
export function diffExcerpt(parts: readonly DiffPart[], context = 8): ExcerptPart[] {
  const out: ExcerptPart[] = [];
  parts.forEach((p, i) => {
    if (p.kind !== 'same') {
      out.push(p);
      return;
    }
    const first = i === 0;
    const last = i === parts.length - 1;
    if (first && last) {
      out.push(p);
    } else if (first) {
      const tail = words(p.text, context, 'end');
      if (tail.cut) out.push({ kind: 'gap' });
      out.push({ kind: 'same', text: tail.text });
    } else if (last) {
      const head = words(p.text, context, 'start');
      out.push({ kind: 'same', text: head.text });
      if (head.cut) out.push({ kind: 'gap' });
    } else {
      const count = tokens(p.text).filter((t) => !blank(t)).length;
      if (count <= 2 * context) out.push(p);
      else out.push({ kind: 'same', text: words(p.text, context, 'start').text }, { kind: 'gap' }, { kind: 'same', text: words(p.text, context, 'end').text });
    }
  });
  return out;
}
