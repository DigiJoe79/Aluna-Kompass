import { conflict, type Failure } from '@kompass/core';
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
