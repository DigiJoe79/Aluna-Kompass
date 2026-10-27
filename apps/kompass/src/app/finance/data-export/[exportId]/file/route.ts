import { isModuleEnabled } from '@kompass/core';
import { readDataExportFile } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import { toActionState } from '@/lib/actions';
import { getDeps } from '@/lib/deps';
import { attachment, auditRefusal } from '@/lib/finance/audit-responses';
import { optionalSession } from '@/lib/request-context';

/**
 * Das ZIP eines Datenexports. Herunterladen wird protokolliert (wie ein Backup); nach 30 Tagen ist die Datei weg —
 * dann 410 mit `{ code, message }`, damit die Oberfläche den Satz über dem Knopf zeigt.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ exportId: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { exportId } = await ctx.params;
  const result = await readDataExportFile(deps, session.ctx, { exportId });
  if (!result.ok) {
    if (result.error.type === 'conflict' && result.error.code === 'dataExportExpired') {
      const state = toActionState(result, await getTranslations());
      return Response.json({ code: result.error.code, message: state.status === 'error' ? state.message : '' }, { status: 410, headers: { 'cache-control': 'private, no-store' } });
    }
    return auditRefusal(result.error);
  }
  return attachment(result.value.bytes, result.value.filename, 'application/zip');
}
