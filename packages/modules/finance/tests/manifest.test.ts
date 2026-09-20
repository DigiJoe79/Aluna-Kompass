import { describe, expect, it } from 'vitest';
import { financeModule } from '../src/manifest';

describe('finance module', () => {
  it('has the key finance, stores files, and depends on contacts, the file module and projects', () => {
    expect(financeModule).toMatchObject({ key: 'finance', files: true });
    expect([...(financeModule.dependsOn ?? [])].sort()).toEqual(['contacts', 'dms', 'projects']);
  });

  it('declares all ten permissions from the start — role proposals are never topped up later', () => {
    expect(financeModule.permissions).toEqual([
      'finance.read', 'finance.overview', 'finance.entriesWrite', 'finance.entriesFinalize', 'finance.periodClose',
      'finance.setup', 'finance.expensesSubmit', 'finance.approve', 'finance.donationsIssue', 'finance.reportsFinalize',
    ]);
  });

  it('has no navigation yet — the surface comes with plan F3', () => {
    expect(financeModule.navigation ?? []).toEqual([]);
  });
});
