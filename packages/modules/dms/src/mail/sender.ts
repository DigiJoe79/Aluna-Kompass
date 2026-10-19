import { isoNow, readSetting, recordAudit, systemContext, todayIn, type CallContext, type DbOrTx, type Deps, type MailErrorCode } from '@kompass/core';
import { contacts, displayName } from '@kompass/module-contacts';
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import { applyDispatchInternal } from '../dispatch';
import { dmsMailOutbox, documents, type DmsMailOutboxRow } from '../schema';
import { readDocumentFile } from '../storage';
import { mailBodyFor } from './body';
import { mailSender } from './outbox';

const MINUTE = 60_000;
/** Drei Versuche; dazwischen 1 und 5 Minuten (30 als Reserve, falls die Zahl der Versuche einmal steigt). */
export const MAIL_MAX_ATTEMPTS = 3;
const BACKOFF_MINUTES = [1, 5, 30];
/** Wer länger als zehn Minuten in `sending` steht, gehört zu einem abgestürzten Prozess. */
const STALE_SENDING_MS = 10 * MINUTE;
/** Adressen bleiben 90 Tage im Ausgangskorb (Spec § 3, Datenschutz). */
const ADDRESS_RETENTION_DAYS = 90;
const SERVER_TEXT_MAX = 200;

/**
 * Die Antwort eines Mailservers nennt oft die Adresse, die er ablehnt. Im
 * Ausgangskorb steht sie gekürzt und ohne Adresse (Bewertung Phase 2b).
 */
export function sanitizeServerText(text: string): string {
  return text.replace(/[^\s<>"'()[\],;:]+@[^\s<>"'()[\],;:]+/g, '…').slice(0, SERVER_TEXT_MAX);
}

const minutesFrom = (iso: string, minutes: number) => new Date(new Date(iso).getTime() + minutes * MINUTE).toISOString();
const msBefore = (iso: string, ms: number) => new Date(new Date(iso).getTime() - ms).toISOString();

/** Der Kontext, unter dem der Sender protokolliert: Kanal `system`, Nutzer der, der eingereiht hat. */
function senderContext(entry: Pick<DmsMailOutboxRow, 'queuedByUserId'>): CallContext {
  return { ...systemContext(), userId: entry.queuedByUserId };
}

/** Hängende Sendungen eines abgestürzten Prozesses: ein Versuch mehr, zurück in die Schlange. */
function recoverStale(deps: Deps, now: string): void {
  const stale = deps.db
    .select()
    .from(dmsMailOutbox)
    .where(and(eq(dmsMailOutbox.status, 'sending'), lt(dmsMailOutbox.sendingSince, msBefore(now, STALE_SENDING_MS))))
    .all();
  for (const entry of stale) {
    const attempts = entry.attempts + 1;
    if (attempts >= MAIL_MAX_ATTEMPTS) {
      deps.db.transaction((tx: DbOrTx) => markFailed(tx, deps, entry, attempts, 'other', null));
      continue;
    }
    deps.db
      .update(dmsMailOutbox)
      .set({ status: 'queued', attempts, sendingSince: null, nextAttemptAt: null })
      .where(and(eq(dmsMailOutbox.id, entry.id), eq(dmsMailOutbox.status, 'sending')))
      .run();
  }
}

function markFailed(tx: DbOrTx, deps: Deps, entry: DmsMailOutboxRow, attempts: number, code: MailErrorCode, text: string | null): void {
  tx.update(dmsMailOutbox)
    .set({ status: 'failed', attempts, sendingSince: null, nextAttemptAt: null, lastErrorCode: code, lastErrorText: text })
    .where(eq(dmsMailOutbox.id, entry.id))
    .run();
  const doc = tx.select({ number: documents.number }).from(documents).where(eq(documents.id, entry.documentId)).get();
  recordAudit(tx, deps, senderContext(entry), {
    action: 'dms.mail.failed',
    entityType: 'document',
    entityId: entry.documentId,
    after: { outboxId: entry.id, status: 'failed', attempts },
    params: { documentNumber: doc?.number ?? '', code },
  });
}

/** Der nächste fällige Eintrag, auf `sending` gesetzt — bedingt, damit ihn kein zweiter Durchlauf auch nimmt. */
function claimNext(deps: Deps, now: string): DmsMailOutboxRow | null {
  for (;;) {
    const next = deps.db
      .select()
      .from(dmsMailOutbox)
      .where(and(eq(dmsMailOutbox.status, 'queued'), or(isNull(dmsMailOutbox.nextAttemptAt), lte(dmsMailOutbox.nextAttemptAt, now))))
      .orderBy(asc(dmsMailOutbox.queuedAt), asc(dmsMailOutbox.id))
      .get();
    if (!next) return null;
    const claimed = deps.db
      .update(dmsMailOutbox)
      .set({ status: 'sending', sendingSince: now })
      .where(and(eq(dmsMailOutbox.id, next.id), eq(dmsMailOutbox.status, 'queued')))
      .run().changes;
    if (claimed === 1) return { ...next, status: 'sending', sendingSince: now };
  }
}

function waitingCount(deps: Deps): number {
  return deps.db.select({ n: count() }).from(dmsMailOutbox).where(inArray(dmsMailOutbox.status, ['queued', 'blocked'])).get()?.n ?? 0;
}

async function sendOne(deps: Deps, entry: DmsMailOutboxRow, now: string): Promise<'sent' | 'failed' | 'retry'> {
  const sender = mailSender(deps)!;
  const doc = deps.db.select().from(documents).where(eq(documents.id, entry.documentId)).get();
  const person = deps.db.select().from(contacts).where(eq(contacts.id, entry.contactId)).get();
  let result: Awaited<ReturnType<Deps['mail']['send']>>;
  if (!doc?.fileName || !doc.number) {
    result = { ok: false, code: 'other' };
  } else {
    try {
      const content = await readDocumentFile(deps, doc.fileName);
      const text = mailBodyFor(deps, { typeKey: doc.typeKey, subject: entry.subject, number: doc.number, documentDate: doc.documentDate }, { name: person ? displayName(person) : '', salutation: person?.salutation ?? null });
      result = await deps.mail.send({ to: entry.toAddress, ...sender, subject: entry.subject, text, attachment: { filename: `${doc.number}.pdf`, content } });
    } catch {
      // Datei fehlt oder ist nicht lesbar: ein Versuch, wie ein Fehler des Servers.
      result = { ok: false, code: 'other' };
    }
  }

  const attempts = entry.attempts + 1;
  if (result.ok) {
    const messageId = result.messageId;
    deps.db.transaction((tx: DbOrTx) => {
      tx.update(dmsMailOutbox)
        .set({ status: 'sent', attempts, sentAt: now, messageId, sendingSince: null, nextAttemptAt: null, lastErrorCode: null, lastErrorText: null })
        .where(eq(dmsMailOutbox.id, entry.id))
        .run();
      const row = tx.select().from(documents).where(eq(documents.id, entry.documentId)).get()!;
      const ctx = senderContext(entry);
      // Der Versandvermerk entsteht mit der Annahme durch den Server, nicht beim Einreihen (Spec § 4.2).
      applyDispatchInternal(tx, deps, ctx, row, { sentAt: todayIn(deps), sentVia: 'email', note: null });
      recordAudit(tx, deps, ctx, {
        action: 'dms.mail.sent',
        entityType: 'document',
        entityId: row.id,
        after: { outboxId: entry.id, status: 'sent' },
        params: { documentNumber: row.number ?? '' },
      });
    });
    return 'sent';
  }

  const text = result.text ? sanitizeServerText(result.text) : null;
  if (attempts >= MAIL_MAX_ATTEMPTS) {
    deps.db.transaction((tx: DbOrTx) => markFailed(tx, deps, entry, attempts, result.code, text));
    return 'failed';
  }
  deps.db
    .update(dmsMailOutbox)
    .set({ status: 'queued', attempts, sendingSince: null, nextAttemptAt: minutesFrom(now, BACKOFF_MINUTES[attempts - 1]!), lastErrorCode: result.code, lastErrorText: text })
    .where(eq(dmsMailOutbox.id, entry.id))
    .run();
  return 'retry';
}

/**
 * Ein Durchlauf des Senders: hängende Sendungen zurück, dann nacheinander
 * senden, höchstens `dms.mail.ratePerMinute` je 60 Sekunden (gezählt über die
 * Sendungen der letzten Minute). Darf er nicht senden (nicht eingerichtet,
 * Testumgebung ohne Umleitung, kein Absender), stehen die wartenden Einträge
 * danach als `blocked` im Ausgang — und laufen weiter, sobald er darf.
 */
export async function processOutbox(deps: Deps, opts: { max?: number } = {}): Promise<{ sent: number; failed: number; waiting: number }> {
  const now = isoNow(deps.clock);
  recoverStale(deps, now);

  const state = deps.mail.state();
  if (state.kind === 'off' || state.kind === 'blocked' || !mailSender(deps)) {
    deps.db.update(dmsMailOutbox).set({ status: 'blocked' }).where(eq(dmsMailOutbox.status, 'queued')).run();
    return { sent: 0, failed: 0, waiting: waitingCount(deps) };
  }
  deps.db.update(dmsMailOutbox).set({ status: 'queued' }).where(eq(dmsMailOutbox.status, 'blocked')).run();

  const rate = readSetting<number>(deps, 'dms.mail.ratePerMinute');
  const lastMinute = deps.db
    .select({ n: count() })
    .from(dmsMailOutbox)
    .where(and(isNotNull(dmsMailOutbox.sentAt), gt(dmsMailOutbox.sentAt, msBefore(now, MINUTE))))
    .get()?.n ?? 0;
  let budget = Math.min(rate - lastMinute, opts.max ?? Number.POSITIVE_INFINITY);

  let sent = 0;
  let failed = 0;
  while (budget > 0) {
    const entry = claimNext(deps, now);
    if (!entry) break;
    budget--;
    const outcome = await sendOne(deps, entry, now);
    if (outcome === 'sent') sent++;
    if (outcome === 'failed') failed++;
  }
  return { sent, failed, waiting: waitingCount(deps) };
}

/**
 * Teil des Aufräumtakts: Adressen erledigter Sendungen nach 90 Tagen leeren.
 * Der Eintrag bleibt (Zustand, Zeit, Dokument), der Versandvermerk am Dokument
 * ohnehin.
 */
export async function purgeOutboxAddresses(deps: Deps): Promise<number> {
  const cutoff = new Date(deps.clock.now().getTime() - ADDRESS_RETENTION_DAYS * 24 * 60 * MINUTE).toISOString();
  const now = isoNow(deps.clock);
  const done = or(
    and(eq(dmsMailOutbox.status, 'sent'), lt(dmsMailOutbox.sentAt, cutoff)),
    and(inArray(dmsMailOutbox.status, ['failed', 'withdrawn']), lt(dmsMailOutbox.queuedAt, cutoff)),
  );
  return deps.db.update(dmsMailOutbox).set({ toAddress: '', addressPurgedAt: now }).where(and(done, isNull(dmsMailOutbox.addressPurgedAt))).run().changes;
}

export interface MailSender {
  wake(): void;
  stop(): Promise<void>;
}

/**
 * Der Takt des Senders, gebaut wie der Textworker: ein Durchlauf zur Zeit,
 * `unref`, `stop()` wartet auf den laufenden Durchlauf. `wake()` stößt ihn
 * sofort an, etwa nach dem Einreihen.
 */
export function startMailSender(getDeps: () => Deps, opts: { intervalMs?: number } = {}): MailSender {
  let busy = false;
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  const pass = async (): Promise<void> => {
    busy = true;
    try {
      // Was nach Ablauf der Minute noch wartet, nimmt der nächste Takt.
      await processOutbox(getDeps());
    } catch (error) {
      console.warn('[kompass] Mailversand übersprungen —', error instanceof Error ? error.message : error);
    } finally {
      busy = false;
    }
  };
  const run = (): void => {
    if (busy || stopped) return;
    current = pass();
  };
  const timer = setInterval(run, opts.intervalMs ?? 30_000);
  timer.unref?.();
  run();
  return {
    wake: run,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      return current;
    },
  };
}
