import { unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { createProject } from '@kompass/module-projects';
import { describe, expect, it } from 'vitest';
import { issueConfirmation, voidConfirmation } from '../src/donations/confirmations';
import { confirmationContactLock, confirmationEntryLock } from '../src/donations/locks';
import { requestAllocationCorrection } from '../src/ledger/corrections';
import { reverseEntry } from '../src/ledger/reverse';
import { ENTRY_LOCKS, registerEntryLocks } from '../src/locks';
import '../src/manifest';
import { donationFixture, err } from './donation-fixture';

describe('confirmation locks', () => {
  it('the manifest registers both locks once, however often it is asked', () => {
    expect(ENTRY_LOCKS).toContain(confirmationEntryLock);
    expect(ENTRY_LOCKS).toContain(confirmationContactLock);
    const before = ENTRY_LOCKS.length;
    registerEntryLocks([confirmationEntryLock, confirmationContactLock]);
    expect(ENTRY_LOCKS.length).toBe(before);
  });

  it('locks reversal and contact correction while a confirmation is valid, and releases both after voiding', async () => {
    const f = await donationFixture();
    const { entry, line } = await f.donate();
    const confirmation = unwrap(await issueConfirmation(f.deps, f.ctx, { lineIds: [line.id] }));

    expect(confirmationEntryLock(f.deps.db, entry.id)).toEqual({ scope: 'entry', reason: `Bestätigung ${confirmation.documentNumber} — zuerst zurücknehmen.` });
    expect(confirmationContactLock(f.deps.db, entry.id)).toEqual({ scope: 'contact', reason: `Bestätigung ${confirmation.documentNumber} — zuerst zurücknehmen.` });

    const reversal = err(await reverseEntry(f.deps, f.ctx, { id: entry.id }));
    expect(reversal).toMatchObject({ type: 'conflict', code: 'entryLocked', message: expect.stringContaining(confirmation.documentNumber) });
    const correction = err(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsche Spenderin' }));
    expect(correction).toMatchObject({ type: 'conflict', code: 'contactLocked', message: expect.stringContaining(confirmation.documentNumber) });
    // Projekt, Zweck und Ausland bleiben korrigierbar.
    const project = unwrap(await createProject(f.deps, ctxWith(['projects.manage'], f.userId), { slug: 'testprojekt-lock', name: { de: 'Testprojekt' }, type: 'ongoing' as const, summary: { de: '' }, body: { de: '' } }));
    expect(unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { projectId: project.id }, note: 'Projekt nachgetragen' })).applied).toBe(true);

    unwrap(await voidConfirmation(f.deps, f.ctx, { id: confirmation.id, note: 'Spenderin falsch', alreadySent: false }));
    expect(confirmationEntryLock(f.deps.db, entry.id)).toBeNull();
    expect(confirmationContactLock(f.deps.db, entry.id)).toBeNull();
    expect(unwrap(await requestAllocationCorrection(f.deps, f.ctx, { lineId: line.id, changes: { contactId: f.rightDonor.id }, note: 'Falsche Spenderin' })).applied).toBe(true);
    expect(unwrap(await reverseEntry(f.deps, f.ctx, { id: entry.id })).reversal.reversesEntryId).toBe(entry.id);
  });

  it('an entry without confirmation is not locked', async () => {
    const f = await donationFixture();
    const { entry } = await f.donate();
    expect(confirmationEntryLock(f.deps.db, entry.id)).toBeNull();
    expect(confirmationContactLock(f.deps.db, entry.id)).toBeNull();
  });
});
