import { coreModule, writeSettingInternal, type MailState } from '@kompass/core';
import { createTestDeps, fakeMailTransport, systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';
import { dmsMailOutbox } from '../src/schema';

function setup(opts: { state?: MailState; from?: string | null } = {}) {
  const mail = fakeMailTransport(opts.state ? { state: opts.state } : {});
  const deps = createTestDeps({ manifests: [coreModule, dmsModule], mail });
  deps.db.transaction((tx) => {
    writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['dms']);
    writeSettingInternal(tx, deps, systemContext(), 'organization.name', 'Beispielverein');
    if (opts.from !== null) writeSettingInternal(tx, deps, systemContext(), 'dms.mail.fromAddress', opts.from ?? 'verein@example.org');
  });
  return { deps, mail };
}

describe('Systemmail der Akte', () => {
  it('sendet über den Transport mit Absender der Akte, ohne Postausgang und ohne Protokoll', async () => {
    const { deps, mail } = setup();
    const audits = () => deps.sqlite.prepare('SELECT count(*) AS n FROM audit_log').get();
    const before = audits();
    expect(dmsModule.systemMail!.available(deps)).toBe(true);
    expect(await dmsModule.systemMail!.send(deps, { to: 'v@example.org', subject: 'S', text: 'T' })).toEqual({ sent: true });
    expect(mail.sent[0]).toMatchObject({ to: 'v@example.org', from: { address: 'verein@example.org', name: 'Beispielverein' }, subject: 'S', text: 'T' });
    expect(deps.db.select().from(dmsMailOutbox).all()).toEqual([]);
    expect(audits()).toEqual(before);
  });

  it('ohne Absender oder bei Transport off/blocked: nicht verfügbar; Sendefehler → sendFailed', async () => {
    expect(dmsModule.systemMail!.available(setup({ from: null }).deps)).toBe(false);
    expect(dmsModule.systemMail!.available(setup({ state: { kind: 'off' } }).deps)).toBe(false);
    expect(dmsModule.systemMail!.available(setup({ state: { kind: 'blocked', reason: 'noRedirect' } }).deps)).toBe(false);
    expect(dmsModule.systemMail!.available(setup({ state: { kind: 'redirect', host: 'h', to: 'r@example.org' } }).deps)).toBe(true);
    const { deps, mail } = setup();
    mail.failNext('connection');
    expect(await dmsModule.systemMail!.send(deps, { to: 'v@example.org', subject: 'S', text: 'T' })).toEqual({ sent: false, reason: 'sendFailed' });
  });
});
