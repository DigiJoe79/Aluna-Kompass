/**
 * Das Modell hinter dem Ordnerbaum: aus flachen Pfaden eine Knotentabelle, die
 * der Baum (Headless Tree) über seinen Datenlader liest. Rein und ohne React,
 * damit Akte und Mediathek dieselben Regeln teilen und die Tests sie ohne
 * Browser prüfen.
 */

/** Die Wurzel des Baums. Nicht `''`: Headless Tree prüft Eltern auf „falsy“ und stürzt dann in der Tastatur-Ablage ab (Spike). */
export const TREE_ROOT = '/';

/** Ein Ordner, wie ihn der Dienst liefert. `count` zählt nur, was direkt darin liegt. */
export type FolderEntry = { path: string; count: number };

export type FolderNode = {
  path: string;
  /** Das letzte Segment — die Beschriftung im Baum. */
  name: string;
  parent: string;
  /** Kinderpfade, nach Name sortiert. */
  children: string[];
  /** Was direkt in diesem Ordner liegt. */
  direct: number;
  /** Was im ganzen Teilbaum liegt. */
  total: number;
  /** 0 = direkt unter der Wurzel; die Wurzel selbst hat -1. */
  depth: number;
  /**
   * Ob es den Ordner wirklich gibt. Fehlt ein Elternordner in den Einträgen
   * (etwa, weil eine Bereichsberechtigung ihn ausblendet oder er nie angelegt
   * wurde), ergänzt der Baum ihn, damit der Pfad lesbar bleibt — er ist dann
   * aber kein Ablageziel.
   */
  created: boolean;
};

const exact = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byGermanName = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base' }) || exact(a, b);

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** `'a/b/c'` → `['a', 'a/b']`: die Elternpfade von oben nach unten, ohne den Pfad selbst. */
export function ancestorsOf(path: string): string[] {
  if (!path || path === TREE_ROOT) return [];
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** Liegt `path` in `root` oder ist es `root` selbst? Segmentweise: `a_b` liegt nicht in `a`. */
export function isWithin(path: string, root: string): boolean {
  if (root === TREE_ROOT) return true;
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Der Ort von `path` unter dem geöffneten Ordner `base`, als Namen von oben
 * nach unten — für die Spalte „Ordner“, die den Teilbaum zeigt (Spec § 9).
 * Leer heißt „direkt hier“; ohne `base` oder außerhalb davon der ganze Weg.
 */
export function namesBelow(path: string, base: string | null): string[] {
  if (base !== null && path === base) return [];
  const rest = base !== null && isWithin(path, base) ? path.slice(base.length + 1) : path;
  return rest.split('/');
}

/**
 * Knotentabelle für den Baum. Schlüssel sind {@link TREE_ROOT} und jeder Pfad;
 * fehlende Eltern werden ergänzt (`direct: 0`, `created: false`). Geschwister
 * stehen nach deutschem Alphabet ohne Rücksicht auf Groß- und Kleinschreibung,
 * bei Gleichstand exakt — sonst hinge die Reihenfolge an der Eingabe.
 */
export function buildFolderTree(entries: readonly FolderEntry[]): Record<string, FolderNode> {
  const nodes: Record<string, FolderNode> = {
    [TREE_ROOT]: { path: TREE_ROOT, name: '', parent: '', children: [], direct: 0, total: 0, depth: -1, created: false },
  };

  const ensure = (path: string): FolderNode => {
    const existing = nodes[path];
    if (existing) return existing;
    const parents = ancestorsOf(path);
    const parent = parents.at(-1) ?? TREE_ROOT;
    ensure(parent).children.push(path);
    const node: FolderNode = { path, name: nameOf(path), parent, children: [], direct: 0, total: 0, depth: parents.length, created: false };
    nodes[path] = node;
    return node;
  };

  for (const entry of entries) {
    const node = ensure(entry.path);
    node.created = true;
    node.direct += entry.count;
  }

  for (const node of Object.values(nodes)) {
    node.children.sort((a, b) => byGermanName(nameOf(a), nameOf(b)));
  }

  const sum = (node: FolderNode): number => {
    node.total = node.direct + node.children.reduce((acc, child) => acc + sum(nodes[child]!), 0);
    return node.total;
  };
  sum(nodes[TREE_ROOT]!);

  return nodes;
}

/**
 * Was aufgeklappt ist (Spec § 5.2): der gespeicherte Zustand, soweit es die
 * Ordner noch gibt — ein anderes Gerät kann sie gelöscht haben —, dazu immer
 * der Weg zum gewählten Ordner. Stillschweigend, ohne Fehler.
 */
export function resolveExpanded(stored: readonly string[], existing: ReadonlySet<string>, selected: string | null): string[] {
  const out = stored.filter((path) => existing.has(path));
  for (const path of ancestorsOf(selected ?? '')) {
    if (existing.has(path) && !out.includes(path)) out.push(path);
  }
  return out;
}

/** Pfade nach Umbenennen oder Verschieben von `from` nach `to` umschreiben — segmentweise: `a_b` bleibt, wenn `a` wandert. */
export function renamePrefixPaths(paths: readonly string[], from: string, to: string): string[] {
  return paths.map((path) => (isWithin(path, from) ? to + path.slice(from.length) : path));
}

/** Eine Ordneränderung, die der Baum vorwegnimmt, bis der Server sie bestätigt (Spec § 5.3, optimistisch). */
export type FolderChange = { kind: 'move'; from: string; to: string } | { kind: 'delete'; path: string } | { kind: 'create'; path: string };

/**
 * Die Ordnerliste nach einer Änderung: Verschieben und Umbenennen schreiben den
 * Teilbaum per Präfix um, die Zahlen ziehen mit (die Summen rechnet
 * {@link buildFolderTree} daraus neu).
 */
export function applyFolderChange(entries: readonly FolderEntry[], change: FolderChange): FolderEntry[] {
  switch (change.kind) {
    case 'move':
      return entries.map((entry) => (isWithin(entry.path, change.from) ? { ...entry, path: change.to + entry.path.slice(change.from.length) } : entry));
    case 'delete':
      return entries.filter((entry) => entry.path !== change.path);
    case 'create':
      return entries.some((entry) => entry.path === change.path) ? [...entries] : [...entries, { path: change.path, count: 0 }];
  }
}

/** Wohin der gewählte Ordner wandert, wenn `from` nach `to` geht — er selbst oder ein Vorfahr; sonst bleibt er. */
export function followFolder(selected: string | null, from: string, to: string): string | null {
  if (selected === null || !isWithin(selected, from)) return selected;
  return to + selected.slice(from.length);
}

/**
 * Warum ein Ziel gesperrt ist (HANDOFF § 3.1). `nameLength` heißt beim Server
 * `tooLong`, `depth` `tooDeep`, `here` `sameLocation`, `self` `insideItself`.
 * `notCreated`: Den Ordner gibt es nur als Weg (vom Baum ergänzt).
 * `incomingOnly`: Der Eingangskorb nimmt nur eingegangene Post (setzt der
 * feste Eintrag selbst, siehe `FolderTreeFixedEntry.refuse`).
 */
export type BlockReason = 'here' | 'self' | 'depth' | 'nameLength' | 'exists' | 'forbidden' | 'notCreated' | 'incomingOnly';

/** Was gezogen wird. `sources[i]` ist der Ordner von `ids[i]`; leer, wenn unbekannt (aus einem anderen Tab). */
export type DragItem =
  | { kind: 'documents' | 'assets'; ids: string[]; sources: (string | null)[]; label: string }
  | { kind: 'folder'; path: string; total: number }
  | { kind: 'files'; count: number | null };

/** Dieselben Grenzen wie `planFolderMove` in `@kompass/core` (Spec § 6.1). */
export const MAX_FOLDER_DEPTH = 8;
export const MAX_FOLDER_PATH = 200;

/**
 * Darf `item` nach `target` (`null` = oberste Ebene bzw. ohne Ordner)? Die
 * Regeln des Servers, damit ein Ziel schon beim Ziehen gesperrt erscheint;
 * der Server prüft endgültig. Ohne Rechte gilt alles als erlaubt.
 */
export function validateFolderTarget(
  nodes: Record<string, FolderNode>,
  item: DragItem,
  target: string | null,
  rights: { canManage: boolean; canDrop: boolean } = { canManage: true, canDrop: true }
): BlockReason | null {
  if (item.kind === 'folder' ? !rights.canManage : !rights.canDrop) return 'forbidden';
  const exists = target === null || !!nodes[target]?.created;

  if (item.kind === 'folder') {
    const from = item.path;
    if (target !== null && isWithin(target, from)) return 'self';
    const parent = ancestorsOf(from).at(-1) ?? null;
    if (target === parent) return 'here';
    if (!exists) return 'notCreated';
    const to = target === null ? nameOf(from) : `${target}/${nameOf(from)}`;
    if (nodes[to]) return 'exists';
    // Über den ganzen Teilbaum, wie der Server: Ein tiefer Unterordner kann zu tief werden, wo der Ordner selbst passt.
    for (const path of Object.keys(nodes).filter((p) => p !== TREE_ROOT && isWithin(p, from)).sort()) {
      const moved = to + path.slice(from.length);
      if (moved.split('/').length > MAX_FOLDER_DEPTH) return 'depth';
      if (moved.length > MAX_FOLDER_PATH) return 'nameLength';
    }
    return null;
  }

  if (item.kind !== 'files' && item.sources.length > 0 && item.sources.every((source) => source === target)) return 'here';
  return exists ? null : 'notCreated';
}

/** Höchstlänge eines Ordnernamens (eines Segments), wie `FOLDER_SEGMENT` im Kern. */
export const MAX_FOLDER_NAME = 60;

/**
 * Was am Namen eines neuen oder umbenannten Ordners nicht geht — schon beim
 * Tippen, weil die Geschwister bekannt sind (README § 3, Artboard 4); der
 * Server prüft endgültig. Die Regeln von `parseFolderPath` im Kern, mit dem
 * Schrägstrich als eigenem Fall (er hat einen eigenen Text). `invalid`:
 * umgekehrter Schrägstrich, Steuerzeichen, `.`/`..`, Leerzeichen am Rand.
 * Gleiche Namen werden exakt verglichen wie beim Server; `self` ist der
 * eigene Name beim Umbenennen, damit nur die Schreibweise ändern geht.
 */
export type FolderNameError = 'empty' | 'slash' | 'tooLong' | 'invalid' | 'exists';

export function validateFolderName(siblings: readonly string[], name: string, self?: string): FolderNameError | null {
  if (name === '') return 'empty';
  if (name.includes('/')) return 'slash';
  if (name.length > MAX_FOLDER_NAME) return 'tooLong';
  if (/[\\\x00-\x1f]/.test(name) || name === '.' || name === '..' || name !== name.trim()) return 'invalid';
  if (name !== self && siblings.includes(name)) return 'exists';
  return null;
}

/**
 * Passt der Ordner `name` unter `parent` (`null` = oberste Ebene) in die
 * Grenzen des Servers (höchstens 8 Ebenen, 200 Zeichen)? Beim Umbenennen
 * (`renaming` = bisheriger Pfad) zählt der ganze Teilbaum: Ein tiefer
 * Unterordner kann zu lang werden, wo der Ordner selbst passt.
 */
export function validateFolderPlacement(
  nodes: Record<string, FolderNode>,
  parent: string | null,
  name: string,
  renaming?: string
): 'depth' | 'nameLength' | null {
  const to = parent === null ? name : `${parent}/${name}`;
  const paths = renaming ? Object.keys(nodes).filter((p) => p !== TREE_ROOT && isWithin(p, renaming)).map((p) => to + p.slice(renaming.length)) : [to];
  if (paths.some((p) => p.split('/').length > MAX_FOLDER_DEPTH)) return 'depth';
  if (paths.some((p) => p.length > MAX_FOLDER_PATH)) return 'nameLength';
  return null;
}

/**
 * Warum ein Ordner sich nicht löschen lässt: Der Server löscht nur leere
 * Ordner ohne Unterordner, auch leere Unterordner halten ihn (Handoff § 8.3).
 * Eigene Inhalte zuerst — sie sind der häufigere Grund.
 */
export function deleteBlock(node: FolderNode): { reason: 'hasItems' | 'hasChildren'; count: number } | null {
  if (node.direct > 0) return { reason: 'hasItems', count: node.direct };
  if (node.children.length > 0) return { reason: 'hasChildren', count: node.children.length };
  return null;
}
