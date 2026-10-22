import { hasPermission, type CallContext, type Deps } from '@kompass/core';
import { refuseVoidOwned, type DocumentTypeRow } from '@kompass/module-dms';

/**
 * Was die Dokumentseite anbietet. Rechte allein reichen nicht: Eine modul-eigene Art storniert nur ihr Modul, und die
 * Seite fragt dafür dieselbe Regel wie der Dienst (`refuseVoidOwned`), statt einen Knopf zu zeigen, der immer abgelehnt
 * wird (Testdurchsicht 2026-10-22). Der Dienst lehnt weiter selbst ab — MCP ruft ihn ohne diese Seite.
 */
export function documentPermissions(deps: Deps, ctx: CallContext, docType: DocumentTypeRow | null) {
  return {
    canFile: hasPermission(ctx, 'dms.file'),
    canVoid: hasPermission(ctx, 'dms.void') && refuseVoidOwned(deps, docType) === null,
    canDeleteDraft: hasPermission(ctx, 'dms.deleteDraft'),
    canEdit: hasPermission(ctx, 'dms.create'),
    canManage: hasPermission(ctx, 'dms.manage'),
  };
}
