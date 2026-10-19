import { coreModule, readSetting, writeSettingInternal, type CallContext, type Deps } from '@kompass/core';
import { auditEntry, createTestDeps, ctxWith, systemContext } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule } from '@kompass/module-dms';
import { financeModule } from '@kompass/module-finance';
import { membersModule } from '@kompass/module-members';
import { createTranslator } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const session: { value: { deps: Deps; ctx: CallContext } | null } = { value: null };
vi.mock('@/lib/request-context', () => ({ requireSession: async () => session.value }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) }));

const { saveMailSettingsAction } = await import('@/app/(shell)/admin/dms/actions');
const { setFinanceSwitchesAction } = await import('@/app/(shell)/admin/finance/actions');
const { saveMembersSettingsAction } = await import('@/app/(shell)/admin/members/actions');

/** Der Schlüssel im letzten Protokolleintrag der Aktion — die Einstellung, die sie zuletzt geschrieben hat. */
function lastAuditKey(deps: Deps, action: string): string | undefined {
  const params = auditEntry(deps, action).params as unknown;
  return (typeof params === 'string' ? (JSON.parse(params) as { key?: string }) : (params as { key?: string } | null))?.key;
}

/**
 * Plan U4 Task 1 (Nachtrag MCP-Test § 1): Die Server Action eines Panels speichert den Agentenschalter mit den übrigen
 * Feldern und schreibt das Protokoll. Der Schalter bleibt `uiOnly` — der Weg über die Oberfläche ist der einzige.
 */
describe('Agentenschalter: speichern mit dem Formular', () => {
  let deps: Deps;
  beforeEach(() => {
    deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, financeModule, membersModule] });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'finance', 'members']));
    session.value = { deps, ctx: ctxWith([...deps.registry.permissionKeys]) };
  });

  it('Mitglieder: die Fristen und der Schalter in einer Aktion, mit Protokoll', async () => {
    const result = await saveMembersSettingsAction({ resignationNotice: { months: 3, at: 'fiscalYearEnd' }, paymentTermDays: 21, joinYearRule: 'full' }, 'numbers', true);
    expect(result.status).toBe('success');
    expect(readSetting(deps, 'members.paymentTermDays')).toBe(21);
    expect(readSetting(deps, 'members.mcpHumanOnlyAllowed')).toBe(true);
    expect(lastAuditKey(deps, 'settings.update')).toBe('members.mcpHumanOnlyAllowed');
  });

  it('Mitglieder: lehnt der Dienst die Felder ab, bleibt der Schalter, wie er war', async () => {
    const result = await saveMembersSettingsAction({ resignationNotice: { months: 3, at: 'fiscalYearEnd' }, paymentTermDays: 0, joinYearRule: 'full' }, 'numbers', true);
    expect(result.status).toBe('error');
    expect(readSetting(deps, 'members.mcpHumanOnlyAllowed')).toBe(false);
  });

  it('Mitglieder: ohne `settings.manage` lehnt die Aktion den Schalter ab', async () => {
    session.value = { deps, ctx: ctxWith(['members.read', 'members.fees']) };
    const result = await saveMembersSettingsAction({ resignationNotice: { months: 3, at: 'fiscalYearEnd' }, paymentTermDays: 14, joinYearRule: 'full' }, 'numbers', true);
    expect(result.status).toBe('error');
    expect(readSetting(deps, 'members.mcpHumanOnlyAllowed')).toBe(false);
  });

  it('Akte: Absender und Schalter in einer Aktion, mit Protokoll', async () => {
    const result = await saveMailSettingsAction({ fromAddress: 'post@example.org', fromName: 'Beispielverein', replyTo: null, ratePerMinute: 20 }, true);
    expect(result.status).toBe('success');
    expect(readSetting(deps, 'dms.mail.fromAddress')).toBe('post@example.org');
    expect(readSetting(deps, 'dms.mcpHumanOnlyAllowed')).toBe(true);
    expect(lastAuditKey(deps, 'settings.update')).toBe('dms.mcpHumanOnlyAllowed');
  });

  it('Finanzen: der Schalter geht mit den Steuer-Schaltern, mit Protokoll', async () => {
    const result = await setFinanceSwitchesAction([{ key: 'finance.membershipFeesCertifiable', value: true }, { key: 'finance.mcpHumanOnlyAllowed', value: true }]);
    expect(result.status).toBe('success');
    expect(readSetting(deps, 'finance.mcpHumanOnlyAllowed')).toBe(true);
    expect(lastAuditKey(deps, 'finance.setup.switch')).toBe('finance.mcpHumanOnlyAllowed');
  });
});
