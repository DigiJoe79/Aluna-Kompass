import { formatAmount, formatEuro, parseAmount } from './amount';
import type { MiniFormState, WorkRaw } from './work';

/**
 * Die Dialoge der Arbeitsliste (F5 Task 8): „Künftig immer so?“ und das
 * Sammel-Festschreiben — nur Umrechnungen zwischen Formular und Dienst. Ob
 * eine Regel gültig ist und was sie trifft, entscheiden `saveImportRule` und
 * `previewImportRule`.
 */
export interface RuleFormState {
  id?: string;
  name: string;
  /** Leer = jedes Konto. */
  accountId: string;
  /** Leer = beide Richtungen. */
  direction: '' | 'in' | 'out';
  /** Die IBAN ist Bedingung nur, solange das Häkchen gesetzt ist. */
  ibanOn: boolean;
  iban: string;
  textContains: string;
  amountMinText: string;
  amountMaxText: string;
  categoryId: string;
  projectId: string | null;
  purposeId: string | null;
  contactId: string | null;
  contactName?: string | null;
  taxCode: string;
  entryText: string;
  isActive: boolean;
}

export interface RuleConditionsInput {
  accountId: string | null;
  direction: 'in' | 'out' | null;
  counterpartyIban: string | null;
  textContains: string | null;
  amountMinCents: number | null;
  amountMaxCents: number | null;
}

export interface SaveImportRuleInput extends RuleConditionsInput {
  id?: string;
  name: string;
  isActive: boolean;
  categoryId: string;
  projectId: string | null;
  purposeId: string | null;
  contactId: string | null;
  taxCode: string | null;
  entryText: string | null;
}

type RawForRule = WorkRaw & { counterpartyIban: string | null };

/** Bedingung aus dem Umsatz (Konto, Richtung, IBAN, Gegenpartei als Textteil), Ergebnis aus der ersten Zeile der Mini-Maske. */
export function ruleFormFromTransaction(raw: RawForRule, mini: MiniFormState | null): RuleFormState {
  const first = mini?.rows[0];
  const counterparty = (raw.counterpartyName ?? '').trim();
  return {
    name: (counterparty || raw.purpose.trim()).slice(0, 120),
    accountId: raw.accountId,
    direction: raw.amountCents < 0 ? 'out' : 'in',
    ibanOn: !!raw.counterpartyIban,
    iban: raw.counterpartyIban ?? '',
    textContains: counterparty.slice(0, 120),
    amountMinText: '',
    amountMaxText: '',
    categoryId: first?.categoryId ?? '',
    projectId: first?.projectId ?? null,
    purposeId: first?.purposeId ?? null,
    contactId: first?.contactId ?? null,
    contactName: first?.contactName ?? null,
    taxCode: first?.taxCode ?? '',
    entryText: mini?.text.trim() ?? '',
    isActive: true,
  };
}

export interface SavedRule extends RuleConditionsInput {
  id: string;
  name: string;
  isActive: boolean;
  categoryId: string;
  projectId: string | null;
  purposeId: string | null;
  contactId: string | null;
  taxCode: string | null;
  entryText: string | null;
}

export function ruleFormFromRule(rule: SavedRule, contactName: string | null = null): RuleFormState {
  return {
    id: rule.id,
    name: rule.name,
    accountId: rule.accountId ?? '',
    direction: rule.direction ?? '',
    ibanOn: rule.counterpartyIban !== null,
    iban: rule.counterpartyIban ?? '',
    textContains: rule.textContains ?? '',
    amountMinText: rule.amountMinCents === null ? '' : formatAmount(rule.amountMinCents),
    amountMaxText: rule.amountMaxCents === null ? '' : formatAmount(rule.amountMaxCents),
    categoryId: rule.categoryId,
    projectId: rule.projectId,
    purposeId: rule.purposeId,
    contactId: rule.contactId,
    contactName,
    taxCode: rule.taxCode ?? '',
    entryText: rule.entryText ?? '',
    isActive: rule.isActive,
  };
}

const orNull = (text: string): string | null => (text.trim() ? text.trim() : null);

/** Ein leeres Betragsfeld ist keine Bedingung; ein unlesbares `undefined`. */
function centsOrNull(text: string): number | null | undefined {
  if (!text.trim()) return null;
  const cents = parseAmount(text);
  return cents === null ? undefined : Math.abs(cents);
}

function conditionsOf(state: RuleFormState): RuleConditionsInput | null {
  const amountMinCents = centsOrNull(state.amountMinText);
  const amountMaxCents = centsOrNull(state.amountMaxText);
  if (amountMinCents === undefined || amountMaxCents === undefined) return null;
  return {
    accountId: state.accountId || null,
    direction: state.direction || null,
    counterpartyIban: state.ibanOn ? orNull(state.iban) : null,
    textContains: orNull(state.textContains),
    amountMinCents,
    amountMaxCents,
  };
}

export function ruleFormToInput(state: RuleFormState): { ok: true; input: SaveImportRuleInput } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  if (!state.name.trim()) fieldErrors.name = 'required';
  if (!state.categoryId) fieldErrors.categoryId = 'required';
  if (centsOrNull(state.amountMinText) === undefined) fieldErrors.amountMinCents = 'format';
  if (centsOrNull(state.amountMaxText) === undefined) fieldErrors.amountMaxCents = 'format';
  const conditions = conditionsOf(state);
  if (Object.keys(fieldErrors).length > 0 || !conditions) return { ok: false, fieldErrors };
  return {
    ok: true,
    input: {
      ...(state.id ? { id: state.id } : {}),
      name: state.name.trim(),
      isActive: state.isActive,
      ...conditions,
      categoryId: state.categoryId,
      projectId: state.projectId,
      purposeId: state.purposeId,
      contactId: state.contactId,
      taxCode: state.taxCode || null,
      entryText: orNull(state.entryText),
    },
  };
}

/** Eingabe für `previewImportRule` — `null`, solange es nichts zu zählen gibt (keine Kategorie, keine Bedingung, ein unlesbarer Betrag). */
export function rulePreviewInput(state: RuleFormState): (RuleConditionsInput & { categoryId: string }) | null {
  if (!state.categoryId) return null;
  const conditions = conditionsOf(state);
  if (!conditions) return null;
  if (Object.values(conditions).every((v) => v === null)) return null;
  return { ...conditions, categoryId: state.categoryId };
}

export type RuleConditionPart =
  | { key: 'account'; values: { account: string } }
  | { key: 'in' | 'out'; values: Record<string, never> }
  | { key: 'iban'; values: { iban: string } }
  | { key: 'text'; values: { text: string } }
  | { key: 'amountBetween'; values: { min: string; max: string } }
  | { key: 'amountFrom' | 'amountUpTo'; values: { amount: string } };

/** Die Bedingung einer Regel als Teile — die Regeln-Seite setzt aus ihnen den Satz „Wenn …“. */
export function ruleConditionParts(rule: RuleConditionsInput, accountNames: ReadonlyMap<string, string>): RuleConditionPart[] {
  const parts: RuleConditionPart[] = [];
  if (rule.accountId) parts.push({ key: 'account', values: { account: accountNames.get(rule.accountId) ?? '' } });
  if (rule.direction) parts.push({ key: rule.direction, values: {} });
  if (rule.counterpartyIban) parts.push({ key: 'iban', values: { iban: rule.counterpartyIban } });
  if (rule.textContains) parts.push({ key: 'text', values: { text: rule.textContains } });
  if (rule.amountMinCents !== null && rule.amountMaxCents !== null) parts.push({ key: 'amountBetween', values: { min: formatEuro(rule.amountMinCents), max: formatEuro(rule.amountMaxCents) } });
  else if (rule.amountMinCents !== null) parts.push({ key: 'amountFrom', values: { amount: formatEuro(rule.amountMinCents) } });
  else if (rule.amountMaxCents !== null) parts.push({ key: 'amountUpTo', values: { amount: formatEuro(rule.amountMaxCents) } });
  return parts;
}

export interface BatchAccountRow {
  kind: string;
  bookCentsAfter: number;
  statementClosingCents: number | null;
  statementDate?: string | null;
  matches: boolean | null;
}

/** Eine Zeile des Sammel-Festschreibens: stimmt, weicht ab (um wie viel), kein Auszug — oder eine Kasse, die nie einen hat. */
export function batchAccountState(row: BatchAccountRow): { state: 'matches' | 'differs' | 'noStatement' | 'cash'; differenceCents: number | null } {
  if (row.kind === 'cash') return { state: 'cash', differenceCents: null };
  if (row.matches === null || row.statementClosingCents === null) return { state: 'noStatement', differenceCents: null };
  const differenceCents = row.bookCentsAfter - row.statementClosingCents;
  return { state: differenceCents === 0 ? 'matches' : 'differs', differenceCents };
}
