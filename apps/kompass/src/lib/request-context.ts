import 'server-only';
import { newId, resolveSession, revokeSession, type CallContext, type ResolvedSession } from '@kompass/core';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDeps } from './deps';

export const SESSION_COOKIE = 'kompass_session';

export async function requestMeta(): Promise<{ ipAddress: string | null; requestId: string }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return {
    ipAddress: forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : (h.get('x-real-ip') ?? null),
    requestId: h.get('x-request-id') ?? newId(),
  };
}

export async function optionalSession(): Promise<(ResolvedSession & { sessionId: string }) | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  const resolved = resolveSession(getDeps(), sessionId, await requestMeta());
  return resolved ? { ...resolved, sessionId } : null;
}

export interface SessionScope {
  deps: ReturnType<typeof getDeps>;
  ctx: CallContext;
  user: ResolvedSession['user'];
  sessionId: string;
}

export async function requireSession(opts: { allowPasswordChange?: boolean } = {}): Promise<SessionScope> {
  const session = await optionalSession();
  if (!session) redirect('/login');
  if (session.mustChangePassword && !opts.allowPasswordChange) redirect('/password');
  return { deps: getDeps(), ctx: session.ctx, user: session.user, sessionId: session.sessionId };
}

export async function setSessionCookie(sessionId: string, expiresAt: string): Promise<void> {
  const store = await cookies();
  // secure: false — die App läuft ausschließlich im LAN ohne TLS (Spec, Abschnitt 3 und 8).
  store.set({ name: SESSION_COOKIE, value: sessionId, httpOnly: true, sameSite: 'lax', secure: false, path: '/', expires: new Date(expiresAt) });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (sessionId) revokeSession(getDeps(), sessionId);
  store.delete(SESSION_COOKIE);
}
