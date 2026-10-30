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

const { saveAgentSwitchesAction } = await import('@/app/(shell)/admin/agents/actions');

/**
 * Seite Verwaltung → Agenten (Spec 2026-10-29): Die Server Action speichert die geänderten Schalter über den
 * Kerndienst — auch den, den die Finanzen führen (`managedBy`) — und schreibt je Schalter das Protokoll.
 */
describe('Agentenschalter: speichern auf der Seite Agenten', () => {
  let deps: Deps;
  beforeEach(() => {
    deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, financeModule, membersModule] });
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'dms', 'finance', 'members']));
    session.value = { deps, ctx: ctxWith([...deps.registry.permissionKeys]) };
  });

  it('schreibt Schalter mehrerer Module, auch den geführten der Finanzen, mit Protokoll', async () => {
    const result = await saveAgentSwitchesAction({ 'finance.mcpHumanOnlyAllowed': true, 'members.mcpHumanOnlyAllowed': true });
    expect(result.status).toBe('success');
    expect(readSetting(deps, 'finance.mcpHumanOnlyAllowed')).toBe(true);
    expect(readSetting(deps, 'members.mcpHumanOnlyAllowed')).toBe(true);
    expect(auditEntry(deps, 'settings.update').entityId).toBe('members.mcpHumanOnlyAllowed');
  });

  it('ohne `settings.manage` lehnt die Aktion ab und schreibt nichts', async () => {
    session.value = { deps, ctx: ctxWith(['finance.setup', 'members.read']) };
    const result = await saveAgentSwitchesAction({ 'finance.mcpHumanOnlyAllowed': true });
    expect(result.status).toBe('error');
    expect(readSetting(deps, 'finance.mcpHumanOnlyAllowed')).toBe(false);
  });

  it('ein Schalter eines ausgeschalteten Moduls wird abgelehnt', async () => {
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['contacts', 'finance']));
    const result = await saveAgentSwitchesAction({ 'dms.mcpHumanOnlyAllowed': true });
    expect(result.status).toBe('error');
    expect(readSetting(deps, 'dms.mcpHumanOnlyAllowed')).toBe(false);
  });
});
