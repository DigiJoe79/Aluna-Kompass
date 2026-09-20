import { documentArea, documentAreaPermissions, forbidden, hasPermission, requireAnyPermission, type CallContext, type DbOrTx, type Deps, type Failure } from '@kompass/core';
import { inArray, type SQL } from 'drizzle-orm';
import { documentTypes, documents, type DocumentRow, type DocumentTypeRow } from './schema';

/**
 * Wer was in der Akte lesen darf — **die einzige Stelle, die das entscheidet**
 * (Vorarbeiten-Spec § 5). Kein Lesedienst prüft daneben noch `dms.view`.
 *
 * Das Tor: `dms.view` oder irgendein angemeldetes Bereichsrecht (V13). Was man
 * dahinter sieht, entscheidet die Dokumentart (V1): ohne Bereich `dms.view`,
 * mit Bereich **genau** dessen Recht, mit unbekanntem Bereich niemand (V15).
 */
type Area = Pick<DocumentTypeRow, 'protectionArea'>;

export function dmsGatePermissions(deps: Deps): string[] {
  return ['dms.view', ...documentAreaPermissions(deps)];
}

export function requireDmsGate(deps: Deps, ctx: CallContext): Failure | null {
  return requireAnyPermission(ctx, dmsGatePermissions(deps));
}

/** Das Recht, das diese Art verlangt; `null`, wenn ihr Bereich nicht angemeldet ist — dann ist sie gesperrt. */
export function typePermission(deps: Deps, docType: Area): string | null {
  if (!docType.protectionArea) return 'dms.view';
  return documentArea(deps, docType.protectionArea)?.permission ?? null;
}

export function isProtectedType(docType: Area | null): boolean {
  return Boolean(docType?.protectionArea);
}

export function canReadType(deps: Deps, ctx: CallContext, docType: Area): boolean {
  const permission = typePermission(deps, docType);
  return permission !== null && hasPermission(ctx, permission);
}

export function readableTypeKeys(deps: Deps, ctx: CallContext, db: DbOrTx = deps.db): string[] {
  return db.select().from(documentTypes).all().filter((t) => canReadType(deps, ctx, t)).map((t) => t.key);
}

/**
 * Für Listen und Zähler. Immer eine **eigene UND-Bedingung** — nie Teil eines
 * `or(…)`, sonst findet die Volltextsuche, was die Liste verbirgt. Eine Art,
 * die es nicht (mehr) gibt, ist nicht lesbar.
 */
export function readableTypeFilter(deps: Deps, ctx: CallContext, db: DbOrTx = deps.db): SQL {
  const keys = readableTypeKeys(deps, ctx, db);
  return inArray(documents.typeKey, keys.length > 0 ? keys : ['__none__']);
}

/**
 * Für Verwaltungsvorgänge, die kein `dms.view` voraussetzen (Neu-Lesen, Kachel
 * „Text nicht gelesen“): Ungeschütztes wie bisher, Geschütztes nur mit dem Recht
 * seines Bereichs — sonst verriete die Zahl den geschützten Bestand.
 */
export function manageableTypeFilter(deps: Deps, ctx: CallContext, db: DbOrTx = deps.db): SQL {
  const keys = db.select().from(documentTypes).all().filter((t) => !isProtectedType(t) || canReadType(deps, ctx, t)).map((t) => t.key);
  return inArray(documents.typeKey, keys.length > 0 ? keys : ['__none__']);
}

/**
 * Für Schreibdienste: Das Recht zum Schreiben prüft der Dienst selbst
 * (`dms.create`, `dms.manage` …) und setzt kein `dms.view` voraus. Hier kommt
 * nur der Schutzbereich dazu — Ungeschütztes wie bisher, Geschütztes nur mit
 * dem Recht seines Bereichs, ein unbekannter Bereich für niemanden.
 */
export function requireAreaAccess(deps: Deps, ctx: CallContext, row: Pick<DocumentRow, 'typeKey'>, db: DbOrTx = deps.db): Failure | null {
  const docType = db.select().from(documentTypes).all().find((t) => t.key === row.typeKey);
  if (!docType || !isProtectedType(docType)) return null;
  return requireReadable(deps, ctx, row, db);
}

/** Am einzelnen Dokument. `forbidden`, nicht `notFound`: Dass es das Dokument gibt, darf man wissen (V12). */
export function requireReadable(deps: Deps, ctx: CallContext, row: Pick<DocumentRow, 'typeKey'>, db: DbOrTx = deps.db): Failure | null {
  const docType = db.select().from(documentTypes).all().find((t) => t.key === row.typeKey);
  if (!docType) return forbidden('dms.view');
  const permission = typePermission(deps, docType);
  if (permission === null) return forbidden(`dms.area:${docType.protectionArea}`);
  return hasPermission(ctx, permission) ? null : forbidden(permission);
}
