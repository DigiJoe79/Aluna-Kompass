import type { Deps } from '../deps';
import type { ImagePlaceDeclaration } from '../modules/manifest';
import { enabledManifests } from '../modules/service';
import { resolvePlaces, type ImagePlaceSpec, type ResolvedImagePlaces } from './image-place-resolve';

export * from './image-place-resolve';

/** Die Bildstellen aller eingeschalteten Module (`ModuleManifest.imagePlaces`). */
export function imagePlaceDeclarations(deps: Deps): ImagePlaceDeclaration[] {
  return enabledManifests(deps).flatMap((m) => [...(m.imagePlaces ?? [])]);
}

/** Die Angaben `images` des Templates — vom ersten eingeschalteten Modul, das sie liefert (Site). */
export function templateImageSpecs(deps: Deps): Readonly<Record<string, unknown>> {
  for (const m of enabledManifests(deps)) {
    const specs = m.imagePlaceSpecs?.(deps);
    if (specs) return specs;
  }
  return {};
}

/** Schlüssel in `images`, die kein eingeschaltetes Modul angemeldet hat — beim Einlesen ein Hinweis, kein Fehler. */
export function unknownImagePlaceKeys(deps: Deps, images: Readonly<Record<string, unknown>> | undefined): string[] {
  const known = new Set(imagePlaceDeclarations(deps).map((d) => d.key));
  return Object.keys(images ?? {}).filter((k) => !known.has(k));
}

const specOf = (raw: unknown): Partial<ImagePlaceSpec> | undefined => (raw && typeof raw === 'object' ? (raw as Partial<ImagePlaceSpec>) : undefined);

/**
 * Die aufgelöste Bildstelle einer Modul-Sicht (Spec Ausschnitt für alle Bilder § 2): die Angabe des Templates, sonst
 * der Rückfall des Moduls (Hauptfoto: Einstellung „Bildausschnitt“), sonst die volle Reihe mit Schwelle 960. Eine
 * Stelle, die kein eingeschaltetes Modul anmeldet, löst sich wie „ohne Angabe“ auf.
 */
export function imagePlaces(deps: Deps, key: string): ResolvedImagePlaces {
  const declaration = imagePlaceDeclarations(deps).find((d) => d.key === key);
  const fallback = declaration?.fallback?.(deps);
  return resolvePlaces(specOf(templateImageSpecs(deps)[key]), {
    ...(fallback ? { fallback } : {}),
    ...(declaration ? { labelKey: declaration.label } : {}),
    ...(declaration?.labels ? { labelKeys: declaration.labels } : {}),
    ...(declaration?.lightbox ? { lightbox: true, lightboxLabelKey: declaration.lightbox } : {}),
  });
}

/** Alle angemeldeten Stellen eines Moduls (oder aller), aufgelöst — für Lesewerkzeuge (MCP-Parität). */
export function moduleImagePlaces(deps: Deps, moduleKey?: string): Record<string, ResolvedImagePlaces> {
  const out: Record<string, ResolvedImagePlaces> = {};
  for (const d of imagePlaceDeclarations(deps)) {
    if (moduleKey && !d.key.startsWith(`${moduleKey}.`)) continue;
    out[d.key] = imagePlaces(deps, d.key);
  }
  return out;
}
