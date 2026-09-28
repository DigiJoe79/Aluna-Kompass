import { isModuleEnabled } from '@kompass/core';
import { readExpenseReceipt } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

/**
 * Ein Dokument des Antrags (Beleg, Verzichtserklärung), immer über diesen Weg:
 * Die antragstellende Person liest ihre eigenen ohne `finance.read`, alle
 * anderen nur mit — die Prüfung steht im Dienst (`readExpenseReceipt`), nie
 * hier. Kein direkter Akten-Link: Niemand braucht dafür ein Recht der Akte.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string; documentId: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { id, documentId } = await ctx.params;
  const result = await readExpenseReceipt(deps, session.ctx, { claimId: id, documentId });
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
