import type { EntryLockCode } from './errors';
import type { CallContext, DbOrTx, Deps } from '@kompass/core';

/**
 * Statische Arrays, kein Laufzeit-Register: Next lädt Module je Route-Bundle
 * neu, ein Register trüge nicht (Spec 4.1). Gefüllt ab F6a
 * (`donations/locks.ts` „Zeile steht in gültiger Bestätigung“) und F9a
 * (`reporting/locks.ts`).
 *
 * Wer die Sperren einträgt, ist `manifest.ts` (Verdrahtung): `ledger/` kennt
 * `donations/` nicht. Weil jedes Bundle, das einen Dienst des Moduls lädt, über
 * `index.ts` auch das Manifest lädt, steht die Liste in jedem Bundle, bevor
 * ein Dienst sie liest — und `registerEntryLocks` ist idempotent, damit ein
 * zweites Laden nichts verdoppelt.
 */
/** Befund 49: Eine Sperre nennt Code und Parameter ihres Konflikts, keinen Satz — der Wortlaut steht in der Sprachdatei. */
export type EntryLock = (db: DbOrTx, entryId: string) => { scope: 'entry' | 'contact'; code: EntryLockCode; params: Record<string, string> } | null;
/**
 * Befund 49 wie `EntryLock`: Was das Wiederöffnen bewirkt, als Code und Parameter (`finance.reopenConsequences.<code>`),
 * kein Satz. `null`, wenn der Wächter für dieses Jahr nichts zu tun hat.
 */
export interface PeriodReopenConsequence { code: string; params: Record<string, string | number> }
export interface PeriodReopenGuard { describe(db: DbOrTx, yearId: string): PeriodReopenConsequence | null; onReopen(tx: DbOrTx, deps: Deps, ctx: CallContext, yearId: string, reason: string): void }

/**
 * Rechenschaft D1: Was beim Abschluss eines Jahres in derselben Transaktion mitläuft (Prüfstand der Kassenprüfung).
 * Wirft ein Haken, bleibt das Jahr offen.
 */
export interface PeriodCloseHook { onClose(tx: DbOrTx, deps: Deps, ctx: CallContext, yearId: string): void }

/**
 * Rechenschaft D1: Prüfung der Zeugen einer Kassenzählung („im Beisein von“) — `null`, wenn sie passen, sonst der
 * Code der Ablehnung (`invalid` am Feld `witnessAuditorIds`).
 */
export type CashCountWitnessCheck = (db: DbOrTx, countedOn: string, auditorIds: readonly string[]) => { code: string } | null;

const entryLocks: EntryLock[] = [];

export const ENTRY_LOCKS: readonly EntryLock[] = entryLocks;
const reopenGuards: PeriodReopenGuard[] = [];
export const PERIOD_REOPEN_GUARDS: readonly PeriodReopenGuard[] = reopenGuards;

/** Trägt Sperren in `ENTRY_LOCKS` ein — jede höchstens einmal. */
export function registerEntryLocks(locks: readonly EntryLock[]): void {
  for (const lock of locks) if (!entryLocks.includes(lock)) entryLocks.push(lock);
}

/** Trägt Wächter in `PERIOD_REOPEN_GUARDS` ein — jeden höchstens einmal (wie `registerEntryLocks`). */
export function registerReopenGuards(guards: readonly PeriodReopenGuard[]): void {
  for (const guard of guards) if (!reopenGuards.includes(guard)) reopenGuards.push(guard);
}

const closeHooks: PeriodCloseHook[] = [];
export const PERIOD_CLOSE_HOOKS: readonly PeriodCloseHook[] = closeHooks;

/** Trägt Haken in `PERIOD_CLOSE_HOOKS` ein — jeden höchstens einmal (wie `registerEntryLocks`). */
export function registerCloseHooks(hooks: readonly PeriodCloseHook[]): void {
  for (const hook of hooks) if (!closeHooks.includes(hook)) closeHooks.push(hook);
}

const witnessChecks: CashCountWitnessCheck[] = [];
export const CASH_COUNT_WITNESS_CHECKS: readonly CashCountWitnessCheck[] = witnessChecks;

/** Trägt Prüfungen in `CASH_COUNT_WITNESS_CHECKS` ein — jede höchstens einmal. */
export function registerCashCountWitnessChecks(checks: readonly CashCountWitnessCheck[]): void {
  for (const check of checks) if (!witnessChecks.includes(check)) witnessChecks.push(check);
}

/**
 * Rechenschaft C (Joe 2026-10-24): eine Hinweiszeile im Kopf festgeschriebener Berichte eines Jahres — „Nach der
 * Prüfung geändert, berichtet in <Folgejahr>“ nach einer Übernahme ins Folgejahr. `since`: Fassungen, die vorher
 * festgeschrieben wurden, tragen sie nicht. `reporting/` kennt `auditing/` nicht; eingetragen in `manifest.ts`.
 */
export type FinalStageNote = (db: DbOrTx, fiscalYearId: string) => { text: string; since: string } | null;

const finalStageNotes: FinalStageNote[] = [];
export const FINAL_STAGE_NOTES: readonly FinalStageNote[] = finalStageNotes;

/** Trägt Hinweise in `FINAL_STAGE_NOTES` ein — jeden höchstens einmal. */
export function registerFinalStageNotes(notes: readonly FinalStageNote[]): void {
  for (const note of notes) if (!finalStageNotes.includes(note)) finalStageNotes.push(note);
}

/**
 * Rechenschaft E2 (Designer Runde 5, 279 Telefon): der Stand einer offenen Nachprüfung eines Jahres — `unchanged`
 * (Schritt 10 bestätigt nur), `changed` (Nachtrag oder Übernahme), `null` ohne. Solange sie offen ist, stellt Schritt 10
 * die Freigabe wieder her, nicht „Freigeben …“. `reporting/` kennt `auditing/` nicht; eingetragen in `manifest.ts`.
 */
export type ReleaseFollowUpCheck = (db: DbOrTx, fiscalYearId: string) => 'unchanged' | 'changed' | null;

const releaseFollowUpChecks: ReleaseFollowUpCheck[] = [];
export const RELEASE_FOLLOW_UP_CHECKS: readonly ReleaseFollowUpCheck[] = releaseFollowUpChecks;

/** Trägt Prüfungen in `RELEASE_FOLLOW_UP_CHECKS` ein — jede höchstens einmal. */
export function registerReleaseFollowUpChecks(checks: readonly ReleaseFollowUpCheck[]): void {
  for (const check of checks) if (!releaseFollowUpChecks.includes(check)) releaseFollowUpChecks.push(check);
}

/** Der erste gemeldete Stand einer offenen Nachprüfung, sonst `null`. */
export function releaseFollowUpInternal(db: DbOrTx, fiscalYearId: string): 'unchanged' | 'changed' | null {
  for (const check of RELEASE_FOLLOW_UP_CHECKS) {
    const state = check(db, fiscalYearId);
    if (state) return state;
  }
  return null;
}

/**
 * Designer Runde 8, 347: Worauf eine Freigabe „Prüfbericht“ beruht — der Tag des geltenden Prüfberichts und, nach einer
 * Nachprüfung ohne geänderte Buchung, der Tag ihrer Bestätigung. `reporting/` kennt `auditing/` nicht; eingetragen in
 * `manifest.ts`.
 */
export interface ReleaseAuditFacts { reportFiledAt: string | null; followUpConfirmedAt: string | null }
export type ReleaseAuditSource = (db: DbOrTx, fiscalYearId: string) => ReleaseAuditFacts | null;

const releaseAuditSources: ReleaseAuditSource[] = [];

/** Trägt Quellen für `releaseAuditInternal` ein — jede höchstens einmal. */
export function registerReleaseAuditSources(sources: readonly ReleaseAuditSource[]): void {
  for (const source of sources) if (!releaseAuditSources.includes(source)) releaseAuditSources.push(source);
}

/** Die erste gemeldete Grundlage einer Freigabe, sonst `null`. */
export function releaseAuditInternal(db: DbOrTx, fiscalYearId: string): ReleaseAuditFacts | null {
  for (const source of releaseAuditSources) {
    const facts = source(db, fiscalYearId);
    if (facts) return facts;
  }
  return null;
}
