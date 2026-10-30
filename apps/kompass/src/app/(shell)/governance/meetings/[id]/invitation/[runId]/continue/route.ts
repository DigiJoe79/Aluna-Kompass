import { isModuleEnabled } from '@kompass/core';
import { continueInvitationRun } from '@kompass/module-governance';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { conflictText } from '@/lib/error-text';
import { optionalSession } from '@/lib/request-context';

const NO_STORE = { 'cache-control': 'private, no-store' };

/** Einladungslauf fortsetzen (Plan U1 Task 6, wie der Mahnlauf): höchstens zehn Briefe je Aufruf. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string; runId: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'governance')) return new Response(null, { status: 404 });
  const { runId } = await ctx.params;
  const result = await continueInvitationRun(deps, session.ctx, { runId, max: 10 });
  if (!result.ok) {
    const error = result.error;
    // Schon fertig (zweites Fenster): wie ein fertiger Lauf antworten, die Seite baut den Versand auf.
    if (error.type === 'conflict' && error.code === 'invitationRunDone') return Response.json({ done: 0, total: 0, finished: true }, { headers: NO_STORE });
    if (error.type === 'conflict') return Response.json({ code: error.code, message: conflictText(error, await getTranslations()) }, { status: 409, headers: NO_STORE });
    return new Response(null, { status: error.type === 'forbidden' ? 403 : error.type === 'validation' ? 400 : error.type === 'notFound' ? 404 : 401 });
  }
  const run = result.value;
  return Response.json({ done: run.issued, total: run.issued + run.pending, finished: run.status === 'done' }, { headers: NO_STORE });
}
