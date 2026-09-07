import { eq } from 'drizzle-orm';
import type { CallContext } from '../context';
import { roles, users } from '../db/schema';
import type { Deps } from '../deps';
import { unwrap } from '../result';
import { createRole, setRolePermissions } from '../roles/service';
import { writeSettingInternal } from '../settings/service';
import { completeSetup, isSetupRequired } from '../setup/service';
import { createUser } from '../users/service';

export const SEED_ADMIN_EMAIL = 'admin@kompass.local';
export const SEED_ADMIN_PASSWORD = 'kompass-entwicklung-2026';

const EXAMPLE_ROLES: { name: string; description: string; permissions: string[] }[] = [
  { name: 'Schatzmeisterin', description: 'Finanzen und Dokumente', permissions: ['documents.create', 'documents.view', 'media.upload', 'audit.view', 'backup.export'] },
  { name: 'Kassenprüfer', description: 'Nur lesen', permissions: ['audit.view', 'documents.view'] },
  { name: 'Schriftführung', description: 'Dokumente erzeugen', permissions: ['documents.create', 'documents.view'] },
];

const EXAMPLE_USERS: { name: string; email: string; role: string }[] = [
  { name: 'Jonas Feld', email: 'jonas@kompass.local', role: 'Schatzmeisterin' },
  { name: 'Mira Klein', email: 'mira@kompass.local', role: 'Kassenprüfer' },
  { name: 'Peter Lang', email: 'peter@kompass.local', role: 'Schriftführung' },
];

export async function seedDevelopment(deps: Deps): Promise<{ adminEmail: string; adminPassword: string }> {
  if (deps.env === 'production') throw new Error('seedDevelopment must not run in production');
  if (isSetupRequired(deps)) {
    unwrap(await completeSetup(deps, { organizationName: 'Musterverein e.V.', name: 'Anna Berger', email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD, requestId: 'SEED', ipAddress: null }));
  }
  const admin = deps.db.select({ id: users.id }).from(users).where(eq(users.email, SEED_ADMIN_EMAIL)).get();
  if (!admin) throw new Error('seed admin missing');
  const ctx: CallContext = { userId: admin.id, permissions: new Set(deps.registry.permissionKeys), channel: 'system', apiTokenId: null, ipAddress: null, requestId: 'SEED' };

  const installed = deps.registry.manifests.map((m) => m.key).filter((k) => k !== 'core').sort();
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, ctx, 'modules.enabled', installed, 'seed.modules');
    writeSettingInternal(tx, deps, ctx, 'i18n.locales', ['de', 'en'], 'seed.locales');
  });

  const roleIds = new Map<string, string>();
  for (const role of EXAMPLE_ROLES) {
    const created = await createRole(deps, ctx, { name: role.name, description: role.description });
    if (created.ok) {
      unwrap(await setRolePermissions(deps, ctx, { roleId: created.value.id, permissionKeys: role.permissions }));
      roleIds.set(role.name, created.value.id);
    } else {
      const existing = deps.db.select({ id: roles.id }).from(roles).where(eq(roles.name, role.name)).get();
      if (existing) roleIds.set(role.name, existing.id);
    }
  }
  for (const person of EXAMPLE_USERS) {
    const exists = deps.db.select({ id: users.id }).from(users).where(eq(users.email, person.email)).get();
    if (exists) continue;
    const roleId = roleIds.get(person.role);
    const created = unwrap(await createUser(deps, ctx, { name: person.name, email: person.email, roleIds: roleId ? [roleId] : [] }));
    if (person.name === 'Jonas Feld') {
      deps.db.update(users).set({ mustChangePassword: false, lastLoginAt: '2026-09-01T10:00:00.000Z' }).where(eq(users.id, created.user.id)).run();
    }
  }
  return { adminEmail: SEED_ADMIN_EMAIL, adminPassword: SEED_ADMIN_PASSWORD };
}
