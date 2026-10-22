import { isModuleEnabled, isoDay, paperDate, todayIn } from '@kompass/core';
import { exportMembers, type MembershipStatus } from '@kompass/module-members';
import { getTranslations } from 'next-intl/server';
import { getDeps } from '@/lib/deps';
import { optionalSession } from '@/lib/request-context';

const STATUS: Record<string, number> = { forbidden: 403, notFound: 404, unauthorized: 401 };
const VIEW_STATUSES: Record<string, MembershipStatus[]> = { members: ['active', 'ending'], applications: ['applied'], left: ['ended'] };

/** Ein Feld der CSV: in Anführungszeichen, wenn Trenner, Zeilenumbruch oder Anführungszeichen darin stehen. */
const cell = (value: string) => (/[;"\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/**
 * Mitgliederliste als CSV (Spec Mitglieder § 3.4, Handoff 2.1): die Liste wie auf dem Bildschirm — Reiter, Suche und
 * Art aus der Adresse —, ohne Anschrift, Bankdaten und Beiträge. Semikolon und BOM, damit eine Tabellenkalkulation
 * sie ohne Assistent öffnet. Das Protokoll nennt nur die Zahl der Zeilen (im Dienst).
 *
 * Ein Vorabladen des Links (Next.js, Header `next-router-prefetch`) erzeugt keine Datei und keinen Protokolleintrag:
 * Sonst stünde bei jedem Filterwechsel ein „Export“ im Protokoll (2026-10-20, elf Einträge ohne Download).
 */
export async function GET(request: Request): Promise<Response> {
  if (request.headers.get('next-router-prefetch')) return new Response(null, { status: 204 });
  const session = await optionalSession();
  if (!session) return new Response(null, { status: 401 });
  const deps = getDeps();
  if (!isModuleEnabled(deps, 'members')) return new Response(null, { status: 404 });
  const params = new URL(request.url).searchParams;
  const view = params.get('view') ?? 'members';
  const text = (params.get('text') ?? '').trim();
  const typeId = view === 'applications' ? '' : (params.get('type') ?? '');
  const status = view === 'applications' && params.get('rejected') === '1' ? [...VIEW_STATUSES.applications!, 'rejected' as const] : (VIEW_STATUSES[view] ?? VIEW_STATUSES.members!);
  const result = await exportMembers(deps, session.ctx, { status, ...(text ? { search: text } : {}), ...(typeId ? { typeId } : {}) });
  if (!result.ok) return new Response(null, { status: STATUS[result.error.type] ?? 400 });

  const t = await getTranslations('members.export');
  const tp = await getTranslations('members.payment');
  const yesNo = (v: boolean) => (v ? t('yes') : t('no'));
  const lines = [
    [t('number'), t('name'), t('type'), t('votingRight'), t('joinedOn'), t('endsOn'), t('payment')],
    ...result.value.rows.map((r) => [r.memberNumber ?? '', r.name, r.type, yesNo(r.hasVotingRight), r.joinedOn ? paperDate(isoDay(r.joinedOn)) : '', r.endsOn ? paperDate(isoDay(r.endsOn)) : '', r.paymentMethod ? tp(r.paymentMethod) : '']),
  ];
  const csv = `﻿${lines.map((line) => line.map(cell).join(';')).join('\r\n')}\r\n`;
  const filename = `${t('fileName')}-${todayIn(deps)}.csv`;
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'private, no-store',
    },
  });
}
