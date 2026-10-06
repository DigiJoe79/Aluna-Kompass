import { coreModule, defineModule, setModuleEnabled, type Failure } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { toCallToolResult } from '@kompass/mcp';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { toActionState } from '@/lib/actions';
import { mcpErrorTranslator } from '@/lib/mcp-errors';
import messages from '../messages/de.json';

/** Modul ein- und ausschalten: Die Ablehnung nennt die Namen der Module („Dokumentenmanagement“), nicht ihre Schlüssel, und einen Ausweg. */
const t = createTranslator({ locale: 'de', messages, timeZone: 'Europe/Berlin' }) as unknown as (key: string, values?: Record<string, unknown>) => string;
const dms = defineModule({ key: 'dms', version: '0', permissions: [] });
const finance = defineModule({ key: 'finance', version: '0', permissions: [], dependsOn: ['dms'] });
const admin = ctxWith(['modules.manage']);

async function refusal(action: 'disable' | 'enable'): Promise<Failure> {
  const deps = createTestDeps({ manifests: [coreModule, dms, finance] });
  if (action === 'disable') {
    await setModuleEnabled(deps, admin, { key: 'dms', enabled: true });
    await setModuleEnabled(deps, admin, { key: 'finance', enabled: true });
  }
  const res = await setModuleEnabled(deps, admin, action === 'disable' ? { key: 'dms', enabled: false } : { key: 'finance', enabled: true });
  if (res.ok) throw new Error('hätte ablehnen müssen');
  return res;
}
const ui = (f: Failure) => {
  const s = toActionState(f, t);
  return s.status === 'error' ? `${s.detail ?? ''} ${s.message}` : '';
};
const mcp = (f: Failure) => (JSON.parse((toCallToolResult(f, mcpErrorTranslator(createTestDeps())).content[0] as { text: string }).text) as { error: { message: string } }).error.message;

describe('Ablehnungen beim Ein- und Ausschalten von Modulen', () => {
  it('Ausschalten: nennt das abhängige Modul mit Namen und den Ausweg', async () => {
    const f = await refusal('disable');
    for (const text of [ui(f), mcp(f)]) {
      expect(text).toContain('Finanzen');
      expect(text).not.toMatch(/\bfinance\b/);
      expect(text).toMatch(/zuerst/);
    }
  });

  it('Einschalten: nennt das fehlende Modul mit Namen und den Ausweg', async () => {
    const f = await refusal('enable');
    for (const text of [ui(f), mcp(f)]) {
      expect(text).toContain('Dokumentenmanagement');
      expect(text).not.toMatch(/\bdms\b/);
      expect(text).toMatch(/zuerst/);
    }
  });
});

describe('Template-Sync mit nicht eingerichteter Sprache', () => {
  it('nennt die Sprachen und den Ausweg, in Oberfläche und MCP gleich', async () => {
    const { localizedConflict } = await import('@kompass/core');
    const f = localizedConflict('localeMissing', 'errors.site.localeMissing', { locales: 'fr, es' });
    for (const text of [ui(f), mcp(f)]) {
      expect(text).toContain('fr, es');
      expect(text).toContain('Einstellungen → Sprachen');
    }
  });
});
