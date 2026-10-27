import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { coreModule, seedDevelopment, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { createDocumentEngine } from '@kompass/documents';
import { createTaxPeriod, financeFiscalYears, listTaxPeriods, previewFinanceReport, REPORT_CATALOG, taxPeriodDefaults, vatAdvancePeriodKindInternal, vatPeriodOf } from '@kompass/module-finance';
import { beforeAll, describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

/**
 * Jeder verfügbare Bericht des Katalogs (Rechenschaft 0.4.0 § A) durch die echte Engine, über die Seed-Jahre: Der
 * Körper aus `toTypst` übersetzt in beiden Basen, und der Titel kommt im PDF an. Die Finanztests rendern mit der
 * Attrappe; ohne diesen Lauf fiele ein Typst-Fehler erst in der Vorschau auf.
 */
const deps = createTestDeps({ now: '2026-10-24T10:00:00.000Z', manifests: [coreModule, ...installedModules], env: 'development', documents: createDocumentEngine({}) });
const ctx = ctxWith([...deps.registry.permissionKeys]);

function pdfText(bytes: Uint8Array): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'kompass-report-'));
  try {
    writeFileSync(path.join(dir, 'x.pdf'), bytes);
    const out = spawnSync('pdftotext', ['-layout', path.join(dir, 'x.pdf'), '-'], { encoding: 'utf8' });
    if (out.status !== 0) throw new Error(`pdftotext: ${out.stderr}`);
    return out.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('finance reports render', () => {
  beforeAll(async () => {
    await seedDevelopment(deps);
    // Berichte über einen Erklärungszeitraum (D2) brauchen einen; legt der Seed keinen an, entsteht hier der vorgeschlagene.
    if (unwrap(await listTaxPeriods(deps, ctx, {})).length === 0) {
      const next = unwrap(await taxPeriodDefaults(deps, ctx, {}))!;
      unwrap(await createTaxPeriod(deps, ctx, { firstFiscalYearId: next.firstFiscalYearId, lastFiscalYearId: next.lastFiscalYearId, withTaxAdvisor: false, dueOn: next.dueOn }));
    }
  }, 60_000);

  const available = REPORT_CATALOG.filter((def) => def.available);

  it('has the core reports in the catalogue', () => {
    expect(available.length).toBeGreaterThan(0);
  });

  it.each(available.map((def) => [def.key, def] as const))('renders %s for every seed year', async (key, def) => {
    const years = deps.db.select().from(financeFiscalYears).all();
    expect(years.length).toBeGreaterThan(1);
    let rendered = 0;
    for (const year of years) {
      // Ein Bericht über einen eigenen Zeitraum (Erklärungszeitraum) nimmt dessen Parameter; ein Jahr ohne ihn entfällt.
      // Ein Bericht zu einem Stichtag (Übergabeliste) rechnet zum Ende des Jahres.
      // Ein Bericht über einen Umsatzsteuer-Zeitraum (E6b) rechnet den Zeitraum am Jahresende; ohne Fassung entfällt das Jahr.
      const vat = def.periodEnd ? { vatPeriod: vatPeriodOf(year.endsOn, vatAdvancePeriodKindInternal(deps.db, Number(year.endsOn.slice(0, 4)))).key } : null;
      if (vat && def.checkParams?.(deps.db, vat)) continue;
      const own = vat ?? def.paramsForYear?.(deps.db, year.id);
      if (own === null) continue;
      const params = own ?? (def.paramsSchema.safeParse({ fiscalYearId: year.id }).success ? { fiscalYearId: year.id } : { date: year.endsOn });
      rendered += 1;
      const preview = unwrap(await previewFinanceReport(deps, ctx, { report: key, params }));
      const text = pdfText(preview.bytes);
      expect(text.replace(/\s+/g, ' ')).toContain(def.paperTitle);
      expect(text).toContain(preview.shortHash);
    }
    expect(rendered).toBeGreaterThan(0);
  }, 60_000);
});
