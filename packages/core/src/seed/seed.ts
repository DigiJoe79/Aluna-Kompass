import { eq } from 'drizzle-orm';
import type { CallContext } from '../context';
import { listDashboardTiles, setDashboardLayout } from '../dashboard/service';
import { dashboardLayouts, roles, users } from '../db/schema';
import type { Deps } from '../deps';
import { getEffectivePermissions } from '../roles/effective';
import { unwrap } from '../result';
import { createRole, setRolePermissions } from '../roles/service';
import { readSetting, writeSettingInternal } from '../settings/service';
import { completeSetup, isSetupRequired } from '../setup/service';
import { createUser } from '../users/service';
import { seedMedia } from './media';

export const SEED_ADMIN_EMAIL = 'admin@kompass.local';
export const SEED_ADMIN_PASSWORD = 'kompass-entwicklung-2026';

const EXAMPLE_ROLES: { name: string; description: string; permissions: string[] }[] = [
  { name: 'Schatzmeisterin', description: 'Finanzen und Dokumente', permissions: ['documents.export', 'media.upload', 'audit.view', 'backup.export', 'followUps.view', 'followUps.manage', 'dms.view'] },
  // Nicht „Kassenprüfer“: Das Finanzmodul liefert ab F1 eine eigene Rolle
  // dieses Namens (Spec 10.1); zwei Rollen mit demselben Namen ließen sich
  // sonst über `nameTaken` nicht beide anlegen.
  { name: 'Interne Revision', description: 'Nur lesen', permissions: ['audit.view', 'documents.export'] },
  { name: 'Schriftführung', description: 'Dokumente erzeugen', permissions: ['documents.export'] },
];

const EXAMPLE_ADDRESS: [string, string][] = [
  ['organization.street', 'Vereinsweg 1'],
  ['organization.postalCode', '12345'],
  ['organization.city', 'Musterstadt'],
];

const EXAMPLE_USERS: { name: string; email: string; role: string }[] = [
  { name: 'Jonas Feld', email: 'jonas@kompass.local', role: 'Schatzmeisterin' },
  { name: 'Mira Klein', email: 'mira@kompass.local', role: 'Interne Revision' },
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
    // Derselbe Schritt, den `setModuleEnabled` beim Einschalten geht. Ohne ihn
    // stünde die Entwicklung auf einem anderen Zustand als eine echte
    // Installation — und genau solche Unterschiede fallen zuletzt auf.
    for (const manifest of deps.registry.manifests) manifest.install?.(tx, deps, ctx);
    // Eine erfundene Vereinsanschrift — jede Zuwendungsbestätigung trägt sie (F6a). Was schon eingetragen ist, bleibt.
    for (const [key, value] of EXAMPLE_ADDRESS) {
      if (!String(readSetting(deps, key) ?? '').trim()) writeSettingInternal(tx, deps, ctx, key, value, 'seed.organization');
    }
  });

  const known = new Set(deps.registry.permissionKeys);
  const roleIds = new Map<string, string>();
  for (const role of EXAMPLE_ROLES) {
    const created = await createRole(deps, ctx, { name: role.name, description: role.description });
    if (created.ok) {
      unwrap(await setRolePermissions(deps, ctx, { roleId: created.value.id, permissionKeys: role.permissions.filter((key) => known.has(key)) }));
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

  await seedDashboardLayout(deps);

  await seedMedia(deps, ctx);

  for (const manifest of deps.registry.manifests) {
    if (manifest.seed) {
      await manifest.seed(deps, ctx);
    }
  }

  return { adminEmail: SEED_ADMIN_EMAIL, adminPassword: SEED_ADMIN_PASSWORD };
}

/**
 * Eine gespeicherte Anordnung für einen Seed-Nutzer, damit `dashboard_layouts`
 * nach dem Seed nicht leer ist und der Rundlauf Speichern/Lesen belegt ist.
 * Gewünscht sind Fällig (30 Tage), Unversandt, Backup — genommen wird, was die
 * Installation kennt und Jonas sehen darf.
 */
async function seedDashboardLayout(deps: Deps): Promise<void> {
  const jonas = deps.db.select({ id: users.id }).from(users).where(eq(users.email, 'jonas@kompass.local')).get();
  if (!jonas) return;
  if (deps.db.select({ userId: dashboardLayouts.userId }).from(dashboardLayouts).where(eq(dashboardLayouts.userId, jonas.id)).get()) return;
  const permissions = getEffectivePermissions(deps.db, deps.registry, jonas.id);
  const ctx: CallContext = { userId: jonas.id, permissions, channel: 'system', apiTokenId: null, ipAddress: null, requestId: 'SEED' };
  const wanted = [
    { module: 'core', key: 'followUps', options: { horizonDays: '30' } },
    { module: 'dms', key: 'unsent', options: {} },
    { module: 'core', key: 'backup', options: {} },
  ];
  const available = unwrap(await listDashboardTiles(deps, ctx));
  const tiles = wanted.filter((w) => available.some((a) => a.module === w.module && a.key === w.key));
  unwrap(await setDashboardLayout(deps, ctx, { tiles }));
}
