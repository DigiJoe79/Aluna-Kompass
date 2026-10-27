'use client';

import type { ReleaseBasis } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { PickedDocument } from '@/app/(shell)/dms/search-action';
import { useDateFormat } from '@/components/date-format-provider';
import { PageHeader } from '@/components/page-header';
import { RecordActions } from '@/components/record-actions';
import { Button } from '@/components/ui/button';
import { ReleaseDialog } from './release-dialog';

export interface HeaderRelease {
  basis: ReleaseBasis;
  at: string;
  byName: string;
  note?: string | null;
  document?: PickedDocument | null;
  /** Bei „Prüfbericht“ (347): der Tag des geltenden Berichts und der bestätigten Nachprüfung, aus dem Dienst. */
  auditReportFiledAt?: string | null;
  followUpConfirmedAt?: string | null;
}

export type ReleaseHeaderState = 'open' | 'notReleased' | 'released' | 'locked';

/** Die vier Zustände des Kopfs (Designer Runde 2, 11a) aus Jahr und Freigabe. */
export function releaseHeaderState(status: 'open' | 'closed', release: HeaderRelease | null, releaseChangeable: boolean): ReleaseHeaderState {
  if (status === 'open') return 'open';
  if (!release) return 'notReleased';
  return releaseChangeable ? 'released' : 'locked';
}

/**
 * Kopf von „Berichte“ (Board 11a): Der Satz unter dem Titel sagt den Stand des gewählten Jahres, ohne Kasten und ohne
 * Farbe; nur wenn etwas zu tun ist, steht rechts eine Handlung — „Freigeben …“ als Primärknopf, „Freigabe ändern …“
 * im ⋯. Ein Link oder Knopf „Jahr abschließen“ kommt mit dem Jahresabschluss (Joe 2026-10-24); Zustand 1 ist nur der
 * Satz.
 */
export function ReportsHeader({
  year,
  release,
  releaseChangeable,
  assembly,
  canRelease,
  statementsMissing = [],
  endsOn,
  closingLink = false,
  followUp = null,
  ended = true,
}: {
  year: { id: string; designation: string; status: 'open' | 'closed' };
  release: HeaderRelease | null;
  releaseChangeable: boolean;
  /** Festgeschriebene unter den Berichten für die Mitgliederversammlung, für Zustand 4. */
  assembly: { done: number; total: number };
  canRelease: boolean;
  /** Bankkonten ohne Auszug zum Stichtag (Board 13c): das zweite Hemmnis nach der Freigabe. */
  statementsMissing?: readonly { accountId: string; name: string }[];
  endsOn?: string;
  /** Darf den Jahresabschluss sehen (`finance.read`): die Hemmnisse verlinken auf seine Schritte. */
  closingLink?: boolean;
  /** Offene Nachprüfung (vom Dienst): Schritt 10 stellt die Freigabe wieder her, kein „Freigeben …“ (279 Telefon). */
  followUp?: 'unchanged' | 'changed' | null;
  /** Das Jahr ist vorbei (vom Server, heute > Ende). Im laufenden Jahr führt kein Link in Schritt 8 (292). */
  ended?: boolean;
}) {
  const t = useTranslations('finance.reports');
  const fmt = useDateFormat();
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const state = releaseHeaderState(year.status, release, releaseChangeable);
  const followUpBlocks = state === 'notReleased' && followUp !== null;
  // Designer Runde 8, 347: „Prüfbericht vom“ nennt den geltenden Bericht, nicht den Tag der Freigabe; nach einer
  // Nachprüfung ohne Änderung dazu ihre Bestätigung.
  const reason = release
    ? t(`header.reason.${release.basis}`, { date: fmt.date(release.auditReportFiledAt ?? release.at), confirmed: release.followUpConfirmedAt ? fmt.date(release.followUpConfirmedAt) : 'none' })
    : '';
  const values = { year: year.designation, reason };

  // Die Beschreibung steht im `<p>` des Kopfs: Teile als `span` (kein `p` im `p`).
  const closing = (step: 'close' | 'statements' | 'auditReport', label: string) =>
    closingLink ? (
      <Link href={`/finance/closing?year=${encodeURIComponent(year.id)}#step-${step}`} className="mt-1 block text-meta text-link underline-offset-2 hover:underline" data-testid={`reports-to-${step}`}>
        {label}
      </Link>
    ) : null;
  // Ein Hemmnis zur Zeit, in fester Folge (Runde 4, 2.1): erst die Freigabe, dann die Auszüge.
  const statements =
    (state === 'released' || state === 'locked') && statementsMissing.length > 0
      ? statementsMissing.length === 1
        ? t('header.statementOne', { account: statementsMissing[0]!.name, date: fmt.date(endsOn ?? null) })
        : t('header.statementMany', { count: statementsMissing.length, date: fmt.date(endsOn ?? null) })
      : null;
  const description =
    state === 'open' ? (
      ended ? (
        <>
          {t('header.open', values)}
          {closing('close', t('header.toClose'))}
        </>
      ) : (
        t('header.running', values)
      )
    ) : statements ? (
      <>
        <span data-testid="reports-statements-missing">
          {t('header.releasedStatements', values)} {statements}
        </span>
        {closing('statements', t('header.toStatements'))}
      </>
    ) : followUpBlocks ? (
      <>
        {t(followUp === 'unchanged' ? 'header.followUp' : 'header.followUpChanged', values)}
        {closing('auditReport', t('header.toAuditReport'))}
      </>
    ) : state === 'notReleased' ? (
      <>
        {t('header.notReleased', values)}
        {canRelease ? null : <span className="mt-1 block text-meta text-muted-ink">{t('header.releaseNeedsRight')}</span>}
      </>
    ) : state === 'released' ? (
      <>
        {t('header.released', values)}
        <span className="mt-1 block text-meta text-muted-ink">{t('header.by', { name: release!.byName, date: fmt.date(release!.at) })}</span>
      </>
    ) : (
      <>
        {t('header.locked', { ...values, done: assembly.done, total: assembly.total })}
        <span className="mt-1 block text-meta text-muted-ink">{t('header.lockedNote')}</span>
      </>
    );

  const actions =
    state === 'notReleased' && canRelease && !followUpBlocks ? (
      <Button type="button" onClick={() => setOpen(true)} data-testid="reports-release">
        {t('release.open')}
      </Button>
    ) : state === 'released' && canRelease ? (
      <RecordActions triggerRef={more} actions={[{ key: 'change', label: t('release.change'), kind: 'undoing', onSelect: () => setOpen(true), testId: 'reports-release-change' }]} />
    ) : null;

  return (
    <>
      <PageHeader title={t('list.title')} description={description} actions={actions} />
      {canRelease && ((state === 'notReleased' && !followUpBlocks) || state === 'released') ? (
        <ReleaseDialog
          open={open}
          onOpenChange={setOpen}
          year={year}
          current={release ? { basis: release.basis, note: release.note ?? null, document: release.document ?? null } : null}
          finalFocus={state === 'released' ? more : undefined}
        />
      ) : null}
    </>
  );
}
