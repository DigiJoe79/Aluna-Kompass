import { noopMailTransport, type MailMessage } from '@kompass/core';
import { createTestDeps, fakeMailTransport } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';

const message: MailMessage = {
  to: 'anna@example.org',
  from: { address: 'verein@example.org', name: 'Beispielverein' },
  subject: 'Beitragsmitteilung',
  text: 'Guten Tag',
  attachment: { filename: 'BRF-2026-001.pdf', content: new Uint8Array([1, 2, 3]) },
};

describe('mail transport port', () => {
  it('createTestDeps sends nothing unless a test asks for it', async () => {
    const deps = createTestDeps();
    expect(deps.mail.state()).toEqual({ kind: 'off' });
    expect(await deps.mail.send(message)).toEqual({ ok: false, code: 'other' });
  });

  it('the noop transport is off and never throws', async () => {
    expect(noopMailTransport.state()).toEqual({ kind: 'off' });
    await expect(noopMailTransport.send(message)).resolves.toEqual({ ok: false, code: 'other' });
  });

  it('the fake records what was sent and fails on request', async () => {
    const mail = fakeMailTransport();
    const deps = createTestDeps({ mail });
    expect(deps.mail.state().kind).toBe('ready');
    const first = await deps.mail.send(message);
    expect(first.ok).toBe(true);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.to).toBe('anna@example.org');

    mail.failNext('connection', '421 try later');
    expect(await deps.mail.send(message)).toEqual({ ok: false, code: 'connection', text: '421 try later' });
    expect(mail.sent).toHaveLength(1);
    expect((await deps.mail.send(message)).ok).toBe(true);
  });

  it('the fake can stand for an installation that is off or blocked', async () => {
    const blocked = fakeMailTransport({ state: { kind: 'blocked', reason: 'noRedirect' } });
    expect(blocked.state().kind).toBe('blocked');
    expect(await blocked.send(message)).toEqual({ ok: false, code: 'other' });
    expect(blocked.sent).toHaveLength(0);
  });
});
