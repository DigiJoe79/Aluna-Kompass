'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useRef, useState } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { SubmitButton } from '@/components/forms/submit-button';
import { RequirementList, type RequirementListItem } from '@/components/requirement-list';
import { Section } from '@/components/section';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button, buttonVariants } from '@/components/ui/button';
import type { AuditPackageView } from '@/lib/finance/audit-package-view';
import { idleState } from '@/lib/actions';
import { useFileDownload } from '@/lib/use-file-download';
import { joinNames } from './audit-header';
import { writeAuditReportAction } from './actions';
import { PackageRunCard } from './package-run-card';
import { ScanDialog } from './scan-dialog';

export interface ReportLine {
  kind: 'report' | 'followUp';
  state: 'draft' | 'readyToSign' | 'filed';
  origin: 'kompass' | 'blank';
  editorNames: string[];
  lastEditedAt: string | null;
  lastPrintedAt: string | null;
  readyAt: string | null;
  filedAt: string | null;
  scansFiled: number;
  scansExpected: number;
  documents: { id: string; number: string | null }[];
  href: string;
}

export interface ReportSectionData {
  yearId: string;
  designation: string;
  auditorView: boolean;
  canManage: boolean;
  /** Bearbeiter oder `finance.periodClose`: darf den Scan ablegen. */
  canFile: boolean;
  cash: { done: boolean; keepers: string[] };
  remarksOpen: number;
  reviewed: number;
  total: number;
  lines: ReportLine[];
  scanTarget: { reportId: string } | { fiscalYearId: string } | null;
  scanAuditors: { id: string; name: string }[];
  onlyPaper: boolean;
  /** Nachprüfung offen und noch kein Nachtrag: der Weg dorthin. */
  followUpHref: string | null;
  /** Eine Nachprüfung wartet auf ihren Nachtrag — für alle, auch ohne Recht, ihn zu schreiben. */
  followUpOpen: boolean;
  /** Nachprüfung ohne geänderte Buchung (260/261 Telefon): Der Prüfbericht gilt weiter, ein Nachtrag ist nicht nötig. */
  followUpUnchanged?: boolean;
  /** Bearbeiter, Jahr abgeschlossen, noch kein Bericht: „Prüfbericht schreiben“ legt den Entwurf an und öffnet ihn. */
  writeDraft: boolean;
  packageRun: AuditPackageView | null;
}

/**
 * Abschnitt „Prüfbericht“ der Übersicht (Board 4e, 12e A–C): was vor dem Ablegen erledigt sein sollte als
 * `RequirementList` — die Kassenzählung zuerst —, darunter je Bericht und Nachtrag eine Zeile mit Stand und Weg. Primär
 * „Scan ablegen …“, sobald einer zum Unterschreiben bereitliegt. Prüft niemand in Kompass, der Vordruck. Darunter das
 * Prüfpaket als Lauf.
 */
export function ReportSection({ data }: { data: ReportSectionData }) {
  const t = useTranslations('finance.audit.reportSection');
  const tAudit = useTranslations('finance.audit');
  const tReq = useTranslations('common.requirements');
  const fmt = useDateFormat();
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const scanRef = useRef<HTMLButtonElement>(null);
  const blank = useFileDownload({ forbidden: tAudit('downloadRefused.forbidden'), notFound: tAudit('downloadRefused.notFound'), failed: tAudit('downloadRefused.failed') });

  const item = (key: string, done: boolean, title: string, extra: Partial<RequirementListItem> = {}): RequirementListItem => ({
    // Ein Punkt ohne eigenen Weg zeigt nur sein Zeichen: `canSelf` mit `href: null` (keine Marke ohne Wort).
    key, title, done, blocked: false, canSelf: true, canDoNames: [], canDoText: '', href: null, actionLabel: '', doneLabel: t('done'), ...extra,
  });
  const keepers = joinNames(data.cash.keepers, t('or'));
  const items: RequirementListItem[] = [
    item('cash', data.cash.done, data.cash.done ? t('cashDone') : t('cashOpen'), data.auditorView ? { detail: data.cash.done || !keepers ? undefined : t('cashAsk', { names: keepers }) } : { href: '/finance/cash', actionLabel: t('cashAction') }),
    item('remarks', data.remarksOpen === 0, data.remarksOpen === 0 ? t('remarksDone') : t('remarksOpen', { count: data.remarksOpen })),
    item('sections', data.reviewed >= data.total, data.reviewed >= data.total ? t('sectionsDone') : t('sectionsOpen', { reviewed: data.reviewed, total: data.total })),
  ];

  // Abgelegt: jeder Bericht liegt, und keine Nachprüfung wartet auf ihren Nachtrag.
  // Eine Nachprüfung ohne geänderte Buchung braucht keinen Nachtrag: wie abgelegt (Schritt 10 bestätigt nur).
  const filed = data.lines.length > 0 && data.lines.every((l) => l.state === 'filed') && (!data.followUpOpen || Boolean(data.followUpUnchanged));

  const lineText = (l: ReportLine) => {
    if (l.state === 'filed') return t('line.filed', { date: fmt.date(l.filedAt) });
    const parts = [
      l.state === 'readyToSign' ? t('line.ready', { date: fmt.date(l.readyAt) }) : null,
      l.state === 'draft' && l.editorNames.length > 0 ? t('line.writes', { names: joinNames(l.editorNames, tAudit('head.and')), count: l.editorNames.length }) : null,
      l.state === 'draft' && l.lastEditedAt ? t('line.lastEdited', { date: fmt.date(l.lastEditedAt) }) : null,
      l.lastPrintedAt ? t('line.printed', { date: fmt.date(l.lastPrintedAt) }) : null,
      l.scansExpected > 1 && l.scansFiled > 0 ? t('line.partial', { filed: l.scansFiled, expected: l.scansExpected }) : null,
    ].filter((p): p is string => Boolean(p));
    return parts.join(' · ');
  };

  const printBlank = async () => {
    await blank.download(`/finance/audit/year/${encodeURIComponent(data.yearId)}/blank`, `Vordruck-Pruefbericht-${data.designation}.pdf`, { method: 'POST' });
    router.refresh();
  };

  return (
    <FormCard as="section">
      <FormCardBody>
        <Section
          title={t('title')}
          intro={t('intro')}
          actions={
            // Designer Runde 8, Frage 3.1: die Zählung der Voraussetzungen im Kopf der Karte, solange sie gelten.
            !filed || (data.canFile && data.scanTarget) ? (
              <>
                {filed ? null : <span className="text-meta text-muted-ink">{tReq('count', { done: items.filter((i) => i.done).length, total: items.length })}</span>}
                {data.canFile && data.scanTarget ? (
                  <Button ref={scanRef} type="button" size="sm" onClick={() => setScanning(true)} data-testid="audit-scan">
                    {t('scan')}
                  </Button>
                ) : null}
              </>
            ) : null
          }
        >
          <div className="flex flex-col gap-4">
            {/* Nach der Ablage sind die Punkte keine Voraussetzungen mehr, nur noch Stand: Es bleibt die Zeile
                „Prüfbericht · abgelegt“; offene Vermerke zeigt der Abschnitt „Vermerke“ (Designer Runde 4). */}
            {filed ? null : <RequirementList variant="rows" items={items} />}
            {data.lines.length > 0 ? (
              <ul className="flex flex-col">
                {data.lines.map((l) => (
                  <li key={l.kind} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line-2 py-2 last:border-0" data-testid={`audit-report-line-${l.kind}`}>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-semibold">{t(`line.${l.kind}`)}</span>
                      {/* Abgelegt sagt der Satz „Abgelegt am …“; die Marke sagte dasselbe (Designer Runde 8, 281). */}
                      {l.state === 'filed' ? null : (
                        <StatusBadge tone={statusTone('auditReport', l.state)} dot>
                          {tAudit(`report.state.${l.state}`)}
                        </StatusBadge>
                      )}
                      <span className="text-meta text-muted-ink">{lineText(l)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-3 text-meta">
                      {l.documents.map((d) => (
                        <Link key={d.id} href={`/dms/${d.id}`} className="text-link underline-offset-2 hover:underline">
                          {d.number ? t('line.document', { number: d.number }) : t('line.documentPlain')}
                        </Link>
                      ))}
                      {l.origin === 'kompass' ? (
                        <Link href={l.href} className="text-link underline-offset-2 hover:underline">
                          {l.state === 'draft' ? t('line.open') : t('line.view')}
                        </Link>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {data.writeDraft ? <WriteReport yearId={data.yearId} /> : null}
            {data.followUpHref && !data.followUpUnchanged ? (
              // Der Knopf steht auf eigener Zeile unter dem Satz, nicht mitten darin (261 Telefon).
              <div className="flex flex-col gap-2">
                <p className="text-meta text-ink-2">{t('followUpHint')}</p>
                <div>
                  <Link href={data.followUpHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    {t('followUpCreate')}
                  </Link>
                </div>
              </div>
            ) : null}
            {data.onlyPaper ? (
              <div className="flex flex-col gap-2" data-testid="audit-only-paper">
                <p className="text-body text-ink-2">{t('onlyPaper')}</p>
                {data.canManage ? (
                  <div>
                    <Button type="button" variant="outline" size="sm" disabled={blank.busy} onClick={() => void printBlank()} data-testid="audit-blank">
                      {t('blank')}
                    </Button>
                  </div>
                ) : null}
                <RefusalNotice action state={blank.refusal} />
              </div>
            ) : null}
            {data.packageRun ? <PackageRunCard yearId={data.yearId} initial={data.packageRun} /> : null}
          </div>
        </Section>
      </FormCardBody>
      {data.scanTarget ? <ScanDialog open={scanning} onOpenChange={setScanning} target={data.scanTarget} auditors={data.scanAuditors} finalFocus={scanRef} /> : null}
    </FormCard>
  );
}

/**
 * „Prüfbericht schreiben“ (Designer Runde 4, 1.2 Nr. 6): legt den Entwurf an und öffnet ihn in einem Schritt — die
 * Action leitet weiter, auch wenn ihn inzwischen jemand angelegt hat. Ein Formular, damit die Weiterleitung der Server
 * Action greift und der Knopf sperrt, solange sie läuft; eine Ablehnung steht darüber.
 */
function WriteReport({ yearId }: { yearId: string }) {
  const t = useTranslations('finance.audit.reportSection');
  const [state, action] = useActionState(writeAuditReportAction.bind(null, yearId), idleState);
  return (
    <form action={action} className="flex flex-col gap-2" data-testid="audit-report-draft">
      <RefusalNotice action state={state} />
      <p className="text-meta text-ink-2">
        {t('draftHint')}{' '}
        <SubmitButton variant="outline" size="sm">
          {t('draftCreate')}
        </SubmitButton>
      </p>
    </form>
  );
}

