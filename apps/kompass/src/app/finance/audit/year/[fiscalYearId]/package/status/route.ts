import { hasPermission, isModuleEnabled } from '@kompass/core';
import { auditPackageRunStatus } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { auditPackageView } from '@/lib/finance/audit-package-view';
import { auditRefusal } from '@/lib/finance/audit-responses';
import { optionalSession } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * Stand des Prüfpaket-Laufs eines Jahres (Board 4e, `RunSteps`). Bewusst ein Route Handler und keine Server Action:
 * Next führt die Actions einer Seite nacheinander aus, eine Abfrage während des Laufs käme erst danach an die Reihe.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ fiscalYearId: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { fiscalYearId } = await ctx.params;
  const result = await auditPackageRunStatus(deps, session.ctx, { fiscalYearId });
  if (!result.ok) return auditRefusal(result.error);
  return Response.json(auditPackageView(result.value, await getTranslations(), hasPermission(session.ctx, 'finance.periodClose')), { headers: { 'cache-control': 'no-store' } });
}
