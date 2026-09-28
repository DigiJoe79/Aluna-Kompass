import type { Deps } from '../deps';
import type { LinkedDocumentAccess } from './manifest';
import { enabledManifests } from './service';

export function linkedAccess(deps: Deps, entityType: string): (LinkedDocumentAccess & { module: string }) | null {
  for (const manifest of enabledManifests(deps)) {
    const access = (manifest.linkedDocumentAccess ?? []).find((a) => a.entityType === entityType);
    if (access) return { ...access, module: manifest.key };
  }
  return null;
}

export function reservedLinkTypes(deps: Deps): ReadonlySet<string> {
  return new Set(deps.registry.manifests.flatMap((m) => (m.linkedDocumentAccess ?? []).map((a) => a.entityType)));
}
