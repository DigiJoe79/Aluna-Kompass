'use client';

import { useRouter } from 'next/navigation';
import { useSiteJobStatus } from '@/components/site/site-job-provider';
import type { ActionState } from '@/lib/actions';

/** Nach einer Entscheidung: Stand „nicht publiziert“ neu lesen (Plan C) und weiter zum nächsten Vorschlag. */
export function useDecisionDone(nextHref: string) {
  const router = useRouter();
  const { refresh } = useSiteJobStatus();
  return (state: ActionState) => {
    if (state.status !== 'success') return state;
    refresh();
    router.push(nextHref);
    return state;
  };
}
