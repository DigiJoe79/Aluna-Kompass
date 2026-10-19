import { isModuleEnabled } from '@kompass/core';
import { continueDunningRun, getDunningRun } from '@kompass/module-members';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { conflictText } from '@/lib/error-text';
import { optionalSession } from '@/lib/request-context';

const NO_STORE = { 'cache-control': 'private, no-store' };

/** Mahnlauf fortsetzen (Plan U1): höchstens fünf Briefe je Aufruf, dann erzeugt und ausstehend. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'members')) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const result = await continueDunningRun(deps, session.ctx, { runId: id, max: 5 });
  if (!result.ok) {
    const error = result.error;
    if (error.type === 'conflict') return Response.json({ code: error.code, message: conflictText(error, await getTranslations()) }, { status: 409, headers: NO_STORE });
    return new Response(null, { status: error.type === 'forbidden' ? 403 : error.type === 'validation' ? 400 : error.type === 'notFound' ? 404 : 401 });
  }
  const detail = await getDunningRun(deps, session.ctx, id);
  const remaining = detail.ok ? detail.value.remaining : 0;
  return Response.json({ done: result.value.issued, total: result.value.issued + remaining, finished: result.value.status === 'done' }, { headers: NO_STORE });
}
