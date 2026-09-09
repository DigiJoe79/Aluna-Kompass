import { expect, test } from '@playwright/test';

test('health endpoint reports environment and migrations without auth', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ status: 'ok', environment: 'test' });
  expect(body.migrationCount).toBeGreaterThan(0);
  expect(typeof body.build).toBe('string');
  expect(body.build.length).toBeGreaterThan(0);
});
