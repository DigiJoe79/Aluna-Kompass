import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { remunerationWithoutStatute, remunerationWrongOrgan } from '../src/resolution-details';
import { saveResolution } from '../src/resolutions';
import { EMPTY_RULES } from '../src/rules/schema';
import { officeOf, organOf, RECORDING, session, setupGovernance, withRules } from './helpers';

const remuneration = (deps: Parameters<typeof officeOf>[0], statuteReference: string | null) => ({ statuteReference, decidedByOrganId: organOf(deps, 'assembly'), officeIds: [officeOf(deps, 'treasurer')], mode: 'flat', amountCents: 84000, validFrom: '2027-01-01' });
const exclusion = { membershipId: 'm', statuteGround: '§ 6 Abs. 3', hearingOn: '2026-08-30', reasonsDocumentId: 'd', noticeReceivedOn: '2026-08-27' };

describe('structured resolution kinds', () => {
  it('remuneration without statute basis warns; with a rule in the statute it does not', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['remuneration'], voters: 2 });
    const bare = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true, excluded: [], details: remuneration(deps, null) }));
    expect(bare.warnings).toContain('remunerationWithoutStatute');
    const ruled = setupGovernance(RECORDING);
    await withRules(ruled.deps, ruled.ctx, { board: { remuneration: { statuteReference: '§ 8 Abs. 3', decidedBy: organOf(ruled.deps, 'assembly') } } });
    const s = await session(ruled.deps, ruled.ctx, { items: ['remuneration'], voters: 2 });
    const fine = unwrap(await saveResolution(ruled.deps, ruled.ctx, { agendaItemId: s.items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true, excluded: [], details: remuneration(ruled.deps, null) }));
    expect(fine.warnings).not.toContain('remunerationWithoutStatute');
  });

  it('W-4: a statute reference alone does not replace the rule of the stand valid on the day', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['remuneration'], voters: 2 });
    const cited = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true, excluded: [], details: remuneration(deps, '§ 8 Abs. 3 Satzung') }));
    expect(cited.warnings).toContain('remunerationWithoutStatute');
  });

  it('W-4: the warning condition is shared — only an organ with the rule remuneration counts (form and service alike)', () => {
    const rules = { ...EMPTY_RULES, organs: { B: { remuneration: { statuteReference: '§ 8 Abs. 3', decidedBy: 'A' } } } };
    expect(remunerationWithoutStatute(rules, ['A', null, 'C'])).toBe(true);
    expect(remunerationWithoutStatute(rules, ['A', 'B'])).toBe(false);
    expect(remunerationWithoutStatute(EMPTY_RULES, ['B'])).toBe(true);
  });

  it('a reserve nr1 without purpose is refused; an expense rule backwards warns', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    const { items } = await session(deps, ctx, { items: ['reserve', 'expenseRule'], voters: 2 });
    expect(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true, details: { type: 'nr1', purpose: null, amountCents: 100, fiscalYearId: 'fy', action: 'create' } })).toMatchObject({ ok: false, error: { type: 'validation' } });
    unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true, details: { type: 'nr3', purpose: null, amountCents: 100, fiscalYearId: 'fy', action: 'create' } }));
    const rule = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[1]!.id, text: 'x', votedAt: '19:40', unanimous: true, details: { basis: 'boardResolution', rule: 'Fahrtkosten 0,30 € je km', validFrom: '2026-01-01' } }));
    expect(rule.warnings).toContain('expenseRuleRetroactive');
  });

  it('an exclusion with reasons sent ten days before the assembly under a 14-day rule warns', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { assembly: { exclusionNoticeDays: 14 } });
    const { items } = await session(deps, ctx, { items: ['exclusion'], voters: 3 });
    const late = unwrap(await saveResolution(deps, ctx, { agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true, excluded: [], details: { ...exclusion, reasonsSentOn: '2026-08-26' } }));
    expect(late.warnings).toContain('exclusionChecklistOpen');
    const inTime = unwrap(await saveResolution(deps, ctx, { id: late.id, agendaItemId: items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true, excluded: [], details: { ...exclusion, reasonsSentOn: '2026-08-20' } }));
    expect(inTime.warnings).not.toContain('exclusionChecklistOpen');
  });
});

describe('details in the tool schemas (G-20)', () => {
  it('the details of resolution_save and circular_create name every field per kind', async () => {
    const { z } = await import('zod');
    const { RESOLUTION_DETAILS } = await import('../src/resolution-details');
    const { resolutionSaveSchema } = await import('../src/resolutions');
    const { circularCreateSchema } = await import('../src/circulars');
    for (const schema of [resolutionSaveSchema, circularCreateSchema]) {
      const description = (z.toJSONSchema(schema) as unknown as { properties: { details: { description?: string } } }).properties.details.description ?? '';
      for (const [kind, details] of Object.entries(RESOLUTION_DETAILS)) {
        if (kind === 'agenda' || kind === 'election') continue; // eigene Werkzeuge (late_motion_admit, election_round_save)
        const fields = Object.keys((z.toJSONSchema(details!) as unknown as { properties?: Record<string, unknown> }).properties ?? {});
        expect(description, kind).toContain(`${kind}:`);
        for (const field of fields) expect(description, `${kind}.${field}`).toContain(field);
      }
    }
  });
});

describe('L-1: the deciding organ against remuneration.decidedBy', () => {
  it('the assembly deciding as the statute says is fine; a board meeting deciding its own pay warns and the minutes carry it', async () => {
    const { deps, ctx } = setupGovernance(RECORDING);
    await withRules(deps, ctx, { board: { remuneration: { statuteReference: '§ 8 Abs. 3', decidedBy: organOf(deps, 'assembly') } } });
    const mv = await session(deps, ctx, { items: ['remuneration'], voters: 2 });
    const fine = unwrap(await saveResolution(deps, ctx, { agendaItemId: mv.items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true, excluded: [], details: remuneration(deps, null) }));
    expect(fine.warnings).not.toContain('remunerationWrongOrgan');
    const bm = await session(deps, ctx, { kind: 'board', items: ['remuneration'], heldOn: '2026-09-06' });
    const own = unwrap(await saveResolution(deps, ctx, { agendaItemId: bm.items[0]!.id, text: 'x', votedAt: '19:30', unanimous: true, details: { ...remuneration(deps, null), decidedByOrganId: organOf(deps, 'board') } }));
    expect(own.warnings).toContain('remunerationWrongOrgan');
    // § 34 BGB: die Inhaberin der Kasse ist vom Stimmrecht ausgeschlossen (vorhandener Vorschlag W-5).
    expect(own.excluded.map((e) => e.reason)).toEqual(['remuneration']);
    const { meetingDefectsInternal } = await import('../src/minutes/defects');
    expect(meetingDefectsInternal(deps.db, deps, bm.meeting.id)).toContainEqual({ kind: 'remunerationWrongOrgan', agendaItemId: bm.items[0]!.id, reason: null });
  });

  it('the condition is shared with the form: only organs with the rule count, any of them naming the deciding organ suffices', () => {
    const deciders = { B: 'A' };
    expect(remunerationWrongOrgan(deciders, 'B', ['B', 'B'])).toBe(true);
    expect(remunerationWrongOrgan(deciders, 'A', ['A', 'B'])).toBe(false);
    expect(remunerationWrongOrgan({}, 'B', ['B'])).toBe(false);
  });
});
