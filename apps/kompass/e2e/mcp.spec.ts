import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, test } from '@playwright/test';
import { loginAsAdmin, resetDatabase } from './helpers';

test('an API token created in the profile drives the MCP endpoint and is audited as channel MCP', async ({ page, baseURL }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Token erstellen' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Playwright');
  await page.getByRole('dialog').getByRole('button', { name: 'Erstellen' }).click();
  const token = (await page.getByTestId('api-token-plaintext').textContent())!.trim();
  await page.getByRole('button', { name: 'Ich habe das Token gespeichert' }).click();

  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const tools = await client.listTools();
  expect(tools.tools.map((t) => t.name)).toContain('settings_set');
  const result = await client.callTool({ name: 'settings_set', arguments: { key: 'organization.city', value: 'Jülich' } });
  expect(result.isError).toBeFalsy();
  await client.close();

  await page.goto('/admin/audit');
  const row = page.getByRole('table').getByRole('row').nth(1);
  await expect(row).toContainText('settings.update');
  await expect(row).toContainText('MCP');
  await page.goto('/admin/settings');
  await expect(page.getByLabel('Ort')).toHaveValue('Jülich');
});

test('the MCP endpoint rejects requests without a token', async ({ request }) => {
  const res = await request.post('/mcp', { headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
  expect(res.status()).toBe(401);
});
