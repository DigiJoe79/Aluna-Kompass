import { conflict, type Deps, type Failure } from '@kompass/core';
import type { DocumentTypeRow } from './schema';

/**
 * Dokumente einer modul-eigenen Art erzeugt und storniert nur ihr Modul — sonst
 * zöge ein freier Brief eine Nummer aus dem Kreis der Zuwendungsbestätigungen,
 * und „lückenlos“ hieße nichts mehr. Die eine Stelle, die das entscheidet.
 */
export function refuseModuleOwned(docType: Pick<DocumentTypeRow, 'label' | 'ownerModule'>): Failure | null {
  if (!docType.ownerModule) return null;
  return conflict('documentTypeOwnedByModule', `Dokumentart „${docType.label}“ gehört dem Modul ${docType.ownerModule}; ihre Dokumente entstehen dort`);
}

/** F7: Ein Modul kann eigene Arten zum Stornieren in der Akte freigeben (`voidableDocumentTypes`). */
export function moduleReleasesVoid(deps: Deps, docType: Pick<DocumentTypeRow, 'key' | 'ownerModule'>): boolean {
  return !!docType.ownerModule && deps.registry.manifests.some((m) => m.key === docType.ownerModule && (m.voidableDocumentTypes ?? []).includes(docType.key));
}

/**
 * Ob die Akte ein Dokument dieser Art stornieren darf: Eine modul-eigene Art storniert nur ihr Modul, es sei denn, es
 * gibt sie frei. Dienst (`voidDocument`) und Dokumentseite fragen hier — die Seite zeigt sonst einen Knopf, den der
 * Dienst immer ablehnt.
 */
export function refuseVoidOwned(deps: Deps, docType: Pick<DocumentTypeRow, 'key' | 'label' | 'ownerModule'> | undefined | null): Failure | null {
  if (!docType || moduleReleasesVoid(deps, docType)) return null;
  return refuseModuleOwned(docType);
}
