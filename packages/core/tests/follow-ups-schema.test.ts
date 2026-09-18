import { describe, expect, it } from 'vitest';
import { CORE_PERMISSIONS } from '../src/permissions/core';
import { createTestDeps } from '../src/testing';

describe('follow_ups', () => {
  it('die Tabelle existiert mit ihren Spalten', () => {
    const deps = createTestDeps();
    const columns = deps.sqlite.prepare(`PRAGMA table_info(follow_ups)`).all() as { name: string }[];
    expect(columns.map((c) => c.name).sort()).toEqual(
      ['assignee_user_id', 'created_at', 'created_by_user_id', 'done_at', 'done_by_user_id', 'due_at', 'entity_id', 'entity_type', 'id', 'title', 'updated_at'].sort(),
    );
  });

  it('der Kern kennt zwei Rechte für Wiedervorlagen', () => {
    expect(CORE_PERMISSIONS).toContain('followUps.view');
    expect(CORE_PERMISSIONS).toContain('followUps.manage');
  });
});
