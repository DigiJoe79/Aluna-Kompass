'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Sagt das Ablegen an, wenn die Akte nach `?filed=` zeigt, dass die Art geschützt ist: Der Hinweis darüber hat als
 * hint keine Rolle und erscheint erst nach der Handlung — der Toast nennt das Ergebnis, der Kasten die Details
 * (MUSTER § A, Designer 2026-10-08). Die Kennung hält ihn einmalig, auch wenn der Effekt doppelt läuft.
 */
export function FiledAnnouncement({ message, number }: { message: string; number: string }) {
  useEffect(() => {
    toast.success(message, { id: `filed-${number}` });
  }, [message, number]);
  return null;
}
