/**
 * Der reine CSV-Kern (F4b): ohne Datenbank, ohne `@kompass/*` — auch im
 * Browser nutzbar über `@kompass/module-finance/csv`.
 */
export { decodeCsv, type CsvEncoding } from './decode';
export { tokenizeCsv } from './tokenize';
export { csvFormatSchema, headerSignature, normalizeHeaderCell, type CsvFormat } from './format';
export { parseCsvAmount, parseCsvDate, readCsv, type CsvErrorCode, type CsvLine, type CsvReadResult, type CsvStatement } from './read';
