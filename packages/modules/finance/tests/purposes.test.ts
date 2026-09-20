import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createProject } from '@kompass/module-projects';
import { describe, expect, it } from 'vitest';
import { FINANCE_PERMISSIONS } from '../src/manifest';
import { createPurpose, deletePurpose, dissolvePurpose, fulfillPurpose, listPurposes, reopenPurpose, updatePurpose } from '../src/ledger/purposes';
import { setupFinance } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);
/** Kleinste gültige Eingabe von `createProject` (Muster projects.test.ts). */
const PROJECT_INPUT = { slug: 'dach-projekt', name: { de: 'Dach-Projekt' }, type: 'ongoing' as const, summary: {}, body: {} };

describe('purposes', () => {
  it('needs finance.setup; the list needs an overview right and hides the free-text description from it', async () => {
    const { deps, ctx } = setupFinance();
    expect(err(await createPurpose(deps, ctxWith(['finance.read']), { name: 'Dach' }))).toEqual({ type: 'forbidden', permission: 'finance.setup' });
    unwrap(await createPurpose(deps, ctx, { name: 'Dachsanierung', description: 'Zusage von Frau Muster', targetCents: 500000, abroad: false }));
    expect(unwrap(await listPurposes(deps, ctxWith(['finance.overview']), {}))[0]).toMatchObject({ name: 'Dachsanierung', description: null, targetCents: 500000 });
    expect(unwrap(await listPurposes(deps, ctxWith(['finance.read']), {}))[0]!.description).toBe('Zusage von Frau Muster');
  });

  it('points at a project that exists, without a foreign key', async () => {
    const { deps, ctx } = setupFinance([...FINANCE_PERMISSIONS, 'projects.manage', 'projects.view']);
    expect(err(await createPurpose(deps, ctx, { name: 'Dach', projectId: 'nope' }))).toEqual({ type: 'notFound', entity: 'project', id: 'nope' });
    const project = unwrap(await createProject(deps, ctx, PROJECT_INPUT));
    expect(unwrap(await createPurpose(deps, ctx, { name: 'Dach', projectId: project.id })).projectId).toBe(project.id);
  });

  it('takes a carry-forward only with its date', async () => {
    const { deps, ctx } = setupFinance();
    expect(err(await createPurpose(deps, ctx, { name: 'Dach', carryForwardCents: 12000 }))).toMatchObject({ type: 'validation', issues: [{ path: 'carryForwardDate', message: 'carryForwardDateRequired' }] });
  });

  it('is fulfilled or dissolved by a person, with date; a closed purpose takes no changes until reopened', async () => {
    const { deps, ctx, userId } = setupFinance();
    const purpose = unwrap(await createPurpose(deps, ctx, { name: 'Dach' }));
    const done = unwrap(await fulfillPurpose(deps, ctx, { id: purpose.id }));
    expect(done).toMatchObject({ fulfilledByUserId: userId, dissolvedAt: null });
    expect(done.fulfilledAt).not.toBeNull();
    expect(err(await updatePurpose(deps, ctx, { id: purpose.id, name: 'Anders' }))).toMatchObject({ type: 'conflict', code: 'purposeClosed' });
    expect(err(await dissolvePurpose(deps, ctx, { id: purpose.id }))).toMatchObject({ type: 'conflict', code: 'purposeClosed' });
    expect(unwrap(await reopenPurpose(deps, ctx, { id: purpose.id }))).toMatchObject({ fulfilledAt: null, fulfilledByUserId: null });
  });

  it('logs neither name nor description, and deletes an unused purpose', async () => {
    const { deps, ctx } = setupFinance();
    const purpose = unwrap(await createPurpose(deps, ctx, { name: 'Dachsanierung', description: 'Zusage von Frau Muster' }));
    unwrap(await deletePurpose(deps, ctx, { id: purpose.id }));
    const log = JSON.stringify(deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.purpose.')));
    expect(log).not.toMatch(/Dachsanierung|Muster/);
    expect(log).toContain('finance.purpose.delete');
  });
});
