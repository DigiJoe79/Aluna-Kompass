import { describe, expect, it } from 'vitest';
import messages from '../messages/de.json';
import { themeDisplayName } from '@/lib/theme-name';

/** Runde 3, 152/179: Das mitgelieferte Theme heißt in der Oberfläche „Vorgabe“ (MUSTER § Begriffe), nicht „Default“. */
describe('themeDisplayName', () => {
  it('names the shipped theme „Vorgabe“ and keeps every other name', () => {
    expect(messages.themes.defaultName).toBe('Vorgabe');
    expect(themeDisplayName({ key: 'default', name: 'Default' }, messages.themes.defaultName)).toBe('Vorgabe');
    expect(themeDisplayName({ key: 'vereinsfarben', name: 'Vereinsfarben' }, messages.themes.defaultName)).toBe('Vereinsfarben');
  });
});
