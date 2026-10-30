import { isModuleEnabled } from '@kompass/core';
import { printInvitationPdf } from '@kompass/module-governance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

const STATUS: Record<string, number> = { forbidden: 403, notFound: 404, unauthorized: 401, conflict: 409 };

/** „Als PDF zum Drucken“: die Briefe der Post-Gruppe eines Einladungslaufs als ein PDF (Plan U1 Task 6). */
export async function GET(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'governance')) return new Response(null, { status: 404 });
  const runId = new URL(request.url).searchParams.get('runId') ?? '';
  const result = await printInvitationPdf(deps, session.ctx, { runId });
  if (!result.ok) return new Response(null, { status: STATUS[result.error.type] ?? 400 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${result.value.fileName}"`, 'cache-control': 'private, no-store' },
  });
}
