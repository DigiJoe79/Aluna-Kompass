import 'server-only';
import { userNamesFor, type AppDeps, type CallContext } from '@kompass/core';
import { getDocumentRecord } from '@kompass/module-dms';
import { getAuditSection, getEntry, type AuditorView, type AuditRemarkView } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import type { RemarkThreadItem } from '@/components/remark-thread';
import { dateFormatOf } from '@/lib/date-format';

/** Anker des Verlaufs „Vermerke zum Jahr“ auf der Übersicht. */
export const YEAR_REMARKS_ANCHOR = 'vermerke-jahr';
/** Anker des Verlaufs „Vermerke zu Beschlüssen“ auf Abschnitt 9 (G-30). */
export const RESOLUTION_REMARKS_ANCHOR = 'vermerke-beschluesse';

/** Ein Vermerk als Zeile der Liste auf der Übersicht (Board 4a: Vermerk · An · Von · Zustand). */
export interface RemarkListRow {
  id: string;
  kindLabel: string;
  text: string;
  state: AuditRemarkView['state'];
  stateLabel: string;
  targetLabel: string;
  targetHref: string | null;
  /**
   * Sprung auf derselben Seite, nur für die Liste der Übersicht (Vermerk zum Jahr: der Verlauf unter der Liste, Designer
   * Runde 4) — er behält die Filter der Adresse. Andere Seiten (Prüfbericht) nehmen `targetHref`.
   */
  inPageHref: string | null;
  from: string;
  via: string | null;
}

export interface RemarkViews {
  items: RemarkThreadItem[];
  rows: RemarkListRow[];
}

/**
 * Vermerke für die Oberfläche (N3): Namen statt IDs, Art und Zustand beschriftet, „<Prüferin>, eingetragen von
 * <Prüfer>“ für Papier-Prüfer, und das Ziel als Link — Buchung mit Rückweg, Bericht, Jahr auf der Übersicht.
 */
export async function remarkViews(deps: AppDeps, ctx: CallContext, remarks: readonly AuditRemarkView[], opts: { auditors: readonly Pick<AuditorView, 'id' | 'contactName' | 'mode'>[]; fiscalYearId: string; designation: string; here?: { type: AuditRemarkView['target']['type']; id: string } }): Promise<RemarkViews> {
  const t = await getTranslations('finance.audit.remarks');
  const tReports = await getTranslations('finance.reports');
  const fmt = dateFormatOf(deps);
  const names = userNamesFor(deps, remarks.flatMap((r) => [r.enteredByUserId, ...r.posts.map((p) => p.byUserId)]));
  const auditor = (id: string) => opts.auditors.find((a) => a.id === id);
  const year = encodeURIComponent(opts.fiscalYearId);

  const numbers = new Map<string, string>();
  for (const id of new Set(remarks.filter((r) => r.target.type === 'entry').map((r) => r.target.id))) {
    const entry = await getEntry(deps, ctx, { id });
    numbers.set(id, entry.ok ? (entry.value.number ?? '') : '');
  }
  const documents = new Map<string, string>();
  for (const id of new Set(remarks.filter((r) => r.target.type === 'document').map((r) => r.target.id))) {
    const record = await getDocumentRecord(deps, ctx, id);
    if (record.ok && record.value.number) documents.set(id, record.value.number);
  }
  // Beschlüsse (Abschnitt 9, G-30): Nummer aus dem Abschnitt, der Link führt dorthin (Designer 2026-10-29).
  const resolutionNumbers = new Map<string, string>();
  if (remarks.some((r) => r.target.type === 'resolution')) {
    const section = await getAuditSection(deps, ctx, { fiscalYearId: opts.fiscalYearId, section: 'resolutions', limit: 200 });
    for (const row of section.ok ? section.value.rows : []) if (row.resolutionId) resolutionNumbers.set(row.resolutionId, String(row.labelParams.number ?? ''));
  }
  const target = (r: AuditRemarkView): { label: string; href: string | null } => {
    switch (r.target.type) {
      case 'entry':
        return { label: t('target.entry', { number: numbers.get(r.target.id) ?? '' }), href: `/finance/entries/${r.target.id}?from=audit&section=journal&year=${year}` };
      case 'document': {
        const number = documents.get(r.target.id);
        return { label: number ? t('target.document', { number }) : t('target.documentPlain'), href: `/dms/${r.target.id}` };
      }
      case 'report':
        return { label: t('target.report', { report: tReports.has(`${r.target.id}.title`) ? tReports(`${r.target.id}.title`) : r.target.id }), href: `/finance/reports/${r.target.id}?year=${year}` };
      case 'year':
        return { label: t('target.year', { year: opts.designation }), href: `/finance/audit?year=${year}#${YEAR_REMARKS_ANCHOR}` };
      case 'resolution':
        return { label: t('target.resolution', { number: resolutionNumbers.get(r.target.id) ?? '' }), href: `/finance/audit/resolutions?year=${year}#${RESOLUTION_REMARKS_ANCHOR}` };
    }
  };
  const author = (r: AuditRemarkView) => {
    const a = auditor(r.authorAuditorId);
    const by = names.get(r.enteredByUserId) ?? '';
    return a?.mode === 'paper' ? { name: a.contactName, via: by } : { name: a?.contactName || by, via: null };
  };

  const items: RemarkThreadItem[] = remarks.map((r) => {
    const { name, via } = author(r);
    return {
      id: r.id,
      kindLabel: t(`kind.${r.kind}`),
      state: r.state,
      stateLabel: t(`state.${r.state}`),
      text: r.text,
      ...(opts.here && (opts.here.type !== r.target.type || opts.here.id !== r.target.id) ? { target: t('targetLine', { target: target(r).label }) } : {}),
      byline: t('byline', { name: via ? t('onBehalf', { name, by: via }) : name, date: fmt.date(r.createdAt) }),
      posts: r.posts.map((p) => ({ id: p.id, byline: t('byline', { name: names.get(p.byUserId) ?? '', date: fmt.date(p.at) }), text: p.text })),
    };
  });
  const rows: RemarkListRow[] = remarks.map((r) => {
    const { name, via } = author(r);
    const { label, href } = target(r);
    const inPageHref = r.target.type === 'year' ? `#${YEAR_REMARKS_ANCHOR}` : null;
    return { id: r.id, kindLabel: t(`kind.${r.kind}`), text: r.text, state: r.state, stateLabel: t(`state.${r.state}`), targetLabel: label, targetHref: href, inPageHref, from: name, via: via ? t('enteredBy', { by: via }) : null };
  });
  return { items, rows };
}
