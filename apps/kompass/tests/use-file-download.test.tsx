// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { filenameFrom, useFileDownload } from '@/lib/use-file-download';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

const MESSAGES = { forbidden: 'kein Recht', notFound: 'weg', failed: 'ging nicht' };

afterEach(() => {
  vi.unstubAllGlobals();
  toastError.mockReset();
});

describe('filenameFrom', () => {
  it('prefers the UTF-8 name, falls back to the ASCII name, then to the fallback', () => {
    expect(filenameFrom(`attachment; filename="Mo_nchen.pdf"; filename*=UTF-8''M%C3%B6nchen.pdf`, 'x.pdf')).toBe('Mönchen.pdf');
    expect(filenameFrom('attachment; filename="Bello.pdf"', 'x.pdf')).toBe('Bello.pdf');
    expect(filenameFrom(null, 'x.pdf')).toBe('x.pdf');
  });
});

describe('useFileDownload', () => {
  it('turns 403, 404 and other statuses into a refusal at the trigger (MUSTER A)', async () => {
    for (const [status, message] of [[403, 'kein Recht'], [404, 'weg'], [400, 'ging nicht']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
      const { result } = renderHook(() => useFileDownload(MESSAGES));
      await act(() => result.current.download('/x', 'x.pdf'));
      expect(result.current.refusal).toMatchObject({ status: 'error', message });
      expect(result.current.busy).toBe(false);
    }
  });

  it('shows a lasting toast with retry when the server is out of reach', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    const { result } = renderHook(() => useFileDownload(MESSAGES));
    await act(() => result.current.download('/x', 'x.pdf'));
    expect(toastError).toHaveBeenCalledWith('network', expect.objectContaining({ duration: Infinity, closeButton: true }));
    expect(result.current.refusal).toMatchObject({ status: 'idle' });
  });
});
