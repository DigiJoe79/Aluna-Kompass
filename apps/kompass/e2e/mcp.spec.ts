import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, test } from './fixtures';
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

/**
 * Der Paritätswächter prüft, dass ein Werkzeug seinen Dienst nennt — nicht,
 * dass es durch den Endpunkt hindurch benutzbar ist. Beide neuen Werkzeuge
 * vom 2026-09-15 gehen deshalb einmal den echten Weg: `themes_duplicate` und
 * `themes_update`, weil ihr Eingabeschema jeden Gestaltungstoken für hell und
 * dunkel trägt — das größte Schema, das der Kern über MCP anbietet, und die
 * naheliegendste Stelle für eine Überraschung bei der Umwandlung nach
 * JSON-Schema.
 */
test('a tool with a large input schema works through the endpoint, not just in the registry', async ({ page, baseURL }) => {
  await resetDatabase(page, 'seeded');
  await loginAsAdmin(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Token erstellen' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Playwright Themes');
  await page.getByRole('dialog').getByRole('button', { name: 'Erstellen' }).click();
  const token = (await page.getByTestId('api-token-plaintext').textContent())!.trim();
  await page.getByRole('button', { name: 'Ich habe das Token gespeichert' }).click();

  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', baseURL), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));

  const namen = (await client.listTools()).tools.map((t) => t.name);
  expect(namen).toEqual(expect.arrayContaining(['themes_create', 'themes_update', 'themes_duplicate', 'themes_delete', 'users_get', 'users_update', 'media_folder_list', 'locales_preview_removal']));

  // Kopieren, dann eine Farbe ändern: Das Kopieren liefert alle Tokens zurück,
  // die das Ändern wieder mitschicken muss.
  const kopie = await client.callTool({ name: 'themes_duplicate', arguments: { sourceKey: 'default', key: 'probe', name: 'Probe' } });
  expect(kopie.isError, JSON.stringify(kopie.content)).toBeFalsy();
  const theme = (kopie.structuredContent ?? JSON.parse((kopie.content as { text: string }[])[0]!.text)) as {
    key: string;
    name: string;
    tokens: Record<string, { light: string; dark: string }>;
  };
  expect(Object.keys(theme.tokens).length).toBeGreaterThan(5);

  // Der erste Token, den die Kopie nennt — kein erfundener Name: Das Schema
  // ist `.strict()`, und welche Tokens es gibt, entscheidet der Kern.
  const [ersterToken] = Object.keys(theme.tokens);
  const geaendert = await client.callTool({
    name: 'themes_update',
    arguments: { ...theme, tokens: { ...theme.tokens, [ersterToken!]: { light: '#fafafa', dark: '#101010' } } },
  });
  expect(geaendert.isError, JSON.stringify(geaendert.content)).toBeFalsy();
  await client.close();

  // Über MCP angelegt, in der Oberfläche vorhanden: derselbe Weg zu denselben Daten.
  await page.goto('/admin/themes');
  await expect(page.getByRole('button', { name: 'Probe probe' })).toBeVisible();
});
