/**
 * Reine Funktionen der Zahlungszuordnung an einer Geldzeile
 * (Finanz-Spec 5.3, F3a-N Task 5): Vorschlag für den Teilbetrag, und welche
 * Richtung einer Geldzeile zu welcher Art offenem Posten passt.
 */
import { matchesSearch } from '../normalize-for-search';
import { formatAmount } from './amount';
import type { EntryFormState, SplitRowState } from './entry-form';
import { splitEvenly } from './split';

/** min(offener Rest, was die Geldzeile noch frei hat), nie negativ. */
export function suggestSettlementCents(args: { openCents: number; lineCents: number; alreadySettledCents: number }): number {
  const remainingLine = args.lineCents - args.alreadySettledCents;
  return Math.max(0, Math.min(args.openCents, remainingLine));
}

/** Ausgang → Verbindlichkeit, Eingang → Forderung. */
export function matchesDirection(itemKind: 'receivable' | 'payable', direction: 'in' | 'out'): boolean {
  return itemKind === 'receivable' ? direction === 'in' : direction === 'out';
}

/** Eine Zeile der Vorlage eines offenen Postens (`OpenItemView.lineTemplate`), der Kontakt schon mit Namen aufgelöst. */
export interface OpenItemTemplateLine {
  categoryId?: string | null;
  amountCents?: number;
  taxCode?: string | null;
  projectId?: string | null;
  purposeId?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  abroad?: boolean;
}

/** Ein offener Posten, wie ihn die Suche „begleicht offene Zahlung“ an einer Geldzeile anbietet. */
export interface SettlementOption {
  id: string;
  kind: 'receivable' | 'payable';
  /** Zahlungsreferenz, ohne sie „Posten vom …“. */
  label: string;
  contactName: string | null;
  openCents: number;
  lineTemplate: OpenItemTemplateLine[] | null;
}

/** Was die Suche an einer Geldzeile anbietet: passende Richtung, noch nicht gewählt, Suche über Referenz und Kontakt. */
export function settlementCandidates<T extends SettlementOption>(items: readonly T[], args: { direction: 'in' | 'out'; chosenIds: ReadonlySet<string>; query: string }): T[] {
  return items.filter((item) => matchesDirection(item.kind, args.direction) && !args.chosenIds.has(item.id) && matchesSearch(args.query, [item.label, item.contactName]));
}

/**
 * Zuordnungszeilen aus der Vorlage eines Postens, wie die Arbeitsliste sie vorschlägt (`linesFromTemplate` in
 * `import/suggestions.ts`): nur Zeilen mit Kategorie; trägt keine eine, belegt die erste Kennzeichen und Kontakt
 * mit leerer Kategorie vor. Der Betrag ist der Ausgleichsbetrag — bei mehreren Zeilen im Verhältnis ihrer
 * Vorlagenbeträge (gleich der Vorlage, wenn der Posten ganz beglichen wird), das Restcent auf die erste Zeile
 * wie bei `splitEvenly`.
 */
export function templateSplitRows(lines: readonly OpenItemTemplateLine[], settlementCents: number, keyPrefix: string): (SplitRowState & { contactName: string | null })[] {
  const records = lines.filter((l) => !!l.categoryId);
  const toRow = (line: OpenItemTemplateLine, index: number, cents: number, categoryId: string) => ({
    key: `${keyPrefix}-${index + 1}`,
    categoryId,
    amountText: formatAmount(cents),
    ...(line.taxCode ? { taxCode: line.taxCode } : {}),
    contactId: line.contactId ?? null,
    contactName: line.contactId ? (line.contactName ?? null) : null,
    projectId: line.projectId ?? null,
    purposeId: line.purposeId ?? null,
    abroad: line.abroad ?? false,
    addsToAssets: false,
  });
  if (records.length === 0) {
    const first = lines[0];
    return first ? [{ ...toRow(first, 0, settlementCents, ''), projectId: null, purposeId: null }] : [];
  }
  const weights = records.map((r) => Math.abs(r.amountCents ?? 0));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const parts = total === 0 ? splitEvenly(settlementCents, records.length) : weights.map((w) => Math.floor((settlementCents * w) / total));
  parts[0] = (parts[0] ?? 0) + settlementCents - parts.reduce((sum, p) => sum + p, 0);
  return records.map((r, index) => toRow(r, index, parts[index] ?? 0, r.categoryId!));
}

/**
 * Ein Posten wurde an einer Geldzeile gewählt: Ist „Wofür?“ noch leer (keine Zeile mit Kategorie oder Betrag),
 * übernimmt die Maske seine Vorlage; sonst bleibt alles, wie es ist. Bringt die Geldzeile mehr, als ausgeglichen wird
 * (`unsettledCents`, Plan N1 E4), wird der Rest eine eigene Zeile ohne Kategorie — nie still Beitrag.
 */
export function withOpenItemTemplate(state: EntryFormState, item: SettlementOption, settlementCents: number, lineCents = settlementCents): EntryFormState {
  if (state.template !== 'income' && state.template !== 'expense') return state;
  if (!item.lineTemplate || item.lineTemplate.length === 0) return state;
  // Ausgefüllt ist eine Zeile erst mit einer Angabe des Menschen. Der Betrag allein zählt nicht: Aus der Arbeitsliste
  // steht dort schon der Betrag des Bankumsatzes, und die Vorlage griff dann nie (Joe 2026-10-18).
  if (state.splitRows.some((r) => !!r.categoryId || !!r.contactId || !!r.projectId || !!r.purposeId)) return state;
  const rows = templateSplitRows(item.lineTemplate, settlementCents, `split-${item.id}`);
  if (rows.length === 0) return state;
  const rest = lineCents - settlementCents;
  const contact = item.lineTemplate.find((l) => l.contactId);
  const restRow = { key: `split-${item.id}-rest`, categoryId: '', amountText: formatAmount(rest), contactId: contact?.contactId ?? null, contactName: contact?.contactName ?? null, projectId: null, purposeId: null, abroad: false, addsToAssets: false };
  return { ...state, splitRows: rest > 0 ? [...rows, restRow] : rows };
}
