import { eq } from 'drizzle-orm';
import { recordAudit } from '../audit/log';
import { isoNow } from '../clock';
import type { CallContext } from '../context';
import type { DbOrTx } from '../db/client';
import { rolePermissions, roles } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { provisionOnce, type ProvisionOutcome } from '../modules/provisions';
import { nameTaken } from './service';

export interface ProvisionedRole {
  module: string;
  /** `<modul>:<rolle>`, z. B. `finance:treasurer`. */
  originKey: string;
  /** Aus der Sprachtabelle des Moduls — Nutzdaten, keine Oberfläche. */
  name: string;
  description?: string;
  /** Eigene Rechte und die der Module aus `dependsOn`; Unbekanntes wird verworfen. */
  permissions: readonly string[];
}

export function roleIdByOrigin(db: DbOrTx, originKey: string): string | null {
  return db.select({ id: roles.id }).from(roles).where(eq(roles.originKey, originKey)).get()?.id ?? null;
}

/**
 * Ein Rollenvorschlag eines Moduls. Maßgeblich für „schon ausgeliefert“ ist
 * `module_provisions`; `origin_key` dient dem Wiederfinden nach dem Umbenennen.
 * Rechte werden nie nachgefüllt, eine vergebene Bezeichnung nie überschrieben.
 */
export function createRoleInternal(tx: DbOrTx, deps: Deps, ctx: CallContext, role: ProvisionedRole): ProvisionOutcome | 'already' {
  return provisionOnce(tx, deps, { module: role.module, kind: 'role', key: role.originKey }, () => {
    if (nameTaken(tx, role.name)) {
      recordAudit(tx, deps, ctx, { action: 'roles.provision', entityType: 'role', entityId: role.originKey, after: { originKey: role.originKey, outcome: 'skipped' }, summary: `Rollenvorschlag ${role.originKey} nicht angelegt: Bezeichnung vergeben` });
      return 'skipped';
    }
    const id = newId();
    const keys = role.permissions.filter((key) => deps.registry.permissionKeys.has(key));
    tx.insert(roles).values({ id, name: role.name, description: role.description ?? '', isProtected: false, originKey: role.originKey, createdAt: isoNow(deps.clock) }).run();
    for (const permissionKey of keys) tx.insert(rolePermissions).values({ roleId: id, permissionKey }).run();
    recordAudit(tx, deps, ctx, { action: 'roles.provision', entityType: 'role', entityId: id, after: { originKey: role.originKey, name: role.name, permissionKeys: keys }, summary: `Rolle „${role.name}“ als Vorschlag von ${role.module} angelegt` });
    return 'created';
  });
}
