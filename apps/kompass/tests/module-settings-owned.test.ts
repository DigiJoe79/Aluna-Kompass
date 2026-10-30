import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { coreModule, createRegistry, setSetting, writeSettingInternal } from '@kompass/core';
import { createTestDeps, ctxWith, systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

/**
 * Befundliste 0.4.0, K1: `settings_set` (nur `settings.manage`) schrieb Einstellungen eines Moduls an dessen Diensten
 * vorbei — SEPA-Konto ohne Prüfung auf ein aktives Konto, Vorstandsvergütung ohne Beschluss, Mahnstufen ohne die
 * Prüfung auf doppelte Schlüssel. Jede Einstellung, die ein Fachdienst eines Moduls selbst schreibt, ist deshalb als
 * geführt markiert (`managedBy`: das Modul); `setSetting` lehnt sie mit `settingManaged` ab.
 *
 * Die Liste ist per Suche nach `writeSettingInternal(` in den Quellen der Module entstanden. Wo der Schlüssel als
 * Literal dasteht, prüft der Scan unten zusätzlich jede neue Stelle; Schlüssel aus Variablen und Tabellen stehen hier.
 */
const WRITTEN_BY_SERVICES: Record<string, readonly string[]> = {
  finance: [
    // direct-debit/settings.ts saveSepaSettings (SEPA_SAVE_KEYS)
    'finance.sepa.enabled', 'finance.sepa.creditorId', 'finance.sepa.creditorName', 'finance.sepa.accountId', 'finance.sepa.leadBusinessDays',
    'finance.sepa.maxLeadDays', 'finance.sepa.preNotificationDays', 'finance.sepa.batchBooking', 'finance.sepa.mandateReferenceFormat',
    // ledger/setup.ts: STEP_SETTING, TAX_DEFAULT_KEYS, FINANCE_SWITCH_KEYS, FINANCE_LIMIT_KEYS, Grundlagen, Berichte, Vergütung
    'finance.setupCategoriesConfirmedAt', 'finance.setupTaxConfirmedAt', 'finance.setupVatConfirmedAt',
    'finance.membershipFeesCertifiable', 'finance.expenseWaiversEnabled', 'finance.mcpHumanOnlyAllowed',
    'finance.statementSufficesBelowCents', 'finance.cashDonationAlertCents', 'finance.roundAmountFromCents', 'finance.proofGraceDays',
    'finance.expenseWaiverBasisText', 'finance.expenseWaiverBasisAgreedOn',
    'finance.reports.statuteReference', 'finance.reports.cashReportSignature', 'finance.reports.treasurerIsStatutoryBoard', 'finance.reports.assemblyApprovesAccounts',
    'finance.boardRemunerationAllowed', 'finance.boardRemunerationBasisText', 'finance.boardRemunerationDocumentId',
    'finance.boardRemunerationValidFrom', 'finance.boardRemunerationDecidedOn', 'finance.boardRemunerationResolutionId',
  ],
  // settings-service.ts saveMembersSettings (KEYS)
  members: ['members.resignationNotice', 'members.joinYearRule', 'members.paymentTermDays', 'members.dunningLevels'],
  site: ['site.blockedTerms'],
  // mail/settings.ts saveMailSettings; setOcrLanguages (K1b)
  dms: ['dms.mail.fromAddress', 'dms.mail.fromName', 'dms.mail.replyTo', 'dms.mail.ratePerMinute', 'dms.ocrLanguages'],
};

/**
 * Literale Schreiber, die bewusst nicht geführt sind: Grundausstattung beim Einschalten (`install`), die der Verein
 * danach über `settings_set` bzw. die Einrichtung ändert, und Entwicklungsdaten.
 */
const NOT_A_SERVICE = new Set(['dms.defaultTypeIncoming', 'dms.defaultTypeOutgoing', 'dms.mail.defaultBodySnippetId', 'dms.dispatchChannels']);

const modulesDir = path.resolve(import.meta.dirname, '../../../packages/modules');

function literalWriters(): { module: string; key: string; file: string }[] {
  const out: { module: string; key: string; file: string }[] = [];
  for (const module of readdirSync(modulesDir)) {
    const src = path.join(modulesDir, module, 'src');
    let files: string[];
    try {
      files = readdirSync(src, { recursive: true }).map(String).filter((f) => f.endsWith('.ts'));
    } catch {
      continue;
    }
    for (const file of files) {
      if (/(^|\/)(dev-)?seed[^/]*\.ts$/.test(file)) continue;
      const text = readFileSync(path.join(src, file), 'utf8');
      for (const m of text.matchAll(/writeSettingInternal\(\s*\w+,\s*\w+,\s*\w+,\s*'([^']+)'/g)) out.push({ module, key: m[1]!, file: `${module}/src/${file}` });
    }
  }
  return out;
}

describe('settings a module service writes are managed by that module (K1)', () => {
  const registry = createRegistry([coreModule, ...installedModules]);

  it('marks every listed key with its own module', () => {
    for (const [module, keys] of Object.entries(WRITTEN_BY_SERVICES)) {
      for (const key of keys) expect(registry.settingDefinitions.get(key)?.managedBy, key).toBe(module);
    }
  });

  it('finds every literal writer in the list (or the exceptions)', () => {
    const listed = new Set(Object.values(WRITTEN_BY_SERVICES).flat());
    const writers = literalWriters();
    // Gegenprobe: Der Scan findet etwas, sonst bewiese er nichts.
    expect(writers.some((w) => w.key === 'site.blockedTerms')).toBe(true);
    const missing = writers.filter((w) => !w.key.startsWith('organization.') && !listed.has(w.key) && !NOT_A_SERVICE.has(w.key));
    expect(missing).toEqual([]);
  });

  it('refuses settings_set on a managed module key and names the module', async () => {
    const deps = createTestDeps({ manifests: [coreModule, ...installedModules] });
    // Ein eingeschaltetes Finanzmodul — nur die Einstellung, ohne die Einrichtung beim Einschalten.
    deps.db.transaction((tx) => writeSettingInternal(tx, deps, systemContext(), 'modules.enabled', ['finance']));
    const mcp = { ...ctxWith(['settings.manage']), channel: 'mcp' as const };
    const res = await setSetting(deps, mcp, { key: 'finance.sepa.accountId', value: 'ACC1' });
    expect(res.ok ? null : res.error).toEqual({ type: 'conflict', code: 'settingManaged', message: 'finance' });
  });
});
