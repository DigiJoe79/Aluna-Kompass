'use server';

import { displayName, listContacts } from '@kompass/module-contacts';
import { requireSession } from '@/lib/request-context';

/** Bis zu zwanzig Treffer für ein Suchfeld — mehr sieht in einer Liste niemand an. */
export async function searchContactsAction(text: string): Promise<{ id: string; name: string }[]> {
  const { deps, ctx } = await requireSession();
  const trimmed = text.trim();
  const res = await listContacts(deps, ctx, trimmed ? { text: trimmed, limit: 20 } : { limit: 20 });
  if (!res.ok) return [];
  return res.value.contacts.map((c) => ({ id: c.id, name: displayName(c) }));
}
