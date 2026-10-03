import { NextResponse } from 'next/server';
import { runtimeEnv } from '@/lib/deps';

/**
 * Nur für E2E: hält den Export der Webseite für `ms` Millisekunden fest, damit
 * ein Test einen Lauf abbrechen kann, der warm in unter einer Sekunde fertig
 * wäre (`siteTestBrake` im Modul). `ms: 0` löst die Bremse.
 */
export async function POST(request: Request): Promise<Response> {
  if (runtimeEnv().env !== 'test' || request.headers.get('x-e2e-token') !== process.env.E2E_RESET_TOKEN) {
    return new NextResponse(null, { status: 404 });
  }
  const { ms } = (await request.json()) as { ms?: unknown };
  (globalThis as { __kompassSiteTestBrakeMs?: number }).__kompassSiteTestBrakeMs = Math.max(0, Number(ms) || 0);
  return NextResponse.json({ ok: true });
}
