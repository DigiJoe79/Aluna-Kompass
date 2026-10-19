import { isModuleEnabled } from '@kompass/core';
import { runPrintPdf } from '@kompass/module-members';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

const STATUS: Record<string, number> = { forbidden: 403, notFound: 404, unauthorized: 401, conflict: 409 };

/** „Als PDF zum Drucken“ (Handoff 2b E3): die Briefe der Post-Gruppe eines Laufs als ein PDF. */
export async function GET(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'members')) return new Response(null, { status: 404 });
  const runRef = new URL(request.url).searchParams.get('runRef') ?? '';
  const result = await runPrintPdf(deps, session.ctx, { runRef });
  if (!result.ok) return new Response(null, { status: STATUS[result.error.type] ?? 400 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${result.value.fileName}"`, 'cache-control': 'private, no-store' },
  });
}
