import { invalid, ok, readSetting, requireAnyPermission, requirePermission, validate, writeSettingInternal, type CallContext, type DbOrTx, type Deps, type Result, type SettingDefinition } from '@kompass/core';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { financeAccounts } from '../schema';
import { isValidCreditorId, normalizeCreditorId } from './creditor-id';

/** Der SEPA-Zeichensatz einer Mandatsreferenz (Plan L1, Global Constraints): `A–Z a–z 0–9 + ? / - : ( ) . , '` und Leerzeichen. */
export const SEPA_REFERENCE_CHARS = /^[A-Za-z0-9+?/\-:().,' ]*$/;
/** Höchstlänge einer Mandatsreferenz im SEPA-Regelwerk. */
export const MANDATE_REFERENCE_MAX = 35;

export interface MandateReferenceFormat {
  prefix: string;
  digits: number;
}

const creditorIdSchema = z
  .string()
  .transform(normalizeCreditorId)
  .refine(isValidCreditorId, 'invalidCreditorId');

export const mandateReferenceFormatSchema = z.object({
  prefix: z.string().max(20).regex(SEPA_REFERENCE_CHARS, 'invalidCharacters'),
  digits: z.number().int().min(1).max(10),
});

/**
 * Gläubiger-Daten und Fristen der Lastschrift (Spec § 7.1, Plan L1 Task 1). Was nur die Bank kennt (Limit,
 * Rückgabeentgelt), steht in der Lastschriftvereinbarung, nicht hier. `accountId` leer = Hauptkonto,
 * `creditorName` leer = Vereinsname.
 */
export const SEPA_SETTINGS: readonly SettingDefinition[] = [
  { key: 'finance.sepa.enabled', schema: z.boolean(), default: false },
  { key: 'finance.sepa.creditorId', schema: creditorIdSchema.nullable(), default: null },
  { key: 'finance.sepa.creditorName', schema: z.string().trim().min(1).max(70).nullable(), default: null },
  { key: 'finance.sepa.accountId', schema: z.string().min(1).nullable(), default: null },
  /** Bank: Einreichung spätestens n Bankarbeitstage vor Fälligkeit (Recherche: Beispiel einer Volksbank „2 Geschäftstage“). */
  { key: 'finance.sepa.leadBusinessDays', schema: z.number().int().min(1).max(10), default: 2 },
  /** Bank: Einreichung frühestens n Kalendertage vor Fälligkeit — begrenzt den Tag der Einreichung, nicht den Fälligkeitstag. */
  { key: 'finance.sepa.maxLeadDays', schema: z.number().int().min(1).max(60), default: 14 },
  /** Vorabankündigung mindestens n Kalendertage vor dem Einzug. */
  { key: 'finance.sepa.preNotificationDays', schema: z.number().int().min(1).max(30), default: 14 },
  { key: 'finance.sepa.batchBooking', schema: z.boolean(), default: true },
  { key: 'finance.sepa.mandateReferenceFormat', schema: mandateReferenceFormatSchema, default: { prefix: 'MND-', digits: 6 } },
];

export type SepaSetupGap = 'creditorId' | 'account' | 'accountIban';

/** Das Konto, auf dem eingezogen wird: die Einstellung, sonst das aktive Hauptkonto. */
export function sepaAccountInternal(deps: Deps) {
  const accountId = readSetting<string | null>(deps, 'finance.sepa.accountId');
  const where = accountId ? eq(financeAccounts.id, accountId) : and(eq(financeAccounts.isMain, true), eq(financeAccounts.isActive, true));
  return deps.db.select().from(financeAccounts).where(where).get() ?? null;
}

/**
 * Wie weit die Lastschrift eingerichtet ist (berechnet, nie gespeichert): Gläubiger-ID, ein Konto, und das Konto mit
 * IBAN. `ready` erst, wenn eingeschaltet und nichts fehlt.
 */
/** Dienst zu `sepaSetupState` — für Oberfläche und Agent: wer Lastschrift vorbereitet, einrichtet oder liest. */
export async function getSepaSetupState(deps: Deps, ctx: CallContext): Promise<Result<{ enabled: boolean; ready: boolean; missing: SepaSetupGap[] }>> {
  const denied = requireAnyPermission(ctx, ['finance.directDebit', 'finance.setup', 'finance.read']);
  if (denied) return denied;
  return ok(sepaSetupState(deps));
}

export function sepaSetupState(deps: Deps): { enabled: boolean; ready: boolean; missing: SepaSetupGap[] } {
  const enabled = readSetting<boolean>(deps, 'finance.sepa.enabled');
  const missing: SepaSetupGap[] = [];
  if (!readSetting<string | null>(deps, 'finance.sepa.creditorId')) missing.push('creditorId');
  const account = sepaAccountInternal(deps);
  if (!account) missing.push('account');
  else if (!account.iban) missing.push('accountIban');
  return { enabled, ready: enabled && missing.length === 0, missing };
}

/**
 * Was die Seite „Einstellungen › Finanzen › Lastschrift“ speichert (Handoff 2a § 2). Leer heißt bei Gläubiger-Name und
 * Konto die Vorgabe (Vereinsname, Hauptkonto); die Gläubiger-ID wird geprüft wie in der Einstellung selbst.
 */
export const sepaSettingsSaveSchema = z.object({
  enabled: z.boolean().optional(),
  creditorId: z.string().trim().max(40).nullable().optional(),
  creditorName: z.string().trim().max(70).nullable().optional(),
  accountId: z.string().min(1).nullable().optional(),
  leadBusinessDays: z.number().int().min(1).max(10).optional(),
  maxLeadDays: z.number().int().min(1).max(60).optional(),
  preNotificationDays: z.number().int().min(1).max(30).optional(),
  batchBooking: z.boolean().optional(),
  mandateReferenceFormat: mandateReferenceFormatSchema.optional(),
});

const SEPA_SAVE_KEYS = ['enabled', 'creditorId', 'creditorName', 'accountId', 'leadBusinessDays', 'maxLeadDays', 'preNotificationDays', 'batchBooking', 'mandateReferenceFormat'] as const;

/**
 * `finance.setup`: die Lastschrift-Einstellungen in einem Zug. Geschrieben wird nur, was sich ändert, je Wert ein
 * Eintrag `finance.setup.setting` im Protokoll (Schlüssel, vorher/nachher wie jede Einstellung). Eine falsche
 * Prüfziffer der Gläubiger-ID lehnt am Feld ab (`invalidCreditorId`), ein Konto muss aktiv sein.
 */
export async function saveSepaSettings(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ changed: string[] }>> {
  const denied = requirePermission(ctx, 'finance.setup');
  if (denied) return denied;
  const parsed = validate(deps, sepaSettingsSaveSchema, input);
  if (!parsed.ok) return parsed;
  const v = { ...parsed.value };
  if (v.creditorId !== undefined) v.creditorId = v.creditorId ? normalizeCreditorId(v.creditorId) : null;
  if (v.creditorName !== undefined) v.creditorName = v.creditorName || null;
  if (v.creditorId && !isValidCreditorId(v.creditorId)) return invalid([{ path: 'creditorId', message: 'invalidCreditorId' }]);
  if (v.accountId) {
    const account = deps.db.select().from(financeAccounts).where(eq(financeAccounts.id, v.accountId)).get();
    if (!account || !account.isActive) return invalid([{ path: 'accountId', message: 'unknownAccount' }]);
  }
  return deps.db.transaction((tx: DbOrTx) => {
    const changed: string[] = [];
    for (const key of SEPA_SAVE_KEYS) {
      const value = v[key];
      if (value === undefined) continue;
      const settingKey = key === 'mandateReferenceFormat' ? 'finance.sepa.mandateReferenceFormat' : `finance.sepa.${key}`;
      if (JSON.stringify(readSetting(deps, settingKey)) === JSON.stringify(value)) continue;
      const written = writeSettingInternal(tx, deps, ctx, settingKey, value, 'finance.setup.setting');
      if (!written.ok) return written;
      changed.push(settingKey);
    }
    return ok({ changed });
  });
}
