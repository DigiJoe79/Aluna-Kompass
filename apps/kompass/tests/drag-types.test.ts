import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENTS_MIME, FOLDER_MIME, MEDIA_MIME, beginDrag, carriesOutsideFiles, currentDrag } from '@/lib/drag-types';
import type { DragItem } from '@/lib/folder-tree-model';

const docs: DragItem = { kind: 'documents', ids: ['a', 'b'], sources: [null, 'behoerden'], label: '2 Dokumente' };

/**
 * Das Gedächtnis des Ziehens: Die Quellzeile kann während des Zugs
 * verschwinden (die Liste nimmt das Verschieben vorweg), dann kommt ihr
 * `dragend` nie am Fenster an. Ein `drop` irgendwo im Fenster beendet den Zug
 * genauso — erst nach dem Ziel, das ihn noch liest.
 */
describe('beginDrag', () => {
  let win: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers();
    win = new EventTarget();
    vi.stubGlobal('window', win);
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('forgets the drag after a drop anywhere in the window, but only after the target has read it', () => {
    beginDrag(docs);
    win.dispatchEvent(new Event('drop'));
    expect(currentDrag()).toBe(docs);
    vi.runAllTimers();
    expect(currentDrag()).toBeNull();
  });

  it('forgets the drag after dragend', () => {
    beginDrag(docs);
    win.dispatchEvent(new Event('dragend'));
    vi.runAllTimers();
    expect(currentDrag()).toBeNull();
  });

  it('ignores a remembered drag whose type the current drag does not carry', () => {
    beginDrag(docs);
    expect(currentDrag([DOCUMENTS_MIME])).toBe(docs);
    expect(currentDrag(['Files'])).toBeNull();
    expect(currentDrag([MEDIA_MIME])).toBeNull();
  });

  it('a new drag replaces the old one, and the old one’s end does not forget the new', () => {
    const other: DragItem = { kind: 'documents', ids: ['c'], sources: [null], label: 'c' };
    beginDrag(docs);
    beginDrag(other);
    win.dispatchEvent(new Event('drop'));
    vi.runAllTimers();
    expect(currentDrag()).toBeNull();
    beginDrag(docs);
    expect(currentDrag()).toBe(docs);
  });
});

/** Eigenes Ziehgut ist nie ein Upload — auch nicht aus einem zweiten Tab, wo `internal` nicht gesetzt ist. */
describe('carriesOutsideFiles', () => {
  const transfer = (types: string[]) => ({ types }) as unknown as DataTransfer;

  it('is true for a plain file drag', () => {
    expect(carriesOutsideFiles(transfer(['Files']))).toBe(true);
  });

  it.each([DOCUMENTS_MIME, MEDIA_MIME, FOLDER_MIME])('is false when the drag also carries %s', (mime) => {
    expect(carriesOutsideFiles(transfer(['Files', mime]))).toBe(false);
  });
});
