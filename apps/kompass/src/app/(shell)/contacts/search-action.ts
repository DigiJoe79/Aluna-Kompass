'use server';

import { displayName, listContacts } from '@kompass/module-contacts';
import { requireSession } from '@/lib/request-context';

/** Bis zu zwanzig Treffer für ein Suchfeld — mehr sieht in einer Liste niemand an. */
export async function searchContactsAction(text: string): Promise<{ id: string; name: string; city: string | null }[]> {
  const { deps, ctx } = await requireSession();
  const trimmed = text.trim();
  const res = await listContacts(deps, ctx, trimmed ? { text: trimmed, limit: 20 } : { limit: 20 });
  if (!res.ok) return [];
  // Der Ort steht dabei, weil die Suche ihn mit trifft: Wer „Mus“ tippt und drei
  // Treffer sieht, soll sehen, dass alle in Musterstadt wohnen.
  return res.value.contacts.map((c) => ({ id: c.id, name: displayName(c), city: c.city ?? null }));
}
