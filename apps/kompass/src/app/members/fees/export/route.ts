import { isModuleEnabled, isoDay, paperDate } from '@kompass/core';
import { listFees } from '@kompass/module-members';
import { formatAmount } from '@kompass/module-finance/format';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { readAllPages } from '@/lib/read-all-pages';
import { optionalSession } from '@/lib/request-context';

const STATUS: Record<string, number> = { forbidden: 403, notFound: 404, unauthorized: 401 };
const STATES = ['open', 'partlyPaid', 'paid', 'waived', 'overdue'] as const;
const cell = (value: string) => (/[;"\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/** Beiträge eines Jahres als CSV (Handoff Mitglieder 2.4), mit den Filtern der Seite; Semikolon und BOM. */
export async function GET(request: Request): Promise<Response> {
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'members')) return new Response(null, { status: 404 });
  const params = new URL(request.url).searchParams;
  const year = Number(params.get('year'));
  const state = STATES.find((s) => s === params.get('state'));
  const text = (params.get('text') ?? '').trim().slice(0, 200);
  const typeId = params.get('type') ?? '';
  const result = await readAllPages((page) => listFees(deps, session.ctx, { year, ...(text ? { search: text } : {}), ...(state ? { status: [state] } : {}), ...(typeId ? { typeId } : {}), ...page }), (v) => v.items);
  if (!result.ok) return new Response(null, { status: STATUS[result.error.type] ?? 400 });
  const t = await getTranslations('members');
  const lines = [
    [t('export.number'), t('export.name'), t('export.period'), t('export.due'), t('export.amount'), t('export.paid'), t('export.open'), t('export.state')],
    ...result.value.map((f) => [f.memberNumber, f.name, f.period, paperDate(isoDay(f.dueOn)), formatAmount(f.amountCents), formatAmount(f.paidCents), formatAmount(f.openCents), t(`fees.state.${f.overdue ? 'overdue' : f.state}`)]),
  ];
  const csv = `﻿${lines.map((line) => line.map(cell).join(';')).join('\r\n')}\r\n`;
  const filename = `${t('export.feesFileName')}-${year}.csv`;
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'private, no-store' } });
}
