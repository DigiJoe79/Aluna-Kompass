// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, expect, it, vi } from 'vitest';
import { FiledAnnouncement } from '@/app/(shell)/dms/filed-announcement';

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
afterEach(cleanup);

// Nach dem Ablegen einer geschützten Art leitet die Akte auf `?filed=` weiter; der Hinweis dort hat als hint keine
// Rolle, der Toast sagt das Ergebnis an (MUSTER § A, Designer 2026-10-08).
it('sagt das Ablegen einmal an', () => {
  render(<FiledAnnouncement message="Abgelegt als BRF-2026-007." number="BRF-2026-007" />);
  expect(toast.success).toHaveBeenCalledTimes(1);
  expect(toast.success).toHaveBeenCalledWith('Abgelegt als BRF-2026-007.', { id: 'filed-BRF-2026-007' });
});
