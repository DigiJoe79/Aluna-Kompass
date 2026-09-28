import { describe, expect, it } from 'vitest';
import { coreModule } from '../src/core-module';
import { documentArea, documentAreaPermissions } from '../src/modules/document-areas';
import { defineModule } from '../src/modules/manifest';
import { createRegistry } from '../src/modules/registry';
import { createTestDeps } from '../src/testing';

const probe = defineModule({ key: 'probe', version: '0', permissions: ['probe.read'], documentAreas: [{ key: 'probe', permission: 'probe.read' }] });

describe('documentAreas', () => {
  it('must name a permission of its own module', () => {
    expect(() => defineModule({ key: 'm', version: '0', permissions: ['m.read'], documentAreas: [{ key: 'm', permission: 'dms.view' }] })).toThrow(/document area m\/m names a foreign permission: dms.view/);
  });

  it('is unique per key across modules', () => {
    const twin = defineModule({ key: 'twin', version: '0', permissions: ['twin.read'], documentAreas: [{ key: 'probe', permission: 'twin.read' }] });
    expect(() => createRegistry([coreModule, probe, twin])).toThrow(/duplicate document area: probe/);
  });

  it('resolves registry-wide — a module that is switched off still guards its area', () => {
    const deps = createTestDeps({ manifests: [coreModule, probe] }); // probe ist nicht eingeschaltet
    expect(documentArea(deps, 'probe')).toEqual({ key: 'probe', permission: 'probe.read', module: 'probe' });
    expect(documentArea(deps, 'gone')).toBeNull();
    expect(documentAreaPermissions(deps)).toEqual(['probe.read']);
  });
});
