import { schema } from '@kompass/core';
import { systemContext } from '@kompass/core/testing';
import { documentTypes } from '@kompass/module-dms';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { installGovernance } from '../src/install';
import { governanceOffices, governanceOrgans } from '../src/schema';
import { setupGovernance } from './helpers';

describe('installGovernance', () => {
  it('proposes assembly, board, four offices, five document types and two roles — once', () => {
    const { deps } = setupGovernance();
    deps.db.transaction((tx) => installGovernance(tx, deps, systemContext()));
    const organs = deps.db.select().from(governanceOrgans).all();
    expect(organs.map((o) => o.kind).sort()).toEqual(['assembly', 'board']);
    const offices = deps.db.select().from(governanceOffices).all();
    expect(offices).toHaveLength(4);
    const assembly = organs.find((o) => o.kind === 'assembly')!;
    const audit = offices.find((o) => o.function === 'auditor')!;
    expect(audit).toMatchObject({ organId: assembly.id, seats: 2 });
    const board = offices.filter((o) => o.organId !== assembly.id);
    expect(board.map((o) => o.function).sort()).toEqual(['board', 'chair', 'treasurer']);
    expect(board.every((o) => o.seats === 1 && o.termMonths === 24 && o.untilSuccessor && o.representative)).toBe(true);
    expect([...audit.incompatibleWith].sort()).toEqual(board.map((o) => o.id).sort());
    const types = deps.db.select().from(documentTypes).all().filter((t) => t.ownerModule === 'governance');
    expect(types.map((t) => t.prefix).sort()).toEqual(['ANW', 'ELB', 'ELD', 'RGA', 'VSP']);
    expect(types.every((t) => t.protectionArea === 'governance')).toBe(true);
    const roles = deps.db.select().from(schema.roles).all().filter((r) => r.name === 'Vorstand' || r.name === 'Protokollführung');
    expect(roles).toHaveLength(2);
  });

  it('keeps a renamed office renamed', () => {
    const { deps } = setupGovernance();
    const chair = deps.db.select().from(governanceOffices).all().find((o) => o.function === 'chair')!;
    deps.db.update(governanceOffices).set({ name: 'Präsidium' }).where(eq(governanceOffices.id, chair.id)).run();
    deps.db.transaction((tx) => installGovernance(tx, deps, systemContext()));
    expect(deps.db.select().from(governanceOffices).where(eq(governanceOffices.id, chair.id)).get()?.name).toBe('Präsidium');
    expect(deps.db.select().from(governanceOffices).all()).toHaveLength(4);
  });
});
