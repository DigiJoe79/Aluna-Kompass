'use client';

import type { ReportParams } from '@kompass/module-finance';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { FormField } from '@/components/forms/form-field';
import { FormGrid } from '@/components/forms/form-grid';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DATE_REPORTS, PERIOD_REPORTS, reportQuery } from '@/lib/finance/report-params';

/**
 * Parameter als eine `FormGrid`-Zeile über dem Rahmen (Board 2b): das Jahr, bei der EÜR und wo § 64 Abs. 3 AO es
 * zulässt die zusammengefasste Darstellung, bei der Projektabrechnung das Projekt (nur mit `projects.view` mehr als
 * „Alle Projekte“), bei Berichten je Kalenderjahr (`yearKind`) das Kalenderjahr, bei der Übergabeliste statt des Jahres der Stichtag (Rechenschaft B1), bei den Steuerberichten und beim Rücklagenspiegel über einen Zeitraum (`periodId`, Befund 18 d) der Erklärungszeitraum (D2, 15i). Jede Änderung schreibt die
 * Adresse (`basePath`, Vorgabe `/finance/reports/<key>`) und erzeugt neu; die Parameter gehören zur Fassung.
 */
export function ReportParamsRow({ reportKey, params, years, yearKind, combineAllowed, projects = [], periods = [], periodId, fixed = false, withNote = true, basePath }: { reportKey: string; params: ReportParams; years: { id: string; designation: string; calendarYear?: string }[]; yearKind?: 'calendar'; combineAllowed: boolean; projects?: { id: string; name: string }[]; periods?: { id: string; label: string }[]; periodId?: string; fixed?: boolean; withNote?: boolean; basePath?: string }) {
  const t = useTranslations('finance.reports.view.params');
  const fmt = useDateFormat();
  const router = useRouter();
  const [pending, startNavigation] = useTransition();
  // Festgeschrieben zeigt die Seite die Fassung: Die Parameter stehen als Satz, nicht als Feld (Designer Runde 7, 16a C).
  if (fixed) {
    const year = years.find((y) => y.id === params.fiscalYearId);
    const period = periods.find((p) => p.id === (params.taxPeriodId ?? periodId));
    const parts = [
      period ? `${t('period')} ${period.label}` : params.date ? `${t('date')} ${fmt.date(params.date)}` : year ? `${t(yearKind === 'calendar' ? 'calendarYear' : 'year')} ${yearKind === 'calendar' ? (year.calendarYear ?? year.designation) : year.designation}` : null,
      params.projectId ? `${t('project')} ${projects.find((p) => p.id === params.projectId)?.name ?? ''}`.trim() : null,
      params.combineOperations ? t('combine') : null,
    ].filter(Boolean);
    return <p className="text-body" data-testid="report-params-fixed">{parts.join(' · ')}</p>;
  }
  // Ein anderes Jahr beginnt ohne „zusammengefasst“: Ob § 64 Abs. 3 AO es zulässt, entscheidet jedes Jahr neu.
  const go = (next: ReportParams) => startNavigation(() => router.replace(`${basePath ?? `/finance/reports/${reportKey}`}?${reportQuery(next)}`));
  const showCombine = reportKey === 'incomeStatement' && combineAllowed;
  const byDate = DATE_REPORTS.includes(reportKey);
  return (
    <div className="flex flex-col gap-1.5">
      <FormGrid>
        {PERIOD_REPORTS.includes(reportKey) || periodId ? (
          // Steuerberichte je Erklärungszeitraum statt je Jahr (15i, `Select` M).
          <FormField id="report-period" label={t('period')} size="m">
            <Select id="report-period" value={params.taxPeriodId ?? periodId ?? ''} disabled={pending} onChange={(e) => go({ taxPeriodId: e.target.value })}>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </FormField>
        ) : byDate ? (
          <FormField id="report-date" label={t('date')} size="s">
            <Input id="report-date" type="date" value={params.date ?? ''} disabled={pending} onChange={(e) => e.target.value && go({ date: e.target.value })} />
          </FormField>
        ) : (
          <FormField id="report-year" label={t(yearKind === 'calendar' ? 'calendarYear' : 'year')} size="s">
            <Select id="report-year" value={params.fiscalYearId ?? ''} disabled={pending} onChange={(e) => go({ fiscalYearId: e.target.value })}>
              {years.map((y) => (
                <option key={y.id} value={y.id}>
                  {yearKind === 'calendar' ? (y.calendarYear ?? y.designation) : y.designation}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        {reportKey === 'projectStatement' ? (
          <FormField id="report-project" label={t('project')} size="m">
            <Select id="report-project" value={params.projectId ?? ''} disabled={pending} onChange={(e) => go(e.target.value ? { fiscalYearId: params.fiscalYearId, projectId: e.target.value } : { fiscalYearId: params.fiscalYearId })}>
              <option value="">{t('allProjects')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}
        {showCombine ? (
          <FormField id="report-combine" label={t('combine')} toggle size="l">
            <Checkbox
              id="report-combine"
              checked={params.combineOperations === true}
              disabled={pending}
              onCheckedChange={(on) => {
                const { combineOperations: _drop, ...rest } = params;
                go(on === true ? { ...rest, combineOperations: true } : rest);
              }}
            />
          </FormField>
        ) : null}
      </FormGrid>
      {/* Nur wo es eine Fassung geben kann (Designer Runde 7, 268/269): Arbeitslisten haben keine. */}
      {withNote ? <p className="text-meta text-muted-ink">{t('note')}</p> : null}
    </div>
  );
}
