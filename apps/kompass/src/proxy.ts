import { isMaintenanceActive } from '@kompass/core/maintenance';
import { NextResponse, type NextRequest } from 'next/server';

/*
 * Wartungsmodus während eines Einspielens (Spec Backup § Einspielen). Der Merker ist eine Datei unter
 * `BACKUP_PATH/.jobs`, kein Wert auf `globalThis`: Next darf den Proxy getrennt vom Render-Code ausführen, geteilte
 * Module und Globale sind dort nicht verlässlich (`proxy.md`). Nur der Subpfad `@kompass/core/maintenance` — der
 * Hauptexport zöge `better-sqlite3` in den Proxy.
 *
 * Seitenanfragen landen auf der Wartungsseite, alles andere bekommt 503 (Ausnahmen: siehe `config`).
 * Frei bleiben die Wartungsseite, ihr Zustand und die Zustandsabfrage des Laufs.
 */

const OPEN = new Set(['/maintenance', '/maintenance/state', '/admin/backup/job']);

/** Ohne Sitzung erreichbar; alles andere schickt der Proxy auf die Anmeldung (seit 0.1.0, bis 0.3.1 in `apps/kompass/proxy.ts`). */
const PUBLIC_PREFIXES = ['/login', '/setup', '/__e2e', '/_next', '/favicon.ico', '/mcp', '/api/', '/maintenance'];

export function proxy(request: NextRequest): NextResponse | Response {
  if (isMaintenanceActive(process.env.BACKUP_PATH ?? './backups')) return maintenance(request);
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!request.cookies.get('kompass_session')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

function maintenance(request: NextRequest): NextResponse | Response {
  if (OPEN.has(request.nextUrl.pathname)) return NextResponse.next();
  if (request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html')) {
    return NextResponse.rewrite(new URL('/maintenance', request.url));
  }
  return Response.json({ error: 'maintenance' }, { status: 503, headers: { 'retry-after': '30' } });
}

/**
 * Nicht durch den Proxy: die Upload-Routen und /mcp. Next puffert den Körper jeder Anfrage, die durch den Proxy läuft,
 * im Speicher und kürzt ihn bei 10 MB (`proxyClientMaxBodySize`) — ein Backup-Upload käme verstümmelt an (am
 * 2026-10-23 mit 15 MB nachgestellt). Während des Einspielens hält dort `getDeps` an. Keine Header-Bedingung
 * (`missing`): Next wertet den Matcher auch im Browser aus, und /projects lud sich damit endlos neu.
 */
export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico|admin/backup/upload|setup/import/upload|mcp).*)' }],
};
