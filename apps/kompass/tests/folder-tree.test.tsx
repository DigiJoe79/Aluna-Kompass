// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { Files, Inbox } from 'lucide-react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderTree, type FolderTreeProps } from '@/components/folder-tree/folder-tree';
import { FolderTreeKeyHelp } from '@/components/folder-tree/key-help';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { nextTypeAheadMatch } from '@/components/folder-tree/type-ahead';
import { expandFolders, renameExpandedPrefix, useFolderTreeExpanded } from '@/components/folder-tree/use-folder-tree-expanded';
import { edgeScrollStep } from '@/components/folder-tree/use-edge-scroll';
import { DOCUMENTS_MIME, beginDrag } from '@/lib/drag-types';
import messages from '../messages/de.json';

/** Jede gezeichnete Baumzeile mit ihrem Namen — auch die eines Takts, der nie zu sehen ist. */
const rowNames = vi.hoisted(() => [] as string[]);
vi.mock('@/components/folder-tree/folder-tree-row', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/components/folder-tree/folder-tree-row')>();
  return {
    ...mod,
    FolderTreeRow: (props: Parameters<typeof mod.FolderTreeRow>[0]) => {
      rowNames.push(props.node.name);
      return mod.FolderTreeRow(props);
    },
  };
});

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
  { path: 'Behörden/Amtsgericht/Vereinsregister', count: 6 },
  { path: 'Behörden/Finanzamt', count: 9 },
  { path: 'Kassenprüfung', count: 0 },
  { path: 'Verträge', count: 1 },
  { path: 'Vorstand', count: 2 },
  { path: 'Ämter', count: 0 },
];

function treeElement(props: Partial<FolderTreeProps> = {}) {
  return (
    <FolderTree
      folders={folders}
      mode="navigate"
      selected="Behörden/Finanzamt"
      fixed={[
        { key: 'all', label: 'Alle Dokumente', icon: Files, count: 21, href: '/dms', dropTarget: false, folder: null },
        { key: 'inbox', label: 'Eingangskorb', icon: Inbox, count: 2, href: '/dms?inbox=1', dropTarget: true, folder: null },
      ]}
      hrefFor={(path) => `/dms?folder=${encodeURIComponent(path)}`}
      acceptsItems="application/x-kompass-documents"
      unit={{ one: 'Dokument', many: 'Dokumente' }}
      storageKey="dmsTreeExpanded"
      {...props}
    />
  );
}

function renderTree(props: Partial<FolderTreeProps> = {}) {
  return render(treeElement(props), { wrapper: Intl });
}

const UNEXPECTED = 'Das hat nicht geklappt. Bitte versuchen Sie es noch einmal.';

/** Headless Tree hört keydown am Baum und keyup am Dokument (Spike). */
async function press(key: string, target: Element = document.activeElement ?? document.body) {
  await act(async () => {
    fireEvent.keyDown(target, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key });
    fireEvent.keyUp(document, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key });
    await new Promise((r) => setTimeout(r, 30));
  });
}

const row = (name: RegExp) => screen.getByRole('treeitem', { name });

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('nextTypeAheadMatch', () => {
  const names = [
    { id: 'ämter', name: 'Ämter' },
    { id: 'behörden', name: 'Behörden' },
    { id: 'verträge', name: 'Verträge' },
    { id: 'vorstand', name: 'Vorstand' },
  ];

  it('finds the next name starting with the buffer, ignoring case and accents', () => {
    expect(nextTypeAheadMatch(names, 1, 'v')).toBe('verträge');
    expect(nextTypeAheadMatch(names, 1, 'ä')).toBe('ämter');
    expect(nextTypeAheadMatch(names, 0, 'VOR')).toBe('vorstand');
  });

  it('jumps on to the next entry when the same letter is typed again (APG)', () => {
    expect(nextTypeAheadMatch(names, 2, 'vv')).toBe('vorstand');
    expect(nextTypeAheadMatch(names, 3, 'vv')).toBe('verträge');
  });

  it('keeps the current entry while a longer buffer still matches it', () => {
    expect(nextTypeAheadMatch(names, 2, 've')).toBe('verträge');
  });

  it('answers null when nothing matches', () => {
    expect(nextTypeAheadMatch(names, 0, 'x')).toBeNull();
  });
});

describe('useFolderTreeExpanded', () => {
  const existing = new Set(['Behörden', 'Behörden/Amtsgericht', 'Behörden/Finanzamt', 'Verträge']);

  it('reads the stored state, drops what is gone and keeps the path to the selected folder open', async () => {
    localStorage.setItem('kompass.dmsTreeExpanded', JSON.stringify(['Verträge', 'Gelöscht']));
    const { result } = renderHook(() => useFolderTreeExpanded('dmsTreeExpanded', existing, 'Behörden/Finanzamt'));
    await waitFor(() => expect(result.current.expanded).toEqual(['Verträge', 'Behörden']));
  });

  it('writes changes to the store and rewrites stored paths by prefix', async () => {
    const { result } = renderHook(() => useFolderTreeExpanded('dmsTreeExpanded', existing, null));
    act(() => result.current.setExpanded(['Behörden', 'Behörden/Amtsgericht']));
    expect(JSON.parse(localStorage.getItem('kompass.dmsTreeExpanded')!)).toEqual(['Behörden', 'Behörden/Amtsgericht']);
    act(() => result.current.renamePrefix('Behörden', 'Ämter/Behörden'));
    expect(JSON.parse(localStorage.getItem('kompass.dmsTreeExpanded')!)).toEqual(['Ämter/Behörden', 'Ämter/Behörden/Amtsgericht']);
  });

  it('shares one state per key between instances, and renameExpandedPrefix reaches all of them', () => {
    const both = new Set([...existing, 'Ämter', 'Ämter/Behörden']);
    const first = renderHook(() => useFolderTreeExpanded('dmsTreeExpanded', both, null));
    const second = renderHook(() => useFolderTreeExpanded('dmsTreeExpanded', both, null));
    act(() => first.result.current.setExpanded(['Behörden']));
    expect(second.result.current.expanded).toEqual(['Behörden']);
    act(() => renameExpandedPrefix('dmsTreeExpanded', 'Behörden', 'Ämter/Behörden'));
    expect(first.result.current.expanded).toEqual(['Ämter/Behörden']);
    expect(second.result.current.expanded).toEqual(['Ämter/Behörden']);
    // Ein späteres Aufklappen in einer Instanz überschreibt die Umbenennung nicht.
    act(() => first.result.current.setExpanded([...first.result.current.expanded, 'Verträge']));
    expect(JSON.parse(localStorage.getItem('kompass.dmsTreeExpanded')!)).toEqual(['Ämter/Behörden', 'Verträge']);
    expect(second.result.current.expanded).toEqual(['Ämter/Behörden', 'Verträge']);
  });

  it('opens folders from outside the tree, without duplicates (expandFolders)', () => {
    const { result } = renderHook(() => useFolderTreeExpanded('dmsTreeExpanded', existing, null));
    act(() => result.current.setExpanded(['Verträge']));
    act(() => expandFolders('dmsTreeExpanded', ['Behörden', 'Verträge']));
    expect(result.current.expanded).toEqual(['Verträge', 'Behörden']);
  });

  it('ignores a stored value that is no list', () => {
    localStorage.setItem('kompass.dmsTreeExpanded', JSON.stringify({ evil: true }));
    const { result } = renderHook(() => useFolderTreeExpanded('dmsTreeExpanded', existing, null));
    expect(result.current.expanded).toEqual([]);
  });

  it('keeps its state in memory only without a key (dialog)', () => {
    const { result } = renderHook(() => useFolderTreeExpanded(null, existing, null));
    act(() => result.current.setExpanded(['Verträge']));
    expect(result.current.expanded).toEqual(['Verträge']);
    expect(localStorage.length).toBe(0);
  });
});

describe('FolderTree', () => {
  it('is a named tree of treeitems with level and expanded state', async () => {
    renderTree();
    const tree = await screen.findByRole('tree', { name: 'Ordner' });
    await waitFor(() => expect(within(tree).getAllByRole('treeitem').length).toBeGreaterThan(0));
    expect(row(/^Behörden,/).getAttribute('aria-level')).toBe('1');
    expect(row(/^Behörden,/).getAttribute('aria-expanded')).toBe('true');
    expect(row(/^Amtsgericht,/).getAttribute('aria-level')).toBe('2');
    expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('false');
  });

  it('names each row with its sum, and the direct share only where it differs (README § 6)', async () => {
    renderTree();
    await screen.findAllByRole('treeitem');
    expect(screen.getByRole('treeitem', { name: 'Amtsgericht, 9 Dokumente, davon 3 direkt' })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: 'Finanzamt, 9 Dokumente' })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: 'Kassenprüfung, leer' })).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: 'Verträge, 1 Dokument' })).toBeTruthy();
  });

  it('marks the selected folder as the current page and links it without nesting a button in the link', async () => {
    renderTree();
    await screen.findAllByRole('treeitem');
    const selected = row(/^Finanzamt,/);
    expect(selected.getAttribute('aria-current')).toBe('page');
    expect(row(/^Kassenprüfung,/).getAttribute('aria-current')).toBeNull();
    expect(selected.tagName).not.toBe('A');
    expect(selected.querySelector('a')!.getAttribute('href')).toBe('/dms?folder=Beh%C3%B6rden%2FFinanzamt');
    expect(document.querySelector('a button')).toBeNull();
    expect(selected.getAttribute('data-folder')).toBe('Behörden/Finanzamt');
  });

  it('shows the sum as the number and no folder icons in the tree', async () => {
    renderTree();
    await screen.findAllByRole('treeitem');
    expect(within(row(/^Behörden,/)).getByText('18')).toBeTruthy();
    expect(within(row(/^Kassenprüfung,/)).getByText('0')).toBeTruthy();
  });

  it('marks a row that is being saved with a small circle before its number (README § 3, Artboard 3)', async () => {
    renderTree({ saving: ['Verträge'] });
    await screen.findAllByRole('treeitem');
    expect(within(row(/^Verträge,/)).getByLabelText('wird gespeichert')).toBeTruthy();
    expect(within(row(/^Verträge,/)).getByText('1')).toBeTruthy();
    expect(within(row(/^Vorstand,/)).queryByLabelText('wird gespeichert')).toBeNull();
  });

  it('opens with → and goes up with ←', async () => {
    renderTree();
    await screen.findAllByRole('treeitem');
    const finanzamt = row(/^Finanzamt,/);
    finanzamt.focus();
    // Fokus und Aufklappen setzt der Baum nach dem Tastendruck in einem
    // späteren Durchlauf; die 30 ms in `press` reichen unter Last nicht immer
    // (einmal rot in der vollen Suite, 01.10.). Deshalb warten statt prüfen.
    await press('ArrowUp', finanzamt);
    await waitFor(() => expect(document.activeElement).toBe(row(/^Amtsgericht,/)));
    await press('ArrowRight', row(/^Amtsgericht,/));
    await waitFor(() => expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('true'));
    await press('ArrowRight');
    await waitFor(() => expect(document.activeElement).toBe(row(/^Vereinsregister,/)));
    await press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(row(/^Amtsgericht,/)));
  });

  it('moves ← from an ancestor of the selected folder to its parent, because the path stays open', async () => {
    renderTree({ selected: 'Behörden/Amtsgericht/Vereinsregister' });
    await screen.findAllByRole('treeitem');
    const register = row(/^Vereinsregister,/);
    register.focus();
    // Der Fokus wandert nach dem Rendern; auf der CI dauert das länger als die 30 ms in `press` (rot am 2026-10-02).
    await press('ArrowLeft', register);
    await waitFor(() => expect(document.activeElement).toBe(row(/^Amtsgericht,/)));
    await press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(row(/^Behörden,/)));
    expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('true');
    // Oberste Ebene: bleibt stehen und bleibt offen.
    await press('ArrowLeft');
    await waitFor(() => expect(document.activeElement).toBe(row(/^Behörden,/)));
    expect(row(/^Behörden,/).getAttribute('aria-expanded')).toBe('true');
    // Kein Pfeil-Knopf, der nichts täte.
    expect(row(/^Amtsgericht,/).querySelector('[data-toggle]')).toBeNull();
    expect(row(/^Behörden,/).querySelector('[data-toggle]')).toBeNull();
  });

  it('still collapses the children of the selected folder itself', async () => {
    renderTree({ selected: 'Behörden/Amtsgericht' });
    await screen.findAllByRole('treeitem');
    const amtsgericht = row(/^Amtsgericht,/);
    amtsgericht.focus();
    await press('ArrowRight', amtsgericht);
    expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('true');
    await press('ArrowLeft');
    expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('false');
    expect(row(/^Amtsgericht,/).querySelector('[data-toggle]')).not.toBeNull();
  });

  it('remembers what was opened under its storage key', async () => {
    renderTree();
    await screen.findAllByRole('treeitem');
    const finanzamt = row(/^Finanzamt,/);
    finanzamt.focus();
    await press('ArrowUp', finanzamt);
    await press('ArrowRight');
    expect(JSON.parse(localStorage.getItem('kompass.dmsTreeExpanded')!)).toContain('Behörden/Amtsgericht');
  });

  it('jumps to a folder by its first letter, umlauts and case included', async () => {
    renderTree();
    await screen.findAllByRole('treeitem');
    const finanzamt = row(/^Finanzamt,/);
    finanzamt.focus();
    await press('v', finanzamt);
    await waitFor(() => expect(document.activeElement).toBe(row(/^Verträge,/)));
    await press('v');
    await waitFor(() => expect(document.activeElement).toBe(row(/^Vorstand,/)));
    await new Promise((r) => setTimeout(r, 550));
    await press('Ä');
    await waitFor(() => expect(document.activeElement).toBe(row(/^Ämter,/)));
  });

  it('opens the key help with „?“ instead of the page help of the shell', async () => {
    const shell: string[] = [];
    const onWindowKey = (e: KeyboardEvent) => shell.push(e.key);
    window.addEventListener('keydown', onWindowKey);
    renderTree();
    await screen.findAllByRole('treeitem');
    const finanzamt = row(/^Finanzamt,/);
    finanzamt.focus();
    await press('?', finanzamt);
    window.removeEventListener('keydown', onWindowKey);
    expect(await screen.findByRole('dialog', { name: 'Tasten im Ordnerbaum' })).toBeTruthy();
    expect(shell).not.toContain('?');
  });

  it('opens the key help from the link at the foot of the column', async () => {
    renderTree();
    fireEvent.click(screen.getByRole('button', { name: /Tastenkürzel/ }));
    expect(await screen.findByRole('dialog', { name: 'Tasten im Ordnerbaum' })).toBeTruthy();
  });

  it('stays reachable by Tab when the selected folder does not exist (bookmark, moved away)', async () => {
    renderTree({ selected: 'Gibt/Es/Nicht' });
    await screen.findAllByRole('treeitem');
    await waitFor(() => expect(screen.getAllByRole('treeitem').filter((i) => i.getAttribute('tabindex') === '0')).toHaveLength(1));
    expect(screen.getAllByRole('treeitem')[0]!.getAttribute('tabindex')).toBe('0');
  });

  it('moves the tab stop to the first row when the focused folder disappears', async () => {
    const { rerender } = renderTree();
    await screen.findAllByRole('treeitem');
    rerender(
      <FolderTree
        folders={folders.filter((f) => f.path !== 'Behörden/Finanzamt')}
        mode="navigate"
        selected={null}
        fixed={[]}
        hrefFor={(path) => `/dms?folder=${encodeURIComponent(path)}`}
        acceptsItems="application/x-kompass-documents"
        unit={{ one: 'Dokument', many: 'Dokumente' }}
        storageKey="dmsTreeExpanded"
      />
    );
    await waitFor(() => expect(screen.getAllByRole('treeitem').filter((i) => i.getAttribute('tabindex') === '0')).toHaveLength(1));
  });
});

/** jsdom kennt kein DataTransfer — eine Attrappe wie im Spike. */
function transfer(types: string[], data: Record<string, string> = {}, files: File[] = [], extra: Record<string, unknown> = {}) {
  return {
    types,
    getData: (key: string) => data[key] ?? '',
    setData: () => {},
    files: Object.assign(files, { item: (i: number) => files[i] ?? null }),
    items: { length: files.length },
    effectAllowed: 'all',
    dropEffect: 'move',
    ...extra,
  } as unknown as DataTransfer;
}

/** Strg+Umschalt+D auf der fokussierten Zeile. */
async function pickUp(target: Element = document.activeElement ?? document.body) {
  await act(async () => {
    fireEvent.keyDown(target, { key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true });
    for (const code of ['KeyD', 'ShiftLeft', 'ControlLeft']) fireEvent.keyUp(document, { code });
    await new Promise((r) => setTimeout(r, 30));
  });
}

/** Unter Last kommt der Fokus einen Takt später an; die nächste Taste ginge sonst an die alte Zeile. */
const focusOn = (name: RegExp) => waitFor(() => expect(document.activeElement).toBe(row(name)));

const announced = () => document.querySelector('[aria-live="polite"]')?.textContent ?? '';
const moved = () => vi.fn(async () => ({ status: 'success' as const }));

describe('FolderTree, dragging', () => {
  it('picks up a folder with Ctrl+Shift+D, moves to a target with ↓ and drops it with Enter', async () => {
    const onMove = moved();
    renderTree({ canManage: true, canDrop: true, onMove });
    await screen.findAllByRole('treeitem');
    row(/^Finanzamt,/).focus();
    await press('ArrowUp', row(/^Finanzamt,/));
    await focusOn(/^Amtsgericht,/);
    await pickUp();
    expect(announced()).toBe('Amtsgericht aufgenommen. Wählen Sie mit den Pfeiltasten ein Ziel. Eingabetaste legt ab, Escape bricht ab.');
    // Marke an der Zeile und Leiste über dem Baum (Artboard 6b).
    expect(within(row(/^Amtsgericht,/)).getByText('wird verschoben')).toBeTruthy();
    expect(screen.getByText('Amtsgericht', { selector: 'strong' })).toBeTruthy();
    await press('ArrowDown');
    expect(row(/^Finanzamt,/).getAttribute('data-drop')).toBe('target');
    expect(announced()).toBe('Ziel: Finanzamt.');
    await press('Enter');
    expect(onMove).toHaveBeenCalledWith({ kind: 'folder', path: 'Behörden/Amtsgericht', total: 9 }, 'Behörden/Finanzamt');
    expect(document.querySelector('[data-drop]')).toBeNull();
  });

  it('shows its own subfolder as blocked with the reason and does not drop there', async () => {
    const onMove = moved();
    renderTree({ canManage: true, canDrop: true, onMove });
    await screen.findAllByRole('treeitem');
    row(/^Finanzamt,/).focus();
    await press('ArrowUp', row(/^Finanzamt,/));
    await focusOn(/^Amtsgericht,/);
    await press('ArrowUp');
    await focusOn(/^Behörden,/);
    await pickUp();
    await press('ArrowDown');
    const own = row(/^Amtsgericht,/);
    expect(own.getAttribute('data-drop')).toBe('blocked');
    expect(within(own).getByText('Ordner kann nicht in sich selbst')).toBeTruthy();
    expect(announced()).toBe('Ziel: Amtsgericht. Hier nicht möglich: Ordner kann nicht in sich selbst.');
    await press('Enter');
    expect(onMove).not.toHaveBeenCalled();
    expect(announced()).toBe('Nicht abgelegt: Ordner kann nicht in sich selbst. Behörden ist noch aufgenommen.');
    // Weiter aufgenommen: Ein anderes Ziel geht noch.
    for (const next of [/^Finanzamt,/, /^Kassenprüfung,/, /^Verträge,/]) {
      await press('ArrowDown');
      await focusOn(next);
    }
    expect(row(/^Verträge,/).getAttribute('data-drop')).toBe('target');
  });

  it('cancels with Esc: nothing moves, the focus is back on the folder, and it says where it stays', async () => {
    const onMove = moved();
    renderTree({ canManage: true, canDrop: true, onMove });
    await screen.findAllByRole('treeitem');
    row(/^Finanzamt,/).focus();
    await press('ArrowUp', row(/^Finanzamt,/));
    await focusOn(/^Amtsgericht,/);
    await pickUp();
    await press('ArrowDown');
    await press('Escape');
    expect(onMove).not.toHaveBeenCalled();
    // `updateDomFocus` setzt den Fokus verzögert; unter Last der ganzen Suite reichen die 30 ms von `press` nicht.
    await waitFor(() => expect(document.activeElement).toBe(row(/^Amtsgericht,/)));
    expect(announced()).toBe('Verschieben abgebrochen. Amtsgericht bleibt in Behörden.');
    expect(document.querySelector('[data-drop]')).toBeNull();
    expect(screen.queryAllByText('wird verschoben')).toHaveLength(0);
  });

  it('opens a closed target after dwelling and closes it again when the move is cancelled', async () => {
    renderTree({ canManage: true, canDrop: true, onMove: moved() });
    await screen.findAllByRole('treeitem');
    row(/^Finanzamt,/).focus();
    await press('ArrowDown', row(/^Finanzamt,/));
    await focusOn(/^Kassenprüfung,/);
    await pickUp();
    await press('ArrowUp');
    await focusOn(/^Finanzamt,/);
    await press('ArrowUp');
    await focusOn(/^Amtsgericht,/);
    const amtsgericht = row(/^Amtsgericht,/);
    expect(within(amtsgericht).getByText('Klappt gleich auf')).toBeTruthy();
    expect(announced()).toBe('Ziel: Amtsgericht. Klappt gleich auf.');
    await waitFor(() => expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('true'), { timeout: 1500 });
    expect(announced()).toBe('Amtsgericht aufgeklappt, 1 Unterordner.');
    await press('Escape');
    expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('false');
  });

  it('drops documents from the list on a valid folder', async () => {
    const onMove = moved();
    renderTree({ canDrop: true, onMove });
    await screen.findAllByRole('treeitem');
    const target = row(/^Kassenprüfung,/);
    fireEvent.dragOver(target, { dataTransfer: transfer([DOCUMENTS_MIME]) });
    await waitFor(() => expect(row(/^Kassenprüfung,/).getAttribute('data-drop')).toBe('target'));
    fireEvent.drop(target, { dataTransfer: transfer([DOCUMENTS_MIME], { [DOCUMENTS_MIME]: '["d1","d2"]' }) });
    expect(onMove).toHaveBeenCalledWith({ kind: 'documents', ids: ['d1', 'd2'], sources: [], label: '' }, 'Kassenprüfung');
  });

  it('blocks a folder where all dragged documents already lie, and never falls back to its parent', async () => {
    const onMove = moved();
    renderTree({ canDrop: true, onMove });
    await screen.findAllByRole('treeitem');
    beginDrag({ kind: 'documents', ids: ['d1'], sources: ['Behörden/Finanzamt'], label: 'Bescheid' });
    const target = row(/^Finanzamt,/);
    fireEvent.dragOver(target, { dataTransfer: transfer([DOCUMENTS_MIME]) });
    await waitFor(() => expect(row(/^Finanzamt,/).getAttribute('data-drop')).toBe('blocked'));
    expect(within(row(/^Finanzamt,/)).getByText('Liegt schon hier')).toBeTruthy();
    fireEvent.drop(target, { dataTransfer: transfer([DOCUMENTS_MIME], { [DOCUMENTS_MIME]: '["d1"]' }) });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.dragEnd(window);
  });

  it('blocks a folder that exists only as a path, for documents and files alike', async () => {
    const onMove = moved();
    const onDropFiles = vi.fn();
    renderTree({ folders: [...folders, { path: 'Archiv/2025', count: 1 }], canDrop: true, onMove, onDropFiles });
    await screen.findAllByRole('treeitem');
    const archiv = row(/^Archiv,/);
    fireEvent.dragOver(archiv, { dataTransfer: transfer([DOCUMENTS_MIME]) });
    await waitFor(() => expect(row(/^Archiv,/).getAttribute('data-drop')).toBe('blocked'));
    expect(within(row(/^Archiv,/)).getByText('Diesen Ordner gibt es nur als Weg — legen Sie ihn zuerst an.')).toBeTruthy();
    fireEvent.drop(archiv, { dataTransfer: transfer([DOCUMENTS_MIME], { [DOCUMENTS_MIME]: '["d1"]' }) });
    const file = new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });
    fireEvent.drop(archiv, { dataTransfer: transfer(['Files'], {}, [file]) });
    expect(onMove).not.toHaveBeenCalled();
    expect(onDropFiles).not.toHaveBeenCalled();
  });

  it('drags a folder with the mouse, dims its subtree and blocks its own subfolder', async () => {
    const onMove = moved();
    renderTree({ canManage: true, canDrop: true, onMove, selected: 'Behörden/Amtsgericht/Vereinsregister' });
    await screen.findAllByRole('treeitem');
    const setDragImage = vi.fn();
    const source = row(/^Amtsgericht,/);
    expect(source.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(source, { dataTransfer: transfer([], {}, [], { setDragImage }) });
    expect(setDragImage).toHaveBeenCalled();
    const image = setDragImage.mock.calls[0]![0] as HTMLElement;
    expect(image.textContent).toContain('Amtsgericht');
    expect(image.textContent).toContain('9 Dokumente');
    await waitFor(() => expect(row(/^Vereinsregister,/).getAttribute('data-dimmed')).toBe('true'));
    fireEvent.dragOver(row(/^Vereinsregister,/), { dataTransfer: transfer([]) });
    await waitFor(() => expect(row(/^Vereinsregister,/).getAttribute('data-drop')).toBe('blocked'));
    fireEvent.drop(row(/^Vereinsregister,/), { dataTransfer: transfer([]) });
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.dragStart(row(/^Amtsgericht,/), { dataTransfer: transfer([]) });
    fireEvent.dragOver(row(/^Verträge,/), { dataTransfer: transfer([]) });
    fireEvent.drop(row(/^Verträge,/), { dataTransfer: transfer([]) });
    expect(onMove).toHaveBeenCalledWith({ kind: 'folder', path: 'Behörden/Amtsgericht', total: 9 }, 'Verträge');
  });

  it('does not let folders be dragged without the right to manage them', async () => {
    const onMove = moved();
    renderTree({ canManage: false, canDrop: true, onMove });
    await screen.findAllByRole('treeitem');
    expect(row(/^Amtsgericht,/).getAttribute('draggable')).toBe('false');
    row(/^Finanzamt,/).focus();
    await press('ArrowUp', row(/^Finanzamt,/));
    await focusOn(/^Amtsgericht,/);
    await pickUp();
    expect(screen.queryAllByText('wird verschoben')).toHaveLength(0);
    expect(announced()).toBe('');
    await press('ArrowDown');
    expect(document.querySelector('[data-drop]')).toBeNull();
  });

  // Am Telefon wird nicht gezogen (Spec § 5.6, Befund 0.2.4/11); die Tastatur bleibt.
  it('does not offer mouse dragging on a touch screen, but still picks up with the keyboard', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    try {
      renderTree({ canManage: true, canDrop: true, onMove: moved() });
      await screen.findAllByRole('treeitem');
      expect(row(/^Amtsgericht,/).getAttribute('draggable')).toBe('false');
      row(/^Finanzamt,/).focus();
      await press('ArrowUp', row(/^Finanzamt,/));
      await focusOn(/^Amtsgericht,/);
      await pickUp();
      expect(screen.queryAllByText('wird verschoben').length).toBeGreaterThan(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('FolderTree, dragging ends cleanly', () => {
  const pdf = () => new File(['%PDF'], 'a.pdf', { type: 'application/pdf' });

  /**
   * Dateien vom Schreibtisch feuern kein `dragend`: Wer sie über den Baum zieht
   * und dann Esc drückt oder das Fenster verlässt, hinterließ ein laufendes
   * Ziehen — Strg+Umschalt+D tat nichts, jedes Aufklappen galt als „fürs
   * Ziehen“, und das nächste Ziehen klappte Ordner des Nutzers wieder zu.
   */
  it('forgets a file drag that leaves the tree without a drop', async () => {
    const onDropFiles = vi.fn();
    renderTree({ canManage: true, canDrop: true, onMove: moved(), onDropFiles });
    await screen.findAllByRole('treeitem');
    const tree = screen.getByRole('tree');
    fireEvent.dragEnter(row(/^Kassenprüfung,/), { dataTransfer: transfer(['Files']) });
    fireEvent.dragOver(row(/^Kassenprüfung,/), { dataTransfer: transfer(['Files']) });
    await waitFor(() => expect(row(/^Kassenprüfung,/).getAttribute('data-drop')).toBe('target'));
    fireEvent.dragLeave(tree, { dataTransfer: transfer(['Files']), relatedTarget: null });
    await waitFor(() => expect(document.querySelector('[data-drop]')).toBeNull());
    await new Promise((r) => setTimeout(r, 150));

    // (b) Ein gewöhnliches Aufklappen wird nicht als Verweilen angesagt.
    await act(async () => {
      fireEvent.click(row(/^Amtsgericht,/).querySelector('[data-toggle]')!);
    });
    expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('true');
    expect(announced()).not.toContain('aufgeklappt');

    // (c) Das nächste Ziehen klappt den selbst geöffneten Ordner nicht zu.
    fireEvent.dragOver(row(/^Verträge,/), { dataTransfer: transfer(['Files']) });
    fireEvent.drop(row(/^Verträge,/), { dataTransfer: transfer(['Files'], {}, [pdf()]) });
    expect(onDropFiles).toHaveBeenCalledWith('Verträge', expect.anything());
    expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('true');

    // (a) Aufnehmen per Tastatur geht wieder.
    row(/^Finanzamt,/).focus();
    await press('ArrowUp', row(/^Finanzamt,/));
    await focusOn(/^Amtsgericht,/);
    await pickUp();
    expect(announced()).toBe('Amtsgericht aufgenommen. Wählen Sie mit den Pfeiltasten ein Ziel. Eingabetaste legt ab, Escape bricht ab.');
  });

  it('lets Ctrl+Shift+D end a mouse drag that is still running', async () => {
    renderTree({ canManage: true, canDrop: true, onMove: moved(), onDropFiles: vi.fn() });
    await screen.findAllByRole('treeitem');
    fireEvent.dragOver(row(/^Kassenprüfung,/), { dataTransfer: transfer(['Files']) });
    await waitFor(() => expect(row(/^Kassenprüfung,/).getAttribute('data-drop')).toBe('target'));
    row(/^Finanzamt,/).focus();
    await pickUp(row(/^Finanzamt,/));
    expect(announced()).toBe('Finanzamt aufgenommen. Wählen Sie mit den Pfeiltasten ein Ziel. Eingabetaste legt ab, Escape bricht ab.');
  });

  /**
   * Bricht das Ziehen eines Ordners mit `dropEffect: 'none'` ab (Esc, oder
   * zuletzt über einem gesperrten Ziel), räumt Headless Tree seinen Zustand
   * nicht auf: Das nächste fremde Ziehgut zählte als der alte Ordner, und
   * dessen Teilbaum nähme nichts mehr an.
   */
  it('clears the library state after a cancelled folder drag', async () => {
    const onMove = moved();
    renderTree({ canManage: true, canDrop: true, onMove, selected: 'Behörden/Amtsgericht/Vereinsregister' });
    await screen.findAllByRole('treeitem');
    fireEvent.dragStart(row(/^Amtsgericht,/), { dataTransfer: transfer([]) });
    fireEvent.dragEnd(row(/^Amtsgericht,/), { dataTransfer: transfer([], {}, [], { dropEffect: 'none' }) });
    await waitFor(() => expect(document.querySelector('[data-dimmed]')).toBeNull());

    row(/^Finanzamt,/).focus();
    const target = row(/^Vereinsregister,/);
    // Nicht abgebrochen heißt: Der Browser darf hier ablegen.
    expect(fireEvent.dragOver(target, { dataTransfer: transfer([DOCUMENTS_MIME]) })).toBe(false);
    fireEvent.drop(target, { dataTransfer: transfer([DOCUMENTS_MIME], { [DOCUMENTS_MIME]: '["d9"]' }) });
    expect(onMove).toHaveBeenCalledWith({ kind: 'documents', ids: ['d9'], sources: [], label: '' }, 'Behörden/Amtsgericht/Vereinsregister');
    expect(document.activeElement).not.toBe(row(/^Amtsgericht,/));
  });
});

const ok = () => vi.fn(async (..._args: unknown[]) => ({ status: 'success' as const }));
const manage = () => ({ canManage: true, onCreate: ok(), onRename: ok(), onDelete: ok(), onRequestMove: vi.fn() });

/** Der „…“-Knopf einer Zeile; nur für Maus und Finger, darum ohne eigenen Namen. */
const dots = (name: RegExp) => row(name).querySelector<HTMLButtonElement>('[data-row-menu]');
/** Die Beschriftungen der Einträge, ohne Tastenkürzel und Sperrgrund. */
const menuNames = () =>
  screen.getAllByRole('menuitem').map((item) => {
    const copy = item.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-slot="dropdown-menu-shortcut"], [data-slot="dropdown-menu-item-description"]').forEach((el) => el.remove());
    return copy.textContent?.trim();
  });

async function closeMenu() {
  await act(async () => {
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 30));
  });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

async function openMenu(name: RegExp) {
  await act(async () => {
    fireEvent.click(dots(name)!);
    await new Promise((r) => setTimeout(r, 30));
  });
  return screen.findByRole('menu');
}

async function choose(label: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${label}`) }));
    await new Promise((r) => setTimeout(r, 30));
  });
}

const nameInput = () => screen.getByRole('textbox', { name: 'Name des Ordners' }) as HTMLInputElement;

async function typeName(value: string) {
  await act(async () => {
    fireEvent.change(nameInput(), { target: { value } });
  });
}

async function inputKey(key: string) {
  await act(async () => {
    fireEvent.keyDown(nameInput(), { key });
    await new Promise((r) => setTimeout(r, 30));
  });
}

describe('FolderTree, managing folders', () => {
  it('opens the same menu by „…“, right-click, Shift+F10 and the menu key, in the order of the board', async () => {
    renderTree({ ...manage(), extraMenuItems: () => <DropdownMenuItem>Als Paket exportieren</DropdownMenuItem> });
    await screen.findAllByRole('treeitem');
    const order = ['Neuer Unterordner', 'Umbenennen', 'Verschieben nach…', 'Als Paket exportieren', 'Löschen'];

    await openMenu(/^Vorstand,/);
    expect(menuNames()).toEqual(order);
    expect(screen.getByRole('menu').querySelector('[role="separator"]')).toBeTruthy();
    await closeMenu();

    await act(async () => {
      fireEvent.contextMenu(row(/^Vorstand,/));
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(menuNames()).toEqual(order);
    await closeMenu();

    row(/^Vorstand,/).focus();
    await act(async () => {
      fireEvent.keyDown(row(/^Vorstand,/), { key: 'F10', code: 'F10', shiftKey: true });
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(menuNames()).toEqual(order);
    await closeMenu();
    await focusOn(/^Vorstand,/);

    await press('ContextMenu', row(/^Vorstand,/));
    expect(menuNames()).toEqual(order);
  });

  it('shows the „…“ at the selected row at all times and leaves out what has no handler', async () => {
    renderTree({ canManage: true, onRename: ok() });
    await screen.findAllByRole('treeitem');
    expect(dots(/^Finanzamt,/)?.getAttribute('data-visible')).toBe('always');
    expect(dots(/^Vorstand,/)?.getAttribute('data-visible')).toBe('hover');
    await openMenu(/^Vorstand,/);
    expect(menuNames()).toEqual(['Umbenennen']);
  });

  it('keeps „…“ visible on every row with density touch', async () => {
    renderTree({ ...manage(), density: 'touch' });
    await screen.findAllByRole('treeitem');
    expect(dots(/^Vorstand,/)?.getAttribute('data-visible')).toBe('always');
  });

  it('disables Löschen with its reason, focusable and read out: documents, or subfolders even when empty', async () => {
    const props = manage();
    renderTree(props);
    await screen.findAllByRole('treeitem');

    await openMenu(/^Amtsgericht,/);
    const blocked = screen.getByRole('menuitem', { name: /^Löschen/ });
    expect(blocked.getAttribute('aria-disabled')).toBe('true');
    expect(blocked.textContent).toContain('Enthält 3 Dokumente. Löschen lassen sich nur leere Ordner.');
    const described = document.getElementById(blocked.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe('Enthält 3 Dokumente. Löschen lassen sich nur leere Ordner.');
    expect(blocked.hasAttribute('disabled')).toBe(false);
    fireEvent.click(blocked);
    expect(props.onDelete).not.toHaveBeenCalled();
    await closeMenu();

    await openMenu(/^Behörden,/);
    expect(screen.getByRole('menuitem', { name: /^Löschen/ }).textContent).toContain('Enthält 2 Unterordner. Löschen lassen sich nur leere Ordner.');
  });

  it('deletes an empty folder at once, without asking (Spec § 5.4)', async () => {
    const props = manage();
    renderTree(props);
    await screen.findAllByRole('treeitem');
    await openMenu(/^Kassenprüfung,/);
    expect(screen.getByRole('menuitem', { name: /^Löschen/ }).getAttribute('aria-disabled')).not.toBe('true');
    await choose('Löschen');
    expect(props.onDelete).toHaveBeenCalledWith('Kassenprüfung');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks for the move dialog with „Verschieben nach…“', async () => {
    const props = manage();
    renderTree(props);
    await screen.findAllByRole('treeitem');
    await openMenu(/^Verträge,/);
    await choose('Verschieben nach');
    expect(props.onRequestMove).toHaveBeenCalledWith('Verträge');
  });

  it('renames in the row with F2: Enter saves, the field takes the focus and the tree keys are off', async () => {
    const props = manage();
    renderTree(props);
    await screen.findAllByRole('treeitem');
    row(/^Vorstand,/).focus();
    await press('F2', row(/^Vorstand,/));
    const input = nameInput();
    expect(input.value).toBe('Vorstand');
    expect(document.activeElement).toBe(input);
    // Buchstaben springen nicht (Sprung-Suche aus), Pfeile wandern nicht.
    await press('K', input);
    await press('ArrowUp', input);
    expect(document.activeElement).toBe(input);
    await typeName('Vorstandschaft');
    await inputKey('Enter');
    expect(props.onRename).toHaveBeenCalledWith('Vorstand', 'Vorstandschaft', expect.anything());
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('shows a name error while typing and does not save it', async () => {
    const props = manage();
    renderTree(props);
    await screen.findAllByRole('treeitem');
    await openMenu(/^Finanzamt,/);
    await choose('Umbenennen');
    await typeName('Amtsgericht');
    expect(screen.getByText('Einen Ordner „Amtsgericht“ gibt es hier schon.')).toBeTruthy();
    expect(nameInput().getAttribute('aria-invalid')).toBe('true');
    await inputKey('Enter');
    expect(props.onRename).not.toHaveBeenCalled();
    await typeName('a/b');
    expect(screen.getByText('Ein Ordnername darf keinen Schrägstrich (/) enthalten.')).toBeTruthy();
    await typeName('x'.repeat(61));
    expect(screen.getByText('Name zu lang: höchstens 60 Zeichen.')).toBeTruthy();
    // Nur die Schreibweise ändern geht.
    await typeName('FINANZAMT');
    expect(nameInput().getAttribute('aria-invalid')).toBe('false');
  });

  it('keeps the field open with the reason when the server refuses', async () => {
    const onRename = vi.fn(async () => ({ status: 'error' as const, message: 'Den Ordner gibt es nicht mehr.', fieldErrors: {} }));
    renderTree({ canManage: true, onRename });
    await screen.findAllByRole('treeitem');
    row(/^Vorstand,/).focus();
    await press('F2', row(/^Vorstand,/));
    await typeName('Neu');
    await inputKey('Enter');
    expect(await screen.findByText('Den Ordner gibt es nicht mehr.')).toBeTruthy();
    expect(nameInput().value).toBe('Neu');
  });

  it('tells the owner of the tree that the row names a refusal itself while it is open (no second toast)', async () => {
    const onRename = vi.fn(async (..._args: unknown[]) => ({ status: 'error' as const, message: 'Den Ordner gibt es nicht mehr.', fieldErrors: {} }));
    renderTree({ canManage: true, onRename });
    await screen.findAllByRole('treeitem');
    row(/^Vorstand,/).focus();
    await press('F2', row(/^Vorstand,/));
    await typeName('Neu');
    await inputKey('Enter');
    await screen.findByText('Den Ordner gibt es nicht mehr.');
    const { quiet } = onRename.mock.calls[0]![2] as { quiet: () => boolean };
    expect(quiet()).toBe(true);
    // Schließt die Zeile (Esc), gilt der Fehler nicht mehr als dort genannt.
    await inputKey('Escape');
    expect(quiet()).toBe(false);
  });

  it('discards with Esc and gives the focus back to the row', async () => {
    const props = manage();
    renderTree(props);
    await screen.findAllByRole('treeitem');
    row(/^Vorstand,/).focus();
    await press('F2', row(/^Vorstand,/));
    await typeName('Anders');
    await inputKey('Escape');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(props.onRename).not.toHaveBeenCalled();
    await focusOn(/^Vorstand,/);
  });

  it('opens „Neuer Unterordner“ as the first child, keeps the parent open and follows the new folder', async () => {
    const props = manage();
    const { rerender } = renderTree(props);
    await screen.findAllByRole('treeitem');
    await openMenu(/^Amtsgericht,/);
    await choose('Neuer Unterordner');
    const input = nameInput();
    expect(input.value).toBe('');
    expect(input.getAttribute('placeholder')).toBe('Name des Ordners');
    expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('true');
    // Direkt unter dem Elternordner, vor dessen erstem Kind.
    expect(row(/^Amtsgericht,/).compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input.compareDocumentPosition(row(/^Vereinsregister,/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await typeName('Archiv');
    await inputKey('Enter');
    expect(props.onCreate).toHaveBeenCalledWith('Behörden/Amtsgericht', 'Archiv', expect.anything());
    rerender(
      <FolderTree
        folders={[...folders, { path: 'Behörden/Amtsgericht/Archiv', count: 0 }]}
        mode="navigate"
        selected="Behörden/Finanzamt"
        fixed={[]}
        hrefFor={(path) => `/dms?folder=${encodeURIComponent(path)}`}
        acceptsItems="application/x-kompass-documents"
        unit={{ one: 'Dokument', many: 'Dokumente' }}
        storageKey="dmsTreeExpanded"
        {...props}
      />
    );
    await focusOn(/^Archiv,/);
    expect(row(/^Amtsgericht,/).getAttribute('aria-expanded')).toBe('true');
    expect(announced()).toBe('Ordner Archiv angelegt.');
  });

  it('creates on the top level with „Neuer Ordner“, whichever folder is open', async () => {
    const props = manage();
    renderTree(props);
    await screen.findAllByRole('treeitem');
    fireEvent.click(screen.getByRole('button', { name: 'Neuer Ordner' }));
    const input = nameInput();
    expect(input.compareDocumentPosition(screen.getAllByRole('treeitem')[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await typeName('Behörden');
    expect(screen.getByText('Einen Ordner „Behörden“ gibt es hier schon.')).toBeTruthy();
    await typeName('  Archiv ');
    await inputKey('Enter');
    expect(props.onCreate).toHaveBeenCalledWith(null, 'Archiv', expect.anything());
  });

  it('does nothing when the name is left empty', async () => {
    const props = manage();
    renderTree(props);
    await screen.findAllByRole('treeitem');
    fireEvent.click(screen.getByRole('button', { name: 'Neuer Ordner' }));
    await inputKey('Enter');
    expect(props.onCreate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('offers nothing on a folder that exists only as a path', async () => {
    renderTree({ ...manage(), folders: [...folders, { path: 'Projekte/Sommerfest', count: 1 }] });
    await screen.findAllByRole('treeitem');
    expect(dots(/^Projekte,/)).toBeNull();
    fireEvent.contextMenu(row(/^Projekte,/));
    row(/^Projekte,/).focus();
    await press('F2', row(/^Projekte,/));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('has no „…“, no menu, no F2 and no „Neuer Ordner“ without the right to manage', async () => {
    renderTree({ ...manage(), canManage: false });
    await screen.findAllByRole('treeitem');
    expect(dots(/^Vorstand,/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Neuer Ordner' })).toBeNull();
    fireEvent.contextMenu(row(/^Vorstand,/));
    row(/^Vorstand,/).focus();
    await press('F2', row(/^Vorstand,/));
    await act(async () => {
      fireEvent.keyDown(row(/^Vorstand,/), { key: 'F10', code: 'F10', shiftKey: true });
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('ignores F2 and the menu key while a folder is picked up', async () => {
    renderTree({ ...manage(), canDrop: true, onMove: moved() });
    await screen.findAllByRole('treeitem');
    row(/^Vorstand,/).focus();
    await pickUp(row(/^Vorstand,/));
    await press('F2', row(/^Vorstand,/));
    await press('ContextMenu', row(/^Vorstand,/));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('FolderTree, after a reload and when something fails', () => {
  it('keeps a moved folder open in its new place: the stored paths follow the move', async () => {
    localStorage.setItem('kompass.dmsTreeExpanded', JSON.stringify(['a', 'a/b']));
    const tiny = [
      { path: 'a', count: 0 },
      { path: 'a/b', count: 0 },
      { path: 'a/b/c', count: 1 },
      { path: 'x', count: 0 },
    ];
    const onMove = moved();
    renderTree({ folders: tiny, selected: null, canManage: true, canDrop: true, onMove });
    await waitFor(() => expect(row(/^b,/).getAttribute('aria-expanded')).toBe('true'));
    fireEvent.dragStart(row(/^a,/), { dataTransfer: transfer([]) });
    fireEvent.dragOver(row(/^x,/), { dataTransfer: transfer([]) });
    fireEvent.drop(row(/^x,/), { dataTransfer: transfer([]) });
    expect(onMove).toHaveBeenCalledWith({ kind: 'folder', path: 'a', total: 1 }, 'x');
    await waitFor(() => expect(JSON.parse(localStorage.getItem('kompass.dmsTreeExpanded')!)).toEqual(expect.arrayContaining(['x/a', 'x/a/b'])));
    const { result } = renderHook(() => useFolderTreeExpanded('dmsTreeExpanded', new Set(['x', 'x/a', 'x/a/b', 'x/a/b/c']), null));
    expect(result.current.expanded).toEqual(expect.arrayContaining(['x/a', 'x/a/b']));
  });

  it('never draws a row with an empty name when a visible folder disappears', async () => {
    const { rerender } = renderTree();
    await screen.findAllByRole('treeitem');
    rowNames.length = 0;
    rerender(treeElement({ folders: folders.filter((f) => f.path !== 'Vorstand') }));
    await waitFor(() => expect(screen.queryByRole('treeitem', { name: /^Vorstand,/ })).toBeNull());
    expect(rowNames.filter((name) => name === '')).toEqual([]);
  });

  it('announces a failure instead of an unhandled rejection when moving throws, by keyboard and by mouse', async () => {
    const onMove = vi.fn(async (): Promise<{ status: 'success' }> => {
      throw new Error('Netz weg');
    });
    renderTree({ canManage: true, canDrop: true, onMove });
    await screen.findAllByRole('treeitem');
    row(/^Finanzamt,/).focus();
    await press('ArrowUp', row(/^Finanzamt,/));
    await focusOn(/^Amtsgericht,/);
    await pickUp();
    await press('ArrowDown');
    await press('Enter');
    expect(onMove).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(announced()).toBe(UNEXPECTED));

    const target = row(/^Kassenprüfung,/);
    fireEvent.dragOver(target, { dataTransfer: transfer([DOCUMENTS_MIME]) });
    fireEvent.drop(target, { dataTransfer: transfer([DOCUMENTS_MIME], { [DOCUMENTS_MIME]: '["d1"]' }) });
    expect(onMove).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(announced()).toBe(UNEXPECTED));
  });

  it('keeps the name field usable with a general reason when renaming throws', async () => {
    const onRename = vi.fn(async (): Promise<{ status: 'success' }> => {
      throw new Error('Netz weg');
    });
    renderTree({ canManage: true, onRename });
    await screen.findAllByRole('treeitem');
    row(/^Vorstand,/).focus();
    await press('F2', row(/^Vorstand,/));
    await typeName('Neu');
    await inputKey('Enter');
    expect(await screen.findByText(UNEXPECTED)).toBeTruthy();
    expect(nameInput().readOnly).toBe(false);
    expect(nameInput().getAttribute('aria-busy')).toBeNull();
  });

  it('shows the empty state with „Ersten Ordner anlegen“, which opens the same name field as „Neuer Ordner“', async () => {
    const props = manage();
    renderTree({ ...props, folders: [], selected: null });
    expect(screen.getByText('Noch keine Ordner')).toBeTruthy();
    expect(screen.getByText(/^Mit Ordnern finden Sie Dokumente schneller wieder/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ersten Ordner anlegen' }));
    await typeName('Behörden');
    await inputKey('Enter');
    expect(props.onCreate).toHaveBeenCalledWith(null, 'Behörden', expect.anything());
  });

  it('shows the empty state without a button for readers', () => {
    renderTree({ folders: [], selected: null });
    expect(screen.getByText('Noch keine Ordner')).toBeTruthy();
    expect(screen.getByText('Ordner legt an, wer die Akte verwaltet. Bis dahin liegt alles unter „Alle Dokumente“.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ersten Ordner anlegen' })).toBeNull();
  });

  it('cancels a keyboard move when the focus leaves the tree, like Esc', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      const onMove = moved();
      renderTree({ canManage: true, canDrop: true, onMove });
      await screen.findAllByRole('treeitem');
      row(/^Finanzamt,/).focus();
      await press('ArrowUp', row(/^Finanzamt,/));
      await focusOn(/^Amtsgericht,/);
      await pickUp();
      // Innerhalb des Baums bleibt es aufgenommen.
      await act(async () => {
        fireEvent.focusOut(row(/^Amtsgericht,/), { relatedTarget: row(/^Finanzamt,/) });
      });
      expect(screen.getAllByText('wird verschoben').length).toBeGreaterThan(0);
      await act(async () => {
        fireEvent.focusOut(row(/^Amtsgericht,/), { relatedTarget: outside });
      });
      expect(announced()).toBe('Verschieben abgebrochen. Amtsgericht bleibt in Behörden.');
      expect(screen.queryAllByText('wird verschoben')).toHaveLength(0);
      expect(onMove).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });

  it('reads the reason of a disabled menu item only as its description, not in its name', async () => {
    renderTree(manage());
    await screen.findAllByRole('treeitem');
    await openMenu(/^Amtsgericht,/);
    const blocked = screen.getByRole('menuitem', { name: 'Löschen' });
    expect(document.getElementById(blocked.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enthält 3 Dokumente. Löschen lassen sich nur leere Ordner.');
  });

  it('marks rows with a menu as having a popup', async () => {
    renderTree(manage());
    await screen.findAllByRole('treeitem');
    expect(row(/^Vorstand,/).getAttribute('aria-haspopup')).toBe('menu');
    cleanup();
    renderTree();
    await screen.findAllByRole('treeitem');
    expect(row(/^Vorstand,/).getAttribute('aria-haspopup')).toBeNull();
  });

  it('forgets a rename whose folder disappears on reload and puts the focus on a row', async () => {
    const props = manage();
    const { rerender } = renderTree(props);
    await screen.findAllByRole('treeitem');
    row(/^Vorstand,/).focus();
    await press('F2', row(/^Vorstand,/));
    expect(nameInput()).toBeTruthy();
    rerender(treeElement({ ...props, folders: folders.filter((f) => f.path !== 'Vorstand') }));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    // Wieder pflegbar: „…“ ist zurück.
    await waitFor(() => expect(dots(/^Verträge,/)).not.toBeNull());
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('treeitem'));
  });

  it('closes the menu of a folder that disappears on reload', async () => {
    const props = manage();
    const { rerender } = renderTree(props);
    await screen.findAllByRole('treeitem');
    await openMenu(/^Verträge,/);
    rerender(treeElement({ ...props, folders: folders.filter((f) => f.path !== 'Verträge') }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('uses aria-current, not aria-selected, when navigating (APG navigation tree)', async () => {
    renderTree();
    await screen.findAllByRole('treeitem');
    expect(row(/^Finanzamt,/).getAttribute('aria-current')).toBe('page');
    expect(row(/^Finanzamt,/).hasAttribute('aria-selected')).toBe(false);
    expect(row(/^Kassenprüfung,/).hasAttribute('aria-selected')).toBe(false);
  });
});

describe('edgeScrollStep', () => {
  it('scrolls up near the top, down near the bottom, faster the closer, and not in between', () => {
    expect(edgeScrollStep(200, 0, 400)).toBe(0);
    expect(edgeScrollStep(10, 0, 400)).toBeLessThan(0);
    expect(edgeScrollStep(390, 0, 400)).toBeGreaterThan(0);
    expect(Math.abs(edgeScrollStep(2, 0, 400))).toBeGreaterThan(Math.abs(edgeScrollStep(30, 0, 400)));
    expect(edgeScrollStep(41, 0, 400)).toBe(0);
  });
});

describe('FolderTreeKeyHelp', () => {
  it('shows Ctrl+Shift+D as ⌃ ⇧ D on a Mac and spelled out elsewhere', () => {
    const { unmount } = render(<FolderTreeKeyHelp open onOpenChange={() => {}} canManage apple />, { wrapper: Intl });
    const mac = screen.getByRole('dialog', { name: 'Tasten im Ordnerbaum' });
    expect(within(mac).getByText('⌃')).toBeTruthy();
    // ⇧ steht zweimal: Strg+Umschalt+D und Umschalt+F10.
    expect(within(mac).getAllByText('⇧').length).toBeGreaterThan(0);
    unmount();
    render(<FolderTreeKeyHelp open onOpenChange={() => {}} canManage apple={false} />, { wrapper: Intl });
    const other = screen.getByRole('dialog', { name: 'Tasten im Ordnerbaum' });
    expect(within(other).getByText('Strg')).toBeTruthy();
    expect(within(other).getAllByText('Umschalt').length).toBeGreaterThan(0);
  });

  it('leaves out moving folders without the right to manage them', () => {
    render(<FolderTreeKeyHelp open onOpenChange={() => {}} canManage={false} apple={false} />, { wrapper: Intl });
    const dialog = screen.getByRole('dialog', { name: 'Tasten im Ordnerbaum' });
    expect(within(dialog).queryByText('Strg')).toBeNull();
    expect(within(dialog).queryByText('Pflegen')).toBeNull();
    expect(within(dialog).getByText('Springt zum passenden Ordnernamen')).toBeTruthy();
  });

  it('shows renaming and the menu under „Pflegen“ with the right to manage', () => {
    render(<FolderTreeKeyHelp open onOpenChange={() => {}} canManage apple={false} />, { wrapper: Intl });
    const dialog = screen.getByRole('dialog', { name: 'Tasten im Ordnerbaum' });
    expect(within(dialog).getByText('Pflegen')).toBeTruthy();
    expect(within(dialog).getByText('F2')).toBeTruthy();
    expect(within(dialog).getByText('F10')).toBeTruthy();
    expect(within(dialog).getByText('Menü am Ordner (auch die Menütaste)')).toBeTruthy();
  });
});
