import type { Folder } from './types';

export interface FolderNode {
  path: string;
  /** Das letzte Segment — die Beschriftung im Baum. */
  name: string;
  /** 0 = direkt unter der Wurzel. */
  depth: number;
  assetCount: number;
}

const byName = (a: FolderNode, b: FolderNode) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }) || a.name.localeCompare(b.name, 'de');

/**
 * Aus den flachen Pfaden ein Baum in Tiefensuche: jedes Kind direkt unter
 * seinem Elternpfad, Geschwister nach Name sortiert, nicht nach rohem Pfad —
 * sonst stünde `a/b` hinter `a b` und `a-x`, und `Tiere` vor `bilder`.
 * Ein Ordner ohne Elternzeile steht auf der Tiefe seines Pfads, unter der Wurzel.
 */
export function flattenFolderTree(folders: readonly Folder[]): FolderNode[] {
  const children = new Map<string | null, FolderNode[]>();
  const paths = new Set(folders.map((f) => f.path));
  for (const f of folders) {
    const i = f.path.lastIndexOf('/');
    const parent = i === -1 ? null : f.path.slice(0, i);
    const key = parent !== null && paths.has(parent) ? parent : null;
    const list = children.get(key) ?? [];
    list.push({ path: f.path, name: f.path.slice(i + 1), depth: f.path.split('/').length - 1, assetCount: f.assetCount });
    children.set(key, list);
  }
  const out: FolderNode[] = [];
  const walk = (parent: string | null) => {
    for (const node of (children.get(parent) ?? []).sort(byName)) {
      out.push(node);
      walk(node.path);
    }
  };
  walk(null);
  return out;
}
