import { createRoleInternal, provisionOnce, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { eq } from 'drizzle-orm';
import { categoryFieldsSchema, createCategoryInternal } from './ledger/categories';
import { START_PLAN } from './ledger/start-plan';
import { financeCategories } from './schema';

const F = (...keys: string[]) => keys.map((k) => `finance.${k}`);

/** Rollenvorschläge (Spec 10.1). Namen sind Nutzdaten des Vereins und umbenennbar; wiedergefunden wird über `originKey`. */
const ROLES = [
  { originKey: 'finance:treasurer', name: 'Schatzmeister', description: 'Führt die Finanzen: bucht, schreibt fest, schließt das Jahr ab, stellt Bestätigungen aus.', permissions: [...F('read', 'overview', 'entriesWrite', 'entriesFinalize', 'periodClose', 'setup', 'expensesSubmit', 'approve', 'donationsIssue', 'reportsFinalize'), 'dms.view', 'dms.create', 'documents.export', 'contacts.view', 'contacts.manage', 'projects.view', 'followUps.view', 'followUps.manage'] },
  { originKey: 'finance:approver', name: 'Freigeber Finanzen', description: 'Gibt Auslagen, Partnerzahlungen und Umwidmungen frei – nie die eigenen.', permissions: [...F('overview', 'read', 'approve', 'expensesSubmit'), 'contacts.view', 'projects.view'] },
  { originKey: 'finance:clerk', name: 'Auslagen einreichen', description: 'Reicht eigene Auslagen ein und sieht nur diese.', permissions: F('expensesSubmit') },
  { originKey: 'finance:auditor', name: 'Kassenprüfer', description: 'Liest alles, ändert nichts, zieht das Prüfpaket.', permissions: [...F('read', 'overview'), 'documents.export'] },
  { originKey: 'finance:agent', name: 'Finanz-Agent', description: 'Für einen Agenten über MCP: bereitet Buchungen vor. Festschreiben bleibt dem Menschen.', permissions: [...F('read', 'overview', 'entriesWrite'), 'contacts.view', 'projects.view'] },
] as const;

/**
 * Grundausstattung. Läuft beim Einschalten und bei jedem Start (VP1), je Teil
 * einmal: Was der Verein umbenannt, entzogen oder gelöscht hat, kommt nie zurück.
 */
export function installFinance(tx: DbOrTx, deps: Deps, ctx: CallContext): void {
  for (const role of ROLES) createRoleInternal(tx, deps, ctx, { module: 'finance', ...role });

  // Der Startplan ist ein Vorschlag je Schlüssel: gelöscht bleibt gelöscht, geändert bleibt geändert.
  for (const category of START_PLAN) {
    provisionOnce(tx, deps, { module: 'finance', kind: 'category', key: category.key }, () => {
      if (tx.select({ id: financeCategories.id }).from(financeCategories).where(eq(financeCategories.key, category.key)).get()) return 'skipped';
      createCategoryInternal(tx, deps, ctx, categoryFieldsSchema.parse(category));
      return 'created';
    });
  }
}
