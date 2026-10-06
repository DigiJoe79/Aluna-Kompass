/**
 * Reine Rechnung des Höchstbetrags der freien Rücklage (F8b Annahme 4, § 62
 * Abs. 1 Nr. 3 AO) — **Näherung**, keine Sperre. Kein Import, damit sie im
 * Dienst (`allocation/reserves.ts`) wie im Client-Formular
 * (`src/lib/finance/reserves.ts`, Unterpfad-Export `./reserve-rules`) läuft
 * (Muster `evidence-rules.ts`). Liefert nur Zahlen — kein Zustandswort: das
 * ist Sache von `LimitProgress` (Annahme 17).
 */

export interface FreeReserveCapInput {
  /** Überschuss der Vermögensverwaltung im Jahr — ein Minus zählt als 0. */
  assetManagementSurplusCents: number;
  /** Bruttoeinnahmen des ideellen Bereichs ohne Zuwendungen zum Vermögen, plus positive Überschüsse aus Zweckbetrieb und Geschäftsbetrieb. */
  otherTimelyFundsCents: number;
  /** Anteil der Vermögensverwaltung in Prozent (Reihe `freeReserveAssetShare`, Vorgabe 33). */
  assetSharePercent: number;
  /** Anteil der übrigen Mittel in Prozent (Reihe `freeReserveOtherShare`, Vorgabe 10). */
  otherSharePercent: number;
}

/**
 * ⌊max(0, Überschuss Vermögensverwaltung) × Anteil⌋ + ⌊übrige zeitnah zu
 * verwendende Mittel × Anteil⌋ — ganzzahlig in Cent.
 */
export function freeReserveCapCents(input: FreeReserveCapInput): number {
  const assetPart = Math.floor((Math.max(0, input.assetManagementSurplusCents) * input.assetSharePercent) / 100);
  const otherPart = Math.floor((Math.max(0, input.otherTimelyFundsCents) * input.otherSharePercent) / 100);
  return assetPart + otherPart;
}

// ── Welche Geschäftsjahre für die freie Rücklage zählen (Befund 4, Fassung 0.2.7) ──

/** Ein Geschäftsjahr mit Abschlussstand — `FiscalYearView` passt ohne Umbau. */
export interface FreeReserveYearInput {
  id: string;
  designation: string;
  startsOn: string;
  endsOn: string;
  status: 'open' | 'closed';
}

export interface FreeReserveYear {
  id: string;
  designation: string;
  startsOn: string;
  endsOn: string;
  /** Das Vorjahr, solange es nicht abgeschlossen ist: Sein Höchstbetrag kann sich mit jeder Buchung noch ändern. */
  provisional: boolean;
}

export interface FreeReserveYears {
  /** Älteres Jahr zuerst: das offene Vorjahr, dann das Jahr des Tages. */
  years: FreeReserveYear[];
  /** Der Vorschlag am Bildschirm: das offene Vorjahr, sonst das Jahr des Tages. Ohne Jahresangabe nimmt der Dienst ihn nur, wenn `years` genau ein Jahr hat. */
  defaultFiscalYearId: string | null;
}

/**
 * Welche Geschäftsjahre an `day` für die freie Rücklage zählen (Joe 2026-10-06):
 * das Jahr, in dem `day` liegt, und davor das unmittelbar vorangehende, solange
 * es nicht abgeschlossen ist. Der Höchstbetrag gehört zu einem Bezugsjahr, und
 * beschlossen wird die Zuführung meist im Frühjahr beim Abschluss des Vorjahres —
 * dann hat das neue Jahr noch keine Einnahmen und damit keinen Höchstbetrag.
 * Bewusst nicht: eine Jahreswahl und die Frist bis zwei Jahre nach dem
 * Bezugsjahr (§ 62 Abs. 2 AO); ein älteres offenes Jahr zählt hier nicht. Nach
 * Daten, nie nach Kalenderjahren: Rumpf- und abweichende Geschäftsjahre gehen
 * genauso. Seite, Vorgang-Dialog, `recordReserveMovement` (lehnt ohne Jahr ab,
 * solange zwei in Frage kommen), MCP und die Kachel `reserveCapNear` fragen alle hier.
 *
 * Als Vorjahr gilt das Jahr, das zuletzt vor dem Jahr des Tages endet — ohne
 * Prüfung auf `endsOn` = Vortag von `startsOn` (Befund 7a, 0.2.7): Lücken
 * zwischen Geschäftsjahren lässt Kompass nicht zu. Das erste Jahr legt
 * `createFirstFiscalYear` nur an, solange es keines gibt; jedes weitere legt
 * `ensureFiscalYearFor` als unmittelbaren Nachfolger an (Beginn am Tag nach dem
 * Ende des jüngsten), und `updateFiscalYear` ändert keine Daten. Gibt es für
 * den Tag noch kein Jahr, ist das jüngste Jahr dasjenige, dessen Nachfolger
 * die nächste Buchung anlegt.
 */
export function freeReserveYears(fiscalYears: readonly FreeReserveYearInput[], day: string): FreeReserveYears {
  const current = fiscalYears.find((y) => y.startsOn <= day && day <= y.endsOn) ?? null;
  const boundary = current?.startsOn ?? day;
  let before: FreeReserveYearInput | null = null;
  for (const y of fiscalYears) if (y.endsOn < boundary && (before === null || y.endsOn > before.endsOn)) before = y;
  const previous = before?.status === 'open' ? before : null;
  const pick = (y: FreeReserveYearInput, provisional: boolean): FreeReserveYear => ({ id: y.id, designation: y.designation, startsOn: y.startsOn, endsOn: y.endsOn, provisional });
  return {
    years: [...(previous ? [pick(previous, true)] : []), ...(current ? [pick(current, false)] : [])],
    defaultFiscalYearId: previous?.id ?? current?.id ?? null,
  };
}
