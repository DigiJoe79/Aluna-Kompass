// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command, CommandItem, CommandList } from '@/components/ui/command';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
afterEach(cleanup);

// 01 B17: cmdk setzt `data-selected="false"` an jede nicht gewählte Zeile; `data-selected:` (nur Anwesenheit) tönte
// deshalb jede Zeile, als läge die Maus darauf. Die Klassen dürfen nur auf `data-selected="true"` antworten.
describe('CommandItem', () => {
  it('tönt nur die gewählte Zeile', () => {
    globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    Element.prototype.scrollIntoView ??= () => {};
    const { container } = render(
      <Command>
        <CommandList>
          <CommandItem value="a">A</CommandItem>
          <CommandItem value="b">B</CommandItem>
        </CommandList>
      </Command>,
    );
    const items = [...container.querySelectorAll('[data-slot="command-item"]')];
    expect(items.map((el) => el.getAttribute('data-selected'))).toEqual(['true', 'false']);
    for (const el of items) {
      const tokens = el.className.split(/\s+/);
      expect(tokens.filter((c) => /(^|:)data-selected:|group-data-selected\//.test(c))).toEqual([]);
    }
  });
});
