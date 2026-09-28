import { and, eq, isNull } from 'drizzle-orm';
import { isoNow } from '../clock';
import { systemContext } from '../context';
import { moduleProvisionErrors } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import type { ModuleManifest } from './manifest';
import { enabledManifests } from './service';

/** Abhängigkeiten zuerst. Unbekannte Schlüssel in `dependsOn` werden übergangen; Zyklen brechen ab, wo sie beginnen. */
export function installOrder(manifests: readonly ModuleManifest[]): ModuleManifest[] {
  const byKey = new Map(manifests.map((m) => [m.key, m]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const out: ModuleManifest[] = [];
  const visit = (m: ModuleManifest) => {
    if (done.has(m.key) || visiting.has(m.key)) return;
    visiting.add(m.key);
    for (const dep of m.dependsOn ?? []) {
      const next = byKey.get(dep);
      if (next) visit(next);
    }
    visiting.delete(m.key);
    done.add(m.key);
    out.push(m);
  };
  for (const m of manifests) visit(m);
  return out;
}

export function listOpenInstallErrors(deps: Deps): { module: string; message: string; at: string }[] {
  return deps.db
    .select({ module: moduleProvisionErrors.module, message: moduleProvisionErrors.message, at: moduleProvisionErrors.at })
    .from(moduleProvisionErrors)
    .where(isNull(moduleProvisionErrors.resolvedAt))
    .all();
}

/**
 * Liefert die Grundausstattung aller eingeschalteten Module nach — bei jedem
 * Start, damit ein Update seine neuen Rollen, Kategorien und Dokumentarten
 * auch eine Instanz erreicht, in der das Modul längst eingeschaltet ist.
 * `install` muss dafür in seinen Teilen idempotent sein (`provisionOnce`).
 *
 * Anders als beim Einschalten bricht ein Fehler hier nichts ab: Die Anwendung
 * muss starten. Er steht in `module_provisions_errors`, und die
 * Einrichtungskachel zeigt ihn, bis ein fehlerfreier Lauf ihn als behoben vermerkt.
 */
export function runModuleInstalls(deps: Deps): void {
  const ctx = systemContext();
  for (const manifest of installOrder(enabledManifests(deps))) {
    if (!manifest.install) continue;
    try {
      deps.db.transaction((tx) => manifest.install!(tx, deps, ctx));
      deps.db
        .update(moduleProvisionErrors)
        .set({ resolvedAt: isoNow(deps.clock) })
        .where(and(eq(moduleProvisionErrors.module, manifest.key), isNull(moduleProvisionErrors.resolvedAt)))
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const open = listOpenInstallErrors(deps).some((e) => e.module === manifest.key && e.message === message);
      if (!open) deps.db.insert(moduleProvisionErrors).values({ id: newId(), module: manifest.key, message, at: isoNow(deps.clock), resolvedAt: null }).run();
    }
  }
}
