import type { DbOrTx } from '@kompass/core';
import { isProtectedType } from './access';
import { documentTypeFor } from './catalog';
import type { DocumentRow } from './schema';

export interface AuditDocumentRef {
  hidden: boolean;
  /** Für `params`: die Nummer, solange es eine gibt — nie der Betreff (Spec Protokoll § 2: er kann Personen nennen). */
  number: string | null;
}

/**
 * Was das Änderungsprotokoll von einem Dokument nennt. Das Protokoll ist
 * unlöschbar und mit `audit.view` frei durchsuchbar — dort steht deshalb nie der
 * Betreff (er kann Personen nennen), nur Nummer bzw. bei Entwürfen ID und Art;
 * eine Änderung des Betreffs nur als Feldname (Spec Protokoll § 2, 0.2.9 — vorher
 * nur bei geschützten Arten, Vorarbeiten-Spec § 5, Anhang A). `hidden` sagt
 * weiter, ob eine geschützte Art beteiligt ist.
 *
 * `alsoTypeKey`: beim Umklassifizieren die **andere** Art — ist eine von beiden
 * geschützt, ist der Eintrag es auch.
 */
export function auditDocumentRef(db: DbOrTx, row: Pick<DocumentRow, 'id' | 'number' | 'subject' | 'typeKey'>, alsoTypeKey?: string): AuditDocumentRef {
  const hidden = [row.typeKey, alsoTypeKey].some((key) => key !== undefined && isProtectedType(documentTypeFor(db, key)));
  return { hidden, number: row.number ?? null };
}
