/**
 * Prueft einen laufenden Kompass-MCP-Endpunkt von aussen.
 *
 *   pnpm --filter @kompass/app mcp:check http://<nas>:3001 [token]
 *
 * Ohne Token wird nur geprueft, ob der Endpunkt erreichbar ist und
 * unangemeldete Anfragen ablehnt.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const [baseUrl, token] = process.argv.slice(2);
if (!baseUrl) {
  console.error('Aufruf: mcp-check.mts <basis-url> [token]');
  process.exit(2);
}

const endpoint = new URL('/mcp', baseUrl);
console.log(`Endpunkt: ${endpoint.href}\n`);

// 1. Ohne Token: muss abgelehnt werden.
const anonymous = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
}).catch((error: unknown) => {
  console.error('nicht erreichbar:', error instanceof Error ? error.message : error);
  process.exit(1);
});
console.log(`ohne Token         → HTTP ${anonymous.status} ${anonymous.status === 401 ? '(erwartet)' : '(UNERWARTET)'}`);

if (!token) {
  console.log('\nKein Token uebergeben — Rest uebersprungen.');
  process.exit(anonymous.status === 401 ? 0 : 1);
}

// 2. Mit Token: verbinden, Werkzeuge auflisten, einen lesenden Aufruf.
const client = new Client({ name: 'mcp-check', version: '0' });
await client.connect(
  new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
);
const { tools } = await client.listTools();
console.log(`mit Token          → verbunden, ${tools.length} Werkzeuge`);
console.log(`Werkzeuge          → ${tools.map((t) => t.name).sort().join(', ')}`);

const probe = tools.find((t) => t.name === 'settings_get') ?? tools[0];
if (probe) {
  const result = await client.callTool({
    name: probe.name,
    arguments: probe.name === 'settings_get' ? { key: 'organization.name' } : {},
  });
  console.log(`Aufruf ${probe.name} → ${result.isError ? 'FEHLER' : 'ok'}`);
  console.log(JSON.stringify(result.content, null, 2).slice(0, 400));
}
await client.close();
console.log('\nMCP laeuft.');
