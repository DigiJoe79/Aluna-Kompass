import type { CallContext, Deps } from '@kompass/core';
import { getProject } from '@kompass/module-projects';
import { getAnimal } from '@kompass/module-animals';
import { displayName, getContact } from '@kompass/module-contacts';

export interface ResolvedLink {
  /** Die Zeile selbst — sie wird gelöst, nicht die Entität. */
  id: string;
  entityType: string;
  entityId: string;
  role: string;
  /** Der Name der Entität, oder `null` — dann sagt `reason`, warum. */
  label: string | null;
  href: string | null;
  /**
   * `missing`: Die Entität gibt es nicht mehr. `forbidden`: Es gibt sie, aber
   * der Betrachter darf sie nicht sehen. Die beiden auseinanderzuhalten ist
   * kein Schönheitsfehler — „gelöscht“ zu lesen, wo „kein Zugriff“ gilt, führt
   * in die Irre.
   */
  reason: 'missing' | 'forbidden' | null;
}

/** Aus einem `Result` eines fremden Dienstes wird Name, Weg und Grund. */
function fromResult<T>(
  base: Omit<ResolvedLink, 'label' | 'href' | 'reason'>,
  result: { ok: true; value: T } | { ok: false; error: { type: string } },
  label: (value: T) => string,
  href: () => string,
): ResolvedLink {
  if (result.ok) return { ...base, label: label(result.value), href: href(), reason: null };
  return { ...base, label: null, href: null, reason: result.error.type === 'forbidden' ? 'forbidden' : 'missing' };
}

/**
 * Ein Bezug zeigt auf eine Entität eines anderen Moduls. Das DMS kennt die
 * nicht — `entityType` und `entityId` sind dort bewusst generisch, wie bei
 * `mediaReferences`. Aufgelöst wird deshalb hier, in der Schicht, die alle
 * installierten Module kennt. Ein unbekannter Typ fällt auf seinen Bezeichner
 * zurück, statt die Seite zu sprengen.
 */
export async function resolveLinks(
  deps: Deps,
  ctx: CallContext,
  links: readonly { id: string; entityType: string; entityId: string; role: string }[],
): Promise<ResolvedLink[]> {
  const leading = deps.locales()[0] ?? 'de';

  return Promise.all(
    links.map(async (link) => {
      const base = { id: link.id, entityType: link.entityType, entityId: link.entityId, role: link.role };

      if (link.entityType === 'contact') {
        const contact = await getContact(deps, ctx, link.entityId);
        return fromResult(base, contact, displayName, () => `/contacts/${link.entityId}`);
      }
      if (link.entityType === 'animal') {
        const animal = await getAnimal(deps, ctx, link.entityId);
        return fromResult(base, animal, (a) => a.name, () => `/animals/${link.entityId}`);
      }
      if (link.entityType === 'project') {
        const project = await getProject(deps, ctx, link.entityId);
        return fromResult(base, project, (p) => p.name[leading] || p.slug, () => `/projects/${link.entityId}`);
      }
      return { ...base, label: null, href: null, reason: 'missing' as const };
    }),
  );
}
