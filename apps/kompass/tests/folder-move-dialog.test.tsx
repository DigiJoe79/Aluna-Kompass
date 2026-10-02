// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderField } from '@/components/folder-tree/folder-field';
import { FolderMoveDialog, type FolderMoveDialogProps } from '@/components/folder-tree/folder-move-dialog';
import type { ActionState } from '@/lib/actions';
import messages from '../messages/de.json';

function Intl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
      {children}
    </NextIntlClientProvider>
  );
}

const folders = [
  { path: 'Behörden', count: 0 },
  { path: 'Behörden/Amtsgericht', count: 3 },
  { path: 'Behörden/Amtsgericht/Vereinsregister 2026', count: 6 },
  { path: 'Behörden/Finanzamt', count: 9 },
  { path: 'Finanzen', count: 0 },
  { path: 'Finanzen/Mittelverwendung', count: 3 },
  // „Archiv“ gibt es nur als Weg.
  { path: 'Archiv/2025', count: 1 },
  { path: 'Verträge', count: 6 },
];

const ok: ActionState = { status: 'success' };

function renderDialog(props: Partial<FolderMoveDialogProps> = {}) {
  const onConfirm = vi.fn(async (_target: string | null): Promise<ActionState> => ok);
  const onOpenChange = vi.fn();
  const view = render(
    <FolderMoveDialog
      open
      onOpenChange={onOpenChange}
      subject={{ kind: 'folder', path: 'Behörden/Amtsgericht', total: 9 }}
      folders={folders}
      rootLabel="Oberste Ebene"
      onConfirm={onConfirm}
      {...props}
    />,
    { wrapper: Intl }
  );
  return { ...view, onConfirm: props.onConfirm ?? onConfirm, onOpenChange: props.onOpenChange ?? onOpenChange };
}

const row = (name: RegExp) => screen.getByRole('treeitem', { name });
const confirmButton = () => within(screen.getByRole('dialog')).getAllByRole('button').find((b) => b.dataset.confirm !== undefined)!;
const describedBy = (el: Element) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

async function press(key: string, target: Element = document.activeElement ?? document.body) {
  await act(async () => {
    fireEvent.keyDown(target, { key, code: key });
    fireEvent.keyUp(document, { key, code: key });
    await new Promise((r) => setTimeout(r, 30));
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('FolderMoveDialog, for a folder', () => {
  it('names the folder in the title and blocks its own subtree with the reason', async () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: '„Amtsgericht“ verschieben nach…' })).toBeTruthy();
    await screen.findAllByRole('treeitem');
    const self = row(/^Amtsgericht,/);
    expect(self.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(self)).toContain('Ordner kann nicht in sich selbst');
    const child = row(/^Vereinsregister 2026,/);
    expect(child.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(child)).toContain('Ordner kann nicht in sich selbst');
    expect(row(/^Finanzen,/).getAttribute('aria-disabled')).toBeNull();
  });

  it('marks the current place „liegt hier“, in the name too, and does not let it be picked', async () => {
    renderDialog();
    await screen.findAllByRole('treeitem');
    const here = screen.getByRole('treeitem', { name: 'Behörden, 18 Dokumente, davon 0 direkt, liegt hier' });
    expect(here.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(here)).toContain('Liegt schon hier');
    fireEvent.click(here);
    expect(confirmButton().textContent).toBe('Verschieben');
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers „Oberste Ebene“ and moves there', async () => {
    const { onConfirm } = renderDialog();
    await screen.findAllByRole('treeitem');
    const root = screen.getByRole('button', { name: 'Oberste Ebene' });
    expect(root.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(root);
    expect(root.getAttribute('aria-pressed')).toBe('true');
    expect(confirmButton().textContent).toBe('Nach „Oberste Ebene“ verschieben');
    await act(async () => fireEvent.click(confirmButton()));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it('blocks „Oberste Ebene“ for a top-level folder, because it lies there', async () => {
    renderDialog({ subject: { kind: 'folder', path: 'Verträge', total: 6 } });
    await screen.findAllByRole('treeitem');
    const root = screen.getByRole('button', { name: 'Oberste Ebene, liegt hier' });
    expect(root.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(root);
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens with the path to the current place expanded and the focus on it', async () => {
    renderDialog();
    await screen.findAllByRole('treeitem');
    const here = row(/^Behörden,/);
    expect(here.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(here));
  });

  it('does not let a folder that exists only as a path be picked', async () => {
    renderDialog();
    await screen.findAllByRole('treeitem');
    const archive = row(/^Archiv,/);
    expect(archive.getAttribute('aria-disabled')).toBe('true');
    expect(describedBy(archive)).toContain('nur als Weg');
  });
});

describe('FolderMoveDialog, for documents', () => {
  const one = { kind: 'documents' as const, ids: ['d1'], title: 'Registerauszug 2026', sources: { 'Behörden/Amtsgericht/Vereinsregister 2026': 1 } };
  const five = {
    kind: 'documents' as const,
    ids: ['d1', 'd2', 'd3', 'd4', 'd5'],
    title: '',
    sources: { 'Behörden/Amtsgericht/Vereinsregister 2026': 3, 'Behörden/Finanzamt': 2 },
  };

  it('names the document, offers „Eingangskorb“ and focuses the folder it lies in, with its path open', async () => {
    renderDialog({ subject: one, rootLabel: 'Eingangskorb' });
    expect(screen.getByRole('dialog', { name: '„Registerauszug 2026“ verschieben nach…' })).toBeTruthy();
    await screen.findAllByRole('treeitem');
    expect(screen.getByRole('button', { name: 'Eingangskorb' })).toBeTruthy();
    const here = screen.getByRole('treeitem', { name: 'Vereinsregister 2026, 6 Dokumente, liegt hier' });
    expect(here.getAttribute('aria-disabled')).toBe('true');
    expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(here));
  });

  it('counts five documents from two folders: „3 liegen hier“ and still pickable', async () => {
    const { onConfirm } = renderDialog({ subject: five, rootLabel: 'Eingangskorb' });
    expect(screen.getByRole('dialog', { name: '5 Dokumente verschieben nach…' })).toBeTruthy();
    await screen.findAllByRole('treeitem');
    const three = screen.getByRole('treeitem', { name: 'Vereinsregister 2026, 6 Dokumente, 3 liegen hier' });
    expect(three.getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByRole('treeitem', { name: 'Finanzamt, 9 Dokumente, 2 liegen hier' })).toBeTruthy();
    fireEvent.click(three);
    expect(three.getAttribute('aria-selected')).toBe('true');
    expect(confirmButton().textContent).toBe('Nach „Vereinsregister 2026“ verschieben');
    await act(async () => fireEvent.click(confirmButton()));
    expect(onConfirm).toHaveBeenCalledWith('Behörden/Amtsgericht/Vereinsregister 2026');
  });

  it('calls the button „Verschieben“ and disables it until a target is picked', async () => {
    renderDialog({ subject: one, rootLabel: 'Eingangskorb' });
    await screen.findAllByRole('treeitem');
    expect(confirmButton().textContent).toBe('Verschieben');
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(row(/^Finanzen,/));
    expect(confirmButton().textContent).toBe('Nach „Finanzen“ verschieben');
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);
    expect(row(/^Finanzen,/).getAttribute('aria-selected')).toBe('true');
    expect(row(/^Finanzen,/).getAttribute('aria-current')).toBeNull();
  });

  it('picks with Enter; the rows are no links and have no „…“', async () => {
    renderDialog({ subject: one, rootLabel: 'Eingangskorb' });
    await screen.findAllByRole('treeitem');
    const target = row(/^Verträge,/);
    expect(target.querySelector('a')).toBeNull();
    expect(document.querySelector('[data-row-menu]')).toBeNull();
    expect(target.getAttribute('draggable')).not.toBe('true');
    act(() => target.focus());
    await press('Enter', target);
    expect(confirmButton().textContent).toBe('Nach „Verträge“ verschieben');
  });

  it('keeps the dialog open with the reason when moving fails, and closes on success', async () => {
    const onConfirm = vi.fn(async (): Promise<ActionState> => ({ status: 'error', message: 'Nicht verschoben.', fieldErrors: {}, detail: 'In Finanzen gibt es das schon.' }));
    const { onOpenChange } = renderDialog({ subject: one, rootLabel: 'Eingangskorb', onConfirm });
    await screen.findAllByRole('treeitem');
    fireEvent.click(row(/^Finanzen,/));
    await act(async () => fireEvent.click(confirmButton()));
    expect(await screen.findByText('In Finanzen gibt es das schon.')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    onConfirm.mockResolvedValueOnce(ok);
    await act(async () => fireEvent.click(confirmButton()));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('FolderMoveDialog, when moving throws', () => {
  it('stays open with a general reason and lets the user try again', async () => {
    const onConfirm = vi.fn(async (): Promise<ActionState> => {
      throw new Error('Netz weg');
    });
    const { onOpenChange } = renderDialog({ onConfirm });
    await screen.findAllByRole('treeitem');
    fireEvent.click(row(/^Verträge,/));
    await act(async () => fireEvent.click(confirmButton()));
    expect(await screen.findByText('Das hat nicht geklappt. Bitte versuchen Sie es noch einmal.')).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(confirmButton().hasAttribute('disabled')).toBe(false);
  });
});

describe('FolderField', () => {
  function Field(props: { value: string | null; name?: string; onChange?: (path: string | null) => void | Promise<ActionState> }) {
    return <FolderField folders={folders} label="Ordner" emptyLabel="Eingangskorb" {...props} />;
  }

  it('shows the place as names joined with „›“, never with slashes', () => {
    render(<Field value="Behörden/Amtsgericht" />, { wrapper: Intl });
    const place = document.querySelector('[data-folder-path]')!;
    expect(place.textContent).toBe('Behörden › Amtsgericht');
    expect(place.textContent).not.toContain('/');
  });

  it('shows the empty label without a folder', () => {
    render(<Field value={null} name="folder" />, { wrapper: Intl });
    expect(document.querySelector('[data-folder-path]')!.textContent).toBe('Eingangskorb');
    expect((document.querySelector('input[name="folder"]') as HTMLInputElement).value).toBe('');
  });

  it('picks in the dialog, reports the path and writes the hidden field', async () => {
    const onChange = vi.fn();
    render(<Field value="Behörden/Amtsgericht" name="folder" onChange={onChange} />, { wrapper: Intl });
    expect((document.querySelector('input[name="folder"]') as HTMLInputElement).value).toBe('Behörden/Amtsgericht');
    fireEvent.click(screen.getByRole('button', { name: 'Verschieben nach…' }));
    await screen.findAllByRole('treeitem');
    expect(screen.getByRole('treeitem', { name: 'Amtsgericht, 9 Dokumente, davon 3 direkt, liegt hier' })).toBeTruthy();
    fireEvent.click(row(/^Finanzen,/));
    await act(async () => fireEvent.click(confirmButton()));
    expect(onChange).toHaveBeenCalledWith('Finanzen');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((document.querySelector('input[name="folder"]') as HTMLInputElement).value).toBe('Finanzen');
    expect(document.querySelector('[data-folder-path]')!.textContent).toBe('Finanzen');
  });

  it('waits for a saving onChange: the button is locked, an error keeps the dialog open, the place changes only on success', async () => {
    let settle: (state: ActionState) => void = () => {};
    const onChange = vi.fn(() => new Promise<ActionState>((resolve) => (settle = resolve)));
    render(<Field value="Verträge" name="folder" onChange={onChange} />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Verschieben nach…' }));
    await screen.findAllByRole('treeitem');
    fireEvent.click(row(/^Finanzen,/));
    await act(async () => fireEvent.click(confirmButton()));
    expect(onChange).toHaveBeenCalledWith('Finanzen');
    expect(confirmButton().hasAttribute('disabled')).toBe(true);
    await act(async () => settle({ status: 'error', message: 'Nicht verschoben.', fieldErrors: {}, detail: 'Das Dokument ist gesperrt.' }));
    expect(await screen.findByText('Das Dokument ist gesperrt.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((document.querySelector('input[name="folder"]') as HTMLInputElement).value).toBe('Verträge');
    expect(document.querySelector('[data-folder-path]')!.textContent).toBe('Verträge');

    await act(async () => fireEvent.click(confirmButton()));
    await act(async () => settle(ok));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('[data-folder-path]')!.textContent).toBe('Finanzen');
  });

  it('takes a plain onChange at once (form with a hidden field)', async () => {
    const onChange = vi.fn((_path: string | null) => undefined);
    render(<Field value="Verträge" name="folder" onChange={onChange} />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Verschieben nach…' }));
    await screen.findAllByRole('treeitem');
    fireEvent.click(row(/^Finanzen,/));
    await act(async () => fireEvent.click(confirmButton()));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((document.querySelector('input[name="folder"]') as HTMLInputElement).value).toBe('Finanzen');
  });

  it('follows a new value from outside', () => {
    function Outer() {
      const [value, setValue] = useState<string | null>('Verträge');
      return (
        <>
          <button type="button" onClick={() => setValue('Finanzen/Mittelverwendung')}>
            außen
          </button>
          <Field value={value} />
        </>
      );
    }
    render(<Outer />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'außen' }));
    expect(document.querySelector('[data-folder-path]')!.textContent).toBe('Finanzen › Mittelverwendung');
  });
});

describe('FolderMoveDialog, where it lies now (Artboard 5)', () => {
  const docs = (sources: Record<string, number>) => ({ kind: 'documents' as const, ids: Object.values(sources).flatMap((n, i) => Array.from({ length: n }, (_, j) => `d${i}-${j}`)), title: 'Registerauszug 2026', sources });

  it('says under the title which folder one document lies in, by its name', () => {
    renderDialog({ subject: docs({ 'Behörden/Amtsgericht/Vereinsregister 2026': 1 }), rootLabel: 'Eingangskorb' });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Liegt in Vereinsregister 2026.')).toBeTruthy();
    expect(describedBy(dialog)).toContain('Liegt in Vereinsregister 2026.');
  });

  it('counts per folder for documents from two folders', () => {
    renderDialog({ subject: docs({ 'Behörden/Amtsgericht/Vereinsregister 2026': 3, 'Behörden/Finanzamt': 2 }), rootLabel: 'Eingangskorb' });
    expect(screen.getByText('3 liegen in Vereinsregister 2026, 2 in Finanzamt.')).toBeTruthy();
  });

  it('says „im Eingangskorb“ for an incoming document without a folder', () => {
    renderDialog({ subject: docs({ '': 1 }), rootLabel: 'Eingangskorb', rootKind: 'inbox' });
    expect(screen.getByText('Liegt im Eingangskorb.')).toBeTruthy();
  });

  it('says „in keinem Ordner“ where there is no inbox', () => {
    renderDialog({ subject: docs({ '': 2 }), rootLabel: 'Kein Ordner' });
    expect(screen.getByText('Liegen in keinem Ordner.')).toBeTruthy();
  });

  it('counts the place without a folder in a list like any other place', () => {
    renderDialog({ subject: docs({ '': 2, 'Behörden/Finanzamt': 1 }), rootLabel: 'Kein Ordner' });
    expect(screen.getByText('2 liegen in keinem Ordner, 1 in Finanzamt.')).toBeTruthy();
  });

  it('only says how many folders when there are more than three', () => {
    renderDialog({ subject: docs({ Verträge: 1, Finanzen: 1, 'Behörden/Finanzamt': 1, '': 1 }), rootLabel: 'Eingangskorb' });
    expect(screen.getByText('Aus 4 verschiedenen Orten.')).toBeTruthy();
  });

  it('is left out for a folder field in a form that has not filed anything yet', () => {
    render(<FolderField value="Verträge" folders={folders} label="Ordner" emptyLabel="Eingangskorb" name="folder" showLocation={false} />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Verschieben nach…' }));
    expect(within(screen.getByRole('dialog')).queryByText(/^Liegt (in|im) /)).toBeNull();
  });
});

describe('FolderField, labels and read-only', () => {
  it('can call the button „Ändern…“ and title the dialog separately', () => {
    render(<FolderField value={null} folders={folders} label="Ordner" emptyLabel="Eingangskorb" moveLabel="Ändern…" dialogTitle="Ordner wählen" />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Ändern…' }));
    expect(screen.getByRole('dialog', { name: 'Ordner wählen' })).toBeTruthy();
  });

  it('shows only the place without the right to move', () => {
    render(<FolderField value="Behörden/Finanzamt" folders={folders} label="Ordner" emptyLabel="Eingangskorb" readOnly />, { wrapper: Intl });
    expect(document.querySelector('[data-folder-path]')!.textContent).toBe('Behörden › Finanzamt');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('FolderField as a term in a description list (labelAs="dt")', () => {
  it('puts the label into a dt and the place into the dd next to it, directly inside the dl group', () => {
    const { container } = render(
      <dl>
        <FolderField value="Behörden/Finanzamt" folders={folders} label="Ordner" emptyLabel="Eingangskorb" labelAs="dt" />
      </dl>,
      { wrapper: Intl }
    );
    const dl = container.querySelector('dl')!;
    const group = dl.firstElementChild!;
    expect(group.tagName).toBe('DIV');
    expect([...group.children].map((el) => el.tagName)).toEqual(['DT', 'DD']);
    expect(group.querySelector('dt')!.textContent).toBe('Ordner');
    expect(group.querySelector('dd')!.querySelector('[data-folder-path]')!.textContent).toBe('Behörden › Finanzamt');
    expect(group.querySelector('dd')!.querySelector('button')).toBeTruthy();
  });

  it('stays a span plus div without labelAs', () => {
    const { container } = render(<FolderField value={null} folders={folders} label="Ordner" emptyLabel="Eingangskorb" />, { wrapper: Intl });
    expect(container.querySelector('dt, dd')).toBeNull();
  });
});

describe('FolderField for a form that only picks (verb „pick“)', () => {
  it('says „übernehmen“, marks the current folder „gewählt“ and lets it be picked again', async () => {
    const onChange = vi.fn();
    render(<FolderField value="Verträge" folders={folders} label="Ordner" emptyLabel="Eingangskorb" name="folder" verb="pick" onChange={onChange} />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Verschieben nach…' }));
    await screen.findAllByRole('treeitem');
    expect(confirmButton().textContent).toBe('Übernehmen');
    const current = screen.getByRole('treeitem', { name: 'Verträge, 6 Dokumente, gewählt' });
    expect(current.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(row(/^Finanzen,/));
    expect(confirmButton().textContent).toBe('„Finanzen“ übernehmen');
    fireEvent.click(current);
    await act(async () => fireEvent.click(confirmButton()));
    expect(onChange).toHaveBeenCalledWith('Verträge');
  });

  it('keeps „verschieben“ and the blocked current place by default', async () => {
    render(<FolderField value="Verträge" folders={folders} label="Ordner" emptyLabel="Eingangskorb" />, { wrapper: Intl });
    fireEvent.click(screen.getByRole('button', { name: 'Verschieben nach…' }));
    await screen.findAllByRole('treeitem');
    expect(screen.getByRole('treeitem', { name: 'Verträge, 6 Dokumente, liegt hier' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(row(/^Finanzen,/));
    expect(confirmButton().textContent).toBe('Nach „Finanzen“ verschieben');
  });

  it('frames the place as a field and colours the frame for a suggestion', () => {
    const { rerender } = render(<FolderField value="Verträge" folders={folders} label="Ordner" emptyLabel="Eingangskorb" variant="field" />, { wrapper: Intl });
    const place = () => document.querySelector('[data-folder-path]')!;
    expect(place().className).toContain('border-line-strong');
    rerender(<FolderField value="Verträge" folders={folders} label="Ordner" emptyLabel="Eingangskorb" variant="field" suggested />);
    expect(place().className).toContain('border-info');
  });
});
