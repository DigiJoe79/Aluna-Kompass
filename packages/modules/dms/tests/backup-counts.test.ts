import { describe, expect, it } from 'vitest';
import { dmsModule } from '../src/manifest';
import { fileFixture, setupWithTypes } from './helpers';

describe('backupCounts', () => {
  it('zählt die Dokumente der Akte für das Manifest eines Backups', async () => {
    const { deps, ctx } = setupWithTypes();
    expect(dmsModule.backupCounts!(deps)).toEqual({ documents: 0 });
    await fileFixture(deps, ctx);
    await fileFixture(deps, ctx);
    expect(dmsModule.backupCounts!(deps)).toEqual({ documents: 2 });
  });
});
