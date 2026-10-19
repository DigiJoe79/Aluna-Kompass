/**
 * Mailversand, wie der Kern ihn sieht (Spec PDF per E-Mail § 3). Die Umsetzung
 * mit `nodemailer` liegt in der App — der Kern kennt nur diese Schnittstelle
 * und reicht sie durch wie die Texterkennung. Er ruft sie selbst nie; heute
 * benutzt sie nur die Akte.
 *
 * Die Umleitung außerhalb von Prod sitzt **im Transport**, nicht in den
 * Diensten: So kommt kein Dienst an ihr vorbei.
 */
export interface MailMessage {
  to: string;
  from: { address: string; name: string };
  replyTo?: string;
  subject: string;
  /** Reiner Text; keine HTML-Mails (Spec § 1, Nicht-Ziele). */
  text: string;
  /** Ein PDF — bei Briefen immer; die Testmail kommt ohne (ein leeres PDF zeigten Mailprogramme als weiße Seite). */
  attachment?: { filename: string; content: Uint8Array };
}

/**
 * - `off`: kein Mailserver eingerichtet (`KOMPASS_SMTP_HOST` fehlt).
 * - `ready`: Prod, Mails gehen an die Kontakte.
 * - `redirect`: außerhalb von Prod, jede Mail geht an `to`.
 * - `blocked`: außerhalb von Prod ohne Umleitung — es wird nichts gesendet.
 */
export type MailState =
  | { kind: 'off' }
  | { kind: 'ready'; host: string }
  | { kind: 'redirect'; host: string; to: string }
  | { kind: 'blocked'; reason: 'noRedirect' };

export type MailErrorCode = 'auth' | 'connection' | 'rejected' | 'tls' | 'other';

/** `text` ist die Antwort des Servers, roh — wer sie speichert, entfernt Adressen darin. */
export type MailSendResult = { ok: true; messageId: string } | { ok: false; code: MailErrorCode; text?: string };

export interface MailTransport {
  state(): MailState;
  /** Wirft nie; bei `off` und `blocked` `{ ok: false, code: 'other' }`. Dienste prüfen `state()` vorher. */
  send(message: MailMessage): Promise<MailSendResult>;
}

/** Vorgabe für Skripte und Tests: nicht eingerichtet. */
export const noopMailTransport: MailTransport = {
  state: () => ({ kind: 'off' }),
  send: async () => ({ ok: false, code: 'other' }),
};

export interface FakeMailTransport extends MailTransport {
  /** Was angenommen wurde, in Reihenfolge. */
  sent: MailMessage[];
  /** Die nächste Sendung scheitert mit diesem Code (mehrfach aufgerufen: die nächsten n). */
  failNext(code: MailErrorCode, text?: string): void;
}

/** Attrappe für Dienst-Tests: schreibt mit, sendet nie. */
export function fakeMailTransport(opts: { state?: MailState } = {}): FakeMailTransport {
  const state: MailState = opts.state ?? { kind: 'ready', host: 'smtp.example.org' };
  const failures: { code: MailErrorCode; text?: string }[] = [];
  const sent: MailMessage[] = [];
  return {
    sent,
    failNext(code, text) {
      failures.push(text === undefined ? { code } : { code, text });
    },
    state: () => state,
    async send(message) {
      if (state.kind === 'off' || state.kind === 'blocked') return { ok: false, code: 'other' };
      const failure = failures.shift();
      if (failure) return { ok: false, ...failure };
      sent.push(message);
      return { ok: true, messageId: `<fake-${sent.length}@example.org>` };
    },
  };
}
