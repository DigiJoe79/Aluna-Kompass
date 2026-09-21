import type { EntryLinesInput } from '@kompass/module-finance';
import { formatAmount, parseAmount } from './amount';

export type EntryTemplate = 'income' | 'expense' | 'transfer' | 'inKind';

export interface MoneyRow {
  key: string;
  accountId: string;
  amountText: string;
  direction: 'in' | 'out';
  settlements: { openItemId: string; amountText: string }[];
}

export interface SplitRowState {
  key: string;
  categoryId: string;
  amountText: string;
  taxCode?: string;
  rateKind?: 'standard' | 'reduced';
  contactId: string | null;
  projectId: string | null;
  purposeId: string | null;
  abroad: boolean;
  addsToAssets: boolean;
  locked?: boolean;
}

export interface EntryFormState {
  id?: string;
  expectedVersion?: string;
  entryDate: string;
  text: string;
  template: EntryTemplate;
  moneyRows: MoneyRow[];
  splitRows: SplitRowState[];
}

/** Shape, wie `fromEntryView` sie von einer `EntryView` des Kerns braucht — nur die gelesenen Felder. */
export interface EntryViewLike {
  id: string;
  expectedVersion?: string;
  updatedAt?: string;
  entryDate: string;
  text: string;
  moneyLines: { accountId: string; amountCents: number; settlements?: { openItemId: string; amountCents: number }[] }[];
  allocationLines: {
    categoryId: string;
    amountCents: number;
    taxCode?: string;
    rateKind?: 'standard' | 'reduced';
    contactId?: string | null;
    projectId?: string | null;
    purposeId?: string | null;
    abroad?: boolean;
    addsToAssets?: boolean;
  }[];
}

const emptySplitRow = (key: string): SplitRowState => ({ key, categoryId: '', amountText: '', contactId: null, projectId: null, purposeId: null, abroad: false, addsToAssets: false });
const emptyMoneyRow = (key: string, direction: 'in' | 'out'): MoneyRow => ({ key, accountId: '', amountText: '', direction, settlements: [] });

/**
 * Baut die Zeilen einer Vorlage. `transfer`: zwei Geldzeilen (out/in), keine
 * Zuordnungszeilen. `inKind`: keine Geldzeile, zwei gekoppelte
 * Zuordnungszeilen — die zweite ist `locked` und folgt der ersten mit dem
 * negierten Betrag; ein erneuter Aufruf mit derselben Vorlage zieht diese
 * Kopplung nach, ohne die erste Zeile oder ihre eigenen Felder zu verlieren.
 * `income`/`expense`: eine Geldzeile mit der passenden Richtung.
 */
export function applyTemplate(state: EntryFormState, template: EntryTemplate): EntryFormState {
  if (template === 'transfer') {
    const keep = state.template === 'transfer' && state.moneyRows.length === 2 ? state.moneyRows : null;
    return {
      ...state,
      template,
      moneyRows: keep ?? [emptyMoneyRow('money-out', 'out'), emptyMoneyRow('money-in', 'in')],
      splitRows: [],
    };
  }
  if (template === 'inKind') {
    const already = state.template === 'inKind' && state.splitRows.length >= 2 ? state.splitRows : null;
    const first: SplitRowState = already ? { ...already[0]!, locked: false } : emptySplitRow('split-a');
    const firstCents = parseAmount(first.amountText);
    const secondBase = already ? already[1]! : emptySplitRow('split-b');
    const second: SplitRowState = { ...secondBase, amountText: firstCents === null ? secondBase.amountText : formatAmount(-firstCents), locked: true };
    return { ...state, template, moneyRows: [], splitRows: [first, second] };
  }
  const direction: 'in' | 'out' = template === 'income' ? 'in' : 'out';
  const keepMoney = state.template === template && state.moneyRows[0] ? state.moneyRows[0] : emptyMoneyRow('money-1', direction);
  const keepSplit = state.template === template ? state.splitRows : [];
  return { ...state, template, moneyRows: [{ ...keepMoney, direction }], splitRows: keepSplit };
}

/** Ein frisches Formular für die gewählte Vorlage. */
export function emptyForm(template: EntryTemplate, today: string): EntryFormState {
  return applyTemplate({ entryDate: today, text: '', template, moneyRows: [], splitRows: [] }, template);
}

/** Σ Geldzeilen − Σ Zuordnungszeilen, nach der Vorzeichenregel der Vorlage. `null`, solange ein Betrag unlesbar ist. */
export function remainderCents(state: EntryFormState): number | null {
  let moneySum = 0;
  for (const row of state.moneyRows) {
    const parsed = parseAmount(row.amountText);
    if (parsed === null) return null;
    moneySum += row.direction === 'in' ? parsed : -parsed;
  }
  let allocationSum = 0;
  for (const row of state.splitRows) {
    const parsed = parseAmount(row.amountText);
    if (parsed === null) return null;
    allocationSum += state.template === 'expense' ? -parsed : parsed;
  }
  return moneySum - allocationSum;
}

/**
 * Formularzustand → Dienst-Eingabe (Vorzeichenregel): Geldzeile `in` = +,
 * `out` = −. In `income`/`inKind` gehen eingegebene Beträge mit ihrem eigenen
 * Vorzeichen ein; in `expense` wird der eingegebene Betrag negiert.
 */
export function toServiceInput(state: EntryFormState): { ok: true; input: EntryLinesInput } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  if (!state.entryDate) fieldErrors.entryDate = 'required';
  if (!state.text.trim()) fieldErrors.text = 'required';

  const moneyLines: EntryLinesInput['moneyLines'] = [];
  state.moneyRows.forEach((row, index) => {
    const parsed = parseAmount(row.amountText);
    if (parsed === null) {
      fieldErrors[`moneyRows.${index}.amountText`] = 'format';
      return;
    }
    if (!row.accountId) {
      fieldErrors[`moneyRows.${index}.accountId`] = 'required';
      return;
    }
    const settlements = row.settlements
      .map((s) => ({ openItemId: s.openItemId, amountCents: parseAmount(s.amountText) }))
      .filter((s): s is { openItemId: string; amountCents: number } => s.amountCents !== null);
    moneyLines.push({ accountId: row.accountId, amountCents: row.direction === 'in' ? parsed : -parsed, settlements: settlements.length > 0 ? settlements : undefined });
  });

  const allocationLines: EntryLinesInput['allocationLines'] = [];
  state.splitRows.forEach((row, index) => {
    const parsed = parseAmount(row.amountText);
    if (parsed === null) {
      fieldErrors[`splitRows.${index}.amountText`] = 'format';
      return;
    }
    if (!row.categoryId) {
      fieldErrors[`splitRows.${index}.categoryId`] = 'required';
      return;
    }
    allocationLines.push({
      categoryId: row.categoryId,
      amountCents: state.template === 'expense' ? -parsed : parsed,
      taxCode: row.taxCode as EntryLinesInput['allocationLines'][number]['taxCode'],
      rateKind: row.rateKind,
      projectId: row.projectId,
      purposeId: row.purposeId,
      contactId: row.contactId,
      abroad: row.abroad,
      addsToAssets: row.addsToAssets,
    });
  });

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, input: { id: state.id, expectedVersion: state.expectedVersion, entryDate: state.entryDate, text: state.text, moneyLines, allocationLines } };
}

/**
 * Zum Bearbeiten eines Entwurfs: die Vorlage wird geraten (keine
 * Zuordnungszeilen → `transfer`; keine Geldzeilen → `inKind`; Σ Geld < 0 →
 * `expense`; sonst `income`), die Vorzeichenregel wird umgekehrt.
 */
export function fromEntryView(view: EntryViewLike): EntryFormState {
  const moneySum = view.moneyLines.reduce((sum, line) => sum + line.amountCents, 0);
  const template: EntryTemplate = view.allocationLines.length === 0 ? 'transfer' : view.moneyLines.length === 0 ? 'inKind' : moneySum < 0 ? 'expense' : 'income';

  const moneyRows: MoneyRow[] = view.moneyLines.map((line, index) => ({
    key: `money-${index + 1}`,
    accountId: line.accountId,
    direction: line.amountCents >= 0 ? 'in' : 'out',
    amountText: formatAmount(Math.abs(line.amountCents)),
    settlements: (line.settlements ?? []).map((s) => ({ openItemId: s.openItemId, amountText: formatAmount(s.amountCents) })),
  }));

  const splitRows: SplitRowState[] = view.allocationLines.map((line, index) => ({
    key: `split-${index + 1}`,
    categoryId: line.categoryId,
    amountText: formatAmount(template === 'expense' ? -line.amountCents : line.amountCents),
    taxCode: line.taxCode,
    rateKind: line.rateKind,
    contactId: line.contactId ?? null,
    projectId: line.projectId ?? null,
    purposeId: line.purposeId ?? null,
    abroad: line.abroad ?? false,
    addsToAssets: line.addsToAssets ?? false,
    locked: template === 'inKind' && index === 1,
  }));

  return { id: view.id, expectedVersion: view.expectedVersion ?? view.updatedAt, entryDate: view.entryDate, text: view.text, template, moneyRows, splitRows };
}

/** „Rest hierher“: setzt die gewählte Zeile so, dass die Buchung danach ausgeglichen ist. */
export function restInto(state: EntryFormState, rowKey: string): EntryFormState {
  const target = state.splitRows.find((r) => r.key === rowKey);
  if (!target) return state;
  const withoutTarget: EntryFormState = { ...state, splitRows: state.splitRows.filter((r) => r.key !== rowKey) };
  const remainder = remainderCents(withoutTarget);
  if (remainder === null) return state;
  const neededTyped = state.template === 'expense' ? -remainder : remainder;
  return { ...state, splitRows: state.splitRows.map((r) => (r.key === rowKey ? { ...r, amountText: formatAmount(neededTyped) } : r)) };
}
