/**
 * Betrag einer Fahrt nach Kilometersatz (F8a Annahme 4): rein, kaufmännisch
 * auf ganze Cent gerundet (ein halber Cent rundet auf). Der Satz ist der am
 * Positionsdatum (`mileageRate`, `centsPerKm`); der Dienst speichert das
 * Ergebnis am Antrag, damit ein späterer Satz den eingereichten Betrag nie
 * ändert. Negative oder nicht endliche Werte sind ein technischer Fehler —
 * der Dienst prüft vorher.
 */
export function tripAmountCents(km: number, rateCentsPerKm: number): number {
  if (!Number.isFinite(km) || !Number.isFinite(rateCentsPerKm) || km < 0 || rateCentsPerKm < 0) {
    throw new RangeError(`tripAmountCents: expected non-negative finite numbers, got ${km} km × ${rateCentsPerKm} ct/km`);
  }
  // Auf zwölf Stellen glätten, bevor gerundet wird: 1,005 × 100 ist in Gleitkomma 100,4999…, gemeint ist 100,5.
  return Math.round(Number((km * rateCentsPerKm).toPrecision(12)));
}
