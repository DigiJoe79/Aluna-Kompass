import type { DbOrTx } from '@kompass/core';
import { contacts } from '@kompass/module-contacts';
import { desc, eq } from 'drizzle-orm';
import { compactIban } from './format/iban';
import { financeContactBankAccounts } from './schema';

/**
 * Alle Kontakte, deren Zuordnung die IBAN trägt — jüngste zuerst. Gelöschte
 * Kontakte fallen heraus, archivierte bleiben drin: Die Liste beantwortet
 * „Kennt Kompass diese IBAN?“ (Hinweis „fremde IBAN“ im Import, Warnung an
 * Auslagen, Ablehnung beim Verknüpfen von Hand). Ohne Rechteprüfung. Liegt im
 * neutralen Grund, weil Import und Auslagen sie beide brauchen
 * (`tests/direction.test.ts`).
 */
export function contactsForIbanInternal(db: DbOrTx, iban: string): string[] {
  return db
    .select({ contactId: financeContactBankAccounts.contactId })
    .from(financeContactBankAccounts)
    .innerJoin(contacts, eq(contacts.id, financeContactBankAccounts.contactId))
    .where(eq(financeContactBankAccounts.iban, compactIban(iban)))
    .orderBy(desc(financeContactBankAccounts.createdAt), desc(financeContactBankAccounts.id))
    .all()
    .map((row) => row.contactId);
}
