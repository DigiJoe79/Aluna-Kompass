/**
 * Pfade zu mehrsprachigen Feldern: `summary`, `story.quote`, `faq[2].answer`.
 * Der Kern behandelt sie als undurchsichtige Schlüssel; Module lösen sie mit
 * diesen Helfern auf, wo Text in Bausteinen oder Listen steckt.
 */
export function splitPath(path: string): (string | number)[] {
  const out: (string | number)[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) out.push(m[2] !== undefined ? Number(m[2]) : m[1]!);
  return out;
}

export function readPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of splitPath(path)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

/** Kopiert entlang des Pfads und setzt den Wert; `undefined`, wenn der Pfad nicht existiert. */
export function writePath<T>(root: T, path: string, value: unknown): T | undefined {
  const segs = splitPath(path);
  const step = (node: unknown, i: number): unknown => {
    if (i === segs.length) return value;
    if (node === null || typeof node !== 'object') return undefined;
    const seg = segs[i]!;
    if (Array.isArray(node)) {
      if (typeof seg !== 'number' || seg >= node.length) return undefined;
      const child = step(node[seg], i + 1);
      if (child === undefined) return undefined;
      const copy = [...node];
      copy[seg] = child;
      return copy;
    }
    if (!(String(seg) in node)) return undefined;
    const child = step((node as Record<string, unknown>)[String(seg)], i + 1);
    if (child === undefined) return undefined;
    return { ...(node as Record<string, unknown>), [String(seg)]: child };
  };
  return step(root, 0) as T | undefined;
}
