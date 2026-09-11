'use client';

import messages from '../../messages/de.json';

/**
 * Die letzte Grenze: Sie greift, wenn das Wurzel-Layout selbst scheitert, und
 * **ersetzt** es — deshalb bringt sie `<html>` und `<body>` mit.
 *
 * Der Text kommt direkt aus `messages/de.json` und nicht über `next-intl`:
 * Wenn das Layout kaputt ist, steht der Übersetzungs-Provider womöglich gar
 * nicht. Der Satz bleibt trotzdem an der einen Stelle, an der alle
 * Oberflächentexte stehen (Prinzip 7).
 *
 * **Keine Farben, keine Tokens, keine Klassen.** Die Tokens kommen aus dem
 * Layout, das hier gerade fehlt, und ein Stylesheet, auf das dieser Bildschirm
 * wartet, ist genau das, was er nicht voraussetzen darf. Übrig bleiben Abstände
 * und Schriftgrössen; die Farben stellt der Browser. Damit braucht diese Datei
 * auch keine Ausnahme von `no-color-literals.test.ts`.
 */
const t = messages.errors.pages.technical;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="de">
      <body>
        <main style={{ maxWidth: 520, margin: '15vh auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <p style={{ fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{t.kicker}</p>
          <h1 style={{ fontSize: 22, margin: '8px 0 12px' }}>{t.title}</h1>
          <p style={{ fontSize: 14, lineHeight: 1.55 }}>{t.text}</p>
          {error.digest ? (
            <code style={{ display: 'inline-block', marginTop: 8, fontSize: 12 }}>{error.digest}</code>
          ) : null}
          <p style={{ marginTop: 20 }}>
            <button type="button" onClick={reset} style={{ padding: '8px 14px', fontSize: 14, cursor: 'pointer' }}>
              {t.retry}
            </button>
          </p>
        </main>
      </body>
    </html>
  );
}
