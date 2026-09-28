import type { EntryLinesInput, SuggestionDraft } from '@kompass/module-finance';
import { formatAmount, parseAmount } from './amount';
import { emptyForm, fromEntryView, type EntryFormState, type SplitRowState } from './entry-form';

/**
 * Die Arbeitsliste (F5 Task 7, HANDOFF § 12.5): Adresse, Auswahl und die
 * Mini-Maske — nur Umrechnungen zwischen Formular und Dienst. Was ein
 * Vorschlag ist und ob er sich buchen lässt, entscheiden die Dienste.
 */
export const WORK_TABS = ['open', 'unsure', 'agent', 'reviewed', 'due'] as const;
export type WorkTabKey = (typeof WORK_TABS)[number];

export function parseWorkTab(value: string | undefined): WorkTabKey {
  return (WORK_TABS as readonly string[]).includes(value ?? '') ? (value as WorkTabKey) : 'open';
}

/** Der Reiter steht in der Adresse (HANDOFF § 12.6) — ein Neuladen bleibt, wo man war. */
export function workHref(query: { tab: WorkTabKey; account?: string | null; raw?: string | null }): string {
  const params = new URLSearchParams();
  if (query.tab !== 'open') params.set('tab', query.tab);
  if (query.account) params.set('account', query.account);
  if (query.raw) params.set('raw', query.raw);
  const search = params.toString();
  return search ? `/finance/work?${search}` : '/finance/work';
}

/** `↑`/`↓`: eine Zeile weiter, an den Enden stehen bleiben. */
export function stepSelection(ids: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const index = current === null ? -1 : ids.indexOf(current);
  if (index === -1) return ids[0]!;
  return ids[Math.min(ids.length - 1, Math.max(0, index + step))]!;
}

/** Nach dem Übernehmen: der nächste Umsatz, am Ende der vorige. */
export function afterRemoval(ids: readonly string[], removed: string): string | null {
  const index = ids.indexOf(removed);
  const rest = ids.filter((id) => id !== removed);
  if (rest.length === 0) return null;
  return rest[Math.min(Math.max(index, 0), rest.length - 1)]!;
}

/** Was die Arbeitsliste von einem Kontoumsatz braucht. */
export interface WorkRaw {
  id: string;
  accountId: string;
  bookingDate: string;
  amountCents: number;
  counterpartyName: string | null;
  purpose: string;
}

/** Vorbelegter Buchungstext ohne Vorschlag: Gegenpartei und Verwendungszweck, wie der Dienst ihn selbst bilden würde. */
function bankText(raw: WorkRaw): string {
  const text = [raw.counterpartyName, raw.purpose].map((s) => (s ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean).join(' · ');
  return (text || raw.bookingDate).slice(0, 300);
}

export interface MiniFormRow extends SplitRowState {
  contactName?: string | null;
}

export interface MiniFormState {
  entryDate: string;
  text: string;
  /** −1 bei Ausgang: Die Maske zeigt Beträge wie die volle Maske bei „Ausgabe“ ohne Minus. */
  sign: 1 | -1;
  /** Σ der Geldzeilen des Vorschlags (bei einer Umbuchung beide Seiten), ohne Vorschlag der Betrag des Umsatzes. */
  moneyCents: number;
  rows: MiniFormRow[];
}

const row = (index: number, fields: Partial<MiniFormRow>): MiniFormRow => ({
  key: `mini-${index + 1}`, categoryId: '', amountText: '', contactId: null, projectId: null, purposeId: null, abroad: false, addsToAssets: false, ...fields,
});

export function miniFormFromSuggestion(raw: WorkRaw, draft: SuggestionDraft | null, contactNames: ReadonlyMap<string, string>): MiniFormState {
  const sign: 1 | -1 = raw.amountCents < 0 ? -1 : 1;
  if (!draft) {
    return { entryDate: raw.bookingDate, text: bankText(raw), sign, moneyCents: raw.amountCents, rows: [row(0, { amountText: formatAmount(Math.abs(raw.amountCents)) })] };
  }
  return {
    entryDate: draft.entryDate,
    text: draft.text,
    sign,
    moneyCents: draft.moneyLines.reduce((sum, l) => sum + l.amountCents, 0),
    rows: draft.allocationLines.map((line, index) =>
      row(index, {
        categoryId: line.categoryId,
        amountText: formatAmount(line.amountCents * sign),
        taxCode: line.taxCode ?? undefined,
        contactId: line.contactId ?? null,
        contactName: line.contactId ? (contactNames.get(line.contactId) ?? null) : null,
        projectId: line.projectId ?? null,
        purposeId: line.purposeId ?? null,
        abroad: line.abroad ?? false,
      }),
    ),
  };
}

/** Was noch zu verteilen ist, im Vorzeichen der Maske; `null`, solange ein Betrag unlesbar ist. */
export function miniFormRemainder(state: MiniFormState): number | null {
  let allocated = 0;
  for (const r of state.rows) {
    const parsed = parseAmount(r.amountText);
    if (parsed === null) return null;
    allocated += parsed * state.sign;
  }
  return (state.moneyCents - allocated) * state.sign + 0;
}

export interface BookFromTransactionInput {
  rawTransactionId: string;
  entryDate: string;
  text: string;
  allocationLines: EntryLinesInput['allocationLines'];
  extraMoneyLines?: EntryLinesInput['moneyLines'];
  settlements?: { openItemId: string; amountCents: number }[];
  reviewed: true;
}

/** „Übernehmen und geprüft“: die Maske als Eingabe für `bookFromTransaction` — weitere Geldzeilen und Begleichungen aus dem Vorschlag. */
export function miniFormToBookInput(state: MiniFormState, rawTransactionId: string, draft: SuggestionDraft | null): { ok: true; input: BookFromTransactionInput } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  if (!state.entryDate) fieldErrors.entryDate = 'required';
  if (!state.text.trim()) fieldErrors.text = 'required';
  const allocationLines: EntryLinesInput['allocationLines'] = [];
  state.rows.forEach((r, index) => {
    const parsed = parseAmount(r.amountText);
    if (parsed === null) {
      fieldErrors[`rows.${index}.amountText`] = 'format';
      return;
    }
    if (!r.categoryId) {
      fieldErrors[`rows.${index}.categoryId`] = 'required';
      return;
    }
    allocationLines.push({
      categoryId: r.categoryId,
      amountCents: parsed * state.sign,
      ...(r.taxCode ? { taxCode: r.taxCode as EntryLinesInput['allocationLines'][number]['taxCode'] } : {}),
      contactId: r.contactId,
      projectId: r.projectId,
      purposeId: r.purposeId,
      abroad: r.abroad,
    });
  });
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const [own, ...extra] = draft?.moneyLines ?? [];
  const input: BookFromTransactionInput = { rawTransactionId, entryDate: state.entryDate, text: state.text.trim(), allocationLines, reviewed: true };
  if (extra.length > 0) input.extraMoneyLines = extra;
  if (own?.settlements && own.settlements.length > 0) input.settlements = own.settlements;
  return { ok: true, input };
}

/**
 * `?raw=` der vollen Maske („Ändern“ aus der Arbeitsliste): Konto, Betrag,
 * Richtung und Bindung aus dem Kontoumsatz, Text und Aufteilung aus dem
 * Vorschlag. Ohne Vorschlag eine Zeile mit dem ganzen Betrag.
 */
export function formFromTransaction(raw: WorkRaw, draft: SuggestionDraft | null): EntryFormState {
  if (draft) {
    const form = fromEntryView({ id: '', entryDate: draft.entryDate, text: draft.text, moneyLines: draft.moneyLines, allocationLines: draft.allocationLines.map((l) => ({ ...l, taxCode: l.taxCode ?? undefined })) });
    return {
      ...form,
      id: undefined,
      expectedVersion: undefined,
      moneyRows: form.moneyRows.map((m) => (m.rawTransactionId === raw.id ? { ...m, rawBookingDate: raw.bookingDate } : m)),
    };
  }
  const template = raw.amountCents < 0 ? 'expense' : 'income';
  const base = emptyForm(template, raw.bookingDate);
  const amountText = formatAmount(Math.abs(raw.amountCents));
  return {
    ...base,
    text: bankText(raw),
    moneyRows: base.moneyRows.map((m) => ({ ...m, accountId: raw.accountId, amountText, rawTransactionId: raw.id, rawBookingDate: raw.bookingDate })),
    splitRows: [row(0, { key: 'split-1', amountText })],
  };
}
