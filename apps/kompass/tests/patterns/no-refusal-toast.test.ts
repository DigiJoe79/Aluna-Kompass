import { describe, expect, it } from 'vitest';
import { type Allowlist, allowlistHygiene, callArguments, read, relative, sourceFiles, staleKeys } from './source';

/**
 * Eine Ablehnung des Dienstes steht über dem Knopf, der sie ausgelöst hat (docs/MUSTER.md § A), nicht
 * in einem Toast, der nach Sekunden verschwindet. Seit Fassung 0.2.6 gibt es dafür `FormActionBar state`,
 * `ConfirmDialog` und `RefusalNotice`; wo wirklich kein Platz ist, geht der Weg über `toastRefusal`.
 * Dieser Wächter findet jedes `toast.error(…)`, dessen Text aus einer Meldung stammt (`.message`), und
 * erlaubt es nur dort, wo die Bausteine selbst es tun — je Datei mit Grund.
 */
export const ALLOWED: Allowlist = {
  'lib/feedback.ts': '`toastRefusal` (Ausnahme R5, kein Platz über dem Auslöser) und `toastNetwork` sind die einzigen Wege, eine Meldung als Toast zu zeigen.',
  'components/forms/use-action-feedback.ts': 'Netz gescheitert: Toast ohne Zeitlimit mit „Erneut versuchen“ — keine Ablehnung des Dienstes, sondern kein Weg zu ihm.',
  'components/site/site-job-provider.tsx': 'Ende eines Webseiten-Laufs „gescheitert“: ein Ergebnis, das nach Minuten eintrifft, wenn man längst woanders ist — der Toast trägt „Protokoll öffnen“.',
};

describe('keine Ablehnung als Toast', () => {
  const violations = sourceFiles().flatMap((file) =>
    callArguments(read(file), 'toast.error(')
      .filter(({ args }) => /\.message\b/.test(args))
      .map(({ line }) => ({ where: `${relative(file)}:${line}`, file: relative(file) })),
  );

  it('toast.error mit .message steht nur in der Erlaubnisliste', () => {
    expect(violations.filter(({ file }) => !(file in ALLOWED)).map(({ where }) => where)).toEqual([]);
  });

  allowlistHygiene(ALLOWED, () => staleKeys(ALLOWED, violations.map(({ file }) => file)));
});
