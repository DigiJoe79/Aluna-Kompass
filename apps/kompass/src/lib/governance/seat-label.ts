import type { SeatRow } from '@kompass/module-governance';

/** Titel einer Platzzeile in der Kartenzeile (Board 12a): „{Amt}: {Name}“ bzw. „{Amt}: unbesetzt“ — `vacant` aus der Sprachdatei. */
export const seatLabel = (seat: Pick<SeatRow, 'officeName' | 'name'>, vacant: string): string => `${seat.officeName}: ${seat.name ?? vacant}`;
