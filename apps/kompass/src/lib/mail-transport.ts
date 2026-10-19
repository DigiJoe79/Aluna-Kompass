import type { AppEnv, MailErrorCode, MailMessage, MailSendResult, MailState, MailTransport } from '@kompass/core';
import nodemailer from 'nodemailer';
import { z } from 'zod';

/**
 * Der Zugang zum Mailserver ist ein Betriebsparameter (Prinzip 2) und kommt aus
 * der Umgebung, nicht aus der Datenbank (Spec PDF per E-Mail § 3).
 */
export interface MailEnv {
  appEnv: AppEnv;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  /** `implicit` (465) oder `starttls` (587). Ohne TLS gibt es keinen Weg. */
  tls?: 'implicit' | 'starttls';
  /** Außerhalb von Prod Pflicht: Jede Mail geht hierhin, nie an den Kontakt. */
  redirect?: string;
  /** Nur `APP_ENV=test` (`KOMPASS_MAIL_FAKE=1`): der Test-Transport der E2E-Server, ohne jede Verbindung. */
  fake?: boolean;
}

const optionalText = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const mailEnvSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  KOMPASS_SMTP_HOST: optionalText,
  KOMPASS_SMTP_PORT: optionalText.transform((v) => (v === undefined ? undefined : Number(v))).pipe(z.number().int().min(1).max(65535).optional()),
  KOMPASS_SMTP_USER: optionalText,
  KOMPASS_SMTP_PASSWORD: z.string().optional().transform((v) => (v ? v : undefined)),
  KOMPASS_SMTP_TLS: optionalText.pipe(z.enum(['implicit', 'starttls']).optional()),
  KOMPASS_MAIL_REDIRECT: optionalText.pipe(z.email().optional()),
  KOMPASS_MAIL_FAKE: optionalText,
});

export function readMailEnv(source: Record<string, string | undefined> = process.env): MailEnv {
  const parsed = mailEnvSchema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    // Ein Betriebsfehler beim Start, kein Oberflächentext; nennt nur die Namen der Variablen.
    throw new Error('invalid environment: ' + names);
  }
  const v = parsed.data;
  const env: MailEnv = { appEnv: v.APP_ENV };
  if (v.KOMPASS_SMTP_HOST) env.host = v.KOMPASS_SMTP_HOST;
  if (v.KOMPASS_SMTP_PORT) env.port = v.KOMPASS_SMTP_PORT;
  if (v.KOMPASS_SMTP_USER) env.user = v.KOMPASS_SMTP_USER;
  if (v.KOMPASS_SMTP_PASSWORD) env.password = v.KOMPASS_SMTP_PASSWORD;
  if (v.KOMPASS_SMTP_TLS) env.tls = v.KOMPASS_SMTP_TLS;
  if (v.KOMPASS_MAIL_REDIRECT) env.redirect = v.KOMPASS_MAIL_REDIRECT;
  // Der Test-Transport wirkt nur in der Testumgebung; in Entwicklung und Produktion bleibt die Variable wirkungslos.
  if (v.KOMPASS_MAIL_FAKE === '1' && v.APP_ENV === 'test') env.fake = true;
  return env;
}

function stateOf(env: MailEnv): MailState {
  if (!env.host) return { kind: 'off' };
  if (env.appEnv === 'production') return { kind: 'ready', host: env.host };
  if (!env.redirect) return { kind: 'blocked', reason: 'noRedirect' };
  return { kind: 'redirect', host: env.host, to: env.redirect };
}

interface SmtpError {
  code?: string;
  responseCode?: number;
  response?: string;
  message?: string;
}

function categoryOf(error: SmtpError): MailErrorCode {
  if (error.code === 'EAUTH') return 'auth';
  if (error.code === 'ETLS') return 'tls';
  if (typeof error.responseCode === 'number' && error.responseCode >= 500) return 'rejected';
  if (error.code === 'ESOCKET' || error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT' || error.code === 'EDNS') return 'connection';
  return 'other';
}

/**
 * Der Transport der App. Die Sicherheitsregel steht hier und nirgends sonst:
 * Außerhalb von `production` geht keine Mail an die Adresse des Kontakts —
 * mit Umleitung an die Umleitung, ohne gar nicht (`blocked`, kein
 * Verbindungsaufbau).
 */
export function createMailTransport(env: MailEnv): MailTransport {
  if (env.fake && env.appEnv === 'test') return createFakeTransport();
  const state = stateOf(env);
  let smtp: ReturnType<typeof nodemailer.createTransport> | null = null;
  const connect = () => {
    if (smtp) return smtp;
    const tls = env.tls ?? 'implicit';
    smtp = nodemailer.createTransport({
      host: env.host,
      port: env.port ?? (tls === 'implicit' ? 465 : 587),
      // Nie ohne TLS: implizit von Anfang an, oder STARTTLS als Pflicht — ohne gesicherte Verbindung bricht der Versand ab.
      secure: tls === 'implicit',
      requireTLS: tls === 'starttls',
      ...(env.user ? { auth: { user: env.user, pass: env.password ?? '' } } : {}),
    });
    return smtp;
  };

  return {
    state: () => state,
    async send(message: MailMessage): Promise<MailSendResult> {
      if (state.kind === 'off' || state.kind === 'blocked') return { ok: false, code: 'other' };
      const redirected = state.kind === 'redirect';
      try {
        const info = await connect().sendMail({
          from: message.from,
          to: redirected ? state.to : message.to,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
          subject: redirected ? `[Test → ${message.to}] ${message.subject}` : message.subject,
          text: message.text,
          ...(message.attachment ? { attachments: [{ filename: message.attachment.filename, content: Buffer.from(message.attachment.content), contentType: 'application/pdf' }] } : {}),
        });
        return { ok: true, messageId: String(info.messageId ?? '') };
      } catch (error) {
        const e = (error ?? {}) as SmtpError;
        const text = e.response ?? e.message;
        return text ? { ok: false, code: categoryOf(e), text } : { ok: false, code: categoryOf(e) };
      }
    },
  };
}

/** Zustände des Test-Transports; „ready“ gibt es nicht — er spielt nie Produktion. */
export type FakeMailKind = 'off' | 'redirect' | 'blocked';

/**
 * Der Zustand liegt am Prozess (`globalThis`), nicht in einer Modulvariablen: Next bündelt Route Handler und Seiten
 * getrennt, eine Modulvariable sähe jede Route für sich (Erfahrung mit den Route-Bundles).
 */
const FAKE_KEY = Symbol.for('kompass.mailFake');
type FakeHolder = { kind: FakeMailKind };
const holder = (): FakeHolder => {
  const g = globalThis as unknown as Record<symbol, FakeHolder | undefined>;
  return (g[FAKE_KEY] ??= { kind: 'off' });
};

/** Schaltet den Test-Transport um (nur über `/__e2e/mail`). */
export function setFakeMailState(kind: FakeMailKind): void {
  holder().kind = kind;
}

/**
 * Test-Transport der E2E-Server (`KOMPASS_MAIL_FAKE=1`, nur `APP_ENV=test`): baut nie eine Verbindung auf und nimmt
 * jede Mail an. Er beginnt „nicht
 * eingerichtet“, wie ein E2E-Server ohne Mailserver; ein Test schaltet ihn auf Umleitung oder gesperrt. Mit jedem
 * Zurücksetzen der Datenbank entsteht er neu und beginnt wieder so.
 */
function createFakeTransport(): MailTransport {
  setFakeMailState('off');
  let sent = 0;
  const state = (): MailState => {
    const kind = holder().kind;
    if (kind === 'redirect') return { kind: 'redirect', host: 'fake.invalid', to: 'umleitung@example.org' };
    if (kind === 'blocked') return { kind: 'blocked', reason: 'noRedirect' };
    return { kind: 'off' };
  };
  return {
    state,
    async send(_message: MailMessage): Promise<MailSendResult> {
      if (state().kind !== 'redirect') return { ok: false, code: 'other' };
      sent += 1;
      return { ok: true, messageId: `<fake-${sent}@fake.invalid>` };
    },
  };
}
