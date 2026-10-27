import { NextResponse } from 'next/server';
import { removeDatedValue, setDatedValue } from '@kompass/module-finance';
import { getDeps, runtimeEnv } from '@/lib/deps';

/**
 * Nur im E2E-Lauf: einen datierten Wert des Finanzmoduls setzen (POST) oder die Überschreibung zurücknehmen (DELETE) —
 * wie `/__e2e/setting` für Einstellungen (E6a: „umsatzsteuerlich Unternehmer“ ist ein datierter Wert).
 */
async function handle(request: Request, remove: boolean): Promise<Response> {
  if (runtimeEnv().env !== 'test' || request.headers.get('x-e2e-token') !== process.env.E2E_RESET_TOKEN) {
    return new NextResponse(null, { status: 404 });
  }
  const { key, validFrom, value } = await request.json();
  const ctx = { userId: null, permissions: new Set(['finance.setup']), channel: 'system', apiTokenId: null, ipAddress: null, requestId: 'E2E' } as const;
  const result = remove ? await removeDatedValue(getDeps(), ctx, { key, validFrom }) : await setDatedValue(getDeps(), ctx, { key, validFrom, value });
  return NextResponse.json({ ok: result.ok });
}

export const POST = (request: Request) => handle(request, false);
export const DELETE = (request: Request) => handle(request, true);
