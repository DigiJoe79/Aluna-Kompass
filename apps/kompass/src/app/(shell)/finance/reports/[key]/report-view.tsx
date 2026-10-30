'use client';

import type { ReportFinalVersion, ReportFinalizeBlock, ReportGroup, ReportParams, ReportStage } from '@kompass/module-finance';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { RefusalNotice } from '@/components/forms/refusal-notice';
import { KeyLine } from '@/components/key-line';
import { Notice } from '@/components/notice';
import { PageHeader } from '@/components/page-header';
import { PdfPages } from '@/components/pdf-pages';
import { RemarkDialog } from '@/app/(shell)/finance/audit/remark-dialog';
import { RemarksCard } from '@/app/(shell)/finance/audit/remarks-card';
import type { TargetAudit } from '@/lib/finance/entry-audit';
import { StatusBadge, statusTone } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { formatEuro } from '@/lib/finance/amount';
import { PERIOD_REPORTS, reportQuery } from '@/lib/finance/report-params';
import { useFileDownload } from '@/lib/use-file-download';
import Link from 'next/link';
import { StatementDialog, type StatementAccount } from '../../closing/statement-dialog';
import { ReleaseDialog } from '../release-dialog';
import { FinalizeDialog, type FinalizeConsequences } from './finalize-dialog';
import { ReportParamsRow } from './report-params-row';
import { VersionsTable, type VersionRow } from './versions-table';

/**
 * Was nur die Jahresrechnung zusätzlich zeigt (Designer 1a–1f), fertig gerendert von der Seite: die Karte unter dem
 * Kopf, „Auf einen Blick“ (nur am Telefon), die Hinweise über und „Zur Kontrolle“ unter der Vorschau.
 */
export interface AnnualAccountsBlock {
  notices: ReactNode;
  card: ReactNode;
  glance: ReactNode;
  control: ReactNode;
}

/** `path` mit den nicht leeren Teilen als Abfrage. */
const withQuery = (path: string, parts: string[]) => (parts.some(Boolean) ? `${path}?${parts.filter(Boolean).join('&')}` : path);

/**
 * Ein Bericht (Board 2b, 9a, Designer Runde 2 11c): Kopf mit Stufe (`PageHeader status`, N2), Zweck und `KeyLine` mit
 * Erzeugung und Kurz-Hash; Primär „Festschreiben“ — solange das Jahr abgeschlossen, aber nicht freigegeben ist, an
 * seiner Stelle „Freigeben …“ (kein gesperrter Knopf); gesperrt nur mit fachlichem Grund daneben (die Probe).
 * „Herunterladen“ in `more`. Darunter Parameter, Hinweise, die Seiten (`PdfPages`) und die Fassungen.
 */
export function ReportView(props: {
  reportKey: string;
  title: string;
  orientation: 'portrait' | 'landscape';
  /** Seiten des PDF für `PdfPages`; `null`, wenn die Vorschau nicht entstand (dann nur „PDF öffnen“). */
  pageCount: number | null;
  /** Ohne `back` eine Seite in der Navigation (Mittelverwendung, MUSTER § Seitenrahmen). */
  back?: { href: string; label: string };
  stage: ReportStage;
  shortHash: string;
  generatedAt: string;
  finalizeBlock: ReportFinalizeBlock | null;
  warnings: string[];
  probeDifferenceCents: number | null;
  combineAllowed: boolean;
  params: ReportParams;
  /** `calendarYear`: das Jahr, in dem das Geschäftsjahr endet — für Berichte je Kalenderjahr (`yearKind`). */
  years: { id: string; designation: string; calendarYear?: string }[];
  /** Der Bericht gilt je Kalenderjahr: Der Parameter heißt „Kalenderjahr“ (Definition `yearKind`). */
  yearKind?: 'calendar';
  year: { id: string; designation: string };
  canFinalize: boolean;
  canRelease: boolean;
  canOpenVersions: boolean;
  versions: VersionRow[];
  /** Kassenprüfung: Vermerke am Bericht; „Vermerk schreiben …“ im Kopf für Prüfer des Jahres (Plan D1b Task 6). */
  audit?: TargetAudit | null;
  /** Sperre „Auszug fehlt“ mit genau einem Konto und Recht zum Ablegen: „Auszug ablegen …“ statt „Festschreiben“ (13c). */
  statementAccount?: StatementAccount | null;
  /** Stichtag des Jahres, für den Auszug-Dialog. */
  endsOn?: string;
  /** Darf den Jahresabschluss sehen: die Sperren verlinken auf Schritt 1 bzw. 8. */
  closingLink?: boolean;
  /** Projektabrechnung: die Projekte des Jahres mit Namen (leer ohne `projects.view`). */
  projects?: { id: string; name: string }[];
  /** Steuerberichte: die Erklärungszeiträume, neuester zuerst (15i). */
  periods?: { id: string; label: string }[];
  /** Der Rücklagenspiegel über die Jahre eines Erklärungszeitraums (Befund 18 d): Adresse und Wahl über `?period=`. */
  periodId?: string;
  /** Festgeschrieben: die Fassung in der Akte — Seiten, „PDF öffnen“ und „Herunterladen“ kommen aus ihr (16a C). */
  finalVersion?: ReportFinalVersion | null;
  /** Ohne Inhalt der Satz des PDF statt der Blätter (16a D). */
  empty?: string | null;
  /** `false` bei Arbeitslisten: kein Festschreiben, keine Fassungen (Designer Runde 7, 261). */
  finalizable?: boolean;
  /** Die Gruppe aus dem Katalog — dieselbe Quelle wie die Liste „Berichte“ (Designer Runde 7, 247). */
  group: ReportGroup;
  /** Das Jahr läuft noch (heute vor seinem Ende): nur „{year} läuft noch.“, ohne Link (Designer Runde 7, 249). */
  running?: boolean;
  /** Jahresrechnung: Karte, Hinweise, „Auf einen Blick“ und „Zur Kontrolle“ (Plan U1). */
  annualAccounts?: AnnualAccountsBlock;
  /** Berichtigte Fassung: festgeschrieben am Tag der ersetzten Fassung — die Fassungszeile endet mit „berichtigt, ersetzt die vom …“ (Board 1c C). */
  replacesFinalizedAt?: string | null;
  /** Jahresrechnung: Folgen des Festschreibens (fehlende Erläuterung, Vergütung ohne Grundlage). */
  finalizeConsequences?: FinalizeConsequences;
  /** Eigener Kopfsatz statt des Zwecksatzes (Mittelverwendung, Plan U2); der Satz zur Sperre bleibt dahinter. */
  purpose?: ReactNode;
  /** Eigene Warnungen an der Stelle der Hinweise (Mittelverwendung, Plan U2). */
  notices?: ReactNode;
  /** Aktionen am Datensatz als letztes im Kopf (`RecordActions`, Mittelverwendung: Anfangsvortrag). */
  headerActions?: ReactNode;
  /** Adresse der Seite für die Parameter; Vorgabe `/finance/reports/<key>` (Mittelverwendung: `/finance/fund-use`). */
  basePath?: string;
}) {
  const { reportKey, title, stage, shortHash, finalizeBlock: block, params, year } = props;
  const t = useTranslations('finance.reports');
  const fmt = useDateFormat();
  const [finalizing, setFinalizing] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [remarking, setRemarking] = useState(false);
  const [filing, setFiling] = useState(false);
  const tAudit = useTranslations('finance.audit.remarks');
  const { busy, refusal, download } = useFileDownload({ forbidden: t('view.downloadRefused.forbidden'), notFound: t('view.downloadRefused.notFound'), failed: t('view.downloadRefused.failed') });
  const query = reportQuery(params, { periodId: props.periodId });
  // Festgeschrieben: die Datei der Fassung aus der Akte, nie ein neu erzeugtes PDF (Designer Runde 7, 16a C).
  const version = stage === 'final' ? (props.finalVersion ?? null) : null;
  // Jahresrechnung nach der Abzeichnung: die abgezeichnete Fassung, die publiziert wird (Bildabnahme 0.4.5 F-3).
  const signedCopy = version?.signedCopy ?? null;
  const documentQuery = signedCopy ? `document=${encodeURIComponent(signedCopy.documentId)}` : '';
  const previewUrl = version ? withQuery(`/finance/reports/versions/${encodeURIComponent(version.reportId)}/file`, [documentQuery]) : `/finance/reports/${reportKey}/preview?${query}`;
  const downloadUrl = version ? previewUrl : `${previewUrl}&download=1`;
  const pageSrc = version
    ? (page: number, scale: 1 | 2) => withQuery(`/finance/reports/versions/${encodeURIComponent(version.reportId)}/page/${page}`, [documentQuery, scale === 2 ? 'scale=2' : ''])
    : (page: number, scale: 1 | 2) => `/finance/reports/${reportKey}/page/${page}?${[query, scale === 2 ? 'scale=2' : ''].filter(Boolean).join('&')}`;
  const finalizable = props.finalizable !== false;

  const running = block?.code === 'reportYearOpen' && props.running === true;
  const blockedSentence = running ? t('view.running', { year: year.designation }) : block && block.code !== 'reportAlreadyFinal' && block.code !== 'reportProbeFails' && block.code !== 'reportNotFinalizable' ? t(`view.blocked.${block.code}`, { year: year.designation, accounts: String(block.params.accounts ?? ''), count: Number(block.params.count ?? 0) }) : null;
  const releaseInstead = block?.code === 'reportNotReleased' && props.canRelease;
  // Ein fehlender Auszug: der Weg ist ein Klick (13c); mehrere oder ohne Recht: der Link auf Schritt 1.
  const statementInstead = block?.code === 'reportStatementsMissing' && props.statementAccount ? props.statementAccount : null;
  // Schritt 8 beginnt erst nach dem Jahresende: im laufenden Jahr kein Link (249).
  const closingStep = block?.code === 'reportStatementsMissing' && !statementInstead ? 'statements' : block?.code === 'reportYearOpen' && !running ? 'close' : null;
  // Die Jahresrechnung verweist auf den Kassenbericht (Spec Teil J, Ve-L-2): ohne ihn der Weg dorthin.
  const toCashReport = block?.code === 'annualAccountsCashReportMissing';
  const finalizeShown = stage !== 'final' && props.canFinalize && (block === null || block.code === 'reportProbeFails');

  const actions = statementInstead ? (
    <Button type="button" onClick={() => setFiling(true)} data-testid="report-statement-file">
      {t('view.fileStatement')}
    </Button>
  ) : releaseInstead ? (
    <Button type="button" onClick={() => setReleasing(true)} data-testid="report-release">
      {t('release.open')}
    </Button>
  ) : finalizeShown ? (
    <span className="flex flex-wrap items-center gap-2">
      {block?.code === 'reportProbeFails' ? <span className="text-meta text-muted-ink">{t('view.blocked.reportProbeFails')}</span> : null}
      <Button type="button" disabled={block !== null} onClick={() => setFinalizing(true)} data-testid="report-finalize">
        {t('view.finalize')}
      </Button>
    </span>
  ) : null;

  return (
    <>
      <PageHeader
        back={props.back}
        title={title}
        status={
          <StatusBadge tone={statusTone('reportStage', stage)} dot>
            {t(`stage.${stage}`)}
          </StatusBadge>
        }
        // Zwei Blöcke im `<p>` des Kopfs: Satz und `KeyLine` (beide `span`).
        description={
          <>
            <span className="block">
              {props.purpose ?? t('view.purpose', { group: props.group, span: props.yearKind === 'calendar' ? 'calendar' : PERIOD_REPORTS.includes(reportKey) ? 'period' : 'none', orientation: props.orientation })}
              {blockedSentence ? ` ${blockedSentence}` : ''}
            </span>
            {closingStep && props.closingLink ? (
              <Link href={`/finance/closing?year=${encodeURIComponent(year.id)}#step-${closingStep}`} className="mt-1 block text-meta text-link underline-offset-2 hover:underline" data-testid={`report-to-${closingStep}`}>
                {t(closingStep === 'close' ? 'header.toClose' : 'header.toStatements')}
              </Link>
            ) : null}
            {toCashReport ? (
              <Link href={`/finance/reports/cashReport?year=${encodeURIComponent(year.id)}`} className="mt-1 block text-meta text-link underline-offset-2 hover:underline" data-testid="report-to-cash-report">
                {t('header.toCashReport')}
              </Link>
            ) : null}
            <KeyLine className="mt-1">
              {version ? t('view.version', { date: fmt.date(version.finalizedAt), time: fmt.time(version.finalizedAt), hash: version.shortHash, number: version.documentNumber }) : t('view.generated', { date: fmt.dateTime(props.generatedAt), hash: shortHash })}
              {signedCopy ? t('view.signedShown', { number: signedCopy.documentNumber }) : null}
              {version && props.replacesFinalizedAt ? t('view.corrected', { date: fmt.date(props.replacesFinalizedAt) }) : null}
            </KeyLine>
          </>
        }
        more={[
          { key: 'download', label: t('view.download'), icon: <Download className="size-4" aria-hidden />, disabled: busy, onSelect: () => void download(downloadUrl, `${reportKey}.pdf`), testId: 'report-download' },
          ...(props.audit?.writer ? [{ key: 'remark', label: tAudit('write'), onSelect: () => setRemarking(true), testId: 'report-remark' }] : []),
        ]}
        actions={
          props.headerActions ? (
            <>
              {actions}
              {props.headerActions}
            </>
          ) : (
            actions
          )
        }
      />
      <div className="flex flex-col gap-4">
        {props.annualAccounts?.card}
        {props.annualAccounts?.glance}
        <ReportParamsRow reportKey={reportKey} params={params} years={props.years} yearKind={props.yearKind} combineAllowed={props.combineAllowed} projects={props.projects} periods={props.periods} periodId={props.periodId} fixed={version !== null} withNote={finalizable} basePath={props.basePath} />
        {props.warnings.map((w) => (
          <Notice key={w} level="warn">
            {t(`view.warnings.${w}`)}
            {/* Die Pflicht zur Jahreserklärung führt zu ihrer Frist (Designer Runde 8, 275/276; wie die Pflicht an der
                Steuererklärung); im PDF bleibt der Hinweis ohne Link. */}
            {w === 'section18_4a' ? (
              <>
                {' '}
                <Link href="/finance/deadlines" className="text-link underline-offset-2 hover:underline">
                  {t('view.toDeadlines')}
                </Link>
              </>
            ) : null}
          </Notice>
        ))}
        {props.annualAccounts?.notices}
        {props.notices}
        {props.probeDifferenceCents ? <Notice level="warn">{t('view.probe', { amount: formatEuro(props.probeDifferenceCents) })}</Notice> : null}
        <RefusalNotice action state={refusal} />
        {/* Die Seiten als Bilder statt des Browser-Betrachters (Designer Runde 6, Punkt 4); Querformat braucht die Breite (2b). */}
        <PdfPages title={title} pageCount={props.pageCount} pageSrc={pageSrc} pdfHref={previewUrl} orientation={props.orientation} empty={props.empty ?? null} />
        {props.annualAccounts?.control}
        {/* Eine Arbeitsliste hat keine Fassungen (Joe 2026-10-25). */}
        {!finalizable ? null : <VersionsTable versions={props.versions} canOpen={props.canOpenVersions} />}
        {props.audit ? <RemarksCard audit={props.audit} withWriter={false} framed={false} /> : null}
      </div>
      {props.audit?.writer ? <RemarkDialog open={remarking} onOpenChange={setRemarking} {...props.audit.writer} /> : null}
      {finalizeShown ? <FinalizeDialog open={finalizing} onOpenChange={setFinalizing} reportKey={reportKey} params={params} shortHash={shortHash} title={title} consequences={props.finalizeConsequences} /> : null}
      {statementInstead ? <StatementDialog open={filing} onOpenChange={setFiling} fiscalYearId={year.id} endsOn={props.endsOn ?? ''} account={statementInstead} /> : null}
      {releaseInstead ? <ReleaseDialog open={releasing} onOpenChange={setReleasing} year={year} current={null} /> : null}
    </>
  );
}
