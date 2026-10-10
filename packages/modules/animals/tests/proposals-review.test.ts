import { unwrap } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { acceptProposal, getProposal, listAnimalOrigins, listAnimals, listProposals, rejectProposal, stageProposalImage, submitProposal, updateAnimal } from '../src';
import { animal, createInput, manager, png, proposalDeps, source, SOURCE_A, SOURCE_B } from './proposal-fixture';

/** Eine Änderung an Luna (Quelle A, mit Zweifelsfall), danach ein neuer Hund (Quelle B), danach ändert ein Mensch Lunas Kurztext. */
async function inbox() {
  const d = await proposalDeps();
  const a = await animal(d);
  const u = unwrap(await submitProposal(d, source(), { kind: 'update', sourceKey: 'u', animalId: a.id, values: { summary: { de: 'V.' }, sizeCm: 55 }, hints: [{ field: 'sizeCm', quote: 'kniehoch', suggestion: '45' }] })).proposal;
  d.clock.advance(60_000);
  unwrap(await submitProposal(d, source(SOURCE_B), createInput({ sourceKey: 'c', externalRef: 'C', values: { ...createInput().values, summary: { de: '' } } })));
  d.clock.advance(60_000);
  unwrap(await updateAnimal(d, manager, { id: a.id, summary: { de: 'Hand.' } }));
  return { d, a, u };
}

describe('reading proposals for review', () => {
  it('lists open proposals oldest first with fields, counts, conflict, hints and source name; counters are unfiltered', async () => {
    const { d } = await inbox();
    const list = unwrap(await listProposals(d, manager, { kind: 'create' }));
    expect(list.open).toEqual({ count: 2, oldestAt: '2026-09-05T08:00:00.000Z', withConflict: 1 });
    expect(list.proposals).toMatchObject([{ kind: 'create', name: 'Lotte', sourceName: 'Tierbörse Süd', missing: ['primaryPhoto', 'summary'] }]);
    const all = unwrap(await listProposals(d, manager, {}));
    expect(all.proposals[0]).toMatchObject({ kind: 'update', name: 'Luna', fields: ['sizeCm', 'summary'], conflictCount: 1, hintCount: 1, sourceName: 'Tierbörse Nord' });
    expect(all.sources).toEqual([{ userId: SOURCE_A, name: 'Tierbörse Nord' }, { userId: SOURCE_B, name: 'Tierbörse Süd' }]);
  });

  it('a new animal carries the cover image of the proposal for the inbox; without one the first, none after the decision', async () => {
    const d = await proposalDeps();
    const first = unwrap(await stageProposalImage(d, source(), { originalName: 'a.png', bytes: await png(1) })).imageId;
    const cover = unwrap(await stageProposalImage(d, source(), { originalName: 'b.png', bytes: await png(2) })).imageId;
    const other = unwrap(await stageProposalImage(d, source(), { originalName: 'c.png', bytes: await png(3) })).imageId;
    unwrap(await submitProposal(d, source(), createInput({ sourceKey: 'p', externalRef: 'P', photos: [{ imageId: first, isPrimary: false }, { imageId: cover, isPrimary: true }] })));
    const plain = unwrap(await submitProposal(d, source(), createInput({ sourceKey: 'q', externalRef: 'Q', photos: [{ imageId: other, isPrimary: false }] }))).proposal;
    unwrap(await submitProposal(d, source(), createInput({ sourceKey: 'r', externalRef: 'R' })));
    const rows = unwrap(await listProposals(d, manager, {})).proposals;
    expect(rows.map((p) => [p.primaryAssetId, p.primaryImageId])).toEqual([[null, cover], [null, other], [null, null]]);
    unwrap(await rejectProposal(d, manager, { id: plain.id }));
    expect(unwrap(await listProposals(d, manager, { state: 'decided' })).proposals[0]).toMatchObject({ primaryImageId: null });
  });

  it('names the proposed name beside today\'s name, for a match in the inbox line (Board 1a)', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    unwrap(await submitProposal(d, source(), { kind: 'sameAs', sourceKey: 's', animalId: a.id, externalRef: 'S', reason: 'Fotos gleich', values: { name: 'Lunah' } }));
    expect(unwrap(await listProposals(d, manager, {})).proposals[0]).toMatchObject({ kind: 'sameAs', name: 'Luna', proposedName: 'Lunah' });
  });

  it('shows decided proposals with the decider from the audit log', async () => {
    const { d, u } = await inbox();
    unwrap(await rejectProposal(d, manager, { id: u.id, note: 'Nein.' }));
    const decided = unwrap(await listProposals(d, manager, { state: 'decided' }));
    expect(decided.proposals).toMatchObject([{ id: u.id, state: 'rejected', decidedByUserId: 'USER-TEST', decidedByName: 'Petra Prüferin', decisionNote: 'Nein.' }]);
    expect(decided.open.count).toBe(1);
    expect(unwrap(await listProposals(d, manager, {})).proposals.map((p) => p.kind)).toEqual(['create']);
  });

  it('the review names who changed a conflicting field and when, and the baseline', async () => {
    const { d, u } = await inbox();
    const review = unwrap(await getProposal(d, manager, u.id));
    expect(review.fields.find((f) => f.field === 'summary')).toMatchObject({ current: { de: 'Hand.' }, proposed: { de: 'V.' }, baseline: { de: 'Ruhig.' }, conflict: { changedBy: { userId: 'USER-TEST', userName: 'Petra Prüferin', at: '2026-09-05T08:02:00.000Z' } } });
    expect(review.fields.find((f) => f.field === 'sizeCm')).toMatchObject({ current: 40, proposed: 55, conflict: null, hints: [{ field: 'sizeCm', quote: 'kniehoch' }] });
    expect(review).toMatchObject({ animal: { name: 'Luna' }, photos: null, photoConflict: null, generalHints: [], proposal: { sourceKey: 'u', conflictCount: 1 } });
  });

  it('a new animal names animals with the same name; a source may not read the inbox', async () => {
    const d = await proposalDeps();
    const a = await animal(d);
    const p = unwrap(await submitProposal(d, source(), createInput({ values: { ...createInput().values, name: 'luna' } }))).proposal;
    const review = unwrap(await getProposal(d, manager, p.id));
    expect(review).toMatchObject({ animal: null, sameNameAnimals: [{ id: a.id, name: 'Luna' }], generalHints: [{ title: 'Zaun im Titelbild' }] });
    expect(review.fields.find((f) => f.field === 'birthText')).toMatchObject({ current: null, baseline: null, conflict: null, hints: [{ quote: 'ca. Frühjahr 2021' }] });
    expect(await listProposals(d, source(), {})).toMatchObject({ ok: false, error: { type: 'forbidden' } });
    expect(await getProposal(d, source(), p.id)).toMatchObject({ ok: false, error: { type: 'forbidden' } });
  });

  it('animals_list finds an animal by origin, and listAnimalOrigins names the source', async () => {
    const d = await proposalDeps();
    await animal(d);
    const p = unwrap(await submitProposal(d, source(), createInput())).proposal;
    const { animalId } = unwrap(await acceptProposal(d, manager, { id: p.id }));
    expect(unwrap(await listAnimals(d, source(), { origin: { externalRef: 'HB-100' } })).animals.map((x) => x.id)).toEqual([animalId]);
    expect(unwrap(await listAnimals(d, source(), { origin: { externalRef: 'HB-100', sourceUserId: SOURCE_B } })).animals).toEqual([]);
    expect(unwrap(await listAnimalOrigins(d, source(), animalId!))).toMatchObject([{ sourceUserId: SOURCE_A, sourceName: 'Tierbörse Nord', externalRef: 'HB-100', externalUrl: 'https://quelle.example/hunde/100' }]);
  });
});
