import { EMPTY, notFound, paperDate, type DbOrTx, type Failure } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { partnerProofDeadlinesInternal, positionViewsOf, sumPositionCents } from '../../allocation/partner-proof';
import { countOpenRawTransactionsInternal } from '../../import/queries';
import { fiscalYearForInternal } from '../../ledger/fiscal-years';
import { noticeValidAt } from '../../ledger/notice-validity';
import { openItemsAtInternal } from '../../ledger/open-items';
import {
  financeAccounts, financeAllocationCorrections, financeEntries, financeExpenseClaims, financeExpensePositions, financeMoneyLines, financeNotices, financeOpenItems, financePartnerPayments, financePartnerProfiles, financePurposeTransfers,
} from '../../schema';
import type { ReportComputeEnv, ReportDefinition, ReportParams, ReportRenderContext } from '../types';
import { amountCell, heading, paragraph, table, textCell } from './common';

/**
 * Übergabeliste (Finanz-Spec § 9.2, Rechenschaft B1 Task 10): was offen ist und an wem es hängt, zu einem Stichtag —
 * für die Amtsübergabe. Vorgänge, die jemand angelegt oder eingereicht hat (Entwurf, Auslage, Zahlung an Partner,
 * Umwidmung, Korrektur), stehen bei dieser Person; offene Zahlungen, Nachweisfristen, offene Umsätze und die Gültigkeit
 * des Freistellungsbescheids beim Verein (Entscheidung 7 des Plans). Der Bestand ist der heutige; der Stichtag bestimmt
 * Fälligkeit, „überfällig“ und die Gültigkeit des Bescheids. Mit Personenbezug.
 */

export type HandoverItemKind = 'draftEntry' | 'expenseClaim' | 'partnerPayment' | 'purposeTransfer' | 'correction' | 'openItem' | 'partnerProof' | 'openTransactions' | 'noticeValidity';

export interface HandoverItem {
  kind: HandoverItemKind;
  refId: string;
  refNumber: string | null;
  date: string | null;
  dueOn: string | null;
  overdue: boolean;
  amountCents: number | null;
  contactName: string | null;
  /** Nur bei `openTransactions`: Anzahl offener Umsätze des Kontos. Bei `openItem`: Raten einer Person zusammengefasst. */
  count?: number;
  /** Nur bei zusammengefassten Raten (`openItem` mit `count`): wie viele davon überfällig sind. */
  overdueCount?: number;
  /** Nur bei `draftEntry`: der Buchungstext des Entwurfs (Designer Runde 7, 268). */
  text?: string | null;
}

export interface HandoverListReport {
  date: string;
  groups: { userId: string | null; items: HandoverItem[] }[];
}

const GRACE_KEY = 'finance.proofGraceDays';
const KIND_ORDER: readonly HandoverItemKind[] = ['draftEntry', 'expenseClaim', 'partnerPayment', 'purposeTransfer', 'correction', 'openItem', 'partnerProof', 'openTransactions', 'noticeValidity'];

const paramsSchema: z.ZodType<ReportParams> = z.object({ date: z.iso.date() }).strict();

function checkParams(db: DbOrTx, params: ReportParams): Failure | null {
  return fiscalYearForInternal(db, params.date!) ? null : notFound('financeFiscalYear', params.date!);
}

const dayOf = (value: string | null): string | null => (value === null ? null : value.slice(0, 10));
const item = (kind: HandoverItemKind, refId: string, o: Partial<Omit<HandoverItem, 'kind' | 'refId'>> = {}): HandoverItem => ({ kind, refId, refNumber: null, date: null, dueOn: null, overdue: false, amountCents: null, contactName: null, ...o });

export function computeHandoverListReport(db: DbOrTx, params: ReportParams, env: ReportComputeEnv): HandoverListReport {
  const date = params.date!;
  const graceDays = typeof env.settings[GRACE_KEY] === 'number' ? (env.settings[GRACE_KEY] as number) : 0;
  const contactNames = new Map<string, string>();
  const nameOf = (contactId: string | null | undefined): string | null => {
    if (!contactId) return null;
    if (!contactNames.has(contactId)) {
      const row = db.select().from(contacts).where(eq(contacts.id, contactId)).get();
      contactNames.set(contactId, row ? displayName(row) : '');
    }
    return contactNames.get(contactId) ?? null;
  };
  const partnerContact = (partnerId: string) => db.select({ contactId: financePartnerProfiles.contactId }).from(financePartnerProfiles).where(eq(financePartnerProfiles.id, partnerId)).get()?.contactId ?? null;
  const byUser = new Map<string | null, HandoverItem[]>();
  const add = (userId: string | null, it: HandoverItem) => byUser.set(userId, [...(byUser.get(userId) ?? []), it]);

  // An der Person: Entwürfe, eingereichte Auslagen und Zahlungen an Partner, beantragte Umwidmungen und Korrekturen.
  const drafts = db.select().from(financeEntries).where(ne(financeEntries.status, 'final')).all();
  const money = drafts.length === 0 ? [] : db.select().from(financeMoneyLines).where(inArray(financeMoneyLines.entryId, drafts.map((d) => d.id))).all();
  for (const d of drafts) add(d.createdByUserId, item('draftEntry', d.id, { refNumber: d.number, date: d.entryDate, amountCents: money.filter((m) => m.entryId === d.id).reduce((s, m) => s + m.amountCents, 0), text: d.text || null }));

  for (const c of db.select().from(financeExpenseClaims).where(eq(financeExpenseClaims.state, 'submitted')).all()) {
    const total = db.select({ amountCents: financeExpensePositions.amountCents }).from(financeExpensePositions).where(eq(financeExpensePositions.claimId, c.id)).all().reduce((s, p) => s + p.amountCents, 0);
    add(c.submittedByUserId, item('expenseClaim', c.id, { refNumber: c.number, date: dayOf(c.submittedAt), amountCents: total, contactName: nameOf(c.contactId) }));
  }
  for (const p of db.select().from(financePartnerPayments).where(eq(financePartnerPayments.state, 'submitted')).all()) {
    add(p.createdByUserId, item('partnerPayment', p.id, { refNumber: p.number, date: dayOf(p.createdAt), amountCents: sumPositionCents(positionViewsOf(db, p.id)), contactName: nameOf(partnerContact(p.partnerId)) }));
  }
  for (const t of db.select().from(financePurposeTransfers).where(eq(financePurposeTransfers.state, 'submitted')).all()) {
    add(t.createdByUserId, item('purposeTransfer', t.id, { refNumber: t.number, date: t.transferDate, amountCents: t.amountCents }));
  }
  for (const c of db.select({ id: financeAllocationCorrections.id, requestedByUserId: financeAllocationCorrections.requestedByUserId, requestedAt: financeAllocationCorrections.requestedAt, number: financeEntries.number }).from(financeAllocationCorrections).innerJoin(financeEntries, eq(financeEntries.id, financeAllocationCorrections.entryId)).where(eq(financeAllocationCorrections.state, 'pending')).all()) {
    add(c.requestedByUserId, item('correction', c.id, { refNumber: c.number, date: dayOf(c.requestedAt) }));
  }

  // Beim Verein: offene Zahlungen, Nachweisfristen, offene Umsätze je Konto, Gültigkeit des Bescheids.
  const open = openItemsAtInternal(db, date);
  const openRows = new Map(open.length === 0 ? [] : db.select().from(financeOpenItems).where(inArray(financeOpenItems.id, open.map((o) => o.id))).all().map((r) => [r.id, r]));
  // Raten aus demselben Vorgang einer Person (Beiträge, Zusagen) stehen als eine Zeile: „8 Raten, davon 5 überfällig“
  // mit der Summe (Designer Runde 7, 268) — sonst machen Monatsbeiträge aus zwei Personen zwanzig Zeilen.
  const rates = new Map<string, { ids: string[]; first: string; dueOn: string | null; overdue: number; cents: number; contactId: string | null }>();
  for (const o of open) {
    const row = openRows.get(o.id)!;
    const overdue = row.dueOn !== null && row.dueOn < date;
    const key = row.originType !== null && row.contactId !== null ? `${row.originType}|${row.contactId}` : null;
    const peers = key ? open.filter((x) => { const p = openRows.get(x.id)!; return p.originType === row.originType && p.contactId === row.contactId; }) : [];
    if (key && peers.length > 1) {
      const g = rates.get(key) ?? { ids: [], first: row.itemDate, dueOn: row.dueOn, overdue: 0, cents: 0, contactId: row.contactId };
      g.ids.push(o.id);
      g.first = g.first < row.itemDate ? g.first : row.itemDate;
      if (row.dueOn !== null && (g.dueOn === null || row.dueOn < g.dueOn)) g.dueOn = row.dueOn;
      g.overdue += overdue ? 1 : 0;
      g.cents += o.openCents;
      rates.set(key, g);
      continue;
    }
    add(null, item('openItem', o.id, { refNumber: row.paymentReference, date: row.itemDate, dueOn: row.dueOn, overdue, amountCents: o.openCents, contactName: nameOf(row.contactId) }));
  }
  for (const g of rates.values()) {
    add(null, item('openItem', g.ids.sort()[0]!, { date: g.first, dueOn: g.dueOn, overdue: g.overdue > 0, amountCents: g.cents, contactName: nameOf(g.contactId), count: g.ids.length, overdueCount: g.overdue }));
  }
  for (const d of partnerProofDeadlinesInternal(db, date, graceDays)) {
    const p = db.select({ number: financePartnerPayments.number }).from(financePartnerPayments).where(eq(financePartnerPayments.id, d.paymentId)).get();
    add(null, item('partnerProof', d.paymentId, { refNumber: p?.number ?? null, dueOn: d.proofDueOn, overdue: d.overdue, contactName: nameOf(partnerContact(d.partnerId)) }));
  }
  for (const account of db.select({ id: financeAccounts.id }).from(financeAccounts).all()) {
    const count = countOpenRawTransactionsInternal(db, account.id);
    if (count > 0) add(null, item('openTransactions', account.id, { count }));
  }
  const valid = noticeValidAt(db.select().from(financeNotices).all(), date);
  add(null, valid ? item('noticeValidity', valid.notice.id, { date: valid.notice.noticeDate, dueOn: valid.validUntil }) : item('noticeValidity', '', { overdue: true }));

  const order = (a: HandoverItem, b: HandoverItem) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || (a.date ?? a.dueOn ?? '').localeCompare(b.date ?? b.dueOn ?? '') || a.refId.localeCompare(b.refId);
  const people = [...byUser.keys()].filter((k): k is string => k !== null).sort();
  return {
    date,
    groups: [...people, null].filter((userId) => byUser.has(userId)).map((userId) => ({ userId, items: byUser.get(userId)!.sort(order) })),
  };
}

// ── Papier ─────────────────────────────────────────────────────────────────

const KIND_TEXT: Record<HandoverItemKind, string> = {
  draftEntry: 'Buchungsentwurf',
  expenseClaim: 'Auslage zur Freigabe',
  partnerPayment: 'Zahlung an Partner zur Freigabe',
  purposeTransfer: 'Umwidmung zur Freigabe',
  correction: 'Korrektur zur Freigabe',
  openItem: 'offene Zahlung',
  partnerProof: 'Nachweis eines Partners',
  openTransactions: 'offene Kontoumsätze',
  noticeValidity: 'Freistellungsbescheid gültig bis',
};

const day = (value: string | null) => (value ? paperDate(value as never) : '');
const ratesText = (count: number, overdue: number) => (overdue > 0 ? `${count} Raten, davon ${overdue} überfällig` : `${count} Raten`);

export function handoverListTypst(data: HandoverListReport, ctx: ReportRenderContext): string {
  const titleOf = (userId: string | null) => (userId === null ? 'Verein' : (ctx.labels[`user.${userId}`] ?? userId));
  // Personen nach Namen, der Verein zuletzt.
  const groups = [...data.groups].sort((a, b) => (a.userId === null ? 1 : b.userId === null ? -1 : titleOf(a.userId).localeCompare(titleOf(b.userId), 'de')));
  const parts: string[] = [];
  for (const g of groups) {
    parts.push(heading(2, titleOf(g.userId)));
    parts.push(
      table(
        '(1fr, 28mm, 22mm, 22mm, 26mm)',
        ['Art', 'Nr.', 'Datum', 'fällig', 'in €'],
        g.items.map((i) => {
          const what = i.kind === 'openTransactions' ? `${KIND_TEXT[i.kind]}: ${i.count ?? 0} (${ctx.accountNames[i.refId] ?? ''})` : i.kind === 'noticeValidity' && !i.dueOn ? 'kein gültiger Freistellungsbescheid' : [KIND_TEXT[i.kind], i.contactName, i.text, i.kind === 'openItem' && i.count ? ratesText(i.count, i.overdueCount ?? 0) : null].filter(Boolean).join(' · ');
          // Zusammengefasste Raten: das früheste Fälligkeitsdatum, überfällig steht schon im Text.
          const due = i.kind === 'openItem' && i.count ? day(i.dueOn) : i.overdue && i.dueOn ? `${day(i.dueOn)} (überfällig)` : day(i.dueOn);
          return [textCell(what), textCell(i.refNumber ?? ''), textCell(day(i.date)), textCell(due), i.amountCents === null ? `table.cell(align: right)${textCell(EMPTY)}` : amountCell(i.amountCents)];
        }),
      ),
    );
  }
  if (groups.length === 0) parts.push(paragraph('Zum Stichtag ist nichts offen.'));
  return parts.join('\n\n');
}

export const handoverListReport: ReportDefinition<HandoverListReport> = {
  key: 'handoverList',
  group: 'work',
  personal: true,
  // Arbeitsliste zum Stichtag: nur herunterladen, nie festschreiben (Joe 2026-10-25).
  finalizable: false,
  available: true,
  orientation: 'portrait',
  paramsSchema,
  checkParams,
  years: (db, params) => {
    const row = params.date ? fiscalYearForInternal(db, params.date) : null;
    return row ? [row.id] : [];
  },
  settingKeys: [GRACE_KEY],
  compute: computeHandoverListReport,
  toTypst: handoverListTypst,
  titleKey: 'finance.reports.handoverList.title',
  paperTitle: 'Übergabeliste',
};
