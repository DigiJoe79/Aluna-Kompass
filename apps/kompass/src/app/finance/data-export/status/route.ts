import { isModuleEnabled } from '@kompass/core';
import { dataExportRunStatus } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { auditRefusal } from '@/lib/finance/audit-responses';
import { dataExportRunView } from '@/lib/finance/data-export-view';
import { optionalSession } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

/**
 * Stand des Datenexports (Board 13f, `RunSteps`). Bewusst ein Route Handler und keine Server Action: Next führt die
 * Actions einer Seite nacheinander aus, eine Abfrage während des Laufs käme erst danach an die Reihe.
 */
export async function GET(): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const result = await dataExportRunStatus(deps, session.ctx, {});
  if (!result.ok) return auditRefusal(result.error);
  return Response.json(dataExportRunView(result.value, await getTranslations()), { headers: { 'cache-control': 'no-store' } });
}
