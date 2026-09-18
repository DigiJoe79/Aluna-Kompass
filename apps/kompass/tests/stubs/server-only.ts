/**
 * `server-only` wirft beim Import, sobald es nicht aus einer Server-Komponente
 * kommt — auch im Test, der genau diesen Servercode prüfen will. Vitest bekommt
 * deshalb diese leere Datei an seiner Stelle (siehe `vitest.config.ts`).
 *
 * Die Zusicherung geht dabei nicht verloren: Next prüft sie beim Bauen, und der
 * Bau läuft im dritten Prüfring.
 */
export {};
