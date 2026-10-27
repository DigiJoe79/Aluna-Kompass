import 'server-only';
import { hasPermission, type AppDeps, type CallContext } from '@kompass/core';
import { getAuditStatus, getEntryAuditState, listAuditors, listAuditRemarks, type AuditSampleState } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import type { RemarkThreadItem } from '@/components/remark-thread';
import type { RemarkWriterProps } from '@/app/(shell)/finance/audit/remark-writer';
import { remarkViews } from './audit-remarks';

export interface EntryAudit extends TargetAuditBase {
  fiscalYearId: string;
  /** Prüferansicht: eigene Stichprobe an der Buchung (N4, Zeile „Als Stichprobe geprüft“). */
  sample: { checked: boolean; state: AuditSampleState; fixed: boolean } | null;
}

interface TargetAuditBase {
  items: RemarkThreadItem[];
  /** „Vermerk schreiben …“ nur für Prüfer des Jahres. */
  writer: RemarkWriterProps | null;
  canAnswer: boolean;
  canAudit: boolean;
}

/**
 * Was die Buchungsseite zur Kassenprüfung zeigt (Board 4c, 9b): die eigene Stichprobe und die Vermerke — an der Buchung
 * und an ihren Belegen. `null`, wenn die Buchung in keinem Prüfjahr liegt oder der Aufrufer die Prüfung nicht lesen darf.
 */
export async function loadEntryAudit(deps: AppDeps, ctx: CallContext, entry: { id: string; number: string | null; text: string; voucherIds: string[]; designation: string }): Promise<EntryAudit | null> {
  if (!hasPermission(ctx, 'finance.read') && !hasPermission(ctx, 'finance.audit')) return null;
  const state = await getEntryAuditState(deps, ctx, { entryId: entry.id });
  if (!state.ok || !state.value) return null;
  const { fiscalYearId, myAuditorId } = state.value;
  const auditorsRes = await listAuditors(deps, ctx, { fiscalYearId });
  const auditors = auditorsRes.ok ? auditorsRes.value.auditors : [];
  const onVouchers = [];
  for (const documentId of new Set(entry.voucherIds)) {
    const listed = await listAuditRemarks(deps, ctx, { fiscalYearId, targetType: 'document', targetId: documentId });
    if (listed.ok) onVouchers.push(...listed.value.remarks);
  }
  const remarks = [...state.value.remarks, ...onVouchers].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const views = await remarkViews(deps, ctx, remarks, { auditors, fiscalYearId, designation: entry.designation, here: { type: 'entry', id: entry.id } });
  const t = await getTranslations('finance.audit.remarks');
  const me = myAuditorId ? (auditors.find((a) => a.id === myAuditorId)?.contactName ?? '') : '';
  return {
    fiscalYearId,
    sample: myAuditorId ? { checked: state.value.sampleState === 'sampled', state: state.value.sampleState, fixed: await workFixed(deps, ctx, fiscalYearId) } : null,
    items: views.items,
    writer: myAuditorId ? { fiscalYearId, target: { type: 'entry', id: entry.id, label: entry.number ? `${t('target.entry', { number: entry.number })} · ${entry.text}` : entry.text }, me, paperAuditors: auditors.filter((a) => a.mode === 'paper').map((a) => ({ id: a.id, name: a.contactName })), treasurerName: auditorsRes.ok ? auditorsRes.value.treasurerName : null } : null,
    canAnswer: hasPermission(ctx, 'finance.entriesWrite'),
    canAudit: myAuditorId !== null,
  };
}

/** Prüfbericht abgelegt: Stichproben stehen fest — aus dem Status des Jahres, derselben Quelle wie die Dienste. */
async function workFixed(deps: AppDeps, ctx: CallContext, fiscalYearId: string): Promise<boolean> {
  const status = await getAuditStatus(deps, ctx, { fiscalYearId });
  return status.ok && status.value.workFixedSince !== null;
}

export type TargetAudit = TargetAuditBase;

/**
 * Vermerke an einem Bericht des Katalogs für ein Jahr (Plan D1b Task 6: Einstieg „am Bericht“). `null`, wenn der
 * Aufrufer die Prüfung nicht lesen darf oder für das Jahr niemand prüft und es keine Vermerke gibt.
 */
export async function loadReportAudit(deps: AppDeps, ctx: CallContext, report: { key: string; title: string }, year: { id: string; designation: string }): Promise<TargetAudit | null> {
  if (!hasPermission(ctx, 'finance.read') && !hasPermission(ctx, 'finance.audit')) return null;
  const status = await getAuditStatus(deps, ctx, { fiscalYearId: year.id });
  if (!status.ok || status.value.yearStatus !== 'closed') return null;
  const listed = await listAuditRemarks(deps, ctx, { fiscalYearId: year.id, targetType: 'report', targetId: report.key });
  const remarks = listed.ok ? listed.value.remarks : [];
  const myAuditorId = status.value.me.auditorId;
  if (remarks.length === 0 && !myAuditorId) return null;
  const auditorsRes = await listAuditors(deps, ctx, { fiscalYearId: year.id });
  const auditors = auditorsRes.ok ? auditorsRes.value.auditors : [];
  const views = await remarkViews(deps, ctx, remarks, { auditors, fiscalYearId: year.id, designation: year.designation, here: { type: 'report', id: report.key } });
  const me = myAuditorId ? (auditors.find((a) => a.id === myAuditorId)?.contactName ?? '') : '';
  return {
    items: views.items,
    writer: myAuditorId ? { fiscalYearId: year.id, target: { type: 'report', id: report.key, label: report.title }, me, paperAuditors: auditors.filter((a) => a.mode === 'paper').map((a) => ({ id: a.id, name: a.contactName })), treasurerName: auditorsRes.ok ? auditorsRes.value.treasurerName : null } : null,
    canAnswer: hasPermission(ctx, 'finance.entriesWrite'),
    canAudit: myAuditorId !== null,
  };
}
