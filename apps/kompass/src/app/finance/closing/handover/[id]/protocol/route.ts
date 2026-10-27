import { isModuleEnabled } from '@kompass/core';
import { printHandoverProtocol } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { attachment, auditRefusal } from '@/lib/finance/audit-responses';
import { optionalSession } from '@/lib/request-context';

/**
 * Das Übergabeprotokoll zum Unterschreiben (Board 13e, „Zum Unterschreiben drucken“). Lesen mit `finance.read`; der
 * Druck schreibt nichts, deshalb GET wie die Dateien des Prüfpakets. Antworten wie die Routen der Kassenprüfung.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { id } = await ctx.params;
  const result = await printHandoverProtocol(deps, session.ctx, { id });
  if (!result.ok) return auditRefusal(result.error);
  return attachment(result.value.bytes, result.value.filename, 'application/pdf');
}
