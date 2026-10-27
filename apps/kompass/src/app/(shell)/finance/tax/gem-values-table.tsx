'use client';

import type { GemHint, GemLineValue, GemValue, TaxReturnGemReport } from '@kompass/module-finance';
import { GEM_SECTION_TITLES, GEM_UNVERIFIED_NOTE, gemFormFor, type GemLine, type GemSection } from '@kompass/module-finance/gem-forms';
import { ao52NumbersIn, ao52PurposeOf, keepSectionSign } from '@kompass/module-finance/format';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Fragment, useState, type ReactNode } from 'react';
import { useDateFormat } from '@/components/date-format-provider';
import { EMPTY, Empty } from '@/components/empty-value';
import { FormCard, FormCardBody } from '@/components/forms/form-card';
import { LimitProgress, limitState } from '@/components/finance/limit-progress';
import { Notice } from '@/components/notice';
import { Overline } from '@/components/overline';
import { Section } from '@/components/section';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { RowButton, Table, TableBody, TableCell, TableGroupRow, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatEuro } from '@/lib/finance/amount';
import { EndowmentPartyDialog, type EndowmentParty } from './endowment-party-dialog';

type Row = Record<string, string | number | null>;
type ListValue = Extract<GemValue, { kind: 'list' }>;
type PerYearValue = Extract<GemValue, { kind: 'amountPerYear' }>;

export interface GemNames {
  categories: Record<string, string>;
  reserves: Record<string, string>;
}

const linkClass = 'text-link underline-offset-2 hover:underline';
/** Listeneinträge stehen 24 px eingerückt unter ihrer Zeile (Board 15d): 16 px Zellpolster plus 24. */
const SUB = 'pl-10';
/** Zeilen, die nur das letzte Jahr kennen (Board 15d: Overline über dem Block). */
const LAST_YEAR_ONLY = new Set(['11', '18', '24']);

/**
 * Die Werte der Anlage Gem wie im Formular (Board 5a, 15d, 15f): je Abschnitt eine Gruppenzeile, Spalten Zeile · Angabe
 * · je Jahr · Herkunft. Zeile 9 füllt alle Jahre, mit aufklappbarer Zusammensetzung; Zeilen 11–24 stehen nur im letzten
 * Jahr (Overline darüber); alle anderen Einzelwerte ebenso in der Spalte des letzten Jahres. Listenzeilen sind Kopf mit
 * Nummer, darunter je Eintrag eine eingerückte Unterzeile ohne Nummer; ohne Eintrag „keine“. Eine Lücke ist `<Empty />`
 * mit Marke „fehlt“, je fehlender Zeile genau eine. Die Herkunft ist ein Link (Journal, Bericht, Feld oben, Rücklagen).
 */
export function GemValuesTable({
  data,
  names,
  originHrefs,
  canWriteEntries,
}: {
  data: TaxReturnGemReport;
  names: GemNames;
  /** Je Zeilennummer das Ziel der Herkunft; ohne: nur Text. */
  originHrefs: Record<string, string | null>;
  canWriteEntries: boolean;
}) {
  const t = useTranslations('finance.tax.values');
  const tReports = useTranslations('finance.reports');
  const fmt = useDateFormat();
  const [partsOpen, setPartsOpen] = useState(false);
  const [party, setParty] = useState<EndowmentParty | null>(null);
  const form = gemFormFor(data.formYear);
  const defs = new Map((form?.lines ?? []).map((l) => [l.line, l]));
  const years = data.years;
  const last = years.length - 1;
  const cols = 2 + years.length + 2;


  const sections: GemSection[] = [];
  for (const v of data.lines) {
    const section = defs.get(v.line)?.section;
    if (section && !sections.includes(section)) sections.push(section);
  }

  const lineRows = gemRowRenderer({ t, tReports, fmt, names, originHrefs, canWriteEntries, partsOpen, setPartsOpen, setParty, defs, years, last, cols });


  return (
    <Section title={t('title')} intro={t('intro')}>
      <div className="overflow-hidden rounded-md border border-line bg-surface" data-testid="gem-values">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead col="meta" className="w-16">
                {t('columns.line')}
              </TableHead>
              <TableHead col="title">{t('columns.label')}</TableHead>
              {/* Feste Spalten (Designer Runde 7, 16c): Wert je Jahr 120 px, Herkunft 200 px — die Werte springen nicht. */}
              {years.map((y) => (
                <TableHead key={y.id} col="amount" className="w-30 text-right">
                  {y.designation}
                </TableHead>
              ))}
              <TableHead col="status">
                <span className="sr-only">{t('columns.status')}</span>
              </TableHead>
              <TableHead col="meta" wrap className="w-50">
                {t('columns.origin')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sections.map((section) => {
              const inSection = data.lines.filter((l) => defs.get(l.line)?.section === section);
              const firstLastOnly = years.length > 1 ? inSection.find((l) => LAST_YEAR_ONLY.has(l.line))?.line : undefined;
              return (
                <Fragment key={section}>
                  <TableGroupRow colSpan={cols}>{GEM_SECTION_TITLES[section]}</TableGroupRow>
                  {inSection.map((l) => (
                    <Fragment key={l.line}>
                      {l.line === firstLastOnly ? (
                        <TableRow>
                          <TableCell col="span" colSpan={cols}>
                            <Overline>{t('lastYearOnly', { year: years[last]!.designation })}</Overline>
                          </TableCell>
                        </TableRow>
                      ) : null}
                      {lineRows(l)}
                    </Fragment>
                  ))}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {party ? <EndowmentPartyDialog party={party} onClose={() => setParty(null)} /> : null}
    </Section>
  );
}

/** Herkunft einer Zeile: immer ein Link; ohne Ziel (keine Buchung, kein Bericht) „—“ (Designer Runde 7, 16c). */
export function originNode(href: string | null, text: string): ReactNode {
  if (!href || !text) return <Empty />;
  return (
    <Link href={href} className={linkClass}>
      {text}
    </Link>
  );
}

interface RowContext {
  t: ReturnType<typeof useTranslations>;
  tReports: ReturnType<typeof useTranslations>;
  fmt: ReturnType<typeof useDateFormat>;
  names: GemNames;
  originHrefs: Record<string, string | null>;
  canWriteEntries: boolean;
  partsOpen: boolean;
  setPartsOpen: (update: (open: boolean) => boolean) => void;
  setParty: (party: EndowmentParty) => void;
  defs: Map<string, GemLine>;
  years: TaxReturnGemReport['years'];
  last: number;
  cols: number;
}

/** Die Zeilen einer Formularzeile der Tabelle oben (Kopf, Einträge, Zusammensetzung) — nach der Tabelle im Quelltext, wo der Wächter `table-roles` die Zellen liest. */
function gemRowRenderer(c: RowContext): (v: GemLineValue) => ReactNode[] {
  const { t, tReports, fmt, names, originHrefs, canWriteEntries, partsOpen, setPartsOpen, setParty, defs, years, last, cols } = c;
  const yearCells = (values: (ReactNode | null)[], testId?: string) =>
    years.map((y, i) => (
      <TableCell key={y.id} col="amount" className="text-right tabular-nums" selectable data-testid={testId && values[i] !== null ? testId : undefined}>
        {values[i] ?? null}
      </TableCell>
    ));
  const atLast = (node: ReactNode) => yearCells(years.map((_, i) => (i === last ? node : null)));

  const originText = (v: GemLineValue): string => {
    const o = v.origin;
    if (!o) return '';
    if (o.kind === 'report') return tReports.has(`${o.report}.title`) ? tReports(`${o.report}.title`) : o.report;
    if (o.kind === 'lines') return t(`origin.lines.${o.filterKey}`);
    return t(`origin.${o.kind}`);
  };
  // Die Herkunft ist immer ein Link; ohne Treffer „—“ (Designer Runde 7, 16c).
  const originCell = (v: GemLineValue) => <TableCell col="meta" wrap>{originNode(originHrefs[v.line] ?? null, originText(v))}</TableCell>;

  const purposeNumbers = (text: string): ReactNode => {
    const numbers = ao52NumbersIn(text);
    return numbers.length > 0 ? t('purposeNumbers', { numbers: numbers.join(', ') }) : <Empty />;
  };

  const valueText = (def: GemLine, value: GemValue): ReactNode => {
    switch (value.kind) {
      case 'yearRange':
        return value.from === value.to ? value.from : t('range', { from: value.from, to: value.to });
      case 'amount':
        return formatEuro(value.cents);
      case 'yesNo':
        return value.value ? (def.help && def.required ? t('yesInElster') : t('yes')) : t('no');
      case 'date':
        return fmt.date(value.value);
      case 'choice':
        return t(`choice.${value.value}`);
      case 'elster':
        return t('inElster');
      default:
        return null;
    }
  };

  const rowLabel = (row: Row): ReactNode => {
    if ('designation' in row) {
      const label = String(row.designation ?? '')
        .split(',')
        .filter(Boolean)
        .map((id) => names.categories[id] ?? id)
        .join(', ');
      return 'expenseCents' in row ? (
        <>
          {t('businessCombined', { names: label })}
          <span className="block text-meta text-muted-ink">{t('businessSums', { income: formatEuro(Number(row.incomeCents)), expense: formatEuro(Number(row.expenseCents)) })}</span>
        </>
      ) : (
        label
      );
    }
    const missing = (v: unknown) => (v === null || v === undefined ? <Empty /> : String(v));
    if ('asset' in row) {
      return (
        <>
          {names.reserves[String(row.reserveId)] ?? ''}: {missing(row.asset)}
          <span className="block text-meta text-muted-ink">
            {t('replacementSums', {
              cost: row.expectedCostCents === null ? EMPTY : formatEuro(Number(row.expectedCostCents)),
              afa: row.regularDepreciationCents === null ? EMPTY : formatEuro(Number(row.regularDepreciationCents)),
              allocated: formatEuro(Number(row.allocatedCents)),
              dissolved: formatEuro(Number(row.dissolvedCents)),
              balance: formatEuro(Number(row.balanceCents)),
            })}
          </span>
        </>
      );
    }
    if ('company' in row)
      return (
        <>
          {names.reserves[String(row.reserveId)] ?? ''}: {missing(row.company)}
          <span className="block text-meta text-muted-ink">
            {t('taxOffice')} {missing(row.taxOffice)} · {t('taxNumber')} {missing(row.taxNumber)}
          </span>
        </>
      );
    if ('party' in row)
      return (
        <>
          {missing(row.party)}
          <span className="block text-meta text-muted-ink">
            {t('taxOffice')} {missing(row.taxOffice)} · {t('taxNumber')} {missing(row.taxNumber)} · {t('purpose')} {missing(ao52PurposeOf(typeof row.purpose === 'string' ? row.purpose : null) ? `Nr. ${row.purpose}` : null)}
          </span>
        </>
      );
    if ('reason' in row) return String(row.reason);
    if ('reserveId' in row) return names.reserves[String(row.reserveId)] ?? '';
    return null;
  };
  const rowCents = (row: Row): number | null => {
    for (const key of ['resultCents', 'balanceCents', 'amountCents', 'incomeCents']) if (key in row && row[key] !== null) return Number(row[key]);
    return null;
  };

  const partyGap = (row: Row) => 'party' in row && ['party', 'taxOffice', 'taxNumber', 'purpose'].some((k) => row[k] === null || row[k] === undefined);
  const lineRows = (v: GemLineValue): ReactNode[] => {
    const def = defs.get(v.line);
    if (!def) return [];
    const value = v.value;
    const out: ReactNode[] = [];
    const missingBadge = v.missing ? (
      <StatusBadge tone="warning" dot testId="gem-missing">
        {t('missing')}
      </StatusBadge>
    ) : null;
    const lineCell = (text: string) => (
      <TableCell col="meta" className="font-mono max-md:hidden">
        {text}
      </TableCell>
    );
    // Am Telefon steht die Nummer vor dem Text: „5 · Datum der Satzung“ (Designer Runde 7, 16c).
    const phoneNumber = (text: string) => <span className="font-mono md:hidden">{`${text} · `}</span>;

    if (value?.kind === 'amountPerYear') {
      const pv = value as PerYearValue;
      const byYear = new Map(pv.perYear.map((p) => [p.fiscalYearId, p]));
      out.push(
        <TableRow key={v.line} data-testid={`gem-line-${v.line}`}>
          {lineCell(years.map((y) => byYear.get(y.id)?.line).filter(Boolean).join(' · '))}
          <TableCell col="title">
            {phoneNumber(years.map((y) => byYear.get(y.id)?.line).filter(Boolean).join(' · '))}
            {keepSectionSign(def.label)}
            {/* „Zusammensetzung“ in eigener Zeile unter dem Text (Designer Runde 7, 16c). */}
            <span className="block">
              <RowButton type="button" aria-expanded={partsOpen} onClick={() => setPartsOpen((o) => !o)} className="inline-flex items-center gap-1 text-meta" data-testid="gem-parts-toggle">
                <ChevronRight className={`size-3.5 transition-transform ${partsOpen ? 'rotate-90' : ''}`} aria-hidden />
                {t('parts.toggle')}
              </RowButton>
            </span>
          </TableCell>
          {yearCells(years.map((y) => (byYear.has(y.id) ? formatEuro(byYear.get(y.id)!.cents) : null)))}
          <TableCell col="status" />
          {originCell(v)}
        </TableRow>,
      );
      if (partsOpen) {
        const keys = pv.parts.map((p) => p.key).filter((key) => pv.perYear.some((p) => (p.parts.find((x) => x.key === key)?.cents ?? 0) !== 0));
        for (const key of keys) {
          const included = pv.parts.find((p) => p.key === key)?.included ?? true;
          out.push(
            <TableRow key={`9-${key}`} data-testid="gem-part">
              <TableCell col="meta" />
              <TableCell col="title" className={`${SUB} text-muted-ink`}>
                {t(`parts.${key}`)}
                {included ? '' : ` ${t('parts.excluded')}`}
              </TableCell>
              {yearCells(years.map((y) => {
                const cents = byYear.get(y.id)?.parts.find((p) => p.key === key)?.cents ?? 0;
                return <span className="text-muted-ink">{formatEuro(cents)}</span>;
              }))}
              <TableCell col="status" />
              <TableCell col="meta" />
            </TableRow>,
          );
        }
        out.push(
          <TableRow key="9-note">
            <TableCell col="span" colSpan={cols} className={`${SUB} whitespace-normal text-meta text-muted-ink`}>
              {t('parts.note')}
            </TableCell>
          </TableRow>,
        );
      }
      return out;
    }

    if (value?.kind === 'list') {
      const list = value as ListValue;
      out.push(
        <TableRow key={v.line} data-testid={`gem-line-${v.line}`}>
          {lineCell(v.line)}
          <TableCell col="title">
            {phoneNumber(v.line)}
            {keepSectionSign(def.label)}
          </TableCell>
          {atLast(missingBadge ?? (list.rows.length === 0 ? <span className="text-muted-ink">{t('none')}</span> : <span className="text-muted-ink">{t('entries', { count: list.rows.length })}</span>))}
          <TableCell col="status" />
          {originCell(v)}
        </TableRow>,
      );
      list.rows.forEach((row, i) => {
        const gap = partyGap(row) && typeof row.contactId === 'string' && canWriteEntries;
        const cents = rowCents(row);
        out.push(
          <TableRow key={`${v.line}-${i}`} data-testid={`gem-entry-${v.line}`}>
            <TableCell col="meta" />
            <TableCell col="title" className={SUB}>
              {rowLabel(row)}
              {gap ? (
                <Button
                  type="button"
                  variant="link"
                  className="block h-auto p-0 text-meta font-normal"
                  onClick={() => setParty({ contactId: String(row.contactId), name: String(row.party ?? ''), taxOffice: (row.taxOffice as string | null) ?? null, taxNumber: (row.taxNumber as string | null) ?? null, purpose: (row.purpose as string | null) ?? null, role: v.line === '65' ? 'recipient' : 'giver' })}
                  data-testid={`gem-party-${v.line}`}
                >
                  {t(v.line === '65' ? 'partyRecipient' : 'partyGiver')}
                </Button>
              ) : null}
            </TableCell>
            {atLast(cents === null ? null : formatEuro(cents))}
            <TableCell col="status" />
            <TableCell col="meta" />
          </TableRow>,
        );
      });
      return out;
    }

    const missingValue = v.missing && (value === null || value === undefined);
    out.push(
      <TableRow key={v.line} data-testid={`gem-line-${v.line}`}>
        {lineCell(v.line)}
        <TableCell col="title">
          {phoneNumber(v.line)}
          {keepSectionSign(def.label)}
          {/* Der Text der Zwecke steht unter der Angabe, die Nummern nach § 52 AO in der Wertspalte (Designer Runde 7, 321). */}
          {value?.kind === 'text' ? <span className="block text-meta text-ink-2">{value.value}</span> : null}
          {/* Die Hilfe ist ein Satz und bricht um (`p`, MUSTER § G Kartenzeile): Als `span` kürzte die Kartenzeile sie als
              zweite Unterzeile einzeilig, ihre volle Breite schob am Telefon die Wertspalte aus der Karte („Nr. 4, 14“ →
              „Nr“, Befund 30 e). Kein Layout-Test für die Einzelstelle; den Rückfall fängt der Überlauf-Wächter der
              Bild-Pipeline (Zellen gegen ihren abschneidenden Behälter). */}
          {def.help && def.kind !== 'yesNo' ? <p className="text-meta text-muted-ink">{keepSectionSign(def.help)}</p> : null}
        </TableCell>
        {/* „fehlt“ steht in der Wertspalte, nicht daneben: die Werte springen nicht (16c). Die Herkunft „Ihre Angabe“ führt zum Feld. */}
        {atLast(missingValue ? missingBadge : value && value.kind !== 'text' ? valueText(def, value) : value?.kind === 'text' ? purposeNumbers(value.value) : value === null ? <Empty /> : null)}
        <TableCell col="status" />
        {originCell(v)}
      </TableRow>,
    );
    return out;
  };
  return lineRows;
}

/**
 * Hinweise unter der Tabelle (Board 15f, 16d): eine Karte „Hinweise“ mit Zeilen ohne Symbol, die Anlagen als Liste;
 * Grenzen mit Abstand als `LimitProgress` wie unter „Fristen und Schwellen“ (6a). Was eine Pflicht auslöst, steht als
 * `Notice warn` darüber.
 */
export function GemHints({ hints }: { hints: readonly GemHint[] }) {
  const th = useTranslations('finance.tax.hints');
  const fmt = useDateFormat();
  const progress = (label: string, cents: number, limitCents: number) => {
    // Unter der Grenze ohne Marke: Den Abstand zeigt der Balken (6a).
    const raw = limitState({ valueCents: cents, limitCents, warnAtPercent: 80, kind: 'limit' });
    const state = raw === 'calm' ? null : raw;
    return <LimitProgress label={label} coveredCents={cents} totalCents={limitCents} state={state} stateLabel={state ? th(`limit.${state}`) : undefined} figure={th('limit.figure', { value: formatEuro(cents), limit: formatEuro(limitCents) })} />;
  };
  const annexes = (needed: boolean) => (
    <ul className="mt-1 flex flex-col gap-0.5">
      {(['gk', 'zve', 'gewSt'] as const).map((k) => (
        <li key={k}>{th(`annexes.${k}`, { needed: needed ? 'yes' : 'no' })}</li>
      ))}
    </ul>
  );
  const body = (h: GemHint): ReactNode => {
    switch (h.code) {
      case 'kst1FullyExempt':
        return (
          <>
            {th('kst1FullyExempt', { count: h.years.length })}
            {annexes(false)}
            <div className="mt-2 flex flex-col gap-2">{h.years.map((y) => <Fragment key={y.designation}>{progress(th('businessYear', { year: y.designation }), y.cents, y.limitCents)}</Fragment>)}</div>
          </>
        );
      case 'businessOverLimit':
        return (
          <>
            {th('businessOverLimit', { year: h.designation, amount: formatEuro(h.cents), limit: formatEuro(h.limitCents) })}
            {annexes(true)}
          </>
        );
      case 'vatReturnRequired':
        return th('vatReturnRequired', { year: String(h.year), date: fmt.date(h.dueOn) });
      case 'timelyUse':
        if (h.limitCents === null) return th('timelyUseAlways', { year: h.designation });
        return (
          <>
            {th(h.required ? 'timelyUseRequired' : 'timelyUseNot', { year: h.designation, amount: formatEuro(h.cents), limit: formatEuro(h.limitCents) })}
            <div className="mt-2">{progress(th('revenueYear', { year: h.designation }), h.cents, h.limitCents)}</div>
          </>
        );
      case 'gratuitousCandidates':
        return th('gratuitousCandidates', { count: h.count, amount: formatEuro(h.cents) });
      case 'endowmentNotToAssets':
        return th('endowmentNotToAssets', { count: h.count });
      case 'formAssumed':
        return th('formAssumed', { year: h.formYear });
      case 'unverifiedLines':
        return th('unverifiedLines', { note: GEM_UNVERIFIED_NOTE });
      default:
        return th(h.code);
    }
  };
  // Was eine Pflicht auslöst (USt-Erklärung wegen § 13b), steht als Warnung darüber, mit dem Weg zu den Fristen — die
  // Frist kommt aus derselben Quelle wie dort; alles andere steht als Zeilen in einer Karte (Designer Runde 7, 16d).
  const duties = hints.filter((h) => h.code === 'vatReturnRequired');
  const rest = hints.filter((h) => h.code !== 'vatReturnRequired');
  return (
    <>
      {duties.map((h, i) => (
        <Notice key={`duty-${i}`} level="warn" testId="gem-duty">
          {body(h)}{' '}
          <Link href="/finance/deadlines" className={linkClass}>
            {th('toDeadlines')}
          </Link>
        </Notice>
      ))}
      {rest.length > 0 ? (
        // Titel in der Karte wie die Beilagen darunter (16d), Zeilen mit Trennlinie wie `RequirementList variant="rows"`.
        <FormCard as="section">
          <FormCardBody>
            <Section title={th('title')}>
              <ul className="border-t border-line-2" data-testid="gem-hints">
                {rest.map((h, i) => (
                  <li key={`${h.code}-${i}`} className="border-b border-line-2 py-2.5 text-body last:border-b-0">
                    {body(h)}
                  </li>
                ))}
              </ul>
            </Section>
          </FormCardBody>
        </FormCard>
      ) : null}
    </>
  );
}
