import { ok, readSetting, requirePermission, validate, type CallContext, type Deps, type Result } from '@kompass/core';
import { listDocuments, type DocumentRecord } from '@kompass/module-dms';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { financeConflict } from '../errors';
import { requireFinanceRead } from '../ledger/access';
import { deleteDraft, entryViewInternal } from '../ledger/entries';
import { uploadVoucher, type VoucherLinkResult } from '../ledger/vouchers';
import { financeCategories } from '../schema';
import { bookFromTransaction, boundEntryIdInternal, usableRawInternal } from './book';
import { defaultText, suggestionForRawInternal } from './suggestions';

/**
 * Beleg von beiden Seiten (F5, Spec 6.5; Annahme 8): vom Kontoumsatz aus
 * einen Beleg in der Akte suchen oder ein PDF gleich im Namen der Buchung
 * ablegen. Die Akte selbst wird nicht umgebaut — gesucht wird mit mehreren
 * Einzelanfragen an `listDocuments`, und was der Aufrufer dort nicht lesen
 * darf, findet er auch hier nicht (die Akte prüft, Prinzip 6).
 */
export interface VoucherSearchHit {
  documentId: string;
  number: string | null;
  subject: string;
  documentDate: string;
  typeKey: string;
  matchedBy: ('amount' | 'counterparty')[];
}

const searchSchema = z.object({ rawTransactionId: z.string().min(1), limit: z.number().int().min(1).max(50).default(20) });

const attachSchema = z.object({
  rawTransactionId: z.string().min(1),
  bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array, { message: 'invalidBytes' }),
  /** Vorgabe: bei Ausgang `voucher-invoice`, bei Eingang `voucher-receipt` — sonst `voucher-own`, wenn die Art nicht als Finanzbeleg gilt. */
  typeKey: z.string().min(1).optional(),
  /** Vorgabe: Buchungs-ID und Kategorie — nie ein Personenname. */
  title: z.string().trim().min(1).max(300).optional(),
  /** Vorgabe: das Buchungsdatum des Kontoumsatzes. */
  documentDate: z.string().date().optional(),
  /** Buchungstext, falls erst ein Entwurf entsteht. */
  entryTextIfNew: z.string().trim().min(1).max(300).optional(),
});

/** Die Schreibweisen eines Betrags, wie sie auf Rechnungen stehen: „12,50“, „12.50“, ab tausend auch „1.234,56“ — nie Cent („1250“). */
export function amountSpellings(cents: number): string[] {
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  const spellings = [`${euros},${rest}`, `${euros}.${rest}`];
  if (euros >= 1000) spellings.push(`${String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${rest}`);
  return spellings;
}

/**
 * `finance.read`: Belege in der Akte, die zu einem Kontoumsatz passen — über
 * den Betrag in seinen Schreibweisen und über den Namen der Gegenpartei. Nur
 * Arten aus `finance.voucherTypes`, festgeschrieben und nicht widerrufen;
 * Dokumente ohne Bezug zu einer Buchung zuerst, dann die übrigen; jedes nur
 * einmal, mit allem, worüber es gefunden wurde. `queries` nennt die
 * Suchbegriffe — für den Link „In der Akte suchen“.
 */
export async function searchVouchersForTransaction(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ hits: VoucherSearchHit[]; queries: string[] }>> {
  const denied = requireFinanceRead(ctx, 'read');
  if (denied) return denied;
  const parsed = validate(deps, searchSchema, input);
  if (!parsed.ok) return parsed;
  const loaded = usableRawInternal(deps.db, parsed.value.rawTransactionId);
  if (!loaded.ok) return loaded;
  const raw = loaded.value;

  const queries: { text: string; by: 'amount' | 'counterparty' }[] = amountSpellings(raw.amountCents).map((text) => ({ text, by: 'amount' }));
  const counterparty = (raw.counterpartyName ?? '').trim().replace(/\s+/g, ' ');
  if (counterparty.length >= 3) queries.push({ text: counterparty, by: 'counterparty' });

  const voucherTypes = new Set(readSetting<string[]>(deps, 'finance.voucherTypes'));
  const found = new Map<string, { doc: DocumentRecord; matchedBy: Set<'amount' | 'counterparty'> }>();
  for (const query of queries) {
    const res = await listDocuments(deps, ctx, { text: query.text, phase: 'issued', limit: 200 });
    if (!res.ok) return res;
    for (const doc of res.value.documents) {
      if (!voucherTypes.has(doc.typeKey) || doc.status === 'voided') continue;
      const hit = found.get(doc.id) ?? { doc, matchedBy: new Set() };
      hit.matchedBy.add(query.by);
      found.set(doc.id, hit);
    }
  }

  const all = [...found.values()];
  const hasEntry = (doc: DocumentRecord) => doc.links.some((l) => l.entityType === 'financeEntry');
  const ordered = [...all.filter((h) => !hasEntry(h.doc)), ...all.filter((h) => hasEntry(h.doc))];
  return ok({
    hits: ordered.slice(0, parsed.value.limit).map(({ doc, matchedBy }) => ({
      documentId: doc.id, number: doc.number, subject: doc.subject, documentDate: doc.documentDate, typeKey: doc.typeKey,
      matchedBy: (['amount', 'counterparty'] as const).filter((by) => matchedBy.has(by)),
    })),
    queries: queries.map((q) => q.text),
  });
}

/** Vorschläge, deren Entwurf sich ohne Rückfrage anlegen lässt — `cashTransfer` nicht: Bargeld wird nie geparkt. */
const DRAFTABLE = new Set(['transfer', 'return', 'openItem', 'rule', 'contact']);

/**
 * `finance.entriesWrite`: ein PDF auf den Kontoumsatz legen. Hängt schon ein
 * Entwurf (oder eine Buchung) am Umsatz, kommt der Beleg daran — kein zweiter
 * Entwurf (Review Focus 5). Sonst entsteht ein ungeprüfter Entwurf aus dem
 * Vorschlag (ohne Vorschlag, bei „passt zu einer Buchung“, bei Bargeld oder
 * mit einem Problem nur mit der Geldzeile), und der Beleg wird über
 * `uploadVoucher` im Namen dieser Buchung abgelegt. Lehnt die Akte die Datei
 * ab, wird der eben angelegte Entwurf wieder gelöscht.
 */
export async function attachVoucherToTransaction(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ entryId: string; createdEntry: boolean; voucher: VoucherLinkResult }>> {
  const denied = requirePermission(ctx, 'finance.entriesWrite');
  if (denied) return denied;
  const parsed = validate(deps, attachSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  const loaded = usableRawInternal(deps.db, v.rawTransactionId);
  if (!loaded.ok) return loaded;
  const raw = loaded.value;

  const voucherTypes = readSetting<string[]>(deps, 'finance.voucherTypes');
  const preferred = raw.amountCents < 0 ? 'voucher-invoice' : 'voucher-receipt';
  const typeKey = v.typeKey ?? (voucherTypes.includes(preferred) ? preferred : 'voucher-own');
  if (!voucherTypes.includes(typeKey)) return financeConflict('voucherTypeNotAllowed', { type: typeKey });

  let entryId = boundEntryIdInternal(deps.db, raw.id);
  const createdEntry = entryId === null;
  if (entryId === null) {
    const suggestion = suggestionForRawInternal(deps, raw);
    const draft = suggestion.draft && DRAFTABLE.has(suggestion.kind) && suggestion.problems.length === 0 ? suggestion.draft : null;
    const booked = await bookFromTransaction(
      deps,
      ctx,
      draft
        ? { rawTransactionId: raw.id, entryDate: draft.entryDate, text: v.entryTextIfNew ?? draft.text, allocationLines: draft.allocationLines, extraMoneyLines: draft.moneyLines.slice(1), settlements: draft.moneyLines[0]?.settlements, reviewed: false }
        : { rawTransactionId: raw.id, text: v.entryTextIfNew ?? defaultText(raw), allocationLines: [], reviewed: false },
    );
    if (!booked.ok) return booked;
    entryId = booked.value.id;
  }

  const title = v.title ?? voucherTitleInternal(deps, entryId);
  const uploaded = await uploadVoucher(deps, ctx, { entryId, bytes: v.bytes, typeKey, title, documentDate: v.documentDate ?? raw.bookingDate });
  if (!uploaded.ok) {
    if (createdEntry) await deleteDraft(deps, ctx, { id: entryId });
    return uploaded;
  }
  return ok({ entryId, createdEntry, voucher: uploaded.value });
}

/** „Beleg zu Buchung {Nummer oder ID} · {Kategorie}“ — ohne Gegenpartei, die ein Personenname sein kann. */
function voucherTitleInternal(deps: Deps, entryId: string): string {
  const entry = entryViewInternal(deps.db, entryId)!;
  const categoryIds = [...new Set(entry.allocationLines.map((l) => l.categoryId))];
  const names = categoryIds.length > 0 ? deps.db.select({ id: financeCategories.id, name: financeCategories.name }).from(financeCategories).where(inArray(financeCategories.id, categoryIds)).all() : [];
  const first = names.find((c) => c.id === categoryIds[0])?.name;
  return `Beleg zu Buchung ${entry.number ?? entry.id}${first ? ` · ${first}` : ''}`;
}
