/**
 * Verstellt die Uhr eines Node-Prozesses — nur für `scripts/e2e-kalender.sh`
 * (Plan 2026-10-06-seed-kalender), nie in der Anwendung.
 *
 *   NODE_OPTIONS=--import=<file-URL von scripts/fake-date.mjs> FAKE_OFFSET_MS=<ms> …
 *
 * `FAKE_OFFSET_MS` ist ein Versatz und gilt für alle Prozesse eines Laufs
 * gleich (Playwright, `next dev`, Worker) — sie starten zu verschiedenen
 * Zeiten, ein Zeitpunkt je Prozess ließe sie auseinanderlaufen. `FAKE_NOW`
 * (ein Zeitpunkt) ist die Kurzform für einen einzelnen Prozess. Ohne beide
 * bleibt alles, wie es ist.
 *
 * Ein Proxy statt einer Unterklasse: So bleiben `Date()` ohne `new`,
 * Unterklassen von `Date` und `instanceof Date` intakt.
 */
const RealDate = globalThis.Date;

function offsetFromEnv() {
  if (process.env.FAKE_OFFSET_MS !== undefined) return Number(process.env.FAKE_OFFSET_MS);
  if (process.env.FAKE_NOW !== undefined) return RealDate.parse(process.env.FAKE_NOW) - RealDate.now();
  return 0;
}

const offset = offsetFromEnv();
if (!Number.isFinite(offset)) throw new Error('fake-date: FAKE_OFFSET_MS oder FAKE_NOW ist keine Zeitangabe');

if (offset !== 0) {
  const now = () => RealDate.now() + offset;
  const FakeDate = new Proxy(RealDate, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget),
    apply: () => new RealDate(now()).toString(),
    get: (target, prop, receiver) => (prop === 'now' ? now : Reflect.get(target, prop, receiver)),
  });
  // Sonst zeigte `new Date().constructor` auf das echte Date, nicht auf den Proxy — `=== Date` wäre falsch.
  Object.defineProperty(RealDate.prototype, 'constructor', { value: FakeDate, writable: true, configurable: true, enumerable: false });
  globalThis.Date = FakeDate;
}
