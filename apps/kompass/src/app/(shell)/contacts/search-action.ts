'use server';

import { displayName, listContacts } from '@kompass/module-contacts';
import { requireSession } from '@/lib/request-context';

/** Bis zu zwanzig Treffer für ein Suchfeld — mehr sieht in einer Liste niemand an. `kind`: nur Personen oder nur Organisationen (z. B. Zählende an der Barkasse — Finanz-Spec 5.5). */
export async function searchContactsAction(text: string, kind?: 'person' | 'organization'): Promise<{ id: string; name: string; city: string | null }[]> {
  const { deps, ctx } = await requireSession();
  const trimmed = text.trim();
  const res = await listContacts(deps, ctx, { ...(trimmed ? { text: trimmed } : {}), ...(kind ? { kind } : {}), limit: 20 });
  if (!res.ok) return [];
  // Der Ort steht dabei, weil die Suche ihn mit trifft: Wer „Mus“ tippt und drei
  // Treffer sieht, soll sehen, dass alle in Musterstadt wohnen.
  return res.value.contacts.map((c) => ({ id: c.id, name: displayName(c), city: c.city ?? null }));
}
