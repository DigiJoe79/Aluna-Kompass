import { describe, expect, it } from 'vitest';
import { resolveSession } from '../src/auth/sessions';
import { auditLog, roles } from '../src/db/schema';
import { unwrap } from '../src/result';
import { readSetting } from '../src/settings/service';
import { completeSetup, isSetupRequired } from '../src/setup/service';
import { createTestDeps } from '../src/testing';

const input = { organizationName: 'Musterverein e.V.', name: 'Anna Berger', email: 'anna@example.org', password: 'ein-langes-merkbares-passwort', requestId: 'REQ-SETUP', ipAddress: '10.0.0.2' };

describe('setup', () => {
  it('is required on an empty database and creates the protected admin role, the user, the org name and a session', async () => {
    const deps = createTestDeps();
    expect(isSetupRequired(deps)).toBe(true);
    const result = unwrap(await completeSetup(deps, input));
    expect(isSetupRequired(deps)).toBe(false);
    const role = deps.db.select().from(roles).all()[0]!;
    expect(role).toMatchObject({ name: 'Administration', isProtected: true });
    const resolved = resolveSession(deps, result.sessionId, { ipAddress: null, requestId: 'R' });
    expect(resolved?.user.email).toBe('anna@example.org');
    expect(resolved?.mustChangePassword).toBe(false);
    expect(resolved?.ctx.permissions.size).toBe(deps.registry.permissionKeys.size);
    expect(readSetting(deps, 'organization.name')).toBe('Musterverein e.V.');
    const actions = deps.db.select().from(auditLog).all().map((e) => e.action);
    expect(actions).toContain('setup.complete');
    expect(deps.db.select().from(auditLog).all().every((e) => e.userId === result.userId)).toBe(true);
  });

  it('refuses a second setup and validates input', async () => {
    const deps = createTestDeps();
    unwrap(await completeSetup(deps, input));
    const again = await completeSetup(deps, { ...input, email: 'other@example.org' });
    expect(again.ok === false && again.error.type === 'conflict' && again.error.code === 'setupAlreadyDone').toBe(true);
    const fresh = createTestDeps();
    const short = await completeSetup(fresh, { ...input, password: 'kurz' });
    expect(short.ok === false && short.error.type === 'validation').toBe(true);
    expect(isSetupRequired(fresh)).toBe(true);
  });
});
