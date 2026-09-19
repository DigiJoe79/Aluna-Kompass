import { createTestDeps, insertUser } from '@kompass/core/testing';
import { describe, expect, it } from 'vitest';
import { activeUserChoices, userNamesFor } from '../src/users/names';

describe('userNamesFor', () => {
  it('nennt auch deaktivierte Nutzer — eine alte Notiz behält ihren Autor', () => {
    const deps = createTestDeps();
    insertUser(deps, { id: 'U-GONE', name: 'Ehemalige Kassenwartin', email: 'weg@example.org', isActive: false });
    expect(userNamesFor(deps, ['U-GONE'])).toEqual(new Map([['U-GONE', 'Ehemalige Kassenwartin']]));
  });
});

describe('activeUserChoices', () => {
  it('bietet nur aktive Nutzer zur Auswahl an, nach Namen sortiert', () => {
    const deps = createTestDeps();
    insertUser(deps, { id: 'U-B', name: 'Bernd', email: 'b@example.org' });
    insertUser(deps, { id: 'U-A', name: 'Anna', email: 'a@example.org' });
    insertUser(deps, { id: 'U-X', name: 'Xaver', email: 'x@example.org', isActive: false });
    expect(activeUserChoices(deps)).toEqual([{ id: 'U-A', name: 'Anna' }, { id: 'U-B', name: 'Bernd' }]);
  });
});
