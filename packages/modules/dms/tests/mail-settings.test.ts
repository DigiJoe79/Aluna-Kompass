import { coreModule, readSetting } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { saveMailSettings } from '../src/mail/settings';
import { dmsModule } from '../src/manifest';

function setup(permissions = ['settings.manage']) {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule] });
  return { deps, ctx: ctxWith(permissions, insertUser(deps, {})) };
}
const input = { fromAddress: 'post@example.org', fromName: 'Beispielverein', replyTo: null, ratePerMinute: 10 };

describe('saveMailSettings (Handoff 2b E5)', () => {
  it('speichert Absender und Grenze in einem Zug, protokolliert je Schlüssel', async () => {
    const { deps, ctx } = setup();
    expect((await saveMailSettings(deps, ctx, input)).ok).toBe(true);
    expect(readSetting(deps, 'dms.mail.fromAddress')).toBe('post@example.org');
    expect(readSetting(deps, 'dms.mail.ratePerMinute')).toBe(10);
    expect(JSON.parse(auditEntry(deps, 'settings.update').params!)).toHaveProperty('key');
  });

  it('verlangt settings.manage und gültige Werte, schreibt dann nichts', async () => {
    const { deps, ctx } = setup([]);
    const denied = await saveMailSettings(deps, ctx, input);
    expect(!denied.ok && denied.error.type).toBe('forbidden');
    const ok = setup();
    const invalid = await saveMailSettings(ok.deps, ok.ctx, { ...input, fromAddress: 'kein-mail', fromName: '' });
    expect(!invalid.ok && invalid.error.type).toBe('validation');
    expect(readSetting(ok.deps, 'dms.mail.fromAddress')).toBeNull();
  });
});
