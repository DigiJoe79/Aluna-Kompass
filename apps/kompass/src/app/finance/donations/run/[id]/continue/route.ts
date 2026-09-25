import { isModuleEnabled } from '@kompass/core';
import { continueConfirmationRun } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

const NO_STORE = { 'cache-control': 'private, no-store' };

/**
 * Serienlauf fortsetzen (F6b, Spec 10.4): POST → höchstens fünf offene Posten
 * ausstellen, unter dem Aufrufer, und `{ counts, finishedAt }` zurückgeben.
 * Die Seite ruft wiederholt, bis `counts.pending` 0 ist — kein Hintergrund im
 * Server; wer die Seite verlässt, setzt beim nächsten Besuch fort.
 * `finance.donationsIssue`, nur am Bildschirm. Ein Fachfehler (Lauf schon
 * fertig, nur ein Mensch) kommt als 409 mit `{ code, message }` zurück.
 * Polling läuft über einen Route Handler, nicht über eine Server Action:
 * Server Actions laufen seriell.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const result = await continueConfirmationRun(deps, session.ctx, { runId: id, max: 5 });
  if (!result.ok) {
    const error = result.error;
    if (error.type === 'conflict') return Response.json({ code: error.code, message: error.message }, { status: 409, headers: NO_STORE });
    return new Response(null, { status: error.type === 'forbidden' ? 403 : error.type === 'validation' ? 400 : error.type === 'notFound' ? 404 : 401 });
  }
  return Response.json({ counts: result.value.counts, finishedAt: result.value.finishedAt }, { headers: NO_STORE });
}
