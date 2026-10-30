import { isModuleEnabled } from '@kompass/core';
import { printMinutesDraft } from '@kompass/module-governance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

const STATUS: Record<string, number> = { forbidden: 403, notFound: 404, unauthorized: 401, conflict: 409, validation: 400 };

/** Der Protokollentwurf als PDF (Schritt 4, Plan U1 Task 11) — neu gesetzt bei jedem Aufruf, nicht in der Akte. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'governance')) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const result = await printMinutesDraft(deps, session.ctx, { meetingId: id });
  if (!result.ok) return new Response(null, { status: STATUS[result.error.type] ?? 400 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${result.value.filename}"`, 'cache-control': 'private, no-store' },
  });
}
