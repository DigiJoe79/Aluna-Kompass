import { isModuleEnabled } from '@kompass/core';
import { printAuditReport } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { attachment, auditRefusal } from '@/lib/finance/audit-responses';
import { optionalSession } from '@/lib/request-context';

/**
 * Den Prüfbericht drucken (Board 12d „Druckansicht“, „Drucken“). POST, weil der Druck protokolliert wird und den
 * Stand „gedruckt am …“ setzt — nie über einen Link oder Prefetch (Plan D1b).
 */
export async function POST(_request: Request, ctx: { params: Promise<{ reportId: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { reportId } = await ctx.params;
  const result = await printAuditReport(deps, session.ctx, { reportId });
  if (!result.ok) return auditRefusal(result.error);
  return attachment(result.value.bytes, result.value.filename, 'application/pdf');
}
