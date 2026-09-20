import { unwrap } from '@kompass/core';
import { auditEntry, systemContext } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { documentTypeFor } from '../src/catalog';
import { ensureDocumentType, type ProvisionedDocumentType } from '../src/provision';
import { setupWithTypes } from './helpers';

const NOTE: ProvisionedDocumentType = { module: 'probe', key: 'probe-note', label: 'Notiz', prefix: 'NTZ', defaultDirection: 'outgoing', retentionClass: 'statutory10Y', owned: true, protectionArea: 'probe' };
const run = (deps: ReturnType<typeof setupWithTypes>['deps'], type: ProvisionedDocumentType = NOTE) => deps.db.transaction((tx) => ensureDocumentType(tx, deps, systemContext(), type));

describe('ensureDocumentType', () => {
  it('creates a module-owned type once and records it', () => {
    const { deps } = setupWithTypes();
    expect(run(deps)).toBe('created');
    expect(documentTypeFor(deps.db, 'probe-note')).toMatchObject({ prefix: 'NTZ', ownerModule: 'probe', protectionArea: 'probe', isActive: true });
    expect(auditEntry(deps, 'dms.type.provision').channel).toBe('system');
    expect(run(deps)).toBe('already');
  });

  it('skips a type for the association when key or prefix is taken — it is theirs to decide', () => {
    const { deps } = setupWithTypes();
    const forThem = { ...NOTE, owned: false, protectionArea: null };
    expect(run(deps, { ...forThem, key: 'letter' })).toBe('skipped');                 // Schlüssel vergeben
    expect(run(deps, { ...forThem, key: 'probe-note-2', prefix: 'BRF' })).toBe('skipped'); // Präfix vergeben
    expect(documentTypeFor(deps.db, 'probe-note-2')).toBeNull();
  });

  it('throws when a module-owned type cannot have its prefix — the module could not work without it', () => {
    const { deps } = setupWithTypes();
    expect(() => run(deps, { ...NOTE, prefix: 'BRF' })).toThrow(/Präfix BRF .*Brief/);
    expect(documentTypeFor(deps.db, 'probe-note')).toBeNull();
  });
});
