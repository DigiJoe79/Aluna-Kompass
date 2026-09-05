import { describe, expect, it } from 'vitest';
import { login } from '../src/auth/login';
import { roles, users } from '../src/db/schema';
import { seedDevelopment } from '../src/seed/seed';
import { createTestDeps } from '../src/testing';

describe('seedDevelopment', () => {
  it('creates an admin, example roles and users, and is idempotent', async () => {
    const deps = createTestDeps({ env: 'development' });
    const first = await seedDevelopment(deps);
    const second = await seedDevelopment(deps);
    expect(second).toEqual(first);
    expect(deps.db.select().from(roles).all().map((r) => r.name).sort()).toEqual(['Administration', 'Kassenprüfer', 'Schatzmeisterin', 'Schriftführung']);
    expect(deps.db.select().from(users).all()).toHaveLength(4);
    const session = await login(deps, { email: first.adminEmail, password: first.adminPassword, ipAddress: null, requestId: 'R' });
    expect(session.ok).toBe(true);
  });

  it('refuses to run in production', async () => {
    const deps = createTestDeps({ env: 'production' });
    await expect(seedDevelopment(deps)).rejects.toThrow(/production/);
  });
});
