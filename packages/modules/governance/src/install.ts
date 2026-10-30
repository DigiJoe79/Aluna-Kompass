import { createRoleInternal, isoNow, newId, provisionOnce, readLocales, recordAudit, type CallContext, type DbOrTx, type Deps } from '@kompass/core';
import { ensureDocumentType } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { governanceOffices, governanceOrgans } from './schema';
import { START_ORGANS, START_ROLES, startName } from './start-data';

/**
 * Dokumentarten des Moduls (Spec § 9.2, Plan G1 Task 3): Die Frist hängt an der Art, deshalb Einladung (Wortlaut,
 * dauerhaft) und Einladungsschreiben je Mitglied (10 Jahre) getrennt, ebenso die Angaben für die Registeranmeldung.
 * Satzung (`GRD`) und MV-Protokoll (`PRT`) nutzen die vorhandenen Arten der Akte.
 */
const GOVERNANCE_DOCUMENT_TYPES = [
  { key: 'governance-invitation', label: 'Einladung', prefix: 'ELD', retentionClass: 'permanent' },
  { key: 'governance-invitation-letter', label: 'Einladungsschreiben', prefix: 'ELB', retentionClass: 'statutory10Y' },
  { key: 'governance-attendance', label: 'Anwesenheitsliste', prefix: 'ANW', retentionClass: 'statutory10Y' },
  { key: 'governance-register-data', label: 'Angaben für die Registeranmeldung', prefix: 'RGA', retentionClass: 'statutory10Y' },
  { key: 'governance-board-minutes', label: 'Vorstandsprotokoll', prefix: 'VSP', retentionClass: 'permanent' },
] as const;

/**
 * Grundausstattung. Läuft beim Einschalten und bei jedem Start, je Teil einmal: Was der Verein umbenannt, entzogen
 * oder gelöscht hat, kommt nie zurück.
 */
export function installGovernance(tx: DbOrTx, deps: Deps, ctx: CallContext): void {
  const locale = readLocales(deps)[0] ?? 'de';
  createRoleInternal(tx, deps, ctx, {
    module: 'governance',
    originKey: 'governance:board',
    name: startName(START_ROLES.board.name, locale),
    description: startName(START_ROLES.board.description, locale),
    permissions: ['governance.read', 'governance.manage', 'governance.record', 'contacts.view', 'contacts.manage', 'members.read', 'dms.view', 'dms.create', 'dms.file', 'dms.send'],
  });
  createRoleInternal(tx, deps, ctx, {
    module: 'governance',
    originKey: 'governance:minutes',
    name: startName(START_ROLES.minutes.name, locale),
    description: startName(START_ROLES.minutes.description, locale),
    // Mitlauf (Plan G3): Anwesenheit, Feststellungen, Ergebnisse.
    permissions: ['governance.read', 'governance.record', 'contacts.view', 'members.read', 'dms.view'],
  });

  for (const type of GOVERNANCE_DOCUMENT_TYPES) ensureDocumentType(tx, deps, ctx, { module: 'governance', ...type, defaultDirection: 'outgoing', owned: true, protectionArea: 'governance' });

  // Organe und Ämter als ein Vorschlag: nur in eine leere Tabelle, und nur einmal.
  provisionOnce(tx, deps, { module: 'governance', kind: 'organs', key: 'start' }, () => {
    if (tx.select({ id: governanceOrgans.id }).from(governanceOrgans).get()) return 'skipped';
    const now = isoNow(deps.clock);
    const ids = new Map<string, string>();
    START_ORGANS.forEach((organ, index) => {
      const organId = newId();
      tx.insert(governanceOrgans).values({ id: organId, kind: organ.kind, name: startName(organ.name, locale), active: true, sortOrder: index + 1, createdAt: now, updatedAt: now }).run();
      organ.offices.forEach((office, officeIndex) => {
        const id = newId();
        ids.set(`${organ.kind}:${office.function}`, id);
        const { name, ...rest } = office;
        tx.insert(governanceOffices).values({ id, organId, name: startName(name, locale), ...rest, incompatibleWith: [], active: true, sortOrder: officeIndex + 1, createdAt: now, updatedAt: now }).run();
      });
    });
    // Kassenprüfung ↔ Vorstand (Spec § 3.2): wer prüft, soll nicht zugleich im Vorstand sein.
    const boardOffices = [...ids].filter(([key]) => key.startsWith('board:')).map(([, id]) => id);
    const auditor = ids.get('assembly:auditor');
    if (auditor) tx.update(governanceOffices).set({ incompatibleWith: boardOffices }).where(eq(governanceOffices.id, auditor)).run();
    recordAudit(tx, deps, ctx, { action: 'governance.install.organs', entityType: 'governanceOrgan', entityId: null, after: { organs: START_ORGANS.length, offices: ids.size }, params: {} });
    return 'created';
  });
}
