import { hasPermission, isoNow, listUserNamesWithPermission, readSetting, userNamesFor } from '@kompass/core';
import { listFiscalYears, personYearOverview, relatedPartyPayments, valueAt } from '@kompass/module-finance';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BlockedState } from '@/components/blocked-state';
import { Notice } from '@/components/notice';
import { Page } from '@/components/page';
import { PageHeader } from '@/components/page-header';
import type { DateFormatMode } from '@/lib/dates';
import { requireSession } from '@/lib/request-context';
import { PersonCard } from './person-card';
import { RelatedPartyTable } from './related-party-table';

/**
 * D4 Personenübersicht (F8b Task 6b, Designer-README 4f, Annahme 9, 10):
 * Kalenderjahr-Wahl, je Person eine Karte mit Pauschalen gegen die Grenze und
 * den Erstattungen, darunter E21 für das Geschäftsjahr, das dieses
 * Kalenderjahr am 31.12. enthält (Entscheidung 5, 2026-09-28: beide Zeiträume
 * klar beschriftet, bei Deckungsgleichheit nur der Titel „Personenübersicht
 * {Jahr}“). Ohne `finance.read` ein `BlockedState`.
 */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { deps, ctx } = await requireSession();
  const t = await getTranslations('finance.people');
  if (!hasPermission(ctx, 'finance.read')) {
    const names = listUserNamesWithPermission(deps, 'roles.manage');
    return (
      <Page width="standard" header={<PageHeader title={t('title')} description={t('intro')} />}>
        <BlockedState step={t('title')} title={t('blocked.title')}>
          {names.length > 0 ? t('blocked.textWithNames', { names: names.join(', ') }) : t('blocked.text')}
        </BlockedState>
      </Page>
    );
  }

  const today = isoNow(deps.clock).slice(0, 10);
  const currentYear = Number(today.slice(0, 4));
  const query = await searchParams;
  const requested = Number(query.year);
  const yearsRes = await listFiscalYears(deps, ctx);
  const fiscalYears = yearsRes.ok ? yearsRes.value : [];
  const firstYear = Math.min(currentYear, ...fiscalYears.map((y) => Number(y.startsOn.slice(0, 4))));
  const year = Number.isInteger(requested) && requested >= firstYear && requested <= currentYear ? requested : currentYear;
  const choices = Array.from({ length: currentYear - firstYear + 1 }, (_, i) => currentYear - i);

  const overviewRes = await personYearOverview(deps, ctx, { year });
  const overview = overviewRes.ok ? overviewRes.value : { rows: [], linesWithoutPersonCount: 0 };
  const warnAtPercent = (valueAt(deps.db, 'warnAtPercent', `${year}-12-31`) as number | null) ?? 80;

  const fiscalYear = fiscalYears.find((y) => y.startsOn <= `${year}-12-31` && `${year}-12-31` <= y.endsOn) ?? fiscalYears.find((y) => y.startsOn.slice(0, 4) === String(year)) ?? null;
  const relatedRes = fiscalYear ? await relatedPartyPayments(deps, ctx, { fiscalYearId: fiscalYear.id }) : null;
  const related = relatedRes?.ok ? relatedRes.value.rows : [];
  // Befund T: ohne Kontakt mit der Rolle „Vorstand“ bliebe die Liste unten stumm leer.
  const boardMembersMissing = relatedRes?.ok ? relatedRes.value.boardMembersMissing : false;
  const approverNames = userNamesFor(deps, related.map((r) => r.approvedByUserId));
  const dateMode = readSetting<DateFormatMode>(deps, 'ui.dateFormat');
  // Entscheidung 5 (2026-09-28): Pauschalen nach Kalenderjahr, E21 nach Geschäftsjahr — fallen beide zusammen, genügt der Titel.
  const sameYear = !!fiscalYear && fiscalYear.startsOn === `${year}-01-01` && fiscalYear.endsOn === `${year}-12-31`;

  return (
    <Page width="standard" header={<PageHeader title={t('pageTitle', { year })} description={t('intro')} />}>
      <div className="space-y-5">
        {boardMembersMissing ? (
          <div data-testid="people-board-missing">
            <Notice level="hint" title={t('boardMissing.title')}>
              {t('boardMissing.text')}{' '}
              <Link href="/contacts" className="text-link underline">{t('boardMissing.link')}</Link>
            </Notice>
          </div>
        ) : null}
        <nav aria-label={t('yearChoice')} className="flex flex-wrap items-center gap-1.5" data-testid="people-year">
          <span className="text-[13px] text-muted-ink">{t('yearChoice')}:</span>
          {choices.map((y) => (
            <Link
              key={y}
              href={`/finance/people?year=${y}`}
              aria-current={y === year ? 'page' : undefined}
              className={`rounded-sm px-2 py-1 font-mono text-[13px] ${y === year ? 'bg-surface-2 font-semibold text-ink' : 'text-ink-2 hover:bg-surface-2'}`}
            >
              {y}
            </Link>
          ))}
        </nav>

        <h2 className="font-heading text-[18px] text-ink" data-testid="people-allowances-heading">
          {sameYear ? t('allowancesHeading') : t('allowancesHeadingCalendar', { year })}
        </h2>
        {overview.rows.length === 0 ? (
          <p className="rounded-md border border-line bg-surface p-4 text-[14px] text-ink-2">{t('empty')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {overview.rows.map((person) => (
              <PersonCard key={person.contactId} person={person} year={year} warnAtPercent={warnAtPercent} />
            ))}
          </div>
        )}
        {overview.linesWithoutPersonCount > 0 ? <p className="text-[13px] text-warning-ink" data-testid="people-without-person">{t('withoutPerson', { count: overview.linesWithoutPersonCount })}</p> : null}

        <section className="space-y-2">
          <h2 className="font-heading text-[18px] text-ink" data-testid="people-related-heading">
            {fiscalYear && !sameYear ? t('related.headingFiscal', { name: fiscalYear.designation }) : t('related.heading')}
          </h2>
          {fiscalYear ? (
            <>
              <RelatedPartyTable rows={related} approverNames={approverNames} dateMode={dateMode} />
            </>
          ) : (
            <p className="text-[13px] text-muted-ink">{t('related.noFiscalYear')}</p>
          )}
        </section>
      </div>
    </Page>
  );
}
