import { ok, type Result } from '@kompass/core';

/** Der Höchstwert, den die Listendienste je Aufruf erlauben. */
const PAGE = 200;

/**
 * Liest einen Listendienst seitenweise bis `total` (MUSTER § L, keine stille Grenze): für Auswahlen, die jeden
 * Posten anbieten müssen, weil sie auf dem Rechner suchen (Ausgleich in der Buchungsmaske), und für Beschriftungen.
 * Eine Ablehnung des Dienstes reicht sie durch.
 */
export async function readAllPages<V extends { total: number }, T>(
  fetch: (page: { limit: number; offset: number }) => Promise<Result<V>>,
  items: (value: V) => readonly T[],
): Promise<Result<T[]>> {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetch({ limit: PAGE, offset });
    if (!page.ok) return page;
    all.push(...items(page.value));
    if (offset + PAGE >= page.value.total) return ok(all);
  }
}
