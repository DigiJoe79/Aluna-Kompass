import type { CallContext, Deps } from '@kompass/core';
import { documentTypeFor, getDocumentRecord } from '@kompass/module-dms';
import { nameOrEmpty } from '@/lib/name-or-empty';

export interface VoucherDetails {
  subject: string;
  typeLabel: string;
  date: string;
}

/**
 * Betreff, Art und Datum der Belege einer Buchung aus der Akte (07-2 A5): Die Belegzeile nennt die Nummer einmal und
 * daneben den Betreff. Wer das Dokument nicht lesen darf, bekommt keinen Eintrag — die Zeile zeigt dann nur die Nummer.
 */
export async function voucherDetails(deps: Deps, ctx: CallContext, documentIds: readonly (string | null)[]): Promise<Map<string | null, VoucherDetails>> {
  const details = new Map<string | null, VoucherDetails>();
  for (const id of new Set(documentIds)) {
    if (id === null) continue;
    const doc = await getDocumentRecord(deps, ctx, id);
    if (!doc.ok) continue;
    details.set(id, {
      subject: doc.value.subject,
      typeLabel: nameOrEmpty(documentTypeFor(deps.db, doc.value.typeKey)?.label, doc.value.typeKey),
      date: doc.value.documentDate,
    });
  }
  return details;
}
