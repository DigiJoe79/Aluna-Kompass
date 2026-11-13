// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import messages from '../messages/de.json';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/app/(shell)/contacts/search-action', () => ({ searchContactsAction: vi.fn(async () => []) }));
const { SplitRow } = await import('@/components/finance/split-row');
afterEach(cleanup);

const categories = [{ id: 'program', name: 'Projektkosten', direction: 'expense' as const, sphere: 'ideal' }];
const options = [{ id: 'A', name: 'Ausland' }, { id: 'B', name: 'Inland' }];

/**
 * Befund B2 (0.5.2): „Im Ausland verwendet“ belegt der Dienst aus Zweck oder Projekt vor. Ändert jemand Projekt oder
 * Zweck, wird ein geladener oder gesetzter Wert wieder leer, damit die Vorbelegung zum neuen Ziel passt.
 */
describe('Aufteilungszeile: abroad follows project and purpose', () => {
  const show = () => {
    const onChange = vi.fn();
    const view = render(
      <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
        <SplitRow value={{ key: 'r1', categoryId: 'program', amountText: '10,00', contactId: null, projectId: 'A', purposeId: 'A', abroad: true, addsToAssets: false }} onChange={onChange} onRemove={vi.fn()} onDuplicate={vi.fn()} onRestHere={vi.fn()} onSplitEvenly={vi.fn()} position={1} restCents={null} categories={categories} purposes={options} projects={options} taxCodeOptions={[]} showTax={false} />
      </NextIntlClientProvider>,
    );
    return { onChange, container: view.container };
  };

  it('empties abroad when the project or the purpose changes', () => {
    const { onChange, container } = show();
    fireEvent.change(container.querySelector('#r1-project')!, { target: { value: 'B' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'B', abroad: null }));
    fireEvent.change(container.querySelector('#r1-purpose')!, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ purposeId: null, abroad: null }));
  });
});
