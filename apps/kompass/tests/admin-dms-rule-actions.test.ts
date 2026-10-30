import { coreModule, unwrap, type CallContext, type Deps } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser } from '@kompass/core/testing';
import { createDocumentRule, dmsModule, listDocumentRules } from '@kompass/module-dms';
import { createTranslator } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

const session: { value: { deps: Deps; ctx: CallContext } | null } = { value: null };
vi.mock('@/lib/request-context', () => ({ requireSession: async () => session.value }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) }));

const { updateDocumentRuleAction } = await import('@/app/(shell)/admin/dms/actions');

/** App-B8: Die Maske kennt keine Reihenfolge — Bearbeiten darf eine per Agent gesetzte nicht auf 0 setzen. */
describe('Einsortierregel bearbeiten', () => {
  let deps: Deps;
  let ctx: CallContext;
  beforeEach(() => {
    deps = createTestDeps({ manifests: [coreModule, dmsModule] });
    ctx = ctxWith(['dms.manage', 'dms.view'], insertUser(deps, {}));
    session.value = { deps, ctx };
  });

  const sortOf = async (id: string) => unwrap(await listDocumentRules(deps, ctx, {})).find((r) => r.id === id)?.sortOrder;

  it('behält die Reihenfolge, wenn das Formular kein Feld dafür hat', async () => {
    const rule = unwrap(await createDocumentRule(deps, ctx, { matchField: 'filename', matchContains: 'Finanzamt', thenFolder: 'Steuern', sortOrder: 5 }));
    const form = new FormData();
    form.set('matchField', 'filename');
    form.set('matchContains', 'Finanzamt Musterstadt');
    form.set('thenFolder', 'Steuern');
    form.set('isActive', 'on');
    const result = await updateDocumentRuleAction(rule.id, { status: 'idle' }, form);
    expect(result.status).toBe('success');
    expect(await sortOf(rule.id)).toBe(5);
  });

  it('setzt sie, wenn das Feld mitkommt', async () => {
    const rule = unwrap(await createDocumentRule(deps, ctx, { matchField: 'filename', matchContains: 'Finanzamt', thenFolder: 'Steuern', sortOrder: 5 }));
    const form = new FormData();
    form.set('matchField', 'filename');
    form.set('matchContains', 'Finanzamt');
    form.set('thenFolder', 'Steuern');
    form.set('isActive', 'on');
    form.set('sortOrder', '2');
    expect((await updateDocumentRuleAction(rule.id, { status: 'idle' }, form)).status).toBe('success');
    expect(await sortOf(rule.id)).toBe(2);
  });
});
