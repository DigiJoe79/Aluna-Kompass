import { getRequestConfig } from 'next-intl/server';

/**
 * Ein fehlender Schlüssel fällt sonst niemandem auf: next-intl meldet ihn im
 * Protokoll und zeichnet den Pfad als Text — auf dem Bildschirm steht dann
 * `content.backToList` statt „Zurück zur Übersicht“, und kein Test merkt es,
 * solange keiner genau diese Beschriftung liest. Genau so ging am 11.09. ein
 * falsch gebundener Namensraum durch drei grüne Prüfringe bis in die CI.
 *
 * Im Test wird daraus ein Fehler. Wer die Anwendung benutzt, soll dagegen einen
 * halb übersetzten Bildschirm sehen und nicht gar keinen — in `development` und
 * `production` bleibt es deshalb bei der Meldung.
 *
 * Nur serverseitig. Für die Client-Seite müsste `NextIntlClientProvider` von
 * Hand gesetzt werden, und damit auch Sprache, Texte, Zeitzone und Formate, die
 * er sonst aus dem Serverkontext erbt — jede davon eine Stelle, an der etwas
 * fehlen kann. Ein Versuch am 11.09. brach genau daran (`locale` fehlte, dann
 * `timeZone`, dann der Kontext selbst). Die Client-Seite deckt stattdessen
 * `tests/message-keys.test.ts` ab: Er schlägt jeden festen Schlüssel nach,
 * bevor überhaupt ein Browser startet.
 */
export default getRequestConfig(async () => ({
  locale: 'de',
  timeZone: 'Europe/Berlin',
  messages: (await import('../../messages/de.json')).default,
  onError(error: unknown) {
    if (process.env.APP_ENV === 'test') throw error;
    console.error(error);
  },
}));
