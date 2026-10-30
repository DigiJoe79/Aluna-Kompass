import { newId, unwrap } from '@kompass/core';
import { ctxWith } from '@kompass/core/testing';
import { addContactRole, contactUserLinks, createContact, endContactRole } from '@kompass/module-contacts';
import { describe, expect, it } from 'vitest';
import { representativeOfUserInternal, representativesInternal } from '../src/ledger/representatives';
import { setupFinance } from './helpers';

/** Wer den Verein nach § 26 BGB vertritt (J1 Task 2): laufende Rolle Vorstandsmitglied mit Merkmal, Amt aus der Notiz. */
describe('representativesInternal', () => {
  it('nennt nur laufende, vertretende Vorstandsmitglieder mit Amt und verknüpftem Konto', async () => {
    const { deps, userId } = setupFinance();
    const manage = ctxWith(['contacts.view', 'contacts.manage']);
    const zora = unwrap(await createContact(deps, manage, { kind: 'person', firstName: 'Zora', lastName: 'Beispiel' }));
    const anna = unwrap(await createContact(deps, manage, { kind: 'person', firstName: 'Anna', lastName: 'Muster' }));
    const bert = unwrap(await createContact(deps, manage, { kind: 'person', firstName: 'Bert', lastName: 'Beisitz' }));
    const gone = unwrap(await createContact(deps, manage, { kind: 'person', firstName: 'Gerd', lastName: 'Vorher' }));
    await addContactRole(deps, manage, { id: zora.id, role: 'board-member', since: '2026-01-01', note: 'Schatzmeisterin', representsAssociation: true });
    await addContactRole(deps, manage, { id: anna.id, role: 'board-member', since: '2026-01-01', note: 'Vorsitz', representsAssociation: true });
    await addContactRole(deps, manage, { id: bert.id, role: 'board-member', since: '2026-01-01', note: 'Beisitz' });
    const goneRole = unwrap(await addContactRole(deps, manage, { id: gone.id, role: 'board-member', since: '2025-01-01', representsAssociation: true })).roles[0]!.id;
    await endContactRole(deps, manage, { roleId: goneRole, until: '2026-06-30' });
    deps.db.insert(contactUserLinks).values({ id: newId(), userId, contactId: zora.id, linkedAt: '2026-01-02T00:00:00.000Z', linkedByUserId: userId }).run();

    const list = representativesInternal(deps.db, '2026-07-01');
    expect(list.map((r) => [r.name, r.office, r.userId])).toEqual([
      ['Anna Muster', 'Vorsitz', null],
      ['Zora Beispiel', 'Schatzmeisterin', userId],
    ]);
    expect(representativesInternal(deps.db, '2026-06-30').map((r) => r.name)).toContain('Gerd Vorher');
    expect(representativesInternal(deps.db, '2025-12-31').map((r) => r.name)).toEqual(['Gerd Vorher']);
    expect(representativeOfUserInternal(deps.db, userId, '2026-07-01')).toMatchObject({ contactId: zora.id, office: 'Schatzmeisterin' });
    expect(representativeOfUserInternal(deps.db, 'NOBODY', '2026-07-01')).toBeNull();
  });
});
