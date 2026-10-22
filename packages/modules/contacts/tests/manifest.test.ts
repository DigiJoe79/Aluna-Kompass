import { describe, expect, it } from 'vitest';
import { contactsModule } from '../src/manifest';

describe('contacts manifest', () => {
  it('declares the user link as not deletable — it is ended, never removed', () => {
    expect(contactsModule.deletionRules).toContainEqual(expect.objectContaining({ entity: 'contactUserLink', deletable: false }));
  });
});
