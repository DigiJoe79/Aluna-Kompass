import { schema, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createProject } from '@kompass/module-projects';
import { describe, expect, it } from 'vitest';
import { saveDraft } from '../src/ledger/entries';
import { bookEntry } from '../src/ledger/finalize';
import { getProjectFinance, projectFinanceInternal, setProjectFinance } from '../src/ledger/project-settings';
import { createPurpose } from '../src/ledger/purposes';
import { ledgerFixture } from './helpers';

const err = (r: { ok: boolean; error?: unknown }) => (r.ok ? 'ok' : r.error);

/** Ein Projekt anlegen, ohne dass `f.ctx` `projects.manage` braucht (Muster corrections.test.ts). */
async function seedProject(deps: Awaited<ReturnType<typeof ledgerFixture>>['deps'], userId: string, slug: string) {
  const manager = ctxWith(['projects.manage'], userId);
  return unwrap(await createProject(deps, manager, { slug, name: { de: 'Testprojekt' }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
}

describe('project finance settings', () => {
  it('stores target, default purpose, abroad and the publish switch for a project that exists', async () => {
    const f = await ledgerFixture();
    const project = await seedProject(f.deps, f.userId, 'testprojekt');
    const purpose = unwrap(await createPurpose(f.deps, f.ctx, { name: 'Zweck' }));

    const saved = unwrap(await setProjectFinance(f.deps, f.ctx, { projectId: project.id, targetCents: 100000, defaultPurposeId: purpose.id, abroad: true, publishDonationStatus: true }));
    expect(saved).toMatchObject({ projectId: project.id, targetCents: 100000, defaultPurposeId: purpose.id, abroad: true, publishDonationStatus: true });

    const read = unwrap(await getProjectFinance(f.deps, f.ctx, { projectId: project.id }));
    expect(read.settings).toMatchObject({ targetCents: 100000, defaultPurposeId: purpose.id, abroad: true, publishDonationStatus: true });
    expect(read.result).toEqual({ incomeCents: 0, expenseCents: 0, resultCents: 0 });
  });

  it('answers defaults for a project without a row — and writes none by reading', async () => {
    const f = await ledgerFixture();
    const project = await seedProject(f.deps, f.userId, 'ohne-zeile');
    const defaults = projectFinanceInternal(f.deps.db, project.id);
    expect(defaults).toMatchObject({ projectId: project.id, targetCents: null, defaultPurposeId: null, abroad: false, publishDonationStatus: false });

    const read = unwrap(await getProjectFinance(f.deps, f.ctx, { projectId: project.id }));
    expect(read.settings).toMatchObject({ targetCents: null, abroad: false });

    const { financeProjectSettings } = await import('../src/schema');
    expect(f.deps.db.select().from(financeProjectSettings).all()).toHaveLength(0);
  });

  it('needs finance.setup to write; reading is open to the overview right and carries no names', async () => {
    const f = await ledgerFixture();
    const project = await seedProject(f.deps, f.userId, 'testprojekt');
    const overview = ctxWith(['finance.overview'], f.userId);
    expect(err(await setProjectFinance(f.deps, overview, { projectId: project.id, targetCents: 1000 }))).toEqual({ type: 'forbidden', permission: 'finance.setup' });
    const read = unwrap(await getProjectFinance(f.deps, overview, { projectId: project.id }));
    expect(JSON.stringify(read)).not.toContain('Testprojekt');
  });

  it('refuses a project or a purpose that does not exist', async () => {
    const f = await ledgerFixture();
    expect(err(await setProjectFinance(f.deps, f.ctx, { projectId: 'nope', targetCents: 1000 }))).toEqual({ type: 'notFound', entity: 'project', id: 'nope' });
    const project = await seedProject(f.deps, f.userId, 'testprojekt');
    expect(err(await setProjectFinance(f.deps, f.ctx, { projectId: project.id, defaultPurposeId: 'nope' }))).toEqual({ type: 'notFound', entity: 'financePurpose', id: 'nope' });
  });

  it('a line inherits abroad from the purpose or from the project, and can still override it', async () => {
    const f = await ledgerFixture();
    const projectAbroad = await seedProject(f.deps, f.userId, 'ausland-projekt');
    unwrap(await setProjectFinance(f.deps, f.ctx, { projectId: projectAbroad.id, abroad: true }));

    const fromProject = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000, projectId: projectAbroad.id }] }));
    expect(fromProject.allocationLines[0]!.abroad).toBe(true);

    const overridden = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000, projectId: projectAbroad.id, abroad: false }] }));
    expect(overridden.allocationLines[0]!.abroad).toBe(false);

    const fromPurpose = unwrap(await saveDraft(f.deps, f.ctx, { entryDate: '2026-03-01', text: 'x', moneyLines: [{ accountId: f.bank.id, amountCents: 1000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 1000, purposeId: f.abroadPurpose.id }] }));
    expect(fromPurpose.allocationLines[0]!.abroad).toBe(true);
  });

  it('logs the switches, not the project name', async () => {
    const f = await ledgerFixture();
    const project = await seedProject(f.deps, f.userId, 'stille-liebe');
    unwrap(await setProjectFinance(f.deps, f.ctx, { projectId: project.id, targetCents: 5000, abroad: true }));
    const log = JSON.stringify(f.deps.db.select().from(schema.auditLog).all().filter((e) => e.action.startsWith('finance.projectSettings')));
    expect(log).not.toContain('stille-liebe');
    expect(log).not.toContain('Testprojekt');
  });
});

/** Nutzt auch das gemeinsame Buchungsergebnis über eine Buchung. */
describe('project finance result', () => {
  it('sums finalized lines of the project', async () => {
    const f = await ledgerFixture();
    const manager = ctxWith(['projects.manage'], f.userId);
    const project = unwrap(await createProject(f.deps, manager, { slug: 'ergebnis-projekt', name: { de: 'X' }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-01', text: 'Spende', moneyLines: [{ accountId: f.bank.id, amountCents: 5000 }], allocationLines: [{ categoryId: f.donations.id, amountCents: 5000, projectId: project.id }] }));
    unwrap(await bookEntry(f.deps, f.ctx, { entryDate: '2026-02-02', text: 'Ausgabe', moneyLines: [{ accountId: f.bank.id, amountCents: -2000 }], allocationLines: [{ categoryId: f.programCosts.id, amountCents: -2000, projectId: project.id }] }));
    const read = unwrap(await getProjectFinance(f.deps, f.ctx, { projectId: project.id }));
    expect(read.result).toEqual({ incomeCents: 5000, expenseCents: 2000, resultCents: 3000 });
  });
});
