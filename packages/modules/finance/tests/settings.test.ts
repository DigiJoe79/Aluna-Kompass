import { setSetting, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { setFinanceSwitch } from '../src/ledger/setup';
import { financeModule } from '../src/manifest';
import { setupFinance } from './helpers';

describe('finance settings', () => {
  it('the switch that lets an agent finalize can only be flipped by a person at the screen', async () => {
    const { deps } = setupFinance();
    const viaMcp = { ...ctxWith(['settings.manage']), channel: 'mcp' as const };
    const res = await setSetting(deps, viaMcp, { key: 'finance.mcpHumanOnlyAllowed', value: true });
    expect(res.ok).toBe(false);
    // Geführt von Finanzen (K1): Auch am Bildschirm nicht über die allgemeinen Einstellungen, sondern über den Schalter
    // der Finanzeinrichtung (`finance.setup`).
    const viaSettings = await setSetting(deps, { ...ctxWith(['settings.manage']), channel: 'ui' as const }, { key: 'finance.mcpHumanOnlyAllowed', value: true });
    expect(viaSettings.ok ? null : viaSettings.error).toEqual({ type: 'conflict', code: 'settingManaged', message: 'finance' });
    expect(unwrap(await setFinanceSwitch(deps, { ...ctxWith(['finance.setup']), channel: 'ui' as const }, { key: 'finance.mcpHumanOnlyAllowed', value: true }))).toEqual({ key: 'finance.mcpHumanOnlyAllowed', value: true });
  });

  it('offers expense waivers only after the association switches them on (Spec E13)', () => {
    const def = (financeModule.settings ?? []).find((s) => s.key === 'finance.expenseWaiversEnabled');
    expect(def?.default).toBe(false);
  });

  // Dass jede Vorgabe ihr Schema besteht, prüft `apps/kompass/tests/module-contracts.test.ts` für alle Module.
  it('gives every setting a default; the agent switch is for the screen only', () => {
    expect((financeModule.settings ?? []).filter((s) => s.default === undefined).map((s) => s.key)).toEqual([]);
    expect(financeModule.settings!.find((s) => s.key === 'finance.mcpHumanOnlyAllowed')).toMatchObject({ default: false, uiOnly: true });
  });

  it('keeps the basis of expense waivers as text up to 500 characters, empty until the association writes it down (F8a)', () => {
    const setting = financeModule.settings!.find((s) => s.key === 'finance.expenseWaiverBasisText')!;
    // Leer, nicht „Vereinbarung vom … / Satzung § …“: Der Wortlaut ist der Hinweis im Feld; ein Platzhalter als Wert
    // stünde sonst als Anspruchsgrundlage auf jedem Antrag, und die Einrichtung hielte den Schritt für erledigt.
    expect(setting.default).toBe('');
    expect(setting.schema.safeParse('Satzung § 9 Abs. 2').success).toBe(true);
    expect(setting.schema.safeParse('x'.repeat(500)).success).toBe(true);
    expect(setting.schema.safeParse('x'.repeat(501)).success).toBe(false);
    expect(setting.schema.safeParse(null).success).toBe(false);
  });
});
