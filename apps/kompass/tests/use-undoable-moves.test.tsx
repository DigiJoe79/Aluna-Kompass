// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useUndoableMoves, type ItemWording, type UndoableItem } from '@/components/folder-tree/use-undoable-moves';
import type { ActionState } from '@/lib/actions';
import messages from '../messages/de.json';

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const wording: ItemWording<UndoableItem> = {
  name: (items) => items[0]!.title,
  moved: (moved) => `moved ${moved[0]!.title}`,
  alreadyThere: (skipped) => `already ${skipped}`,
  undone: () => 'undone',
  undoMovedAway: () => 'away',
};

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="de" messages={messages} timeZone="Europe/Berlin">
    {children}
  </NextIntlClientProvider>
);

const refused = async (): Promise<ActionState> => ({ status: 'error', message: 'Nein.', fieldErrors: {} });

function setup(moveItems: () => Promise<ActionState>, overrides: Partial<{ renameFolder: () => Promise<ActionState>; createFolder: () => Promise<ActionState> }> = {}) {
  const idle = async (): Promise<ActionState> => ({ status: 'idle' });
  return renderHook(
    () =>
      useUndoableMoves({
        folders: [{ path: 'Bilder', count: 1 }],
        selected: null,
        hrefFor: () => '/admin/media',
        storageKey: 'mediaTreeExpanded',
        actions: { moveFolder: idle, renameFolder: overrides.renameFolder ?? idle, createFolder: overrides.createFolder ?? idle, deleteFolder: idle, moveItems },
        unit: 'files',
        wording,
      }),
    { wrapper }
  );
}

describe('useUndoableMoves: moveItems', () => {
  it('a file that already lies in the target gets the info toast, no undo', async () => {
    const { result } = setup(async () => ({ status: 'success', data: { moved: [], skipped: ['a'] } }));
    await act(() => result.current.moveItems([{ id: 'a', from: 'Bilder', title: 'a.png' }], 'Bilder'));
    expect(toast.info).toHaveBeenCalledWith('already 1', expect.anything());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('a real move offers undo', async () => {
    const { result } = setup(async () => ({ status: 'success', data: { moved: ['a'], skipped: [] } }));
    await act(() => result.current.moveItems([{ id: 'a', from: null, title: 'a.png' }], 'Bilder'));
    expect(toast.success).toHaveBeenCalledWith('moved a.png', expect.objectContaining({ action: expect.objectContaining({ label: 'Rückgängig' }) }));
  });
});

describe('useUndoableMoves: quiet refusals of rename and create', () => {
  const idleMove = async (): Promise<ActionState> => ({ status: 'idle' });

  it('rename: a refusal toasts by default, not with quiet, but again when quiet says the row is closed', async () => {
    const { result } = setup(idleMove, { renameFolder: refused });
    await act(() => result.current.renameFolder('Bilder', 'Fotos'));
    expect(toast.error).toHaveBeenCalledTimes(1);
    toast.error.mockClear();
    await act(() => result.current.renameFolder('Bilder', 'Fotos', { quiet: true }));
    expect(toast.error).not.toHaveBeenCalled();
    await act(() => result.current.renameFolder('Bilder', 'Fotos', { quiet: () => true }));
    expect(toast.error).not.toHaveBeenCalled();
    await act(() => result.current.renameFolder('Bilder', 'Fotos', { quiet: () => false }));
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('create: a refusal toasts by default, not with quiet', async () => {
    const { result } = setup(idleMove, { createFolder: refused });
    await act(() => result.current.createFolder(null, 'Neu'));
    expect(toast.error).toHaveBeenCalledTimes(1);
    toast.error.mockClear();
    await act(() => result.current.createFolder(null, 'Neu', { quiet: true }));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
