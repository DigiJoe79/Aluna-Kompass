import { NextResponse } from 'next/server';
import { login } from '@kompass/core';
import { getDeps, runtimeEnv } from '@/lib/deps';
import { requestMeta, setSessionCookie } from '@/lib/request-context';

/**
 * Anmeldung ohne Formular, nur für E2E: derselbe Kern-`login` wie `loginAction` (Protokoll, Sperre, Drossel), nur
 * ohne die Maske. Über die Oberfläche kostete jede Anmeldung rund eine Sekunde, bei ~500 Fällen ein Viertel der Suite
 * (Messung 2026-10-22). Die Maske selbst prüft `e2e/auth.spec.ts`.
 */
export async function POST(request: Request): Promise<Response> {
  if (runtimeEnv().env !== 'test' || request.headers.get('x-e2e-token') !== process.env.E2E_RESET_TOKEN) {
    return new NextResponse(null, { status: 404 });
  }
  const { email, password } = await request.json();
  const result = await login(getDeps(), { email, password, ...(await requestMeta()) });
  if (!result.ok) return NextResponse.json({ ok: false }, { status: 401 });
  await setSessionCookie(result.value.sessionId, result.value.expiresAt);
  return NextResponse.json({ ok: true, mustChangePassword: result.value.mustChangePassword });
}
