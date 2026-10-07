/**
 * Seit K10 Charge 1 liegen die Datumsfunktionen in `@kompass/core/dates` (rein, ohne Import), damit
 * Oberfläche, Dienste (`messageDate`) und Papier (`paperDate`) eine Quelle haben. Diese Datei leitet
 * nur weiter; ihre Aufrufer bleiben.
 */
export { DEFAULT_TIME_ZONE, formatDate, formatDateTime, isIsoDay, paperDate, type DateFormatMode, type IsoDay } from '@kompass/core/dates';
