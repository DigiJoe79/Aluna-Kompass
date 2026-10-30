/**
 * Freitext als Typst-String-Ausdruck: Nichts darin wirkt als Markup; das Semikolon beendet den Ausdruck. Dieselben
 * Escapes wie die Briefe der Finanzen und Mitglieder — das Modul importiert keine Interna anderer Module.
 */
export const typstText = (value: string): string => `#"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}";`;

/** Wie `typstText`, als Inhalt in eckigen Klammern. */
export const typstInline = (value: string): string => `[${typstText(value)}]`;
