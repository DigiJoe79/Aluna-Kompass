import { describe, expect, it } from 'vitest';
import { canReadType, dmsGatePermissions, readableTypeKeys, requireDmsGate, requireReadable, typePermission } from '../src/access';
import { documentTypes } from '../src/schema';
import { ctxWith } from '@kompass/core/testing';
import { setupWithArea } from './helpers';

describe('access', () => {
  it('the gate opens for dms.view or any area permission, and names dms.view when it stays shut', async () => {
    const { deps, viewer, auditor } = await setupWithArea();
    expect(dmsGatePermissions(deps)).toEqual(['dms.view', 'probe.read']);
    expect(requireDmsGate(deps, viewer)).toBeNull();
    expect(requireDmsGate(deps, auditor)).toBeNull();
    expect(requireDmsGate(deps, ctxWith(['contacts.view']))).toEqual({ ok: false, error: { type: 'forbidden', permission: 'dms.view' } });
  });

  it('a type with an area asks for exactly that permission — dms.view neither suffices nor is needed', async () => {
    const { deps, viewer, auditor } = await setupWithArea();
    expect(typePermission(deps, { protectionArea: null })).toBe('dms.view');
    expect(typePermission(deps, { protectionArea: 'probe' })).toBe('probe.read');
    expect(canReadType(deps, viewer, { protectionArea: 'probe' })).toBe(false);
    expect(canReadType(deps, auditor, { protectionArea: 'probe' })).toBe(true);
    expect(canReadType(deps, auditor, { protectionArea: null })).toBe(false);
    expect(readableTypeKeys(deps, auditor)).toEqual(['secret']);
    expect(readableTypeKeys(deps, viewer)).not.toContain('secret');
  });

  it('an area nobody registered is locked for everyone, never open', async () => {
    const { deps, all } = await setupWithArea();
    deps.db.insert(documentTypes).values({ key: 'orphan', label: 'Verwaist', prefix: 'VRW', defaultDirection: 'incoming', retentionClass: 'statutory10Y', defaultFolder: null, isActive: true, sortOrder: 91, ownerModule: null, protectionArea: 'gone' }).run();
    expect(typePermission(deps, { protectionArea: 'gone' })).toBeNull();
    expect(canReadType(deps, all, { protectionArea: 'gone' })).toBe(false);
    expect(requireReadable(deps, all, { typeKey: 'orphan' })).toEqual({ ok: false, error: { type: 'forbidden', permission: 'dms.area:gone' } });
  });

  it('requireReadable names the permission that is missing', async () => {
    const { deps, viewer, auditor } = await setupWithArea();
    expect(requireReadable(deps, viewer, { typeKey: 'secret' })).toEqual({ ok: false, error: { type: 'forbidden', permission: 'probe.read' } });
    expect(requireReadable(deps, auditor, { typeKey: 'secret' })).toBeNull();
    expect(requireReadable(deps, auditor, { typeKey: 'letter' })).toEqual({ ok: false, error: { type: 'forbidden', permission: 'dms.view' } });
  });
});
