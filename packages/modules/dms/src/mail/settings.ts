import { ok, requirePermission, validate, writeSettingInternal, type CallContext, type DbOrTx, type Deps, type Result } from '@kompass/core';
import { z } from 'zod';

/**
 * Der Absender der Mails in einem Zug (Handoff 2b E5, 22a): Adresse und Name Pflicht, Antwortadresse optional,
 * Höchstens je Minute. Alles oder nichts, je Schlüssel ein Eintrag im Protokoll. `settings.manage` wie jede
 * Einstellung.
 */
export const mailSettingsSchema = z.object({
  fromAddress: z.email(),
  fromName: z.string().trim().min(1).max(120),
  replyTo: z.email().nullable(),
  ratePerMinute: z.number().int().min(1).max(120),
});

export async function saveMailSettings(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<z.infer<typeof mailSettingsSchema>>> {
  const denied = requirePermission(ctx, 'settings.manage');
  if (denied) return denied;
  const parsed = validate(deps, mailSettingsSchema, input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  return deps.db.transaction((tx: DbOrTx) => {
    for (const [key, value] of [
      ['dms.mail.fromAddress', v.fromAddress],
      ['dms.mail.fromName', v.fromName],
      ['dms.mail.replyTo', v.replyTo],
      ['dms.mail.ratePerMinute', v.ratePerMinute],
    ] as const) {
      const written = writeSettingInternal(tx, deps, ctx, key, value);
      // Das Schema oben ist strenger als die Einstellungen; scheitert es trotzdem, ist das ein technischer Fehler.
      if (!written.ok) throw new Error(`mail setting rejected: ${key}`);
    }
    return ok(v);
  });
}
