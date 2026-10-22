import { coreModule, defineModule } from '@kompass/core';
import { createTestDeps, ctxWith, insertUser, systemContext } from '@kompass/core/testing';
import { contactsModule } from '@kompass/module-contacts';
import { dmsModule, documentTypeFor, ensureDocumentType } from '@kompass/module-dms';
import { describe, expect, it } from 'vitest';
import { resolveLinks } from '@/app/(shell)/dms/[id]/links';
import { documentPermissions } from '@/app/(shell)/dms/[id]/permissions';

/**
 * Die Akte zeigt keine Knöpfe, die der Dienst immer ablehnt (Testdurchsicht 2026-10-22): „Stornieren“ fehlt an einer
 * modul-eigenen Art, die ihr Modul nicht freigibt, „Lösen“ an einem reservierten Bezug. Die Seite fragt dieselbe Regel
 * wie der Dienst — geprüft wird hier, dass sie sie fragt, nicht die Regel selbst (die prüfen die Dienst-Tests).
 */
const probe = defineModule({
  key: 'probe',
  version: '0.0.0',
  permissions: ['probe.read'],
  linkedDocumentAccess: [{ entityType: 'probeThing', readPermission: 'probe.read' }],
  voidableDocumentTypes: ['probe-released'],
});

function setup() {
  const deps = createTestDeps({ manifests: [coreModule, contactsModule, dmsModule, probe] });
  deps.db.transaction((tx) => {
    ensureDocumentType(tx, deps, systemContext(), { module: 'probe', key: 'probe-owned', label: 'Notiz', prefix: 'NTZ', defaultDirection: 'outgoing', retentionClass: 'statutory10Y', owned: true });
    ensureDocumentType(tx, deps, systemContext(), { module: 'probe', key: 'probe-released', label: 'Brief', prefix: 'BRF', defaultDirection: 'outgoing', retentionClass: 'statutory10Y', owned: true });
    ensureDocumentType(tx, deps, systemContext(), { module: 'probe', key: 'probe-free', label: 'Vertrag', prefix: 'VTR', defaultDirection: 'incoming', retentionClass: 'statutory10Y', owned: false });
  });
  const userId = insertUser(deps, { name: 'Test', email: 'test@kompass.local' });
  return { deps, ctx: ctxWith(['dms.view', 'dms.create', 'dms.void', 'probe.read'], userId) };
}

describe('document page: no action the service always refuses', () => {
  it('offers voiding only where the archive may void the type', () => {
    const { deps, ctx } = setup();
    const canVoid = (key: string) => documentPermissions(deps, ctx, documentTypeFor(deps.db, key)).canVoid;
    expect(canVoid('probe-owned')).toBe(false);
    expect(canVoid('probe-released')).toBe(true);
    expect(canVoid('probe-free')).toBe(true);
    expect(documentPermissions(deps, { ...ctx, permissions: new Set(['dms.view']) }, documentTypeFor(deps.db, 'probe-free')).canVoid).toBe(false);
  });

  it('marks a reserved link as not removable', async () => {
    const { deps, ctx } = setup();
    const links = await resolveLinks(deps, ctx, [
      { id: 'L1', entityType: 'probeThing', entityId: 'T1', role: 'about' },
      { id: 'L2', entityType: 'contact', entityId: 'C1', role: 'about' },
    ]);
    expect(links.map((link) => link.removable)).toEqual([false, true]);
  });
});
