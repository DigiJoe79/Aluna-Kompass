import 'server-only';
import type { CallContext, Deps } from '@kompass/core';
import { currentAuditYear, listFiscalYears, listMyAuditYears } from '@kompass/module-finance';
import { defaultAuditYearId } from './audit-overview';

export interface AuditYearChoice {
  years: { id: string; designation: string; endsOn: string; status: string }[];
  /** Die Jahre, die der Aufrufer selbst „in Kompass“ prüft, neueste zuerst. */
  mine: { fiscalYearId: string; designation: string }[];
  year: { id: string; designation: string; endsOn: string; status: string } | null;
}

/** Das Jahr einer Seite der Kassenprüfung: `?year=`, sonst die Vorgabe (`defaultAuditYearId`). */
export async function resolveAuditYear(deps: Deps, ctx: CallContext, queryYear: string | undefined): Promise<AuditYearChoice> {
  const listed = await listFiscalYears(deps, ctx);
  const mineRes = await listMyAuditYears(deps, ctx, {});
  const mine = mineRes.ok ? mineRes.value.years.map((y) => ({ fiscalYearId: y.fiscalYearId, designation: y.designation })) : [];
  const years = listed.ok ? listed.value.map((y) => ({ id: y.id, designation: y.designation, endsOn: y.endsOn, status: y.status })) : [];
  if (years.some((y) => y.id === queryYear)) return { years, mine, year: years.find((y) => y.id === queryYear)! };
  const currentRes = await currentAuditYear(deps, ctx, {});
  const current = currentRes.ok ? currentRes.value : null;
  const id = defaultAuditYearId(years, current?.fiscalYearId ?? null, mine.map((y) => y.fiscalYearId));
  return { years, mine, year: years.find((y) => y.id === id) ?? null };
}
