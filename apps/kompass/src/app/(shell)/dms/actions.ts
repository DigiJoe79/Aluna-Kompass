'use server';

import { getTranslations } from 'next-intl/server';
import { toActionState, type ActionState } from '@/lib/actions';
import { requireSession } from '@/lib/request-context';

export async function pingDmsAction(): Promise<ActionState> {
  const t = await getTranslations();
  return { status: 'idle' };
}
