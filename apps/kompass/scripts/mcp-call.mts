/**
 * Ruft ein MCP-Werkzeug einer laufenden Kompass-Instanz auf und gibt das
 * Ergebnis als JSON aus — für Pflegearbeiten von der Kommandozeile, etwa
 * Einstellungen setzen oder Tiere anlegen, ohne die Oberfläche.
 *
 *   pnpm --filter @kompass/app mcp:call <basis-url> <token> <werkzeug> [json-argumente]
 *
 * Beispiel:
 *   pnpm --filter @kompass/app mcp:call http://nas:3001 akx_… settings_get '{"key":"organization.name"}'
 *
 * Das Token kommt aus Profil → API-Token und wirkt mit den Rechten des
 * Nutzers; jeder Aufruf steht im Änderungsprotokoll mit Kanal „MCP“.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const [baseUrl, token, tool, json] = process.argv.slice(2);
if (!baseUrl || !token || !tool) {
  console.error('Aufruf: mcp-call.mts <basis-url> <token> <werkzeug> [json-argumente]');
  process.exit(2);
}

const client = new Client({ name: 'mcp-call', version: '0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }),
);
const result = await client.callTool({ name: tool, arguments: json ? JSON.parse(json) : {} });
const text = (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === 'text')?.text ?? 'null';
await client.close();
if (result.isError) {
  console.error('FEHLER', text);
  process.exit(1);
}
console.log(JSON.stringify(JSON.parse(text), null, 2));
