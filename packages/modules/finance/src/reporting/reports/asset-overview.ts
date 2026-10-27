import { isoDay, paperDate, type DbOrTx } from '@kompass/core';
import { accountBalancesAt, assetOverviewAt, type AccountKind } from '../../ledger/queries';
import { otherAssetsAtInternal } from '../other-assets';
import type { ReportDefinition, ReportParams, ReportRenderContext } from '../types';
import { formatEuro } from '../../format/amount';
import { fiscalYearForInternal } from '../../ledger/fiscal-years';
import { amountCell, checkYearOrDate, heading, paragraph, reportAccountIdsInternal, reportDateInternal, small, strongAmountCell, strongCell, table, textCell, yearIdsOfDate, yearOrDateParamsSchema } from './common';

/**
 * Vermögensübersicht zum Stichtag (Spec Rechenschaft 0.4.0 § Kernberichte, § 260 BGB): Geldkonten, offene
 * Zahlungen, Reinvermögen; davon zweckgebunden, zurückgelegt, frei — wie `assetOverviewAt`. Dazu nachrichtlich die
 * sonstigen Vermögensgegenstände und Verpflichtungen von Hand; leer steht ausdrücklich „Sachwerte nicht erfasst.“
 * Hochformat, Gruppe MV. Stichtag = Ende des Geschäftsjahres oder (nur MCP) ein Tag.
 */

export interface OtherAssetsBlock {
  items: { id: string; kind: 'asset' | 'liability'; valueCents: number }[];
  assetsCents: number;
  liabilitiesCents: number;
  /** `false`: keine Einträge zum Stichtag — der Bericht sagt „Sachwerte nicht erfasst.“ */
  recorded: boolean;
}

export interface AssetOverviewReport {
  date: string;
  accounts: { accountId: string; kind: AccountKind; balanceCents: number }[];
  accountsCents: number;
  receivablesCents: number;
  payablesCents: number;
  netAssetsCents: number;
  earmarkedCents: number;
  reservesCents: number;
  reservesBeyondPurposesCents: number;
  freeCents: number;
  otherAssets: OtherAssetsBlock;
  otherAssetsRecorded: boolean;
}

/** Die sonstigen Einträge zum Stichtag, ohne Bezeichnung (die kommt über `ReportRenderContext.labels`). */
export function otherAssetsBlockInternal(db: DbOrTx, date: string): OtherAssetsBlock {
  const items = otherAssetsAtInternal(db, date).map((a) => ({ id: a.id, kind: a.kind, valueCents: a.valueCents }));
  const sum = (kind: 'asset' | 'liability') => items.filter((i) => i.kind === kind).reduce((s, i) => s + i.valueCents, 0);
  return { items, assetsCents: sum('asset'), liabilitiesCents: sum('liability'), recorded: items.length > 0 };
}

export function computeAssetOverviewReport(db: DbOrTx, params: ReportParams): AssetOverviewReport {
  const date = reportDateInternal(db, params);
  const overview = assetOverviewAt(db, date);
  const kinds = new Map(accountBalancesAt(db, date).map((a) => [a.accountId, a.kind]));
  const otherAssets = otherAssetsBlockInternal(db, date);
  return {
    date,
    // Dieselbe Kontenliste wie der Kassenbericht (Designer Runde 7, 248/244); die Summe bleibt die aller Konten.
    accounts: reportAccountIdsInternal(db, { from: fiscalYearForInternal(db, date)?.startsOn ?? date, to: date }).map((id) => ({ accountId: id, kind: kinds.get(id)!, balanceCents: overview.accounts.find((a) => a.accountId === id)?.balanceCents ?? 0 })),
    accountsCents: overview.accounts.reduce((s, a) => s + a.balanceCents, 0),
    receivablesCents: overview.receivablesCents,
    payablesCents: overview.payablesCents,
    netAssetsCents: overview.netAssetsCents,
    earmarkedCents: overview.earmarkedCents,
    reservesCents: overview.reservesCents,
    reservesBeyondPurposesCents: overview.reservesBeyondPurposesCents,
    freeCents: overview.freeCents,
    otherAssets,
    otherAssetsRecorded: otherAssets.recorded,
  };
}

// ── Papier ─────────────────────────────────────────────────────────────────

export const OTHER_ASSETS_NOT_RECORDED = 'Sachwerte nicht erfasst.';

/** Abschnitt „Sonstiges Vermögen und Verpflichtungen“ (Designer 11h) — derselbe in Vermögensübersicht und Kassenbericht. */
export function otherAssetsTypst(title: string, block: OtherAssetsBlock, date: string, ctx: ReportRenderContext, level = 2): string {
  const parts = [heading(level, `${title} am ${paperDate(isoDay(date))}, in €`)];
  if (!block.recorded) {
    parts.push(paragraph(OTHER_ASSETS_NOT_RECORDED));
    return parts.join('\n\n');
  }
  const rows: string[][] = [];
  for (const [kind, label, total] of [['asset', 'Vermögensgegenstände', block.assetsCents], ['liability', 'Verpflichtungen', block.liabilitiesCents]] as const) {
    const items = block.items.filter((i) => i.kind === kind);
    if (items.length === 0) continue;
    for (const item of items) {
      const name = ctx.labels[`otherAsset.${item.id}`] ?? item.id;
      const basis = ctx.labels[`otherAssetBasis.${item.id}`];
      rows.push([textCell(basis ? `${name} (${basis})` : name), amountCell(item.valueCents)]);
    }
    rows.push([strongCell(`Summe ${label}`), strongAmountCell(total)]);
  }
  parts.push(table('(1fr, 32mm)', ['Bezeichnung (Grundlage)', 'Wert'], rows));
  parts.push(small('Nachrichtlich, nicht in den Beständen.'));
  return parts.join('\n\n');
}

export function assetOverviewTypst(data: AssetOverviewReport, ctx: ReportRenderContext): string {
  const paperDay = paperDate(isoDay(data.date));
  return [
    heading(2, `Geldkonten am ${paperDay}, in €`),
    table('(1fr, 32mm)', ['Konto', 'Bestand'], [...data.accounts.map((a) => [textCell(ctx.accountNames[a.accountId] ?? a.accountId), amountCell(a.balanceCents)]), [strongCell('Summe Geldkonten'), strongAmountCell(data.accountsCents)]]),
    heading(2, 'Vermögen, in €'),
    table('(1fr, 32mm)', ['', 'Betrag'], [
      [textCell('Geldkonten'), amountCell(data.accountsCents)],
      [textCell('Offene Zahlungen an den Verein (Forderungen)'), amountCell(data.receivablesCents)],
      [textCell('Offene Zahlungen des Vereins (Verbindlichkeiten)'), amountCell(-data.payablesCents)],
      [strongCell('Reinvermögen'), strongAmountCell(data.netAssetsCents)],
      [textCell('davon zweckgebunden'), amountCell(data.earmarkedCents)],
      [textCell('davon in Rücklagen (über die Zweckbindung hinaus)'), amountCell(data.reservesBeyondPurposesCents)],
      [strongCell('davon frei'), strongAmountCell(data.freeCents)],
    ]),
    small(`Rücklagen insgesamt ${formatEuro(data.reservesCents)}; eine zweckgebundene Rücklage zählt nur, soweit sie über dem Zweckbestand liegt.`),
    otherAssetsTypst('Sonstiges Vermögen und Verpflichtungen', data.otherAssets, data.date, ctx),
  ].join('\n\n');
}

export const assetOverviewReport: ReportDefinition<AssetOverviewReport> = {
  key: 'assetOverview',
  group: 'assembly',
  personal: false,
  available: true,
  orientation: 'portrait',
  paramsSchema: yearOrDateParamsSchema,
  checkParams: checkYearOrDate,
  years: yearIdsOfDate,
  compute: computeAssetOverviewReport,
  toTypst: assetOverviewTypst,
  titleKey: 'finance.reports.assetOverview.title',
  paperTitle: 'Vermögensübersicht',
};
