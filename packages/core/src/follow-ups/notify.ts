import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { CallContext } from '../context';
import { paperDate, type IsoDay } from '../dates';
import { users } from '../db/schema';
import type { Deps } from '../deps';
import { newId } from '../ids';
import { resolveRecordLabel } from '../modules/record-hooks';
import { requirePermission } from '../permissions/check';
import { notFound, ok, type Result } from '../result';
import { getEffectivePermissions } from '../roles/effective';
import { sendSystemMail, systemMailAvailable } from '../system-mail';
import { validate } from '../validate';
import { resolveFollowUpTarget } from './targets';
import type { FollowUpRecord } from './service';

/**
 * Was aus der Mail an die zugewiesene Person wurde: `notNeeded` ohne Zuweisung oder an sich selbst, `noAddress` ohne
 * gültige Adresse (oder deaktiviertes Konto), `unavailable` ohne Mailversand, `failed` wenn der Versand scheiterte.
 */
export type FollowUpMailResult = 'sent' | 'notNeeded' | 'noAddress' | 'unavailable' | 'failed';
export interface FollowUpNotice {
  mail: FollowUpMailResult;
}
export type FollowUpMailState = 'ready' | 'notNeeded' | 'noAddress' | 'unavailable';

/**
 * Texte der Mail (Sprachtabelle im Kern wie `BACKUP_MAIL_TEXTS`, AGENTS Prinzip 7, Ausnahme: Die Mail entsteht ohne die
 * Sprachdatei der App). Platzhalter `{Titel}`, `{Name}`, `{Datum}`, `{Ort}`; `subjectHidden`/`bodyHidden` ohne Titel, wenn die
 * Person den Datensatz nicht lesen darf oder er heikel ist.
 */
export const FOLLOW_UP_MAIL_TEXTS: Record<string, { subject: string; subjectHidden: string; body: string; bodyHidden: string; place: string; nobody: string }> = {
  de: {
    subject: 'Wiedervorlage: {Titel}',
    subjectHidden: 'Wiedervorlage in Kompass',
    body: 'Guten Tag,\n\n{Name} hat Ihnen in Kompass eine Wiedervorlage zugewiesen, fällig am {Datum}: {Titel}.\n\n{Ort}\n\nDiese Nachricht hat Kompass automatisch geschickt.',
    bodyHidden: 'Guten Tag,\n\n{Name} hat Ihnen in Kompass eine Wiedervorlage zugewiesen, fällig am {Datum}.\n\n{Ort}\n\nDiese Nachricht hat Kompass automatisch geschickt.',
    place: 'Sie finden sie in Kompass auf der Startseite unter „Fällig“.',
    nobody: 'Kompass',
  },
  en: {
    subject: 'Follow-up: {Titel}',
    subjectHidden: 'Follow-up in Kompass',
    body: 'Hello,\n\n{Name} has assigned a follow-up to you in Kompass, due on {Datum}: {Titel}.\n\n{Ort}\n\nKompass sent this message automatically.',
    bodyHidden: 'Hello,\n\n{Name} has assigned a follow-up to you in Kompass, due on {Datum}.\n\n{Ort}\n\nKompass sent this message automatically.',
    place: 'You will find it in Kompass on the start page under “Due”.',
    nobody: 'Kompass',
  },
};

const fill = (text: string, values: Record<string, string>) => text.replace(/\{([A-Za-zä]+)\}/g, (match, name: string) => values[name] ?? match);

function recipientOf(deps: Deps, userId: string) {
  return deps.db.select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, userId)).get() ?? null;
}

/** Dieselbe Prüfung wie vor dem Senden, ohne zu senden — für den Hinweis beim Zuweisen. Unbekannte Person: `noAddress`. */
export function followUpMailStateInternal(deps: Deps, userId: string | null, actorUserId: string | null): FollowUpMailState {
  if (!userId || userId === actorUserId) return 'notNeeded';
  const user = recipientOf(deps, userId);
  if (!user || !user.isActive || !z.email().safeParse(user.email).success) return 'noAddress';
  return systemMailAvailable(deps) ? 'ready' : 'unavailable';
}

export const followUpMailStateSchema = z.object({ assigneeUserId: z.string().trim().min(1) });

/** Ob eine Zuweisung an diese Person eine Mail auslöst (Designer: Hinweis beim Zuweisen). `followUps.view`. */
export async function followUpMailState(deps: Deps, ctx: CallContext, input: unknown): Promise<Result<{ state: FollowUpMailState }>> {
  const denied = requirePermission(ctx, 'followUps.view');
  if (denied) return denied;
  const parsed = validate(deps, followUpMailStateSchema, input);
  if (!parsed.ok) return parsed;
  if (!recipientOf(deps, parsed.value.assigneeUserId)) return notFound('user', parsed.value.assigneeUserId);
  return ok({ state: followUpMailStateInternal(deps, parsed.value.assigneeUserId, ctx.userId) });
}

/** Titel und Weg, wie die Person sie sehen darf: Ohne Leserecht oder bei heiklem Datensatz kein Titel. */
function targetFor(deps: Deps, recipientId: string, record: FollowUpRecord): { titleVisible: boolean; href: string | null } {
  const recipientCtx: CallContext = { userId: recipientId, permissions: getEffectivePermissions(deps.db, deps.registry, recipientId), channel: 'system', apiTokenId: null, ipAddress: null, requestId: newId() };
  const label = resolveRecordLabel(deps, recipientCtx, record.entityType, record.entityId);
  if (label) return { titleVisible: label.state === 'ok' && !label.sensitive, href: label.state === 'missing' ? null : label.href };
  return { titleVisible: true, href: resolveFollowUpTarget(deps, record.entityType, record.entityId)?.href ?? null };
}

/**
 * Schreibt der zugewiesenen Person eine kurze Mail — nach der Transaktion der Wiedervorlage. Wirft nie; ein Fehler wird
 * `failed`. Kein Protokolleintrag: Die Wiedervorlage ist protokolliert, die Mail trägt nichts Neues.
 */
export async function notifyFollowUpAssignee(deps: Deps, ctx: CallContext, record: FollowUpRecord): Promise<FollowUpNotice> {
  try {
    const state = followUpMailStateInternal(deps, record.assigneeUserId, ctx.userId);
    if (state !== 'ready') return { mail: state };
    const recipient = recipientOf(deps, record.assigneeUserId!)!;
    // Nutzer haben keine eigene Sprache: Leitsprache, Rückfall Deutsch.
    const texts = FOLLOW_UP_MAIL_TEXTS[deps.locales()[0] ?? 'de'] ?? FOLLOW_UP_MAIL_TEXTS.de!;
    const target = targetFor(deps, recipient.id, record);
    const actor = ctx.userId ? recipientOf(deps, ctx.userId)?.name : null;
    const values = {
      Titel: record.title,
      Name: actor || texts.nobody,
      Datum: paperDate(record.dueAt as IsoDay),
      Ort: deps.publicUrl && target.href ? `${deps.publicUrl}${target.href}` : texts.place,
    };
    const subject = target.titleVisible ? fill(texts.subject, values) : texts.subjectHidden;
    const result = await sendSystemMail(deps, { to: recipient.email, subject, text: fill(target.titleVisible ? texts.body : texts.bodyHidden, values) });
    if (result.sent) return { mail: 'sent' };
    return { mail: result.reason === 'unavailable' ? 'unavailable' : 'failed' };
  } catch (error) {
    console.error('[follow-ups] Mail an die zugewiesene Person gescheitert', error);
    return { mail: 'failed' };
  }
}
