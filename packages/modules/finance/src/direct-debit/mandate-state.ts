import type { DbOrTx } from '@kompass/core';
import { and, eq, inArray } from 'drizzle-orm';
import { compactIban } from '../format/iban';
import { financeSepaMandates, type FinanceSepaMandateRow } from '../schema';
import { addCalendarMonths } from './business-days';

/** Ohne Einzug verfällt ein Mandat nach 36 Monaten (SEPA-Regelwerk). */
export const MANDATE_EXPIRY_MONTHS = 36;

export type MandateState = 'pending' | 'active' | 'ended' | 'expired';
export const MANDATE_STATES = ['pending', 'active', 'ended', 'expired'] as const;

/**
 * Der Zustand eines Mandats, berechnet (Spec § 7.2): beendet ab dem Tag des Endes; ohne Unterschrift vorbereitet;
 * verfallen ab dem Tag nach 36 Monaten ohne Einzug — gerechnet ab dem letzten Einzug, sonst ab der Unterschrift.
 */
export function mandateState(row: Pick<FinanceSepaMandateRow, 'signedOn' | 'endedOn' | 'lastCollectedOn'>, today: string): MandateState {
  if (row.endedOn && row.endedOn <= today) return 'ended';
  if (!row.signedOn) return 'pending';
  return mandateExpiresOn(row)! < today ? 'expired' : 'active';
}

/** Der letzte Tag, an dem ein unterschriebenes Mandat ohne weiteren Einzug gilt. */
export function mandateExpiresOn(row: Pick<FinanceSepaMandateRow, 'signedOn' | 'lastCollectedOn'>): string | null {
  const base = row.lastCollectedOn ?? row.signedOn;
  return base ? addCalendarMonths(base, MANDATE_EXPIRY_MONTHS) : null;
}

/**
 * Ein gültiges (aktives) Mandat eines dieser Kontakte über die IBAN — die Zuordnung Kontakt ↔ IBAN lässt sich dann
 * nicht lösen (Plan U4 Task 3, `ibanHasMandate`). Ohne Rechteprüfung. Eigene Datei, damit der Import sie ohne
 * Kreis über `mandates.ts` kennt.
 */
export function activeMandateForIbanInternal(db: DbOrTx, contactIds: readonly string[], iban: string, today: string): FinanceSepaMandateRow | null {
  if (contactIds.length === 0) return null;
  return db.select().from(financeSepaMandates).where(and(inArray(financeSepaMandates.contactId, [...contactIds]), eq(financeSepaMandates.iban, iban))).all().find((m) => mandateState(m, today) === 'active') ?? null;
}

/**
 * Die Kontakte, denen das Konto eines Umsatzes laut Mandat gehört (Plan N3, U1) — `null`, wenn der Umsatz nicht über
 * ein Mandat des Vereins läuft. Über ein Mandat läuft eine Zeile mit dessen Mandatsreferenz, und eine Rückgabe
 * (`returnCode`) ohne Referenz vom Konto eines Mandats. Eine fremde Mandatsreferenz (ein Lieferant zieht beim Verein
 * ein) ist kein Mandat des Vereins. Ohne Rechteprüfung: für das Lernen der IBAN beim Buchen.
 */
export function mandateHoldersForLineInternal(db: DbOrTx, line: { counterpartyIban: string | null; mandateReference: string | null; returnCode: string | null }): string[] | null {
  if (line.mandateReference) {
    const byReference = db.select({ contactId: financeSepaMandates.contactId }).from(financeSepaMandates).where(eq(financeSepaMandates.reference, line.mandateReference)).all();
    if (byReference.length > 0) return [...new Set(byReference.map((m) => m.contactId))];
  }
  if (line.returnCode && line.counterpartyIban) {
    const byIban = db.select({ contactId: financeSepaMandates.contactId }).from(financeSepaMandates).where(eq(financeSepaMandates.iban, compactIban(line.counterpartyIban))).all();
    if (byIban.length > 0) return [...new Set(byIban.map((m) => m.contactId))];
  }
  return null;
}
