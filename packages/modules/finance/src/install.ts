import { createRoleInternal, provisionOnce, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { ensureDocumentType } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { categoryFieldsSchema, createCategoryInternal } from './ledger/categories';
import { START_PLAN } from './ledger/start-plan';
import { financeCategories } from './schema';

const F = (...keys: string[]) => keys.map((k) => `finance.${k}`);

/**
 * Belegarten als Vorschlag **für den Verein** (nicht modul-eigen): Ist Schlüssel
 * oder Präfix vergeben, hat der Verein schon entschieden — übersprungen, für
 * immer (Vorarbeiten-Spec § 4). Die Einrichtung (F3) nennt Arten, die als
 * Finanzbeleg gelten und keinen Bereich tragen.
 */
const VOUCHER_TYPES = [
  { key: 'voucher-own', label: 'Eigenbeleg', prefix: 'EBL' },
  { key: 'voucher-invoice', label: 'Eingangsrechnung', prefix: 'ERE' },
  { key: 'voucher-receipt', label: 'Quittung', prefix: 'QTG' },
  { key: 'bank-statement', label: 'Kontoauszug', prefix: 'KTO' },
] as const;

/** Rollenvorschläge (Spec 10.1). Namen sind Nutzdaten des Vereins und umbenennbar; wiedergefunden wird über `originKey`. */
const ROLES = [
  { originKey: 'finance:treasurer', name: 'Schatzmeister', description: 'Führt die Finanzen: bucht, schreibt fest, schließt das Jahr ab, stellt Bestätigungen aus.', permissions: [...F('read', 'overview', 'entriesWrite', 'entriesFinalize', 'periodClose', 'setup', 'expensesSubmit', 'approve', 'donationsIssue', 'reportsFinalize'), 'dms.view', 'dms.create', 'documents.export', 'contacts.view', 'contacts.manage', 'projects.view', 'followUps.view', 'followUps.manage'] },
  { originKey: 'finance:approver', name: 'Freigeber Finanzen', description: 'Gibt Auslagen, Zahlungen an Partner und Umwidmungen frei – nie die eigenen.', permissions: [...F('overview', 'read', 'approve', 'expensesSubmit'), 'contacts.view', 'projects.view'] },
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

  // Vier Belegarten als Vorschlag; vorhandene Arten des Vereins fasst Finanzen nie an.
  for (const type of VOUCHER_TYPES) {
    ensureDocumentType(tx, deps, ctx, { module: 'finance', key: type.key, label: type.label, prefix: type.prefix, defaultDirection: 'incoming', retentionClass: 'statutory8Y', owned: false, protectionArea: 'finance' });
  }

  // Modul-eigen: Das Zählprotokoll braucht das Modul zum Arbeiten (Spec 4.4). Trägt eine
  // andere Art das Präfix KZP schon, meldet der Start einen Fehler (Vorarbeiten-Spec § 4).
  ensureDocumentType(tx, deps, ctx, { module: 'finance', key: 'finance-cash-count', label: 'Kassenzählung', prefix: 'KZP', defaultDirection: 'outgoing', retentionClass: 'statutory10Y', owned: true, protectionArea: 'finance' });

  // F6a — modul-eigen: unser Exemplar der Zuwendungsbestätigung (ein lückenloser Nummernkreis, den nur
  // Finanzen zieht) und die unterschriebene Fassung, die als Eingang zurückkommt. Trägt eine Vereinsart
  // ZWB oder ZWU schon, scheitert der Start, bis der Verein ihr ein anderes Präfix gibt (Befundliste § 5).
  ensureDocumentType(tx, deps, ctx, { module: 'finance', key: 'finance-confirmation', label: 'Zuwendungsbestätigung', prefix: 'ZWB', defaultDirection: 'outgoing', retentionClass: 'statutory10Y', owned: true, protectionArea: 'finance' });
  ensureDocumentType(tx, deps, ctx, { module: 'finance', key: 'finance-confirmation-signed', label: 'Zuwendungsbestätigung, unterschrieben', prefix: 'ZWU', defaultDirection: 'incoming', retentionClass: 'statutory10Y', owned: true, protectionArea: 'finance' });

  // F8a — modul-eigen: die Verzichtserklärung, die Finanzen zum Antrag erzeugt, und die unterschriebene Fassung, die als
  // Eingang zurückkommt. Zehn Jahre wie die Zuwendungsbestätigung, die aus dem Verzicht entsteht.
  ensureDocumentType(tx, deps, ctx, { module: 'finance', key: 'finance-waiver-declaration', label: 'Verzichtserklärung', prefix: 'VZE', defaultDirection: 'outgoing', retentionClass: 'statutory10Y', owned: true, protectionArea: 'finance' });
  ensureDocumentType(tx, deps, ctx, { module: 'finance', key: 'finance-waiver-signed', label: 'Verzichtserklärung, unterschrieben', prefix: 'VZU', defaultDirection: 'incoming', retentionClass: 'statutory10Y', owned: true, protectionArea: 'finance' });
}
