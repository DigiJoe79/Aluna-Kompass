import 'server-only';
import { newId, resolveSession, revokeSession, type CallContext, type ResolvedSession } from '@kompass/core';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { depsReady, enterRequest, getDeps, leaveRequest } from './deps';

export const SESSION_COOKIE = 'kompass_session';

export async function requestMeta(): Promise<{ ipAddress: string | null; requestId: string }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return {
    ipAddress: forwarded ? (forwarded.split(',')[0]?.trim() ?? null) : (h.get('x-real-ip') ?? null),
    requestId: h.get('x-request-id') ?? newId(),
  };
}

/**
 * Diese Anfrage mitzählen, bis ihre Antwort steht.
 *
 * `depsReady()` hält auf, wer während eines Resets ankommt; das hier hält den
 * Reset auf, solange jemand drin ist. Ohne das verlor eine Anfrage, die
 * sekundenlang rechnet, die Datenbank unter sich — `previewDraft` meldete
 * `The database connection is not open`.
 *
 * `after()` läuft laut Next auch dann, wenn die Antwort nicht sauber
 * durchkommt: bei einer geworfenen Ausnahme ebenso wie bei `notFound()` und
 * `redirect()` — und `requireSession()` leitet um. Mehrfaches Anmelden in
 * derselben Anfrage (Layout und Seite) bucht über je ein `after()` wieder ab
 * und bleibt im Gleichgewicht.
 */
function holdUntilResponseSent(): void {
  enterRequest();
  try {
    after(() => leaveRequest());
  } catch {
    // Ausserhalb einer Anfrage — Skripte, Tests — gibt es nichts, wonach
    // abgemeldet werden könnte. Dann sofort, statt den Zähler stehenzulassen.
    leaveRequest();
  }
}

export async function optionalSession(): Promise<(ResolvedSession & { sessionId: string }) | null> {
  // Läuft gerade ein E2E-Reset, hier warten statt in ihn hineinzulaufen.
  await depsReady();
  holdUntilResponseSent();
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
