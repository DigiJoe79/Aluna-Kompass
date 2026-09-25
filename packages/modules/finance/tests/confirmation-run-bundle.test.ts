import { schema, unwrap, type PdfTools } from '@kompass/core';
import { ctxWith, fakeDocumentEngine, fakePdfTools } from '@kompass/core/testing';
import { createContact, updateContact } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { issueConfirmation, readConfirmationCopy, voidConfirmation } from '../src/donations/confirmations';
import { continueConfirmationRun, readRunBundle, startConfirmationRun } from '../src/donations/runs';
import { donationFixture, err, type DonationFixture } from './donation-fixture';

/**
 * Sammel-PDFs des Serienlaufs (F6b Task 4, Annahme 7): die Exemplare der
 * ausgestellten Posten, getrennt nach maschinell und zum Unterschreiben, in
 * der Reihenfolge der Namen, über `deps.pdf.merge`. Nichts wird abgelegt,
 * nichts protokolliert. Heute ist der 2026-03-20.
 */
const person = async (f: DonationFixture, firstName: string, lastName: string) =>
  unwrap(await createContact(f.deps, f.manage, { kind: 'person', firstName, lastName, street: 'Probeweg 3', postalCode: '11111', city: 'Probestadt' }));

/**
 * Zenzi, Anna, Erika mit Geld (maschinell), Erika zusätzlich mit einer
 * Aufwandsspende (zum Unterschreiben). Jedes Exemplar trägt eine laufende
 * Nummer der Engine, damit die Reihenfolge sichtbar wird. Zenzis Posten wird
 * vorab einzeln ausgestellt (wie ein schnellerer zweiter Aufruf), und Anna
 * heißt nach dem Start anders — die Reihenfolge der Ausstellung und die der
 * heutigen Namen sind damit beide nicht die des Laufs.
 */
async function issuedRun(f: DonationFixture) {
  const pdf = fakePdfTools();
  f.deps.pdf = pdf;
  let rendered = 0;
  f.deps.documents = fakeDocumentEngine({ render: async () => ({ bytes: new TextEncoder().encode(`%PDF-fake exemplar ${++rendered}`), pages: 1 }) });
  const zenzi = await person(f, 'Zenzi', 'Zett');
  const anna = await person(f, 'Anna', 'Alpha');
  await f.donate({ date: '2026-01-10', cents: 3000, contactId: zenzi.id });
  await f.donate({ date: '2026-01-11', cents: 2000, contactId: anna.id });
  await f.donate({ date: '2026-01-12', cents: 1000 });
  await f.waive({ date: '2026-01-20', cents: 4200 });
  const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026 }));
  const zenziItem = run.items.find((i) => i.contactId === zenzi.id)!;
  unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: zenziItem.lineIds, issuedOn: run.startedOn, kind: 'collective', periodFrom: '2026-01-01', periodTo: run.startedOn }));
  unwrap(await updateContact(f.deps, f.manage, { id: anna.id, firstName: 'Zora' }));
  const done = unwrap(await continueConfirmationRun(f.deps, f.ctx, { runId: run.id }));
  return { pdf, run: done, zenzi, anna };
}

const reader = (f: DonationFixture) => ctxWith(['finance.read'], f.userId);
const copyOf = async (f: DonationFixture, id: string) => unwrap(await readConfirmationCopy(f.deps, reader(f), { id })).bytes;
const auditCount = (f: DonationFixture) => f.deps.db.select().from(schema.auditLog).all().length;

describe('readRunBundle', () => {
  it('merges the copies of the issued machine items in contact order', async () => {
    const f = await donationFixture({ machine: true });
    const { pdf, run, zenzi, anna } = await issuedRun(f);
    const machineItems = run.items.filter((i) => i.kind === 'collective');
    const idOf = (contactId: string) => machineItems.find((i) => i.contactId === contactId)!.confirmationId!;
    const expected = [await copyOf(f, idOf(anna.id)), await copyOf(f, idOf(f.erika.id)), await copyOf(f, idOf(zenzi.id))];
    const before = auditCount(f);

    const bundle = unwrap(await readRunBundle(f.deps, reader(f), { runId: run.id, part: 'machine' }));
    expect(bundle).toEqual({ bytes: new TextEncoder().encode('%PDF-FAKE 3'), filename: 'Zuwendungsbestaetigungen-2026-maschinell.pdf', count: 3 });
    expect(pdf.calls).toHaveLength(1);
    expect(pdf.calls[0]).toEqual(expected);
    // Nichts abgelegt, nichts protokolliert.
    expect(auditCount(f)).toBe(before);
  });

  it('separates signature items', async () => {
    const f = await donationFixture({ machine: true });
    const { pdf, run } = await issuedRun(f);
    const waiver = run.items.find((i) => i.kind === 'collectiveWaiver')!;

    const bundle = unwrap(await readRunBundle(f.deps, reader(f), { runId: run.id, part: 'signature' }));
    expect(bundle).toMatchObject({ filename: 'Zuwendungsbestaetigungen-2026-zum-unterschreiben.pdf', count: 1 });
    expect(pdf.calls[0]).toEqual([await copyOf(f, waiver.confirmationId!)]);
  });

  it('splits by the issued confirmation, not by the snapshot, and leaves voided confirmations out', async () => {
    // Ohne vollständiges maschinelles Verfahren tragen alle Bestätigungen ein Unterschriftsfeld.
    const f = await donationFixture({ machine: false });
    const { pdf, run, anna } = await issuedRun(f);
    expect(err(await readRunBundle(f.deps, reader(f), { runId: run.id, part: 'machine' }))).toMatchObject({ type: 'conflict', code: 'bundleEmpty' });

    const annaItem = run.items.find((i) => i.contactId === anna.id)!;
    unwrap(await voidConfirmation(f.deps, f.ctx, { id: annaItem.confirmationId!, note: 'Anschrift falsch', alreadySent: false }));
    const bundle = unwrap(await readRunBundle(f.deps, reader(f), { runId: run.id, part: 'signature' }));
    expect(bundle.count).toBe(3);
    expect(pdf.calls[0]).not.toContainEqual(await copyOf(f, annaItem.confirmationId!));
  });

  it('answers with a remedy when pdfunite is missing', async () => {
    const f = await donationFixture({ machine: true });
    const { run } = await issuedRun(f);
    const missing: PdfTools = {
      merge: async () => {
        const error = new Error('pdfunite is not installed');
        error.name = 'ToolMissingError';
        throw error;
      },
    };
    f.deps.pdf = missing;
    const failure = err(await readRunBundle(f.deps, reader(f), { runId: run.id, part: 'machine' }));
    expect(failure).toMatchObject({ type: 'conflict', code: 'bundleToolsMissing' });
    expect((failure as { message: string }).message).toContain('pdfunite');

    // Ein anderer Fehler ist technisch und wirft weiter.
    f.deps.pdf = { merge: async () => { throw new Error('disk full'); } };
    await expect(readRunBundle(f.deps, reader(f), { runId: run.id, part: 'machine' })).rejects.toThrow('disk full');
  });

  it('is empty for a run without issued items', async () => {
    const f = await donationFixture({ machine: true });
    const pdf = fakePdfTools();
    f.deps.pdf = pdf;
    await f.donate({ date: '2026-01-12', cents: 1000 });
    const run = unwrap(await startConfirmationRun(f.deps, f.ctx, { year: 2026 }));
    for (const part of ['machine', 'signature'] as const) {
      expect(err(await readRunBundle(f.deps, reader(f), { runId: run.id, part }))).toMatchObject({ type: 'conflict', code: 'bundleEmpty' });
    }
    expect(pdf.calls).toHaveLength(0);
  });

  it('forbidden/validation/notFound', async () => {
    const f = await donationFixture({ machine: true });
    const { run } = await issuedRun(f);
    expect(err(await readRunBundle(f.deps, ctxWith(['finance.overview'], f.userId), { runId: run.id, part: 'machine' }))).toEqual({ type: 'forbidden', permission: 'finance.read' });
    expect(err(await readRunBundle(f.deps, reader(f), { runId: run.id, part: 'all' }))).toMatchObject({ type: 'validation' });
    expect(err(await readRunBundle(f.deps, reader(f), { runId: '' , part: 'machine' }))).toMatchObject({ type: 'validation' });
    expect(err(await readRunBundle(f.deps, reader(f), { runId: 'nope', part: 'machine' }))).toMatchObject({ type: 'notFound' });
  });
});
