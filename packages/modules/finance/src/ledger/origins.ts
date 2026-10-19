import { enabledManifests, type Deps } from '@kompass/core';

/**
 * Die Herkunftstypen offener Posten, die andere Module angemeldet haben (`openItemOrigins`, Spec Mitglieder und
 * Lastschrift § 6.1): Typ → Modulschlüssel. Ohne `includeDisabled` nur eingeschaltete Module; mit allen installierten
 * — die Sperre der öffentlichen Dienste fragt so, damit das Ausschalten eines Moduls seine Posten nicht freigibt.
 * Die eigenen Herkünfte der Finanzen (`financeExpenseClaim`, `financePartnerPayment`) stehen nicht darin; sie
 * meldet das Finanzmodul nicht an.
 */
export function registeredOpenItemOrigins(deps: Deps, opts: { includeDisabled?: boolean } = {}): Map<string, string> {
  const manifests = opts.includeDisabled ? deps.registry.manifests : enabledManifests(deps);
  const out = new Map<string, string>();
  for (const manifest of manifests) {
    for (const origin of manifest.openItemOrigins ?? []) {
      const owner = out.get(origin.type);
      if (owner !== undefined && owner !== manifest.key) throw new Error(`openItemOrigin ${origin.type} declared by ${owner} and ${manifest.key}`);
      out.set(origin.type, manifest.key);
    }
  }
  return out;
}
