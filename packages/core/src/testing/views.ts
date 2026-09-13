import { ZodError } from 'zod';
import type { Deps } from '../deps';
import type { ModuleManifest } from '../modules/manifest';

/**
 * Lädt jede veröffentlichte Sicht eines Manifests. Eine Sicht, die ihre
 * eigenen Zeilen ablehnt, ist der Fehler vom 2026-09-13 (`686c843`): Der
 * Dienst nahm ein Teil-Record an, die Sicht verlangte alle Sprachen, und der
 * Export brach. Der Helfer nennt Sicht und Pfad, damit der Test es tut.
 */
export function loadAllViews(deps: Deps, manifest: ModuleManifest): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const view of manifest.publishedViews ?? []) {
    try {
      out[view.name] = view.load(deps);
    } catch (error) {
      if (error instanceof ZodError) {
        const first = error.issues[0];
        const where = first ? `${first.path.map(String).join('.')}: ${first.message}` : 'unknown issue';
        throw new Error(`view "${view.name}" rejects its own rows: ${where}`);
      }
      throw error;
    }
  }
  return out;
}
