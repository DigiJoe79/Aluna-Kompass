import { isModuleEnabled } from '@kompass/core';
import { readAuditPackageFile } from '@kompass/module-finance';
import { getDeps } from '@/lib/deps';
import { attachment, auditRefusal } from '@/lib/finance/audit-responses';
import { optionalSession } from '@/lib/request-context';

const FILES = ['folder', 'archive', 'reports'] as const;

/** Eine Ergebnisdatei des Prüfpakets (Mappe, Belege als ZIP, Prüffassungen) — lesen ohne Nebenwirkung. */
export async function GET(_request: Request, ctx: { params: Promise<{ fiscalYearId: string; file: string }> }): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'finance')) return new Response(null, { status: 404 });
  const { fiscalYearId, file } = await ctx.params;
  if (!(FILES as readonly string[]).includes(file)) return new Response(null, { status: 404 });
  const result = await readAuditPackageFile(deps, session.ctx, { fiscalYearId, file: file as (typeof FILES)[number] });
  if (!result.ok) return auditRefusal(result.error);
  return attachment(result.value.bytes, result.value.filename, result.value.mimeType);
}
