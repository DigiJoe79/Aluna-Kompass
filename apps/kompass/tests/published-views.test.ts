import { coreModule } from '@kompass/core';
import { describe, expect, it } from 'vitest';
import { installedModules } from '@/modules';

/**
 * „Nicht publiziert“ (Plan C) nennt jede geänderte Zeile einer Sicht mit Namen und Link und erkennt sie über eine
 * Slug-Änderung hinweg — beides über `editLink`. Ohne ihn stünde die Zeile als „#3“ ohne Link da.
 */
describe('published views', () => {
  it('every view of this installation has editLink', () => {
    const missing = [coreModule, ...installedModules].flatMap((m) => (m.publishedViews ?? []).filter((v) => !v.editLink).map((v) => `${m.key}.${v.name}`));
    expect(missing).toEqual([]);
  });
});
