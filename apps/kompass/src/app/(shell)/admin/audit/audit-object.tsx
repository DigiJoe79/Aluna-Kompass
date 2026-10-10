import type { AuditObject } from '@/lib/audit-entities';

/**
 * Das Objekt eines Protokolleintrags, in Tabelle und Detail gleich: „Typ · Name“. „gelöscht“ steht gedämpft an der
 * Stelle des Namens, damit es nicht wie ein Name aussieht (Designer 2026-10-09). Ohne Hooks: auf Server und Client.
 */
export function AuditObjectLabel({ object }: { object: AuditObject }) {
  return (
    <>
      {object.word}
      {object.name ? ` · ${object.name}` : null}
      {object.deleted ? (
        <>
          {' · '}
          <span className="text-muted-ink">{object.deleted}</span>
        </>
      ) : null}
    </>
  );
}
