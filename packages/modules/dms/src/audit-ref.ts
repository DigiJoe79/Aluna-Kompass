import type { DbOrTx } from '@kompass/core';
import { isProtectedType } from './access';
import { documentTypeFor } from './catalog';
import type { DocumentRow } from './schema';

export interface AuditDocumentRef {
  hidden: boolean;
  /** Für `summary`: die Nummer; ohne Nummer `„Betreff“`, bei geschützter Art `Entwurf <id> (<typeKey>)`. */
  name: string;
  /** Für `before`/`after`: `{ subject }` — oder `{}` bei geschützter Art. */
  subject: { subject?: string };
}

/**
 * Was das Änderungsprotokoll von einem Dokument nennt. Das Protokoll ist
 * unlöschbar und mit `audit.view` frei durchsuchbar — für Dokumente geschützter
 * Arten steht dort deshalb die Nummer statt des Betreffs, bei Entwürfen ID und
 * Art (Vorarbeiten-Spec § 5, Anhang A). Gilt ab dem Tag, an dem die Art ihren
 * Bereich bekommt; ältere Einträge bleiben, wie sie sind.
 *
 * `alsoTypeKey`: beim Umklassifizieren die **andere** Art — ist eine von beiden
 * geschützt, ist der Eintrag es auch.
 */
export function auditDocumentRef(db: DbOrTx, row: Pick<DocumentRow, 'id' | 'number' | 'subject' | 'typeKey'>, alsoTypeKey?: string): AuditDocumentRef {
  const hidden = [row.typeKey, alsoTypeKey].some((key) => key !== undefined && isProtectedType(documentTypeFor(db, key)));
  if (hidden) return { hidden, name: row.number ?? `Entwurf ${row.id} (${row.typeKey})`, subject: {} };
  return { hidden, name: row.number ?? `„${row.subject}“`, subject: { subject: row.subject } };
}
