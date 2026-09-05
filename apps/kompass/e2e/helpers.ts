import { expect, type Page } from '@playwright/test';

export const ADMIN = { email: 'admin@kompass.local', password: 'kompass-entwicklung-2026' };

export async function resetDatabase(page: Page, mode: 'empty' | 'seeded'): Promise<void> {
  const response = await page.request.post(`/__e2e/reset?mode=${mode}`, { headers: { 'x-e2e-token': 'e2e-reset' } });
  expect(response.ok()).toBe(true);
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(ADMIN.email);
  await page.getByLabel('Passwort').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL('/');
}
