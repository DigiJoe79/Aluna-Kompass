import { csvField, paperDate, schema as coreSchema, type DbOrTx } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { projects } from '@kompass/module-projects';
import { and, asc, between, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  financeAccounts, financeAllocationCorrections, financeAllocationLines, financeCategories, financeEntries, financeEntryDocuments, financeImportRuns, financeMoneyLines,
  financePeriodEvents, financePurposes, financeRawTransactions, type FinanceAllocationCorrectionRow,
} from '../../schema';

/**
 * Die Dateien des Datenexports für eine Außenprüfung (§ 147 Abs. 6 AO; Spec Rechenschaft § B, Finanz-Spec § 9.2): jede
 * Datei einmal beschrieben — Spalten mit Bezeichnung, Typ und Bedeutung, dazu die Quelle ihrer Zeilen. Daraus entstehen
 * die CSV-Dateien, `index.xml` und `feldbeschreibung.csv` (`describe.ts`).
 *
 * Bezeichnungen und Werte sind deutsch: Das ZIP ist ein Dokument des Vereins wie das Verzeichnis des Aktenexports
 * (Prinzip 7, Ausnahme Papier). Spaltennamen in Großbuchstaben ohne Umlaute, wie die Prüfsoftware sie als Feldnamen
 * erwartet. Nur festgeschriebene Buchungen: Entwürfe gehören nicht zur Buchführung.
 */

export type ExportColumnType = 'text' | 'amount' | 'day' | 'timestamp' | 'bool' | 'integer';
export interface ExportColumn { name: string; label: string; type: ExportColumnType; description: string }
export interface ExportScopeYear { id: string; designation: string; startsOn: string; endsOn: string; open: boolean }
export interface ExportScope {
  fiscalYears: ExportScopeYear[];
  /** Leitsprache der Installation — für Projektnamen. */
  locale?: string;
}
export type DataExportStep = 'entries' | 'masterData' | 'vouchers' | 'history' | 'package';
export type ExportRow = readonly (string | null)[];
export interface ExportTable {
  file: string;
  title: string;
  description: string;
  step: DataExportStep;
  columns: readonly ExportColumn[];
  rows(db: DbOrTx, scope: ExportScope): Iterable<ExportRow>;
}

/** Ein Wert in der Form der Datei: Betrag `-1234,56`, Tag `TT.MM.JJJJ`, Schalter `ja`/`nein`, Zeitpunkt ISO als Text. */
export function exportCell(type: ExportColumnType, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  switch (type) {
    case 'amount': {
      const cents = Number(value);
      const abs = Math.abs(cents);
      // ASCII-Minus, Komma, kein Tausenderpunkt: so liest es die Prüfsoftware als Zahl (`index.xml`: Accuracy 2).
      return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
    }
    case 'day': {
      const day = String(value).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(day) ? paperDate(day as never) : String(value);
    }
    case 'bool': return value ? 'ja' : 'nein';
    case 'integer': return String(Math.trunc(Number(value)));
    case 'timestamp':
    case 'text': return String(value);
  }
}

const col = (name: string, label: string, type: ExportColumnType, description: string): ExportColumn => ({ name, label, type, description });
const row = (columns: readonly ExportColumn[], values: readonly unknown[]): ExportRow => columns.map((c, i) => exportCell(c.type, values[i]));

/** Seitenweise lesen: Ein Jahrgang hat Tausende Zeilen, die nie alle zugleich im Speicher liegen. */
const PAGE = 1000;
function* paged<T>(fetch: (limit: number, offset: number) => T[]): Generator<T> {
  for (let offset = 0; ; offset += PAGE) {
    const page = fetch(PAGE, offset);
    yield* page;
    if (page.length < PAGE) return;
  }
}

const yearIds = (scope: ExportScope) => scope.fiscalYears.map((y) => y.id);
const inYear = (yearId: string) => and(eq(financeEntries.fiscalYearId, yearId), eq(financeEntries.status, 'final'));
const inScope = (scope: ExportScope) => and(inArray(financeEntries.fiscalYearId, yearIds(scope)), eq(financeEntries.status, 'final'));
const designationOf = (scope: ExportScope, yearId: string | null) => scope.fiscalYears.find((y) => y.id === yearId)?.designation ?? null;

const CHANNEL: Record<string, string> = { ui: 'Oberfläche', mcp: 'Agent', system: 'System' };
const ACCOUNT_KIND: Record<string, string> = { bank: 'Bank', cash: 'Kasse', paymentService: 'Zahlungsdienst' };
const DIRECTION: Record<string, string> = { income: 'Einnahme', expense: 'Ausgabe', transit: 'Durchlauf' };
const SPHERE: Record<string, string> = { ideal: 'ideeller Bereich', assetManagement: 'Vermögensverwaltung', purposeOperation: 'Zweckbetrieb', business: 'wirtschaftlicher Geschäftsbetrieb' };
const DEDUCTIBLE: Record<string, string> = { no: 'nein', yes: 'ja', partial: 'teilweise' };
const RATE_KIND: Record<string, string> = { standard: 'voll', reduced: 'ermäßigt' };
const CONTACT_KIND: Record<string, string> = { person: 'Person', organization: 'Organisation' };
const CORRECTION_STATE: Record<string, string> = { pending: 'beantragt', applied: 'angewendet', rejected: 'abgelehnt' };
const PERIOD_KIND: Record<string, string> = { closed: 'abgeschlossen', reopened: 'wiedergeöffnet' };
const word = (table: Record<string, string>, value: string | null) => (value === null ? null : (table[value] ?? value));

// ── Bezüge über mehrere Dateien ─────────────────────────────────────────────

interface LineRef { contactId: string | null; projectId: string | null; purposeId: string | null; abroad: boolean }
const parseRef = (json: string): Partial<LineRef> => {
  try {
    return JSON.parse(json) as Partial<LineRef>;
  } catch {
    return {};
  }
};

const decidedAt = (c: FinanceAllocationCorrectionRow) => c.approvedAt ?? c.rejectedAt;

/** Korrekturen an Zeilen der Buchungen oder in einem der Jahre entschieden. Die Tabelle ist klein; sie steht im Fachdatensatz, nie im Protokoll. */
function correctionsInScope(db: DbOrTx, scope: ExportScope): FinanceAllocationCorrectionRow[] {
  const entryIds = new Set(db.select({ id: financeEntries.id }).from(financeEntries).where(inScope(scope)).all().map((e) => e.id));
  return db.select().from(financeAllocationCorrections).orderBy(asc(financeAllocationCorrections.requestedAt)).all().filter((c) => {
    if (entryIds.has(c.entryId)) return true;
    const decided = decidedAt(c)?.slice(0, 10);
    return decided !== undefined && scope.fiscalYears.some((y) => decided >= y.startsOn && decided <= y.endsOn);
  });
}

function referencedContactIds(db: DbOrTx, scope: ExportScope): string[] {
  const ids = new Set(
    db.selectDistinct({ id: financeAllocationLines.contactId }).from(financeAllocationLines).innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
      .where(and(inScope(scope), isNotNull(financeAllocationLines.contactId))).all().map((r) => r.id!),
  );
  for (const c of correctionsInScope(db, scope)) for (const ref of [parseRef(c.before), parseRef(c.after)]) if (ref.contactId) ids.add(ref.contactId);
  return [...ids];
}

function referencedProjectIds(db: DbOrTx, scope: ExportScope): string[] {
  const ids = new Set(
    db.selectDistinct({ id: financeAllocationLines.projectId }).from(financeAllocationLines).innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId))
      .where(and(inScope(scope), isNotNull(financeAllocationLines.projectId))).all().map((r) => r.id!),
  );
  for (const p of db.select({ id: financePurposes.projectId }).from(financePurposes).where(isNotNull(financePurposes.projectId)).all()) ids.add(p.id!);
  for (const c of correctionsInScope(db, scope)) for (const ref of [parseRef(c.before), parseRef(c.after)]) if (ref.projectId) ids.add(ref.projectId);
  return [...ids];
}

function referencedUserIds(db: DbOrTx, scope: ExportScope): string[] {
  const ids = new Set<string>();
  const add = (v: string | null | undefined) => v && ids.add(v);
  for (const e of db.select({ a: financeEntries.finalizedByUserId, b: financeEntries.createdByUserId }).from(financeEntries).where(inScope(scope)).all()) { add(e.a); add(e.b); }
  for (const d of db.select({ a: financeEntryDocuments.addedByUserId, b: financeEntryDocuments.revokedByUserId }).from(financeEntryDocuments).innerJoin(financeEntries, eq(financeEntries.id, financeEntryDocuments.entryId)).where(inScope(scope)).all()) { add(d.a); add(d.b); }
  for (const c of correctionsInScope(db, scope)) { add(c.requestedByUserId); add(c.approvedByUserId); add(c.rejectedByUserId); }
  for (const p of db.select({ a: financePeriodEvents.byUserId }).from(financePeriodEvents).where(inArray(financePeriodEvents.fiscalYearId, yearIds(scope))).all()) add(p.a);
  return [...ids];
}

/** In Teilen abfragen: SQLite kennt eine Grenze für Platzhalter. */
function* byIds<T>(ids: readonly string[], fetch: (chunk: string[]) => T[]): Generator<T> {
  const sorted = [...ids].sort();
  for (let i = 0; i < sorted.length; i += 500) yield* fetch(sorted.slice(i, i + 500));
}

// ── Dateien ─────────────────────────────────────────────────────────────────

const ENTRY_COLUMNS = [
  col('BUCHUNG_ID', 'Buchungs-ID', 'text', 'Kennung der Buchung; Bezug in Geldzeilen, Zuordnungszeilen, Belegen und Korrekturen'),
  col('BUCHUNGSNUMMER', 'Buchungsnummer', 'text', 'Fortlaufende Nummer im Geschäftsjahr, vergeben beim Festschreiben'),
  col('BUCHUNGSDATUM', 'Buchungsdatum', 'day', 'Tag des Geschäftsvorfalls'),
  col('BUCHUNGSTEXT', 'Buchungstext', 'text', 'Text der Buchung'),
  col('GESCHAEFTSJAHR', 'Geschäftsjahr', 'text', 'Bezeichnung des Geschäftsjahres'),
  col('FESTGESCHRIEBEN_AM', 'Festgeschrieben am', 'timestamp', 'Zeitpunkt des Festschreibens (ISO 8601, UTC); danach ist die Buchung unveränderlich'),
  col('FESTGESCHRIEBEN_VON', 'Festgeschrieben von', 'text', 'Nutzer-ID der festschreibenden Person (nutzer.csv)'),
  col('FESTGESCHRIEBEN_UEBER', 'Festgeschrieben über', 'text', 'Kanal: Oberfläche, Agent oder System'),
  col('NIMMT_ZURUECK', 'Nimmt zurück', 'text', 'Buchungs-ID der Buchung, die diese Gegenbuchung zurücknimmt'),
  col('ZURUECKGENOMMEN_DURCH', 'Zurückgenommen durch', 'text', 'Buchungs-ID der Gegenbuchung, die diese Buchung zurücknimmt'),
  col('KORREKTUR_VON', 'Korrektur von', 'text', 'Buchungs-ID der zurückgenommenen Buchung, die diese Buchung berichtigt'),
  col('ANGELEGT_AM', 'Angelegt am', 'timestamp', 'Zeitpunkt der ersten Erfassung (ISO 8601, UTC)'),
  col('ANGELEGT_VON', 'Angelegt von', 'text', 'Nutzer-ID der erfassenden Person (nutzer.csv)'),
] as const;

const MONEY_COLUMNS = [
  col('BUCHUNG_ID', 'Buchungs-ID', 'text', 'Buchung, zu der die Zeile gehört (buchungen.csv)'),
  col('POSITION', 'Position', 'integer', 'Reihenfolge der Geldzeilen in der Buchung'),
  col('KONTO_ID', 'Konto-ID', 'text', 'Konto (konten.csv)'),
  col('BETRAG', 'Betrag', 'amount', 'Betrag in Euro; positiv = Zufluss auf das Konto, negativ = Abfluss'),
  col('ROHUMSATZ_ID', 'Rohumsatz-ID', 'text', 'Kontoumsatz aus dem Auszug, den die Zeile bucht (rohumsaetze.csv); leer bei Bargeld und Gegenbuchungen'),
] as const;

const ALLOCATION_COLUMNS = [
  col('ZEILE_ID', 'Zeilen-ID', 'text', 'Kennung der Zuordnungszeile; Bezug in Korrekturen'),
  col('BUCHUNG_ID', 'Buchungs-ID', 'text', 'Buchung, zu der die Zeile gehört (buchungen.csv)'),
  col('POSITION', 'Position', 'integer', 'Reihenfolge der Zuordnungszeilen in der Buchung'),
  col('KATEGORIE_ID', 'Kategorie-ID', 'text', 'Kategorie (kategorien.csv)'),
  col('BETRAG', 'Betrag', 'amount', 'Bruttobetrag in Euro; positiv = Einnahme, negativ = Ausgabe'),
  col('STEUERKENNZEICHEN', 'Steuerkennzeichen', 'text', 'Umsatzsteuerliche Behandlung der Zeile (Kennzeichen)'),
  col('STEUERSATZ', 'Steuersatz', 'text', 'voll oder ermäßigt; nur bei Steuerschuld des Leistungsempfängers und innergemeinschaftlichem Erwerb von Bedeutung'),
  col('PROJEKT_ID', 'Projekt-ID', 'text', 'Projekt (projekte.csv)'),
  col('ZWECK_ID', 'Zweck-ID', 'text', 'Zweckgebundene Mittel (zwecke.csv)'),
  col('KONTAKT_ID', 'Kontakt-ID', 'text', 'Spender, Empfänger oder Geschäftspartner (kontakte.csv)'),
  col('AUSLAND', 'Ausland', 'bool', 'Mittelverwendung im Ausland'),
  col('URSPRUNGSZEILE_ID', 'Ursprungszeile', 'text', 'Zeilen-ID der Zeile, die eine Rücklastschrift oder Rückzahlung zurücknimmt'),
  col('ZUFUEHRUNG_VERMOEGEN', 'Zuführung zum Vermögen', 'bool', 'Zuwendung zur Zuführung zum Vermögen (§ 62 Abs. 3 AO)'),
  col('ZUFUEHRUNG_ABGEWAEHLT', 'Grund ohne Zuführung', 'text', 'Warum eine Erbschaft oder erhaltene Vermögensausstattung nicht dem Vermögen zugeführt wurde'),
  col('VERMOEGENSAUSSTATTUNG', 'Vermögensausstattung', 'bool', 'Erhaltene Mittel zur Vermögensausstattung (§ 58 Nr. 3 AO)'),
  col('LEISTUNGSDATUM', 'Leistungsdatum', 'day', 'Tag der Leistung (Drittland: Rechnungsdatum) bei Steuerschuld des Leistungsempfängers und innergemeinschaftlichem Erwerb; bestimmt mit dem Buchungstag den Zeitraum der Steuer'),
] as const;

/** Grund gegen die Zuführung zum Vermögen, in Worten wie die Oberfläche. */
const OPT_OUT_WORD: Record<string, string> = { testatorDirectedCurrentUse: 'Erblasser hat laufenden Aufwand bestimmt', donorAllowedCurrentUse: 'Geber hat den Verbrauch für laufende Zwecke gestattet' };

const ACCOUNT_COLUMNS = [
  col('KONTO_ID', 'Konto-ID', 'text', 'Kennung des Kontos'),
  col('NAME', 'Name', 'text', 'Bezeichnung des Kontos'),
  col('ART', 'Art', 'text', 'Bank, Kasse oder Zahlungsdienst'),
  col('IBAN', 'IBAN', 'text', 'IBAN des Kontos'),
  col('BIC', 'BIC', 'text', 'BIC des Kreditinstituts'),
  col('KREDITINSTITUT', 'Kreditinstitut', 'text', 'Name des Kreditinstituts'),
  col('ANFANGSBESTAND', 'Anfangsbestand', 'amount', 'Bestand bei Aufnahme in Kompass in Euro'),
  col('ANFANGSDATUM', 'Stichtag Anfangsbestand', 'day', 'Tag des Anfangsbestands'),
  col('HAUPTKONTO', 'Hauptkonto', 'bool', 'Hauptkonto des Vereins'),
  col('AKTIV', 'Aktiv', 'bool', 'Konto in Gebrauch'),
] as const;

const CATEGORY_COLUMNS = [
  col('KATEGORIE_ID', 'Kategorie-ID', 'text', 'Kennung der Kategorie'),
  col('SCHLUESSEL', 'Schlüssel', 'text', 'Fester Schlüssel der Kategorie'),
  col('NAME', 'Name', 'text', 'Bezeichnung der Kategorie'),
  col('RICHTUNG', 'Richtung', 'text', 'Einnahme, Ausgabe oder Durchlauf'),
  col('BEREICH', 'Bereich', 'text', 'Steuerlicher Bereich: ideeller Bereich, Vermögensverwaltung, Zweckbetrieb oder wirtschaftlicher Geschäftsbetrieb'),
  col('EINNAHMEART', 'Einnahmeart', 'text', 'Art der Einnahme (Kennzeichen)'),
  col('VORSTEUERABZUG', 'Vorsteuerabzug', 'text', 'ja, nein oder teilweise'),
  col('ANLAGENVERKAUF', 'Anlagenverkauf', 'bool', 'Erlös aus dem Verkauf von Anlagevermögen'),
  col('STEUERKENNZEICHEN_VORGABE', 'Steuerkennzeichen (Vorgabe)', 'text', 'Steuerkennzeichen, mit dem neue Zeilen dieser Kategorie beginnen'),
  col('KONTONUMMER_EXTERN', 'Externe Kontonummer', 'text', 'Konto im Kontenrahmen eines Steuerberaters'),
  col('AKTIV', 'Aktiv', 'bool', 'Kategorie in Gebrauch'),
] as const;

const PURPOSE_COLUMNS = [
  col('ZWECK_ID', 'Zweck-ID', 'text', 'Kennung des Zwecks'),
  col('NAME', 'Name', 'text', 'Bezeichnung der zweckgebundenen Mittel'),
  col('BESCHREIBUNG', 'Beschreibung', 'text', 'Beschreibung des Zwecks'),
  col('PROJEKT_ID', 'Projekt-ID', 'text', 'Projekt, zu dem der Zweck gehört (projekte.csv)'),
  col('AUSLAND', 'Ausland', 'bool', 'Verwendung im Ausland'),
  col('ZIELBETRAG', 'Zielbetrag', 'amount', 'Angestrebter Betrag in Euro'),
  col('AKTIV', 'Aktiv', 'bool', 'Zweck in Gebrauch'),
] as const;

const PROJECT_COLUMNS = [
  col('PROJEKT_ID', 'Projekt-ID', 'text', 'Kennung des Projekts'),
  col('NAME', 'Name', 'text', 'Name des Projekts'),
] as const;

const CONTACT_COLUMNS = [
  col('KONTAKT_ID', 'Kontakt-ID', 'text', 'Kennung des Kontakts'),
  col('NAME', 'Name', 'text', 'Name der Person oder Organisation'),
  col('ART', 'Art', 'text', 'Person oder Organisation'),
  col('STRASSE', 'Straße', 'text', 'Straße und Hausnummer'),
  col('PLZ', 'Postleitzahl', 'text', 'Postleitzahl'),
  col('ORT', 'Ort', 'text', 'Ort'),
  col('LAND', 'Land', 'text', 'Land'),
] as const;

const USER_COLUMNS = [
  col('NUTZER_ID', 'Nutzer-ID', 'text', 'Kennung des Nutzers in Kompass'),
  col('NAME', 'Name', 'text', 'Anzeigename des Nutzers'),
] as const;

const VOUCHER_COLUMNS = [
  col('VERKNUEPFUNG_ID', 'Verknüpfungs-ID', 'text', 'Kennung der Verknüpfung von Buchung und Beleg'),
  col('BUCHUNG_ID', 'Buchungs-ID', 'text', 'Buchung (buchungen.csv)'),
  col('DOKUMENTNUMMER', 'Dokumentnummer', 'text', 'Nummer des Belegs in der Dokumentenablage'),
  col('SHA256', 'SHA-256', 'text', 'Prüfsumme der Belegdatei beim Verknüpfen'),
  col('VERKNUEPFT_AM', 'Verknüpft am', 'timestamp', 'Zeitpunkt der Verknüpfung (ISO 8601, UTC)'),
  col('VERKNUEPFT_VON', 'Verknüpft von', 'text', 'Nutzer-ID (nutzer.csv)'),
  col('WIDERRUFEN_AM', 'Widerrufen am', 'timestamp', 'Zeitpunkt des Widerrufs der Verknüpfung (ISO 8601, UTC); leer, solange sie gilt'),
  col('WIDERRUFEN_VON', 'Widerrufen von', 'text', 'Nutzer-ID (nutzer.csv)'),
  col('ERSETZT_DURCH', 'Ersetzt durch', 'text', 'Verknüpfungs-ID des Ersatzbelegs'),
  col('DATEI_GELOESCHT_AM', 'Datei gelöscht am', 'timestamp', 'Zeitpunkt, zu dem die Belegdatei nach Ablauf ihrer Frist gelöscht wurde; Nummer und Prüfsumme bleiben'),
] as const;

const CORRECTION_COLUMNS = [
  col('KORREKTUR_ID', 'Korrektur-ID', 'text', 'Kennung der Zuordnungskorrektur'),
  col('ZEILE_ID', 'Zeilen-ID', 'text', 'Korrigierte Zuordnungszeile (zuordnungszeilen.csv)'),
  col('BUCHUNG_ID', 'Buchungs-ID', 'text', 'Buchung der Zeile (buchungen.csv)'),
  col('ZUSTAND', 'Zustand', 'text', 'beantragt, angewendet oder abgelehnt'),
  col('KONTAKT_VORHER', 'Kontakt vorher', 'text', 'Kontakt-ID vor der Korrektur'),
  col('KONTAKT_NACHHER', 'Kontakt nachher', 'text', 'Kontakt-ID nach der Korrektur'),
  col('PROJEKT_VORHER', 'Projekt vorher', 'text', 'Projekt-ID vor der Korrektur'),
  col('PROJEKT_NACHHER', 'Projekt nachher', 'text', 'Projekt-ID nach der Korrektur'),
  col('ZWECK_VORHER', 'Zweck vorher', 'text', 'Zweck-ID vor der Korrektur'),
  col('ZWECK_NACHHER', 'Zweck nachher', 'text', 'Zweck-ID nach der Korrektur'),
  col('AUSLAND_VORHER', 'Ausland vorher', 'bool', 'Mittelverwendung im Ausland vor der Korrektur'),
  col('AUSLAND_NACHHER', 'Ausland nachher', 'bool', 'Mittelverwendung im Ausland nach der Korrektur'),
  col('PARAGRAF_153', '§ 153 AO', 'bool', 'Die Korrektur betrifft eine abgegebene Erklärung (Berichtigung nach § 153 AO)'),
  col('BEANTRAGT_AM', 'Beantragt am', 'timestamp', 'Zeitpunkt des Antrags (ISO 8601, UTC)'),
  col('BEANTRAGT_VON', 'Beantragt von', 'text', 'Nutzer-ID (nutzer.csv)'),
  col('ENTSCHIEDEN_AM', 'Entschieden am', 'timestamp', 'Zeitpunkt der Freigabe oder Ablehnung (ISO 8601, UTC)'),
  col('ENTSCHIEDEN_VON', 'Entschieden von', 'text', 'Nutzer-ID (nutzer.csv)'),
  col('BEGRUENDUNG', 'Begründung', 'text', 'Begründung des Antrags'),
  col('ABLEHNUNGSGRUND', 'Ablehnungsgrund', 'text', 'Begründung der Ablehnung'),
] as const;

const RAW_COLUMNS = [
  col('ROHUMSATZ_ID', 'Rohumsatz-ID', 'text', 'Kennung des Kontoumsatzes; unveränderlich ab dem Einlesen'),
  col('AUSZUG_ID', 'Auszug-ID', 'text', 'Kennung des eingelesenen Kontoauszugs'),
  col('KONTO_ID', 'Konto-ID', 'text', 'Konto (konten.csv)'),
  col('BUCHUNGSTAG', 'Buchungstag', 'day', 'Buchungstag laut Bank'),
  col('VALUTA', 'Valuta', 'day', 'Wertstellung laut Bank'),
  col('BETRAG', 'Betrag', 'amount', 'Betrag in Euro; positiv = Gutschrift, negativ = Belastung'),
  col('GEGENPARTEI', 'Gegenpartei', 'text', 'Name der Gegenpartei laut Bank'),
  col('IBAN', 'IBAN der Gegenpartei', 'text', 'IBAN der Gegenpartei laut Bank'),
  col('VERWENDUNGSZWECK', 'Verwendungszweck', 'text', 'Verwendungszweck laut Bank'),
  col('BANKREFERENZ', 'Bankreferenz', 'text', 'Referenz der Bank'),
  col('BUCHUNG_ID', 'Buchungs-ID', 'text', 'Festgeschriebene Buchung, die den Umsatz bucht (buchungen.csv)'),
  col('FREIGEGEBEN_AM', 'Freigegeben am', 'timestamp', 'Zeitpunkt, zu dem eine Rücknahme den Umsatz von einer früheren Buchung gelöst hat'),
] as const;

const PERIOD_COLUMNS = [
  col('EREIGNIS_ID', 'Ereignis-ID', 'text', 'Kennung des Ereignisses'),
  col('GESCHAEFTSJAHR', 'Geschäftsjahr', 'text', 'Bezeichnung des Geschäftsjahres'),
  col('ART', 'Art', 'text', 'abgeschlossen oder wiedergeöffnet'),
  col('AM', 'Am', 'timestamp', 'Zeitpunkt (ISO 8601, UTC)'),
  col('VON', 'Von', 'text', 'Nutzer-ID (nutzer.csv)'),
  col('GRUND', 'Grund', 'text', 'Begründung des Wiederöffnens'),
] as const;

/** Eine Zeile als CSV: die Formel-Sperre nur für Text, Beträge, Tage und Zahlen bleiben Zahlen für die Prüfsoftware. */
export function exportLine(table: ExportTable, row: ExportRow): string {
  return row.map((value, i) => csvField(value, { formulaGuard: table.columns[i]?.type === 'text' })).join(';');
}

export const EXPORT_TABLES: readonly ExportTable[] = [
  {
    file: 'buchungen.csv', title: 'Buchungen', description: 'Festgeschriebene Buchungen der Geschäftsjahre (Kopf)', step: 'entries', columns: ENTRY_COLUMNS,
    *rows(db, scope) {
      for (const y of scope.fiscalYears) {
        for (const e of paged((limit, offset) => db.select().from(financeEntries).where(inYear(y.id)).orderBy(asc(financeEntries.number)).limit(limit).offset(offset).all())) {
          yield row(ENTRY_COLUMNS, [e.id, e.number, e.entryDate, e.text, designationOf(scope, e.fiscalYearId), e.finalizedAt, e.finalizedByUserId, word(CHANNEL, e.finalizedChannel), e.reversesEntryId, e.reversedByEntryId, e.correctionOfEntryId, e.createdAt, e.createdByUserId]);
        }
      }
    },
  },
  {
    file: 'geldzeilen.csv', title: 'Geldzeilen', description: 'Bewegungen auf Konten und Kassen je Buchung', step: 'entries', columns: MONEY_COLUMNS,
    *rows(db, scope) {
      for (const y of scope.fiscalYears) {
        for (const l of paged((limit, offset) => db.select({ l: financeMoneyLines }).from(financeMoneyLines).innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId)).where(inYear(y.id)).orderBy(asc(financeEntries.number), asc(financeMoneyLines.position)).limit(limit).offset(offset).all())) {
          yield row(MONEY_COLUMNS, [l.l.entryId, l.l.position, l.l.accountId, l.l.amountCents, l.l.rawTransactionId]);
        }
      }
    },
  },
  {
    file: 'zuordnungszeilen.csv', title: 'Zuordnungszeilen', description: 'Zuordnung der Beträge zu Kategorien, Projekten, Zwecken und Kontakten je Buchung', step: 'entries', columns: ALLOCATION_COLUMNS,
    *rows(db, scope) {
      for (const y of scope.fiscalYears) {
        for (const { l } of paged((limit, offset) => db.select({ l: financeAllocationLines }).from(financeAllocationLines).innerJoin(financeEntries, eq(financeEntries.id, financeAllocationLines.entryId)).where(inYear(y.id)).orderBy(asc(financeEntries.number), asc(financeAllocationLines.position)).limit(limit).offset(offset).all())) {
          yield row(ALLOCATION_COLUMNS, [l.id, l.entryId, l.position, l.categoryId, l.amountCents, l.taxCode, word(RATE_KIND, l.rateKind), l.projectId, l.purposeId, l.contactId, l.abroad, l.originLineId, l.addsToAssets, l.addsToAssetsOptOut ? (OPT_OUT_WORD[l.addsToAssetsOptOut] ?? l.addsToAssetsOptOut) : null, l.assetEndowment, l.serviceDate]);
        }
      }
    },
  },
  {
    file: 'konten.csv', title: 'Konten', description: 'Alle Konten und Kassen', step: 'masterData', columns: ACCOUNT_COLUMNS,
    *rows(db) {
      for (const a of db.select().from(financeAccounts).orderBy(asc(financeAccounts.name)).all()) {
        yield row(ACCOUNT_COLUMNS, [a.id, a.name, word(ACCOUNT_KIND, a.kind), a.iban, a.bic, a.bankName, a.openingBalanceCents, a.openingDate, a.isMain, a.isActive]);
      }
    },
  },
  {
    file: 'kategorien.csv', title: 'Kategorien', description: 'Alle Kategorien mit steuerlicher Einordnung', step: 'masterData', columns: CATEGORY_COLUMNS,
    *rows(db) {
      for (const c of db.select().from(financeCategories).orderBy(asc(financeCategories.key)).all()) {
        yield row(CATEGORY_COLUMNS, [c.id, c.key, c.name, word(DIRECTION, c.direction), word(SPHERE, c.sphere), c.incomeKind, word(DEDUCTIBLE, c.inputTaxDeductible), c.isAssetSale, c.defaultTaxCode, c.externalAccountNumber, c.isActive]);
      }
    },
  },
  {
    file: 'zwecke.csv', title: 'Zwecke', description: 'Alle zweckgebundenen Mittel', step: 'masterData', columns: PURPOSE_COLUMNS,
    *rows(db) {
      for (const p of db.select().from(financePurposes).orderBy(asc(financePurposes.name)).all()) {
        yield row(PURPOSE_COLUMNS, [p.id, p.name, p.description, p.projectId, p.abroad, p.targetCents, p.isActive]);
      }
    },
  },
  {
    file: 'projekte.csv', title: 'Projekte', description: 'Projekte mit Bezug in den Zeilen der Geschäftsjahre oder in einem Zweck', step: 'masterData', columns: PROJECT_COLUMNS,
    *rows(db, scope) {
      const locale = scope.locale ?? 'de';
      for (const p of byIds(referencedProjectIds(db, scope), (ids) => db.select({ id: projects.id, name: projects.name }).from(projects).where(inArray(projects.id, ids)).all())) {
        const names = (p.name ?? {}) as Record<string, string>;
        yield row(PROJECT_COLUMNS, [p.id, names[locale] ?? Object.values(names)[0] ?? null]);
      }
    },
  },
  {
    file: 'kontakte.csv', title: 'Kontakte', description: 'Kontakte mit Bezug in den Zeilen oder Korrekturen der Geschäftsjahre, mit Anschrift; ohne E-Mail und Telefon', step: 'masterData', columns: CONTACT_COLUMNS,
    *rows(db, scope) {
      for (const c of byIds(referencedContactIds(db, scope), (ids) => db.select().from(contacts).where(inArray(contacts.id, ids)).all())) {
        yield row(CONTACT_COLUMNS, [c.id, displayName(c), word(CONTACT_KIND, c.kind), c.street, c.postalCode, c.city, c.country]);
      }
    },
  },
  {
    file: 'nutzer.csv', title: 'Nutzer', description: 'Nutzer, die in den Dateien des Exports vorkommen', step: 'masterData', columns: USER_COLUMNS,
    *rows(db, scope) {
      for (const u of byIds(referencedUserIds(db, scope), (ids) => db.select({ id: coreSchema.users.id, name: coreSchema.users.name }).from(coreSchema.users).where(inArray(coreSchema.users.id, ids)).all())) {
        yield row(USER_COLUMNS, [u.id, u.name]);
      }
    },
  },
  {
    file: 'belege.csv', title: 'Belege', description: 'Verknüpfungen der Buchungen mit Belegen, auch widerrufene; die Belege selbst stecken im Prüfpaket', step: 'vouchers', columns: VOUCHER_COLUMNS,
    *rows(db, scope) {
      for (const y of scope.fiscalYears) {
        for (const { d } of paged((limit, offset) => db.select({ d: financeEntryDocuments }).from(financeEntryDocuments).innerJoin(financeEntries, eq(financeEntries.id, financeEntryDocuments.entryId)).where(inYear(y.id)).orderBy(asc(financeEntries.number), asc(financeEntryDocuments.addedAt)).limit(limit).offset(offset).all())) {
          yield row(VOUCHER_COLUMNS, [d.id, d.entryId, d.documentNumber, d.documentChecksum, d.addedAt, d.addedByUserId, d.revokedAt, d.revokedByUserId, d.replacedByLinkId, d.documentDeletedAt]);
        }
      }
    },
  },
  {
    file: 'zuordnungskorrekturen.csv', title: 'Zuordnungskorrekturen', description: 'Korrekturen an Zuordnungszeilen festgeschriebener Buchungen mit Vorher und Nachher', step: 'history', columns: CORRECTION_COLUMNS,
    *rows(db, scope) {
      for (const c of correctionsInScope(db, scope)) {
        const before = parseRef(c.before);
        const changed = parseRef(c.after);
        const after = (key: keyof LineRef) => (key in changed ? changed[key] : before[key]);
        yield row(CORRECTION_COLUMNS, [
          c.id, c.lineId, c.entryId, word(CORRECTION_STATE, c.state), before.contactId, after('contactId'), before.projectId, after('projectId'), before.purposeId, after('purposeId'), before.abroad, after('abroad'),
          c.section153, c.requestedAt, c.requestedByUserId, decidedAt(c), c.approvedByUserId ?? c.rejectedByUserId, c.note, c.rejectNote,
        ]);
      }
    },
  },
  {
    file: 'rohumsaetze.csv', title: 'Rohumsätze', description: 'Kontoumsätze aus eingelesenen Auszügen mit Buchungstag in den Geschäftsjahren; verworfene Auszüge fehlen', step: 'history', columns: RAW_COLUMNS,
    *rows(db, scope) {
      for (const y of scope.fiscalYears) {
        const raws = paged((limit, offset) =>
          db.select({ r: financeRawTransactions }).from(financeRawTransactions).innerJoin(financeImportRuns, eq(financeImportRuns.id, financeRawTransactions.runId))
            // Verworfene Auszüge waren ein Fehlgriff beim Einlesen und gehören nicht zu den Aufzeichnungen.
            .where(and(isNull(financeImportRuns.discardedAt), between(financeRawTransactions.bookingDate, y.startsOn, y.endsOn)))
            .orderBy(asc(financeRawTransactions.bookingDate), asc(financeRawTransactions.lineIndex), asc(financeRawTransactions.id)).limit(limit).offset(offset).all(),
        );
        for (const { r } of raws) {
          const lines = db.select({ entryId: financeMoneyLines.entryId, releasedAt: financeMoneyLines.rawReleasedAt, status: financeEntries.status }).from(financeMoneyLines)
            .innerJoin(financeEntries, eq(financeEntries.id, financeMoneyLines.entryId)).where(eq(financeMoneyLines.rawTransactionId, r.id)).all();
          const booked = lines.find((l) => l.releasedAt === null && l.status === 'final')?.entryId ?? null;
          const released = lines.map((l) => l.releasedAt).filter((v): v is string => v !== null).sort().at(-1) ?? null;
          yield row(RAW_COLUMNS, [r.id, r.runId, r.accountId, r.bookingDate, r.valueDate, r.amountCents, r.counterpartyName, r.counterpartyIban, r.purpose, r.bankReference, booked, released]);
        }
      }
    },
  },
  {
    file: 'periodenereignisse.csv', title: 'Periodenereignisse', description: 'Abschluss und Wiederöffnen der Geschäftsjahre', step: 'history', columns: PERIOD_COLUMNS,
    *rows(db, scope) {
      for (const e of db.select().from(financePeriodEvents).where(inArray(financePeriodEvents.fiscalYearId, yearIds(scope))).orderBy(asc(financePeriodEvents.at)).all()) {
        yield row(PERIOD_COLUMNS, [e.id, designationOf(scope, e.fiscalYearId), word(PERIOD_KIND, e.kind), e.at, e.byUserId, e.reason]);
      }
    },
  },
];
