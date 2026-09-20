import { coreModule, unwrap } from '@kompass/core';
import { createTestDeps, ctxWith } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';
import { contactsRecordLabels } from '../src/record-labels';
import { createContact } from '../src/service';

describe('contactsRecordLabels', () => {
  const setup = () => {
    const deps = createTestDeps({ manifests: [coreModule, contactsModule] });
    const manage = ctxWith(['contacts.view', 'contacts.manage']);
    return { deps, manage };
  };

  it('answers only for contacts', () => {
    const { deps } = setup();
    expect(contactsRecordLabels(deps, ctxWith(['contacts.view']), 'animal', 'A1')).toBeNull();
  });

  it('labels a contact for a reader, and a neutral label for anyone else', async () => {
    const { deps, manage } = setup();
    const contact = unwrap(await createContact(deps, manage, { kind: 'person', firstName: 'Anna', lastName: 'Berger' }));
    expect(contactsRecordLabels(deps, ctxWith(['contacts.view']), 'contact', contact.id)).toEqual({ label: 'Anna Berger', href: `/contacts/${contact.id}`, state: 'ok' });
    expect(contactsRecordLabels(deps, ctxWith([]), 'contact', contact.id)).toEqual({ label: 'Kontakt (kein Zugriff)', href: null, state: 'forbidden' });
  });

  it('says missing for an unknown id', () => {
    const { deps } = setup();
    expect(contactsRecordLabels(deps, ctxWith(['contacts.view']), 'contact', 'NOPE')).toEqual({ label: '', href: null, state: 'missing' });
  });
});
