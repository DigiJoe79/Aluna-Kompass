import type { Deps } from '../deps';
import type { DocumentArea } from './manifest';

/** Registry-weit, nicht nur eingeschaltete Module: Ein ausgeschaltetes Modul schützt seinen Bereich weiter. */
export function documentArea(deps: Deps, key: string): (DocumentArea & { module: string }) | null {
  for (const manifest of deps.registry.manifests) {
    const area = (manifest.documentAreas ?? []).find((a) => a.key === key);
    if (area) return { ...area, module: manifest.key };
  }
  return null;
}

export function documentAreaPermissions(deps: Deps): string[] {
  return deps.registry.manifests.flatMap((m) => (m.documentAreas ?? []).map((a) => a.permission));
}
