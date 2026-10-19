import { isModuleEnabled } from '@kompass/core';
import { continueFeeRun } from '@kompass/module-members';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { conflictText } from '@/lib/error-text';
import { optionalSession } from '@/lib/request-context';

const NO_STORE = { 'cache-control': 'private, no-store' };

/**
 * Beitragslauf fortsetzen (Plan U1, wie `finance/donations/run/[id]/continue`): POST → höchstens fünf Beiträge bzw.
 * Mitteilungen unter dem Aufrufer, dann der Stand. Polling über einen Route Handler, weil Server Actions seriell laufen;
 * wer die Seite verlässt, setzt beim nächsten Besuch fort. Ein Fachfehler kommt als 409 mit `{ code, message }`.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'members')) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const result = await continueFeeRun(deps, session.ctx, { runId: id, max: 5 });
  if (!result.ok) {
    const error = result.error;
    if (error.type === 'conflict') return Response.json({ code: error.code, message: conflictText(error, await getTranslations()) }, { status: 409, headers: NO_STORE });
    return new Response(null, { status: error.type === 'forbidden' ? 403 : error.type === 'validation' ? 400 : error.type === 'notFound' ? 404 : 401 });
  }
  const v = result.value;
  return Response.json({ done: v.created, total: v.created + v.pending, notices: v.noticesIssued, finished: v.status === 'done' }, { headers: NO_STORE });
}
