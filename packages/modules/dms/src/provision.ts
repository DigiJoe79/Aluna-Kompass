import { provisionOnce, recordAudit, type CallContext, type DbOrTx, type Deps, type ProvisionOutcome, type RetentionClass } from '@kompass/core';
import { asc } from 'drizzle-orm';
import { documentTypeFor, prefixTaken } from './catalog';
import { documentTypes } from './schema';

export interface ProvisionedDocumentType {
  module: string;
  key: string;
  label: string;
  prefix: string;
  defaultDirection: 'outgoing' | 'incoming';
  retentionClass: RetentionClass;
  defaultFolder?: string | null;
  owned?: boolean;
  protectionArea?: string | null;
}

/**
 * Eine Dokumentart als Grundausstattung eines Moduls — im `install`, also in
 * dessen Transaktion. Zwei Fälle, bewusst verschieden:
 *
 * Eine Art **für den Verein** (Belegarten) ist ein Vorschlag. Ist ihr Schlüssel
 * oder Präfix vergeben, hat der Verein schon entschieden: übersprungen, und
 * weil `module_provisions` es vermerkt, kommt der Vorschlag nie wieder.
 *
 * Eine **modul-eigene** Art braucht das Modul zum Arbeiten. Trägt eine andere
 * Art ihr Präfix, wirft die Funktion: Der Nachlauf zeigt den Fehler auf der
 * Einrichtungskachel, und der Verein gibt seiner — noch unbenutzten — Art ein
 * anderes Präfix. Beim nächsten Start entsteht die Art dann.
 */
export function ensureDocumentType(tx: DbOrTx, deps: Deps, ctx: CallContext, type: ProvisionedDocumentType): ProvisionOutcome | 'already' {
  return provisionOnce(tx, deps, { module: type.module, kind: 'documentType', key: type.key }, () => {
    const holder = prefixTaken(tx, type.prefix);
    if (type.owned) {
      if (documentTypeFor(tx, type.key)) throw new Error(`Dokumentart „${type.key}“ gibt es schon; das Modul ${type.module} braucht diesen Schlüssel`);
      if (holder) throw new Error(`Präfix ${type.prefix} trägt schon die Dokumentart „${holder.label}“; das Modul ${type.module} braucht es für „${type.label}“`);
    } else if (documentTypeFor(tx, type.key) || holder) {
      recordAudit(tx, deps, ctx, { action: 'dms.type.provision', entityType: 'documentType', entityId: type.key, after: { key: type.key, outcome: 'skipped' }, summary: `Dokumentart „${type.label}“ nicht angelegt: Schlüssel oder Präfix vergeben` });
      return 'skipped';
    }
    const last = tx.select({ sortOrder: documentTypes.sortOrder }).from(documentTypes).orderBy(asc(documentTypes.sortOrder)).all().at(-1)?.sortOrder ?? -1;
    tx.insert(documentTypes)
      .values({
        key: type.key, label: type.label, prefix: type.prefix, defaultDirection: type.defaultDirection, retentionClass: type.retentionClass,
        defaultFolder: type.defaultFolder ?? null, isActive: true, sortOrder: last + 1,
        ownerModule: type.owned ? type.module : null, protectionArea: type.protectionArea ?? null,
      })
      .run();
    recordAudit(tx, deps, ctx, { action: 'dms.type.provision', entityType: 'documentType', entityId: type.key, after: { key: type.key, prefix: type.prefix, ownerModule: type.owned ? type.module : null, protectionArea: type.protectionArea ?? null }, summary: `Dokumentart „${type.label}“ von ${type.module} angelegt` });
    return 'created';
  });
}
