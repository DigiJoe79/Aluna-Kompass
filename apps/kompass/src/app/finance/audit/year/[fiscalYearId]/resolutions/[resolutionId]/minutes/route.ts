import { isModuleEnabled } from '@kompass/core';
import { readAuditResolutionMinutes } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/**
 * Das Protokoll eines Beschlusses aus Abschnitt 9 der Kassenprüfung (G-30) — wie der Beleg nie über einen direkten
 * Akten-Link: Die Prüferin liest es über `finance.audit`, ohne `governance.read` und ohne `dms.view`; Recht und Bezug
 * prüft die Akte.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ fiscalYearId: string; resolutionId: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { fiscalYearId, resolutionId } = await ctx.params;
  const result = await readAuditResolutionMinutes(deps, session.ctx, { fiscalYearId, resolutionId });
  if (!result.ok) return new Response(null, { status: 404 });
  return new Response(Buffer.from(result.value.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${result.value.filename}"`,
      'cache-control': 'private, no-store',
      'content-length': String(result.value.bytes.byteLength),
    },
  });
}
