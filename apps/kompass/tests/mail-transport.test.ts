import type { MailMessage } from '@kompass/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Kein Test baut eine echte SMTP-Verbindung auf: nodemailer ist hier ganz
 * ersetzt, `createTransport` schreibt nur mit.
 */
const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport }, createTransport }));

const { createMailTransport, readMailEnv, setFakeMailState } = await import('@/lib/mail-transport');

const message: MailMessage = {
  to: 'anna@example.org',
  from: { address: 'verein@example.org', name: 'Beispielverein' },
  replyTo: 'vorstand@example.org',
  subject: 'Beitragsmitteilung',
  text: 'Guten Tag',
  attachment: { filename: 'BRF-2026-001.pdf', content: new Uint8Array([1, 2, 3]) },
};

beforeEach(() => {
  sendMail.mockReset();
  sendMail.mockResolvedValue({ messageId: '<id@example.org>' });
  createTransport.mockClear();
});

describe('mail transport', () => {
  it('never contacts a real recipient outside production', async () => {
    for (const appEnv of ['test', 'development'] as const) {
      const transport = createMailTransport({ appEnv, host: 'smtp.example.org', user: 'u', password: 'p' });
      expect(transport.state()).toEqual({ kind: 'blocked', reason: 'noRedirect' });
      expect(await transport.send(message)).toEqual({ ok: false, code: 'other' });
    }
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();

    const redirected = createMailTransport({ appEnv: 'test', host: 'smtp.example.org', redirect: 'test-postfach@example.org' });
    expect(redirected.state()).toEqual({ kind: 'redirect', host: 'smtp.example.org', to: 'test-postfach@example.org' });
    const result = await redirected.send(message);
    expect(result).toEqual({ ok: true, messageId: '<id@example.org>' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const sent = sendMail.mock.calls[0]![0] as { to: string; subject: string };
    expect(sent.to).toBe('test-postfach@example.org');
    expect(sent.subject).toBe('[Test → anna@example.org] Beitragsmitteilung');
    expect(JSON.stringify(sendMail.mock.calls)).not.toContain('"to":"anna@example.org"');
  });

  it('sends to the contact in production', async () => {
    const transport = createMailTransport({ appEnv: 'production', host: 'smtp.example.org', user: 'u', password: 'p', redirect: 'test-postfach@example.org' });
    expect(transport.state()).toEqual({ kind: 'ready', host: 'smtp.example.org' });
    await transport.send(message);
    const sent = sendMail.mock.calls[0]![0] as { to: string; subject: string; from: unknown; replyTo: string; attachments: { filename: string; contentType: string }[] };
    expect(sent.to).toBe('anna@example.org');
    expect(sent.subject).toBe('Beitragsmitteilung');
    expect(sent.from).toEqual({ address: 'verein@example.org', name: 'Beispielverein' });
    expect(sent.replyTo).toBe('vorstand@example.org');
    expect(sent.attachments[0]).toMatchObject({ filename: 'BRF-2026-001.pdf', contentType: 'application/pdf' });
  });

  it('sends a mail without attachment when none is given (test mail)', async () => {
    const transport = createMailTransport({ appEnv: 'production', host: 'smtp.example.org', user: 'u', password: 'p' });
    const { attachment: _unused, ...withoutAttachment } = message;
    await transport.send(withoutAttachment);
    const sent = sendMail.mock.calls.at(-1)![0] as { attachments?: unknown };
    expect(sent.attachments).toBeUndefined();
  });

  it('is off without a host', async () => {
    const transport = createMailTransport({ appEnv: 'production' });
    expect(transport.state()).toEqual({ kind: 'off' });
    expect(await transport.send(message)).toEqual({ ok: false, code: 'other' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('never sends without TLS', async () => {
    await createMailTransport({ appEnv: 'production', host: 'smtp.example.org' }).send(message);
    expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'smtp.example.org', port: 465, secure: true }));

    await createMailTransport({ appEnv: 'production', host: 'smtp.example.org', tls: 'starttls' }).send(message);
    expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ port: 587, secure: false, requireTLS: true }));
  });

  it('maps the errors of the server to categories', async () => {
    const transport = createMailTransport({ appEnv: 'production', host: 'smtp.example.org' });
    const cases: [object, string][] = [
      [{ code: 'EAUTH', response: '535 auth failed' }, 'auth'],
      [{ code: 'ESOCKET' }, 'connection'],
      [{ code: 'ECONNECTION' }, 'connection'],
      [{ code: 'ETLS' }, 'tls'],
      [{ code: 'EENVELOPE', responseCode: 550, response: '550 5.1.1 user unknown' }, 'rejected'],
      [{ code: 'EMESSAGE' }, 'other'],
    ];
    for (const [error, code] of cases) {
      sendMail.mockRejectedValueOnce(Object.assign(new Error('x'), error));
      const result = await transport.send(message);
      expect(result).toMatchObject({ ok: false, code });
    }
    sendMail.mockRejectedValueOnce(Object.assign(new Error('x'), { responseCode: 550, response: '550 5.1.1 user unknown' }));
    expect(await transport.send(message)).toEqual({ ok: false, code: 'rejected', text: '550 5.1.1 user unknown' });
  });

  it('reads its settings from the environment', () => {
    expect(readMailEnv({ APP_ENV: 'test' })).toEqual({ appEnv: 'test' });
    expect(
      readMailEnv({
        APP_ENV: 'production',
        KOMPASS_SMTP_HOST: 'smtp.example.org',
        KOMPASS_SMTP_PORT: '2465',
        KOMPASS_SMTP_USER: 'u',
        KOMPASS_SMTP_PASSWORD: 'p',
        KOMPASS_SMTP_TLS: 'starttls',
        KOMPASS_MAIL_REDIRECT: 'test-postfach@example.org',
      }),
    ).toEqual({ appEnv: 'production', host: 'smtp.example.org', port: 2465, user: 'u', password: 'p', tls: 'starttls', redirect: 'test-postfach@example.org' });
    expect(() => readMailEnv({ APP_ENV: 'production', KOMPASS_SMTP_HOST: 'smtp.example.org', KOMPASS_SMTP_TLS: 'none' })).toThrow(/KOMPASS_SMTP_TLS/);
  });
});

describe('test transport for E2E (KOMPASS_MAIL_FAKE)', () => {
  it('only exists in APP_ENV=test', () => {
    expect(readMailEnv({ APP_ENV: 'test', KOMPASS_MAIL_FAKE: '1' }).fake).toBe(true);
    expect(readMailEnv({ APP_ENV: 'development', KOMPASS_MAIL_FAKE: '1' }).fake).toBeUndefined();
    expect(readMailEnv({ APP_ENV: 'production', KOMPASS_MAIL_FAKE: '1' }).fake).toBeUndefined();
  });

  it('starts as not set up, never opens a connection, and follows the switch', async () => {
    const transport = createMailTransport({ appEnv: 'test', fake: true });
    expect(transport.state()).toEqual({ kind: 'off' });
    expect(await transport.send(message)).toEqual({ ok: false, code: 'other' });

    setFakeMailState('redirect');
    expect(transport.state()).toEqual({ kind: 'redirect', host: 'fake.invalid', to: 'umleitung@example.org' });
    expect(await transport.send(message)).toMatchObject({ ok: true });

    setFakeMailState('blocked');
    expect(transport.state()).toEqual({ kind: 'blocked', reason: 'noRedirect' });
    expect(await transport.send(message)).toEqual({ ok: false, code: 'other' });
    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();

    // Ein neuer Transport (Zurücksetzen der Datenbank) beginnt wieder „nicht eingerichtet“.
    expect(createMailTransport({ appEnv: 'test', fake: true }).state()).toEqual({ kind: 'off' });
  });
});
