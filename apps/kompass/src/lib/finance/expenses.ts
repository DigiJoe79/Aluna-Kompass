import type { ExpenseClaimView } from '@kompass/module-finance';
import { formatAmount, parseAmount } from './amount';

/**
 * Formularzustand von D1 „Auslage einreichen“ (F8a Task 5) und die reinen
 * Rechnungen dazu. Der Stand liegt am Server (laufende Sicherung); hier steht
 * nur, was die Oberfläche zwischen zwei Sicherungen hält und wie sie es dem
 * Dienst übergibt. Kein Wert-Import aus `@kompass/module-finance`: Die Datei
 * läuft im Client-Bündel (`tests/client-imports.test.ts`).
 */

export type Device = 'ios' | 'android' | null;

/** Die Kurzanleitung zum Scannen passt zum Gerät; ist es nicht erkennbar, zeigt das Feld beide. */
export function deviceFromUserAgent(userAgent: string | null): Device {
  if (!userAgent) return null;
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return 'ios';
  if (/\bAndroid\b/.test(userAgent)) return 'android';
  return null;
}

export interface MileageRate {
  validFrom: string;
  centsPerKm: number;
}

/** Der Satz am Tag der Fahrt — die letzte Stufe, die an dem Tag schon galt. */
export function rateAt(rates: readonly MileageRate[], date: string): number | null {
  if (!date) return null;
  const valid = rates.filter((r) => r.validFrom <= date).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  return valid.at(-1)?.centsPerKm ?? null;
}

/**
 * Dieselbe Rechnung wie `tripAmountCents` im Modul (kaufmännisch auf Cent),
 * hier noch einmal klein für den Client — `tests/finance-expenses.test.ts`
 * hält beide auf denselben Grenzfällen gleich. Die Oberfläche rechnet nur vor;
 * gespeichert wird, was der Dienst rechnet.
 */
export function tripAmountCents(km: number, rateCentsPerKm: number): number {
  return Math.round(Number((km * rateCentsPerKm).toPrecision(12)));
}

/** „84 km × 0,30 € = 25,20 €“ — nur, wenn Kilometer (ganze Zahl) und Datum da sind und ein Satz gilt. */
export function tripCalculation(kmText: string, date: string, rates: readonly MileageRate[]): { km: number; centsPerKm: number; amountCents: number } | null {
  const km = parseKm(kmText);
  const centsPerKm = rateAt(rates, date);
  if (km === null || km <= 0 || centsPerKm === null) return null;
  return { km, centsPerKm, amountCents: tripAmountCents(km, centsPerKm) };
}

function parseKm(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,6}$/.test(trimmed) ? Number(trimmed) : null;
}

export interface PositionForm {
  /** Schlüssel der Oberfläche — bleibt, auch bevor der Dienst eine ID vergeben hat. */
  key: string;
  id?: string;
  kind: 'receipt' | 'trip';
  positionDate: string;
  amountText: string;
  purpose: string;
  projectId: string;
  tripFrom: string;
  tripTo: string;
  tripReason: string;
  kmText: string;
  /** Der abgelegte Beleg (Nummer der Akte); Name und Größe kennt nur die Sitzung, die ihn gewählt hat. */
  documentNumber: string | null;
  fileName: string | null;
  fileSize: number | null;
}

export interface ExpenseForm {
  id: string | null;
  version: string | null;
  iban: string;
  waiver: boolean;
  positions: PositionForm[];
}

export function emptyPosition(key: string, today: string): PositionForm {
  return { key, kind: 'receipt', positionDate: today, amountText: '', purpose: '', projectId: '', tripFrom: '', tripTo: '', tripReason: '', kmText: '', documentNumber: null, fileName: null, fileSize: null };
}

export function emptyExpenseForm(iban: string | null): ExpenseForm {
  return { id: null, version: null, iban: iban ?? '', waiver: false, positions: [] };
}

const blank = (s: string) => (s.trim() === '' ? null : s.trim());

/** Beleg: der getippte Betrag; Fahrt: die Rechnung. Unlesbares zählt 0 — nichts ist Pflicht, bis eingereicht wird. */
export function positionCents(p: PositionForm, rates: readonly MileageRate[]): number {
  if (p.kind === 'trip') return tripCalculation(p.kmText, p.positionDate, rates)?.amountCents ?? 0;
  const cents = parseAmount(p.amountText);
  return cents !== null && cents > 0 ? cents : 0;
}

export const totalCents = (form: ExpenseForm, rates: readonly MileageRate[]) => form.positions.reduce((sum, p) => sum + positionCents(p, rates), 0);

/**
 * Der Formularzustand als Eingabe für `saveExpenseDraft` — dazu die
 * Schlüssel in der gesendeten Reihenfolge, damit `applySaved` die IDs der
 * Antwort den richtigen Karten zuordnet, auch wenn inzwischen weitergetippt
 * wurde. Mit Verzicht geht keine IBAN mit: Es gibt nichts zu überweisen.
 */
export function draftInput(form: ExpenseForm) {
  const positions = form.positions.map((p) => {
    const common = { ...(p.id ? { id: p.id } : {}), kind: p.kind, positionDate: p.positionDate || null, purpose: p.purpose.trim(), projectId: p.projectId || null };
    if (p.kind === 'receipt') {
      const cents = parseAmount(p.amountText);
      return { ...common, amountCents: cents !== null && cents > 0 ? cents : 0 };
    }
    return { ...common, tripFrom: blank(p.tripFrom), tripTo: blank(p.tripTo), tripReason: blank(p.tripReason), tripKm: parseKm(p.kmText) };
  });
  const input = {
    ...(form.id ? { id: form.id } : {}),
    ...(form.version ? { expectedVersion: form.version } : {}),
    iban: form.waiver ? null : blank(form.iban),
    waiver: form.waiver,
    positions,
  };
  return { input, keys: form.positions.map((p) => p.key) };
}

export type ExpenseDraftInput = ReturnType<typeof draftInput>['input'];

/** Die Antwort des Dienstes einarbeiten: ID, Version, Positions-IDs und Belege — das Getippte bleibt. */
export function applySaved(form: ExpenseForm, sentKeys: readonly string[], view: ExpenseClaimView): ExpenseForm {
  const byKey = new Map(sentKeys.map((key, i) => [key, view.positions[i]]));
  return {
    ...form,
    id: view.id,
    version: view.version,
    positions: form.positions.map((p) => {
      const saved = byKey.get(p.key);
      if (!saved) return p;
      return { ...p, id: saved.id, documentNumber: saved.documentNumber };
    }),
  };
}

/** Einen gesicherten Entwurf wieder ins Formular holen (am Rechner weitermachen, was am Telefon begann). */
export function formFromClaim(view: ExpenseClaimView): ExpenseForm {
  return {
    id: view.id,
    version: view.version,
    iban: view.iban ?? '',
    waiver: view.waiver,
    positions: view.positions.map((p) => ({
      key: p.id,
      id: p.id,
      kind: p.kind,
      positionDate: p.positionDate ?? '',
      amountText: p.kind === 'receipt' && p.amountCents > 0 ? formatAmount(p.amountCents) : '',
      purpose: p.purpose,
      projectId: p.projectId ?? '',
      tripFrom: p.tripFrom ?? '',
      tripTo: p.tripTo ?? '',
      tripReason: p.tripReason ?? '',
      kmText: p.tripKm ? String(p.tripKm) : '',
      documentNumber: p.documentNumber,
      fileName: null,
      fileSize: null,
    })),
  };
}

/**
 * Die Ablehnung am PDF-Feld, bevor etwas hochgeladen wird. Ein Foto bekommt
 * seinen eigenen Satz („Das ist ein Foto“), weil das der häufigste Fall am
 * Telefon ist. Die Grenze kommt vom Aufrufer (`DOCUMENT_MAX_BYTES` der Akte);
 * der Dienst prüft noch einmal am Magic Byte.
 */
export function receiptProblem(file: { type: string; size: number }, maxBytes: number): 'photo' | 'notPdf' | 'tooLarge' | null {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type !== 'application/pdf') return 'notPdf';
  if (file.size > maxBytes) return 'tooLarge';
  return null;
}

/** „312 KB“, „2,4 MB“, „10 MB“ — ganze KB, MB mit höchstens einer Nachkommastelle. */
export function formatFileSize(bytes: number): string {
  const MB = 1024 * 1024;
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = Math.round((bytes / MB) * 10) / 10;
  return `${String(mb).replace('.', ',')} MB`;
}
