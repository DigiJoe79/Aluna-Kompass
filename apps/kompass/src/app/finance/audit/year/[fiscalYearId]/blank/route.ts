import { isModuleEnabled } from '@kompass/core';
import { printAuditReportBlank } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { attachment, auditRefusal } from '@/lib/finance/audit-responses';
import { optionalSession } from '@/lib/request-context';

/**
 * Den Vordruck des Prüfberichts drucken (Board 12e B). POST: Beim ersten Mal legt der Dienst den Bericht an, und jeder
 * Druck wird protokolliert — nie über einen Link oder Prefetch (Plan D1b).
 */
export async function POST(_request: Request, ctx: { params: Promise<{ fiscalYearId: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { fiscalYearId } = await ctx.params;
  const result = await printAuditReportBlank(deps, session.ctx, { fiscalYearId });
  if (!result.ok) return auditRefusal(result.error);
  return attachment(result.value.bytes, result.value.filename, 'application/pdf');
}
