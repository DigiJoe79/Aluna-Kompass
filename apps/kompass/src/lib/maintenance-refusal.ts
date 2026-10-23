import { isMaintenanceActive } from '@kompass/core/maintenance';

/**
 * Routen, die am Proxy vorbeilaufen (`proxy.ts`, Matcher: `/mcp` und die beiden Uploads), prüfen den Merker selbst —
 * vor Sitzung und Datenbank. Derselbe Pfad wie im Proxy und in `getDeps`. Der MCP-Handler ist zwischengespeichert;
 * die Sperre in `getDeps` erreichte ihn nie (Prüfung 2026-10-23).
 */
const RETRY = { 'retry-after': '30', 'cache-control': 'no-store' };

function active(): boolean {
  return isMaintenanceActive(process.env.BACKUP_PATH ?? './backups');
}

/** 503 wie im Proxy, oder `null`, wenn kein Einspielen läuft. */
export function maintenanceRefusal(): Response | null {
  return active() ? Response.json({ error: 'maintenance' }, { status: 503, headers: RETRY }) : null;
}

/** Für Agenten: ein JSON-RPC-Fehler, den ein MCP-Client als Text zeigt. */
export function mcpMaintenanceRefusal(): Response | null {
  if (!active()) return null;
  const message = 'Kompass is restoring a backup and is locked for everyone until it is done. Try again in a few minutes.';
  return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }, { status: 503, headers: RETRY });
}
